// myteam Desktop — Electron 主进程
// 内嵌 HTTP 服务 + 加载前端页面
// 支持 DevTools 日志监控和文件日志

const { app, BrowserWindow, dialog, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');

// ── 常量 ──────────────────────────────────────────────────────────
const DEFAULT_PORT = 7878;
const IS_DEV = !app.isPackaged;

// 用户数据目录 — 优先使用本地目录（避免沙箱阻止 AppData 写入）
// 打包后使用系统 userData 目录
const userDataDir = IS_DEV
  ? path.join(__dirname, '.userdata')  // 开发模式：项目内
  : app.getPath('userData');            // 打包后：系统标准目录
const dataDir = path.join(userDataDir, 'data');

// ── 单实例锁 ──────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error('[myteam] 单实例锁获取失败，退出');
  app.quit();
  process.exit(0);
} else {
  console.log('[myteam] 单实例锁获取成功');
}

// 确保数据目录存在
try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}

// ── 环境变量设置（必须在 import server.mjs 之前）──────────────────
process.env.MYTEAM_DB_PATH = path.join(dataDir, 'myteam.sqlite');

// node:sqlite 实验性 flag（Node 22.x）
if (!process.env.NODE_OPTIONS) {
  process.env.NODE_OPTIONS = '--experimental-sqlite';
} else if (!process.env.NODE_OPTIONS.includes('--experimental-sqlite')) {
  process.env.NODE_OPTIONS += ' --experimental-sqlite';
}

// ── 日志系统 ──────────────────────────────────────────────────────
// 所有日志写入文件 + 转发到 DevTools 控制台（开发模式）
const logFile = path.join(dataDir, 'desktop.log');
const logLines = []; // 内存缓冲，用于日志查看窗口

// 窗口引用（前向声明，避免 log() 中引用未定义变量）
let mainWindow = null;
let splashWindow = null;
let logWindow = null; // 日志监控窗口
let serverPort = DEFAULT_PORT;

function log(msg, level = 'info') {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  try { fs.appendFileSync(logFile, line + '\n'); } catch {}
  logLines.push({ time: new Date().toISOString(), level, msg });
  if (logLines.length > 500) logLines.shift(); // 保留最近 500 条

  // 转发到主窗口 DevTools（如果打开）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop-log', { level, msg, time: new Date().toISOString() });
  }

  // 开发模式也输出到终端
  if (IS_DEV) {
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠' : 'ℹ';
    console.log(`${prefix} ${msg}`);
  }
}

log('=== myteam Desktop 启动 ===');
log(`userData: ${userDataDir}`);
log(`dataDir: ${dataDir}`);
log(`MYTEAM_DB_PATH: ${process.env.MYTEAM_DB_PATH}`);
log(`IS_DEV: ${IS_DEV}`);
log(`process.cwd: ${process.cwd()}`);
log(`__dirname: ${__dirname}`);

// ── 端口检测 ──────────────────────────────────────────────────────
function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port);
  });
}

async function findAvailablePort(preferred) {
  if (await checkPortAvailable(preferred)) return preferred;
  for (let p = preferred + 1; p <= preferred + 20; p++) {
    if (await checkPortAvailable(p)) return p;
  }
  return preferred;
}

// ── 窗口管理 ──────────────────────────────────────────────────────
// (mainWindow, splashWindow, logWindow, serverPort 已在上方声明)

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420, height: 280,
    frame: false, resizable: false, transparent: false, alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

function sendSplashStatus(msg) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash-status', msg);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 900, minHeight: 600,
    title: 'myteam · A2A 控制台',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setMenu(null);
  mainWindow.loadURL(`http://localhost:${serverPort}`);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    mainWindow.show();
    log('主窗口已显示');

    // 开发模式自动打开 DevTools
    if (IS_DEV) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
      log('DevTools 已打开（开发模式）');
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // 阻止导航到外部网站
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://localhost:${serverPort}`)) e.preventDefault();
  });

  // 捕获渲染进程的 console 日志
  mainWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
    const levels = ['verbose', 'info', 'warning', 'error'];
    const lvl = levels[level] || 'info';
    log(`[renderer] ${message} (${path.basename(sourceId || '')}:${line})`, lvl);
  });
}

