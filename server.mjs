// myteam HTTP server — REST API + SSE
// 用法：node server.mjs [--port 7878]

import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, basename, extname } from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { loadEnv, buildCliConfig, invokeAgent, extractJson, PARSERS, validatePlanResult, readTasks, writeAllTasks, appendTask, patchTask, PLAN_PROMPT, buildExecPrompt, AGENT_KEYS, buildSpawnCommand, checkAgentLaunchable, formatLaunchError, readAgentRegistry, writeAgentRegistry, sanitizeAgentKey, buildRoleCard } from './agent-utils.mjs';

let ENV = loadEnv();
let CLI_CONFIG = buildCliConfig(ENV);
const TASKS_FILE = '.myteam/tasks.jsonl';
const LESSONS_FILE = '.myteam/lessons.jsonl';
const SKILLS_FILE = '.myteam/skills.yaml';
const INVOCATIONS_FILE = '.myteam/invocations.jsonl';
const SETTINGS_FILE = '.myteam/settings.json';
const UPLOADS_DIR = '.myteam/uploads';
const AGENT_STATUS_TTL_MS = 5000;
let agentStatusCache = { time: 0, agents: null };

function agentKeys() {
  return Object.keys(CLI_CONFIG);
}

function loadSettings() {
  const fallback = { workspace: resolve('.') };
  if (!existsSync(SETTINGS_FILE)) return fallback;
  try {
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...fallback, ...data, workspace: data.workspace || fallback.workspace };
  } catch {
    return fallback;
  }
}

