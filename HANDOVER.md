# myteam 交接文档（2026-06-17）

## 当前状态

- 分支：`main`
- 远端：`origin https://github.com/jhryo25/myteamOUO.git`
- 本轮基于 2026-06-17 的更新提交做 review，并修复了 skill market、shell、outputs、刷新恢复相关的运行时问题。
- README 已改为中文说明，覆盖当前功能、架构、API、运行时数据和本轮修复。

## 本轮已完成

### 1. 重新拉取代码

已从 `origin/main` fast-forward 到 `190b87e`：

```text
docs: rewrite README with all new features
```

今天新增的主要代码提交是：

```text
7b9b680 feat: skill marketplace UI, shell execution, subagent session view, HTML auto-save, streaming UX improvements
190b87e docs: rewrite README with all new features
```

### 2. Review 并修复 Bug

本轮确认并修复的问题：

- `skills-registry/index.json` 注册了 `shell-exec`，但缺少 `skills-registry/shell-exec/SKILL.md`，导致市场安装 404。
- 官方 market 只读 GitHub main，不读当前 checkout，本地新增 registry 条目无法立即验证。
- 本地 `skills-registry/index.json` 带 BOM 时，`JSON.parse` 会失败并返回 502。
- 前端 Skills 页面市场安装按钮误调 `/api/skills/install-source`，但后端市场安装接口是 `/api/skills/install`。
- `server.mjs` 新增逻辑使用了 `dirname()`，但没有从 `path` 导入。
- `/api/outputs/file` 使用不存在的 `chr(92)`，请求带反斜杠文件名时会抛运行时错误。
- 远程 ZIP 安装用 UTF-8 文本写入 ZIP，会破坏二进制文件。
- HTML artifact 保存会把 `foo.html` 写成 `foo.html.html`，且文件名缺少安全清理。
- `restoreRunningState()` 合成运行态时缺 `startedAt`，刷新后计时可能 NaN。
- 子代理按钮注入逻辑可能给普通任务也加入口，现在只对链式子任务显示。
- 生成目录 `.myteam/outputs/` 和临时 skill 目录缺少 gitignore。

### 3. 文档更新

已更新：

- `README.md`：中文 README，包含快速启动、功能、架构、API、文件结构、本轮修复和验证结果。
- `HANDOVER.md`：中文交接文档，记录本轮改动、验证、注意事项和后续建议。

### 4. Lesson 沉淀

已写入本地 `.myteam/lessons.jsonl`：

```text
review-20260617-skill-market-shell
```

核心经验：

- registry/market/file 类功能不能只做语法检查，必须跑本地服务验证完整路径。
- 本地 checkout 应优先于远程 main，避免本地新 registry 条目无法验证。
- JSON 读取要考虑 BOM。
- 外部传入的 name/path 必须 sanitize/basename。
- 二进制下载必须用 Buffer。
- 前端调用要检查 `res.ok` 和后端返回契约。

该文件在 `.gitignore` 中，作为本地长期记忆，不会随 git push 上传。

## 代码改动清单

### `.gitignore`

- 新增忽略：
  - `.myteam/outputs/`
  - `.myteam/.tmp-skill-*`

### `server.mjs`

- 从 `path` 导入 `dirname`。
- 移除未使用的 `isDangerousCommand` 导入。
- 新增 `sanitizeSkillName()` 和 `inferSkillName()`。
- 新增 `httpGetBuffer()`，用于远程 ZIP 二进制下载。
- 新增 `readSkillSourceIndex()`，官方 registry 优先读本地 `skills-registry/index.json`，并 strip BOM。
- 新增 `resolveLocalSkillPath()` 和 `readSkillMarkdownFromEntry()`，支持本地 registry 条目直接读本地 SKILL.md。
- `cloneAndFindSkillMd()` 会清理临时 clone 目录。
- `/api/skills/install` 会清理 skill name。
- `/api/skills/install-source` 会从 frontmatter `name:` 推断 skill 名。
- `saveArtifactFile()` 使用安全文件名，不再重复追加扩展名。
- `/api/outputs/file` 修复反斜杠检测和路径 join。

### `web/app.js`

