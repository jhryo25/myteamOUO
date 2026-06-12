# myteamOUO 交接文档

> 用于新对话冷启动。AI 读完此文件即可接续工作，无需重新理解历史。
> 
> **最后更新**: 2026-06-12（IMP-006 代码拆分完成后）

---

## 项目定位

myteamOUO 是一个轻量级本地 A2A（Agent-to-Agent）协作工具 MVP。
参考 [cat-cafe-tutorials](https://github.com/zts212653/cat-cafe-tutorials) 和 [clowder-ai](https://github.com/zts212653/clowder-ai) 的架构思路，用本地两个 CLI（Claude + Codex）实现多轮对话、任务拆解、任务执行的最小可行闭环。

**GitHub**: https://github.com/jhryo25/myteamOUO  
**本地路径**: `F:\py project\myteamOUO`  
**启动方式**: `cd "F:\py project\myteamOUO" && node server.mjs`  
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
├── .myteam/
│   ├── agents.yaml       # agent 角色配置（入库，无敏感信息）
│   ├── tasks.jsonl       # 运行时任务数据（不入库）
│   ├── lessons.jsonl     # 踩坑记录（不入库）
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
| codex  | `C:\Users\N30303\AppData\Roaming\npm\codex.cmd`    | 总控 / 审查 / 自迭代，plan 默认 agent |
| claude | `C:\Users\N30303\AppData\Roaming\npm\claude.cmd`   | 主架构 / 深度实现 |
| kimi   | 未配置（代理问题无法安装 KimiCode CLI）              | 轻量执行（预留） |

路径写在本机 `.env`，在界面右上角 ⚙ 可视化修改，无需重启服务器。

---

## CLI 调用方案（关键实现细节）

```
codex exec - --json --skip-git-repo-check  # stdin pipe 传 prompt
claude -p - --output-format stream-json --verbose
```

**Windows .cmd 文件必须用 `cmd.exe /c xxx.cmd args` 调用**，不能直接 spawn，也不能用 `shell:true`（会把 prompt 拆散）。

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
- **💬 对话模式**：走 `/api/chat`，多轮上下文，行首 `@claude` / `@codex` 路由
- **📋 拆任务模式**：走 `/api/plan`，SSE 实时流，拆完显示结构化任务卡片
- **▶ 执行 pending 任务**：走 `/api/dispatch`，每条任务实时流输出，支持 ■ 中断
- **⚙ Agent 管理抽屉**：可视化查看/修改 CLI 路径，一键检测 + 保存
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

### ✅ 已完成改进（IMP-001~006）

1. **@mention 改行首匹配**：防止代码/引用中误触发路由
2. **A2A 链式加乒乓球熔断**：检测 A→B→A→B 交替模式，自动熔断
3. **chain task 携带上游分析摘要**：注入前 300 字符到 steps
4. **代码去重**：共享逻辑抽到 `agent-utils.mjs`
5. **extractJson 贪心匹配修复**：改用括号配对算法
6. **web/app.html 拆分**：CSS + JS + HTML 三文件分离

### 🟡 下一步（可选）

- **Kimi 接入**：KimiCode CLI 需手动安装
- **P2 优化**：lessons UI、agent pill 执行高亮、session 重命名、历史分页
- **消息写入与执行解耦**：参考 clowder-ai ADR-008，POST 立即返回 → WebSocket 推流
- **InvocationRecord 状态机**：每次 chat/plan/dispatch 创建 invocation record
- **Skills 按需加载机制**：参考 clowder-ai 50+ skills 目录结构

---

## 新对话冷启动 Prompt 建议

```
项目：myteamOUO（本地 A2A 协作工具 MVP）
GitHub: https://github.com/jhryo25/myteamOUO
本地路径: F:\py project\myteamOUO
交接文档: 见 HANDOVER.md
问题追踪: 见 ISSUES.md

请先读取 HANDOVER.md 了解当前进度，然后继续下一步工作。
```
