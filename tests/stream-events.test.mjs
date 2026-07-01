import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isTransientKimiSessionFailure, normalizeAgentFailure, parseReviewResult, parsedAgentOutputText, PARSERS, resolveAgentParser } from '../agent-utils.mjs';

test('Kimi parser exposes tool start and completion as live activities', () => {
  const started = PARSERS.kimi(JSON.stringify({
    role: 'assistant',
    tool_calls: [{
      type: 'function',
      id: 'tool-read-1',
      function: { name: 'Read', arguments: JSON.stringify({ path: 'package.json' }) },
    }],
  }));
  assert.deepEqual(started.activities, [{
    id: 'tool-read-1', phase: 'started', name: 'Read', summary: 'package.json',
    input: { path: 'package.json' },
  }]);

  const completed = PARSERS.kimi(JSON.stringify({
    role: 'tool',
    tool_call_id: 'tool-read-1',
    content: 'line one\nline two\n<system>Total lines in file: 32</system>',
  }));
  assert.deepEqual(completed.activities, [{
    id: 'tool-read-1', phase: 'completed', name: '', summary: '返回 32 行',
    output: 'line one\nline two\n<system>Total lines in file: 32</system>',
  }]);
});

test('Kimi parser keeps normal assistant output unchanged', () => {
  const output = PARSERS.kimi(JSON.stringify({ role: 'assistant', content: '完成。' }));
  assert.equal(output.text, '完成。');
  assert.equal(output.thinking, '');
  assert.deepEqual(output.activities, []);
});

test('Kimi 429 errors are normalized into a retryable user-facing failure', () => {
  assert.throws(
    () => PARSERS.kimi(JSON.stringify({ type: 'error', error: { message: 'HTTP 429 Too Many Requests' } })),
    /429/,
  );
  const failure = normalizeAgentFailure('kimi', 'APIError: status 429, rate_limit_exceeded', 1);
  assert.deepEqual(failure, {
    code: 'rate_limited',
    httpStatus: 429,
    retryable: true,
    message: 'Kimi 请求过于频繁（HTTP 429），本次执行已暂停。请稍后重试。',
    detail: 'APIError: status 429, rate_limit_exceeded',
    exitCode: 1,
  });
});

test('Kimi session mkdir EPERM is the only startup filesystem failure eligible for retry', () => {
  const cfg = { path: 'C:\\Users\\Administrator\\.kimi-code\\bin\\kimi.exe' };
  assert.equal(isTransientKimiSessionFailure('kimi', "EPERM: operation not permitted, mkdir 'C:\\Users\\Administrator\\.kimi-code\\sessions\\wd_myteam\\session_1'", cfg), true);
  assert.equal(isTransientKimiSessionFailure('kimi', 'EPERM: operation not permitted, unlink report.json', cfg), false);
  assert.equal(isTransientKimiSessionFailure('claude', "EPERM: operation not permitted, mkdir 'C:\\Users\\Administrator\\.kimi-code\\sessions\\session_1'", { path: 'claude.exe' }), false);
});

test('agent variants inherit the parser for their base CLI', () => {
  assert.equal(resolveAgentParser('kimi-plan', { path: 'C:/tools/kimi.exe' }), PARSERS.kimi);
  assert.equal(resolveAgentParser('reviewer', { path: 'C:/tools/claude.exe' }), PARSERS.claude);
});

test('silent Agent calls collect structured parser text instead of coercing objects', () => {
  const parsed = PARSERS.kimi(JSON.stringify({ role: 'assistant', content: '{"verdict":"pass"}' }));
  assert.equal(parsedAgentOutputText(parsed), '{"verdict":"pass"}');
  assert.notEqual(parsedAgentOutputText(parsed), '[object Object]');
  assert.equal(parseReviewResult('```json\n{"verdict":"PASS","findings":[]}\n```').verdict, 'pass');
  assert.equal(parseReviewResult('verdict: rework\nsuggestion: fix it').verdict, 'rework');
  assert.equal(parseReviewResult('{"verdict":"pass","score":95}').score, 95);
});

test('plan UI keeps structured JSON out of the assistant text bubble', () => {
  const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const planFlow = source.match(/async function doPlan\([\s\S]*?\/\/ ── dispatch/);
  assert.ok(planFlow, 'doPlan flow should exist');
  assert.match(planFlow[0], /chunk: \(\{ text \}\) => \{ updatePlanProgress\(\)/);
  assert.doesNotMatch(planFlow[0], /chunk: \(\{ text \}\) => \{ appendTyping\(/);
  assert.match(source, /function renderPlanTaskDetail\(/);
});

test('file errors use toast UI and interrupted chat exposes resume action', () => {
  const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const openHtml = source.match(/async function openLocalHtml\([\s\S]*?\r?\n}\r?\n\r?\nchatEl/);
  assert.ok(openHtml, 'openLocalHtml flow should exist');
  assert.match(openHtml[0], /showToast\(/);
  assert.doesNotMatch(openHtml[0], /addSystemMsg\(/);
  assert.match(source, /resume: isResume/);
  assert.match(source, /function renderSessionRecovery\(/);
  assert.match(source, /function loadArtifacts\(/);
});

test('LangGraph workflow UI renders checkpoint, resume, and failed-node retry controls', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../web/app.css', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(app, /function renderWorkflowCard\(/);
  assert.match(app, /Checkpoint 状态/);
  assert.match(app, /data-workflow-action="pass"/);
  assert.match(app, /data-workflow-action="rework"/);
  assert.match(app, /data-workflow-action="retry"/);
  assert.match(app, /function restoreWorkflowCard\(/);
  assert.match(app, /humanGate: dispatchOptions\.humanGate \?\? (true|false)/);
  assert.match(app, /\/api\/workflows\/\$\{encodeURIComponent\(resumeWorkflowId\)\}\/resume/);
  assert.match(server, /const filterTaskIds = new Set/);
  assert.match(server, /pending = pending\.filter\(t => filterTaskIds\.has/);
  assert.match(css, /\.workflow-card\.paused/);
  assert.match(css, /\.workflow-checkpoint-grid/);
});
