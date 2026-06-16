# myteamOUO 交接文档

最后更新：2026-06-16（安全修复 + Skill 市场 + Agent 弹窗 + Studio 模板 + 产物面板）

这份文档用于新对话冷启动。新的 agent 接手时，请先读本文件，再读 `docs/problem-course.md` 和 `ISSUES.md`，最后再改代码。

---

## 1. 项目定位

myteamOUO 是一个本地优先、低成本、轻量化的 A2A（Agent-to-Agent）协作工具 MVP。

目标用户：编程经验不多、想用本地 CLI agent 低成本搭建可协作、可拆任务、可审查、可沉淀经验工具的人。

核心设计原则：

- 本地运行，不依赖数据库、云平台或复杂部署。
- 通过浏览器界面使用：`http://localhost:7878/`
- 用本地文件保存任务、会话、经验和运行记录。
- agent 可动态增减，支持角色卡配置（roleDescription / personality / strengths / restrictions / nickname / avatar / color）。
- 三路 CLI 对齐解析：Claude / Codex / Kimi，统一流式输出。
- 支持图片附件上传、ctrl+v 粘贴、聊天缩略图展示。
- 支持人工 Reviewer Gate，作为自迭代安全阀。
- session 历史完整保留（包括失败现场），刷新后可回溯。
- **同一 CLI 可创建多个变体**（不同 model/角色卡），通过 Agent 配置的新建对话框选择。

GitHub: https://github.com/jhryo25/myteamOUO  
本地路径：`F:\py project\myteamOUO`

---

## 2. 启动方式

```powershell
cd "F:\py project\myteamOUO"
node server.mjs
```

也可以使用 Python 包装入口：

```powershell
python myteam.py serve
```

默认访问地址：`http://localhost:7878/`

端口被占用时：

```powershell
for /f "tokens=5" %a in ('netstat -aon ^| findstr ":7878"') do taskkill /F /PID %a
```

---

## 3. 当前主要功能

### 对话

- 多 session 聊天，sidebar 显示 📋 任务 / 💬 对话 / 🔀 混合 徽章。
- 新建 session 不强制命名，第一条消息自动生成标题。
- 支持 `@agent` 路由和按名字补全（行首匹配）。
- agent 输出实时流式显示；有思考过程时在 bubble 内嵌 `<details>` 折叠区，默认收起。
- 支持发送图片附件；支持 ctrl+v 直接粘贴图片到输入框。
- 历史消息支持分页加载；失败现场完整保留，刷新后可见。
- 切换 session 时，当前 SSE 任务后台继续运行，结果落 history，不中断也不污染新 session 视图。
- **切换 session 后对话区直接定位到最新消息**（不做滚动动画，点进去即在底部）。
- **刷新后恢复运行中任务状态**：`/api/running` 返回活跃子进程，前端 `restoreRunningState()` 重建面板和 session 标记。

### 任务拆解

- "拆任务"模式把目标拆成结构化任务（五件套：why / tradeoff / open_questions / steps / accept）。
- 任务写入 `.myteam/tasks.jsonl`，并关联 `session_id`。
- plan card 里每条任务的 agent 为下拉选择器（只列可用 agent），可自由调整分配。
- plan 结果和失败现场写入 session.history，刷新后可复现。
- **SOP phase 状态机**：`pending→impl→quality_gate→review→gate→done`。

### 任务执行

- dispatch 执行 pending 任务；选定 agent 不可用时自动 fallback 到第一个可用 agent 并提示。
- 任务面板按 run 分组，显示状态和进度。
- 支持中断、继续、单条重跑、删除。
- 执行失败会写入 lessons（自动 pattern 分类，8 类）。
- **A2A Worklist 链式执行**：dispatch 结果检测 `@mention`，自动派给下游 agent，最多 3 层深度，内置乒乓熔断。
- **跨 agent 自动 review**：任务 done 后自动选 `!= executor` 的可用 agent 静默 review，写回 `review_status / review_severity / review_score / review_findings / reviewer`。
- **SOP phase 自动推进**：dispatch→impl，review pass→review，rework→impl，gate pass→done。

### Agent 管理