- 任务行增加 `data-task-id`、`data-parent-task-id`、`data-chain-depth`。
- 刷新恢复运行态时默认 `running = []`、`tasks = []`。
- 从 tasks.jsonl 合成运行态时补齐 `startedAt`。
- Skills 市场安装按钮改为调用 `/api/skills/install`，并检查 `res.ok` 与 `data.ok`。
- 子代理按钮只注入到链式子任务。

### `skills-registry/index.json`

- `updated_at` 更新到 `2026-06-17`。
- 保留 `shell-exec` 注册项。

### `skills-registry/shell-exec/SKILL.md`

- 新增官方 skill 定义。
- 描述 shell 执行、风险确认、stdout/stderr/exit code 证据模板。

### `README.md`

- 改为中文。
- 记录当前功能、API、架构、运行时数据、本轮修复和验证结果。

## 已验证

静态检查：

```bash
node --check server.mjs
node --check web/app.js
git diff --check
```

命令安全分类：

```text
Write-Output OK => safe
git push origin main => caution
git reset --hard HEAD => destructive
Remove-Item -Recurse .\tmp => caution
```

本地临时服务验证（端口 7879）：

```text
registryShell=shell-exec:shell-exec/SKILL.md
marketInstall=shell-exec
shellStream 包含 stdout "OK\r\n" 且 exitCode=0
badNameStatus=400
```

## 注意事项

- 浏览器自动点击验证本轮没有执行：当前会话没有暴露可用的 in-app browser 工具；已用服务级 API 验证覆盖关键路径。
- `.myteam/lessons.jsonl` 是本地运行时记忆，已记录本轮 lesson，但不会被 git 提交。
- `chainTaskMessages` 仍是内存 Map；服务重启后子代理历史不会持久化。
- Shell 执行目前有 30 秒 timeout，前端 SSE 断开不主动终止命令。
- 官方 registry 的本地优先策略只对 `myteam-official` 生效；`clowder-ai` 仍走远程 manifest。

## 后续建议

- 给 `/api/skills/install`、`/api/skills/install-source`、`/api/outputs/file` 补自动化测试。
- 子代理消息如果要跨服务重启保留，可落到 `.myteam/chain-messages.jsonl`。
- Shell 执行建议增加 allowlist 工作目录和更细的 Windows 命令拆分策略。
- 若 Browser 插件可用，补一轮页面级验证：打开 Skills、安装 market skill、执行 safe shell、打开 artifacts panel。


## 本轮已完成（2026-06-18）

本次 session 修复了运行时稳定性问题并添加了实时重连能力，同时制定了与 LobsterAI 协作架构对齐的优先级路线图。

### 1. PowerShell spawn 修复（EPERM）

.cmd 文件的 spawn 从 cmd.exe /c 改为 powershell -NoProfile -Command，解决了 Windows 下 codex.cmd 等 .cmd 文件 spawn 时 EPERM 错误。

**文件**：agent-utils.mjs → buildSpawnCommand()

### 2. 流式输出闪烁修复

- streamRender 的 JSON 检测改为 **sticky** 模式：一旦判定为结构化内容，整个流式期间稳定显示占位提示，不再每帧 flip
- 思考面板在流式期间保持折叠，agent 完成后以**紧凑缩略态**显示（toggle 栏 + 单行预览），点击才展开完整思考内容
- 流式气泡添加 min-height，避免布局跳动

**文件**：web/app.js / web/app.css

### 3. 刷新后运行任务恢复（SSE 重连总线）

刷新前正在运行的 agent 任务，现在刷新后**不会丢失**。

**实现**：服务端新增 per-session SSE 广播总线（sessionBuses），streamAgent 产出的每个事件广播给 session 所有监听者并缓存最近 500 条。新增 GET /api/sessions/:id/stream 重连端点，先回放缓存再订阅后续。前端 restoreRunningState 检测到运行中 session 时自动重连并重建 typing bubble。

**文件**：server.mjs / web/app.js

### 4. 拆任务 JSON 解析增强（多策略提取）

extractJson 从单策略括号匹配重写为多策略恢复：
1. 扫描所有平衡的 {...} 候选块，逐个试 JSON.parse
2. 对失败候选调用 repairJson 去尾随逗号、闭合字符串、平衡括号
3. 首 { 到尾 } 截取再试

覆盖 markdown 代码块包裹、散文夹 JSON、尾随逗号等场景。

**文件**：agent-utils.mjs

---

## LobsterAI 对齐优先级路线图

