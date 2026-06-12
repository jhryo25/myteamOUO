// myteam HTTP server — REST API + SSE
// 用法：node server.mjs [--port 7878]

import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, copyFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { loadEnv, buildCliConfig, invokeAgent, extractJson, PARSERS, validatePlanResult } from './agent-utils.mjs';

const ENV = loadEnv();
const CLI_CONFIG = buildCliConfig(ENV);
const TASKS_FILE = '.myteam/tasks.jsonl';
const LESSONS_FILE = '.myteam/lessons.jsonl';

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

// ── 对话历史 + Session 隔离（持久化到 .myteam/memory.json） ───
// 数据结构: { sessions: [{ id, name, created_at, history: [...] }], activeId }
const MEMORY_FILE = '.myteam/memory.json';
const DEFAULT_SESSION_NAME = '默认对话';

// 内存数据：sessions 数组 + 当前激活的 session id
let sessions = [];
let activeSessionId = null;
let trashedSessions = []; // 回收站：{ session, deletedAt }
const TRASH_RETENTION_MS = 5 * 60 * 1000; // 5 分钟

function newSession(name) {
  return {
    id: randomUUID().slice(0, 8),
    name: name || DEFAULT_SESSION_NAME,
    created_at: new Date().toISOString(),
    history: [],
  };
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
      }));
      activeSessionId = data.activeId && getSession(data.activeId)
        ? data.activeId : sessions[0].id;
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
};
function parseAtMention(text) {
  // 匹配 @claude 或 @codex（不区分大小写，允许在任意位置）
  const m = text.match(/@(claude|codex)\b/i);
  return m ? MENTION_MAP[m[1].toLowerCase()] : null;
}

