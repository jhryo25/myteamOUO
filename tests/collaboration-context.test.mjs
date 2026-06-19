import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  ensurePlanSchemaFile,
  parseStructuredPlanOutput,
  buildContinuityCapsule,
  formatContinuityBridge,
  buildTopKEvidenceBridge,
  buildWorkspaceBridge,
  parseSpawnSubagentDirectives,
  createSubagentRun,
  updateSubagentRun,
  listSubagentRuns,
  recoverStaleSubagentRuns,
  appendSubagentMessage,
  listSubagentMessages,
} from '../collaboration-context.mjs';
import { readAgentRegistry, selectRunnableAgent } from '../agent-utils.mjs';

const samplePlan = {
  goal: '完成协作上下文',
  tasks: [{
    title: '实现 capsule',
    why: '保持跨 agent 连续性',
    tradeoff: '',
    open_questions: [],
    steps: ['新增模块', '接入 server'],
    accept: '测试通过',
    agent: 'codex',
  }],
};

test('structured plan accepts native and compatibility envelopes', () => {
  const native = parseStructuredPlanOutput(JSON.stringify(samplePlan), { allowedAgents: ['codex'] });
  assert.equal(native.ok, true);
  assert.equal(native.mode, 'native');
  assert.equal(native.data.tasks[0].agent, 'codex');

  const fence = String.fromCharCode(96).repeat(3);
  const compat = parseStructuredPlanOutput('说明\n' + fence + 'json\n' + JSON.stringify(samplePlan) + '\n' + fence);
  assert.equal(compat.ok, true);
  assert.equal(compat.mode, 'compat');
});

test('structured plan does not truncate long JSON candidates', () => {
  const longPlan = {
    ...samplePlan,
    tasks: [{
      ...samplePlan.tasks[0],
      why: 'x'.repeat(600),
      steps: Array.from({ length: 8 }, (_, index) => 'step-' + index + '-' + 'y'.repeat(80)),
    }],
  };
  const result = parseStructuredPlanOutput(JSON.stringify(longPlan));
  assert.equal(result.ok, true);
  assert.equal(result.data.tasks[0].why.length, 400);
});

test('structured plan rejects invalid task counts and normalizes agents', () => {
  const tooMany = parseStructuredPlanOutput(JSON.stringify({
    goal: 'x',
    tasks: Array.from({ length: 8 }, (_, index) => ({ ...samplePlan.tasks[0], title: 't' + index })),
  }));
  assert.equal(tooMany.ok, false);

  const fallback = parseStructuredPlanOutput(JSON.stringify({
    ...samplePlan,
    tasks: [{ ...samplePlan.tasks[0], agent: 'unknown' }],
  }), { defaultAgent: 'kimi', allowedAgents: ['kimi'] });
  assert.equal(fallback.data.tasks[0].agent, 'kimi');
});

test('continuity capsule and top-k evidence preserve useful task state', () => {
  const history = [
    { role: 'user', text: '必须修复 server.mjs 的 timeout，并保持兼容。' },
    { role: 'assistant', text: '已修复 server.mjs，下一步运行 node --check server.mjs。' },
    { role: 'system', text: 'error timeout in server.mjs' },
  ];
  const capsule = buildContinuityCapsule({ sessionId: 's1', history });
  const bridge = formatContinuityBridge(capsule);
  assert.match(bridge, /Current objective/);
  assert.match(bridge, /server\.mjs/);
  assert.ok(capsule.userConstraints.length > 0);

  const evidence = buildTopKEvidenceBridge({
    query: 'server.mjs timeout',
    history,
    capsule,
  });
  assert.match(evidence, /retrieved evidence/);
  assert.match(evidence, /timeout/);
});

test('workspace bridge reports repository state', () => {
  const bridge = buildWorkspaceBridge({ workspace: process.cwd() });
  assert.match(bridge, /workspace bridge/);
  assert.match(bridge, /Git status/);
});

test('spawn_subagent protocol parses only allowed agents', () => {
  const text = [
    '<spawn_subagent>{"agent":"claude","task":"review server","label":"review","accept":"pass"}</spawn_subagent>',
    '<spawn_subagent>{"agent":"unknown","task":"ignore"}</spawn_subagent>',
  ].join('\n');
  const directives = parseSpawnSubagentDirectives(text, ['claude']);
  assert.equal(directives.length, 1);
  assert.equal(directives[0].task, 'review server');
});

test('subagent lifecycle and messages persist in jsonl', () => {
  const dir = mkdtempSync(join(tmpdir(), 'myteam-context-'));
  const runsFile = join(dir, 'runs.jsonl');
  const messagesFile = join(dir, 'messages.jsonl');
  try {
    const run = createSubagentRun({
      parentSessionId: 's1',
      parentTaskId: 't0',
      taskId: 't1',
      agent: 'claude',
      task: 'review',
    }, runsFile);
    appendSubagentMessage(run.id, { type: 'assistant', content: 'done' }, messagesFile);
    assert.equal(recoverStaleSubagentRuns(runsFile), 1);
    assert.equal(listSubagentRuns('s1', runsFile)[0].status, 'error');
    updateSubagentRun(run.id, { status: 'done', finishedAt: Date.now() }, runsFile);
    assert.equal(listSubagentRuns('s1', runsFile)[0].status, 'done');
    assert.equal(listSubagentMessages(run.id, messagesFile)[0].content, 'done');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan schema is materialized for codex output-schema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'myteam-schema-'));
  try {
    const file = ensurePlanSchemaFile(join(dir, 'plan.schema.json'));
    const schema = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(schema.properties.tasks.maxItems, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Kimi 0.14 invocation template omits removed --print flag', () => {
  const dir = mkdtempSync(join(tmpdir(), 'myteam-kimi-config-'));
  const file = join(dir, 'agents.json');
  try {
    const defaults = readAgentRegistry({}, join(dir, 'missing.json'));
    const defaultKimi = defaults.find((agent) => agent.key === 'kimi');
    assert.equal(defaultKimi.argsTemplate, '--prompt {prompt} --output-format stream-json');

    writeFileSync(file, JSON.stringify({
      agents: [{ key: 'kimi', argsTemplate: '--print --output-format stream-json --prompt {prompt}' }],
    }), 'utf8');
    const migratedKimi = readAgentRegistry({}, file).find((agent) => agent.key === 'kimi');
    assert.equal(migratedKimi.argsTemplate.includes('--print'), false);
    assert.match(migratedKimi.argsTemplate, /--prompt \{prompt\}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan agent selection falls back to the first launchable CLI', () => {
  const statuses = [
    { key: 'codex', available: false, error: 'missing' },
    { key: 'claude', available: false, error: 'missing' },
    { key: 'kimi', available: true, error: '' },
  ];
  assert.equal(selectRunnableAgent(statuses, 'codex').key, 'kimi');
  assert.equal(selectRunnableAgent(statuses, '').key, 'kimi');
});
