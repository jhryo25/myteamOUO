# myteamOUO Issue Tracker

> 问题、解法、教训统一管理。每条记录对应一次 git commit。

---

## 标签说明

| 标签 | 含义 |
|------|------|
| `bug` | 功能缺陷 |
| `ux` | 用户体验问题 |
| `arch` | 架构/设计问题 |
| `quality` | 代码质量 |
| `security` | 安全问题 |
| `lesson` | 沉淀的教训 |

---

## Phase 1: BUG 修复 (2026-06-12)

### ISS-001: welcome 元素引用失效 [bug]

- **位置**: `web/app.html:1423`
- **问题**: `hideWelcome()` 引用模块顶部 `const welcome`（初始 DOM 元素），`clearChatArea()` 创建新 welcome 挂 `window.welcome`，两者不同步。切换 session 后发消息，新 welcome 不消失。
- **根因**: 全局变量引用 vs 动态 DOM 创建不一致。`const welcome` 在模块加载时绑定初始元素，后续 `clearChatArea` 创建新元素但 `hideWelcome` 仍找旧引用。
- **解法**: `hideWelcome()` 改为 `document.getElementById('chatWelcome')?.remove()`，每次动态查找。
- **教训**: 单页应用中，DOM 元素会被动态创建/销毁，不要用模块级 `const` 缓存 DOM 引用。应改为函数内查找或状态管理。
- **标签**: `bug`, `lesson:全局变量管理UI状态是单页应用大坑`

### ISS-002: cleanMessage 只清行首 @mention [bug]

- **位置**: `server.mjs:486`
- **问题**: `cleanMessage` 用 `/^@(claude|codex)\s*/i` 只清行首，但 `parseAtMention` 匹配任意位置。用户输入 `"请 @claude 帮我"` 时，agent 收到的 prompt 仍含 `@claude`。
- **根因**: 前后端 prompt 清理逻辑不一致。`parseAtMention` 宽松匹配，`cleanMessage` 严格匹配。
- **解法**: `cleanMessage` 改为 `/@(claude|codex)\b/gi` 全局替换。
- **教训**: 路由解析和消息清理必须用同一套正则，否则 agent 会收到含路由指令的 prompt，产生困惑回复。
- **标签**: `bug`, `lesson:前后端prompt清理逻辑必须一致`

### ISS-003: abort 场景 unhandled rejection [bug]

- **位置**: `server.mjs:326`
- **问题**: 用户点 ■ 中断 → `abortAllChildren()` kill 子进程 → exit code 非 0 → `reject()` → 但前端已断开 SSE 连接 → unhandled promise rejection。
- **根因**: abort 是主动行为，但 `close` 事件不区分"正常退出"和"被 abort kill"，统一走 reject 路径。
- **解法**: 加 `isAborting` 标志位，`abortAllChildren()` 时设为 true，`close` 事件中检查该标志，abort 场景走 resolve。
- **教训**: abort 场景需要全链路处理——前端 abort → SSE 断开 → 后端子进程 kill → close event → 每个环节都要感知 abort 状态。
- **标签**: `bug`, `lesson:abort场景需要全链路处理`

### ISS-004: loadHistory 连续 assistant 消息渲染截断 [bug]

- **位置**: `web/app.html:2332-2335`
- **问题**: `loadHistory` 中连续两条 assistant 消息时，`startAgentBubble` 覆盖全局 `agentTypingBubble` 引用，`finishTyping` 只处理最后一条 → 前一条消息渲染不完整。
- **根因**: `startAgentBubble/finishTyping` 是为流式打字设计的，依赖全局单例 `agentTypingBubble`。历史加载是批量操作，不应走流式流程。
- **解法**: 历史加载直接创建 DOM + `renderRichText(h.text)`，不走 `startAgentBubble/finishTyping`。
- **教训**: 流式渲染和批量渲染是两种不同模式，不能混用同一套全局状态。历史加载应独立走"直接渲染"路径。
- **标签**: `bug`, `lesson:流式渲染和批量渲染不能混用全局状态`

### ISS-005: .gitignore 遗漏 memory.json [security]