// ── A2A Worklist：从 agent 回复中提取 @mention 触发链式执行 ────
// 行首匹配（允许前导空白），防止代码注释 /  casual 提及误触发
function parseA2AMentions(text) {
  const mentions = [];
  const re = /(?:^|\n)\s*@(claude|codex)\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = MENTION_MAP[m[1].toLowerCase()];
    if (key && !mentions.includes(key)) mentions.push(key);
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
function readTasks() {
  if (!existsSync(TASKS_FILE)) return [];
  return readFileSync(TASKS_FILE, 'utf8')
    .split('\n').filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function writeAllTasks(tasks) {
  writeFileSync(TASKS_FILE, tasks.map(t => JSON.stringify(t)).join('\n') + '\n', 'utf8');
}

function appendTask(record) {
  appendFileSync(TASKS_FILE, JSON.stringify(record) + '\n', 'utf8');
}

function patchTask(id, patch) {
  const tasks = readTasks();
  writeAllTasks(tasks.map(t => t.id === id ? { ...t, ...patch } : t));
}

// ── 系统 prompt（与 plan.mjs 保持一致） ───────────────────────
const PLAN_PROMPT = `你是 myteam 的任务规划 agent。
用户会给你一个目标，把它拆成 3-7 个可执行、可验收的小任务。

严格按以下 JSON 格式返回，不要有任何额外解释或 markdown 包裹：
{
  "goal": "<原始目标>",
  "tasks": [
    {
      "title": "<任务标题>",
      "steps": ["<步骤1>", "<步骤2>"],
      "accept": "<验收标准>",
      "agent": "<推荐执行者: claude|codex>"
    }
  ]
}`;

function buildExecPrompt(task) {
  const steps = (task.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const accept = task.accept ? `\n验收标准：${task.accept}` : '';
  return `你是 myteam 的执行 agent，请完成以下任务。

任务标题：${task.title}
所属目标：${task.goal}

执行步骤：
${steps || '（无具体步骤，请自行判断）'}
${accept}

请执行上述任务，给出完整的执行结果和说明。`;
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
const activeChildren = new Map(); // id → child process
let childIdSeq = 0;

function abortAllChildren() {
  for (const [id, child] of activeChildren) {
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
  }
  activeChildren.clear();
}

// ── 调用 agent 并实时流到 SSE ─────────────────────────────────
// 教训1 (02-cli-engineering): readline 接管 stdout 后，child.stdout.on('data') 不再触发。
// watchdog 必须在 rl.on('line') 和 stderr.on('data') 里刷新。
// 教训1: 超时 30min，匹配复杂任务实际需要。
function streamAgent(agentKey, prompt, res, label = 'chunk') {
  const cfg = CLI_CONFIG[agentKey];
  if (!cfg?.path) {
    sseSend(res, 'error', { message: `${agentKey} 路径未在 .env 中配置` });
    return Promise.reject(new Error('missing path'));
  }

  const parser = PARSERS[agentKey];
  const isCmd = cfg.path.toLowerCase().endsWith('.cmd');
  const spawnPath = isCmd ? 'cmd.exe' : cfg.path;
  const spawnArgs = isCmd ? ['/c', cfg.path, ...cfg.args()] : cfg.args();

  return new Promise((resolve, reject) => {
    const child = spawn(spawnPath, spawnArgs, cfg.spawnOptions);
    const cid = ++childIdSeq;
    activeChildren.set(cid, child);

    child.stdin.write(prompt, 'utf8');
    child.stdin.end();

    let fullText = '';
    let lastActivity = Date.now();
    const touch = () => { lastActivity = Date.now(); };
    const TIMEOUT_MS = 30 * 60 * 1000; // 教训1: 30min

    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > TIMEOUT_MS) {
        child.kill('SIGTERM');
        clearInterval(watchdog);
        reject(new Error('timeout after 30min'));
      }
    }, 10_000);

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      touch(); // 教训1: readline 接管后在这里刷新
      if (!line.trim()) return;
      const text = parser(line);
      if (text) {
        fullText += text;
        sseSend(res, label, { text });
        if (label !== 'chunk') sseSend(res, 'chunk', { text });
      }
    });

    child.stderr?.on('data', (data) => {
      touch(); // 教训1: stderr 也是活跃信号
    });

    child.on('close', (code) => {
      clearInterval(watchdog);
      activeChildren.delete(cid);
      if (code !== 0) reject(new Error(`exit code ${code}`));
      else resolve(fullText);
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

// ── 静态文件 MIME ─────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml' };

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

  // POST /api/abort — 中断所有正在执行的 agent 子进程
  if (req.method === 'POST' && pathname === '/api/abort') {
    const count = activeChildren.size;
    abortAllChildren();
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
    const s = newSession((body.name || '').trim() || `对话 ${sessions.length + 1}`);
    sessions.push(s);
    activeSessionId = s.id;
    saveSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, session: s, activeId: activeSessionId }));
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ sessionId: s?.id, history: s?.history || [] }));
  }

  // POST /api/chat { message, sessionId? } — SSE 流式对话，支持 @mention 路由
  if (req.method === 'POST' && pathname === '/api/chat') {
    const body = await readBody(req);
    const message = (body.message || '').trim();
    if (!message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'message 不能为空' }));
    }

    const session = (body.sessionId && getSession(body.sessionId)) || getActiveSession();
    // 客户端指定 sessionId 时同步切换激活
    if (body.sessionId && getSession(body.sessionId)) activeSessionId = body.sessionId;

    // 解析 @mention 路由
    const agentKey = parseAtMention(message) || 'codex';
    const cleanMessage = message.replace(/^@(claude|codex)\s*/i, '').trim();

    // 存入对话历史（按 session）
    session.history.push({ role: 'user', text: message, agent: null });

    const prompt = buildChatPrompt(cleanMessage, agentKey, session.history);

    sseInit(res);
    sseSend(res, 'start', { agent: agentKey, sessionId: session.id });

    let fullReply = '';
    try {
      fullReply = await streamAgent(agentKey, prompt, res, 'chunk');
      session.history.push({ role: 'assistant', text: fullReply, agent: agentKey });
      if (session.history.length > 40) session.history.splice(0, session.history.length - 40);
      saveSessions();
      sseSend(res, 'done', { agent: agentKey, sessionId: session.id });
    } catch (err) {
      session.history.pop();
      saveSessions();
      sseSend(res, 'error', { message: err.message });
    }
    return res.end();
  }

  // GET /api/status — agent 配置 + 路径检测
  if (req.method === 'GET' && pathname === '/api/status') {
    const agents = ['codex', 'claude'].map(k => {
      const p = CLI_CONFIG[k]?.path;
      return {
        key: k,
        configured: Boolean(p),
        available: p ? existsSync(p) : false,
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ agents }));
  }

  // GET /api/agents — 返回当前 agent 路径配置（脱敏显示）
  if (req.method === 'GET' && pathname === '/api/agents') {
    const result = ['codex', 'claude'].map(k => {
      const p = CLI_CONFIG[k]?.path || '';
      return {
        key: k,
        path: p,
        available: p ? existsSync(p) : false,
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ agents: result }));
  }

  // POST /api/agents { codex?: string, claude?: string } — 写回 .env，实时重载
  if (req.method === 'POST' && pathname === '/api/agents') {
    const body = await readBody(req);
    const updates = {};
    if (body.codex !== undefined) updates.CODEX_PATH = body.codex.trim();
    if (body.claude !== undefined) updates.CLAUDE_PATH = body.claude.trim();

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

    const result = ['codex', 'claude'].map(k => {
      const p = CLI_CONFIG[k]?.path || '';
      return { key: k, path: p, available: p ? existsSync(p) : false };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, agents: result }));
  }

  // GET /api/tasks
  if (req.method === 'GET' && pathname === '/api/tasks') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ tasks: readTasks() }));
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

  // POST /api/plan { goal, agent } — SSE 流式返回
  if (req.method === 'POST' && pathname === '/api/plan') {
    const body = await readBody(req);
    const goal = (body.goal || '').trim();
    const agentKey = body.agent || 'codex';
    if (!goal) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'goal 不能为空' }));
    }

    sseInit(res);
    sseSend(res, 'start', { goal, agent: agentKey });

    try {
      const raw = await streamAgent(agentKey, `${PLAN_PROMPT}\n\n用户目标：${goal}`, res, 'chunk');
      const data = extractJson(raw);
      // 教训2: 严格验证，防止幻觉数据写入 tasks.jsonl
      const validation = validatePlanResult(data);
      if (!validation.ok) {
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
      sseSend(res, 'done', { runId, written: data.tasks.length, tasks: taskSummaries });
    } catch (err) {
      sseSend(res, 'error', { message: err.message });
    }
    return res.end();
  }

  // POST /api/dispatch { runId?, taskId?, agent? } — SSE
  // 支持 A2A Worklist：agent 回复中的 @mention 自动触发链式任务
  if (req.method === 'POST' && pathname === '/api/dispatch') {
    const body = await readBody(req);
    const filterRun = body.runId || '';
    const filterTask = body.taskId || '';
    const agentOverride = body.agent || '';

    let pending = readTasks().filter(t => t.status === 'pending');
    if (filterRun) pending = pending.filter(t => t.run_id === filterRun);
    if (filterTask) pending = pending.filter(t => t.id === filterTask);

    sseInit(res);
    sseSend(res, 'start', { count: pending.length });

    // 教训4: dispatch 前先备份，防止执行过程中数据意外丢失
    const backupPath = backupTasks();
    if (backupPath) sseSend(res, 'backup', { path: backupPath });

    if (!pending.length) {
      sseSend(res, 'done', { done: 0, failed: 0 });
      return res.end();
    }

    let done = 0, failed = 0;

    // 执行单个任务并返回结果文本（用于 worklist 链检测）
    async function executeTask(task, depth = 0) {
      const agentKey = agentOverride || (CLI_CONFIG[task.agent] ? task.agent : 'codex');
      sseSend(res, 'task-start', { id: task.id, title: task.title, agent: agentKey });
      patchTask(task.id, { status: 'in_progress', started_at: new Date().toISOString() });

      try {
        const result = await streamAgent(agentKey, buildExecPrompt(task), res, `task-chunk:${task.id}`);
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
            const chainId = randomUUID().slice(0, 8);
            const chainTask = {
              id: `${task.run_id}-w${chainId}`,
              run_id: task.run_id,
              created_at: new Date().toISOString(),
              goal: task.goal,
              title: `[A2A] ${agentKey} → @${nextAgent}: ${task.title}`,
              steps: [`继续处理「${task.title}」的后续工作`],
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
            await executeTask(chainTask, depth + 1);
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
