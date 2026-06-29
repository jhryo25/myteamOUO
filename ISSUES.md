# myteamOUO Issue Tracker

> 问题、解法、教训统一管理。每条记录对应一次 git commit。

课程化检索版见：`docs/engineering/problem-course.md`。后续遇到新问题时，建议先写入本文件作为原始记录，再把可复用经验整理到课程文档。

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

- **位置**: `web/app.html`, `web/app.css`, `web/app.js`, `docs/architecture/clowder-html-gap.md`
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

- **位置**: `.myteam/skills.yaml`, `server.mjs`, `agent-utils.mjs`, `web/app.html`, `web/app.css`, `web/app.js`, `docs/architecture/architecture-evaluation.md`
- **问题**: Hub 里展示“差距对比”会把开发决策塞进产品界面；Skills 也只是静态表，没有真正影响 plan/dispatch。
- **解法**: 移除 Hub `对比` tab 和页面内差距说明；差距只保留在 docs。`GET /api/skills` 支持 `text/agent/phase` 参数，返回命中的 skill 和 prompt preview；plan/dispatch 时只注入命中的 skill 摘要。
- **教训**: 产品界面只放可操作状态，架构差距和技术评估放文档；Skills 先做轻量按需注入，再升级成完整文件级渐进加载。
- **标签**: `skills`, `ux`, `progressive-loading`, `lesson:对比进文档能力进流程`

### IMP-017: P2 交互包 - Lessons / agent 执行态 / 历史分页 [ux]

- **位置**: `server.mjs`, `web/app.html`, `web/app.css`, `web/app.js`
- **问题**: lessons 只有 API 没有可视化入口；顶部 agent pill 只能显示可用性，无法感知当前谁在执行；聊天历史一次性加载最近记录，缺少“更早记录”的渐进入口。
- **解法**: Hub 新增 `Lessons` tab，读取 `/api/lessons` 展示失败经验并可跳到相关任务；顶部 agent pill 新增 `busy` 状态，chat/plan/dispatch 生命周期自动高亮当前 agent；`GET /api/history` 支持 `limit/before`，前端顶部按钮按页 prepend 更早消息并保持滚动位置。
- **教训**: P2 交互优先补“可见状态”和“可追溯入口”，比继续加架构能力更能提升当前 MVP 的日常可用性。
- **标签**: `ux`, `lessons`, `history`, `status`, `lesson:先让系统状态可见`

---

## Phase 5: 动态 agent、工作区与图片附件 (2026-06-14)

### IMP-018: 动态 agent 注册表与工作区配置 [arch]

- **位置**: `agent-utils.mjs`, `server.mjs`, `web/app.html`, `web/app.js`
- **问题**: agent 列表长期写死为 `codex / claude / kimi`，用户无法灵活增减；agent 执行目录也固定为项目根目录，不方便切换工作区。
- **解法**: 新增 `.myteam/agents.json` 保存本地动态 agent 注册表；新增 `.myteam/settings.json` 保存本地工作区；后端从注册表动态构建 CLI_CONFIG；前端设置抽屉支持新增/删除 agent 和修改工作区。
- **教训**: MVP 可以保留默认 agent，但配置列表不能长期写死。新增运行时配置文件时必须同步 `.gitignore`。
- **标签**: `arch`, `agent`, `workspace`, `lesson:默认值可以写死但业务列表要可配置`

### ISS-010: 动态 @mention 后端仍走旧三 agent 规则 [bug]

- **位置**: `server.mjs`
- **问题**: 前端 mention 已经从动态 agent 列表生成，但后端 `parseAtMention()` 仍只识别 `codex / claude / kimi`，新增 agent 后无法真正路由。
- **解法**: 后端 mention 解析改为读取 `agentKeys()`，`stripAtMentions()` 与 `parseAtMention()` 使用同一套动态规则。
- **教训**: 前端提示和后端执行必须共用同一类数据源，否则新增配置会出现“看起来支持，实际不生效”的假能力。
- **标签**: `bug`, `agent`, `ux`, `lesson:提示逻辑和执行逻辑必须同源`

