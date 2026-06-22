import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
} from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph';
import { normalizeTaskRecord } from '../workflow-state.mjs';
import { createWorkflowPorts } from './ports.mjs';

const listReducer = (left, right) => Array.isArray(right) ? right : left;

export const DispatchState = Annotation.Root({
  workflowRunId: Annotation({ default: () => '' }),
  sessionId: Annotation({ default: () => '' }),
  clientRunId: Annotation({ default: () => '' }),
  tasks: Annotation({ reducer: listReducer, default: () => [] }),
  cursor: Annotation({ default: () => 0 }),
  currentTask: Annotation({ default: () => null }),
  execution: Annotation({ default: () => null }),
  review: Annotation({ default: () => null }),
  taskOutcome: Annotation({ default: () => '' }),
  spawnedTaskIds: Annotation({ reducer: listReducer, default: () => [] }),
  completedTaskIds: Annotation({ reducer: listReducer, default: () => [] }),
  failedTaskIds: Annotation({ reducer: listReducer, default: () => [] }),
  reworkAttempts: Annotation({ default: () => 0 }),
  status: Annotation({ default: () => 'idle' }),
  options: Annotation({ default: () => ({}) }),
  error: Annotation({ default: () => null }),
});

const nowIso = () => new Date().toISOString();
const taskHasQuestions = (task) => Array.isArray(task?.open_questions)
  && task.open_questions.filter(Boolean).length > 0;

function workflowContext(state) {
  return {
    workflowRunId: state.workflowRunId,
    sessionId: state.sessionId,
    clientRunId: state.clientRunId,
    options: state.options || {},
  };
}

function interruptSnapshot(snapshot) {
  const interrupts = [];
  for (const task of snapshot?.tasks || []) {
    for (const item of task.interrupts || []) interrupts.push(item);
  }
  return interrupts;
}

