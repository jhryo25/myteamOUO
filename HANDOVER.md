# myteamOUO 交接文档

> 用于新对话冷启动。AI 读完此文件即可接续工作，无需重新理解历史。

---

## 项目定位

myteamOUO 是一个轻量级本地 A2A（Agent-to-Agent）协作工具 MVP。
参考 [cat-cafe-tutorials](https://github.com/zts212653/cat-cafe-tutorials) 和 [clowder-ai](https://github.com/zts212653/clowder-ai) 的架构思路，用本地两个 CLI（Claude + Codex）实现多轮对话、任务拆解、任务执行的最小可行闭环。

**GitHub**: https://github.com/jhryo25/myteamOUO  
**本地路径**: `F:\py project\myteamOUO`  
**启动方式**: `cd "F:\py project\myteamOUO" && py -3 myteam.py serve`  
**访问地址**: http://localhost:7878

---

## 文件结构

```
myteamOUO/
├── .env                  # 本地 CLI 路径（不入库，从 .env.example 复制）
├── .env.example          # 路径模板
├── .gitignore            # 排除 .env / .myteam/runs/ / tasks.jsonl 等
├── myteam.py             # Python 统一 CLI 入口（init/status/ui/plan/dispatch/serve）
├── agent-utils.mjs       # 公共模块：loadEnv / buildCliConfig / invokeAgent / extractJson / validatePlanResult
├── plan.mjs              # 调 Codex/Claude 拆任务 → .myteam/tasks.jsonl
├── dispatch.mjs          # 读 pending 任务 → 按 agent 分发执行 → 写回结果
├── server.mjs            # Node HTTP server：REST + SSE，端口 7878
├── web/app.html          # 交互控制台（暖色聊天 UI）
├── package.json          # type=module，无 npm 依赖
├── index.html            # 旧静态验收页（保留，myteam.py ui 生成）
├── .myteam/
│   ├── agents.yaml       # agent 角色配置（入库，无敏感信息）
│   ├── tasks.jsonl       # 运行时任务数据（不入库）
│   ├── lessons.jsonl     # 踩坑记录（不入库）
│   ├── memory.md         # 长期记忆
│   └── runs/             # dispatch 前自动备份快照（不入库）
└── HANDOVER.md           # 本文件
```

---

## 核心 API（server.mjs）

| 方法 | 路由 | 说明 |
|------|------|------|
| GET  | `/` | 返回 web/app.html |
| GET  | `/api/status` | agent 配置 + 可用状态 |
| GET  | `/api/agents` | 返回原始路径配置（含 available） |
| POST | `/api/agents` | 修改路径写回 .env，实时重载 CLI_CONFIG |
| GET  | `/api/tasks` | 返回 tasks.jsonl 全部记录 |
| GET  | `/api/history` | 返回内存对话历史 |
| POST | `/api/chat` | 多轮对话（SSE），支持 @mention 路由 |
| POST | `/api/plan` | 拆任务（SSE），结果追加到 tasks.jsonl |
| POST | `/api/dispatch` | 执行 pending 任务（SSE），结果写回 tasks.jsonl |

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

## 已落地的教训（来自 cat-cafe 第二课）

| 教训 | 位置 | 实现 |
|------|------|------|
| readline 接管 stdout 后 `child.stdout.on('data')` 不触发 | `agent-utils.mjs` `invokeAgent` | watchdog 改在 `rl.on('line')` + `stderr.on('data')` 里刷新 |
| 超时 5min 不够 | `agent-utils.mjs` `invokeAgent` | 默认改 30min |
| AI 幻觉输出需二次验证 | `agent-utils.mjs` `validatePlanResult` | tasks 非空 + 每条必含 title |
| dispatch 前数据要备份 | `server.mjs` `backupTasks()` | dispatch 前写快照到 `.myteam/runs/` |
| EADDRINUSE 崩溃 | `server.mjs` `server.on('error')` | 优雅报错 + 释放命令提示 |

---

## 当前 UI 功能（web/app.html）

- **暖色聊天对话框**：米白底 + 橙棕 accent，用户气泡右/agent 气泡左
- **💬 对话模式**：走 `/api/chat`，多轮上下文，`@claude` / `@codex` 路由
- **📋 拆任务模式**：走 `/api/plan`，SSE 实时流，结果写 tasks.jsonl
- **▶ 执行 pending 任务**：走 `/api/dispatch`，每条任务实时流输出
- **⚙ Agent 管理抽屉**：可视化查看/修改 CLI 路径，一键检测 + 保存
- **右侧任务面板**：按 run 分组，默认折叠只显示标题+状态点，点击展开详情

---

## 已知问题 / 待对齐清单

### 🔴 必须优先修复

1. **agent 管理抽屉「检测」按钮**：用了 CSS `:has()` 选择器（部分旧浏览器不支持），可能找不到 badge 元素，改用 `closest` 或 `data-` 属性引用。

### 🟡 下一步对齐（参考 clowder-ai）

2. **A2A 自动路由（Worklist 链）**：目前 `/api/dispatch` 是顺序执行，agent 没有能力在回复里 `@` 另一个 agent 触发下一步。需要参考 `clowder-ai` 的 `parseA2AMentions` + worklist 模式实现真正的 A2A 循环。

3. **对话历史持久化**：现在 `chatHistory` 是内存数组，重启服务器清空。需要写入 `.myteam/memory.md` 或 SQLite。

4. **plan 模式的拆任务结果应当在对话区直接渲染**：目前拆完任务只有 raw JSON 流输出，没有结构化展示到对话气泡里（任务列表右侧面板会更新，但主聊天区只显示原始文本）。

5. **dispatch 结果摘要气泡**：执行完成后应在对话区输出「任务 X 执行完毕，结果：…」的结构化气泡，而不是只在日志区显示。

6. **Kimi 接入**：KimiCode CLI 因公司代理无法直接安装，可以尝试手动下载安装包或换其他网络环境。

### 🟢 可选增强

7. **Rich Blocks**：参考 clowder-ai `rich-blocks/` 的卡片/清单/角色卡格式，让 agent 回复支持结构化渲染。
8. **lessons.jsonl 自动写入**：任务失败时自动提取错误原因写入踩坑记录。
9. **session 隔离**：多个目标之间的对话历史相互隔离。

---

## 新对话冷启动 Prompt 建议

```
项目：myteamOUO（本地 A2A 协作工具 MVP）
GitHub: https://github.com/jhryo25/myteamOUO
本地路径: F:\py project\myteamOUO
交接文档: 见 HANDOVER.md

请先读取 HANDOVER.md 了解当前进度，然后继续下一步对齐工作。
当前优先级：修复 agent 管理抽屉 :has() 兼容问题 → 实现 A2A Worklist 路由。
```