- **位置**: `.gitignore`
- **问题**: `.myteam/memory.json`（对话历史）未被 `.gitignore` 排除，可能提交到 git 仓库。
- **根因**: 新增 `memory.json` 持久化文件时忘记更新 `.gitignore`。
- **解法**: `.gitignore` 加 `.myteam/memory.json`。
- **教训**: 每次新增运行时持久化文件，必须同步更新 `.gitignore`。可用 pre-commit hook 检查 `.myteam/` 下所有文件是否被排除。
- **标签**: `security`, `lesson:.gitignore要覆盖所有运行时文件`

### ISS-006: trashedSessions 不持久化 [bug]

- **位置**: `server.mjs:91-104` (saveSessions) + `server.mjs:57-89` (loadSessions)
- **问题**: `trashedSessions` 只在内存中，`saveSessions()` 不写入 `memory.json` → 服务重启后回收站清空，刚删除的 session 无法恢复。
- **根因**: 回收站功能是后加的，持久化逻辑没同步更新。
- **解法**: `saveSessions` 写入 `trashedSessions`，`loadSessions` 恢复时过滤已过期条目。
- **教训**: 所有用户可见的临时状态都应持久化。"临时"不等于"不需要持久化"——回收站对用户来说是可恢复的安全网。
- **标签**: `bug`, `lesson:数据持久化要完整`

---

## Phase 2: 交互对齐改进 (2026-06-12)

### IMP-001: @mention 改行首匹配 [ux] ✅ 已完成

- **参考**: clowder-ai `@catname` 只在新行开头触发路由，inline 提及不触发
- **问题**: myteamOUO 任意位置 `@mention` 都触发，代码/引用中 `@claude` 会误触发路由
- **解法**: `parseAtMention` 和 `cleanMessage` 都改为行首匹配正则 `/(?:^|\n)\s*@(claude|codex)\b/i`
- **教训**: 路由触发条件要严格，避免误触发。参考 clowder-ai 的行首匹配策略。
- **标签**: `ux`, `lesson:路由触发要严格`

### IMP-002: A2A 链式加乒乓球熔断 [arch] ✅ 已完成

- **参考**: clowder-ai WorklistRegistry + streak 追踪 + 乒乓球熔断（F167）
- **问题**: depth ≤ 3 但无 streak 检测，两个 agent 互 @ 会跑满 3 轮（A→B→A→B）
- **解法**: 在 `executeTask` 中传递 `chainHistory` 数组，检测最后 4 个 agent 是否形成 A→B→A→B 交替模式，触发熔断并发送 `worklist-circuit-break` 事件
- **教训**: A2A 链式调用需要防循环机制，depth 限制不够，还要检测交替模式。参考 clowder-ai 的 F167 乒乓球熔断。
- **标签**: `arch`, `lesson:A2A链式需要防循环`

### IMP-003: chain task 携带上游分析摘要 [ux] ✅ 已完成

- **参考**: clowder-ai 五件套交接（What/Why/Tradeoff/Open/Next）
- **问题**: A2A chain task 只传 title + goal，上游 agent 的分析结果丢失
- **解法**: 在创建 chain task 时，将上游 agent 的回复截取前 300 字符作为 `upstreamSummary`，注入到 steps 数组第一项
- **教训**: 多 agent 协作时，上下文传递很重要。参考 clowder-ai 的五件套交接，确保下游 agent 能理解上游的分析。
- **标签**: `ux`, `lesson:多agent协作要传递上下文`

### IMP-004: 代码去重 [quality] ✅ 已完成

- **问题**: `PLAN_PROMPT` / `buildExecPrompt` / `readTasks` / `writeAllTasks` / `appendTask` / `patchTask` 在 server.mjs 和 plan.mjs/dispatch.mjs 中重复定义
- **解法**: 
  - 将 `readTasks` / `writeAllTasks` / `appendTask` / `patchTask` 抽到 `agent-utils.mjs` 导出
  - 将 `PLAN_PROMPT` / `buildExecPrompt` 抽到 `agent-utils.mjs` 导出
  - server.mjs 和 dispatch.mjs 改为 import 使用
  - dispatch.mjs 中 `writeTasks` 重命名为 `writeAllTasks` 保持一致
- **教训**: 重复代码是维护噩梦。参考 DRY 原则，将共享逻辑抽到公共模块。
- **标签**: `quality`, `lesson:DRY原则`