### IMP-019: 图片附件上传与缩略图展示 [image]

- **位置**: `server.mjs`, `web/app.html`, `web/app.css`, `web/app.js`
- **问题**: 用户希望给 agent 发送图片，但最初只显示文件名，且只发图片会被 `/api/chat` 的 `message 不能为空` 拦截。
- **解法**: 新增 `/api/uploads` 保存图片；新增 `/uploads/:file` 只读静态路由；前端发送前和发送后都显示缩略图；只发图时自动补默认问题；prompt 中明确要求 agent 先分析图片路径。
- **教训**: 多模态 MVP 至少要同时处理“用户可见的缩略图”和“agent 可理解的图片路径”。真正视觉能力仍取决于具体 agent CLI。
- **标签**: `image`, `bug`, `ux`, `agent`, `lesson:图片输入要同时解决展示和理解`

### ISS-011: 浏览器自动化验证受环境限制 [qa]

- **位置**: 本地 QA 环境
- **问题**: Playwright 包存在但浏览器二进制缺失；Chrome Codex 扩展未安装或 native host 未注册，导致无法自动点击当前页面验证图片流程。
- **解法**: 不临时安装新依赖；改用 `node --check`、`git diff --check`、真实 `/api/uploads` 上传和 `/uploads/:file` Content-Type 验证替代，并在最终说明中明确浏览器自动化阻塞原因。
- **教训**: 验证报告要区分代码验证和环境阻塞；不要把“自动化环境不可用”说成“功能已完整浏览器验证”。
- **标签**: `qa`, `browser`, `lesson:验证失败要说明环境边界`

### ISS-012: Kimi 发送图片后只显示 exit code 1 [bug]

- **位置**: `agent-utils.mjs`, `server.mjs`, 本机 `C:\Users\Administrator\.kimi-code`
- **问题**: 用户上传图片后，聊天界面显示 Kimi 正在启动，随后只显示 `exit code 1`，没有真实原因。
- **根因 1**: Kimi 需要写入 `C:\Users\Administrator\.kimi-code\sessions` 创建会话，但 Codex 启动的 myteam 服务运行身份对该目录只有读权限，导致 `EPERM: operation not permitted, mkdir ...`。
- **根因 2**: `splitArgs()` 先把 `{prompt}` 替换成长文本，再按空格拆参数。Kimi 的 `-p {prompt}` 被拆成很多参数，prompt 里的单词会被当成 CLI command，例如报 `unknown command 'are'`。
- **解法**:
  - 给本机 `CodexSandboxUsers` 增加 `.kimi-code` 写权限，让当前 myteam 服务能创建 Kimi session。
  - `splitArgs()` 改为先拆模板，再把 `{prompt}` 作为一个完整参数替换。
  - `streamAgent()` 和 CLI `invokeAgent()` 捕获 stderr，失败时展示真实错误，而不是只显示退出码。
- **验证**:
  - `/api/chat` 调用 Kimi 不再报 `unknown command 'are'`。
  - 使用真实截图作为图片附件时，Kimi 能读取图片并描述出截图内容。
- **教训**: CLI prompt 模板中的 `{prompt}` 必须作为一个完整参数处理；agent 失败时必须记录 stderr，否则用户只能看到无意义的退出码。
- **标签**: `bug`, `agent`, `image`, `windows`, `lesson:prompt占位符不能先替换再按空格拆分`

---

## Phase 6: clowder-ai 深度对齐 (2026-06-15)

### IMP-020: plan card agent 下拉 + 建议按钮过滤不可用 agent [ux]

