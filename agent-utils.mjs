// myteam 公共 Agent 调用工具
// plan.mjs / dispatch.mjs / server.mjs 均 import 此文件

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';

export const AGENT_KEYS = ['codex', 'claude', 'kimi'];
export const AGENTS_FILE = '.myteam/agents.json';

const DEFAULT_AGENT_DEFS = [
  {
    key: 'codex',
    label: 'Codex',
    emoji: '🤖',
    desc: '总控 / 审查 / 自迭代',
    envKey: 'CODEX_PATH',
    inputMode: 'stdin',
    argsTemplate: 'exec - --json --skip-git-repo-check',
    checkTemplate: '--help',
    roleDescription: '任务规划、代码审查、自迭代协调者',
    personality: '严谨、务实、追求代码质量，习惯先问清楚需求再动手',
    strengths: ['任务拆解', '代码审查', '进度协调'],
    restrictions: [],
  },
  {
    key: 'claude',
    label: 'Claude',
    emoji: '✦',
    desc: '主架构 / 深度实现',
    envKey: 'CLAUDE_PATH',
    inputMode: 'stdin',
    argsTemplate: '-p - --output-format stream-json --verbose',
    checkTemplate: '--help',
    roleDescription: '深度分析、系统架构设计、复杂代码生成',
    personality: '善于推理、思维发散、喜欢先理解全局再落地细节',
    strengths: ['架构设计', '复杂推理', '长文档生成'],
    restrictions: [],
  },
  {
    key: 'kimi',
    label: 'Kimi',
    emoji: '🌙',
    desc: '轻量执行 / 快速草稿',
    envKey: 'KIMI_PATH',
    inputMode: 'arg',
    argsTemplate: '--print --output-format stream-json --prompt {prompt}',
    checkTemplate: '--help',
    roleDescription: '快速执行、轻量任务、草稿生成',
    personality: '高效、简洁、直接给出结果，不绕弯子',
    strengths: ['快速执行', '简单任务', '草稿生成'],
    restrictions: [],
  },
];

export function sanitizeAgentKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function splitArgs(template, prompt = '') {
  const text = String(template || '').trim();
  if (!text) return [];
  // 先拆模板再替换 prompt，避免长 prompt 被空格拆成多个 CLI 参数。
  return text
    .match(/"([^"]*)"|'([^']*)'|\S+/g)
    ?.map(part => part.replace(/^["']|["']$/g, '').replaceAll('{prompt}', prompt)) || [];
}

export function readAgentRegistry(ENV = loadEnv(), file = AGENTS_FILE) {
  let saved = [];
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      saved = Array.isArray(data.agents) ? data.agents : [];
    } catch {
      saved = [];
    }
  }

  const byKey = new Map(DEFAULT_AGENT_DEFS.map(agent => [agent.key, { ...agent }]));
  for (const raw of saved) {
    const key = sanitizeAgentKey(raw.key);
    if (!key) continue;
    const base = byKey.get(key) || {};
    byKey.set(key, {
      ...base,
      ...raw,
      key,
      label: raw.label || base.label || key,
      emoji: raw.emoji || base.emoji || '●',
      desc: raw.desc || base.desc || '',
      inputMode: raw.inputMode === 'stdin' ? 'stdin' : 'arg',
      argsTemplate: raw.argsTemplate || base.argsTemplate || '-p {prompt}',
      checkTemplate: raw.checkTemplate || base.checkTemplate || '--help',
      envKey: raw.envKey || base.envKey || `${key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_PATH`,
      removable: raw.removable ?? !AGENT_KEYS.includes(key),
      // 角色卡字段
      roleDescription: raw.roleDescription ?? base.roleDescription ?? '',
      personality: raw.personality ?? base.personality ?? '',
      strengths: Array.isArray(raw.strengths) ? raw.strengths : (base.strengths ?? []),
      restrictions: Array.isArray(raw.restrictions) ? raw.restrictions : (base.restrictions ?? []),
    });
  }

  return [...byKey.values()].map(agent => ({
    ...agent,
    path: agent.path ?? ENV[agent.envKey] ?? '',
  }));
}