### IMP-005: extractJson 贪心匹配 [quality] ✅ 已完成

- **位置**: `agent-utils.mjs:124-129`
- **问题**: `\{[\s\S]+\}` 贪心匹配，当文本中有多个 JSON 对象时会匹配从第一个 `{` 到最后一个 `}` 的所有内容
- **解法**: 使用括号配对算法（栈匹配），找到第一个完整的 JSON 对象。处理字符串内的括号和转义字符，确保准确定位 JSON 边界
- **教训**: 正则表达式处理嵌套结构（如 JSON）时容易出错，应该使用状态机或栈匹配算法。
- **标签**: `quality`, `lesson:嵌套结构用状态机而非正则`

---

## Phase 3: clowder-ai 交互对齐 (2026-06-12)

### IMP-007: 任务栏竖排文字倒置 [bug]

- **位置**: `web/app.css:458`
- **问题**: `writing-mode: vertical-rl` + `transform: rotate(180deg)` 双重翻转，"任务"两字倒读
- **解法**: 改为 `writing-mode: vertical-lr` + `rotate(0deg)`
- **教训**: `vertical-rl` 字符本身已从上到下排列，`rotate(180deg)` 是多余的翻转

### IMP-008: 交互对齐 - pending 按钮 + plan 执行建议 [ux]

- **参考**: clowder-ai PlanBoardPanel 任务卡片有 running/interrupted/completed 分组
- **改动 1**: dispatch 按钮无 pending 时隐藏（而非 disabled），有任务时才出现
- **改动 2**: plan 完成后 plan card 底部增加"执行建议"行，按 agent 分组 + 手动选择两种入口
- **教训**: 主动展示建议比被动等用户发现 pending 按钮体验更好

### IMP-009: 交互对齐 - session popover + 进度条 + 中断继续 [ux]

- **参考**: clowder-ai ThreadItem.tsx popover 操作菜单 + PlanBoardPanel 进度条 + interrupted 继续按钮
- **改动 1**: session sidebar `session-item-del` → `session-item-more` (`···`) 按钮展开 popover，含 rename/delete；rename 走 inline `contentEditable`；后端新增 `POST /api/sessions/:id/rename`
- **改动 2**: 任务面板每个 run-group 标题下加 done/total 进度条，有 failed 时红色
- **改动 3**: dispatch abort 或有 failed 时，聊天区出现橙色高亮 `resume-prompt`，内嵌"继续执行剩余任务"按钮，点击触发 dispatchBtn
- **教训**: 中断恢复需要贴近上下文的触发入口（在聊天流里），而不是让用户去找面板按钮

### IMP-010: 交互对齐 - hover 操作栏 + 排队发送 + 时间戳 + 连接状态条 [ux]

- **参考**: clowder-ai MessageActions.tsx + ChatInputActionButton.tsx + ChatMessage.tsx + ConnectionStatusBar.tsx
- **改动 1 (hover 操作栏)**: `.bubble-content-wrap` 内绝对定位 `.bubble-actions`，hover 时浮现；用户气泡含复制+删除，agent 气泡含复制；`navigator.clipboard.writeText` + 1.2s `✓` 反馈
- **改动 2 (排队发送)**: 新增 `isRunning` 状态 + `messageQueue` 数组；运行中 sendBtn 变蓝色 `.queue-mode` (⏎)；`doSend` 检测 isRunning 时入队 + addSystemMsg 提示；`ssePost` finally 自动消费队列；移除原 `doChat`/`doPlan`/`dispatch` 中手动 `sendBtn.disabled` 由 `setRunning` + `updateSendBtnState` 统一管理
- **改动 3 (时间戳)**: `formatTime(ts)` 工具；用户气泡 `bubble-name` 内嵌 `HH:MM`；agent 气泡占位 `#bubbleTime`，`finishTyping` 时回填完成时间
- **改动 4 (连接状态条)**: `setConnectionStatus(level)`，level `online` 时移除 bar，`degraded`/`offline` 时在 topbar 后插入颜色 bar；脉冲 dot 动画
- **教训**: 
  - 异步状态用全局 `isRunning` + 单点更新函数比散落在各处 `disabled = true/false` 易维护
  - hover 操作栏要绑定到 `bubble-content-wrap` 而非 `bubble-row`，否则用户侧 flex row-reverse 后定位会跑

