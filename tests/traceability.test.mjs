import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../web/app.html', import.meta.url), 'utf8');

test('task cost ledger and invocation provenance share stable trace identifiers', () => {
  assert.match(server, /pathname === '\/api\/cost-ledger'/);
  assert.match(server, /session_id: sessionId/);
  assert.match(server, /task_id: taskId/);
  assert.match(server, /run_id: runId/);
  assert.match(server, /input_tokens_est/);
  assert.match(server, /output_preview/);
  assert.match(app, /function renderHubCosts\(/);
  assert.match(html, /data-tab="costs"/);
});

test('session artifact ledger includes task artifacts and keeps workspace files separate', () => {
  assert.match(server, /readTasks\(\)\.filter\(\(item\) => item\.session_id === target\.id\)/);
  assert.match(server, /taskTitle: task\.title/);
  assert.match(app, /attributedPaths/);
  assert.match(html, /工作区（未归属）/);
});

test('artifact tabs reset cross-tab previews and the drawer supports persisted resizing', () => {
  assert.match(app, /function resetArtifactPreview\(/);
  assert.match(app, /currentBelongsToTab/);
  assert.match(app, /myteam\.artifactsPanelWidth/);
  assert.match(app, /setPointerCapture/);
  assert.match(html, /id="artifactsResizeHandle"/);
});

test('lessons survive task deletion and participate in later collaboration context', () => {
  assert.match(server, /source_task_snapshot/);
  assert.match(server, /source_task_deleted: true/);
  assert.match(server, /relevantLessons\(/);
  assert.match(server, /lessonIds: matchedLessons/);
  assert.match(app, /lesson-snapshot/);
});

test('skill loading supports on-demand, always, and manual with per-session usage trace', () => {
  assert.match(server, /\['on_demand', 'always', 'manual'\]/);
  assert.match(server, /pathname === '\/api\/skills\/usage'/);
  assert.match(app, /skill-loading-select/);
  assert.match(app, /当前会话还没有真实 Skill 调用记录/);
});

test('plan agent changes update the shared task list and reject failed HTTP saves', () => {
  assert.match(app, /if \(!response\.ok \|\| !data\.ok\) throw new Error/);
  assert.match(app, /const cachedTask = allTasks\.find/);
  assert.match(app, /cachedTask\.agent = data\.task\.agent/);
  assert.match(app, /filterAndRenderTasks\(\)/);
  assert.match(app, /sel\.value = previousAgent/);
});

test('refreshed dispatch state stays linked to the conversation session', () => {
  assert.match(app, /sessionId: t\.session_id/);
  assert.doesNotMatch(app, /sessionId: t\.run_id/);
  assert.match(app, /renderSessionRunningTask\(activeTask, r\)/);
  assert.match(server, /taskId: record\.taskId/);
});

test('automatic reviewer advances the gate and writes a visible review result', () => {
  assert.match(server, /gate_status: data\.verdict === 'pass' \? \(deferGate \? 'waiting' : 'passed'\) : 'rework'/);
  assert.match(server, /test_status: data\.verdict === 'pass' \? 'agent_passed' : 'agent_rework'/);
  assert.match(server, /kind: 'task-review'/);
  assert.match(app, /function createTaskReviewCard\(/);
  assert.match(app, /Agent 已验收/);
  assert.match(app, /打开验收 Gate/);
});

test('running task card exposes live phase, activity, and output progress', () => {
  assert.match(server, /currentActivity: record\.currentActivity/);
  assert.match(server, /childRecord\.outputChars = fullText\.length/);
  assert.match(app, /function updateSessionRunningTaskCard\(/);
  assert.match(app, /session-running-status/);
  assert.match(app, /session-running-metrics/);
  assert.match(app, /bumpSessionRunningTaskMetric/);
});

test('dispatch is mutually exclusive, session-scoped, and persists task activity parts', () => {
  assert.match(server, /const activeDispatches = new Map/);
  assert.match(server, /code: 'dispatch_conflict'/);
  assert.match(server, /pending = pending\.filter\(t => t\.session_id === dispatchSession\.id\)/);
  assert.match(server, /turnCollector: taskTurnCollector/);
  assert.match(server, /parts: taskTurnCollector\.parts/);
  assert.match(app, /const \{ running = \[\], dispatches = \[\] \}/);
  assert.match(app, /part:\s+appendTurnPart/);
});

test('running task activity survives refresh and reconnect only streams newer events', () => {
  assert.match(server, /kind: 'task-running'/);
  assert.match(server, /onTurnPart: persistTaskTurnPart/);
  assert.match(server, /\['tool_call', 'tool_result', 'error', 'interrupted'\]/);
  assert.match(server, /taskTurnRecord\.kind = 'task-result'/);
  assert.match(server, /busAttach\(sid, res, \{ replay: url\.searchParams\.get\('replay'\) !== '0' \}\)/);
  assert.match(app, /\/stream\?replay=0/);
});

test('agent rate-limit failures are persisted and surfaced in conversation history', () => {
  assert.match(server, /normalizeAgentFailure\(agentKey, detail \|\| `exit code \$\{code\}`/);
  assert.match(server, /type: 'error',[\s\S]*?retryable: Boolean\(err\.retryable\)/);
  assert.match(server, /taskTurnRecord\.kind = 'task-error'/);
  assert.match(server, /sseSend\(workflowRes, 'part', errorPart\)/);
});

test('deleting the final conversation leaves one hidden draft instead of an undeletable visible loop', () => {
  assert.match(server, /newSession\('', \{ ephemeral: true \}\)/);
  assert.match(server, /sessions\.filter\(s => !s\.ephemeral\)\.map/);
  assert.match(server, /session\.ephemeral = false/);
  assert.match(app, /document\.querySelectorAll\('\.undo-toast'\)/);
  assert.match(app, /myteam\.hiddenDraftSessionId/);
  assert.match(app, /deletingLastVisibleSession/);
});

test('open questions pause dispatch and move into an input-adjacent clarification flow', () => {
  assert.match(server, /status: Array\.isArray\(task\.open_questions\).*'waiting_input'/);
  assert.match(server, /pathname === '\/api\/tasks\/clarify'/);
  assert.match(server, /code: 'clarification_required'/);
  assert.match(app, /function renderClarificationTray\(/);
  assert.match(app, /确认并继续执行/);
  assert.match(app, /input type="radio" name="clarification-/);
  assert.match(app, /clarification-other-input/);
  assert.match(app, /suggestClarificationOptions/);
  assert.doesNotMatch(app, /id="clarificationOther"/);
  assert.doesNotMatch(app, /<div><b>待确认：<\/b>/);
});

test('bulk task selection is reconciled with the currently visible task set', () => {
  assert.match(app, /function reconcileBulkSelection\(visibleTasks = \[\]\)/);
  assert.match(app, /if \(!visibleIds\.has\(id\)\) selectedTaskIds\.delete\(id\)/);
  assert.match(app, /reconcileBulkSelection\(filtered\);\s*renderTasks\(filtered\)/);
});

test('review protocol failures are retried internally instead of becoming user acceptance work', () => {
  assert.match(server, /attempt <= 3/);
  assert.match(server, /task-review-retrying/);
  assert.match(server, /review_status: 'agent_repair_pending'/);
  assert.match(server, /review_only_pending: true/);
  assert.match(app, /Agent 修复验收中/);
});