export function createTaskSubgraph(rawPorts) {
  const ports = createWorkflowPorts(rawPorts);

  const execute = async (state) => {
    const task = normalizeTaskRecord(state.currentTask || {});
    if (task.review_only_pending && task.previous_result) {
      ports.emit('task-review-resume', {
        id: task.id,
        title: task.title,
        reviewer: task.reviewer || null,
        message: '复用已保存的 Agent 结果，只重试 Reviewer',
      });
      const reviewBase = task.lifecycle?.state === 'reviewing'
        ? task
        : await ports.transitionTask(task, 'running', {
          eventId: `langgraph:review-resume-prepare:${state.workflowRunId}:${task.id}`,
          reason: 'review_only_retry_prepare',
          patch: { error: null, failure_stage: null, retryable: null },
        });
      const reviewing = await ports.transitionTask(reviewBase, 'reviewing', {
        eventId: `langgraph:review-resume:${state.workflowRunId}:${task.id}`,
        reason: 'review_only_retry',
        patch: { review_status: null },
      });
      return {
        currentTask: reviewing,
        execution: {
          result: task.previous_result,
          agent: task.executed_by || task.agent,
          artifacts: task.artifacts || [],
          spawnRequests: [],
        },
        review: null,
        taskOutcome: 'executed',
        error: null,
      };
    }
    const startedAt = nowIso();
    ports.emit('task-start', { id: task.id, title: task.title, agent: task.agent });
    const running = await ports.transitionTask(task, 'running', {
      eventId: `langgraph:execute:${state.workflowRunId}:${task.id}:${state.reworkAttempts}`,
      reason: state.reworkAttempts ? 'rework_execution' : 'workflow_execution',
      patch: { started_at: startedAt, error: null },
    });
    try {
      const execution = await ports.executeTask(running, {
        ...workflowContext(state),
        reworkAttempt: state.reworkAttempts,
      });
      const result = String(execution?.result || '');
      const reviewing = await ports.transitionTask(running, 'reviewing', {
        eventId: `langgraph:executed:${state.workflowRunId}:${task.id}:${state.reworkAttempts}`,
        reason: 'execution_completed',
        patch: {
          result: result.slice(0, 2000),
          finished_at: nowIso(),
          executed_by: execution?.agent || running.agent,
          artifacts: Array.isArray(execution?.artifacts) ? execution.artifacts : [],
        },
      });
      ports.emit('task-done', {
        id: task.id,
        title: task.title,
        agent: execution?.agent || running.agent,
        summary: result.slice(0, 200),
      });
      return {
        currentTask: reviewing,
        execution: { ...execution, result },
        review: null,
        taskOutcome: 'executed',
        error: null,
      };
    } catch (error) {
      const message = String(error?.message || error);
      const failed = await ports.transitionTask(running, 'failed', {
        eventId: `langgraph:execute-failed:${state.workflowRunId}:${task.id}:${state.reworkAttempts}`,
        reason: 'execution_failed',
        patch: { error: message, failure_stage: 'execute', retryable: error?.retryable !== false, finished_at: nowIso() },
      });
      ports.emit('task-failed', { id: task.id, title: task.title, agent: running.agent, error: message });
      return { currentTask: failed, taskOutcome: 'failed', error: message };
    }
  };

  const routeAfterExecute = (state) => state.taskOutcome === 'failed' ? 'task_end' : 'review_task';

  const review = async (state) => {
    const task = state.currentTask;
    if (Number(task?.chain_depth || 0) > 0 && state.options?.reviewSpawned !== true) {
      return { review: { verdict: 'skipped', reason: 'spawned task review is disabled' }, taskOutcome: 'reviewed' };
    }
    ports.emit('task-review-start', { id: task.id, title: task.title, reviewer: null, strategy: 'langgraph' });
    try {
      const outcome = await ports.reviewTask(task, state.execution, workflowContext(state));
      if (outcome?.verdict === 'review_error') {
        const message = String(outcome.reason || 'Reviewer failed');
        const failed = await ports.transitionTask(task, 'failed', {
          eventId: `langgraph:review-error:${state.workflowRunId}:${task.id}:${state.reworkAttempts}`,
          reason: outcome.code || 'review_failed',
          patch: {
            error: message,
            failure_stage: 'review',
            retryable: outcome.retryable !== false,
            review_status: 'failed',
            review_only_pending: true,
            previous_result: state.execution?.result?.slice(0, 2000) || task.previous_result || null,
            finished_at: nowIso(),
          },
        });
        ports.emit('task-review-failed', { id: task.id, title: task.title, ...outcome, error: message });
        return { currentTask: failed, review: outcome, taskOutcome: 'failed', error: message };
      }
      const verdict = ['pass', 'rework', 'skipped'].includes(outcome?.verdict)
        ? outcome.verdict
        : 'rework';
      return { review: { ...outcome, verdict }, taskOutcome: 'reviewed', error: null };
    } catch (error) {
      const message = String(error?.message || error);
      const failed = await ports.transitionTask(task, 'failed', {
        eventId: `langgraph:review-failed:${state.workflowRunId}:${task.id}:${state.reworkAttempts}`,
        reason: 'review_failed',
        patch: { error: message, failure_stage: 'review', retryable: true, finished_at: nowIso() },
      });
      ports.emit('task-review-repair', { id: task.id, title: task.title, reason: message });
      return { currentTask: failed, taskOutcome: 'failed', error: message };
    }
  };

  const routeAfterReview = (state) => {
    if (state.taskOutcome === 'failed') return 'task_end';
    if (state.review?.verdict === 'rework') return 'rework';
    if (state.options?.requireHumanGate) return 'human_gate';
    return 'complete';
  };

  const humanGate = (state) => {
    const decision = interrupt({
      kind: 'human_gate',
      workflowRunId: state.workflowRunId,
      sessionId: state.sessionId,
      task: state.currentTask,
      execution: state.execution,
      review: state.review,
      actions: ['pass', 'rework'],
    });
    const verdict = typeof decision === 'string' ? decision : decision?.decision;
    return {
      review: {
        ...(state.review || {}),
        verdict: verdict === 'pass' ? 'pass' : 'rework',
        humanDecision: decision,
      },
    };
  };

  const routeAfterGate = (state) => state.review?.verdict === 'pass' ? 'complete' : 'rework';

  const rework = async (state) => {
    const attempt = Number(state.reworkAttempts || 0) + 1;
    const limit = Math.max(0, Number(state.options?.maxReworkAttempts ?? 1));
    if (attempt > limit) {
      const message = `rework limit exceeded (${limit})`;
      const failed = await ports.transitionTask(state.currentTask, 'failed', {
        eventId: `langgraph:rework-limit:${state.workflowRunId}:${state.currentTask.id}:${attempt}`,
        reason: 'rework_limit_exceeded',
        patch: { error: message, failure_stage: 'rework', retryable: true, finished_at: nowIso() },
      });
      ports.emit('task-failed', { id: failed.id, title: failed.title, error: message });
      return { currentTask: failed, reworkAttempts: attempt, taskOutcome: 'failed', error: message };
    }
    const reworkTask = await ports.transitionTask(state.currentTask, 'rework', {
      eventId: `langgraph:rework:${state.workflowRunId}:${state.currentTask.id}:${attempt}`,
      reason: 'review_requested_rework',
      patch: {
        previous_result: state.execution?.result?.slice(0, 2000) || null,
        result: null,
        review_status: 'rework',
        review_note: state.review?.suggestion || state.review?.reason || '',
        started_at: null,
        finished_at: null,
      },
    });
    ports.emit('task-review-done', {
      id: reworkTask.id,
      title: reworkTask.title,
      ...state.review,
      verdict: 'rework',
      attempt,
    });
    return {
      currentTask: reworkTask,
      execution: null,
      review: null,
      reworkAttempts: attempt,
      taskOutcome: 'rework',
    };
  };

  const complete = async (state) => {
    const completed = await ports.transitionTask(state.currentTask, 'completed', {
      eventId: `langgraph:completed:${state.workflowRunId}:${state.currentTask.id}`,
      reason: state.review?.verdict === 'skipped' ? 'review_skipped' : 'review_passed',
      patch: {
        status: 'done',
        phase: 'done',
        review_status: state.review?.verdict || 'pass',
        gate_status: state.options?.requireHumanGate ? 'passed' : (state.currentTask.gate_status || 'passed'),
        reviewed_at: nowIso(),
        reviewer: state.review?.reviewer || state.currentTask.reviewer || null,
      },
    });
    ports.emit('task-review-done', {
      id: completed.id,
      title: completed.title,
      ...(state.review || {}),
      verdict: state.review?.verdict || 'pass',
    });
    return { currentTask: completed, taskOutcome: 'completed', error: null };
  };

  return new StateGraph(DispatchState)
    .addNode('execute', execute, { retryPolicy: { maxAttempts: 1 } })
    .addNode('review_task', review, { retryPolicy: { maxAttempts: 1 } })
    .addNode('human_gate', humanGate)
    .addNode('rework', rework)
    .addNode('complete', complete)
    .addNode('task_end', (state) => ({ taskOutcome: state.taskOutcome }))
    .addEdge(START, 'execute')
    .addConditionalEdges('execute', routeAfterExecute, { review_task: 'review_task', task_end: 'task_end' })
    .addConditionalEdges('review_task', routeAfterReview, {
      task_end: 'task_end',
      rework: 'rework',
      human_gate: 'human_gate',
      complete: 'complete',
    })
    .addConditionalEdges('human_gate', routeAfterGate, { complete: 'complete', rework: 'rework' })
    .addConditionalEdges('rework', (state) => state.taskOutcome === 'failed' ? 'task_end' : 'execute', {
      task_end: 'task_end',
      execute: 'execute',
    })
    .addEdge('complete', 'task_end')
    .addEdge('task_end', END)
    .compile({ name: 'myteam-task-subgraph' });
}