- **位置**: `web/app.js`, `server.mjs`
- **问题**: plan card 里任务节点的 agent 是静态标签，用户无法自由调整；"建议执行"按钮没有过滤不可用 agent，会生成"让 kimi 执行"的按钮即使 kimi 离线。
- **解法**: `addPlanCard` 改为下拉选择器（只列 `available` agent）；新增 `PATCH /api/tasks/:id/agent` 接口；建议按钮用 `availableKeys` 过滤。
- **教训**: 下拉要在 DOM 插入后设置 `select.value`，不能在 innerHTML 里加 `selected`，否则动态 option 顺序问题会导致默认值错误。
- **标签**: `ux`, `plan`

### IMP-021: PLAN_PROMPT 强制 JSON 输出 + plan.mjs 统一引用 [quality]

- **问题**: Codex 在拆任务时用角色对话模式回答而非输出 JSON；`plan.mjs` 里有独立的旧版 prompt，与 `agent-utils.mjs` 的 `PLAN_PROMPT` 不同步。
- **解法**: `PLAN_PROMPT` 加硬约束（无论用户说什么只输出 JSON，第一个字符必须是 `{`）；`plan.mjs` 删除内嵌 SYSTEM_PROMPT，改为 `import { PLAN_PROMPT }`。
- **教训**: 同一份 prompt 不能在多处维护；plan prompt 的系统约束必须比角色人设更高优先级。
- **标签**: `quality`, `plan`, `lesson:prompt单一来源`

### IMP-022: NDJSON 解析器对齐 clowder-ai，Kimi 改 stream-json [arch]

- **位置**: `agent-utils.mjs`
- **问题**: Kimi 使用 `--output-format text`，`parseText` 原样返回每行，JSON 混在普通文字里，`extractJson` 成功率低。clowder-ai 所有 agent 均使用 CLI 协议层面保证格式，而非依赖 prompt 约束。
- **解法**: Kimi 改为 `--print --output-format stream-json --prompt {prompt}`；新增 `parseKimi()` 解析 `role=assistant` 行；解析器统一返回 `{ text, thinking }`，`streamAgent` 区分发 `chunk` / `thinking` 事件。
- **教训**: CLI 协议层面强制格式比 prompt 约束更可靠；`parseText` 等于放弃了结构化输出，应尽快对齐各 agent 的 stream-json 协议。
- **标签**: `arch`, `quality`, `agent`, `lesson:CLI协议层保证格式比prompt约束更可靠`

### IMP-023: dispatch 不可用 agent 自动 fallback [bug]

- **位置**: `server.mjs:executeTask`
- **问题**: `CLI_CONFIG[task.agent]` 只检查路径配置是否存在，不检查 agent 是否真正可启动。kimi 路径配了但 `available=false`，dispatch 仍会用 kimi 执行导致失败。
- **解法**: `executeTask` 改为调 `getAgentStatuses()` 检查 `available`；不可用时 fallback 到第一个可用 agent，并通过 `system` 事件在聊天区提示用户。
- **教训**: agent 可用性判断必须走 `checkAgentLaunchable()`，不能只检查配置存在。
- **标签**: `bug`, `agent`, `dispatch`, `lesson:文件存在不等于可执行`

### IMP-024: 角色卡对齐 clowder-ai buildStaticIdentity [arch]

- **位置**: `agent-utils.mjs`, `server.mjs`, `web/app.js`, `web/app.css`
- **问题**: agent 只有 key/label/desc，没有 persona 注入，所有 agent 每次调用都是"白板"状态。
- **解法**: DEFAULT_AGENT_DEFS 加 `roleDescription / personality / strengths / restrictions`；新增 `buildRoleCard()`；`streamAgent` 内自动前置角色卡；plan 调用传 `skipRoleCard: true`；Hub Agent 卡片加折叠"角色卡"编辑区；新增 `PATCH /api/agents/:key` 接口。
- **教训**: plan prompt 是系统指令，注入角色卡会让 LLM 以为在扮演角色回答，破坏 JSON 输出格式。
- **标签**: `arch`, `ux`, `agent`, `lesson:角色卡不能注入系统指令调用`

