import test from 'node:test';
import assert from 'node:assert/strict';

import { PARSERS } from '../agent-utils.mjs';

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
  }]);

  const completed = PARSERS.kimi(JSON.stringify({
    role: 'tool',
    tool_call_id: 'tool-read-1',
    content: 'line one\nline two\n<system>Total lines in file: 32</system>',
  }));
  assert.deepEqual(completed.activities, [{
    id: 'tool-read-1', phase: 'completed', name: '', summary: '返回 32 行',
  }]);
});

test('Kimi parser keeps normal assistant output unchanged', () => {
  const output = PARSERS.kimi(JSON.stringify({ role: 'assistant', content: '完成。' }));
  assert.equal(output.text, '完成。');
  assert.equal(output.thinking, '');
  assert.deepEqual(output.activities, []);
});