export function createDispatchGraph(rawPorts, { checkpointer = new MemorySaver() } = {}) {
  const ports = createWorkflowPorts(rawPorts);
  const taskSubgraph = createTaskSubgraph(ports);

  const initialize = (state) => ({
    workflowRunId: String(state.workflowRunId || ''),
    sessionId: String(state.sessionId || ''),
    clientRunId: String(state.clientRunId || ''),
    tasks: (state.tasks || []).map((task) => normalizeTaskRecord(task)),
    cursor: Number(state.cursor || 0),
    status: 'running',
    options: {
      maxReworkAttempts: 1,
      maxSpawnDepth: 2,
      requireHumanGate: false,
      reviewSpawned: false,
      ...(state.options || {}),
    },
    completedTaskIds: state.completedTaskIds || [],
    failedTaskIds: state.failedTaskIds || [],
    spawnedTaskIds: state.spawnedTaskIds || [],
  });

  const selectTask = (state) => {
    if (state.cursor >= state.tasks.length) {
      const status = state.failedTaskIds.length ? 'completed_with_errors' : 'completed';
      return { currentTask: null, status };
    }
    return {
      currentTask: normalizeTaskRecord(state.tasks[state.cursor]),
      execution: null,
      review: null,
      taskOutcome: '',
      reworkAttempts: 0,
      error: null,
    };
  };

  const routeSelected = (state) => {
    if (!state.currentTask) return 'finish';
    return taskHasQuestions(state.currentTask) ? 'clarify' : 'run_task';
  };

  const clarify = async (state) => {
    const answer = interrupt({
      kind: 'clarification',
      workflowRunId: state.workflowRunId,
      sessionId: state.sessionId,
      task: state.currentTask,
      questions: state.currentTask.open_questions,
    });
    const updated = await ports.applyClarification(state.currentTask, answer, workflowContext(state));
    const tasks = [...state.tasks];
    tasks[state.cursor] = normalizeTaskRecord(updated);
    return { tasks, currentTask: tasks[state.cursor] };
  };

  const enqueueSpawns = async (state) => {
    const tasks = [...state.tasks];
    tasks[state.cursor] = state.currentTask;
    const requests = Array.isArray(state.execution?.spawnRequests) ? state.execution.spawnRequests : [];
    const depth = Number(state.currentTask?.chain_depth || 0);
    const maxDepth = Math.max(0, Number(state.options?.maxSpawnDepth ?? 2));
    let spawned = [];
    if (requests.length && depth < maxDepth && state.taskOutcome === 'completed') {
      spawned = await ports.materializeSpawns(state.currentTask, requests, workflowContext(state));
      for (const task of spawned) {
        if (!task?.id || tasks.some((existing) => existing.id === task.id)) continue;
        tasks.push(normalizeTaskRecord(task));
        ports.emit('worklist-chain', {
          from: state.currentTask.agent,
          to: task.agent,
          parent_id: state.currentTask.id,
          chain_task_id: task.id,
        });
      }
    }
    const completedTaskIds = state.taskOutcome === 'completed'
      ? [...new Set([...state.completedTaskIds, state.currentTask.id])]
      : state.completedTaskIds;
    const failedTaskIds = state.taskOutcome === 'failed'
      ? [...new Set([...state.failedTaskIds, state.currentTask.id])]
      : state.failedTaskIds;
    return {
      tasks,
      spawnedTaskIds: [...new Set([...state.spawnedTaskIds, ...spawned.map((task) => task.id)])],
      completedTaskIds,
      failedTaskIds,
    };
  };

  const advance = (state) => ({ cursor: state.cursor + 1, currentTask: null });
  const halt = async (state) => {
    const tasks = [...state.tasks];
    tasks[state.cursor] = state.currentTask;
    const failedTaskIds = [...new Set([...state.failedTaskIds, state.currentTask?.id].filter(Boolean))];
    const summary = {
      workflowRunId: state.workflowRunId,
      sessionId: state.sessionId,
      status: 'failed',
      done: state.completedTaskIds.length,
      failed: failedTaskIds.length,
      blockedTaskId: state.currentTask?.id || null,
      remaining: Math.max(0, state.tasks.length - state.cursor - 1),
    };
    await ports.onWorkflowComplete(summary, { ...state, tasks, failedTaskIds, status: 'failed' });
    ports.emit('workflow-failed', summary);
    return { tasks, failedTaskIds, status: 'failed' };
  };
  const finish = async (state) => {
    const status = state.failedTaskIds.length ? 'completed_with_errors' : 'completed';
    const summary = {
      workflowRunId: state.workflowRunId,
      sessionId: state.sessionId,
      status,
      done: state.completedTaskIds.length,
      failed: state.failedTaskIds.length,
      spawned: state.spawnedTaskIds.length,
    };
    await ports.onWorkflowComplete(summary, state);
    ports.emit('workflow-done', summary);
    return { status };
  };

  return new StateGraph(DispatchState)
    .addNode('initialize', initialize)
    .addNode('select_task', selectTask)
    .addNode('clarify', clarify)
    .addNode('run_task', taskSubgraph)
    .addNode('enqueue_spawns', enqueueSpawns)
    .addNode('advance', advance)
    .addNode('halt', halt)
    .addNode('finish', finish)
    .addEdge(START, 'initialize')
    .addEdge('initialize', 'select_task')
    .addConditionalEdges('select_task', routeSelected, {
      clarify: 'clarify',
      run_task: 'run_task',
      finish: 'finish',
    })
    .addEdge('clarify', 'run_task')
    .addConditionalEdges('run_task', (state) => state.taskOutcome === 'failed' ? 'halt' : 'enqueue_spawns', {
      halt: 'halt',
      enqueue_spawns: 'enqueue_spawns',
    })
    .addEdge('enqueue_spawns', 'advance')
    .addEdge('advance', 'select_task')
    .addEdge('finish', END)
    .addEdge('halt', END)
    .compile({ checkpointer, name: 'myteam-dispatch-workflow' });
}

