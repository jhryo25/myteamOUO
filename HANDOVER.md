# myteamOUO 交接文档

最后更新：2026-06-15（IMP-028 拆任务支持图片）

这份文档用于新对话冷启动。新的 agent 接手时，请先读本文件，再读 `docs/problem-course.md` 和 `ISSUES.md`，最后再改代码。

## 1. 项目定位

myteamOUO 是一个本地优先、低成本、轻量化的 A2A（Agent-to-Agent）协作工具 MVP。

它要解决的问题是：让没有太多编程经验的用户，也能用本地 CLI agent 低成本搭建一个可协作、可拆任务、可审查、可沉淀经验、可逐步自迭代的工具。

当前项目重点：

- 本地运行，不依赖数据库、云平台或复杂部署。
- 通过浏览器界面使用，地址是 `http://localhost:7878/`。
- 用本地文件保存任务、会话、经验和运行记录。
- agent 可动态增减，支持角色卡配置（roleDescription / personality / strengths / restrictions）。
- 三路 CLI 已全部对齐 `--output-format stream-json` 解析（Claude / Codex / Kimi）。
- 支持图片附件上传、ctrl+v 粘贴、聊天缩略图展示。
- 支持人工 Reviewer Gate，作为自迭代安全阀。
- session 历史完整保留（包括失败现场），刷新后可回溯。

GitHub: https://github.com/jhryo25/myteamOUO

本地路径：`F:\py project\myteamOUO`

## 2. 启动方式

```powershell
cd "F:\py project\myteamOUO"
node server.mjs
```

也可以使用 Python 包装入口：

```powershell
python myteam.py serve
```

默认访问地址：

```text
http://localhost:7878/
```

如果端口 7878 被占用：

```powershell
for /f "tokens=5" %a in ('netstat -aon ^| findstr ":7878"') do taskkill /F /PID %a
```

## 3. 当前主要功能

### 对话

- 多 session 聊天，sidebar 显示 📋 任务 / 💬 对话 / 🔀 混合 徽章，一眼辨别模式。
- 新建 session 不强制命名，第一条消息自动生成标题。
- 支持 `@agent` 路由和按名字补全（行首匹配）。
- agent 输出实时流式显示；有思考过程时在 bubble 内嵌 `<details>` 折叠区，默认收起。
- 支持发送图片附件；支持 ctrl+v 直接粘贴图片到输入框。
- 历史消息支持分页加载；失败现场完整保留，刷新后可见。
- 切换 session 时，当前 SSE 任务后台继续运行，结果落 history，不中断也不污染新 session 视图。

### 任务拆解

- "拆任务"模式把目标拆成结构化任务。
- 任务写入 `.myteam/tasks.jsonl`，并关联 `session_id`。
- **支持图片附件**：可上传或 ctrl+v 粘贴图片，图片路径注入 plan prompt，agent 可分析图片内容后拆任务；goal 为空时自动补默认目标。
- plan card 里每条任务的 agent 为下拉选择器（只列可用 agent），可自由调整分配。
- 建议执行按钮只显示可用 agent，不可用的 agent 自动过滤。
- plan 结果和失败现场写入 session.history，刷新后可复现。

### 任务执行

- dispatch 执行 pending 任务；选定 agent 不可用时自动 fallback 到第一个可用 agent 并提示。
- 任务面板按 run 分组，显示状态和进度。
- 支持中断、继续、单条重跑、删除。
- 执行失败会写入 lessons。

### Agent 管理

- 设置抽屉可修改工作区路径、新增/删除 agent。
- 每张 agent 卡片底部有"角色卡"折叠区，可编辑 `roleDescription / personality / strengths / restrictions`，保存后注入每次 prompt 头部（plan 调用不注入，保护 JSON 输出）。
- agent 本地配置写入 `.myteam/agents.json`，不入库。
- `PATCH /api/agents/:key` 支持单独更新角色卡字段。
- Kimi 可用性需真实启动检测（`checkAgentLaunchable`），路径存在不等于可启动。

### Hub

- 现有 tab：总览、Agent、Skills、Lessons、调用、Gate、任务。
- 技术差距记录放在 `docs/clowder-html-gap.md`。
- LangChain / LangGraph / RAG 评估放在 `docs/architecture-evaluation.md`。

### 自迭代

当前闭环：