export function writeAgentRegistry(agents, file = AGENTS_FILE) {
  mkdirSync('.myteam', { recursive: true });
  const cleaned = agents
    .map(agent => {
      const key = sanitizeAgentKey(agent.key);
      if (!key) return null;
      return {
        key,
        label: String(agent.label || key).trim() || key,
        emoji: String(agent.emoji || '●').trim() || '●',
        desc: String(agent.desc || '').trim(),
        path: String(agent.path || '').trim(),
        inputMode: agent.inputMode === 'stdin' ? 'stdin' : 'arg',
        argsTemplate: String(agent.argsTemplate || '-p {prompt}').trim(),
        checkTemplate: String(agent.checkTemplate || '--help').trim(),
        removable: agent.removable ?? !AGENT_KEYS.includes(key),
        // 角色卡字段
        roleDescription: String(agent.roleDescription || '').trim(),
        personality: String(agent.personality || '').trim(),
        strengths: Array.isArray(agent.strengths) ? agent.strengths.map(String).filter(Boolean) : [],
        restrictions: Array.isArray(agent.restrictions) ? agent.restrictions.map(String).filter(Boolean) : [],
      };
    })
    .filter(Boolean);
  writeFileSync(file, JSON.stringify({ agents: cleaned }, null, 2), 'utf8');
  return cleaned;
}

/**
 * 构建角色卡 system prompt 头部（对齐 clowder-ai buildStaticIdentity）
 * 注入到每次 agent 调用的 prompt 最前面
 */
export function buildRoleCard(agentDef) {
  if (!agentDef) return '';
  const lines = [];
  const name = agentDef.label || agentDef.key;
  if (agentDef.roleDescription) {
    lines.push(`你是 ${name}，角色：${agentDef.roleDescription}`);
  }
  if (agentDef.personality) {
    lines.push(`性格：${agentDef.personality}`);
  }
  if (agentDef.strengths?.length) {
    lines.push(`擅长：${agentDef.strengths.join('、')}`);
  }
  if (agentDef.restrictions?.length) {
    lines.push(`\n你的硬限制：${agentDef.restrictions.join('、')}。被要求做这类任务时请明确说明无法完成。`);
  }
  return lines.length ? lines.join('\n') + '\n\n' : '';
}

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
  const config = {};
  for (const agent of readAgentRegistry(ENV)) {
    config[agent.key] = {
      ...agent,
      path: agent.path || '',
      inputMode: agent.inputMode,
      args: (prompt) => splitArgs(agent.argsTemplate, prompt),
      checkArgs: () => splitArgs(agent.checkTemplate || '--help'),
      spawnOptions: { stdio: [agent.inputMode === 'stdin' ? 'pipe' : 'ignore', 'pipe', 'pipe'] },
    };
  }
  return config;
}

// ── NDJSON 解析器 ─────────────────────────────────────────────
// clowder-ai 对齐：各 agent CLI 均使用 --output-format stream-json / --json
// 解析器返回 { text, thinking } 或字符串（兼容旧调用）；返回 null 表示当前行无 chunk

function parseClaude(line) {
  // claude --output-format stream-json
  // - type=assistant → message.content[].text 是正文
  // - type=stream_event 中 thinking_delta 是思考流
  try {
    const e = JSON.parse(line);
    if (e.type === 'assistant') {
      const blocks = e.message?.content ?? [];
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
      const thinking = blocks.filter(b => b.type === 'thinking').map(b => b.thinking || b.text || '').join('');
      if (!text && !thinking) return null;
      return { text: text || '', thinking: thinking || '' };
    }
    if (e.type === 'stream_event') {
      const s = e.event;
      if (s?.type === 'content_block_delta') {
        const d = s.delta;
        if (d?.type === 'thinking_delta') return { text: '', thinking: d.thinking || '' };
        if (d?.type === 'text_delta') return { text: d.text || '', thinking: '' };
      }
    }
  } catch {}
  return null;
}

function parseCodex(line) {
  // codex exec --json：type=item.completed 行含 item.text
  // codex 不分思考流，直接返回文本
  try {
    const e = JSON.parse(line);
    if (e.type === 'item.completed' && e.item?.text) return e.item.text;
  } catch {}
  return null;
}