export class LangGraphDispatchEngine {
  constructor(ports, { checkpointer = new MemorySaver() } = {}) {
    this.ports = createWorkflowPorts(ports);
    this.graph = createDispatchGraph(this.ports, { checkpointer });
  }

  config(workflowRunId, extra = {}) {
    if (!workflowRunId) throw new Error('workflowRunId is required');
    return {
      configurable: { thread_id: String(workflowRunId) },
      recursionLimit: 200,
      ...extra,
    };
  }

  async run(input) {
    return this.#stream(input, this.config(input.workflowRunId));
  }

  async resume(workflowRunId, value) {
    return this.#stream(new Command({ resume: value }), this.config(workflowRunId));
  }

  async getState(workflowRunId) {
    const snapshot = await this.graph.getState(this.config(workflowRunId));
    return {
      values: snapshot.values,
      next: [...(snapshot.next || [])],
      interrupts: interruptSnapshot(snapshot),
      config: snapshot.config,
      checkpoint: {
        threadId: String(workflowRunId),
        createdAt: snapshot.createdAt || null,
        step: Number.isFinite(snapshot.metadata?.step) ? snapshot.metadata.step : null,
        source: snapshot.metadata?.source || null,
      },
    };
  }

  async #stream(input, config) {
    const stream = await this.graph.stream(input, { ...config, streamMode: 'updates' });
    for await (const update of stream) {
      if (update?.__interrupt__) {
        this.ports.emit('workflow-interrupt', { interrupts: update.__interrupt__ });
      }
    }
    return this.getState(config.configurable.thread_id);
  }
}
