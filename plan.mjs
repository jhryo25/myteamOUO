// myteam plan 命令
// 用法：node plan.mjs "目标描述" [--agent codex|claude|kimi]

import { appendFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { loadEnv, buildCliConfig, invokeAgent, extractJson, validatePlanResult, AGENT_KEYS } from './agent-utils.mjs';

const ENV = loadEnv();
const CLI_CONFIG = buildCliConfig(ENV);

const SYSTEM_PROMPT = `你是 myteam 的任务规划 agent。
用户会给你一个目标，把它拆成 3-7 个可执行、可验收的小任务。

严格按以下 JSON 格式返回，不要有任何额外解释或 markdown 包裹：
{
  "goal": "<原始目标>",
  "tasks": [
    {
      "title": "<任务标题>",
      "steps": ["<步骤1>", "<步骤2>"],
      "accept": "<验收标准>",
      "agent": "<推荐执行者: claude|codex|kimi>"
    }
  ]
}`;

function writeTasks(goal, tasks, agentKey) {
  const tasksFile = '.myteam/tasks.jsonl';
  const runId = randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  let written = 0;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const record = {
      id: `${runId}-${i + 1}`,
      run_id: runId,
      created_at: now,
      goal,
      title: t.title ?? `任务 ${i + 1}`,
      steps: t.steps ?? [],
      accept: t.accept ?? '',
      agent: t.agent ?? agentKey,
      status: 'pending',
    };
    appendFileSync(tasksFile, JSON.stringify(record) + '\n', 'utf8');
    written++;
  }
  return { runId, written };
}

// ── 解析参数 ──────────────────────────────────────────────────
const args = process.argv.slice(2);
let agentKey = 'codex';
const goalParts = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--agent' && args[i + 1]) agentKey = args[++i];
  else goalParts.push(args[i]);
}
const goal = goalParts.join(' ').trim();

if (!goal) {
  console.error(`用法: node plan.mjs "目标描述" [--agent ${AGENT_KEYS.join('|')}]`);
  process.exit(1);
}
if (!AGENT_KEYS.includes(agentKey)) {
  console.error(`未知 agent: ${agentKey}，可选：${AGENT_KEYS.join(' / ')}`);
  process.exit(1);
}

// ── 主流程 ────────────────────────────────────────────────────
console.log(`正在调用 ${agentKey} 拆分任务，请稍候...\n目标：${goal}\n`);

let rawOutput;
try {
  rawOutput = await invokeAgent(CLI_CONFIG, agentKey, `${SYSTEM_PROMPT}\n\n用户目标：${goal}`);
} catch (err) {
  console.error(`\n调用失败：${err.message}`);
  process.exit(1);
}

if (!rawOutput?.trim()) {
  console.error('\nagent 无输出，请重试。');
  process.exit(1);
}

const data = extractJson(rawOutput);
// 教训2: 严格验证，防止幻觉数据写入
const validation = validatePlanResult(data);
if (!validation.ok) {
  console.error(`\n无法从输出中解析有效任务列表（${validation.reason}），原始输出：`);
  console.error(rawOutput.slice(0, 800));
  process.exit(1);
}

const { runId, written } = writeTasks(goal, data.tasks, agentKey);
console.log(`\n已写入 ${written} 条任务 → .myteam/tasks.jsonl（run_id: ${runId}）`);
console.log('\n任务列表：');
data.tasks.forEach((t, i) => {
  console.log(`  [${i + 1}] ${t.title}  （推荐：${t.agent ?? agentKey}）`);
  (t.steps ?? []).forEach(s => console.log(`       · ${s}`));
  if (t.accept) console.log(`       ✓ 验收：${t.accept}`);
});
console.log('\n运行 `python myteam.py ui` 刷新验收页面。');