```text
goal -> plan -> assign(可调整) -> run -> review_gate -> learn -> backlog候选
```

已完成：

- plan：拆任务，支持 session 隔离和失败记录。
- assign：任务节点可手动修改执行 agent。
- run：dispatch 执行，不可用 agent 自动 fallback。
- review：人工 Gate。
- learn：失败写入 lessons。

未完成：

- Reviewer Agent 自动审查。
- Backlog 独立视图。
- 本地 RAG 自动检索课程文档和历史经验。

## 4. 架构关键设计

### NDJSON 解析器（对齐 clowder-ai）

| agent | CLI 参数 | 解析器 | thinking 支持 |
| --- | --- | --- | --- |
| Claude | `--output-format stream-json` | `parseClaude()` | ✅ `thinking_delta` |
| Codex | `exec - --json` | `parseCodex()` | ❌（无 thinking 流） |
| Kimi | `--print --output-format stream-json` | `parseKimi()` | ✅ `reasoning_content` |

解析器统一返回 `{ text, thinking }` 或字符串。`streamAgent` 把 text 发 `chunk` 事件，thinking 发独立 `thinking` 事件。

### 角色卡注入（对齐 clowder-ai `buildStaticIdentity`）

- `buildRoleCard(agentDef)` 生成角色身份头部，在 `streamAgent` 内自动前置到 prompt。
- plan 调用传 `skipRoleCard: true`，避免角色卡干扰 JSON 输出格式。

### 跨 session SSE 隔离

- `ssePost` 记录 `requestSessionId`，切换 session 后丢弃跨 session chunk 事件。
- `switchSession` 不主动 abort 后台 SSE，结果落 history，切回后刷新可见。
- done/error 事件始终执行，保证状态释放。

### session.history 扩展 role

| role | kind | 含义 |
| --- | --- | --- |
| user | — | 用户消息 |
| assistant | — | agent 回复 |
| system | chat-error | chat 调用失败现场 |
| system | plan-error | plan 解析失败现场 |
| plan | plan-result | plan 成功后的任务列表快照 |

## 5. 关键文件

```text
myteamOUO/
├── README.md                    # 面向用户的项目介绍和使用方式
├── HANDOVER.md                  # 本交接文档
├── ISSUES.md                    # 原始问题追踪记录
├── docs/
│   ├── problem-course.md        # 课程化问题文档，优先检索
│   ├── clowder-html-gap.md      # 与 clowder-ai 的交互差距记录
│   └── architecture-evaluation.md
├── myteam.py                    # Python 统一入口
├── server.mjs                   # Node HTTP server，REST + SSE
├── agent-utils.mjs              # agent 配置、解析器、任务工具、角色卡
├── plan.mjs                     # CLI 拆任务入口
├── dispatch.mjs                 # CLI 执行任务入口
├── web/
│   ├── app.html                 # 控制台 HTML
│   ├── app.css                  # 控制台样式
│   └── app.js                   # 控制台交互逻辑
└── .myteam/
    ├── agents.yaml              # 默认角色说明，入库
    ├── skills.yaml              # 技能清单，入库
    ├── agents.json              # 本地动态 agent 配置（含角色卡），不入库
    ├── settings.json            # 本地工作区配置，不入库
    ├── uploads/                 # 图片附件，不入库
    ├── tasks.jsonl              # 运行时任务，不入库
    ├── lessons.jsonl            # 运行时经验，不入库
    ├── invocations.jsonl        # agent 调用记录，不入库
    ├── memory.json              # session 历史（含模式标记和失败记录），不入库
    └── runs/                    # 运行备份和日志，不入库
```

不要提交 `.env`、`.myteam` 运行时数据、`reports/`。

