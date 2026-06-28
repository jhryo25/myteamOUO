import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// 主源文件 + 所有拆分后的模块
const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const sessionStore = readModule('../server/services/session-store.mjs');
const skillsRoute = readModule('../server/routes/skills.mjs');
const agentsRoute = readModule('../server/routes/agents.mjs');
const staticRoute = readModule('../server/routes/static-files.mjs');
const sessionsRoute = readModule('../server/routes/sessions.mjs');
const serverModules = [server, sessionStore, skillsRoute, agentsRoute, staticRoute, sessionsRoute].join('\n');

const appCore = readFileSync(new URL('../web/js/app-core.js', import.meta.url), 'utf8');
const bubble = readModule('../web/js/chat/bubble.js');
const planWorkflow = readModule('../web/js/chat/plan-workflow.js');
const artifacts = readModule('../web/js/components/artifacts.js');
const skills = readModule('../web/js/components/skills.js');
const richBlocks = readModule('../web/js/utils/rich-blocks.js');
const premiumEffects = readModule('../web/js/utils/premium-effects.js');
const appModules = [appCore, bubble, planWorkflow, artifacts, skills, richBlocks, premiumEffects].join('\n');

const html = readFileSync(new URL('../web/app.html', import.meta.url), 'utf8');

function readModule(relativePath) {
  try {
    return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  } catch {
    return '';
  }
}

