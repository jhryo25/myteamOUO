import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySaver } from '@langchain/langgraph';

import { transitionTaskLifecycle } from '../workflow-state.mjs';
import { createSqliteCheckpointer } from '../workflow/checkpointer.mjs';
import { LangGraphDispatchEngine } from '../workflow/dispatch-graph.mjs';
import { LangGraphTurnEngine } from '../workflow/turn-graph.mjs';

function task(id, patch = {}) {
  return {
    id,
    run_id: 'wf-test',
    session_id: 'session-test',
    title: `Task ${id}`,
    goal: 'Test LangGraph orchestration',
    agent: patch.agent || 'codex',
    status: 'pending',
    phase: 'pending',
    steps: [],
    open_questions: [],
    ...patch,
  };
}

function fakePorts(options = {}) {
  const records = new Map();
  const events = [];
  const calls = { execute: 0, review: 0 };
  return {
    records,
    events,
    calls,
    ports: {
      emit(event, data) { events.push({ event, data }); },
      async transitionTask(current, next, meta) {
        const updated = transitionTaskLifecycle(records.get(current.id) || current, next, meta);
        records.set(updated.id, updated);
        return updated;
      },
      async executeTask(current) {
        calls.execute += 1;
        return options.executeTask
          ? options.executeTask(current, calls)
          : { result: `result:${current.id}`, agent: current.agent, spawnRequests: [] };
      },
      async reviewTask(current, execution) {
        calls.review += 1;
        return options.reviewTask
          ? options.reviewTask(current, execution, calls)
          : { verdict: 'pass', reviewer: 'claude', suggestion: '' };
      },
      async materializeSpawns(parent, requests) {
        return requests.map((request, index) => task(`${parent.id}-spawn-${index + 1}`, {
          parent_task_id: parent.id,
          chain_depth: Number(parent.chain_depth || 0) + 1,
          agent: request.agent,
          title: request.task,
        }));
      },
      async applyClarification(current, answer) {
        return {
          ...current,
          open_questions: [],
          clarification_answers: answer?.answers || [],
          status: 'pending',
        };
      },
    },
  };
}

test('LangGraph dispatch runs a multi-task queue and materializes spawned subgraph work', async () => {
  const fake = fakePorts({
    executeTask(current) {
      return {
        result: `result:${current.id}`,
        agent: current.agent,
        spawnRequests: current.id === 't1'
          ? [{ agent: 'kimi', task: 'spawned verification', accept: 'verified' }]
          : [],
      };
    },
  });
  const engine = new LangGraphDispatchEngine(fake.ports, { checkpointer: new MemorySaver() });
  const state = await engine.run({
    workflowRunId: 'wf-queue',
    sessionId: 'session-test',
    tasks: [task('t1'), task('t2')],
  });

  assert.equal(state.values.status, 'completed');
  assert.deepEqual(state.values.completedTaskIds, ['t1', 't2', 't1-spawn-1']);
  assert.deepEqual(state.values.spawnedTaskIds, ['t1-spawn-1']);
  assert.equal(fake.calls.execute, 3);
  assert.equal(fake.calls.review, 2, 'spawned task review is skipped by policy');
  assert.ok(fake.events.some((item) => item.event === 'worklist-chain'));
});

test('LangGraph task subgraph loops through bounded rework before completing', async () => {
  const fake = fakePorts({
    reviewTask(_current, _execution, calls) {
      return calls.review === 1
        ? { verdict: 'rework', reviewer: 'claude', suggestion: 'fix it' }
        : { verdict: 'pass', reviewer: 'claude' };
    },
  });
  const engine = new LangGraphDispatchEngine(fake.ports, { checkpointer: new MemorySaver() });
  const state = await engine.run({
    workflowRunId: 'wf-rework',
    sessionId: 'session-test',
    tasks: [task('t1')],
    options: { maxReworkAttempts: 1 },
  });

  assert.equal(state.values.status, 'completed');
  assert.equal(fake.calls.execute, 2);
  assert.equal(fake.calls.review, 2);
  assert.equal(fake.records.get('t1').lifecycle.state, 'completed');
});

test('human gate interrupt resumes without repeating execution or review side effects', async () => {
  const fake = fakePorts();
  const engine = new LangGraphDispatchEngine(fake.ports, { checkpointer: new MemorySaver() });
  const paused = await engine.run({
    workflowRunId: 'wf-human-gate',
    sessionId: 'session-test',
    tasks: [task('t1')],
    options: { requireHumanGate: true },
  });

  assert.ok(paused.interrupts.length > 0);
  assert.equal(paused.interrupts[0].value.kind, 'human_gate');
  assert.equal(fake.calls.execute, 1);
  assert.equal(fake.calls.review, 1);

  const resumed = await engine.resume('wf-human-gate', { decision: 'pass' });
  assert.equal(resumed.values.status, 'completed');
  assert.equal(fake.calls.execute, 1);
  assert.equal(fake.calls.review, 1);
});

test('clarification interrupt resumes the selected task with supplied answers', async () => {
  const fake = fakePorts();
  const engine = new LangGraphDispatchEngine(fake.ports, { checkpointer: new MemorySaver() });
  const paused = await engine.run({
    workflowRunId: 'wf-clarify',
    sessionId: 'session-test',
    tasks: [task('t1', { open_questions: [{ question: 'Which mode?', options: ['safe', 'fast'] }] })],
  });
  assert.equal(paused.interrupts[0].value.kind, 'clarification');

  const resumed = await engine.resume('wf-clarify', {
    answers: [{ question: 'Which mode?', answer: 'safe' }],
  });
  assert.equal(resumed.values.status, 'completed');
  assert.equal(fake.calls.execute, 1);
});

test('SQLite checkpointer resumes the same workflow from a new engine instance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'myteam-langgraph-'));
  const db = join(dir, 'checkpoint.sqlite');
  const fake = fakePorts();
  const saver1 = createSqliteCheckpointer(db);
  const engine1 = new LangGraphDispatchEngine(fake.ports, { checkpointer: saver1 });
  try {
    const paused = await engine1.run({
      workflowRunId: 'wf-sqlite',
      sessionId: 'session-test',
      tasks: [task('t1')],
      options: { requireHumanGate: true },
    });
    assert.ok(paused.interrupts.length > 0);
    saver1.db.close();

    const saver2 = createSqliteCheckpointer(db);
    const engine2 = new LangGraphDispatchEngine(fake.ports, { checkpointer: saver2 });
    const resumed = await engine2.resume('wf-sqlite', { decision: 'pass' });
    assert.equal(resumed.values.status, 'completed');
    assert.equal(fake.calls.execute, 1);
    saver2.db.close();
  } finally {
    if (saver1.db.open) saver1.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chat, plan and schedule turns share the checkpointed LangGraph turn engine', async () => {
  const engine = new LangGraphTurnEngine({ checkpointer: new MemorySaver() });
  let calls = 0;
  const result = await engine.run({
    workflowRunId: 'turn-plan-1',
    sessionId: 'session-test',
    mode: 'plan',
    input: { prompt: 'split this goal' },
    metadata: { clientRunId: 'client-1' },
  }, async (input, state) => {
    calls += 1;
    assert.equal(state.mode, 'plan');
    return `done:${input.prompt}`;
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.output, 'done:split this goal');
  assert.equal(calls, 1);
});