- 右上角 ⚙ 按钮打开 **居中弹窗式配置面板**（680px，含两列角色卡布局）。
- **Studio 工作室模板**：弹窗顶部选择预置团队（🚀快速原型 / 🏗️全栈协作 / 🔍严格审查 / 📖研究调研），一键覆盖角色卡（路径/apiKey/模型不变）。
- **新建 Agent 对话框**：选基础 CLI 克隆配置 + 输入 key + label + 套用角色模板，一步完成变体创建；防止将 apiKey 误填为 key（≥24位十六进制拦截）。
- API Key **不明文暴露**：`/api/status` 返回 `hasApiKey + apiKeyMasked (••••xxxx)`，明文不传前端；保存时空值不覆盖已有 key。
- 每张 agent 卡片底部有"角色卡"折叠区（两列 grid 布局），可编辑：
  - `roleDescription / personality / strengths / restrictions`（注入每次 prompt 头部）
  - `nickname / avatar / color.primary / color.secondary`
- agent 本地配置写入 `.myteam/agents.json`，不入库。

### Skill 市场（Hub > Skills）

数据：`.myteam/skills/{name}/SKILL.md` 目录形态（对齐 clowder-ai）

- **四 Tab 面板**：本次加载 / 已安装 / 🛒 市场 / Prompt 预览。
- 市场双源：**myteam 官方**（`skills-registry/index.json`）+ **clowder-ai**（解析 `manifest.yaml`，55 个 skill）。
- 一键安装（下载 SKILL.md 到 `.myteam/skills/{name}/`）。
- 启用/禁用开关（`skills-state.json`）；按需命中评分只在 enabled=true 集合内打分。
- 按角色/agent 挂载复选框；卸载功能。
- `readSkills()` 优先读目录形态，fallback 到老 `skills.yaml`（向后兼容）。

### Hub 指挥中心

顶部抽屉，Tab：📊 总览 / 🤖 Agent / 🧩 Skills / 📚 Lessons / 📞 调用 / ⛩ Gate / 📋 任务

### 产物面板（顶栏 📁）

对齐 clowder-ai F063（workspace explorer）+ F148（artifact ledger）

- **右侧固定面板**（420px），打开后聊天区自动让位（`body.artifacts-open .layout { margin-right: 420px }`）。
- **双 Tab**：💬 聊天提取 / 🗂 工作区。
- **聊天提取**：agent 输出后自动 `extractArtifacts()` 抽取，4 种规则：
  1. ` ```lang:path/to/file ` — 带文件名围栏
  2. ` ```html ` 等带语言标识围栏
  3. `<file path="xxx">...</file>` 路径标记
  4. `https://...` URL 链接；整段含 `#标题` + 多行结构 markdown
- **工作区文件**：扫描 workspace 根 / docs / src / web / scripts 等常规产出目录，按 mtime 倒序。
- **渲染器**：markdown（marked.js CDN）/ html（iframe sandbox + 🌐浏览器打开）/ json / code / url 卡片。
- **安全模型**（对齐 F063）：路径越界→403，`.env`/`.git`/`node_modules`/`secrets` denylist→403，文件>1MB→413。
- 默认打开最新产物；session 切换时自动刷新列表；chat 气泡代码块加「📁 查看产物」角标。

### 自迭代

闭环：

```
goal → plan → assign → run → auto_review → review_gate → learn → memory 晋升
```

已完成：plan / assign（下拉） / run（dispatch） / auto_review（跨 agent 自动审） / review（人工 Gate） / learn（lessons + pattern 分类 + 改进提案）

---

## 4. 架构关键设计

### NDJSON 流式解析器

| agent  | CLI 参数 | 解析器 | thinking 支持 |
|---|---|---|---|
| Claude | `--output-format stream-json` | `parseClaude()` | ✅ `thinking_delta` |
| Codex  | `exec - --json` | `parseCodex()` | ✅ `agent_reasoning_delta` |
| Kimi   | `-p {prompt} --output-format stream-json` | `parseKimi()` | ✅ `reasoning_content` |

### 安全设计

- **apiKey 不明文**：后端 `stripSensitive()` 剥掉明文，返回 `hasApiKey + apiKeyMasked`；前端 input 的 `value` 留空。
- **保存时空 apiKey 不覆盖**：POST `/api/agents` 合并时若 `incoming.apiKey === ''`，保留 `prev.apiKey`。
- **agent key 防误填**：新建对话框拦截 ≥24 位纯十六进制字符串。
- **workspace 安全模型**：`resolve + realpathSync` 防路径越界；denylist；文本 1MB 上限；二进制返 metadata。

### SOP 状态机

