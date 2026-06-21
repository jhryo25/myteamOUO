// myteam CLI dispatch — 与服务端共享 LangGraph workflow engine
// 用法：node dispatch.mjs [--run-id <id>] [--task-id <id>] [--agent codex|claude|kimi]

import { randomUUID } from 'node:crypto';
import {
  appendTask,
  buildCliConfig,
  buildExecPrompt,
  buildReviewPrompt,
  extractJson,
  invokeAgent,
  loadEnv,
  readTasks,
} from './agent-utils.mjs';
import { parseSpawnSubagentDirectives, SPAWN_SUBAGENT_PROTOCOL } from './collaboration-context.mjs';
import { repository } from './storage.mjs';
import { transitionTaskLifecycle } from './workflow-state.mjs';
import { getSharedCheckpointer } from './workflow/checkpointer.mjs';
import { LangGraphDispatchEngine } from './workflow/dispatch-graph.mjs';

const CLI_CONFIG = buildCliConfig(loadEnv());
const args = process.argv.slice(2);
let filterRunId = '';
let filterTaskId = '';
let agentOverride = '';

for (let index = 0; index < args.length; index++) {
  if (args[index] === '--run-id' && args[index + 1]) filterRunId = args[++index];
  if (args[index] === '--task-id' && args[index + 1]) filterTaskId = args[++index];
  if (args[index] === '--agent' && args[index + 1]) agentOverride = args[++index];
}

let pending = readTasks().filter((task) => task.status === 'pending');
if (filterRunId) pending = pending.filter((task) => task.run_id === filterRunId);
if (filterTaskId) pending = pending.filter((task) => task.id === filterTaskId);

if (!pending.length) {
  console.log('没有符合条件的 pending 任务。');
  process.exit(0);
}

const configuredAgents = Object.entries(CLI_CONFIG)
  .filter(([, config]) => config?.path)
  .map(([key]) => key);

function resolveAgent(task) {
  if (agentOverride && CLI_CONFIG[agentOverride]?.path) return agentOverride;
  if (CLI_CONFIG[task.agent]?.path) return task.agent;
  return configuredAgents[0] || task.agent || 'codex';
}

const ports = {
  emit(event, data) {
    if (event === 'task-start') console.log(`[${data.id}] ${data.title}`);
    if (event === 'task-review-done') console.log(`  review: ${data.verdict || 'unknown'}`);
    if (event === 'task-failed') console.error(`  failed: ${data.error}`);
    if (event === 'worklist-chain') console.log(`  spawn: ${data.from} -> ${data.to}`);
  },
  async transitionTask(task, nextState, meta) {
    const latest = readTasks().find((item) => item.id === task.id) || task;
    const updated = transitionTaskLifecycle(latest, nextState, meta);
    repository.upsert('tasks', updated);
    return updated;
  },
  async executeTask(task) {
    const agent = resolveAgent(task);
    if (!CLI_CONFIG[agent]?.path) throw new Error(`${agent} 路径未配置`);
    const prompt = `${buildExecPrompt(task)}\n\n【子代理派生协议】\n${SPAWN_SUBAGENT_PROTOCOL}`;
    const result = await invokeAgent(CLI_CONFIG, agent, prompt);
    return {
      result,
      agent,
      artifacts: [],
      spawnRequests: parseSpawnSubagentDirectives(result, Object.keys(CLI_CONFIG)),
    };
  },
  async reviewTask(task, execution) {
    const reviewer = configuredAgents.find((key) => key !== execution.agent)
      || configuredAgents.find((key) => key === execution.agent);
    if (!reviewer) return { verdict: 'skipped', reason: '没有可用 reviewer' };
    const raw = await invokeAgent(
      CLI_CONFIG,
      reviewer,
      buildReviewPrompt(task, execution.agent, execution.result),
      { silent: true, timeoutMs: 5 * 60 * 1000 },
    );
    const parsed = extractJson(raw || '');
    if (!parsed || !['pass', 'rework'].includes(parsed.verdict)) {
      return { verdict: 'skipped', reviewer, reason: 'reviewer 输出无法解析' };
    }
    return { ...parsed, reviewer };
  },
  async materializeSpawns(parent, requests) {
    return requests
      .filter((request) => request.agent && request.agent !== parent.agent)
      .map((request) => appendTask({
        id: `${parent.run_id}-w${randomUUID().slice(0, 8)}`,
        run_id: parent.run_id,
        session_id: parent.session_id,
        created_at: new Date().toISOString(),
        goal: parent.goal,
        title: request.label || request.task,
        why: '由 LangGraph CLI workflow 派生',
        steps: [request.task],
        accept: request.accept || '',
        agent: request.agent,
        status: 'pending',
        phase: 'pending',
        parent_task_id: parent.id,
        chain_depth: Number(parent.chain_depth || 0) + 1,
        spawn_protocol: 'spawn_subagent',
      }));
  },
};

const workflowRunId = `dispatch-cli:${filterRunId || randomUUID()}:${Date.now()}`;
const engine = new LangGraphDispatchEngine(ports, { checkpointer: getSharedCheckpointer() });
const snapshot = await engine.run({
  workflowRunId,
  sessionId: pending[0]?.session_id || '',
  tasks: pending,
  options: { maxReworkAttempts: 1, maxSpawnDepth: 2, requireHumanGate: false },
});

console.log(`执行完毕：${snapshot.values.completedTaskIds.length} 成功 / ${snapshot.values.failedTaskIds.length} 失败`);
console.log(`workflow: ${workflowRunId}`);