## 6. 核心 API

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| GET | `/` | 控制台页面 |
| GET | `/api/status` | agent 状态和工作区 |
| GET | `/api/settings` | 本地工作区配置 |
| POST | `/api/settings` | 保存工作区路径 |
| GET | `/api/agents` | agent 配置和状态（含角色卡字段） |
| POST | `/api/agents` | 保存动态 agent 列表 |
| PATCH | `/api/agents/:key` | 更新单个 agent 角色卡字段 |
| POST | `/api/uploads` | 上传图片附件 |
| GET | `/uploads/:file` | 读取图片缩略图 |
| GET | `/api/sessions` | session 列表（含 mode 字段） |
| POST | `/api/sessions` | 新建或切换 session |
| POST | `/api/sessions/:id/rename` | 重命名 session |
| DELETE | `/api/sessions/:id` | 删除 session 到回收站 |
| GET | `/api/history?limit=&before=` | 当前 session 历史分页 |
| POST | `/api/chat` | SSE 对话流，支持附件和 @mention |
| POST | `/api/plan` | SSE 拆任务流（写入 session history） |
| POST | `/api/dispatch` | SSE 执行 pending 任务 |
| POST | `/api/abort` | 中断正在运行的 agent 子进程 |
| GET | `/api/tasks` | 任务列表 |
| PATCH | `/api/tasks/:id/agent` | 修改任务分配的 agent |
| POST | `/api/tasks/:id/rerun` | 重跑单条任务 |
| DELETE | `/api/tasks/:id` | 删除单条任务 |
| POST | `/api/tasks/:id/gate` | 人工 Reviewer Gate |
| GET | `/api/skills` | Skills 清单和按需命中结果 |
| GET | `/api/invocations` | 调用记录 |
| GET | `/api/lessons` | 踩坑记录 |

## 7. 当前重要经验

优先读 `docs/problem-course.md`。最高频坑点：

- `existsSync(path)` 不等于 CLI 可启动，WindowsApps Codex 会 `spawn EPERM`，必须用 `checkAgentLaunchable()` 真实启动检测。
- 新增 agent 必须贯通：配置 → 状态检测 → 路由 → 解析器 → 执行 → UI → 验证，缺任何一环会出现"看起来支持，实际不生效"。
- @mention 的前端提示和后端执行规则必须一致（行首匹配）。
- plan prompt 是系统指令，不能叠加角色卡（skipRoleCard: true），否则 LLM 会用角色身份回答而不输出 JSON。
- CLI 格式对齐优先于 prompt 约束：`--output-format stream-json` 比"请只输出 JSON"更可靠。
- session.history 要完整保留失败现场，不能在 catch 里 pop 用户消息。
- 跨 session SSE 用 requestSessionId 守门，不能让旧请求事件污染新 session DOM。
- 图片发送要同时处理：缩略图展示、上传路径、agent prompt 注入、安全限制。
- 所有运行时文件默认不入库（`.myteam/` 下的 .json / .jsonl）。

## 8. 验证方式

常规检查：

```powershell
node --check server.mjs
node --check agent-utils.mjs
node --check web/app.js
git diff --check
```

接口检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:7878/api/status
Invoke-WebRequest -UseBasicParsing http://localhost:7878/api/agents
```

## 9. 下一步建议

优先级从高到低：

1. **本地 RAG MVP**：检索 `docs/problem-course.md`、`ISSUES.md`、`HANDOVER.md`、tasks、lessons，把相关上下文注入 plan/run/review。
2. **Reviewer Agent 自动审查**：读取任务验收标准和执行结果，给 Gate 建议，但最终仍由用户确认。
3. **Backlog 视图**：把失败、返工和下一轮建议变成可管理列表。
4. **图片多模态适配**：不同 agent CLI 如果支持原生图片输入，做专门 adapter。
5. **providers 抽象**：后续再考虑 LangChain；workflow 抽象成熟后再考虑 LangGraph。

## 10. 新对话冷启动 Prompt

```text
项目：myteamOUO，本地 A2A 协作工具 MVP。
GitHub: https://github.com/jhryo25/myteamOUO
本地路径: F:\py project\myteamOUO

请先读取 HANDOVER.md，再读取 docs/problem-course.md 和 ISSUES.md。
用户编程经验不多，说明要简单，代码注释用中文。
不要提交 .env、.myteam 运行时数据或 reports/。
继续工作前先检查 git status。
```


这份文档用于新对话冷启动。新的 agent 接手时，请先读本文件，再读 `docs/problem-course.md` 和 `ISSUES.md`，最后再改代码。

## 1. 项目定位

myteamOUO 是一个本地优先、低成本、轻量化的 A2A（Agent-to-Agent）协作工具 MVP。

它要解决的问题是：让没有太多编程经验的用户，也能用本地 CLI agent 低成本搭建一个可协作、可拆任务、可审查、可沉淀经验、可逐步自迭代的工具。

当前项目重点：

- 本地运行，不依赖数据库、云平台或复杂部署。
- 通过浏览器界面使用，地址是 `http://localhost:7878/`。
- 用本地文件保存任务、会话、经验和运行记录。
- agent 可动态增减，不再只写死 `codex / claude / kimi`。
- 支持 Kimi CLI 配置和调用。
- 支持图片附件上传、聊天缩略图展示，并把图片路径交给 agent。
- 支持人工 Reviewer Gate，作为自迭代安全阀。

