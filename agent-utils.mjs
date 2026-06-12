// myteam 公共 Agent 调用工具
// plan.mjs / dispatch.mjs 均 import 此文件

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { readFileSync, existsSync } from 'fs';

// ── .env 读取 ─────────────────────────────────────────────────
export function loadEnv(envPath = '.env') {
  if (!existsSync(envPath)) return {};
  const result = {};
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [k, ...rest] = line.split('=');
    result[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
  return result;
}

// ── CLI 配置工厂（接受已解析的 ENV） ─────────────────────────
export function buildCliConfig(ENV) {
  return {
    codex: {
      path: ENV.CODEX_PATH,
      args: () => ['exec', '-', '--json', '--skip-git-repo-check'],
      spawnOptions: { stdio: ['pipe', 'pipe', 'pipe'] },
    },
    claude: {
      path: ENV.CLAUDE_PATH,
      args: () => ['-p', '-', '--output-format', 'stream-json', '--verbose'],
      spawnOptions: { stdio: ['pipe', 'pipe', 'pipe'] },
    },
  };
}

// ── NDJSON 解析器 ─────────────────────────────────────────────
function parseClaude(line) {
  try {
    const e = JSON.parse(line);
    if (e.type === 'assistant') {
      return (e.message?.content ?? [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('') || null;
    }
  } catch {}
  return null;
}

function parseCodex(line) {
  try {
    const e = JSON.parse(line);
    if (e.type === 'item.completed' && e.item?.text) return e.item.text;
  } catch {}
  return null;
}

export const PARSERS = { codex: parseCodex, claude: parseClaude };

// ── Agent 调用（stdin pipe，支持 .cmd 自动中转 cmd.exe） ───────
// 教训1 (02-cli-engineering): readline 接管 stdout 后 child.stdout.on('data') 不再触发。
//   watchdog 必须在 rl.on('line') 和 stderr.on('data') 里刷新，不能只靠 stdout 流。
// 教训1: 超时时间 30min，匹配复杂任务（代码分析/长篇写作）实际需要。
export function invokeAgent(CLI_CONFIG, agentKey, prompt, { silent = false, timeoutMs = 30 * 60 * 1000 } = {}) {
  const cfg = CLI_CONFIG[agentKey];
  if (!cfg?.path) throw new Error(`${agentKey} 路径未在 .env 中配置（${agentKey.toUpperCase()}_PATH）`);

  const parser = PARSERS[agentKey];

  const isCmd = cfg.path.toLowerCase().endsWith('.cmd');
  const spawnPath = isCmd ? 'cmd.exe' : cfg.path;
  const spawnArgs = isCmd ? ['/c', cfg.path, ...cfg.args()] : cfg.args();

  return new Promise((resolve, reject) => {
    const child = spawn(spawnPath, spawnArgs, cfg.spawnOptions);

    child.stdin.write(prompt, 'utf8');
    child.stdin.end();

    let fullText = '';
    let lastActivity = Date.now();
    // 教训1: 只靠 stdout 会漏掉 thinking/工具调用期间的 stderr 活跃信号
    const touch = () => { lastActivity = Date.now(); };

    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > timeoutMs) {
        child.kill('SIGTERM');
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 3000);
        clearInterval(watchdog);
        reject(new Error(`timeout after ${timeoutMs / 60000}min`));
      }
    }, 10_000);

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      touch(); // 教训1: readline 接管后在这里刷新 watchdog
      if (!line.trim()) return;
      const text = parser(line);
      if (text) {
        if (!silent) process.stdout.write(text);
        fullText += text;
      }
    });

    child.stderr?.on('data', (data) => {
      touch(); // 教训1: stderr 也是活跃信号（thinking/工具调用输出在这里）
      const msg = data.toString();
      if (msg.includes('Reading additional input')) return;
      if (!silent) process.stderr.write(`[stderr] ${msg}`);
    });

    child.on('close', (code) => {
      clearInterval(watchdog);
      if (!silent) process.stdout.write('\n');
      if (code !== 0) reject(new Error(`exit code ${code}`));
      else resolve(fullText);
    });
  });
}

// ── JSON 提取 + 幻觉限制验证 ─────────────────────────────────
// 教训2 (02-cli-engineering): AI 会产生幻觉，解析结果要做二次验证。
export function extractJson(text) {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
  const m = cleaned.match(/\{[\s\S]+\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// 教训2: 对 plan 结果做严格验证，tasks 非空且每条必含 title，防止幻觉写入
export function validatePlanResult(data) {
  if (!data || typeof data !== 'object') return { ok: false, reason: '返回值不是对象' };
  if (!Array.isArray(data.tasks) || data.tasks.length === 0) return { ok: false, reason: 'tasks 数组为空或缺失' };
  for (let i = 0; i < data.tasks.length; i++) {
    const t = data.tasks[i];
    if (!t || typeof t !== 'object') return { ok: false, reason: `tasks[${i}] 不是对象` };
    if (!t.title || typeof t.title !== 'string' || !t.title.trim()) {
      return { ok: false, reason: `tasks[${i}] 缺少 title 字段` };
    }
  }
  return { ok: true };
}
