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
      }
    });

    child.stderr?.on('data', (data) => {
      touch(); // 教训1: stderr 也是活跃信号
    });

    child.on('close', (code) => {
      clearInterval(watchdog);
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
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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

  // GET /api/tasks
  if (req.method === 'GET' && pathname === '/api/tasks') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ tasks: readTasks() }));
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
      sseSend(res, 'done', { runId, written: data.tasks.length });
    } catch (err) {
      sseSend(res, 'error', { message: err.message });
    }
    return res.end();
  }

  // POST /api/dispatch { runId?, taskId?, agent? } — SSE
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

    for (const task of pending) {
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
        sseSend(res, 'task-done', { id: task.id });
        done++;
      } catch (err) {
        patchTask(task.id, {
          status: 'failed',
          finished_at: new Date().toISOString(),
          executed_by: agentKey,
          error: err.message,
        });
        sseSend(res, 'task-failed', { id: task.id, error: err.message });
        failed++;
      }
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
