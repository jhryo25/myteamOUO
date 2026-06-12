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

## 对比 clowder-ai 发现的改进方向（待实施）

### IMP-001: @mention 改行首匹配 [ux]

- **参考**: clowder-ai `@catname` 只在新行开头触发路由，inline 提及不触发
- **现状**: myteamOUO 任意位置 `@mention` 都触发
- **风险**: 代码/引用中 `@claude` 会误触发路由

### IMP-002: A2A 链式加 streak 熔断 [arch]

- **参考**: clowder-ai WorklistRegistry + streak 追踪 + 乒乓球熔断（F167）
- **现状**: depth ≤ 3 但无 streak 检测，两个 agent 互 @ 会跑满 3 轮
- **建议**: 连续同内容/同 agent 互 @ 超过 2 次自动熔断

### IMP-003: chain task 携带上游分析摘要 [ux]

- **参考**: clowder-ai 五件套交接（What/Why/Tradeoff/Open/Next）
- **现状**: A2A chain task 只传 title + goal，上游分析全丢
- **建议**: chain task 的 steps 中注入上游 agent 的回复摘要

### IMP-004: 代码去重 + 拆分 [quality]

- **现状**: `PLAN_PROMPT` / `buildExecPrompt` / `readTasks` 在 server.mjs 和 plan.mjs/dispatch.mjs 中重复
- **建议**: 抽到 `agent-utils.mjs` 导出；`web/app.html` 拆为 CSS + JS + HTML

### IMP-005: extractJson 贪心匹配 [quality]

- **位置**: `agent-utils.mjs:126`
- **现状**: `\{[\s\S]+\}` 贪心匹配，多 JSON 对象时匹配超集
- **建议**: 改非贪心或逐步 parse
