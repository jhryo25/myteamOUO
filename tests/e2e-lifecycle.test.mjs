import test from 'node:test';
import assert from 'node:assert/strict';
import { MemorySaver } from '@langchain/langgraph';

import { transitionTaskLifecycle, normalizeTaskRecord } from '../workflow-state.mjs';
import { LangGraphDispatchEngine } from '../workflow/dispatch-graph.mjs';

function task(id, patch = {}) {
  return {
    id,
    run_id: 'wf-e2e',
    session_id: 'session-e2e',
    title: `Task ${id}`,
    goal: 'Verify end-to-end task lifecycle chain',
    agent: patch.agent || 'codex',
    status: 'pending',
    phase: 'pending',
    steps: ['step 1', 'step 2'],
    accept: '验收通过',
    open_questions: [],
    ...patch,
  };
}

function fakePorts(options = {}) {
  const records = new Map();
  const events = [];
  const calls = { execute: 0, review: 0 };

  const ensureLifecycle = (record, state) => {
    const normalized = normalizeTaskRecord(record);
    if (normalized.lifecycle.state !== state) {
      try {
        return transitionTaskLifecycle(normalized, state, {
          eventId: `lifecycle-ensure:${state}:${record.id}:${Date.now()}`,
          reason: 'state_alignment',
          patch: {},
        });
      } catch (err) {
        console.warn('lifecycle alignment failed:', err.message);
        return normalized;
      }
    }
    return normalized;
  };

  return {
    records,
    events,
    calls,
    ports: {
      emit(event, data) { events.push({ event, data }); },
      async transitionTask(current, next, meta) {
        const normalized = normalizeTaskRecord(current);
        const dbRecord = records.get(normalized.id) || normalized;
        const aligned = ensureLifecycle(dbRecord, normalized.lifecycle.state);
        try {
          const updated = transitionTaskLifecycle(aligned, next, meta);
          records.set(updated.id, updated);
          return updated;
        } catch (err) {
          if (meta.eventId && meta.eventId.includes('state_align')) {
            records.set(aligned.id, aligned);
            return updated;
          }
          throw err;
        }
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
        return requests.map((r, i) => task(`${parent.id}-spawn-${i + 1}`, {
          parent_task_id: parent.id,
          chain_depth: Number(parent.chain_depth || 0) + 1,
          agent: r.agent,
          title: r.task,
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

test('E2E lifecycle: plan->queued->running->reviewing->rework->running->reviewing->completed', async () => {
  const fake = fakePorts({
    reviewTask(current, _exec, calls) {
      if (calls.review === 1) {
        return { verdict: 'rework', reviewer: 'claude', suggestion: 'fix it', severity: 'P1', score: 4, findings: ['missing edge case'] };
      }
      return { verdict: 'pass', reviewer: 'claude', suggestion: '', severity: 'none', score: 9, findings: [] };
    },
  });

  const engine = new LangGraphDispatchEngine(fake.ports, { checkpointer: new MemorySaver() });
  const state = await engine.run({
    workflowRunId: 'wf-e2e-1',
    sessionId: 'session-e2e',
    tasks: [task('t1')],
    options: { maxReworkAttempts: 1 },
  });

  assert.equal(state.values.status, 'completed');
  assert.equal(fake.calls.execute, 2, 'execute called twice: initial + rework');
  assert.equal(fake.calls.review, 2, 'review called twice: initial rework verdict + final pass verdict');

  const lifecycle = fake.records.get('t1').lifecycle;
  assert.equal(lifecycle.state, 'completed');
});

test('E2E lifecycle: review_only_pending task skips execute and completes', async () => {
  const fake = fakePorts({
    reviewTask() {
      return { verdict: 'pass', reviewer: 'claude', suggestion: '' };
    },
  });

  const engine = new LangGraphDispatchEngine(fake.ports, { checkpointer: new MemorySaver() });
  const state = await engine.run({
    workflowRunId: 'wf-e2e-review-only',
    sessionId: 'session-e2e',
    tasks: [task('t1', {
      status: 'pending',
      phase: 'review',
      review_only_pending: true,
      previous_result: 'saved agent output',
      executed_by: 'kimi',
      lifecycle: { state: 'reviewing', version: 1, revision: 2, updatedAt: new Date().toISOString(), reason: 'review_failed', lastEventId: '', source: 'canonical' },
    })],
  });

  assert.equal(state.values.status, 'completed');
  assert.equal(fake.calls.execute, 0, 'execute skipped — review_only_pending preserves agent result');
  assert.equal(fake.calls.review, 1);
});
