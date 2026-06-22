import { randomUUID } from 'node:crypto';

export const WORKFLOW_STATE_VERSION = 1;

export const WORKFLOW_RUN_STATES = Object.freeze([
  'idle',
  'running',
  'waiting_input',
  'waiting_approval',
  'interrupting',
  'interrupted',
  'completed',
  'error',
  'cancelled',
]);

export const TASK_LIFECYCLE_STATES = Object.freeze([
  'queued',
  'waiting_input',
  'running',
  'reviewing',
  'waiting_approval',
  'rework',
  'interrupted',
  'completed',
  'failed',
  'cancelled',
]);

const RUN_TRANSITIONS = Object.freeze({
  idle: new Set(['running', 'cancelled']),
  running: new Set(['waiting_input', 'waiting_approval', 'completed', 'interrupting', 'interrupted', 'error', 'cancelled']),
  waiting_input: new Set(['running', 'cancelled']),
  waiting_approval: new Set(['running', 'completed', 'cancelled']),
  interrupting: new Set(['interrupted', 'error', 'cancelled']),
  interrupted: new Set(['running', 'cancelled']),
  completed: new Set(['running']),
  error: new Set(['running', 'cancelled']),
  cancelled: new Set(['running']),
});

const TASK_TRANSITIONS = Object.freeze({
  queued: new Set(['waiting_input', 'running', 'failed', 'cancelled']),
  waiting_input: new Set(['queued', 'running', 'cancelled']),
  running: new Set(['reviewing', 'waiting_approval', 'interrupted', 'completed', 'failed', 'cancelled']),
  reviewing: new Set(['waiting_approval', 'rework', 'interrupted', 'completed', 'failed', 'cancelled']),
  waiting_approval: new Set(['rework', 'completed', 'cancelled']),
  rework: new Set(['waiting_input', 'running', 'failed', 'cancelled']),
  interrupted: new Set(['queued', 'running', 'failed', 'cancelled']),
  completed: new Set(['queued', 'rework']),
  failed: new Set(['queued', 'running', 'cancelled']),
  cancelled: new Set(['queued']),
});

const LEGACY_STATE_FIELDS = new Set([
  'status',
  'phase',
  'open_questions',
  'review_status',
  'review_only_pending',
  'gate_status',
  'test_status',
]);

const text = (value) => String(value || '').trim();
const isoNow = () => new Date().toISOString();

export function createWorkflowRunId(uuid = randomUUID) {
  return text(uuid()).slice(0, 8);
}

export function createWorkflowTaskId(workflowRunId, ordinal) {
  const runId = text(workflowRunId);
  const index = Number(ordinal);
  if (!runId) throw new Error('workflowRunId is required');
  if (!Number.isInteger(index) || index < 1) throw new Error('task ordinal must be a positive integer');
  return `${runId}-${index}`;
}

export function workflowCorrelation(record = {}) {
  return {
    version: WORKFLOW_STATE_VERSION,
    sessionId: text(record.session_id ?? record.sessionId),
    workflowRunId: text(record.run_id ?? record.workflowRunId),
    taskId: text(record.id ?? record.task_id ?? record.taskId),
    parentTaskId: text(record.parent_task_id ?? record.parentTaskId),
    invocationId: text(record.invocation_id ?? record.invocationId),
    clientRunId: text(record.client_run_id ?? record.clientRunId),
  };
}

export function validateWorkflowCorrelation(correlation, { requireTask = false } = {}) {
  const value = workflowCorrelation(correlation);
  const errors = [];
  if (!value.sessionId) errors.push('sessionId is required');
  if (!value.workflowRunId) errors.push('workflowRunId is required');
  if (requireTask && !value.taskId) errors.push('taskId is required');
  return { ok: errors.length === 0, errors, value };
}

export function inferLegacyTaskLifecycle(task = {}) {
  const status = text(task.status).toLowerCase();
  const phase = text(task.phase).toLowerCase();
  const review = text(task.review_status).toLowerCase();
  const gate = text(task.gate_status).toLowerCase();
  const hasQuestions = Array.isArray(task.open_questions) && task.open_questions.filter(Boolean).length > 0;

  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'waiting_input' || (status === 'pending' && hasQuestions)) return 'waiting_input';
  if (task.review_only_pending) return 'reviewing';
  if (review === 'rework' || gate === 'rework') return 'rework';
  if (status === 'in_progress' || status === 'running') return 'running';
  if (gate === 'passed' || phase === 'done' || status === 'completed') return 'completed';
  if (phase === 'gate' || (review === 'pass' && gate !== 'passed')) return 'waiting_approval';
  if (status === 'done') {
    if (Number(task.chain_depth || 0) > 0 || review === 'skipped') return 'completed';
    return 'reviewing';
  }
  return 'queued';
}

function validTaskState(value) {
  return TASK_LIFECYCLE_STATES.includes(value);
}

function validRunState(value) {
  return WORKFLOW_RUN_STATES.includes(value);
}

function normalizedLifecycle(task, { at = isoNow(), preferLegacy = false } = {}) {
  const current = task?.lifecycle && typeof task.lifecycle === 'object' ? task.lifecycle : null;
  const inferred = inferLegacyTaskLifecycle(task);
  const useLegacy = preferLegacy || !validTaskState(current?.state) || current?.source === 'legacy';
  return {
    version: WORKFLOW_STATE_VERSION,
    state: useLegacy ? inferred : current.state,
    revision: Math.max(0, Number(current?.revision || 0)),
    updatedAt: text(current?.updatedAt) || text(task?.updated_at) || text(task?.created_at) || at,
    reason: text(current?.reason),
    lastEventId: text(current?.lastEventId),
    source: useLegacy ? 'legacy' : 'canonical',
  };
}