function parseKimi(line) {
  // kimi --output-format stream-json：role=assistant 行
  // content 字段是正文，thinking/reasoning_content 是思考
  try {
    const e = JSON.parse(line);
    if (e.role === 'assistant') {
      const content = e.content;
      let text = '';
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) {
        text = content
          .map(b => (typeof b === 'string' ? b : (b?.text || b?.content || '')))
          .filter(Boolean)
          .join('');
      }
      let thinking = '';
      if (typeof e.thinking === 'string') thinking = e.thinking;
      else if (typeof e.reasoning === 'string') thinking = e.reasoning;
      else if (typeof e.reasoning_content === 'string') thinking = e.reasoning_content;
      if (!text && !thinking) return null;
      return { text, thinking };
    }
  } catch {}
  return null;
}

function parseText(line) {
  return `${line}\n`;
}

export const PARSERS = { codex: parseCodex, claude: parseClaude, kimi: parseKimi };

export function buildSpawnCommand(cfg, args) {
  const isCmd = cfg.path.toLowerCase().endsWith('.cmd');
  return {
    spawnPath: isCmd ? 'cmd.exe' : cfg.path,
    spawnArgs: isCmd ? ['/c', cfg.path, ...args] : args,
  };
}

export function formatLaunchError(agentKey, err) {
  const code = err?.code ? `${err.code}: ` : '';
  return `${agentKey} 启动失败：${code}${err?.message || '未知错误'}`;
}

export function checkAgentLaunchable(agentKey, cfg, timeoutMs = 3000) {
  const path = cfg?.path || '';
  if (!path) {
    return Promise.resolve({
      key: agentKey,
      path,
      configured: false,
      exists: false,
      available: false,
      error: '未配置路径',
    });
  }

  if (!existsSync(path)) {
    return Promise.resolve({
      key: agentKey,
      path,
      configured: true,
      exists: false,
      available: false,
      error: '文件不存在',
    });
  }

  const args = cfg.checkArgs ? cfg.checkArgs() : ['--help'];
  const { spawnPath, spawnArgs } = buildSpawnCommand(cfg, args);

  return new Promise((resolve) => {
    let child;
    let finished = false;

    const finish = (available, error = '') => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        key: agentKey,
        path,
        configured: true,
        exists: true,
        available,
        error,
      });
    };

    const timer = setTimeout(() => {
      try { child?.kill('SIGTERM'); } catch {}
      finish(false, '检测超时，CLI 没有及时响应');
    }, timeoutMs);

    try {
      // 这里只做很轻的 --help 检测，用来确认“文件能不能被系统启动”。
      child = spawn(spawnPath, spawnArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish(false, formatLaunchError(agentKey, err));
      return;
    }

    child.on('error', (err) => {
      finish(false, formatLaunchError(agentKey, err));
    });

    child.on('close', (code) => {
      if (code === 0) finish(true);
      else finish(false, `检测命令退出码 ${code}`);
    });
  });
}

// ── Agent 调用（stdin pipe，支持 .cmd 自动中转 cmd.exe） ───────
// 教训1 (02-cli-engineering): readline 接管 stdout 后 child.stdout.on('data') 不再触发。
//   watchdog 必须在 rl.on('line') 和 stderr.on('data') 里刷新，不能只靠 stdout 流。
// 教训1: 超时时间 30min，匹配复杂任务（代码分析/长篇写作）实际需要。
export function invokeAgent(CLI_CONFIG, agentKey, prompt, { silent = false, timeoutMs = 30 * 60 * 1000 } = {}) {
  const cfg = CLI_CONFIG[agentKey];
  if (!cfg?.path) throw new Error(`${agentKey} 路径未在 .env 中配置（${agentKey.toUpperCase()}_PATH）`);

  const parser = PARSERS[agentKey] || parseText;

  const args = cfg.args(prompt);
  const { spawnPath, spawnArgs } = buildSpawnCommand(cfg, args);

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let watchdog = null;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearInterval(watchdog);
      reject(err);
    };

    try {
      child = spawn(spawnPath, spawnArgs, cfg.spawnOptions);
    } catch (err) {
      fail(new Error(formatLaunchError(agentKey, err)));
      return;
    }

    child.on('error', (err) => {
      fail(new Error(formatLaunchError(agentKey, err)));
    });

    if (cfg.inputMode !== 'arg') {
      try {
        child.stdin.write(prompt, 'utf8');
        child.stdin.end();
      } catch (err) {
        fail(new Error(formatLaunchError(agentKey, err)));
        return;
      }
    }

    let fullText = '';
    let stderrText = '';
    let lastActivity = Date.now();
    // 教训1: 只靠 stdout 会漏掉 thinking/工具调用期间的 stderr 活跃信号
    const touch = () => { lastActivity = Date.now(); };

    watchdog = setInterval(() => {
      if (Date.now() - lastActivity > timeoutMs) {
        child.kill('SIGTERM');
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 3000);
        fail(new Error(`timeout after ${timeoutMs / 60000}min`));
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
      stderrText += msg;
      if (stderrText.length > 4000) stderrText = stderrText.slice(-4000);
      if (msg.includes('Reading additional input')) return;
      if (!silent) process.stderr.write(`[stderr] ${msg}`);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      if (!silent) process.stdout.write('\n');
      if (code !== 0) {
        const detail = stderrText.trim();
        reject(new Error(detail ? `exit code ${code}: ${detail}` : `exit code ${code}`));
      }
      else resolve(fullText);
    });
  });
}

