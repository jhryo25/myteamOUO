# myteamOUO

myteamOUO 是一个本地优先的 A2A（Agent-to-Agent）协作控制台：不依赖云端数据库，不引入复杂框架，用一个 Node HTTP 服务把多个本机 agent CLI、任务拆解、执行、review gate、skills、shell、产物和 lessons 串起来。

项目参考了 [clowder-ai](https://github.com/zts212653/clowder-ai) 的 A2A 协作架构，也吸收了 [LobsterAI](https://github.com/netease-youdao/LobsterAI) 的 Skills 管理、命令安全和子代理追踪思路。

## 快速启动

```bash
git clone https://github.com/jhryo25/myteamOUO.git
cd myteamOUO
cp .env.example .env
node server.mjs --port 7878
```

然后打开：

```text
http://localhost:7878
```

`.env` 里配置本机 agent CLI 路径，例如：

```env
CODEX_PATH=C:\path\to\codex.exe
CLAUDE_PATH=C:\path\to\claude.exe
KIMI_PATH=C:\path\to\kimi.exe
```

## 当前能力

### 多 Agent 协作

- 支持 `@codex`、`@claude`、`@kimi` mention 路由。
- 每个 agent 可配置角色卡、性格、擅长项和限制。
- 对话模式支持流式输出、thinking 面板、图片附件和历史会话。
- 拆任务模式会把目标拆成可验收的 3-7 个子任务。
- 执行任务后自动进入 reviewer gate，降低单模型自检盲区。
- agent 输出中出现新的 `@mention` 时，可自动创建 A2A 链式子任务。

### Skills 市场与导入

- 顶部 `Skills` 入口提供已安装、市场、导入三个视图。
- 官方市场优先读取当前 checkout 的本地 `skills-registry/index.json`，本地缺失时再回退远程。
- 支持从官方市场、clowder-ai manifest、GitHub 仓库、远程 ZIP、本地目录或本地 ZIP 安装 skill。
- 支持启用/禁用、卸载、挂载信息展示。
- 当前官方 registry 包含：
  - `task-planning`
  - `cli-execution`
  - `review-gate`
  - `lesson-capture`
  - `html-ui-alignment`
  - `shell-exec`

### Shell 执行

- 顶部 `Shell` 入口可执行 PowerShell/cmd 命令。
- `commandSafety.mjs` 会把命令分成 `safe`、`caution`、`destructive`。
- 删除、强推、权限修改、进程终止、注册表修改等命令会触发确认。
- stdout/stderr/exit code 通过 SSE 实时返回。
- 前端断开或刷新时不主动杀掉后端命令。

### 子代理会话

- A2A 链式任务会在任务行显示子代理入口。
- `worklist-chain` 事件会在聊天区插入可点击的子代理链接。
- 子代理视图可查看 `task-start`、`task-done`、`task-failed` 事件。
- 后端暂用内存 Map 保存链式任务消息；刷新服务后不会保留该 Map。

### 产物与输出

- 自动提取 agent 输出中的代码块、HTML、JSON、Markdown 和 URL。
- HTML 产物会保存到 `.myteam/outputs/`。
- 产物文件名会做 `basename` 和字符清理，避免路径穿越。
- `/api/outputs/file?name=` 只允许安全文件名，非法路径返回 400。
- 产物面板支持预览、复制和浏览器打开。

### 刷新恢复

- 刷新后会通过 `/api/running` 和 `/api/tasks` 恢复运行态。
- `in_progress` 任务可从 `tasks.jsonl` 恢复。
- 同一个 run 里已有 done 且仍有 pending 的任务，会恢复为可继续的运行提示。
- 恢复逻辑会补齐 `startedAt`，避免计时出现 NaN。

## 架构概览

```text
Browser (localhost:7878)
  ├─ Chat / Sessions / Tasks / Hub
  ├─ Skills / Shell / Artifacts / Subagent View
  └─ SSE streaming UI

server.mjs
  ├─ REST API + SSE
  ├─ agent 调用、任务执行、review gate
  ├─ skill registry / install / import
  ├─ shell execution
  └─ artifact / output serving

agent-utils.mjs
  ├─ CLI 配置与启动检查
  ├─ prompt 构造
  ├─ parser / JSON 提取
  └─ task JSONL 读写

commandSafety.mjs
  └─ shell 命令风险分类

.myteam/
  ├─ tasks.jsonl
  ├─ lessons.jsonl
  ├─ invocations.jsonl
  ├─ memory.json
  ├─ skills/
  └─ outputs/
```

## API 摘要

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/status` | agent 连接状态 |
| GET | `/api/tasks` | 任务列表 |
| POST | `/api/plan` | 拆任务，SSE 返回 |
| POST | `/api/dispatch` | 执行 pending 任务，SSE 返回 |
| GET | `/api/running` | 当前运行中的子进程 |
| POST | `/api/abort` | 停止指定 session/run 的子进程 |
| GET | `/api/history` | 会话历史 |
| GET/POST | `/api/sessions` | 会话列表、新建、切换 |
| GET | `/api/skills` | 已安装 skills 和路由推荐 |
| GET | `/api/skills/registry` | skill 市场清单 |
| POST | `/api/skills/install` | 从市场安装 skill |
| POST | `/api/skills/install-source` | 从 GitHub/URL/本地安装 skill |
| POST | `/api/shell/exec` | 执行 safe shell 命令 |
| POST | `/api/shell/exec-confirm` | 确认后执行 caution/destructive 命令 |
| GET | `/api/shell/stream` | shell 输出 SSE |
| GET | `/api/artifacts` | 对话中提取的产物 |
| GET | `/api/outputs` | 已保存 HTML 输出 |
| GET | `/api/outputs/file` | 安全读取 HTML 输出 |
| GET | `/api/chain-task/messages` | 子代理任务消息 |
| GET | `/api/chain-task/stream` | 子代理任务 SSE |

## 文件结构

```text
myteamOUO/
├── server.mjs
├── agent-utils.mjs
├── commandSafety.mjs
├── plan.mjs
├── dispatch.mjs
├── web/
│   ├── app.html
│   ├── app.js
│   └── app.css
├── skills-registry/
│   ├── index.json
│   ├── task-planning/SKILL.md
│   ├── cli-execution/SKILL.md
│   ├── review-gate/SKILL.md
│   ├── lesson-capture/SKILL.md
│   ├── html-ui-alignment/SKILL.md
│   └── shell-exec/SKILL.md
├── docs/
├── .myteam/
│   ├── tasks.jsonl
│   ├── lessons.jsonl
│   ├── invocations.jsonl
│   ├── memory.json
│   ├── skills/
│   └── outputs/
└── .env
```

## 本轮修复重点（2026-06-17）

- 补齐 `skills-registry/shell-exec/SKILL.md`，修复官方市场中存在坏条目的问题。
- 官方市场读取当前 checkout 的本地 registry，避免本地开发时依赖 GitHub main。
- 本地 registry JSON 解析前去掉 BOM，避免 `JSON.parse` 失败。
- 修复前端 Skills 市场按钮调用错接口的问题。
- 修复 `server.mjs` 中未导入 `dirname` 和不存在的 `chr()`。
- 远程 ZIP 下载改用 Buffer，避免二进制损坏。
- skill name、artifact 文件名、outputs 文件名统一做安全清理。
- `.myteam/outputs/` 和 `.myteam/.tmp-skill-*` 已加入 `.gitignore`。
- 刷新恢复运行态时补齐 `startedAt`，避免计时异常。

## 验证

本轮已验证：

```bash
node --check server.mjs
node --check web/app.js
git diff --check
```

并用本地 `7879` 临时服务验证：

- `/api/skills/registry?source=myteam-official` 能读到 `shell-exec`
- `/api/skills/install` 能安装 `shell-exec`
- `/api/skills/install-source` 能从本地目录安装 `shell-exec`
- `/api/shell/exec` + `/api/shell/stream` 能返回 `OK`
- `/api/outputs/file?name=bad%5Cname` 返回 400

## 运行时数据

以下文件属于本地运行时数据，默认不提交：

- `.myteam/tasks.jsonl`
- `.myteam/lessons.jsonl`
- `.myteam/invocations.jsonl`
- `.myteam/memory.json`
- `.myteam/skills/`
- `.myteam/outputs/`

本轮 review 经验已写入 `.myteam/lessons.jsonl`，用于本地长期记忆。