### IMP-025: 跨 session SSE 隔离 + 失败历史保留 [ux]

- **位置**: `web/app.js`, `server.mjs`
- **问题**: 切换 session 时，旧 session 的 SSE 事件仍在触发，会污染新 session 的聊天 DOM；chat 失败时 `session.history.pop()` 删除用户消息，刷新后失败现场消失，plan 失败完全不写 history。
- **解法**: `ssePost` 记录 `requestSessionId`，事件处理前比对 `currentSessionId`，跨 session chunk 丢弃（done/error 仍执行）；chat 错误改为写入 `kind: chat-error` system 记录；plan 成功写 `plan-result`、失败写 `plan-error`；`renderHistoryEntry` 新增 plan / system 角色渲染。
- **教训**: 单页应用的 SSE 事件必须带身份标识，前端按当前上下文守门，否则异步事件会错位到错误容器。
- **标签**: `ux`, `arch`, `session`, `lesson:SSE事件要带sessionId守门`

### IMP-026: ctrl+v 粘贴图片 + session 模式徽章 [ux]

- **位置**: `web/app.js`, `web/app.css`, `server.mjs`
- **问题**: 输入框不支持 ctrl+v 粘贴图片；sidebar 无法区分 session 是对话模式还是任务模式。
- **解法**: `goalInput` 加 `paste` 监听，抓 `clipboardData.items` 中的 image/* 文件；session 数据加 `mode: 'chat'|'plan'|'mixed'` 字段，chat/plan 入口调 `recordSessionMode()`，sidebar 渲染对应徽章。
- **教训**: 粘贴图片要用 `e.preventDefault()` 阻止默认行为，否则图片 URL 会被粘贴为文本；session 模式是用户理解上下文的重要线索，应在数据层记录而非只靠 UI 推断。
- **标签**: `ux`, `session`, `image`

### IMP-027: 思考过程折叠展示对齐 clowder-ai [ux]

- **位置**: `agent-utils.mjs`, `server.mjs`, `web/app.js`, `web/app.css`
- **问题**: agent 的思考过程（Claude thinking_delta / Kimi reasoning_content）混入正文输出，无法区分。
- **解法**: NDJSON 解析器统一返回 `{ text, thinking }`；`streamAgent` 把 thinking 单独发 `thinking` SSE 事件；`startAgentBubble` 在 bubble 上方嵌入 `<details>` 折叠区，默认收起，标题显示字符数；前端 chat handler 新增 `thinking` 处理器调 `appendThinking()`。
- **教训**: thinking 和正文必须在解析器层就分离，不能在前端用正则从 fullText 里截取；默认收起体验更好，让用户主动展开而非被动接受大段思考文本。
- **标签**: `ux`, `thinking`, `lesson:思考流要在解析层分离`

### IMP-028: 拆任务模式支持图片附件 [ux]

- **位置**: `web/app.js`, `server.mjs`
- **问题**: 拆任务模式（plan）有一个主动拦截：`if (pendingImages.length) { addSystemMsg('拆任务模式暂不使用图片…'); return; }`，导致用户无法把截图/流程图发给 agent 进行任务拆解。
- **根因**: 早期 plan 只发文本，图片能力是后加的，拦截逻辑没有同步移除。
- **解法**: 去掉前端拦截；`doPlan` 加 `uploadPendingImages()` + `clearPendingImages()`，图片路径通过 `attachments` 传给后端；`/api/plan` 接收 `attachments` 并调 `attachmentPrompt()` 追加到 prompt；goal 为空时自动补默认目标。
- **教训**: 新增能力（图片）后必须扫描所有调用路径，去掉已过期的主动拦截；否则"这个功能不支持"就变成了自我实现的谎言。
- **标签**: `ux`, `plan`, `image`, `lesson:新增能力后要清理过期拦截`