### IMP-006: web/app.html 拆分为 CSS + JS + HTML [quality] ✅ 已完成

- **问题**: `web/app.html` 是 2350 行的单文件，包含 HTML + CSS + JavaScript，难以维护和协作
- **解法**: 
  - 提取所有 CSS 到 `web/app.css`（1135 行）
  - 提取所有 JavaScript 到 `web/app.js`（1087 行）
  - `web/app.html` 只保留 HTML 结构（135 行）
  - 在 `server.mjs` 中添加静态文件服务，支持 `/app.css` 和 `/app.js` 路由
  - 使用 `<link rel="stylesheet">` 和 `<script src>` 引入外部文件
- **教训**: 关注点分离是前端工程化的基础。HTML/CSS/JS 拆分后，代码更易维护，浏览器缓存更高效，团队协作更顺畅。
- **标签**: `quality`, `lesson:关注点分离`

---

## Phase 4: Kimi 接入与 Review 修复 (2026-06-13)

### IMP-011: Kimi CLI 进入可配置 agent 列表 [ux]

- **位置**: `agent-utils.mjs`, `server.mjs`, `web/app.js`, `web/app.html`
- **问题**: `.env.example` 预留了 `KIMI_PATH`，但后端状态 API、配置抽屉、@mention 路由、任务执行链都只认 `codex` / `claude`。
- **解法**: 新增 `AGENT_KEYS = ['codex', 'claude', 'kimi']`，Kimi 使用 `kimi -p "<prompt>" --output-format text` 调用；状态 API、配置 API、前端抽屉、头像、@mention、plan/dispatch 均支持 `kimi`。
- **教训**: 预留配置不等于完成接入；必须贯通配置、状态、路由、调用、UI 展示和验证。
- **标签**: `ux`, `arch`

### ISS-007: 前端 @mention 提示与后端路由不一致 [bug]

- **位置**: `web/app.js`
- **问题**: 后端只在行首识别 `@mention`，但前端提示任意位置的 `@claude` / `@codex` / `@kimi` 都会路由，导致用户被误导。
- **解法**: 前端 `MENTION_RE` 改为与后端一致的行首匹配。
- **教训**: 提示逻辑必须和实际执行逻辑一致，否则 UX 会制造假承诺。
- **标签**: `bug`, `ux`

### ISS-008: plan 建议按钮没有按 agent 过滤执行 [bug]

- **位置**: `web/app.js`, `server.mjs`
- **问题**: plan card 上的“让某 agent 执行”按钮文案表示只执行该 agent 的任务，但实际点击的是全局 dispatch，执行所有 pending。
- **解法**: 前端调用 `runDispatch({ agentOnly })`，后端 `/api/dispatch` 根据 `agentOnly` 过滤 pending 任务。
- **教训**: 按钮文案表达的范围必须和后端执行范围一致，尤其是会触发 agent 执行的动作。
- **标签**: `bug`, `ux`

### ISS-009: Codex 路径存在但 Node spawn EPERM [bug]

- **位置**: `agent-utils.mjs`, `server.mjs`, `web/app.js`
- **问题**: `/api/status` 只用 `existsSync(path)` 判断 agent 可用，导致 WindowsApps 里的 Codex `codex.exe` 虽然存在，但实际被 Node `spawn` 时会报 `EPERM`。前端误把 Codex 当成可用 agent，拆任务时报“spawn EPERM”。
- **解法**: 新增 `checkAgentLaunchable()`，用轻量 `--help` 真正尝试启动 CLI；状态 API 返回 `exists / available / error`；前端只把 `available=true` 的 agent 放入拆任务选项，并在配置抽屉显示启动失败原因。
- **教训**: “文件存在”只能说明路径没写错，不能说明 CLI 能被当前进程启动。agent 可用性必须做启动级检测。
- **标签**: `bug`, `windows`, `lesson:文件存在不等于可执行`

### IMP-012: 对齐 clowder-ai 的 Hub 指挥中心雏形 [ux]