Git clone/partial fetch 曾连续被 reset；最终通过 Windows BITS 下载 main 分支完整源码 ZIP，解压到 `D:\myteam\.compare\LobsterAI-full\LobsterAI-main`（1393 个文件）。同时通过 GitHub connector 保存了 commit `e213217d` 的优先级精确参考树到 `.compare\LobsterAI-reference`。

**核心差异**：LobsterAI 通过 OpenClaw runtime 的 tool-call 协议（sessions_spawn / sessions_resume）派生和管理子 agent，myteam 当前通过文本 JSON 解析 + 服务端编排。

### P0 ✅ — 任务登记改为结构化输出

Plan 现在以 JSON Schema 为契约。Codex CLI 优先使用 `--output-schema`；其他 CLI 或不兼容模型进入统一规范化兜底。

**实际改动**：server plan 和 CLI plan 都调用 `parseStructuredPlanOutput()`；`/api/plan` 不再直接调用旧 `extractJson + validatePlanResult`，并向前端回传 structured mode。

### P1 ✅ — 子 agent 派生改为 spawn 协议

myteam 继续使用本地 CLI，但主 agent 已能在结果里自主声明要派给谁、做什么和如何验收。

**实际改动**：执行 prompt 注入 `<spawn_subagent>` 协议，服务端作为 runtime adapter 创建子任务和 run；结构化 spawn 优先，`@mention` 仅作兼容回退。

### P2 ✅ — Continuity Capsule（跨 turn / 跨 agent 上下文接力）

LobsterAI 的 CoworkContinuityCapsule 从消息流提取 currentObjective / decisions / completedFacts / recentFailures / nextSteps / touchedFiles，在 context compaction 和跨 agent 交接时注入。

**实际改动**：session 持久化 capsule，并为 executor/reviewer 注入 current objective、constraints、decisions、facts、files、verification、failures 和 next steps。

### P3 ✅ — Top-K Evidence 检索注入

LobsterAI 每次续写前从历史消息检索 top-3 最相关证据片段（文件路径 / 命令 / 错误），避免全量历史注入。

**实际改动**：按 task 和 capsule 关键词给 session history 评分，只注入最多 3 条真实命中的证据。

### P4 ✅ — Workspace Rehydration（工作区状态快照）

LobsterAI spawn 子 agent 前跑 git status / git log --stat 提取工作区状态，组成 workspace bridge 注入。

**实际改动**：每个 task 前生成 git status、latest commit stat 和 working diff stat，作为 workspace bridge 注入。

### P5 ✅ — Subagent 可视化与生命周期管理

LobsterAI 的 subagentTracker 维护 toolCallId -> status(running/done/error) 状态机 + 消息缓存 + DB。前端展示每个子 agent 进度。

**实际改动**：每个 spawn 持久化 JSONL run/message，提供查询 API、重启恢复规则和 Hub 子代理状态列表。

### 已完成执行顺序

P0 → P2 → P4 → P1 → P3 → P5

- P0 先根除解析失败这个最痛的点
- P2/P4 能直接抄 LobsterAI 代码、改动中等但立刻提升交接质量
- P1 架构级大改，放后面
- P3/P5 锦上添花

---

## 注意事项（更新）

- `--output-schema` 只在 Codex CLI 路径启用；模型/代理不兼容时由统一 schema 规范化器走兼容解析，但仍严格验收字段。
- myteam 不是 OpenClaw runtime；P1 使用等价的 `<spawn_subagent>` 结构化协议，服务端作为 runtime adapter 执行和回流。
- 完整源码位于 `.compare/LobsterAI-full/LobsterAI-main`；它来自 GitHub main ZIP，不含 `.git` 历史。`.compare/LobsterAI-reference` 保留 P0-P5 对应 commit 的精确文件。
- `.myteam/subagent-runs.jsonl`、`.myteam/subagent-messages.jsonl` 和 `.myteam/schemas/` 是运行时文件，已加入 `.gitignore`。

---

## LobsterAI P0-P5 完成记录（2026-06-18）

### P0 结构化 Plan

- 新增 `PLAN_OUTPUT_SCHEMA` 和 `.myteam/schemas/plan.schema.json`。
- Codex 的 server plan 与 CLI plan 都附加 `--output-schema`。
- `parseStructuredPlanOutput()` 统一处理 native JSON、Markdown envelope 和兼容候选，并规范化 agent/字段/长度。
- `/api/plan` 不再直接调用旧的 `extractJson + validatePlanResult`。

