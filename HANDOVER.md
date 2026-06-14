# myteamOUO 交接文档

> 用于新对话冷启动。AI 读完此文件即可接续工作，无需重新理解历史。
> 
> **最后更新**: 2026-06-14（轻量 Hub + Skills + 调用观测 + 人工 Gate）

---

## 项目定位

myteamOUO 是一个轻量级本地 A2A（Agent-to-Agent）协作工具 MVP。
参考 [cat-cafe-tutorials](https://github.com/zts212653/cat-cafe-tutorials) 和 [clowder-ai](https://github.com/zts212653/clowder-ai) 的架构思路，用本地 CLI（Kimi + Claude + Codex）实现多轮对话、任务拆解、任务执行的最小可行闭环。

**GitHub**: https://github.com/jhryo25/myteamOUO  
**本地路径**: `D:\myteam`  
**启动方式**: `cd "D:\myteam" && node server.mjs`  
**访问地址**: http://localhost:7878

---

## 文件结构

```
myteamOUO/
├── .env                  # 本地 CLI 路径（不入库，从 .env.example 复制）
├── .env.example          # 路径模板
├── .gitignore            # 排除 .env / .myteam/ 运行时数据 / memory.json 等
├── myteam.py             # Python 统一 CLI 入口（init/status/ui/plan/dispatch/serve）
├── agent-utils.mjs       # 公共模块：loadEnv / buildCliConfig / invokeAgent / extractJson
│                         #   / validatePlanResult / readTasks / writeAllTasks / appendTask
│                         #   / patchTask / PLAN_PROMPT / buildExecPrompt
├── plan.mjs              # 调 Codex/Claude 拆任务 → .myteam/tasks.jsonl
├── dispatch.mjs          # 读 pending 任务 → 按 agent 分发执行 → 写回结果
├── server.mjs            # Node HTTP server：REST + SSE + 静态文件，端口 7878
├── web/
│   ├── app.html          # 交互控制台 HTML 结构（135 行）
│   ├── app.css           # 全部样式（1135 行）
│   └── app.js            # 全部前端逻辑（1087 行）
├── package.json          # type=module，无 npm 依赖
├── index.html            # 旧静态验收页（保留，myteam.py ui 生成）
├── ISSUES.md             # 问题/解法/教训统一管理（与 git commit 对应）
├── docs/
│   └── clowder-html-gap.md # clowder-ai 与 myteam HTML/交互差距记录
├── .myteam/
│   ├── agents.yaml       # agent 角色配置（入库，无敏感信息）
│   ├── skills.yaml       # MVP 技能清单（入库，无敏感信息）
│   ├── tasks.jsonl       # 运行时任务数据（不入库）
│   ├── lessons.jsonl     # 踩坑记录（不入库）
│   ├── invocations.jsonl # agent 调用记录（不入库）
│   ├── memory.json       # 对话历史 + session + 回收站（不入库）
│   └── runs/             # dispatch 前自动备份快照（不入库）
└── HANDOVER.md           # 本文件
```

---

## 核心 API（server.mjs）

| 方法 | 路由 | 说明 |
|------|------|------|
| GET  | `/` | 返回 web/app.html |
| GET  | `/app.css` | 返回 web/app.css（静态资源） |
| GET  | `/app.js` | 返回 web/app.js（静态资源） |
| GET  | `/api/status` | agent 配置 + 可用状态 |
| GET  | `/api/agents` | 返回原始路径配置（含 available） |
| POST | `/api/agents` | 修改路径写回 .env，实时重载 CLI_CONFIG |
| GET  | `/api/tasks` | 返回 tasks.jsonl 全部记录 |
| GET  | `/api/skills` | 返回 `.myteam/skills.yaml` 静态技能清单 |
| GET  | `/api/invocations` | 返回 `.myteam/invocations.jsonl` 调用记录和汇总 |
| POST | `/api/tasks/:id/gate` | 人工 Reviewer Gate：通过任务或要求返工 |
| DELETE | `/api/tasks/:id` | 删除单个任务 |
| POST | `/api/tasks/:id/rerun` | 重新执行单个任务（重置状态为 pending） |
| GET  | `/api/history` | 返回内存对话历史 |
| POST | `/api/chat` | 多轮对话（SSE），支持 @mention 路由 |
| POST | `/api/plan` | 拆任务（SSE），结果追加到 tasks.jsonl |
| POST | `/api/dispatch` | 执行 pending 任务（SSE），结果写回 tasks.jsonl |
| POST | `/api/abort` | 中断所有正在执行的 agent 子进程 |
| GET  | `/api/sessions` | 返回所有 session 列表 |
| POST | `/api/sessions` | 创建新 session / 切换激活 session |
| DELETE | `/api/sessions/:id` | 删除 session（移入回收站，持久化） |
| GET  | `/api/sessions/trash` | 查看回收站中的 session |
| POST | `/api/sessions/restore` | 从回收站恢复 session |
| GET  | `/api/lessons` | 返回踩坑记录 |

---

## 当前 Agent 配置

| Key    | CLI 路径（本机）                                    | 角色 |
|--------|-----------------------------------------------------|------|
| codex  | `CODEX_PATH`（本机 `.env`） | 总控 / 审查 / 自迭代；当前 WindowsApps 路径存在但不可被 Node spawn |
| claude | `CLAUDE_PATH`（本机 `.env`） | 主架构 / 深度实现 |
| kimi   | `KIMI_PATH`（本机 `.env`，当前为 `C:\Users\Administrator\.kimi-code\bin\kimi.exe`） | 轻量执行 / 快速草稿 |

路径写在本机 `.env`，在界面右上角 ⚙ 可视化修改，无需重启服务器。当前代码支持 `codex` / `claude` / `kimi` 三个 key。前端拆任务只展示真正可启动的 agent；当前本机 Kimi 可用，所以拆任务默认走 Kimi。

---

## CLI 调用方案（关键实现细节）

```
codex exec - --json --skip-git-repo-check  # stdin pipe 传 prompt
claude -p - --output-format stream-json --verbose
kimi -p "<prompt>" --output-format text
```

**Windows .cmd 文件必须用 `cmd.exe /c xxx.cmd args` 调用**，不能直接 spawn，也不能用 `shell:true`（会把 prompt 拆散）。

**WindowsApps 里的 Codex `codex.exe` 是一个坑点**：`existsSync(path)` 会返回 true，但 Node `spawn()` 会报 `EPERM`。不要只用“文件存在”判断 agent 可用；必须用 `checkAgentLaunchable()` 做启动级检测。

NDJSON 解析：
- Codex: `event.type === 'item.completed' && event.item.text`
- Claude: `event.type === 'assistant'` → `event.message.content[].text`

---

## 已落地的教训

### 来自 cat-cafe 第二课

| 教训 | 位置 | 实现 |
|------|------|------|
| readline 接管 stdout 后 `child.stdout.on('data')` 不触发 | `agent-utils.mjs` `invokeAgent` | watchdog 改在 `rl.on('line')` + `stderr.on('data')` 里刷新 |
| 超时 5min 不够 | `agent-utils.mjs` `invokeAgent` | 默认改 30min |
| AI 幻觉输出需二次验证 | `agent-utils.mjs` `validatePlanResult` | tasks 非空 + 每条必含 title |
| dispatch 前数据要备份 | `server.mjs` `backupTasks()` | dispatch 前写快照到 `.myteam/runs/` |
| EADDRINUSE 崩溃 | `server.mjs` `server.on('error')` | 优雅报错 + 释放命令提示 |

### 本次 Review 新增（2026-06-12，详见 ISSUES.md）

| 教训 | 来源 | 说明 |
|------|------|------|
| 全局变量管理 UI 状态是单页应用大坑 | ISS-001 | DOM 元素动态创建/销毁，不要用模块级 `const` 缓存引用 |
| 前后端 prompt 清理逻辑必须一致 | ISS-002 | 路由解析和消息清理用同一套正则 |
| abort 场景需要全链路处理 | ISS-003 | 前端 abort → SSE 断开 → 后端 kill → close event 都要感知 |
| 流式渲染和批量渲染不能混用全局状态 | ISS-004 | 历史加载走独立"直接渲染"路径 |
| .gitignore 要覆盖所有运行时文件 | ISS-005 | 新增持久化文件必须同步更新 |
| 数据持久化要完整 | ISS-006 | 回收站等临时状态也要持久化 |
| 路由触发要严格 | IMP-001 | @mention 改行首匹配，防误触发 |
| A2A 链式需要防循环 | IMP-002 | depth 限制 + 乒乓球交替模式检测 |
| 多 agent 协作要传递上下文 | IMP-003 | chain task 携带上游分析摘要 |
| DRY 原则 | IMP-004 | 共享逻辑抽到 agent-utils.mjs |
| 嵌套结构用状态机而非正则 | IMP-005 | extractJson 改用括号配对算法 |
| 关注点分离 | IMP-006 | HTML/CSS/JS 拆分为独立文件 |

---

## 当前 UI 功能（web/app.html + app.css + app.js）

- **三栏布局**：左侧 Session Sidebar (240px，可折叠 48px) | 中间聊天区 | 右侧任务面板 (56px 默认，展开 340px)
- **暖色聊天对话框**：米白底 + 橙棕 accent，用户气泡右/agent 气泡左，agent 回复支持 Rich Blocks 富文本渲染
- **💬 对话模式**：走 `/api/chat`，多轮上下文，行首 `@claude` / `@codex` / `@kimi` 路由
- **📋 拆任务模式**：走 `/api/plan`，SSE 实时流，拆完显示结构化任务卡片
- **▶ 执行 pending 任务**：走 `/api/dispatch`，每条任务实时流输出，支持 ■ 中断
- **⚙ Agent 管理抽屉**：可视化查看/修改 CLI 路径，一键检测 + 保存
- **Hub 指挥抽屉**：顶部 `Hub` 按钮打开轻量指挥中心，包含总览、Agent、Skills、调用、Gate、任务、对比七个 tab
- **左侧 Session Sidebar**：每行显示名称/时间/消息数 + hover 删除；底部「＋ 新建对话」；删除有 5 秒撤销 toast + 回收站持久化
- **右侧任务面板**：窄条展开；有搜索框 + 状态 chips；任务按 run 分组可折叠，新 run 在前，pending 数量徽标
- **A2A 链式执行**：agent 回复中 @mention 自动触发链式任务，乒乓球熔断保护

---

## 已知问题 / 待对齐清单

### ✅ 已修复（共 22 项）

**原始 16 项：**
1. **:has() 兼容**：`btn.closest('.agent-card').querySelector('.agent-status-badge')`
2. **A2A Worklist 链**：`parseA2AMentions()` 行首匹配，depth ≤ 3，自动创建链式任务
3. **对话历史持久化**：写 `.myteam/memory.json`，重启自动加载最近 40 条
4. **plan 结构化渲染**：拆完任务展示结构化卡片（标题 + agent + 验收标准）
5. **dispatch 摘要气泡**：✓/✗ 状态卡片 + 结果摘要前 200 字
6. **lessons.jsonl 自动写入**：失败任务自动记录；`GET /api/lessons` 查询
7. **Rich Blocks**：`:::card` / `:::checklist` / `:::role` + 代码块复制 + inline/heading/list
8. **Session 隔离**：每 session 独立 `history`；`/api/chat` 和 `/api/history` 支持 `sessionId`；旧 memory.json 自动迁移
9. **流式中断**：■ 停止按钮 + `AbortController` + 后端 `POST /api/abort` kill 子进程
10. **Session 新建表单**：行内 UI 替代 `prompt()`，Enter 确认 Escape 取消
11. **Session 回收站**：删除移入 `trashedSessions`（5 分钟），前端撤销 toast
12. **按钮状态修复**：切换 session 后 `loadTasks()`；dispatch 用 `try/finally`
13. **任务过滤搜索**：搜索框 + 状态 chips 实时过滤
14. **单条重跑/删除**：`POST /api/tasks/:id/rerun`、`DELETE /api/tasks/:id`
15. **中文输入法保护**：`e.isComposing || e.keyCode === 229` 阻止误发
16. **三栏布局重构**：sidebar 左侧栏 + tasks 右侧窄条；topbar 简化；run 分组折叠倒序

**本次 Review 新增 6 项（ISS-001~006）：**
17. **welcome 元素引用失效**：`hideWelcome()` 改为动态 `getElementById` 查找
18. **cleanMessage 只清行首 @mention**：改为行首匹配，与 `parseAtMention` 一致
19. **abort 场景 unhandled rejection**：加 `isAborting` 标志位，abort 场景走 resolve
20. **loadHistory 连续 assistant 消息截断**：历史加载直接渲染，不走 typing 流程
21. **.gitignore 遗漏 memory.json**：已添加
22. **trashedSessions 不持久化**：写入 memory.json，重启后回收站保留

### ✅ 已完成改进（IMP-001~009）

1. **@mention 改行首匹配**：防止代码/引用中误触发路由
2. **A2A 链式加乒乓球熔断**：检测 A→B→A→B 交替模式，自动熔断
3. **chain task 携带上游分析摘要**：注入前 300 字符到 steps
4. **代码去重**：共享逻辑抽到 `agent-utils.mjs`
5. **extractJson 贪心匹配修复**：改用括号配对算法
6. **web/app.html 拆分**：CSS + JS + HTML 三文件分离
7. **"任务"竖排字倒置修复**：`writing-mode: vertical-rl + rotate(180deg)` → `vertical-lr`（IMP-007）
8. **pending 按钮改隐藏逻辑**：无 pending 任务时隐藏而非 disabled（IMP-008）
9. **plan 完成后执行建议**：plan card 底部增加按 agent 分组的建议按钮 + 手动选择（IMP-008）
10. **Session sidebar popover 菜单**：`···` 按钮展开 rename/delete，inline 重命名，`POST /api/sessions/:id/rename`（IMP-009）
11. **任务 run 进度条**：任务面板每个 run-group 显示 done/total 进度条，失败时红色（IMP-009）
12. **中断-继续提示**：dispatch abort 或有 failed 时，聊天区出现高亮"继续执行剩余任务"按钮（IMP-009）
13. **消息 hover 操作栏**：气泡 hover 时浮出复制/删除按钮，参考 clowder-ai MessageActions（IMP-010）
14. **发送按钮状态机**：运行中变蓝色"排队"模式（⏎），消息入队，完成后自动消费；无文字时 disabled（IMP-010）
15. **消息时间戳**：用户气泡显示发送时间，agent 气泡显示完成时间（IMP-010）
16. **连接状态条**：server 离线/agent 不可用时，topbar 下方出现颜色状态条（IMP-010）
17. **Kimi 接入**：贯通配置、状态 API、Agent 抽屉、@mention 路由和任务执行链（IMP-011）
18. **Codex spawn EPERM 检测**：启动级检测替代 `existsSync`，避免不可执行路径进入拆任务选项（ISS-009）
19. **轻量 Hub 指挥中心**：对齐 clowder-ai Hub 思路，集中展示状态、任务和 HTML/交互差距（IMP-012）
20. **静态 Skills 看板**：`.myteam/skills.yaml` + `/api/skills` + Hub Skills tab 展示技能挂载关系（IMP-013）
21. **轻量调用/成本可见性**：`.myteam/invocations.jsonl` + `/api/invocations` + Hub 调用 tab 展示调用次数、成功失败和平均耗时（IMP-014）
22. **人工 Reviewer Gate**：Hub Gate tab + `POST /api/tasks/:id/gate`，可通过已完成任务或要求返工；返工任务重新进入 pending（IMP-015）

### 🟡 下一步（可选）

- **Kimi 输出质量**：Kimi 已接入；下一步可针对拆任务 JSON 稳定性微调 prompt
- **P2 优化**：lessons UI、agent pill 执行高亮、历史分页
- **Reviewer Agent 自动审**：当前已有人工 Gate；下一步让 reviewer agent 按验收标准自动给 Gate 建议
- **Skills 按需加载**：当前已有静态看板；下一步根据任务类型把对应 skill 注入 agent prompt
- **消息写入与执行解耦**：参考 clowder-ai ADR-008，POST 立即返回 → WebSocket 推流
- **真实成本统计**：当前已有轻量 invocation record；下一步从 CLI 输出或模型 provider 获取 token/usage，再做额度预警
- **Skills 按需加载机制**：参考 clowder-ai 50+ skills 目录结构
- **Session Draft 持久化**：切换 session 时保留输入框草稿（clowder-ai `threadDrafts` 模式）

---

## 新对话冷启动 Prompt 建议

```
项目：myteamOUO（本地 A2A 协作工具 MVP）
GitHub: https://github.com/jhryo25/myteamOUO
本地路径: D:\myteam
交接文档: 见 HANDOVER.md
问题追踪: 见 ISSUES.md

请先读取 HANDOVER.md 了解当前进度，然后继续下一步工作。
```