GitHub: https://github.com/jhryo25/myteamOUO

本地路径：`D:\myteam`

## 2. 启动方式

```powershell
cd D:\myteam
node server.mjs
```

也可以使用 Python 包装入口：

```powershell
python myteam.py serve
```

默认访问地址：

```text
http://localhost:7878/
```

如果端口 7878 被占用，先确认旧的 node 服务是否还在运行，再重启服务。

## 3. 当前主要功能

### 对话

- 多 session 聊天。
- 新建 session 不强制命名，第一条问题会自动生成标题。
- 支持 `@agent` 路由和按名字补全。
- agent 执行时会显示“启动 / 思考 / 输出”状态，减少等待焦虑。
- 支持发送图片附件；聊天栏会显示缩略图。
- 历史消息支持分页加载。

### 任务拆解

- “拆任务”模式把目标拆成结构化任务。
- 任务写入 `.myteam/tasks.jsonl`。
- 每条任务包含标题、步骤、验收标准和建议 agent。
- plan card 底部提供执行建议。

### 任务执行

- dispatch 执行 pending 任务。
- 任务面板按 run 分组，显示状态和进度。
- 支持中断、继续、单条重跑、删除。
- 执行失败会写入 lessons。

### Agent 管理

- 设置抽屉可修改工作区路径。
- 设置抽屉可新增/删除 agent。
- agent 本地配置写入 `.myteam/agents.json`，不入库。
- 默认 agent 仍包括 Codex、Claude、Kimi。
- Kimi 当前本机路径为 `C:\Users\Administrator\.kimi-code\bin\kimi.exe`，状态可用。
- Codex WindowsApps 路径目前会出现 `spawn EPERM`，不能只看文件是否存在。

### Hub

- Hub 保留用户可操作信息，不再展示 clowder-ai 差距对比和底部路线。
- 现有 tab：总览、Agent、Skills、Lessons、调用、Gate、任务。
- 技术差距记录放在 `docs/clowder-html-gap.md`。
- LangChain / LangGraph / RAG 评估放在 `docs/architecture-evaluation.md`。

### 自迭代

当前闭环已经有这些基础：

```text
goal -> plan -> assign -> run -> review_gate -> learn -> backlog候选
```

已完成：

- plan：拆任务。
- assign：任务有建议 agent。
- run：dispatch 执行。
- review：人工 Gate。
- learn：失败写入 lessons。

未完成：

- Reviewer Agent 自动审查。
- backlog 独立视图。
- 本地 RAG 自动检索课程文档和历史经验。

## 4. 关键文件

```text
myteamOUO/
├── README.md                    # 面向用户的项目介绍和使用方式
├── HANDOVER.md                  # 本交接文档
├── ISSUES.md                    # 原始问题追踪记录
├── docs/
│   ├── problem-course.md        # 课程化问题文档，优先检索
│   ├── clowder-html-gap.md      # 与 clowder-ai 的交互差距记录
│   └── architecture-evaluation.md
├── myteam.py                    # Python 统一入口
├── server.mjs                   # Node HTTP server，REST + SSE
├── agent-utils.mjs              # agent 配置、调用、任务工具
├── plan.mjs                     # CLI 拆任务入口
├── dispatch.mjs                 # CLI 执行任务入口
├── web/
│   ├── app.html                 # 控制台 HTML
│   ├── app.css                  # 控制台样式
│   └── app.js                   # 控制台交互逻辑
└── .myteam/
    ├── agents.yaml              # 默认角色说明，入库
    ├── skills.yaml              # 技能清单，入库
    ├── agents.json              # 本地动态 agent 配置，不入库
    ├── settings.json            # 本地工作区配置，不入库
    ├── uploads/                 # 图片附件，不入库
    ├── tasks.jsonl              # 运行时任务，不入库
    ├── lessons.jsonl            # 运行时经验，不入库
    ├── invocations.jsonl        # agent 调用记录，不入库
    ├── memory.json              # session 历史，不入库
    └── runs/                    # 运行备份和日志，不入库
```