`agent-utils.mjs` 导出：
- `SOP_PHASES`：`['pending', 'impl', 'quality_gate', 'review', 'gate', 'done']`
- `validatePhaseTransition(task, targetPhase)`：校验 phase 转换合法性
- `getNextPhase(task)`：返回下一阶段

`POST /api/tasks/:id/phase` 可手动推进 phase（带前置校验）。

### Artifact 提取

`extractArtifacts(text, ctx)` 在 chat done 和 dispatch done 后自动触发，结果挂到 `session.history[i].artifacts`。  
`GET /api/artifacts?sessionId=` 实时派生，同 path 按 createdAt 去重，返回最新版本。

### 活跃子进程追踪

`activeChildren` Map 记录：`{ child, sessionId, clientRunId, aborted, agentKey, mode, taskTitle, startedAt }`

`GET /api/running` 返回非 aborted 子进程信息，前端刷新后调用 `restoreRunningState()` 恢复状态面板。

### 角色卡注入

- `buildRoleCard(agentDef)` 生成角色身份头部，`streamAgent` 内自动前置到 prompt。
- plan 调用传 `skipRoleCard: true`，避免角色卡干扰 JSON 输出格式。

### 跨 session SSE 隔离

- `ssePost` 记录 `requestSessionId`，切换 session 后丢弃跨 session chunk 事件。
- `switchSession` 不主动 abort 后台 SSE，结果落 history，切回后刷新可见。
- done/error 事件始终执行，保证状态释放。

### session.history 扩展 role

| role | kind | 含义 |
|---|---|---|
| user | — | 用户消息 |
| assistant | — | agent 回复（含 `artifacts: Artifact[]`） |
| system | chat-error | chat 调用失败现场 |
| system | plan-error | plan 解析失败现场 |
| plan | plan-result | plan 成功后的任务列表快照 |

---

## 5. 关键文件

```text
myteamOUO/
├── README.md                    # 面向用户的项目介绍
├── HANDOVER.md                  # 本交接文档
├── ISSUES.md                    # 原始问题追踪记录
├── docs/
│   ├── problem-course.md        # 课程化问题文档，优先检索
│   ├── clowder-html-gap.md      # 与 clowder-ai 的交互差距记录
│   └── architecture-evaluation.md
├── skills-registry/             # myteam 官方 Skill 源（入库）
│   ├── index.json               # 市场清单
│   └── {name}/SKILL.md          # 每个 skill 的详细文档
├── myteam.py                    # Python 统一入口
├── server.mjs                   # Node HTTP server，REST + SSE
├── agent-utils.mjs              # agent 配置、解析器、任务工具、角色卡、SOP状态机
├── plan.mjs                     # CLI 拆任务入口
├── dispatch.mjs                 # CLI 执行任务入口
├── web/
│   ├── app.html                 # 控制台 HTML（含产物面板 HTML 骨架）
│   ├── app.css                  # 控制台样式
│   └── app.js                   # 控制台交互逻辑（含产物面板 JS）
└── .myteam/                     # 运行时数据，全部不入库
    ├── agents.yaml              # 默认角色说明（入库）
    ├── skills.yaml              # skills.yaml（入库，fallback用）
    ├── skills/{name}/SKILL.md   # 本地安装的 skill（不入库）
    ├── skills-state.json        # skill 启用/挂载状态（不入库）
    ├── agents.json              # 动态 agent 配置（含角色卡+昵称+头像+颜色，不入库）
    ├── avatars/                 # agent 头像图片（不入库）
    ├── settings.json            # 本地工作区配置（不入库）
    ├── uploads/                 # 图片附件（不入库）
    ├── tasks.jsonl              # 运行时任务（含 phase/why/tradeoff/artifacts，不入库）
    ├── lessons.jsonl            # 运行时经验（含 pattern 字段，不入库）
    ├── invocations.jsonl        # agent 调用记录（不入库）
    ├── memory.md                # 晋升后的长期记忆（不入库）
    ├── memory.json              # session 历史（不入库）
    └── runs/                    # 任务备份和日志（不入库）
```

不要提交 `.env`、`.myteam` 运行时数据（`agents.json / skills/ / skills-state.json / avatars/ / uploads/ / *.jsonl / memory.* / runs/`）、`reports/`、`.compare/`。

---

## 6. 核心 API

### Agent & 配置