### P2 Continuity Capsule

- session 新增持久化 `continuity` 字段。
- 从最近 40 条历史提取 objective、constraints、decisions、completed facts、touched files、verification、failures、next steps 和 questions。
- chat、plan、dispatch、task result 都会刷新 capsule。

### P4 Workspace Rehydration

- 每个 task 执行前读取 `git status --short --branch`、`git log -1 --oneline --stat`、`git diff --stat`。
- bridge 标记为系统维护参考，不当作新用户指令。

### P1 Spawn 协议

- 执行 agent prompt 注入 `<spawn_subagent>{agent,task,label,accept}</spawn_subagent>` 协议。
- 优先消费结构化 spawn；没有结构化块时才回退到旧 `@mention`。
- 结构化派生任务保留 parent task、chain depth、session 和协议来源。

### P3 Top-K Evidence

- 按 task goal/title/accept/steps 和 capsule 文件词提取查询词。
- 从 session 历史评分并注入最多 3 条相关证据。
- evidence 同时提供给 executor 和 reviewer。

### P5 Subagent 生命周期与 UI

- JSONL 持久化 run/message，状态为 `running / done / error`。
- 服务启动时把上次残留 running run 标记为 error。
- 新增 `GET /api/subagents` 和 `GET /api/subagents/:id/messages`。
- 旧 `/api/chain-task/messages` 会回退读取持久化消息。
- Hub 新增「子代理」Tab，展示统计、列表、状态和详情入口。

### 验证

- `node --check`：`agent-utils.mjs`、`server.mjs`、`plan.mjs`、`web/app.js`、`collaboration-context.mjs` 全部通过。
- `node --test tests/*.test.mjs`：8/8 通过。
- API：subagent list、done summary、持久化 task-done 映射、首页 200、schema maxItems=7。
- Playwright + Edge：桌面/390px 手机 Hub 子代理页通过；手机 `body/doc/viewport` 宽度均为 390，无横向溢出。

---

## P6-P8 交接（2026-06-19）

### 已完成

- P6：新增统一风险策略、服务端审批对象、原始载荷指纹、单次/会话授权、拒绝/过期和脱敏审计；覆盖 shell、skill 安装/删除、配置写入和 dispatch。
- P7：最低 Node 提升到 22.5，使用 `node:sqlite`；sessions/messages、tasks、lessons、invocations、subagents、approvals/audit、schedules/runs 迁移到 `.myteam/myteam.sqlite`。
- P7：首次启动先备份旧 JSON/JSONL 到 `.myteam/migrations/legacy-*`，再事务导入；SQLite 成为唯一写入源。
- P8：新增五段 Cron、时区、启停、删除、手动触发、互斥、错过触发 skipped 和运行历史；执行默认等待审批。
- Hub 新增「审批」与「定时」Tab，移动端保持 390px 页面宽度，tabs 在抽屉内部滚动。

### API 与状态

- 审批：`GET /api/approvals`、`POST /api/approvals/:id/decision`、`GET /api/audit`。
- 调度：`GET/POST /api/schedules`、`PATCH/DELETE /api/schedules/:id`、`POST /api/schedules/:id/run`、`GET /api/schedule-runs`。
- 定时运行状态：`queued / waiting_approval / running / succeeded / failed / cancelled / skipped`。

### 验证结果

- `npm run check` 通过。
- `npm test`：11/11 通过；新增审批指纹/脱敏、SQLite session、Cron 时区/审批/互斥测试。
- HTTP：危险 shell 返回 202；拒绝后不执行。定时运行由 waiting_approval 转为 cancelled，审计和 SQLite 均有记录。
- Browser：桌面 1280px 与手机 390x844 通过；无 console error/warn，无页面级横向溢出，审批/定时页和创建计划交互正常。

### 限制与下一步

- P6 只控制 myteam 管理的 HTTP/执行入口，不能逐项拦截外部 CLI 内部工具调用。
- Scheduler 依赖 myteam 进程持续运行；当前没有系统服务安装器或远程通知。
- 建议下一轮增加数据库导出/恢复 CLI，再评估 agent 原生 permission adapter。
- 详细对比见 `docs/lobsterai-comparison.md`，经验见 `docs/lessons-p6-p8.md`。
