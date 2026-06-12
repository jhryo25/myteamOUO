// myteam dispatch 命令
// 读取 tasks.jsonl 中 pending 任务，按 agent 字段分发给 Claude/Codex 执行，结果写回
// 用法：node dispatch.mjs [--run-id <id>] [--task-id <id>] [--agent codex|claude]

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { loadEnv, buildCliConfig, invokeAgent, readTasks, writeAllTasks, buildExecPrompt } from './agent-utils.mjs';

const ENV = loadEnv();
const CLI_CONFIG = buildCliConfig(ENV);

const TASKS_FILE = '.myteam/tasks.jsonl';

// ── tasks.jsonl 辅助函数 ──────────────────────────────────────────
function updateTask(tasks, id, patch) {
  return tasks.map(t => t.id === id ? { ...t, ...patch } : t);
}

// ── 执行单条任务 ──────────────────────────────────────────────
async function execTask(task, agentOverride) {
  const agentKey = agentOverride || task.agent || 'codex';
  const effectiveAgent = CLI_CONFIG[agentKey] ? agentKey : 'codex';

  if (!CLI_CONFIG[effectiveAgent]?.path) {
    return { success: false, error: `${effectiveAgent} 路径未配置` };
  }

  const prompt = buildExecPrompt(task);
  console.log(`  → 调用 ${effectiveAgent}...`);

  try {
    const result = await invokeAgent(CLI_CONFIG, effectiveAgent, prompt);
    return { success: true, result, agent: effectiveAgent };
  } catch (err) {
    return { success: false, error: err.message, agent: effectiveAgent };
  }
}

// ── 解析参数 ──────────────────────────────────────────────────
const args = process.argv.slice(2);
let filterRunId = null;
let filterTaskId = null;
let agentOverride = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--run-id' && args[i + 1])   filterRunId  = args[++i];
  if (args[i] === '--task-id' && args[i + 1])  filterTaskId = args[++i];
  if (args[i] === '--agent' && args[i + 1])    agentOverride = args[++i];
}

// ── 主流程 ────────────────────────────────────────────────────
let tasks = readTasks();
if (!tasks.length) {
  console.error(`找不到 ${TASKS_FILE}，请先运行 plan 命令。`);
  process.exit(1);
}

// 筛选要执行的任务
let pending = tasks.filter(t => t.status === 'pending');
if (filterRunId)  pending = pending.filter(t => t.run_id  === filterRunId);
if (filterTaskId) pending = pending.filter(t => t.id      === filterTaskId);

if (!pending.length) {
  console.log('没有待执行的 pending 任务。');
  if (filterRunId)  console.log(`  run_id: ${filterRunId}`);
  if (filterTaskId) console.log(`  task_id: ${filterTaskId}`);
  process.exit(0);
}

console.log(`\n开始执行 ${pending.length} 条任务...\n`);

let done = 0, failed = 0;

for (const task of pending) {
  console.log(`[${task.id}] ${task.title}`);

  // 标记 in_progress
  tasks = updateTask(tasks, task.id, { status: 'in_progress', started_at: new Date().toISOString() });
  writeAllTasks(tasks);

  const { success, result, error, agent } = await execTask(task, agentOverride);

  if (success) {
    tasks = updateTask(tasks, task.id, {
      status: 'done',
      finished_at: new Date().toISOString(),
      executed_by: agent,
      result: result?.slice(0, 2000), // 截断避免 jsonl 过大
    });
    console.log(`  ✓ 完成\n`);
    done++;
  } else {
    tasks = updateTask(tasks, task.id, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      executed_by: agent,
      error,
    });
    console.error(`  ✗ 失败：${error}\n`);
    failed++;
  }

  writeAllTasks(tasks);
}

console.log(`\n执行完毕：${done} 成功 / ${failed} 失败`);
console.log('运行 `python myteam.py ui` 刷新验收页面。');