| 方法 | 路由 | 说明 |
|---|---|---|
| GET | `/api/status` | agent 状态（apiKey 已脱敏：hasApiKey + apiKeyMasked） |
| GET | `/api/running` | 当前活跃子进程（刷新后恢复状态用） |
| GET | `/api/agents` | agent 配置和状态 |
| POST | `/api/agents` | 保存动态 agent 列表（空 apiKey 不覆盖已有） |
| PATCH | `/api/agents/:key` | 更新单个 agent 角色卡字段 |
| POST | `/api/agents/:key/avatar` | 上传头像（base64 data URL，限 2MB） |
| GET | `/avatars/:filename` | 读取头像图片 |
| GET | `/api/studio-templates` | 列出 4 个工作室团队模板 |
| POST | `/api/studio-templates/apply` | 一键应用团队模板（只更新角色卡，保留路径/key/模型） |

### 对话 & 任务

| 方法 | 路由 | 说明 |
|---|---|---|
| GET | `/api/sessions` | session 列表 |
| POST | `/api/sessions` | 新建或切换 session |
| POST | `/api/sessions/:id/rename` | 重命名 session |
| DELETE | `/api/sessions/:id` | 删除 session 到回收站 |
| GET | `/api/history?limit=&before=` | 当前 session 历史分页 |
| POST | `/api/chat` | SSE 对话流（完成后自动提取 artifacts） |
| POST | `/api/plan` | SSE 拆任务流（五件套字段） |
| POST | `/api/dispatch` | SSE 执行 pending 任务（含 worklist + auto review + artifact 提取） |
| POST | `/api/abort` | 中断正在运行的 agent 子进程 |
| GET | `/api/tasks` | 任务列表 |
| PATCH | `/api/tasks/:id/agent` | 修改任务分配的 agent |
| POST | `/api/tasks/:id/rerun` | 重跑单条任务 |
| DELETE | `/api/tasks/:id` | 删除单条任务 |
| POST | `/api/tasks/:id/gate` | 人工 Reviewer Gate（自动推进 phase→done） |
| POST | `/api/tasks/:id/phase` | 手动推进 SOP 阶段（带前置校验） |

### Skill 市场

| 方法 | 路由 | 说明 |
|---|---|---|
| GET | `/api/skills` | Skills 清单（enabled 过滤）+ 按需命中结果 |
| GET | `/api/skills/registry?source=` | 远程市场清单（myteam-official / clowder-ai） |
| POST | `/api/skills/install` | 一键安装 skill（下载 SKILL.md） |
| POST | `/api/skills/:name/toggle` | 启用/禁用 skill |
| PATCH | `/api/skills/:name/mounts` | 调整挂载角色 |
| DELETE | `/api/skills/:name` | 卸载 skill |

### 产物面板

| 方法 | 路由 | 说明 |
|---|---|---|
| GET | `/api/artifacts?sessionId=` | chat-extracted artifacts（去重，倒序） |
| GET | `/api/workspace/recent?limit=` | 工作区最近修改文件（按 mtime） |
| GET | `/api/workspace/file?path=` | 读取文件内容（≤1MB，安全校验） |
| GET | `/api/workspace/raw?path=` | 原始字节流（HTML 浏览器打开用，≤4MB） |

### 其他

| 方法 | 路由 | 说明 |
|---|---|---|
| POST | `/api/uploads` | 上传图片附件 |
| GET | `/uploads/:file` | 读取图片缩略图 |
| GET | `/api/settings` | 本地工作区配置 |
| POST | `/api/settings` | 保存工作区路径 |
| GET | `/api/invocations` | 调用记录 |
| GET | `/api/lessons` | 踩坑记录 |
| GET | `/api/lessons/patterns` | Pattern 分析和改进提案 |
| POST | `/api/lessons/promote` | 晋升经验到 memory.md |
| GET | `/api/models?baseUrl=&apiKey=` | 从 OpenAI 兼容 API 拉取模型列表 |

---

## 7. 关键 SSE 事件

| 事件名 | 触发时机 |
|---|---|
| `task-start` | dispatch 开始执行一条任务 |
| `task-done` | 任务执行完成 |
| `task-failed` | 任务执行失败 |
| `task-review-start` | 自动 review 开始 |
| `task-review-done` | 自动 review 完成（含 verdict/findings） |
| `task-review-failed` | 自动 review 解析失败 |
| `task-review-skip` | 没有可用 reviewer，跳过 review |
| `skill-next-recommend` | dispatch 后推荐下一阶段 skill |
| `worklist-circuit-break` | A2A 链式乒乓熔断 |

---

## 8. 当前重要经验

优先读 `docs/problem-course.md`。最高频坑点：

