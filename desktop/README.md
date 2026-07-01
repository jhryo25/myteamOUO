# myteam Desktop — Electron 桌面客户端

## 快速开始

### 1. 安装依赖

在终端中执行（**不要在 WorkBuddy 沙箱中执行**）：

```bash
cd desktop
npm install
```

> 如果 Electron 二进制下载失败，设置镜像：
> ```bash
> # 中国大陆用户推荐使用淘宝镜像
> set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> npm install
> ```

### 2. 开发模式启动

```bash
npm start
```

开发模式特性：
- 自动打开 DevTools（detach 模式）
- 主进程 console.log 输出到终端
- 渲染进程 console 日志被捕获到桌面日志文件

### 3. 打包

```bash
# 免安装目录（测试用）
npm run pack

# 生成安装包（.exe）
npm run dist
```

输出目录：`dist/`
- `myteam Setup 0.1.0.exe` — NSIS 安装包
- `myteam-0.1.0-portable.exe` — 免安装版

## 日志监控

### 方式 1：日志监控窗口
- 点击顶栏的 📋 按钮（仅在桌面端显示）
- 实时显示所有日志（info/warn/error）
- 支持过滤只看警告/错误
- 支持打开日志文件

### 方式 2：DevTools 控制台
- 开发模式自动打开
- 打包后可通过快捷键 `Ctrl+Shift+I` 打开（需在 main.js 中启用）

### 方式 3：日志文件
- 路径：`%APPDATA%/myteam/data/desktop.log`
- 包含主进程日志 + 渲染进程 console 日志 + 服务启动日志

### 方式 4：终端输出
- 开发模式下，主进程日志直接输出到终端

## 日志架构

```
┌─────────────────────────────────────────┐
│           Electron 主进程               │
│                                         │
│  log() ──→ 文件 (desktop.log)          │
│         ──→ 日志监控窗口 (IPC)          │
│         ──→ 终端 (开发模式)             │
│                                         │
│  渲染进程 console ──→ 主进程 log()      │
│  (webContents.on('console-message'))    │
└─────────────────────────────────────────┘
```

## 数据目录

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%/myteam/data/` |
| macOS | `~/Library/Application Support/myteam/data/` |

包含：
- `myteam.sqlite` — 主数据库
- `desktop.log` — 桌面端日志

## 配置

### Agent CLI 路径
桌面端启动后，点击 ⚙ 按钮配置 Agent CLI 路径（kimi/claude/codex）。
配置存储在 `%APPDATA%/myteam/data/settings.json`。

### 端口
默认 7878，如被占用自动尝试 7879-7898。

## 技术细节

### node:sqlite 实验性 API
Electron 35 内置 Node 22.x，`node:sqlite` 需要 `--experimental-sqlite` flag。
main.js 通过 `NODE_OPTIONS` 环境变量自动设置。

### better-sqlite3 原生模块
`@langchain/langgraph-checkpoint-sqlite` 依赖 `better-sqlite3`（C++ 原生模块）。
打包时 electron-builder 会自动重建（`npmRebuild: true`）。
`asarUnpack` 配置确保 better-sqlite3 的 .node 文件在 asar 包外。

### ESM 兼容
`server.mjs` 是 ESM 模块，Electron main.js 是 CJS。
通过动态 `import()` 加载 server.mjs。

## 常见问题

### Q: Electron 下载失败
A: 使用镜像 `set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`

### Q: better-sqlite3 编译失败
A: 安装 Windows Build Tools：`npm install --global windows-build-tools`
或使用 `npm run rebuild` 重新编译。

### Q: 端口被占用
A: 桌面端会自动尝试 7879-7898，如全部被占用请检查防火墙设置。

### Q: Agent CLI 找不到
A: 在 ⚙ 设置中配置正确的 CLI 路径，或确保 CLI 在系统 PATH 中。
