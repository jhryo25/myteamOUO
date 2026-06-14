# myteamOUO

myteamOUO 是一个轻量级本地 A2A（Agent-to-Agent）协作工具 MVP。

它用本地 CLI agent（Kimi / Claude / Codex）完成多轮对话、任务拆解、任务执行、人工 Gate、踩坑记录和轻量 Hub 可视化。项目参考了 [clowder-ai](https://github.com/zts212653/clowder-ai) 与 [cat-cafe-tutorials](https://github.com/zts212653/cat-cafe-tutorials) 的多 agent 协作思路，但保持无 npm 运行依赖、文件优先、本地优先。

GitHub: https://github.com/jhryo25/myteamOUO

---

## 快速启动

```powershell
# 1. 复制本地配置模板
cp .env.example .env

# 2. 在 .env 中填写本机 CLI 路径
# KIMI_PATH=C:\Users\Administrator\.kimi-code\bin\kimi.exe
# CLAUDE_PATH=C:\path\to\claude.cmd
# CODEX_PATH=C:\path\to\codex.cmd

# 3. 启动服务
node server.mjs

# 4. 打开控制台
# http://localhost:7878
```

也可以使用 Python 包装入口：

```powershell
python myteam.py serve
```

---

## Agent 阵容

| Agent | 适合任务 |
| --- | --- |
| Kimi | 轻量执行、快速草稿、小任务处理 |
| Claude | 深度分析、架构设计、复杂生成 |
| Codex | 拆任务、代码执行、审查与迭代 |

Agent 路径写在本机 `.env`，不会提交到 GitHub。控制台右上角齿轮可以查看、检测和修改路径；后端会做启动级检测，不只检查文件是否存在。

---

## 主要功能

### 对话模式

- 支持多轮上下文对话。
- 支持行首 `@claude` / `@codex` / `@kimi` 指定 agent。
- agent 不可用时会自动提示并在顶部状态条显示降级状态。
- 消息气泡支持复制、删除和完成时间显示。
- agent 运行中可继续输入，消息会排队，当前回复完成后自动发送下一条。
- 历史消息按页加载，聊天区顶部可点击“加载更早记录”。

### 拆任务模式

- 切换到“拆任务”，输入目标后由选定 agent 生成结构化任务列表。
- 每条任务包含标题、步骤、验收标准和推荐执行 agent。
- plan card 底部提供按 agent 执行和手动选择两种入口。
- 拆任务结果写入 `.myteam/tasks.jsonl`。

### 任务执行

- 右侧任务面板按 `run_id` 分组，显示进度条和状态点。
- 支持 pending / in_progress / done / failed 状态筛选和关键词搜索。
- 支持单条任务重跑和删除。
- dispatch 过程中顶部 agent pill 会高亮当前执行 agent。
- 执行中断或失败后，聊天区会出现“继续执行剩余任务”入口。

### Hub 指挥中心

顶部 `Hub` 抽屉集中展示系统状态：

- 总览：agent、任务、Gate 和下一步路线。
- Agent：本地 CLI 启动级检测结果。
- Skills：`.myteam/skills.yaml` 技能清单和按需加载预览。
- Lessons：`.myteam/lessons.jsonl` 踩坑记录，可跳转到相关任务。
- 调用：`.myteam/invocations.jsonl` 轻量调用统计。
- Gate：人工 Reviewer Gate，可通过已完成任务或要求返工。
- 任务：最近任务和状态统计。

### Session 管理

- 左侧 sidebar 支持多个对话 session。
- 支持新建、切换、重命名和删除。
- 删除后会进入本地回收站，短时间内可恢复。
- 每个 session 的历史独立保存到 `.myteam/memory.json`。

---

## 文件结构

```text
myteamOUO/
├── .env.example          # 本地 CLI 路径模板
├── myteam.py             # Python 统一入口
├── agent-utils.mjs       # 公共 agent 调用、任务读写、prompt 工具
├── plan.mjs              # CLI 拆任务入口
├── dispatch.mjs          # CLI 执行任务入口
├── server.mjs            # Node HTTP server，REST + SSE，默认端口 7878
├── web/
│   ├── app.html          # 控制台 HTML
│   ├── app.css           # 控制台样式
│   └── app.js            # 控制台交互逻辑
├── docs/
│   ├── architecture-evaluation.md
│   └── clowder-html-gap.md
├── .myteam/
│   ├── agents.yaml       # agent 角色配置
│   ├── skills.yaml       # MVP 技能清单
│   ├── tasks.jsonl       # 运行时任务数据，不入库
│   ├── lessons.jsonl     # 运行时踩坑记录，不入库
│   ├── invocations.jsonl # 运行时调用记录，不入库
│   └── memory.json       # 运行时 session 历史，不入库
├── HANDOVER.md           # AI 冷启动交接文档
└── ISSUES.md             # 问题、解法和教训记录
```

---

## API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 控制台页面 |
| GET | `/api/status` | agent 配置和可启动状态 |
| GET | `/api/agents` | agent 路径配置 |
| POST | `/api/agents` | 保存 agent 路径到 `.env` |
| GET | `/api/sessions` | session 列表 |
| POST | `/api/sessions` | 新建或切换 session |
| POST | `/api/sessions/:id/rename` | 重命名 session |
| DELETE | `/api/sessions/:id` | 删除 session 到回收站 |
| GET | `/api/sessions/trash` | 查看回收站 |
| POST | `/api/sessions/restore` | 恢复 session |
| GET | `/api/history?limit=&before=` | 当前 session 历史分页 |
| POST | `/api/chat` | SSE 对话流 |
| POST | `/api/plan` | SSE 拆任务流 |
| POST | `/api/dispatch` | SSE 执行 pending 任务 |
| POST | `/api/abort` | 中断正在运行的 agent 子进程 |
| GET | `/api/tasks` | 任务列表 |
| POST | `/api/tasks/:id/rerun` | 重跑单条任务 |
| DELETE | `/api/tasks/:id` | 删除单条任务 |
| POST | `/api/tasks/:id/gate` | 人工 Reviewer Gate |
| GET | `/api/skills` | Skills 清单和按需命中结果 |
| GET | `/api/invocations` | 调用记录和轻量统计 |
| GET | `/api/lessons` | 踩坑记录 |

---

## 本地运行数据

以下文件是运行时数据，默认被 `.gitignore` 排除：

- `.env`
- `.myteam/tasks.jsonl`
- `.myteam/lessons.jsonl`
- `.myteam/invocations.jsonl`
- `.myteam/memory.json`
- `.myteam/runs/`

提交代码前请不要把本地对话、任务结果或 CLI 路径提交到仓库。

---

## 新对话冷启动提示

```text
项目：myteamOUO（本地 A2A 协作工具 MVP）
GitHub: https://github.com/jhryo25/myteamOUO

请先读取 HANDOVER.md 了解当前进度，再读取 ISSUES.md 确认已知问题和经验，然后继续下一步工作。
```
