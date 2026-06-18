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

已拉取 netease-youdao/LobsterAI 参考仓库（本地 F:\py project\LobsterAI-ref），对比分析后制定以下对齐优先级。

**核心差异**：LobsterAI 通过 OpenClaw runtime 的 tool-call 协议（sessions_spawn / sessions_resume）派生和管理子 agent，myteam 当前通过文本 JSON 解析 + 服务端编排。

### P0 — 任务登记从文本解析改为结构化输出（根源修复）

当前 PLAN_PROMPT 让 codex 吐文本 JSON，extractJson 再提取——LobsterAI 没有这一步，它的 spawn 参数天然结构化。codex CLI 具备 --output-schema 选项（需验证模型兼容性）。

**改动**：plan 阶段让 agent 输出符合 JSON schema 的结构化数据，服务端直接从结构化字段读取，彻底删除 extractJson + validatePlanResult。如 schema 模式不可用则走 tool-call 方式。

### P1 — 子 agent 派生改为 spawn 协议

当前 dispatch 是服务端 for 循环串行 streamAgent。LobsterAI 是主 agent 在对话中自主决定何时派出、派给谁，子结果通过 tool_result 协议回流。

**改动**：dispatch 从服务端编排改为主 agent 自主编排——主 agent 调用 spawn_subagent 工具，服务端退化为 runtime 适配层。收益：主 agent 可根据上游结果动态决策。

### P2 — Continuity Capsule（跨 turn / 跨 agent 上下文接力）

LobsterAI 的 CoworkContinuityCapsule 从消息流提取 currentObjective / decisions / completedFacts / recentFailures / nextSteps / touchedFiles，在 context compaction 和跨 agent 交接时注入。

**改动**：抄 coworkContinuityCapsule.ts 的正则提取逻辑（已含中英双语 RE），为 dispatch 的 task 间交接、reviewer 审查生成胶囊。改动中等，收益大。

### P3 — Top-K Evidence 检索注入

LobsterAI 每次续写前从历史消息检索 top-3 最相关证据片段（文件路径 / 命令 / 错误），避免全量历史注入。

**改动**：给 streamAgent prompt 构造加一层 evidence 检索，按 task 关键词从 session history 捞最相关 N 条。局部改动，可独立实施。

### P4 — Workspace Rehydration（工作区状态快照）

LobsterAI spawn 子 agent 前跑 git status / git log --stat 提取工作区状态，组成 workspace bridge 注入。

**改动**：dispatch 每个 task 前生成工作区快照注入 buildExecPrompt。改动小，抄 LobsterAI 的 git 命令即可。

### P5 — Subagent 可视化与生命周期管理

LobsterAI 的 subagentTracker 维护 toolCallId -> status(running/done/error) 状态机 + 消息缓存 + DB。前端展示每个子 agent 进度。

**改动**：配合 P1，给每个 spawn 建结构化 run 记录，前端做子 agent 列表 + 进度条。P1 的自然延伸。

### 建议执行顺序

P0 → P2 → P4 → P1 → P3 → P5

- P0 先根除解析失败这个最痛的点
- P2/P4 能直接抄 LobsterAI 代码、改动中等但立刻提升交接质量
- P1 架构级大改，放后面
- P3/P5 锦上添花

---

## 注意事项（更新）

- codex exec --output-schema 实测未生效（kimi-k2.6 模型下不约束输出），P0 前需先验证模型兼容性。
- 项目目录残留 _*.cjs / _*.js / test_extract.cjs / app_clean_head.tmp.js 临时文件（沙箱禁止删除），需要手动清理。
- 临时验证目录 .tmp-plan-schema 包含计划 schema 定义和实测输出，可用于后续 P0 验证。
- LobsterAI 克隆到 F:\py project\LobsterAI-ref，方便后续对照开发。