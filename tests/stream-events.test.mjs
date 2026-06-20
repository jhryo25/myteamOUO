import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PARSERS, resolveAgentParser } from '../agent-utils.mjs';

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

test('agent variants inherit the parser for their base CLI', () => {
  assert.equal(resolveAgentParser('kimi-plan', { path: 'C:/tools/kimi.exe' }), PARSERS.kimi);
  assert.equal(resolveAgentParser('reviewer', { path: 'C:/tools/claude.exe' }), PARSERS.claude);
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
  const openHtml = source.match(/async function openLocalHtml\([\s\S]*?\n}\n\nchatEl/);
  assert.ok(openHtml, 'openLocalHtml flow should exist');
  assert.match(openHtml[0], /showToast\(/);
  assert.doesNotMatch(openHtml[0], /addSystemMsg\(/);
  assert.match(source, /resume: isResume/);
  assert.match(source, /function renderSessionRecovery\(/);
  assert.match(source, /function loadArtifacts\(/);
});
