# myteamOUO

myteamOUO 是一个本地优先、低成本、轻量化的 A2A（Agent-to-Agent）协作工具 MVP。

它的目标不是做一个复杂平台，而是帮你用最小成本搭出一个“能协作、能拆任务、能执行、能审查、能沉淀经验、能逐步自迭代”的本地 agent 工作台。

GitHub: https://github.com/jhryo25/myteamOUO

## 它可以解决什么问题

myteamOUO 适合解决这些问题：

- 你想让多个 agent 分工协作，但不想一开始就上数据库、云服务或复杂框架。
- 你希望一个总控 agent 把目标拆成小任务，再交给不同 worker 执行。
- 你希望任务完成后有人审查，而不是 agent 说“完成了”就直接相信。
- 你希望每次踩坑都能被记录下来，后续开发可以检索复用。
- 你希望先从 MVP 做起，以后再扩展到 RAG、Reviewer Agent、LangChain 或 LangGraph。
- 你希望用本机已有 CLI，比如 Kimi、Claude、Codex，尽量降低成本。
- 你希望和 agent 对话时能看到运行状态，减少“它是不是卡住了”的焦虑。

一句话：myteamOUO 是一个给新手和小团队使用的本地 agent 协作中控台。

## 当前能力

### 1. 多 agent 对话

- 支持多轮聊天。
- 支持多个 session。
- 新建 session 不需要先命名，系统会根据第一条问题自动生成标题。
- 支持 `@agent` 路由和按名字补全。
- agent 运行时显示“启动 / 思考 / 输出”状态。
- 支持图片附件，聊天栏会显示缩略图。

### 2. 任务拆解

- 切换到“拆任务”模式后，输入目标即可生成结构化任务。
- 每条任务包含标题、步骤、验收标准和建议执行 agent。
- 任务写入 `.myteam/tasks.jsonl`，方便后续执行和审查。

### 3. 任务执行

- 可以执行 pending 任务。
- 支持按 agent 执行建议。
- 支持中断、继续、单条重跑和删除。
- 任务面板按 run 分组，能看到进度和状态。

### 4. 人工 Reviewer Gate

- 已完成任务不会只靠 agent 自己宣布成功。
- Hub 里有 Gate 面板，可以人工通过或要求返工。
- 返工任务会重新进入 pending，并带上返工说明。

### 5. 经验沉淀

- 失败任务会写入 `.myteam/lessons.jsonl`。
- 项目问题会沉淀到 `ISSUES.md`。
- 课程化问题文档在 `docs/problem-course.md`，适合后续检索。

### 6. Skills 按需加载

- `.myteam/skills.yaml` 保存技能清单。
- `/api/skills?text=&agent=&phase=` 会按任务文本、agent 和阶段命中相关技能。
- plan/dispatch 只注入命中的技能摘要，避免 prompt 过长。

### 7. Hub 指挥中心

顶部 `Hub` 抽屉集中展示当前系统状态：

- 总览：agent、任务、Gate、调用状态。
- Agent：本地 CLI 是否可启动。
- Skills：技能清单和按需命中预览。
- Lessons：踩坑记录。
- 调用：agent 调用次数、成功失败和耗时。
- Gate：人工审查入口。
- 任务：最近任务和状态统计。

Hub 只放用户可操作信息；clowder-ai 对比、LangChain / LangGraph / RAG 评估放在 docs 中。

### 8. 动态 agent 配置

- 默认支持 Codex、Claude、Kimi。
- 可以在设置抽屉里新增或删除 agent。
- 可以修改工作区路径。
- 本地动态配置写入 `.myteam/agents.json` 和 `.myteam/settings.json`，不会提交到 GitHub。

### 9. 图片附件

- 可以给 agent 发送图片。
- 前端显示图片缩略图。
- 后端保存到 `.myteam/uploads/`，并把本地图片路径交给 agent。
- 单张图片限制 8MB，一次最多 5 张。

注意：agent 是否能真正“看懂图片”，取决于具体 CLI 是否支持读取图片路径或多模态能力。如果不支持，系统会要求 agent 明确说明限制。

## 快速启动

```powershell
cd D:\myteam
node server.mjs
```

然后打开：

```text
http://localhost:7878/
```

也可以用 Python 包装入口：

```powershell
python myteam.py serve
```

## 本地配置

复制配置模板：

```powershell
cp .env.example .env
```

在 `.env` 中配置本机 CLI 路径：

```text
KIMI_PATH=C:\Users\Administrator\.kimi-code\bin\kimi.exe
CLAUDE_PATH=C:\path\to\claude.cmd
CODEX_PATH=C:\path\to\codex.cmd
```

也可以在网页右上角设置抽屉里配置 agent。

## 推荐使用流程

1. 打开 `http://localhost:7878/`。
2. 在对话模式里直接提问。
3. 如果要做一个目标，切换到“拆任务”。
4. 让 Controller Agent 生成任务列表。
5. 执行 pending 任务。
6. 在 Hub Gate 中审查结果。
7. 通过就沉淀，失败就返工。
8. 遇到问题后，把经验写入 `docs/problem-course.md` 或 `ISSUES.md`。