// ── 日志监控窗口 ──────────────────────────────────────────────────
function createLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.focus();
    return;
  }

  logWindow = new BrowserWindow({
    width: 800, height: 600,
    title: 'myteam 日志监控',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  logWindow.setMenu(null);

  // 生成日志监控 HTML
  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { margin:0; background:#1a1a2e; color:#e0e0e0; font-family:'Consolas','Monaco',monospace; font-size:13px; }
  #toolbar { background:#16213e; padding:8px 12px; display:flex; gap:8px; align-items:center; border-bottom:1px solid #0f3460; }
  #toolbar button { background:#0f3460; color:#e0e0e0; border:none; padding:4px 12px; border-radius:4px; cursor:pointer; font-size:12px; }
  #toolbar button:hover { background:#1a4a7a; }
  #toolbar .info { margin-left:auto; opacity:0.6; font-size:11px; }
  #log { padding:8px 12px; overflow-y:auto; height:calc(100vh - 44px); }
  .line { padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.03); }
  .time { color:#555; margin-right:8px; }
  .level-info { color:#7ec8e3; }
  .level-warn { color:#ffd966; }
  .level-error { color:#ff6b6b; }
  .level-verbose { color:#888; }
  .filter-active .level-info, .filter-active .level-verbose { display:none; }
</style>
</head><body>
<div id="toolbar">
  <button onclick="toggleFilter()">⚠ 只看警告/错误</button>
  <button onclick="clearLog()">清空</button>
  <button onclick="openLogFile()">打开日志文件</button>
  <span class="info" id="count">0 条</span>
</div>
<div id="log"></div>
<script>
  const { ipcRenderer, shell } = require('electron');
  const logEl = document.getElementById('log');
  const countEl = document.getElementById('count');
  let count = 0;
  let filterMode = false;

  function addLine(entry) {
    count++;
    countEl.textContent = count + ' 条';
    const div = document.createElement('div');
    div.className = 'line';
    div.innerHTML = '<span class="time">' + entry.time.substr(11,8) + '</span>' +
      '<span class="level-' + entry.level + '">[' + entry.level + ']</span> ' +
      entry.msg.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    if (logEl.children.length > 1000) logEl.removeChild(logEl.firstChild);
  }

  ipcRenderer.on('desktop-log', (e, entry) => addLine(entry));

  // 发送历史日志
  ipcRenderer.send('get-log-history');

  ipcRenderer.on('log-history', (e, lines) => {
    lines.forEach(addLine);
  });

  function toggleFilter() {
    filterMode = !filterMode;
    document.body.classList.toggle('filter-active', filterMode);
  }

  function clearLog() { logEl.innerHTML = ''; count = 0; countEl.textContent = '0 条'; }

  function openLogFile() { ipcRenderer.send('open-log-file'); }
</script>
</body></html>`;

  // 用 data URL 加载
  logWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  logWindow.on('closed', () => { logWindow = null; });
}

// ── IPC 通信 ──────────────────────────────────────────────────────
ipcMain.on('get-log-history', (e) => {
  e.reply('log-history', logLines.slice(-200));
});

ipcMain.on('open-log-file', () => {
  const { shell } = require('electron');
  shell.openPath(logFile);
});

// 前端可以通过 preload 暴露的 API 请求打开日志窗口
ipcMain.on('open-log-window', () => {
  createLogWindow();
});

// ── 启动内嵌 HTTP 服务 ────────────────────────────────────────────
async function startServer() {
  sendSplashStatus('正在启动本地服务…');

  serverPort = await findAvailablePort(DEFAULT_PORT);
  log(`使用端口: ${serverPort}`);

  const projectRoot = IS_DEV
    ? path.resolve(__dirname, '..')  // 开发模式：上级目录
    : app.getAppPath();               // 打包后：extraResources

  log(`projectRoot: ${projectRoot}`);

  try {
    process.chdir(projectRoot);
    log(`工作目录: ${process.cwd()}`);
  } catch (e) {
    log(`工作目录切换失败: ${e.message}`, 'error');
  }

  sendSplashStatus('正在加载服务模块…');

  // 通过 --port 参数传递端口号
  process.argv.push('--port', String(serverPort));

  try {
    const serverPath = path.join(projectRoot, 'server.mjs');
    log(`加载服务: ${serverPath}`);

    if (!fs.existsSync(serverPath)) {
      throw new Error(`server.mjs 不存在: ${serverPath}`);
    }

    await import(`file://${serverPath.replace(/\\/g, '/')}`);
    log('服务启动成功');
    sendSplashStatus('服务就绪');
  } catch (err) {
    log(`服务启动失败: ${err.message}\n${err.stack || ''}`, 'error');
    sendSplashStatus('服务启动失败');
    throw err;
  }
}

// ── 应用生命周期 ──────────────────────────────────────────────────
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  log('app ready');
  createSplashWindow();

  try {
    await startServer();
    await waitForServer(serverPort, 15000);
    createMainWindow();
  } catch (err) {
    log(`启动失败: ${err.message}`, 'error');
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    dialog.showErrorBox(
      'myteam 启动错误',
      `服务启动失败:\n${err.message}\n\n日志文件:\n${logFile}`,
    );
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => log('应用退出'));

// ── 等待 HTTP 服务就绪 ────────────────────────────────────────────
function waitForServer(port, timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      const req = require('http').get(`http://localhost:${port}/api/agents`, (res) => {
        if (res.statusCode === 200) resolve();
        else retry();
        res.destroy();
      });
      req.on('error', () => retry());
      req.setTimeout(2000, () => { req.destroy(); retry(); });
    }
    function retry() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`服务在 ${timeoutMs}ms 内未就绪`));
      } else {
        setTimeout(check, 300);
      }
    }
    check();
  });
}