function saveSettings(settings) {
  mkdirSync('.myteam', { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

function currentWorkspace() {
  return resolve(loadSettings().workspace || '.');
}

function reloadAgentConfig() {
  ENV = loadEnv();
  CLI_CONFIG = buildCliConfig(ENV);
  clearAgentStatusCache();
}

async function getAgentStatuses({ force = false } = {}) {
  const now = Date.now();
  if (!force && agentStatusCache.agents && now - agentStatusCache.time < AGENT_STATUS_TTL_MS) {
    return agentStatusCache.agents;
  }

  const metaByKey = new Map(readAgentRegistry(ENV).map(agent => [agent.key, agent]));
  const agents = await Promise.all(
    agentKeys().map(async (k) => ({
      ...(await checkAgentLaunchable(k, CLI_CONFIG[k])),
      ...(metaByKey.get(k) || {}),
      path: CLI_CONFIG[k]?.path || '',
    }))
  );
  agentStatusCache = { time: now, agents };
  return agents;
}

function clearAgentStatusCache() {
  agentStatusCache = { time: 0, agents: null };
}

async function resolveRunnableAgent(preferredAgent) {
  const statuses = await getAgentStatuses();
  const preferred = agentKeys().includes(preferredAgent) ? preferredAgent : '';
  const chosen = statuses.find(a => a.key === preferred && a.available)
    || statuses.find(a => a.available)
    || statuses.find(a => a.key === preferred)
    || statuses[0];
  return { agentKey: chosen?.key || preferred || agentKeys()[0] || 'codex', status: chosen };
}

function appendLesson(task, error) {
  const lesson = {
    id: randomUUID().slice(0, 8),
    task_id: task.id,
    task_title: task.title,
    goal: task.goal,
    agent: task.agent,
    error: error.message,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(LESSONS_FILE, JSON.stringify(lesson) + '\n', 'utf8');
}

function parseScalar(value) {
  const v = String(value || '').trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v.replace(/^["']|["']$/g, '');
}

function readSkills() {
  if (!existsSync(SKILLS_FILE)) return [];
  const skills = [];
  let current = null;
  let inMounts = false;

  for (const raw of readFileSync(SKILLS_FILE, 'utf8').split('\n')) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed === 'skills:') continue;

    const item = trimmed.match(/^-\s+name:\s*(.+)$/);
    if (item) {
      current = { name: parseScalar(item[1]), mounts: {} };
      skills.push(current);
      inMounts = false;
      continue;
    }

    if (!current) continue;
    if (trimmed === 'mounts:') {
      inMounts = true;
      continue;
    }

    const kv = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    if (inMounts) current.mounts[kv[1]] = Boolean(parseScalar(kv[2]));
    else current[kv[1]] = parseScalar(kv[2]);
  }

  return skills;
}

function skillRoleForPhase(phase) {
  if (phase === 'plan') return 'controller';
  if (phase === 'review') return 'reviewer';
  return 'worker';
}

function splitSkillText(skill) {
  return [
    skill.name,
    skill.category,
    skill.trigger,
    skill.description,
    skill.prompt,
    skill.load,
  ].filter(Boolean).join(' ').toLowerCase();
}

function selectSkills({ text = '', agent = '', phase = 'run' } = {}) {
  const skills = readSkills();
  const role = skillRoleForPhase(phase);
  const haystack = String(text || '').toLowerCase();

  const scored = skills.map(skill => {
    let score = 0;
    const skillText = splitSkillText(skill);
    if (skill.mounts?.[role]) score += 3;
    if (agent && skill.mounts?.[agent]) score += 2;
    if (skill.category && haystack.includes(String(skill.category).toLowerCase())) score += 2;
    for (const token of skillText.split(/[\s,，。；;、/|]+/).filter(t => t.length >= 2)) {
      if (haystack.includes(token)) score += 1;
    }
    return { ...skill, score };
  });

  return scored
    .filter(skill => skill.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3);
}

function buildSkillContext(selected) {
  if (!selected.length) return '';
  return selected.map((skill, index) => {
    const prompt = skill.prompt || skill.description || skill.trigger || '按该技能边界完成任务';
    return `${index + 1}. ${skill.name}（${skill.category || 'general'}）：${prompt}`;
  }).join('\n');
}

function appendInvocation(record) {
  try {
    appendFileSync(INVOCATIONS_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    console.error('Failed to append invocation:', err.message);
  }
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function readInvocations() {
  return readJsonl(INVOCATIONS_FILE);
}

function summarizeInvocations(invocations) {
  const total = invocations.length;
  const failed = invocations.filter(i => i.status === 'failed').length;
  const interrupted = invocations.filter(i => i.status === 'interrupted').length;
  const success = invocations.filter(i => i.status === 'success').length;
  const durations = invocations.map(i => Number(i.duration_ms || 0)).filter(n => n > 0);
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((sum, n) => sum + n, 0) / durations.length)
    : 0;
  const byAgent = {};
  invocations.forEach(i => {
    const key = i.agent || 'unknown';
    byAgent[key] ||= { total: 0, success: 0, failed: 0, interrupted: 0 };
    byAgent[key].total++;
    if (byAgent[key][i.status] !== undefined) byAgent[key][i.status]++;
  });
  return { total, success, failed, interrupted, avgDurationMs, byAgent };
}

// ── 对话历史 + Session 隔离（持久化到 .myteam/memory.json） ───
// 数据结构: { sessions: [{ id, name, created_at, history: [...] }], activeId }
const MEMORY_FILE = '.myteam/memory.json';
const DEFAULT_SESSION_NAME = '默认对话';
const DEFAULT_DRAFT_SESSION_NAME = '新对话';

// 内存数据：sessions 数组 + 当前激活的 session id
let sessions = [];
let activeSessionId = null;
let trashedSessions = []; // 回收站：{ session, deletedAt }
const TRASH_RETENTION_MS = 5 * 60 * 1000; // 5 分钟

function newSession(name) {
  return {
    id: randomUUID().slice(0, 8),
    name: name || DEFAULT_DRAFT_SESSION_NAME,
    created_at: new Date().toISOString(),
    history: [],
    mode: null, // 'chat' | 'plan' | 'mixed'，由首次/最近一次操作决定
  };
}

function recordSessionMode(session, mode) {
  if (!session) return;
  if (!session.mode) session.mode = mode;
  else if (session.mode !== mode) session.mode = 'mixed';
}

function isAutoSessionName(name) {
  const text = String(name || '').trim();
  return (
    !text ||
    text === DEFAULT_SESSION_NAME ||
    text === DEFAULT_DRAFT_SESSION_NAME ||
    /^对话\s*\d+$/.test(text)
  );
}

function summarizeSessionTitle(text) {
  const clean = String(text || '')
    .replace(/(?:^|\n)\s*@(claude|codex|kimi)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[，。！？,.!?;；：:\s]+|[，。！？,.!?;；：:\s]+$/g, '')
    .trim();
  const firstSentence = clean.split(/[。！？!?；;\n]/)[0]?.trim() || clean;
  if (!firstSentence) return DEFAULT_DRAFT_SESSION_NAME;
  return firstSentence.length > 22 ? `${firstSentence.slice(0, 22)}…` : firstSentence;
}

function maybeAutoRenameSession(session, message) {
  // 新手体验：新建对话时不要求先起名，等第一句话发出后自动生成一个短标题。
  if (!session || session.history.length || !isAutoSessionName(session.name)) return;
  session.name = summarizeSessionTitle(message);
}

function getSession(id) {
  return sessions.find(s => s.id === id) || null;
}

function getActiveSession() {
  return getSession(activeSessionId) || sessions[0];
}

function loadSessions() {
  if (!existsSync(MEMORY_FILE)) {
    sessions = [newSession()];
    activeSessionId = sessions[0].id;
    return;
  }
  try {
    const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf8'));
    // 旧格式：扁平历史数组，迁移到默认 session
    if (Array.isArray(data)) {
      const s = newSession();
      s.history = data.slice(-40);
      sessions = [s];
      activeSessionId = s.id;
      return;
    }
    if (Array.isArray(data.sessions) && data.sessions.length) {
      sessions = data.sessions.map(s => ({
        id: s.id || randomUUID().slice(0, 8),
        name: s.name || DEFAULT_SESSION_NAME,
        created_at: s.created_at || new Date().toISOString(),
        history: Array.isArray(s.history) ? s.history.slice(-40) : [],
        mode: s.mode || null,
      }));
      activeSessionId = data.activeId && getSession(data.activeId)
        ? data.activeId : sessions[0].id;
      if (Array.isArray(data.trashedSessions)) {
        const now = Date.now();
        trashedSessions = data.trashedSessions
          .filter(t => now - t.deletedAt < TRASH_RETENTION_MS)
          .map(t => ({ session: t.session, deletedAt: t.deletedAt }));
      }
      return;
    }
  } catch (err) {
    console.error('Failed to load sessions:', err.message);
  }
  sessions = [newSession()];
  activeSessionId = sessions[0].id;
}

function saveSessions() {
  try {
    const payload = {
      activeId: activeSessionId,
      sessions: sessions.map(s => ({
        ...s,
        history: s.history.slice(-40),
      })),
      trashedSessions: trashedSessions.map(t => ({
        session: t.session,
        deletedAt: t.deletedAt,
      })),
    };
    writeFileSync(MEMORY_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save sessions:', err.message);
  }
}

// 启动时加载
loadSessions();

// ── @mention 路由解析 ─────────────────────────────────────────
// 参考 clowder-ai 的 parseA2AMentions：用户输入用宽松匹配（任意位置）
// 行首匹配用于 agent 回复里的 @mention（防止代码注释误触发），此处是用户输入不需要
const MENTION_MAP = {
  claude: 'claude',
  codex:  'codex',
  kimi:   'kimi',
};
function parseAtMentionLegacy(text) {
  // 行首匹配（允许前导空白），防止代码/引用中 @mention 误触发路由
  const m = text.match(/(?:^|\n)\s*@(claude|codex|kimi)\b/i);
  return m ? MENTION_MAP[m[1].toLowerCase()] : null;
}

// ── A2A Worklist：从 agent 回复中提取 @mention 触发链式执行 ────
// 行首匹配（允许前导空白），防止代码注释 /  casual 提及误触发
function parseA2AMentionsLegacy(text) {
  const mentions = [];
  const re = /(?:^|\n)\s*@(claude|codex|kimi)\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = MENTION_MAP[m[1].toLowerCase()];
    if (key && !mentions.includes(key)) mentions.push(key);
  }
  return mentions;
}
function dynamicMentionPattern() {
  return /(?:^|\n)\s*@([a-zA-Z0-9_-]+)\b/g;
}

function parseAtMention(text) {
  const m = dynamicMentionPattern().exec(text);
  if (!m) return null;
  const key = sanitizeAgentKey(m[1]);
  return agentKeys().includes(key) ? key : null;
}

function stripAtMentions(text) {
  return String(text || '').replace(dynamicMentionPattern(), (raw, key) => (
    agentKeys().includes(sanitizeAgentKey(key)) ? '' : raw
  )).trim();
}

function parseA2AMentions(text) {
  const mentions = [];
  const re = dynamicMentionPattern();
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = sanitizeAgentKey(m[1]);
    if (key && agentKeys().includes(key) && !mentions.includes(key)) mentions.push(key);
  }
  return mentions;
}
const WORKLIST_MAX_DEPTH = 3; // 防止无限链

// ── 构建带历史的 chat prompt ──────────────────────────────────
const RICH_BLOCKS_HINT = `
你的回复支持以下 Rich Blocks 富文本语法（按需使用，不要强行套用）：
- 代码块用三个反引号包裹，可标语言：\`\`\`js ... \`\`\`
- 行内代码 \`code\`，加粗 **text**，斜体 *text*
- 标题 # / ## / ###；列表用 - 或 1.
- 卡片块（用于强调结论或重要信息）：
  :::card title="标题"
  内容支持其它 markdown
  :::
- 清单块（用于待办或步骤，[x] 表示已完成）：
  :::checklist title="待办"
  - [x] 已完成项
  - [ ] 待办项
  :::
- 角色卡（用于声明身份或介绍）：
  :::role name="姓名" tag="标签"
  描述
  :::
`;

const CHAT_SYSTEM = {
  codex:  `You are Codex, a helpful AI assistant in the myteam workspace. You help with code, analysis, and task planning. Reply in Chinese.${RICH_BLOCKS_HINT}`,
  claude: `You are Claude, a helpful AI assistant in the myteam workspace. You excel at deep thinking, writing, and architecture. Reply in Chinese.${RICH_BLOCKS_HINT}`,
  kimi:   `You are Kimi, a helpful AI assistant in the myteam workspace. You handle lightweight execution, drafting, and quick analysis. Reply in Chinese.${RICH_BLOCKS_HINT}`,
};

function buildChatPrompt(userMessage, agentKey, history) {
  const system = CHAT_SYSTEM[agentKey] || CHAT_SYSTEM.codex;
  // 取最近 10 条历史避免 token 过多
  const recentHistory = (history || []).slice(-10);
  const historyLines = recentHistory
    .map(h => `${h.role === 'user' ? '用户' : (h.agent || 'assistant')}: ${h.text}`)
    .join('\n\n');

  return `${system}

${historyLines ? `对话历史：\n${historyLines}\n\n` : ''}用户: ${userMessage}`;
}

function attachmentPrompt(attachments = []) {
  const list = (Array.isArray(attachments) ? attachments : [])
    .filter(a => a && a.path)
    .map((a, i) => `${i + 1}. ${a.name || basename(a.path)}：${a.path}${a.type ? ` (${a.type})` : ''}`)
    .join('\n');
  return list ? `\n\n【图片输入】\n用户这次发送了图片。请先观察和分析图片，再回答用户的问题。\n如果你的运行环境无法直接读取图片，请明确说明“当前 agent 无法直接读取图片”，并告诉用户需要补充什么信息，不要假装已经看过图片。\n本地图片路径如下：\n${list}` : '';
}

// 给 plan 阶段使用：不传具体路径，避免 agent 自动调 view_image 工具导致失败。
// 拆任务只需要让 agent 知道"有图"，让它据文字目标拆任务，具体读图交给后续执行 agent。
function attachmentPromptForPlan(attachments = []) {
  const arr = Array.isArray(attachments) ? attachments.filter(a => a && a.path) : [];
  if (!arr.length) return '';
  return `\n\n【图片附件提示】\n用户额外上传了 ${arr.length} 张图片（拆任务阶段不需要你查看）。\n请直接根据用户文字目标拆解任务；若任务需要分析图片，请在对应任务里明确写出 "分析图片：xxx"，由具体执行 agent 阶段处理。\n切勿调用 view_image / read_image 等工具，本阶段只输出 JSON。`;
}

const PORT = (() => {
  const i = process.argv.indexOf('--port');
  return i >= 0 ? Number(process.argv[i + 1]) : 7878;
})();

// ── tasks.jsonl 工具 ──────────────────────────────────────────
// 教训4 (02-cli-engineering): 重要操作前先备份，防止数据丢失
const RUNS_DIR = '.myteam/runs';
function backupTasks() {
  if (!existsSync(TASKS_FILE)) return null;
  mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${RUNS_DIR}/tasks-backup-${stamp}.jsonl`;
  copyFileSync(TASKS_FILE, dest);
  return dest;
}

// ── SSE 工具 ──────────────────────────────────────────────────
function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── 活跃子进程追踪（用于 abort） ──────────────────────────────
const activeChildren = new Map(); // id → { child, sessionId, clientRunId, aborted }
let childIdSeq = 0;

function abortChildren({ sessionId = '', clientRunId = '' } = {}) {
  if (!sessionId && !clientRunId) return 0;
  let count = 0;
  for (const [id, record] of activeChildren) {
    if (clientRunId && record.clientRunId !== clientRunId) continue;
    if (!clientRunId && sessionId && record.sessionId !== sessionId) continue;
    record.aborted = true;
    count++;
    try { record.child.kill('SIGTERM'); } catch { /* already dead */ }
  }
  return count;
}

// ── 调用 agent 并实时流到 SSE ─────────────────────────────────
// 教训1 (02-cli-engineering): readline 接管 stdout 后，child.stdout.on('data') 不再触发。
// watchdog 必须在 rl.on('line') 和 stderr.on('data') 里刷新。
// 教训1: 超时 30min，匹配复杂任务实际需要。
function streamAgent(agentKey, prompt, res, label = 'chunk', { skipRoleCard = false, sessionId = '', clientRunId = '' } = {}) {
  const invocationId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const startedIso = new Date(startedAt).toISOString();

  const finishInvocation = (status, extra = {}) => {
    appendInvocation({
      id: invocationId,
      agent: agentKey,
      label,
      status,
      started_at: startedIso,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      prompt_chars: prompt.length,
      ...extra,
    });
  };

  const cfg = CLI_CONFIG[agentKey];
  if (!cfg?.path) {
    sseSend(res, 'error', { message: `${agentKey} 路径未在 .env 中配置` });
    finishInvocation('failed', { error: 'missing path' });
    return Promise.reject(new Error('missing path'));
  }

  // 角色卡注入（对齐 clowder-ai buildStaticIdentity）
  const agentDef = skipRoleCard ? null : readAgentRegistry().find(a => a.key === agentKey);
  const roleCard = buildRoleCard(agentDef);
  const fullPrompt = roleCard ? roleCard + prompt : prompt;

  const parser = PARSERS[agentKey] || ((line) => `${line}\n`);
  const args = cfg.args(fullPrompt);
  const { spawnPath, spawnArgs } = buildSpawnCommand(cfg, args);

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let watchdog = null;

    const fail = (err, cid = null) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearInterval(watchdog);
      if (cid) activeChildren.delete(cid);
      finishInvocation('failed', { error: err.message });
      reject(err);
    };

    try {
      sseSend(res, 'status', { agent: agentKey, phase: 'starting', text: `${agentKey} 正在启动` });
      child = spawn(spawnPath, spawnArgs, { ...cfg.spawnOptions, cwd: currentWorkspace() });
    } catch (err) {
      fail(new Error(formatLaunchError(agentKey, err)));
      return;
    }

    const cid = ++childIdSeq;
    const childRecord = { child, sessionId, clientRunId, aborted: false };
    activeChildren.set(cid, childRecord);

    child.on('error', (err) => {
      fail(new Error(formatLaunchError(agentKey, err)), cid);
    });

    if (cfg.inputMode !== 'arg') {
      try {
        child.stdin.write(prompt, 'utf8');
        child.stdin.end();
      } catch (err) {
        fail(new Error(formatLaunchError(agentKey, err)), cid);
        return;
      }
    }

    let fullText = '';
    let stderrText = '';
    let lastActivity = Date.now();
    const touch = () => { lastActivity = Date.now(); };
    const thinkingTimer = setTimeout(() => {
      if (!fullText && !settled) {
        sseSend(res, 'status', { agent: agentKey, phase: 'thinking', text: `${agentKey} 正在思考，还没有输出` });
      }
    }, 1500);
    const TIMEOUT_MS = 30 * 60 * 1000; // 教训1: 30min

    watchdog = setInterval(() => {
      if (Date.now() - lastActivity > TIMEOUT_MS) {
        child.kill('SIGTERM');
        fail(new Error('timeout after 30min'), cid);
      }
    }, 10_000);

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      touch(); // 教训1: readline 接管后在这里刷新
      if (!line.trim()) return;
      let out;
      try {
        out = parser(line);
      } catch (parseErr) {
        // parser 显式抛错（如 codex turn.failed / error 事件）→ 直接终止 stream
        try { child.kill('SIGTERM'); } catch {}
        fail(new Error(parseErr.message || String(parseErr)), cid);
        return;
      }
      if (!out) return;
      // 兼容旧 parser 返回字符串 vs 新 parser 返回 { text, thinking }
      const text = typeof out === 'string' ? out : (out.text || '');
      const thinking = typeof out === 'string' ? '' : (out.thinking || '');
      if (text) {
        fullText += text;
        if (fullText.length === text.length) {
          sseSend(res, 'status', { agent: agentKey, phase: 'streaming', text: `${agentKey} 开始输出` });
        }
        sseSend(res, label, { text });
        if (label !== 'chunk') sseSend(res, 'chunk', { text });
      }
      if (thinking) {
        sseSend(res, 'thinking', { text: thinking });
      }
    });

    child.stderr?.on('data', (data) => {
      touch(); // 教训1: stderr 也是活跃信号
      stderrText += data.toString();
      if (stderrText.length > 4000) stderrText = stderrText.slice(-4000);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      clearTimeout(thinkingTimer);
      activeChildren.delete(cid);
      const common = {
        exit_code: code,
        output_chars: fullText.length,
      };
      if (childRecord.aborted) {
        finishInvocation('interrupted', { ...common, error: 'aborted' });
        resolve(fullText);
      } else if (code !== 0) {
        const detail = stderrText.trim();
        const err = new Error(detail ? `exit code ${code}: ${detail}` : `exit code ${code}`);
        finishInvocation('failed', { ...common, error: err.message, stderr: detail });
        reject(err);
      } else {
        finishInvocation('success', stderrText.trim() ? { ...common, stderr: stderrText.trim() } : common);
        resolve(fullText);
      }
    });
  });
}

// ── HTTP body 读取 ───────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({}); }
    });
  });
}

function saveUploadFromDataUrl({ name = 'image.png', type = '', dataUrl = '' } = {}) {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('图片数据格式不正确');
  const mime = type || match[1];
  if (!mime.startsWith('image/')) throw new Error('目前只支持图片附件');
  const extMap = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
  const safeName = basename(String(name || 'image')).replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 80);
  const ext = extMap[mime] || (safeName.includes('.') ? '' : '.png');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 8 * 1024 * 1024) throw new Error('单张图片不能超过 8MB');
  mkdirSync(UPLOADS_DIR, { recursive: true });
  const id = randomUUID().slice(0, 8);
  const fileName = `${Date.now()}-${id}-${safeName}${safeName.endsWith(ext) ? '' : ext}`;
  const filePath = `${UPLOADS_DIR}/${fileName}`;
  writeFileSync(filePath, bytes);
  return { id, name: safeName, type: mime, path: resolve(filePath), url: `/uploads/${encodeURIComponent(fileName)}` };
}

// ── 静态文件 MIME ─────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// ── 路由 ──────────────────────────────────────────────────────
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // 静态首页
  if (req.method === 'GET' && (pathname === '/' || pathname === '/app.html')) {
    const html = readFileSync('web/app.html', 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // 静态资源（CSS/JS）
  if (req.method === 'GET' && (pathname === '/app.css' || pathname === '/app.js')) {
    const ext = pathname.slice(1); // 'app.css' or 'app.js'
    const content = readFileSync(`web/${ext}`, 'utf8');
    const contentType = ext.endsWith('.css') ? 'text/css' : 'application/javascript';
    res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
    return res.end(content);
  }

  // 图片附件缩略图：只允许读取 .myteam/uploads 目录内的文件。
  if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
    try {
      const fileName = basename(decodeURIComponent(pathname.slice('/uploads/'.length)));
      const filePath = resolve(UPLOADS_DIR, fileName);
      const uploadRoot = resolve(UPLOADS_DIR);
      if (!filePath.startsWith(uploadRoot) || !existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '图片不存在' }));
      }
      const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' });
      return res.end(readFileSync(filePath));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '图片路径不正确' }));
    }
  }

  // POST /api/abort — 中断所有正在执行的 agent 子进程
  if (pathname === '/api/settings') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ settings: loadSettings(), workspace: currentWorkspace() }));
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const workspace = resolve(String(body.workspace || currentWorkspace()).trim() || '.');
      if (!existsSync(workspace)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '工作区路径不存在' }));
      }
      const settings = { ...loadSettings(), workspace };
      saveSettings(settings);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, settings, workspace }));
    }
  }

  if (req.method === 'POST' && pathname === '/api/uploads') {
    try {
      const body = await readBody(req);
      const files = Array.isArray(body.files) ? body.files : [];
      const uploads = files.slice(0, 5).map(saveUploadFromDataUrl);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, uploads }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  if (req.method === 'POST' && pathname === '/api/abort') {
    const body = await readBody(req);
    const count = abortChildren({
      sessionId: String(body.sessionId || ''),
      clientRunId: String(body.clientRunId || ''),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ aborted: count }));
  }

  // GET /api/sessions — 返回所有 session 列表 + 当前激活
  if (req.method === 'GET' && pathname === '/api/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      activeId: activeSessionId,
      sessions: sessions.map(s => ({
        id: s.id,
        name: s.name,
        created_at: s.created_at,
        mode: s.mode || null,
        message_count: s.history.length,
      })),
    }));
  }

  // POST /api/sessions { name?, activeId? } — 新建或切换 session
  if (req.method === 'POST' && pathname === '/api/sessions') {
    const body = await readBody(req);
    if (body.activeId) {
      const target = getSession(body.activeId);
      if (!target) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'session 不存在' }));
      }
      activeSessionId = target.id;
      saveSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, activeId: activeSessionId }));
    }
    // 新建
    const s = newSession((body.name || '').trim());
    sessions.push(s);
    activeSessionId = s.id;
    saveSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, session: s, activeId: activeSessionId }));
  }

  // POST /api/sessions/:id/rename — 重命名 session
  if (req.method === 'POST' && /^\/api\/sessions\/[^/]+\/rename$/.test(pathname)) {
    const id = pathname.split('/')[3];
    const s = sessions.find(s => s.id === id);
    if (!s) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'session 不存在' }));
    }
    const body = await readBody(req);
    const name = (body.name || '').trim();
    if (!name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'name 不能为空' }));
    }
    s.name = name;
    saveSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, session: s }));
  }

  // DELETE /api/sessions?id=xxx — 删除 session（移入回收站）
  if (req.method === 'DELETE' && pathname === '/api/sessions') {
    const id = url.searchParams.get('id');
    const idx = sessions.findIndex(s => s.id === id);
    if (idx < 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'session 不存在' }));
    }
    const deleted = sessions.splice(idx, 1)[0];
    trashedSessions.push({ session: deleted, deletedAt: Date.now() });
    if (!sessions.length) sessions.push(newSession());
    if (activeSessionId === id) activeSessionId = sessions[0].id;
    saveSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, activeId: activeSessionId, trashed: deleted.id }));
  }

  // GET /api/sessions/trash — 列出回收站中的 session
  if (req.method === 'GET' && pathname === '/api/sessions/trash') {
    const now = Date.now();
    // 清理过期条目
    trashedSessions = trashedSessions.filter(t => now - t.deletedAt < TRASH_RETENTION_MS);
    const list = trashedSessions.map(t => ({
      id: t.session.id,
      name: t.session.name,
      deletedAt: t.deletedAt,
      expiresAt: t.deletedAt + TRASH_RETENTION_MS,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ trash: list }));
  }

  // POST /api/sessions/restore — 从回收站恢复 session
  if (req.method === 'POST' && pathname === '/api/sessions/restore') {
    const body = await readBody(req);
    const id = body.id;
    const idx = trashedSessions.findIndex(t => t.session.id === id);
    if (idx < 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '回收站中不存在该 session' }));
    }
    const restored = trashedSessions.splice(idx, 1)[0].session;
    sessions.push(restored);
    activeSessionId = restored.id;
    saveSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, session: restored, activeId: activeSessionId }));
  }

  // GET /api/history?sessionId=xxx — 返回指定 session 的历史
  if (req.method === 'GET' && pathname === '/api/history') {
    const sid = url.searchParams.get('sessionId') || activeSessionId;
    const s = getSession(sid) || getActiveSession();
    const allHistory = s?.history || [];
    const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '40', 10);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 40, 1), 100);
    const requestedBefore = Number.parseInt(url.searchParams.get('before') || String(allHistory.length), 10);
    const before = Math.min(Math.max(Number.isFinite(requestedBefore) ? requestedBefore : allHistory.length, 0), allHistory.length);
    const start = Math.max(0, before - limit);
    const history = allHistory.slice(start, before);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      sessionId: s?.id,
      history,
      page: {
        start,
        end: before,
        limit,
        total: allHistory.length,
        hasMore: start > 0,
        nextBefore: start > 0 ? start : null,
      },
    }));
  }

  // POST /api/chat { message, sessionId? } — SSE 流式对话，支持 @mention 路由
  if (req.method === 'POST' && pathname === '/api/chat') {
    const body = await readBody(req);
    const message = (body.message || '').trim();
    const clientRunId = String(body.clientRunId || '');
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!message && !attachments.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'message 不能为空' }));
    }

    const session = (body.sessionId && getSession(body.sessionId)) || getActiveSession();
    // 客户端指定 sessionId 时同步切换激活
    if (body.sessionId && getSession(body.sessionId)) activeSessionId = body.sessionId;

    // 解析 @mention 路由；如果默认 codex 不可启动，就自动选一个可用 agent。
    const requestedAgent = parseAtMention(message) || agentKeys()[0] || 'codex';
    const { agentKey, status: agentStatus } = await resolveRunnableAgent(requestedAgent);
    const textMessage = stripAtMentions(message).trim();
    const imageOnlyMessage = attachments.length && !textMessage
      ? '请分析我刚上传的图片，并直接回复你观察到的内容、问题和建议。'
      : textMessage;
    const cleanMessage = `${imageOnlyMessage}${attachmentPrompt(attachments)}`.trim();

    maybeAutoRenameSession(session, cleanMessage || message);
    recordSessionMode(session, 'chat');

    // 存入对话历史（按 session）
    session.history.push({ role: 'user', text: message, agent: null, attachments });
    saveSessions();

    const prompt = buildChatPrompt(cleanMessage, agentKey, session.history);

    sseInit(res);
    sseSend(res, 'start', { agent: agentKey, sessionId: session.id });

    let fullReply = '';
    try {
      if (!agentStatus?.available) {
        throw new Error(`${agentKey} 不可用：${agentStatus?.error || '没有可启动的 agent'}`);
      }
      fullReply = await streamAgent(agentKey, prompt, res, 'chunk', { sessionId: session.id, clientRunId });
      session.history.push({ role: 'assistant', text: fullReply, agent: agentKey });
      if (session.history.length > 40) session.history.splice(0, session.history.length - 40);
      saveSessions();
      sseSend(res, 'done', { agent: agentKey, sessionId: session.id });
    } catch (err) {
      // 不再 pop 用户消息，保留失败现场让用户刷新后能看到
      session.history.push({
        role: 'system',
        text: `调用 ${agentKey} 失败：${err.message}`,
        agent: agentKey,
        kind: 'chat-error',
      });
      saveSessions();
      sseSend(res, 'error', { message: err.message });
    }
    return res.end();
  }

  // GET /api/status — agent 配置 + 路径检测
  if (req.method === 'GET' && pathname === '/api/status') {
    const agents = await getAgentStatuses();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ agents, workspace: currentWorkspace() }));
  }

  // GET /api/agents — 返回当前 agent 路径配置（脱敏显示）
  if (req.method === 'GET' && pathname === '/api/agents') {
    const result = await getAgentStatuses();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ agents: result, workspace: currentWorkspace() }));
  }

  // PATCH /api/agents/:key — 更新单个 agent 的角色卡字段
  const agentPatchMatch = pathname.match(/^\/api\/agents\/([^\/]+)$/);
  if (req.method === 'PATCH' && agentPatchMatch) {
    const agentKey = decodeURIComponent(agentPatchMatch[1]);
    const body = await readBody(req);
    const current = readAgentRegistry(ENV);
    const idx = current.findIndex(a => a.key === agentKey);
    if (idx === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `agent ${agentKey} 不存在` }));
    }
    // 只允许更新角色卡字段和基础展示字段
    const allowed = ['label', 'emoji', 'desc', 'baseUrl', 'apiKey', 'model', 'roleDescription', 'personality', 'strengths', 'restrictions'];
    for (const field of allowed) {
      if (body[field] !== undefined) current[idx][field] = body[field];
    }
    writeAgentRegistry(current);
    reloadAgentConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, agent: current[idx] }));
  }

  // POST /api/agents { codex?: string, claude?: string, kimi?: string } — 写回 .env，实时重载
  if (req.method === 'POST' && pathname === '/api/agents') {
    const body = await readBody(req);
    const current = readAgentRegistry(ENV);
    const nextAgents = Array.isArray(body.agents)
      ? body.agents
      : current.map(agent => ({
          ...agent,
          path: body[agent.key] !== undefined ? String(body[agent.key] || '').trim() : agent.path,
        }));

    writeAgentRegistry(nextAgents);
    reloadAgentConfig();
    const updatedAgents = await getAgentStatuses({ force: true });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, agents: updatedAgents, workspace: currentWorkspace() }));

    const updates = {};
    if (body.codex !== undefined) updates.CODEX_PATH = body.codex.trim();
    if (body.claude !== undefined) updates.CLAUDE_PATH = body.claude.trim();
    if (body.kimi !== undefined) updates.KIMI_PATH = body.kimi.trim();

    if (Object.keys(updates).length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '没有需要更新的字段' }));
    }

    // 读取现有 .env，更新对应 key，写回
    const envPath = '.env';
    let lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split('\n') : [];
    for (const [key, val] of Object.entries(updates)) {
      const idx = lines.findIndex(l => l.startsWith(`${key}=`));
      const newLine = `${key}=${val}`;
      if (idx >= 0) lines[idx] = newLine;
      else lines.push(newLine);
    }
    writeFileSync(envPath, lines.join('\n'), 'utf8');

    // 实时重载 CLI_CONFIG（无需重启服务）
    const newEnv = loadEnv(envPath);
    const newCfg = buildCliConfig(newEnv);
    CLI_CONFIG.codex  = newCfg.codex;
    CLI_CONFIG.claude = newCfg.claude;
    CLI_CONFIG.kimi   = newCfg.kimi;
    clearAgentStatusCache();

    const result = await getAgentStatuses({ force: true });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, agents: result }));
  }

  // GET /api/tasks
  if (req.method === 'GET' && pathname === '/api/tasks') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ tasks: readTasks() }));
  }

  // GET /api/models?baseUrl=...&apiKey=... — 从 OpenAI 兼容 API 拉取模型列表
  if (req.method === 'GET' && pathname === '/api/models') {
    const baseUrl = (url.searchParams.get('baseUrl') || '').trim().replace(/\/+$/, '');
    const apiKey = (url.searchParams.get('apiKey') || '').trim();
    if (!baseUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'baseUrl 不能为空' }));
    }
    try {
      const { default: https } = await import('https');
      const { default: http } = await import('http');
      const modelsUrl = new URL(`${baseUrl}/models`);
      const lib = modelsUrl.protocol === 'https:' ? https : http;
      const reqOptions = { timeout: 5000 };
      if (apiKey) reqOptions.headers = { Authorization: `Bearer ${apiKey}` };
      const data = await new Promise((resolve, reject) => {
        const hreq = lib.get(modelsUrl.toString(), reqOptions, (resp) => {
          let body = '';
          resp.on('data', c => { body += c; });
          resp.on('end', () => {
            try { resolve(JSON.parse(body)); } catch { reject(new Error(`返回非 JSON: ${body.slice(0, 80)}`)); }
          });
        });
        hreq.on('error', reject);
        hreq.on('timeout', () => { hreq.destroy(); reject(new Error('请求超时')); });
      });
      const models = (data.data || data.models || []).map(m => typeof m === 'string' ? m : (m.id || m.name || '')).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ models }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ models: [], error: err.message }));
    }
  }


  if (req.method === 'GET' && pathname === '/api/skills') {
    const skills = readSkills();
    const text = url.searchParams.get('text') || '';
    const agent = url.searchParams.get('agent') || '';
    const phase = url.searchParams.get('phase') || 'run';
    const selected = selectSkills({ text, agent, phase });
    const summary = {
      total: skills.length,
      categories: [...new Set(skills.map(s => s.category).filter(Boolean))],
      agents: ['controller', 'worker', 'reviewer', ...agentKeys()],
      selected: selected.length,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      skills,
      selected,
      summary,
      contextPreview: buildSkillContext(selected),
    }));
  }

  // POST /api/skills/import — 导入 skill（追加 yaml 或单条 JSON）
  if (req.method === 'POST' && pathname === '/api/skills/import') {
    const body = await readBody(req);
    try {
      const lines = [];
      if (typeof body.yaml === 'string' && body.yaml.trim()) {
        // 直接追加 yaml 文本
        lines.push(body.yaml.trimEnd());
      } else if (body.skill && typeof body.skill === 'object') {
        const s = body.skill;
        if (!s.name) throw new Error('skill.name 必填');
        lines.push(`- name: ${s.name}`);
        if (s.category)    lines.push(`  category: ${s.category}`);
        if (s.trigger)     lines.push(`  trigger: ${s.trigger}`);
        if (s.description) lines.push(`  description: ${s.description}`);
        if (s.load)        lines.push(`  load: ${s.load}`);
        if (s.prompt)      lines.push(`  prompt: ${JSON.stringify(s.prompt)}`);
        if (s.mounts && typeof s.mounts === 'object') {
          lines.push('  mounts:');
          for (const [role, on] of Object.entries(s.mounts)) {
            lines.push(`    ${role}: ${on ? 'true' : 'false'}`);
          }
        }
      } else {
        throw new Error('需要 yaml 文本或 skill 对象');
      }
      mkdirSync('.myteam', { recursive: true });
      const header = existsSync(SKILLS_FILE) ? '' : 'skills:\n';
      const append = (header ? header : '') + lines.join('\n') + '\n';
      appendFileSync(SKILLS_FILE, append, 'utf8');
      const skills = readSkills();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, total: skills.length, skills }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // GET /api/invocations — 返回 agent 调用记录，用于轻量成本/稳定性看板
  if (req.method === 'GET' && pathname === '/api/invocations') {
    const invocations = readInvocations();
    const recent = invocations.slice(-200).reverse();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      summary: summarizeInvocations(invocations),
      invocations: recent,
    }));
  }

  // PATCH /api/tasks/:id/agent — 修改任务分配的 agent
  const taskAgentMatch = pathname.match(/^\/api\/tasks\/([^\/]+)\/agent$/);
  if (req.method === 'PATCH' && taskAgentMatch) {
    const taskId = decodeURIComponent(taskAgentMatch[1]);
    const body = await readBody(req);
    const newAgent = (body.agent || '').trim();
    if (!newAgent) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'agent 不能为空' }));
    }
    const tasks = readTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '任务不存在' }));
    }
    task.agent = newAgent;
    writeAllTasks(tasks);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, task }));
  }

  // POST /api/tasks/:id/rerun — 重新执行单个任务
  const rerunMatch = pathname.match(/^\/api\/tasks\/([^\/]+)\/rerun$/);
  if (req.method === 'POST' && rerunMatch) {
    const taskId = decodeURIComponent(rerunMatch[1]);
    const tasks = readTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '任务不存在' }));
    }
    
    // 重置任务状态为 pending
    task.status = 'pending';
    task.result = null;
    task.error = null;
    task.started_at = null;
    task.finished_at = null;
    task.gate_status = null;
    task.review_status = null;
    task.review_note = null;
    task.reviewed_at = null;
    task.reviewer = null;
    task.test_status = null;
    task.previous_result = null;
    writeAllTasks(tasks);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, task }));
  }

  // POST /api/tasks/:id/gate — 人工 Reviewer Gate：通过或要求返工
  const gateMatch = pathname.match(/^\/api\/tasks\/([^\/]+)\/gate$/);
  if (req.method === 'POST' && gateMatch) {
    const taskId = decodeURIComponent(gateMatch[1]);
    const body = await readBody(req);
    const decision = body.decision;
    const note = (body.note || '').trim();
    const tasks = readTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '任务不存在' }));
    }

    if (!['pass', 'rework'].includes(decision)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'decision 必须是 pass 或 rework' }));
    }

    if (decision === 'pass' && task.status !== 'done') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '只有已完成任务才能通过 Gate' }));
    }

    const now = new Date().toISOString();
    if (decision === 'pass') {
      Object.assign(task, {
        gate_status: 'passed',
        review_status: 'passed',
        review_note: note || '人工确认通过',
        reviewed_at: now,
        reviewer: 'human',
        test_status: 'manual_passed',
      });
    } else {
      Object.assign(task, {
        status: 'pending',
        gate_status: 'rework',
        review_status: 'rework',
        review_note: note || '人工要求返工，请按验收标准补齐结果',
        reviewed_at: now,
        reviewer: 'human',
        test_status: 'manual_rework',
        previous_result: task.result || task.previous_result || null,
        result: null,
        error: null,
        started_at: null,
        finished_at: null,
      });
    }

    writeAllTasks(tasks);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, task }));
  }

  // DELETE /api/tasks/:id — 删除单个任务
  const deleteMatch = pathname.match(/^\/api\/tasks\/([^\/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const taskId = decodeURIComponent(deleteMatch[1]);
    const tasks = readTasks();
    const filtered = tasks.filter(t => t.id !== taskId);
    if (filtered.length === tasks.length) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '任务不存在' }));
    }
    writeAllTasks(filtered);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, deleted: taskId }));
  }

  // GET /api/lessons — 返回踩坑记录
  if (req.method === 'GET' && pathname === '/api/lessons') {
    let lessons = [];
    if (existsSync(LESSONS_FILE)) {
      lessons = readFileSync(LESSONS_FILE, 'utf8')
        .split('\n').filter(l => l.trim())
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ lessons }));
  }

  // POST /api/plan { goal, agent, sessionId?, attachments? } — SSE 流式返回
  if (req.method === 'POST' && pathname === '/api/plan') {
    const body = await readBody(req);
    const goal = (body.goal || '').trim();
    const clientRunId = String(body.clientRunId || '');
    const agentKey = body.agent || agentKeys()[0] || 'codex';
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!goal && !attachments.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'goal 不能为空' }));
    }

    const session = (body.sessionId && getSession(body.sessionId)) || getActiveSession();
    if (body.sessionId && getSession(body.sessionId)) activeSessionId = body.sessionId;
    recordSessionMode(session, 'plan');
    maybeAutoRenameSession(session, goal || '图片拆任务');
    session.history.push({ role: 'user', text: goal, agent: null, kind: 'plan-goal', attachments });
    saveSessions();

    sseInit(res);
    sseSend(res, 'start', { goal, agent: agentKey, sessionId: session.id });

    try {
      const agentStatus = (await getAgentStatuses()).find(a => a.key === agentKey);
      if (!agentStatus?.available) {
        throw new Error(`${agentKey} 不可用：${agentStatus?.error || '没有可启动的 agent'}。请在右上角 Agent 配置里换成可启动的 CLI。`);
      }
      const effectiveGoal = goal || '请根据上传的图片内容制定合理的执行计划';
      const skillContext = buildSkillContext(selectSkills({ text: effectiveGoal, agent: agentKey, phase: 'plan' }));
      // 拆任务阶段不让 agent 直接看图（避免 view_image 工具调用导致 exit 1）；
      // 只告知"有图"，由后续执行 agent 阶段处理读图。
      const imgPrompt = attachmentPromptForPlan(attachments);
      const prompt = `${PLAN_PROMPT}${skillContext ? `\n\n本次按需加载的 Skills：\n${skillContext}` : ''}\n\n用户目标：${effectiveGoal}${imgPrompt}`;
      const raw = await streamAgent(agentKey, prompt, res, 'chunk', { skipRoleCard: true, sessionId: session.id, clientRunId });
      const data = extractJson(raw);
      // 教训2: 严格验证，防止幻觉数据写入 tasks.jsonl
      const validation = validatePlanResult(data);
      if (!validation.ok) {
        // 把失败现场写入 session 历史，刷新后还能看到
        session.history.push({
          role: 'system',
          text: `拆任务失败：${validation.reason}\n原始输出（前 400 字）：\n${raw.slice(0, 400)}`,
          agent: agentKey,
          kind: 'plan-error',
        });
        saveSessions();
        sseSend(res, 'error', { message: `任务解析失败（${validation.reason}）`, raw: raw.slice(0, 400) });
        return res.end();
      }
      const runId = randomUUID().slice(0, 8);
      const now = new Date().toISOString();
      data.tasks.forEach((t, i) => {
        appendTask({
          id: `${runId}-${i + 1}`,
          run_id: runId,
          created_at: now,
          session_id: session.id, // 关联 session
          goal: data.goal || goal,
          title: t.title ?? `任务 ${i + 1}`,
          steps: t.steps ?? [],
          accept: t.accept ?? '',
          agent: t.agent ?? agentKey,
          status: 'pending',
        });
      });
      const taskSummaries = data.tasks.map((t, i) => ({
        id: `${runId}-${i + 1}`,
        title: t.title ?? `任务 ${i + 1}`,
        agent: t.agent ?? agentKey,
        accept: t.accept ?? '',
        steps: t.steps ?? [],
      }));
      // 把 plan 结果写入 session 历史，刷新后能复现
      session.history.push({
        role: 'plan',
        agent: agentKey,
        kind: 'plan-result',
        runId,
        goal: data.goal || goal,
        tasks: taskSummaries,
        text: `已拆分为 ${taskSummaries.length} 个任务（run ${runId}）`,
      });
      saveSessions();
      sseSend(res, 'done', { runId, written: data.tasks.length, tasks: taskSummaries });
    } catch (err) {
      session.history.push({
        role: 'system',
        text: `拆任务失败：${err.message}`,
        agent: agentKey,
        kind: 'plan-error',
      });
      saveSessions();
      // 把完整错误信息（含 stderr）暴露给前端，方便用户排查
      sseSend(res, 'error', { message: err.message, raw: '' });
    }
    return res.end();
  }

  // POST /api/dispatch { runId?, taskId?, agent? } — SSE
  // 支持 A2A Worklist：agent 回复中的 @mention 自动触发链式任务
  if (req.method === 'POST' && pathname === '/api/dispatch') {
    const body = await readBody(req);
    const clientRunId = String(body.clientRunId || '');
    const sessionId = String(body.sessionId || '');
    const filterRun = body.runId || '';
    const filterTask = body.taskId || '';
    const filterAgent = body.agentOnly || '';
    const agentOverride = body.agent || '';

    let pending = readTasks().filter(t => t.status === 'pending');
    if (filterRun) pending = pending.filter(t => t.run_id === filterRun);
    if (filterTask) pending = pending.filter(t => t.id === filterTask);
    if (filterAgent) pending = pending.filter(t => t.agent === filterAgent);

    sseInit(res);
    sseSend(res, 'start', { count: pending.length, agentOnly: filterAgent || null });

    // 教训4: dispatch 前先备份，防止执行过程中数据意外丢失
    const backupPath = backupTasks();
    if (backupPath) sseSend(res, 'backup', { path: backupPath });

    if (!pending.length) {
      sseSend(res, 'done', { done: 0, failed: 0 });
      return res.end();
    }

    let done = 0, failed = 0;

    // 执行单个任务并返回结果文本（用于 worklist 链检测）
    async function executeTask(task, depth = 0, chainHistory = []) {
      // 优先用 agentOverride（全局覆盖），其次用任务分配的 agent（需可用），最后 fallback 到第一个可用 agent
      let agentKey = agentOverride;
      if (!agentKey) {
        const statuses = await getAgentStatuses();
        const taskAgentStatus = statuses.find(a => a.key === task.agent);
        if (taskAgentStatus?.available) {
          agentKey = task.agent;
        } else {
          // 任务指定的 agent 不可用，找第一个可用的
          const fallback = statuses.find(a => a.available);
          agentKey = fallback?.key || agentKeys()[0] || 'codex';
          sseSend(res, 'system', { text: `⚠️ ${task.agent} 不可用，改用 ${agentKey} 执行任务「${task.title}」` });
        }
      }
      sseSend(res, 'task-start', { id: task.id, title: task.title, agent: agentKey });
      patchTask(task.id, { status: 'in_progress', started_at: new Date().toISOString() });

      try {
        const skillText = [task.goal, task.title, task.accept, ...(task.steps || [])].join('\n');
        const skillContext = buildSkillContext(selectSkills({ text: skillText, agent: agentKey, phase: 'run' }));
        const result = await streamAgent(agentKey, buildExecPrompt(task, skillContext), res, `task-chunk:${task.id}`, { sessionId, clientRunId });
        patchTask(task.id, {
          status: 'done',
          finished_at: new Date().toISOString(),
          executed_by: agentKey,
          result: result?.slice(0, 2000),
        });
        const summary = result ? result.slice(0, 200) : '';
        sseSend(res, 'task-done', { id: task.id, title: task.title, agent: agentKey, summary });
        done++;

        // A2A Worklist：扫描回复中的 @mention，自动创建并执行链式任务
        if (result && depth < WORKLIST_MAX_DEPTH) {
          const mentions = parseA2AMentions(result);
          for (const nextAgent of mentions) {
            if (nextAgent === agentKey) continue; // 跳过自己，防止死循环
            
            // IMP-002: 乒乓球熔断检测（防止 A→B→A→B 无限交替）
            const newHistory = [...chainHistory, agentKey];
            const tail = newHistory.slice(-4);
            const isPingPong = tail.length >= 4
              && tail[0] === tail[2] && tail[1] === tail[3]
              && tail[0] !== tail[1];
            if (isPingPong) {
              sseSend(res, 'worklist-circuit-break', {
                reason: `乒乓球熔断：${tail.join(' → ')} 交替循环，终止链式执行`,
                chain_history: newHistory,
              });
              continue;
            }
            
            const chainId = randomUUID().slice(0, 8);
            // IMP-003: 携带上游 agent 的分析摘要（参考 clowder-ai 五件套交接）
            const upstreamSummary = result.slice(0, 300).replace(/\n+/g, ' ').trim();
            const chainTask = {
              id: `${task.run_id}-w${chainId}`,
              run_id: task.run_id,
              created_at: new Date().toISOString(),
              goal: task.goal,
              title: `[A2A] ${agentKey} → @${nextAgent}: ${task.title}`,
              steps: [
                `上游 ${agentKey} 的分析：${upstreamSummary}`,
                `继续处理「${task.title}」的后续工作`,
              ],
              accept: '',
              agent: nextAgent,
              status: 'pending',
              parent_task_id: task.id,
              chain_depth: depth + 1,
            };
            appendTask(chainTask);
            sseSend(res, 'worklist-chain', {
              from: agentKey,
              to: nextAgent,
              parent_id: task.id,
              chain_task_id: chainTask.id,
            });
            await executeTask(chainTask, depth + 1, newHistory);
          }
        }
        return result;
      } catch (err) {
        patchTask(task.id, {
          status: 'failed',
          finished_at: new Date().toISOString(),
          executed_by: agentKey,
          error: err.message,
        });
        appendLesson(task, err);
        sseSend(res, 'task-failed', { id: task.id, title: task.title, agent: agentKey, error: err.message });
        failed++;
        return null;
      }
    }

    for (const task of pending) {
      await executeTask(task, 0);
    }

    sseSend(res, 'done', { done, failed });
    return res.end();
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

const server = createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error('handler error:', err);
    if (!res.headersSent) res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ 端口 ${PORT} 已被占用。`);
    console.error(`  请先关闭占用该端口的进程，或用以下命令强制释放：`);
    console.error(`\n    Windows: for /f "tokens=5" %a in ('netstat -aon ^| findstr ":${PORT}"') do taskkill /F /PID %a`);
    console.error(`\n  或指定其他端口：py -3 myteam.py serve --port 7879\n`);
  } else {
    console.error('server error:', err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`\n  myteam server running on http://localhost:${PORT}\n`);
});
