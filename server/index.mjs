// myteam HTTP server — 模块化入口
// 启动方式: node server/index.mjs [--port 7878]
//
// 原 server.mjs (5209 行) 已拆分为:
//   server/config.mjs          - 共享配置 & 常量
//   server/services/*          - 领域服务层
//   server/middleware/*        - HTTP 中间件
//   server/routes/legacy-handle.mjs - 路由处理函数（逐步拆分中）

import { createServer } from 'http';
import { parse } from 'url';
import { existsSync } from 'fs';

// ── 配置 ──
import {
  CLI_CONFIG, SKILL_SOURCES, MIME, SKILL_REGISTRY_TTL_MS, skillRegistryCache,
  loadSettings, saveSettings, currentWorkspace, reloadAgentConfig,
  STUDIO_TEMPLATES,
} from './config.mjs';

// ── 共享服务 ──
import * as chainTask from './services/chain-task.mjs';
export { chainTask };

import * as lessonService from './services/lesson.mjs';
import * as agentStatus from './services/agent-status.mjs';
import * as skillRegistry from './services/skill-registry.mjs';

// ── 中间件 ──
export { handleCors, setCorsHeaders } from './middleware/cors.mjs';

// ── 路由处理器 ──
import { handle as legacyHandle } from './routes/legacy-handle.mjs';

// ── Node 内置依赖 ──
import { readFileSync, existsSync as _fsExists } from 'fs';
if (!_fsExists) { /* used in legacy handler */ }

// ── 注入服务到 config 的延迟导入 ──
import { loadSettings as ls } from './services/agent-status.mjs';
config._imports.loadSettings = ls;

const config = (await import('./config.mjs')).default || (await import('./config.mjs'));

const PORT = parseInt(process.argv[process.argv.indexOf('--port') + 1]) || 7878;

// ── 服务启动 ──
const server = createServer((req, res) => {
  const _start = Date.now();
  console.log('[' + new Date().toISOString() + '] ' + req.method + ' ' + req.url);
  legacyHandle(req, res).catch(err => {
    console.error('handler error:', err);
    if (!res.headersSent) res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  });
  res.on('close', () => {
    const _elapsed = Date.now() - _start;
    console.log('[' + new Date().toISOString() + '] ' + req.method + ' ' + req.url + ' ' + res.statusCode + ' (' + _elapsed + 'ms)');
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  port ${PORT} is in use.`);
    console.error(`  Windows: netstat -aon | findstr ":${PORT}"`);
    console.error(`  Or specify another port: node server/index.mjs --port 7879\n`);
  } else {
    console.error('server error:', err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`\n  myteam server running on http://localhost:${PORT}\n`);
});

export { PORT, CLI_CONFIG, STUDIO_TEMPLATES };
