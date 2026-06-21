import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorkflowRunId,
  createWorkflowTaskId,
  inferLegacyTaskLifecycle,
  normalizeTaskRecord,
  recoverInterruptedTaskRecords,
  synchronizeTaskRecord,
  transitionTaskLifecycle,
  transitionWorkflowRunState,
  validateWorkflowCorrelation,
} from '../workflow-state.mjs';

const baseTask = {
  id: 'run-1-1',
  run_id: 'run-1',
  session_id: 'session-1',
  title: 'Implement lifecycle',
  status: 'pending',
  phase: 'pending',
  created_at: '2026-06-21T00:00:00.000Z',
};

test('task records expose one canonical lifecycle and correlation contract', () => {
  const task = normalizeTaskRecord(baseTask);
  assert.equal(task.lifecycle.state, 'queued');
  assert.equal(task.lifecycle.version, 1);
  assert.deepEqual(task.correlation, {
    version: 1,
    sessionId: 'session-1',
    workflowRunId: 'run-1',
    taskId: 'run-1-1',
    parentTaskId: '',
    invocationId: '',
    clientRunId: '',
  });
  assert.deepEqual(validateWorkflowCorrelation(task.correlation, { requireTask: true }), {
    ok: true,
    errors: [],
    value: task.correlation,
  });
});

test('legacy task fields map deterministically into lifecycle states', () => {
  assert.equal(inferLegacyTaskLifecycle({ status: 'pending' }), 'queued');
  assert.equal(inferLegacyTaskLifecycle({ status: 'pending', open_questions: ['choose'] }), 'waiting_input');
  assert.equal(inferLegacyTaskLifecycle({ status: 'in_progress' }), 'running');
  assert.equal(inferLegacyTaskLifecycle({ status: 'done', phase: 'impl' }), 'reviewing');
  assert.equal(inferLegacyTaskLifecycle({ status: 'done', review_status: 'pass', phase: 'gate' }), 'waiting_approval');
  assert.equal(inferLegacyTaskLifecycle({ status: 'pending', review_status: 'rework' }), 'rework');
  assert.equal(inferLegacyTaskLifecycle({ status: 'done', gate_status: 'passed' }), 'completed');
  assert.equal(inferLegacyTaskLifecycle({ status: 'failed' }), 'failed');
});

test('legacy patches keep the canonical lifecycle synchronized during migration', () => {
  const running = synchronizeTaskRecord(baseTask, {
    status: 'in_progress',
    started_at: '2026-06-21T01:00:00.000Z',
  }, { at: '2026-06-21T01:00:00.000Z' });
  assert.equal(running.lifecycle.state, 'running');

  const reviewing = synchronizeTaskRecord(running, {
    status: 'done',
    phase: 'impl',
    result: 'ready for review',
  }, { at: '2026-06-21T01:01:00.000Z' });
  assert.equal(reviewing.lifecycle.state, 'reviewing');

  const completed = synchronizeTaskRecord(reviewing, {
    review_status: 'pass',
    gate_status: 'passed',
    phase: 'done',
  }, { at: '2026-06-21T01:02:00.000Z' });
  assert.equal(completed.lifecycle.state, 'completed');
  assert.equal(completed.lifecycle.revision, 3);
});

test('canonical transitions reject skips and deduplicate repeated events', () => {
  const queued = normalizeTaskRecord(baseTask);
  assert.throws(
    () => transitionTaskLifecycle(queued, 'completed'),
    /invalid task lifecycle transition: queued -> completed/,
  );

  const running = transitionTaskLifecycle(queued, 'running', {
    at: '2026-06-21T02:00:00.000Z',
    eventId: 'execute:run-1-1:attempt-1',
  });
  const duplicate = transitionTaskLifecycle(running, 'running', {
    at: '2026-06-21T02:05:00.000Z',
    eventId: 'execute:run-1-1:attempt-1',
  });
  assert.deepEqual(duplicate, running);
  assert.equal(running.lifecycle.revision, 1);
  assert.equal(running.status, 'in_progress');
});

test('service restart recovers only actively running tasks and is idempotent', () => {
  const { tasks, recovered } = recoverInterruptedTaskRecords([
    { ...baseTask, status: 'in_progress', started_at: '2026-06-21T03:00:00.000Z' },
    { ...baseTask, id: 'run-1-2', status: 'done', phase: 'done', gate_status: 'passed' },
  ], { at: '2026-06-21T03:05:00.000Z' });

  assert.equal(recovered, 1);
  assert.equal(tasks[0].lifecycle.state, 'interrupted');
  assert.equal(tasks[0].status, 'pending');
  assert.equal(tasks[0].interruption_reason, 'service_restarted');
  assert.equal(tasks[1].lifecycle.state, 'completed');

  const second = recoverInterruptedTaskRecords(tasks, { at: '2026-06-21T03:06:00.000Z' });
  assert.equal(second.recovered, 0);
  assert.equal(second.tasks[0].lifecycle.state, 'interrupted');
});

test('workflow run transitions and generated IDs follow one contract', () => {
  const runId = createWorkflowRunId(() => '12345678-abcd-4000-8000-123456789abc');
  assert.equal(runId, '12345678');
  assert.equal(createWorkflowTaskId(runId, 2), '12345678-2');

  const running = transitionWorkflowRunState({ status: 'idle' }, 'running', { workflowRunId: runId });
  const interrupted = transitionWorkflowRunState(running, 'interrupted', { reason: 'service_restarted' });
  const resumed = transitionWorkflowRunState(interrupted, 'running');
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.version, 1);
  assert.throws(
    () => transitionWorkflowRunState({ status: 'idle' }, 'completed'),
    /invalid workflow run transition/,
  );
});