export function normalizeTaskRecord(task = {}, options = {}) {
  return {
    ...task,
    correlation: workflowCorrelation(task),
    lifecycle: normalizedLifecycle(task, options),
  };
}

export function synchronizeTaskRecord(previous = {}, patch = {}, {
  at = isoNow(),
  eventId = '',
  reason = '',
} = {}) {
  const before = normalizeTaskRecord(previous, { at });
  if (eventId && before.lifecycle.lastEventId === eventId) return before;

  const merged = { ...before, ...patch };
  const explicit = patch.lifecycle && validTaskState(patch.lifecycle.state);
  const legacyTouched = Object.keys(patch).some((key) => LEGACY_STATE_FIELDS.has(key));
  const nextState = explicit
    ? patch.lifecycle.state
    : legacyTouched
      ? inferLegacyTaskLifecycle({ ...merged, lifecycle: null })
      : before.lifecycle.state;
  const changed = nextState !== before.lifecycle.state;
  const touched = changed || Boolean(eventId) || Boolean(reason) || explicit;

  return {
    ...merged,
    correlation: workflowCorrelation(merged),
    lifecycle: {
      ...before.lifecycle,
      ...(explicit ? patch.lifecycle : {}),
      version: WORKFLOW_STATE_VERSION,
      state: nextState,
      revision: before.lifecycle.revision + (changed ? 1 : 0),
      updatedAt: touched ? at : before.lifecycle.updatedAt,
      reason: text(reason || patch.lifecycle?.reason || before.lifecycle.reason),
      lastEventId: text(eventId || patch.lifecycle?.lastEventId || before.lifecycle.lastEventId),
      source: explicit ? 'canonical' : legacyTouched ? 'legacy' : before.lifecycle.source,
    },
  };
}

function legacyProjection(nextState, task) {
  switch (nextState) {
    case 'queued': return { status: 'pending', phase: 'pending' };
    case 'waiting_input': return { status: 'waiting_input' };
    case 'running': return { status: 'in_progress', phase: 'impl' };
    case 'reviewing': return { status: 'done', phase: 'review' };
    case 'waiting_approval': return { status: 'done', phase: 'gate' };
    case 'rework': return { status: 'pending', phase: 'impl', review_status: 'rework', gate_status: 'rework' };
    case 'interrupted': return {
      status: 'pending',
      started_at: null,
      finished_at: null,
      interruption_reason: task.interruption_reason || 'service_restarted',
    };
    case 'completed': return { status: 'done', phase: 'done' };
    case 'failed': return { status: 'failed' };
    case 'cancelled': return { status: 'cancelled' };
    default: return {};
  }
}

export function transitionTaskLifecycle(task, nextState, {
  at = isoNow(),
  eventId = '',
  reason = '',
  patch = {},
} = {}) {
  const current = normalizeTaskRecord(task, { at });
  if (!validTaskState(nextState)) throw new Error(`unknown task lifecycle state: ${nextState}`);
  if (eventId && current.lifecycle.lastEventId === eventId) return current;
  if (current.lifecycle.state !== nextState && !TASK_TRANSITIONS[current.lifecycle.state]?.has(nextState)) {
    throw new Error(`invalid task lifecycle transition: ${current.lifecycle.state} -> ${nextState}`);
  }
  const changed = current.lifecycle.state !== nextState;
  const merged = {
    ...current,
    ...legacyProjection(nextState, current),
    ...patch,
  };
  return {
    ...merged,
    correlation: workflowCorrelation(merged),
    lifecycle: {
      version: WORKFLOW_STATE_VERSION,
      state: nextState,
      revision: current.lifecycle.revision + (changed ? 1 : 0),
      updatedAt: changed || eventId || reason ? at : current.lifecycle.updatedAt,
      reason: text(reason || current.lifecycle.reason),
      lastEventId: text(eventId || current.lifecycle.lastEventId),
      source: 'canonical',
    },
  };
}

export function recoverInterruptedTaskRecords(tasks = [], {
  at = isoNow(),
  reason = 'service_restarted',
} = {}) {
  let recovered = 0;
  const records = tasks.map((task) => {
    const current = normalizeTaskRecord(task, { at });
    if (current.lifecycle.state !== 'running') return current;
    recovered += 1;
    return transitionTaskLifecycle(current, 'interrupted', {
      at,
      eventId: `recovery:${reason}:${current.id}`,
      reason,
      patch: { interrupted_at: at, interruption_reason: reason },
    });
  });
  return { tasks: records, recovered };
}

export function transitionWorkflowRunState(current, nextState, patch = {}) {
  const previous = validRunState(current?.status) ? current.status : 'idle';
  if (!validRunState(nextState)) throw new Error(`unknown workflow run state: ${nextState}`);
  if (previous !== nextState && !RUN_TRANSITIONS[previous]?.has(nextState)) {
    throw new Error(`invalid workflow run transition: ${previous} -> ${nextState}`);
  }
  return {
    ...(current || {}),
    ...patch,
    version: WORKFLOW_STATE_VERSION,
    status: nextState,
    updatedAt: Date.now(),
  };
}