- `existsSync(path)` 不等于 CLI 可启动，WindowsApps Codex 会 `spawn EPERM`，必须用 `checkAgentLaunchable()` 真实启动检测。
- **apiKey 安全**：`stripSensitive()` 仅返回 `hasApiKey + apiKeyMasked`，明文不传前端。保存时 `incoming.apiKey === ''` 应保留 `prev.apiKey`，不要覆盖。
- **新建 agent key 防误填**：key 字段不能填 API key 值，前端加了 ≥24 位纯十六进制拦截，也要在后端校验。
- plan prompt 是系统指令，不能叠加角色卡（`skipRoleCard: true`），否则 LLM 用角色身份回答而不输出 JSON。
- CLI 格式对齐优先于 prompt 约束：`--output-format stream-json` 比"请只输出 JSON"更可靠。
- session.history 要完整保留失败现场，不能在 catch 里 pop 用户消息。
- 跨 session SSE 用 requestSessionId 守门，不能让旧请求事件污染新 session DOM。
- 自动 review 只对顶层任务触发（`depth === 0`），worklist 链式子任务跳过，防止审查链爆炸。
- Skill SKILL.md 解析用 `parseSkillFrontmatterRobust()`，需要处理 `>` block scalar 和缩进数组两种格式。
- workspace API 路径安全：必须 `resolve + realpathSync` 再比较前缀，不能只用字符串 startsWith。

---

## 9. 验证方式

```powershell
node --check server.mjs
node --check agent-utils.mjs
git diff --check
```

接口冒烟：

```powershell
curl http://localhost:7878/api/status          # 确认 hasApiKey 而非 apiKey 明文
curl http://localhost:7878/api/skills          # 确认 enabled 过滤生效
curl http://localhost:7878/api/artifacts       # 确认路由存在
curl "http://localhost:7878/api/workspace/file?path=README.md"  # 确认文件读取
curl "http://localhost:7878/api/workspace/file?path=../../../etc/passwd"  # 必须返回 403
curl "http://localhost:7878/api/workspace/file?path=.env"       # 必须返回 403
curl http://localhost:7878/api/studio-templates   # 确认 4 个模板
```

---

## 10. 本次重要变更记录（2026-06-16）

| 变更 | 位置 | 说明 |
|---|---|---|
| **安全：apiKey 不明文** | `server.mjs:stripSensitive` | 返回 `hasApiKey + apiKeyMasked`；保存时空值不覆盖 |
| **Agent 配置弹窗** | `app.css:.drawer` | 从右侧抽屉改为居中弹窗（680px，最高 88vh），角色卡两列 grid |
| **Studio 工作室模板** | `server.mjs:STUDIO_TEMPLATES`，`/api/studio-templates` | 4 个预置团队，一键应用角色卡 |
| **Skill 市场** | `server.mjs`，`app.js:renderHubSkills` | 双源（myteam + clowder-ai 55 skill）+ 目录形态 + 四 Tab + 安装/启用/挂载/卸载 |
| **skills-registry/** | 仓库根目录 | myteam 官方 skill 源（5 个 SKILL.md + index.json），入库 |
| **产物面板** | `server.mjs`，`app.html/css/js` | 📁 按钮 + 右侧 420px 面板 + 双 Tab + 4 种提取规则 + markdown/html/code/json/url 渲染 |
| **workspace 文件 API** | `server.mjs` | recent/file/raw 三路由，F063 安全模型 |
| **artifact 提取** | `server.mjs:extractArtifacts` | 挂到 history[].artifacts，session 切换自动刷新 |
| **agent key 防误填** | `app.js:showCreateAgentDialog` | ≥24 位纯十六进制字符串拦截，tooltip 提示 |
| **agentKey 修复** | `.myteam/agents.json` | 第 4 个 agent key 从 apiKey 值改为 `codex-dev` |

---

## 新对话冷启动提示

```text
项目：myteamOUO，本地 A2A 协作工具 MVP。
GitHub: https://github.com/jhryo25/myteamOUO
本地路径: F:\py project\myteamOUO

请先读取 HANDOVER.md，再读取 docs/problem-course.md 和 ISSUES.md。
用户编程经验不多，说明要简单，代码注释用中文。
不要提交 .env、.myteam 运行时数据或 reports/。
继续工作前先检查 git status。
API Key 相关：stripSensitive() 只返回 hasApiKey/apiKeyMasked，明文不传前端。
```