不要提交 `.env`、`.myteam` 运行时数据、`reports/`。

## 5. 核心 API

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| GET | `/` | 控制台页面 |
| GET | `/api/status` | agent 状态和工作区 |
| GET | `/api/settings` | 本地工作区配置 |
| POST | `/api/settings` | 保存工作区路径 |
| GET | `/api/agents` | agent 配置和状态 |
| POST | `/api/agents` | 保存动态 agent 列表 |
| POST | `/api/uploads` | 上传图片附件 |
| GET | `/uploads/:file` | 读取图片缩略图 |
| GET | `/api/sessions` | session 列表 |
| POST | `/api/sessions` | 新建或切换 session |
| POST | `/api/sessions/:id/rename` | 重命名 session |
| DELETE | `/api/sessions/:id` | 删除 session 到回收站 |
| GET | `/api/history?limit=&before=` | 当前 session 历史分页 |
| POST | `/api/chat` | SSE 对话流，支持附件和 @mention |
| POST | `/api/plan` | SSE 拆任务流 |
| POST | `/api/dispatch` | SSE 执行 pending 任务 |
| POST | `/api/abort` | 中断正在运行的 agent 子进程 |
| GET | `/api/tasks` | 任务列表 |
| POST | `/api/tasks/:id/rerun` | 重跑单条任务 |
| DELETE | `/api/tasks/:id` | 删除单条任务 |
| POST | `/api/tasks/:id/gate` | 人工 Reviewer Gate |
| GET | `/api/skills` | Skills 清单和按需命中结果 |
| GET | `/api/invocations` | 调用记录 |
| GET | `/api/lessons` | 踩坑记录 |

## 6. 当前重要经验

优先读 `docs/problem-course.md`。下面是最高频坑点摘要：

- `existsSync(path)` 不等于 CLI 可启动，WindowsApps Codex 会 `spawn EPERM`。
- 新增 agent 必须贯通配置、状态、路由、执行、UI 和验证。
- @mention 的前端提示和后端执行规则必须一致。
- 图片发送要同时处理缩略图展示、上传路径、agent prompt 和安全限制。
- Hub 只放用户可操作状态，技术差距放 docs。
- 自迭代先做人类可控 Gate，再做 reviewer agent 自动化。
- 所有运行时文件默认不入库。

## 7. 验证方式

常规检查：

```powershell
node --check server.mjs
node --check agent-utils.mjs
node --check web/app.js
git diff --check
```

接口检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:7878/api/status
```

图片上传检查：

```powershell
# 使用 /api/uploads 上传一张小图，确认返回 url
# 再访问 http://localhost:7878 + url，确认 Content-Type 是 image/png 或 image/jpeg
```

浏览器自动化注意：

- 当前环境中 Playwright 包存在，但浏览器二进制可能缺失。
- Chrome Codex 扩展如果未安装或 native host 未注册，不能自动控制当前浏览器。
- 如果自动化验证被环境挡住，要在最终说明里明确写出原因。

## 8. 下一步建议

优先级从高到低：

1. 本地 RAG MVP：检索 `docs/problem-course.md`、`ISSUES.md`、`HANDOVER.md`、tasks、lessons，把相关上下文注入 plan/run/review。
2. Reviewer Agent 自动审查：读取任务验收标准和执行结果，给 Gate 建议，但最终仍由用户确认。
3. Backlog 视图：把失败、返工和下一轮建议变成可管理列表。
4. 图片多模态适配：不同 agent CLI 如果支持原生图片输入，就为它做专门 adapter。
5. providers 抽象：后续再考虑 LangChain；workflow 抽象成熟后再考虑 LangGraph。

## 9. 新对话冷启动 Prompt

```text
项目：myteamOUO，本地 A2A 协作工具 MVP。
GitHub: https://github.com/jhryo25/myteamOUO
本地路径: D:\myteam

请先读取 HANDOVER.md，再读取 docs/problem-course.md 和 ISSUES.md。
用户编程经验不多，说明要简单，代码注释用中文。
不要提交 .env、.myteam 运行时数据或 reports/。
继续工作前先检查 git status。
```