test('task cost ledger and invocation provenance share stable trace identifiers', () => {
  assert.match(serverModules, /pathname === '\/api\/cost-ledger'/);
  assert.match(serverModules, /session_id: sessionId/);
  assert.match(serverModules, /task_id: taskId/);
  assert.match(serverModules, /run_id: runId/);
  assert.match(serverModules, /input_tokens_est/);
  assert.match(serverModules, /output_preview/);
  assert.match(appModules, /function renderHubCosts\(/);
  assert.match(html, /data-tab="costs"/);
});

test('session artifact ledger includes task artifacts and keeps workspace files separate', () => {
  assert.match(serverModules, /readTasks\(\)\.filter\(\(item\) => item\.session_id === target\.id\)/);
  assert.match(serverModules, /taskTitle: task\.title/);
  assert.match(appModules, /attributedPaths/);
  assert.match(html, /工作区（未归属）/);
});

test('artifact tabs reset cross-tab previews and the drawer supports persisted resizing', () => {
  assert.match(appModules, /function resetArtifactPreview\(/);
  assert.match(appModules, /currentBelongsToTab/);
  assert.match(appModules, /myteam\.artifactsPanelWidth/);
  assert.match(appModules, /setPointerCapture/);
  assert.match(html, /id="artifactsResizeHandle"/);
});

test('lessons survive task deletion and participate in later collaboration context', () => {
  assert.match(serverModules, /source_task_snapshot/);
  assert.match(serverModules, /source_task_deleted: true/);
  assert.match(serverModules, /relevantLessons\(/);
  assert.match(serverModules, /lessonIds: matchedLessons/);
  assert.match(appModules, /lesson-snapshot/);
});

test('skill loading supports on-demand, always, and manual with per-session usage trace', () => {
  assert.match(serverModules, /\['always', 'manual', 'on_demand'\]/);
  assert.match(serverModules, /pathname === '\/api\/skills\/usage'/);
  assert.match(appModules, /skill-loading-select/);
  assert.match(appModules, /当前会话还没有真实 Skill 调用记录/);
});

test('plan agent changes update the shared task list and reject failed HTTP saves', () => {
  assert.match(appModules, /if \(!response\.ok \|\| !data\.ok\) throw new Error/);
  assert.match(appModules, /const cachedTask = allTasks\.find/);
  assert.match(appModules, /cachedTask\.agent = data\.task\.agent/);
  assert.match(appModules, /filterAndRenderTasks\(\)/);
  assert.match(appModules, /sel\.value = previousAgent/);
  assert.match(appModules, /plan-suggest-all/);
  assert.match(appModules, /runDispatch\(\)/);
  assert.match(appModules, /button\.textContent = `仅执行/);
  assert.match(appModules, /button\.classList\.toggle\('hidden', count === 0\)/);
});

test('refreshed dispatch state stays linked to the conversation session', () => {
  assert.match(appModules, /sessionId: t\.session_id/);
  assert.doesNotMatch(appModules, /sessionId: t\.run_id/);
  assert.match(appModules, /renderSessionRunningTask\(activeTask, r\)/);
  assert.match(serverModules, /taskId: record\.taskId/);
});

test('automatic reviewer advances the gate and writes a visible review result', () => {
  assert.match(serverModules, /gate_status: data\.verdict === 'pass' \? \(deferGate \? 'waiting' : 'passed'\) : 'rework'/);
  assert.match(serverModules, /test_status: data\.verdict === 'pass' \? 'agent_passed' : 'agent_rework'/);
  assert.match(serverModules, /kind: 'task-review'/);
  assert.match(appModules, /function createTaskReviewCard\(/);
  assert.match(appModules, /Agent 已验收/);
  assert.match(appModules, /打开验收 Gate/);
});

test('running task card exposes live phase, activity, and output progress', () => {
  assert.match(serverModules, /currentActivity: record\.currentActivity/);
  assert.match(serverModules, /childRecord\.outputChars = fullText\.length/);
  assert.match(appModules, /function updateSessionRunningTaskCard\(/);
  assert.match(appModules, /session-running-status/);
  assert.match(appModules, /session-running-metrics/);
  assert.match(appModules, /bumpSessionRunningTaskMetric/);
  assert.match(appModules, /const task = allTasks\.find\(item => item\.id === id\)/);
  assert.match(appModules, /task\.status = status/);
  assert.match(appModules, /filterAndRenderTasks\(\);\s*return;/);
  assert.match(appModules, /task\.failure_stage === 'review'/);
  assert.match(appModules, /返工次数已用尽/);
});

test('dispatch is mutually exclusive, session-scoped, and persists task activity parts', () => {
  assert.match(serverModules, /const activeDispatches = new Map/);
  assert.match(serverModules, /code: 'dispatch_conflict'/);
  assert.match(serverModules, /pending = pending\.filter\(t => t\.session_id === dispatchSession\.id\)/);
  assert.match(serverModules, /turnCollector: taskTurnCollector/);
  assert.match(serverModules, /parts: taskTurnCollector\.parts/);
  assert.match(appModules, /const \{ running = \[\], dispatches = \[\] \}/);
  assert.match(appModules, /part:\s+appendTurnPart/);
});

test('running task activity survives refresh and reconnect only streams newer events', () => {
  assert.match(serverModules, /kind: 'task-running'/);
  assert.match(serverModules, /onTurnPart: persistTaskTurnPart/);
  assert.match(serverModules, /\['tool_call', 'tool_result', 'error', 'interrupted'\]/);
  assert.match(serverModules, /taskTurnRecord\.kind = 'task-result'/);
  assert.match(serverModules, /busAttach\(sid, res, \{ replay: url\.searchParams\.get\('replay'\) !== '0' \}\)/);
  assert.match(appModules, /\/stream\?replay=0/);
});

test('agent rate-limit failures are persisted and surfaced in conversation history', () => {
  assert.match(serverModules, /normalizeAgentFailure\(agentKey, detail \|\| `exit code \$\{code\}`/);
  assert.match(serverModules, /type: 'error',[\s\S]*?retryable: Boolean\(err\.retryable\)/);
  assert.match(serverModules, /taskTurnRecord\.kind = 'task-error'/);
  assert.match(serverModules, /sseSend\(workflowRes, 'part', errorPart\)/);
});

test('deleting the final conversation leaves one hidden draft instead of an undeletable visible loop', () => {
  assert.match(serverModules, /newSession\('', \{ ephemeral: true \}\)/);
  assert.match(serverModules, /sessions\.filter\(s => !s\.ephemeral\)\.map/);
  assert.match(serverModules, /session\.ephemeral = false/);
  assert.match(appModules, /document\.querySelectorAll\('\.undo-toast'\)/);
  assert.match(appModules, /myteam\.hiddenDraftSessionId/);
  assert.match(appModules, /deletingLastVisibleSession/);
});

test('open questions pause dispatch and move into an input-adjacent clarification flow', () => {
  assert.match(serverModules, /status: Array\.isArray\(task\.open_questions\).*'waiting_input'/);
  assert.match(serverModules, /pathname === '\/api\/tasks\/clarify'/);
  assert.match(serverModules, /code: 'clarification_required'/);
  assert.match(appModules, /function renderClarificationTray\(/);
  assert.match(appModules, /确认并继续执行/);
  assert.match(appModules, /input type="radio" name="clarification-/);
  assert.match(appModules, /clarification-other-input/);
  assert.match(appModules, /suggestClarificationOptions/);
  assert.doesNotMatch(appModules, /id="clarificationOther"/);
  assert.doesNotMatch(appModules, /<div><b>待确认：<\/b>/);
});

test('bulk task selection is reconciled with the currently visible task set', () => {
  assert.match(appModules, /function reconcileBulkSelection\(visibleTasks = \[\]\)/);
  assert.match(appModules, /if \(!visibleIds\.has\(id\)\) selectedTaskIds\.delete\(id\)/);
  assert.match(appModules, /reconcileBulkSelection\(filtered\);\s*renderTasks\(filtered\)/);
});

test('review protocol failures preserve Agent output, halt the workflow, and retry only Reviewer', () => {
  assert.match(serverModules, /attempt <= 2/);
  assert.match(serverModules, /task-review-retrying/);
  assert.match(serverModules, /verdict: 'review_error'/);
  assert.match(serverModules, /review_status: 'failed'/);
  assert.match(serverModules, /review_only_pending: true/);
  assert.match(serverModules, /retry-review/);
  assert.match(appModules, /只重试 Reviewer/);
  assert.doesNotMatch(serverModules, /已加入内部验收修复队列/);
});
