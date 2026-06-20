import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const { openPathWithDefaultApp, resolveWorkspaceHtmlPath } = await import('../commandSafety.mjs');

test('workspace HTML opening validates paths and avoids command shells', () => {
  const root = mkdtempSync(join(tmpdir(), 'myteam-html-'));
  const outside = mkdtempSync(join(tmpdir(), 'myteam-outside-'));
  mkdirSync(join(root, 'reports'));
  mkdirSync(join(root, 'secrets'));
  writeFileSync(join(root, 'reports', 'summary.html'), '<h1>ok</h1>');
  writeFileSync(join(root, 'reports', 'notes.txt'), 'no');
  writeFileSync(join(root, 'secrets', 'report.html'), '<h1>secret</h1>');
  writeFileSync(join(outside, 'report.html'), '<h1>outside</h1>');

  assert.equal(resolveWorkspaceHtmlPath(root, 'reports/summary.html').rel, 'reports/summary.html');
  assert.throws(() => resolveWorkspaceHtmlPath(root, 'reports/notes.txt'), /仅支持/);
  assert.throws(() => resolveWorkspaceHtmlPath(root, join(outside, 'report.html')), /不在当前工作区/);
  assert.throws(() => resolveWorkspaceHtmlPath(root, 'secrets/report.html', ['secrets']), /禁止访问/);

  const calls = [];
  openPathWithDefaultApp('D:\\myteam\\reports\\summary.html', {
    platform: 'win32',
    spawnImpl(command, args, options) { calls.push({ command, args, options }); return { unref() {} }; },
  });
  assert.equal(calls[0].command, 'rundll32.exe');
  assert.deepEqual(calls[0].args, ['url.dll,FileProtocolHandler', 'D:\\myteam\\reports\\summary.html']);
  assert.equal(calls[0].options.detached, true);
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test('SQLite repository persists normalized session state and entities', () => {
  repository.upsert('tasks', { id: 'task-1', title: 'Persist me', status: 'pending' });
  assert.equal(repository.get('tasks', 'task-1').title, 'Persist me');

  repository.saveSessionState({
    activeId: 'session-1',
    sessions: [{ id: 'session-1', name: 'Test', history: [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'done', parts: [
        { id: 'part-1', type: 'reasoning', text: 'checking' },
        { id: 'part-2', type: 'tool_call', callId: 'call-1', name: 'shell', status: 'completed' },
        { id: 'part-3', type: 'tool_result', callId: 'call-1', output: 'ok' },
        { id: 'part-4', type: 'final', text: 'done' },
      ] },
    ] }],
    trashedSessions: [],
  });
  const state = repository.loadSessionState();
  assert.equal(state.activeId, 'session-1');
  assert.equal(state.sessions[0].history[0].text, 'hello');
  assert.deepEqual(state.sessions[0].history[1].parts.map(part => part.type), [
    'reasoning', 'tool_call', 'tool_result', 'final',
  ]);
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
