// myteam plan 命令
// 用法：node plan.mjs "目标描述" [--agent codex|claude|kimi]

import { appendFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { loadEnv, buildCliConfig, invokeAgent, extractJson, validatePlanResult, AGENT_KEYS, PLAN_PROMPT } from './agent-utils.mjs';

const ENV = loadEnv();
const CLI_CONFIG = buildCliConfig(ENV);

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
      // 五件套（对齐 clowder-ai cross-cat-handoff）
      why: t.why ?? '',
      tradeoff: t.tradeoff ?? '',
      open_questions: Array.isArray(t.open_questions) ? t.open_questions : [],
      steps: t.steps ?? [],
      accept: t.accept ?? '',
      agent: t.agent ?? agentKey,
      status: 'pending',
      phase: 'pending', // SOP 状态机初始阶段
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
  rawOutput = await invokeAgent(CLI_CONFIG, agentKey, `${PLAN_PROMPT}\n\n用户目标：${goal}`);
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
  if (t.why)      console.log(`       Why: ${t.why}`);
  if (t.tradeoff) console.log(`       Tradeoff: ${t.tradeoff}`);
  (t.open_questions ?? []).forEach(q => console.log(`       ? ${q}`));
  (t.steps ?? []).forEach(s => console.log(`       · ${s}`));
  if (t.accept) console.log(`       ✓ 验收：${t.accept}`);
});
console.log('\n运行 `python myteam.py ui` 刷新验收页面。');