- **位置**: `web/app.html`, `web/app.css`, `web/app.js`, `docs/clowder-html-gap.md`
- **问题**: myteam 的 HTML 已有聊天、任务栏和 Agent 配置，但缺少 clowder-ai 那种集中查看能力、任务、成本和治理方向的 Hub 入口；用户需要在多个位置猜系统状态。
- **解法**: 顶部新增 `Hub` 按钮和 `myteam Hub` 抽屉，提供总览、Agent、任务、对比四个 tab；Hub 从现有 `/api/status` 和 `/api/tasks` 读取数据，不引入新依赖。
- **教训**: 轻量 MVP 也需要一个“状态集中点”。先做只读 Hub，可以在不增加系统复杂度的前提下提升可理解性，并为后续 Skills / Quota / Reviewer Gate 留入口。
- **标签**: `ux`, `html`, `lesson:先做只读Hub再扩展治理`

### IMP-013: 新增静态 Skills 看板 [ux]

- **位置**: `.myteam/skills.yaml`, `server.mjs`, `web/app.html`, `web/app.css`, `web/app.js`
- **问题**: clowder-ai Hub Skills tab 会展示技能、触发条件、依赖和挂载 agent；myteam 目前只有固定 agent 角色，用户看不到“什么能力应该交给谁”。
- **解法**: 新增 `.myteam/skills.yaml` 作为 MVP 技能清单；后端提供 `GET /api/skills`；Hub 增加 `Skills` tab，展示技能分类、触发条件和 controller/worker/reviewer/codex/claude/kimi 的挂载情况。
- **教训**: Skills 系统可以先从只读登记表开始，先让能力边界可见，再升级到真正的按需提示词加载。
- **标签**: `ux`, `skills`, `html`, `lesson:能力先可见再自动化`

### IMP-014: 新增轻量调用/成本可见性 [ux]

- **位置**: `server.mjs`, `web/app.html`, `web/app.css`, `web/app.js`
- **问题**: clowder-ai 有 Quota Board 展示模型额度和风险；myteam 之前看不到 agent 调用了多少次、失败率和耗时，排查成本和稳定性都不直观。
- **解法**: `streamAgent()` 每次调用追加 `.myteam/invocations.jsonl`，记录 agent、label、状态、耗时、退出码、输入/输出字符数和错误；后端新增 `GET /api/invocations`；Hub 新增“调用”tab。
- **教训**: 在拿不到精确 token/金额前，也可以先记录调用次数、耗时和失败率，形成低成本可观测性。
- **标签**: `ux`, `observability`, `quota`, `lesson:先记录调用再追精确成本`

### IMP-015: 新增人工 Reviewer Gate [self-iteration]

- **位置**: `server.mjs`, `agent-utils.mjs`, `web/app.html`, `web/app.css`, `web/app.js`
- **问题**: myteam 的任务执行完就进入 `done`，缺少 review/test gate；如果直接写长期记忆或继续自迭代，容易把未验收结果当成事实。
- **解法**: 新增 Hub `Gate` tab，展示待审核、已通过、需返工、失败阻塞；新增 `POST /api/tasks/:id/gate`，支持人工通过或返工。返工会把任务放回 `pending`，并把返工说明和上一次结果摘要注入下一次执行 prompt。
- **教训**: 自迭代先不要追求全自动，先让“通过/返工”成为结构化状态，再把 reviewer agent 接上去。
- **标签**: `ux`, `gate`, `reviewer`, `self-iteration`, `lesson:先有闸门再自动化`

### IMP-016: Skills 按需加载与页面去对比化 [skills]

- **位置**: `.myteam/skills.yaml`, `server.mjs`, `agent-utils.mjs`, `web/app.html`, `web/app.css`, `web/app.js`, `docs/architecture-evaluation.md`
- **问题**: Hub 里展示“差距对比”会把开发决策塞进产品界面；Skills 也只是静态表，没有真正影响 plan/dispatch。
- **解法**: 移除 Hub `对比` tab 和页面内差距说明；差距只保留在 docs。`GET /api/skills` 支持 `text/agent/phase` 参数，返回命中的 skill 和 prompt preview；plan/dispatch 时只注入命中的 skill 摘要。
- **教训**: 产品界面只放可操作状态，架构差距和技术评估放文档；Skills 先做轻量按需注入，再升级成完整文件级渐进加载。
- **标签**: `skills`, `ux`, `progressive-loading`, `lesson:对比进文档能力进流程`
