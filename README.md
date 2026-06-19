# myteamOUO

myteamOUO 是一个本地优先的 A2A（Agent-to-Agent）协作控制台：不依赖云端数据库，不引入复杂框架，用一个 Node HTTP 服务把多个本机 agent CLI、任务拆解、执行、review gate、skills、shell、产物和 lessons 串起来。

项目参考了 [clowder-ai](https://github.com/zts212653/clowder-ai) 的 A2A 协作架构，也吸收了 [LobsterAI](https://github.com/netease-youdao/LobsterAI) 的 Skills 管理、命令安全和子代理追踪思路。

## 快速启动

```bash
git clone https://github.com/jhryo25/myteamOUO.git
cd myteamOUO
cp .env.example .env
npm install
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

Kimi Code CLI 0.14+ 使用 `--prompt ... --output-format stream-json`；旧配置中的 `--print` 会在加载时自动移除。

运行环境要求 Node.js `22.5+`。项目使用 Node 内置 `node:sqlite`，无需额外安装 SQLite。

## 当前能力

### 多 Agent 协作

- 支持 `@codex`、`@claude`、`@kimi` mention 路由。
- 每个 agent 可配置角色卡、性格、擅长项和限制。
- 对话模式支持流式输出、thinking 面板、图片附件和历史会话。
- 拆任务模式会把目标拆成可验收的 3-7 个子任务。
- 拆任务前后端都会选择真实可启动的 agent；所选 CLI 不可用时服务端自动回退到第一个可用 agent。
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
- 删除、强推、权限修改、进程终止、注册表修改等命令会创建服务端审批，批准后的操作指纹必须与原请求完全匹配。
- stdout/stderr/exit code 通过 SSE 实时返回。
- 前端断开或刷新时不主动杀掉后端命令。

### 权限与审计

- shell、skill 安装/卸载、配置写入和任务 dispatch 统一进入风险策略层。
- 审批弹窗会说明触发原因、批准后的能力影响，以及本次任务数量、选择范围和 Agent；不再用内部操作码和原始 JSON 代替风险说明。
- 审批支持批准一次、会话批准、拒绝和 15 分钟过期；不提供永久授权。
- Hub 的「审批」Tab 展示待处理审批和脱敏审计记录。
- 审计不会保存 Token、Secret、API Key、Cookie 或完整环境变量。
- 权限层只覆盖 myteam 自己管理的入口，不声称逐项控制外部 CLI 内部工具调用。

### SQLite 持久化

- `.myteam/myteam.sqlite` 是 sessions/messages、tasks、lessons、invocations、subagents、approvals、audit 和 schedules 的权威存储。
- 数据库启用 WAL、外键、事务和版本化 migration。
- 首次启动会先把旧 JSON/JSONL 复制到 `.myteam/migrations/legacy-*`，再幂等导入数据库。
- 迁移失败会停止写入并保留原始数据，不会静默创建空状态覆盖旧数据。

### 定时任务

- Hub 的「定时」Tab 支持五段 Cron、时区、启停、删除、手动运行和运行历史。
- 每个计划可绑定 agent、执行模式和 session 策略。
- 触发后默认进入 `waiting_approval`，批准后才启动 agent。
- 同一计划禁止并发重入；服务停机期间错过的触发记录为 `skipped`，不会集中补跑。

### 子代理会话

- 主 agent 可通过结构化 `<spawn_subagent>{...}</spawn_subagent>` 协议动态派生后续 agent。
- 没有结构化块时仍兼容旧的 `@mention` 链式任务。
- 每个派生 run 持久化 `running / done / error` 状态和消息。
- Hub 的「子代理」Tab 展示运行统计、列表和详情入口。
- `worklist-chain` 事件会在聊天区插入可点击的子代理链接。
- 子代理视图可查看 `task-start`、`task-done`、`task-failed` 事件。

### LobsterAI 协作上下文对齐

- Plan 使用 JSON Schema；Codex 优先启用 `--output-schema`，其他 CLI 和不兼容模型走统一 schema 规范化兜底。
- Continuity Capsule 从 session 历史提取目标、约束、决策、完成事实、文件、验证、失败和下一步。
- Top-K Evidence 按任务关键词检索最相关的 3 条历史证据，不再全量注入历史。
- Workspace Bridge 在任务执行前读取 `git status`、最新 commit stat 和工作区 diff stat。
- 三类上下文同时注入执行 agent 和 reviewer，支持跨 turn、跨 agent 接力。
- 结构化 subagent run/message 已进入 SQLite；旧链式任务 Map 仍只作为当前进程的实时缓存。

### 产物与输出

- 自动提取 agent 输出中的代码块、HTML、JSON、Markdown 和 URL。
- HTML 产物会保存到 `.myteam/outputs/`。
- 产物文件名会做 `basename` 和字符清理，避免路径穿越。
- `/api/outputs/file?name=` 只允许安全文件名，非法路径返回 400。
- 产物面板支持预览、复制和浏览器打开。

### 刷新恢复

- 刷新后会通过 `/api/running` 和 `/api/tasks` 恢复运行态。
- `in_progress` 任务可从 SQLite 恢复。
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

storage.mjs / governance.mjs / scheduler.mjs
  ├─ SQLite repository、migration、旧数据导入
  ├─ 审批指纹、风险策略、脱敏审计
  └─ Cron 调度、审批暂停、运行历史

agent-utils.mjs
  ├─ CLI 配置与启动检查
  ├─ prompt 构造
  ├─ parser / JSON 提取
  └─ task repository 读写

commandSafety.mjs
  └─ shell 命令风险分类

.myteam/
  ├─ myteam.sqlite
  ├─ migrations/
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
| GET | `/api/subagents` | 按 session 查询持久化 subagent runs 和状态汇总 |
| GET | `/api/subagents/:id/messages` | 查询指定 subagent run 的持久化消息 |
| GET | `/api/approvals` | 查询审批，可按 status 过滤 |
| POST | `/api/approvals/:id/decision` | 批准一次、会话批准或拒绝 |
| GET | `/api/audit` | 查询脱敏审计事件 |
| GET/POST | `/api/schedules` | 查询或创建 Cron 计划 |
| PATCH/DELETE | `/api/schedules/:id` | 更新、启停或删除计划 |
| POST | `/api/schedules/:id/run` | 手动触发并进入待审批状态 |
| GET | `/api/schedule-runs` | 查询定时任务运行历史 |

## 文件结构

```text
myteamOUO/
├── server.mjs
├── agent-utils.mjs
├── commandSafety.mjs
├── collaboration-context.mjs
├── storage.mjs
├── governance.mjs
├── scheduler.mjs
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
├── tests/
│   └── collaboration-context.test.mjs
├── .myteam/
│   ├── myteam.sqlite
│   ├── migrations/
│   ├── skills/
│   └── outputs/
└── .env
```

## LobsterAI 优先级路线完成（2026-06-18）

- `P0`：Plan JSON Schema、Codex `--output-schema`、统一规范化与兼容解析。
- `P1`：结构化 `spawn_subagent` 派生协议，`@mention` 仅作兼容回退。
- `P2`：session 持久化 Continuity Capsule。
- `P3`：Top-K 历史证据检索注入。
- `P4`：执行前 Git workspace rehydration。
- `P5`：subagent run/message JSONL、查询 API、Hub 状态列表和详情入口。

核心实现集中在 `collaboration-context.mjs`，对应测试在 `tests/collaboration-context.test.mjs`。

## LobsterAI 后续路线完成（2026-06-19）

- `P6`：服务端审批对象、不可伪造的操作指纹、会话/单次授权和脱敏审计。
- `P7`：Node 内置 SQLite、WAL、migration、旧 JSON/JSONL 备份与幂等导入。
- `P8`：Cron + 时区、启停、手动运行、审批暂停、互斥和运行历史。

详细取舍见 `docs/lobsterai-comparison.md`，实施 lessons 见 `docs/lessons-p6-p8.md`。

## 前轮修复重点（2026-06-17）

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
npm test
git diff --check
```

并用本地 `7879` 临时服务验证：

- `/api/skills/registry?source=myteam-official` 能读到 `shell-exec`
- `/api/skills/install` 能安装 `shell-exec`
- `/api/skills/install-source` 能从本地目录安装 `shell-exec`
- `/api/shell/exec` + `/api/shell/stream` 能返回 `OK`
- `/api/outputs/file?name=bad%5Cname` 返回 400

## 运行时数据

以下目录和文件属于本地运行时数据，默认不提交：

- `.myteam/tasks.jsonl`
- `.myteam/lessons.jsonl`
- `.myteam/invocations.jsonl`
- `.myteam/memory.json`
- `.myteam/skills/`
- `.myteam/outputs/`
- `.myteam/myteam.sqlite*`
- `.myteam/migrations/`

旧 JSON/JSONL 只作为首次迁移来源和只读备份；迁移后 SQLite 是唯一写入源。