// ── JSON 提取 + 幻觉限制验证 ─────────────────────────────────
// 教训2 (02-cli-engineering): AI 会产生幻觉，解析结果要做二次验证。
// IMP-005: 修复贪心匹配问题，使用括号配对算法找到第一个完整的 JSON 对象
export function extractJson(text) {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
  
  // 找到第一个 { 的位置
  const startIdx = cleaned.indexOf('{');
  if (startIdx === -1) return null;
  
  // 使用栈匹配括号，找到对应的 }
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = startIdx; i < cleaned.length; i++) {
    const char = cleaned[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        // 找到匹配的 }，尝试解析
        const jsonStr = cleaned.slice(startIdx, i + 1);
        try {
          return JSON.parse(jsonStr);
        } catch {
          return null;
        }
      }
    }
  }
  
  return null;
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

// ── tasks.jsonl 读写（IMP-004: 从 server.mjs / dispatch.mjs 抽取） ──
const TASKS_FILE = '.myteam/tasks.jsonl';

export function readTasks() {
  if (!existsSync(TASKS_FILE)) return [];
  return readFileSync(TASKS_FILE, 'utf8')
    .split('\n').filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

export function writeAllTasks(tasks) {
  writeFileSync(TASKS_FILE, tasks.map(t => JSON.stringify(t)).join('\n') + '\n', 'utf8');
}

export function appendTask(record) {
  appendFileSync(TASKS_FILE, JSON.stringify(record) + '\n', 'utf8');
}

export function patchTask(id, patch) {
  const tasks = readTasks();
  writeAllTasks(tasks.map(t => t.id === id ? { ...t, ...patch } : t));
}

// ── 共享 Prompt（IMP-004: 从 server.mjs / plan.mjs / dispatch.mjs 抽取） ──
export const PLAN_PROMPT = `你是 myteam 的任务规划 agent。
用户会给你一个目标，把它拆成 3-7 个可执行、可验收的小任务。

【强制规则】
- 无论用户说什么，你的唯一输出是下方 JSON，不得有任何其他文字
- 不要分析用户意图，不要解释，不要思考过程，不要 markdown 代码块
- 如果目标是一个问题或闲聊，也必须把它拆成任务返回，不要直接回答
- 第一个字符必须是 {，最后一个字符必须是 }

严格按以下 JSON 格式返回：
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

export function buildExecPrompt(task, skillContext = '') {
  const steps = (task.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const accept = task.accept ? `\n验收标准：${task.accept}` : '';
  const reworkNote = task.review_note ? `\n返工说明：${task.review_note}` : '';
  const previousResult = task.previous_result
    ? `\n上一次结果摘要：${String(task.previous_result).slice(0, 600)}`
    : '';
  const skills = skillContext ? `\n本次按需加载的 Skills：\n${skillContext}` : '';
  return `你是 myteam 的执行 agent，请完成以下任务。

任务标题：${task.title}
所属目标：${task.goal}

执行步骤：
${steps || '（无具体步骤，请自行判断）'}
${accept}
${reworkNote}
${previousResult}
${skills}

请执行上述任务，给出完整的执行结果和说明。`;
}
