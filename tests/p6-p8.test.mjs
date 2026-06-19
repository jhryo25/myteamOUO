import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempRoot = mkdtempSync(join(tmpdir(), 'myteam-p6-p8-'));
process.env.MYTEAM_DB_PATH = join(tempRoot, 'test.sqlite');
process.env.MYTEAM_SKIP_LEGACY_IMPORT = '1';

const { repository } = await import('../storage.mjs');
const {
  authorizeOperation,
  decideApproval,
  listAudit,
  requestApproval,
} = await import('../governance.mjs');
const { ScheduleService, nextCronDate } = await import('../scheduler.mjs');

test('SQLite repository persists normalized session state and entities', () => {
  repository.upsert('tasks', { id: 'task-1', title: 'Persist me', status: 'pending' });
  assert.equal(repository.get('tasks', 'task-1').title, 'Persist me');

  repository.saveSessionState({
    activeId: 'session-1',
    sessions: [{ id: 'session-1', name: 'Test', history: [{ role: 'user', text: 'hello' }] }],
    trashedSessions: [],
  });
  const state = repository.loadSessionState();
  assert.equal(state.activeId, 'session-1');
  assert.equal(state.sessions[0].history[0].text, 'hello');
});

test('approval fingerprint rejects payload changes and audit redacts secrets', () => {
  const payload = { target: 'agents', apiKey: 'secret-one', model: 'test' };
  const approval = requestApproval({ operation: 'config.write', payload, sessionId: 'session-1' });
  assert.equal(approval.title, '修改本地配置');
  assert.match(approval.reason, /配置/);
  assert.ok(approval.effects.length > 0);
  decideApproval(approval.id, 'approve_once');

  const mismatch = authorizeOperation({
    operation: 'config.write',
    payload: { ...payload, apiKey: 'secret-two' },
    sessionId: 'session-1',
    approvalId: approval.id,
  });
  assert.equal(mismatch.ok, false);

  const allowed = authorizeOperation({
    operation: 'config.write', payload, sessionId: 'session-1', approvalId: approval.id,
  });
  assert.equal(allowed.ok, true);
  assert.equal(repository.get('approvals', approval.id).status, 'consumed');
  assert.doesNotMatch(JSON.stringify(listAudit()), /secret-one|secret-two/);
});

test('agent dispatch approval explains capability and selected scope', () => {
  const approval = requestApproval({
    operation: 'agent.dispatch',
    payload: { selection: 'all_pending', pendingCount: 3, requestedAgent: 'task_assignment' },
    sessionId: 'session-1',
  });
  assert.equal(approval.title, '执行 pending 任务');
  assert.match(approval.reason, /Agent CLI/);
  assert.match(approval.reason, /读写工作区/);
  assert.deepEqual(approval.payload, {
    selection: 'all_pending', pendingCount: 3, requestedAgent: 'task_assignment',
  });
  decideApproval(approval.id, 'deny');
});

test('scheduler validates timezone, waits for approval, and prevents overlap', async () => {
  const next = nextCronDate('0 9 * * *', 'Asia/Hong_Kong', new Date('2026-06-19T00:00:00Z'));
  assert.equal(next.toISOString(), '2026-06-19T01:00:00.000Z');

  let executions = 0;
  const service = new ScheduleService({ execute: async () => { executions++; return { summary: 'done' }; } });
  const schedule = service.create({
    name: 'Daily', expression: '0 9 * * *', timezone: 'Asia/Hong_Kong',
    goal: 'Create a report', agent: 'codex', mode: 'chat', enabled: false,
  });
  const waiting = await service.trigger(schedule.id, { manual: true });
  assert.equal(waiting.status, 'waiting_approval');

  const duplicate = await service.trigger(schedule.id, { manual: true });
  assert.equal(duplicate.status, 'skipped');

  const approved = decideApproval(waiting.approvalId, 'approve_once');
  const completed = await service.resumeApproval(approved);
  assert.equal(completed.status, 'succeeded');
  assert.equal(executions, 1);
  service.stop();
});

test.after(() => {
  repository.close();
  rmSync(tempRoot, { recursive: true, force: true });
});