## 文件结构

```text
myteamOUO/
├── README.md                    # 项目首页
├── HANDOVER.md                  # 交接文档，新对话先读它
├── ISSUES.md                    # 原始问题追踪
├── docs/
│   ├── problem-course.md        # 课程化问题文档
│   ├── clowder-html-gap.md      # clowder-ai 交互差距
│   └── architecture-evaluation.md
├── myteam.py                    # Python 统一入口
├── server.mjs                   # Node HTTP server，REST + SSE
├── agent-utils.mjs              # agent 配置、调用、任务工具
├── plan.mjs                     # CLI 拆任务入口
├── dispatch.mjs                 # CLI 执行入口
├── web/
│   ├── app.html                 # 控制台 HTML
│   ├── app.css                  # 控制台样式
│   └── app.js                   # 控制台交互逻辑
└── .myteam/
    ├── agents.yaml              # 默认角色说明，入库
    ├── skills.yaml              # 技能清单，入库
    ├── agents.json              # 本地动态 agent 配置，不入库
    ├── settings.json            # 本地工作区配置，不入库
    ├── uploads/                 # 图片附件，不入库
    ├── tasks.jsonl              # 运行时任务，不入库
    ├── lessons.jsonl            # 运行时经验，不入库
    ├── invocations.jsonl        # agent 调用记录，不入库
    ├── memory.json              # session 历史，不入库
    └── runs/                    # 运行备份和日志，不入库
```

## API 概览

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| GET | `/` | 控制台页面 |
| GET | `/api/status` | agent 状态和工作区 |
| GET | `/api/settings` | 本地工作区配置 |
| POST | `/api/settings` | 保存工作区 |
| GET | `/api/agents` | agent 配置和状态 |
| POST | `/api/agents` | 保存动态 agent 列表 |
| POST | `/api/uploads` | 上传图片 |
| GET | `/uploads/:file` | 读取图片缩略图 |
| GET | `/api/sessions` | session 列表 |
| POST | `/api/sessions` | 新建或切换 session |
| POST | `/api/sessions/:id/rename` | 重命名 session |
| DELETE | `/api/sessions/:id` | 删除 session 到回收站 |
| GET | `/api/history?limit=&before=` | 当前 session 历史分页 |
| POST | `/api/chat` | SSE 对话流 |
| POST | `/api/plan` | SSE 拆任务流 |
| POST | `/api/dispatch` | SSE 执行任务 |
| POST | `/api/abort` | 中断 agent 子进程 |
| GET | `/api/tasks` | 任务列表 |
| POST | `/api/tasks/:id/rerun` | 重跑任务 |
| DELETE | `/api/tasks/:id` | 删除任务 |
| POST | `/api/tasks/:id/gate` | 人工 Reviewer Gate |
| GET | `/api/skills` | Skills 清单和命中结果 |
| GET | `/api/invocations` | 调用记录 |
| GET | `/api/lessons` | 踩坑记录 |

## 文档入口

- `HANDOVER.md`：交接文档，新的 agent 接手前先读。
- `docs/problem-course.md`：课程化问题文档，按标签检索坑点和解法。
- `ISSUES.md`：原始问题追踪记录。
- `docs/clowder-html-gap.md`：与 clowder-ai 的差距对比。
- `docs/architecture-evaluation.md`：LangChain / LangGraph / RAG 接入评估。

## 本地运行数据

以下文件默认不提交到 GitHub：

- `.env`
- `.myteam/agents.json`
- `.myteam/settings.json`
- `.myteam/uploads/`
- `.myteam/tasks.jsonl`
- `.myteam/lessons.jsonl`
- `.myteam/invocations.jsonl`
- `.myteam/memory.json`
- `.myteam/runs/`
- `reports/`

## 当前路线

短期：

1. 本地 RAG MVP：检索文档、任务、经验，再注入 agent prompt。
2. Reviewer Agent 自动审查：先给 Gate 建议，不直接自动通过。
3. Backlog 视图：把失败、返工、下一轮任务集中管理。

中期：

1. 抽出 provider 层，同时支持本地 CLI 和 LangChain。
2. 抽出 workflow 层，为 LangGraph 做准备。
3. 为支持视觉能力的 agent 做图片 adapter。

长期：

1. LangGraph 管自迭代状态机。
2. LangChain 管模型和工具接口。
3. RAG 管项目记忆和证据检索。

## 新对话冷启动提示

```text
项目：myteamOUO，本地 A2A 协作工具 MVP。
GitHub: https://github.com/jhryo25/myteamOUO
本地路径: D:\myteam

请先读取 HANDOVER.md，再读取 docs/problem-course.md 和 ISSUES.md。
用户编程经验不多，说明要简单，代码注释用中文。
不要提交 .env、.myteam 运行时数据或 reports/。
继续工作前先检查 git status。
```
