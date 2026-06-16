# myteamOUO

myteamOUO 是一个本地优先、低成本、轻量化的 A2A（Agent-to-Agent）协作工具 MVP。

它的目标不是做一个复杂平台，而是帮你用最小成本搭出一个「能协作、能拆任务、能执行、能审查、能沉淀经验、能逐步自迭代」的本地 agent 工作台。

GitHub: https://github.com/jhryo25/myteamOUO

---

## 它可以解决什么问题

- 你想让多个 agent 分工协作，但不想上数据库、云服务或复杂框架。
- 你希望一个总控 agent 把目标拆成小任务，再交给不同 worker 执行。
- 你希望任务完成后有人审查，而不是 agent 说"完成了"就直接相信。
- 你希望每次踩坑都能被记录下来，后续开发可以检索复用。
- 你希望用本机已有 CLI（Kimi、Claude、Codex），尽量降低成本。
- 你希望 agent 输出的文档/代码能直接在网页里预览，不用到处复制粘贴。

一句话：**myteamOUO 是一个给新手和小团队使用的本地 agent 协作中控台。**

---

## 快速启动

```powershell
cd "F:\py project\myteamOUO"
node server.mjs
```

打开浏览器访问：

```
http://localhost:7878/
```

也可以用 Python 包装入口：

```powershell
python myteam.py serve
```

端口被占用时释放：

```powershell
for /f "tokens=5" %a in ('netstat -aon ^| findstr ":7878"') do taskkill /F /PID %a
```

---

## 本地配置

复制配置模板：

```powershell
copy .env.example .env
```

在 `.env` 中填写本机 CLI 路径：

```ini
KIMI_PATH=C:\Users\你的用户名\.kimi-code\bin\kimi.exe
CLAUDE_PATH=C:\path\to\claude.cmd
CODEX_PATH=C:\path\to\codex.cmd
```

也可以在网页右上角 **⚙ Agent 配置** 弹窗里填写，支持 API Key、Base URL、模型名称。

---

## 当前能力

### 1. 多 agent 对话

- 多轮聊天，多个 session，自动生成标题。
- `@agent` 路由和按名字补全（行首输入 `@` 触发）。
- agent 运行时显示思考 / 输出状态，实时流式展示。
- 支持图片附件（上传或 Ctrl+V 粘贴），聊天栏显示缩略图。
- 历史消息分页加载；失败现场完整保留，刷新后可见。
- 切换 session 时后台任务继续运行，结果自动落库。

### 2. 任务拆解（五件套）

- 切换到"拆任务"模式，输入目标即可生成结构化任务列表。
- 每条任务包含：**标题 / Why / Tradeoff / 待澄清点 / 步骤 / 验收标准 / 建议 agent**。
- 任务写入 `.myteam/tasks.jsonl`，关联 session。

### 3. 任务执行 + A2A 链式派工

- 执行 pending 任务，支持中断、继续、单条重跑、删除。
- **A2A Worklist**：agent 回复中包含 `@mention` 时，自动链式派发给下游 agent（最多 3 层，内置乒乓熔断）。
- **跨 agent 自动 review**：任务完成后自动选另一个 agent 静默 review，写入 `review_status / severity / findings`。
- **SOP 阶段状态机**：`pending → impl → quality_gate → review → gate → done`。

### 4. 人工 Reviewer Gate

- Hub 里的 Gate 面板可手动通过或要求返工。
- 返工任务重新进入 pending，并带上返工说明。
- Gate 通过后自动推进 phase → done，写入 lessons。

### 5. 经验沉淀与自进化

- 失败任务自动写入 `.myteam/lessons.jsonl`（含 pattern 分类，8 类错误模式）。
- `GET /api/lessons/patterns` 返回自动生成的改进提案（同类错误 ≥2 次触发）。
- `POST /api/lessons/promote` 把有效经验晋升到 `memory.md` 长期记忆。

### 6. Skill 市场（Hub > 🧩 Skills）

- **双源市场**：myteam 官方（`skills-registry/`）+ clowder-ai（55 个 skill）。
- **四 Tab 面板**：本次加载 / 已安装 / 🛒 市场 / Prompt 预览。
- 一键安装、启用/禁用开关、按角色/agent 挂载复选框、卸载。
- 按需命中：plan/dispatch 只注入评分最高的 skill 摘要，避免 prompt 过长。
- SKILL.md 目录形态，对齐 clowder-ai 标准（`name / triggers / mounts / next`）。

### 7. Hub 指挥中心

顶部 `Hub` 抽屉集中展示：

- **总览**：agent、任务、Gate、调用状态一览。
- **Agent**：本地 CLI 可用性检测、配置状态。
- **Skills**：技能市场和按需命中预览。
- **Lessons**：踩坑记录和 pattern 分析。
- **调用**：调用次数、成功/失败、耗时统计。
- **Gate**：人工审查入口。
- **任务**：最近任务和状态统计。

### 8. Agent 配置（居中弹窗）

右上角 ⚙ 打开 **680px 居中配置弹窗**：

- **工作室模板**：4 个预置团队一键应用（🚀快速原型 / 🏗️全栈协作 / 🔍严格审查 / 📖研究调研），只更新角色卡，路径/apiKey/模型不变。
- **新建 Agent 变体**：同一 CLI 可创建多个变体（不同 model/角色卡）。
- **角色卡**（两列布局）：
  - `roleDescription / personality / strengths / restrictions`（注入每次 prompt 头部）
  - `nickname / avatar（图片上传）/ color.primary / color.secondary（颜色选择器）`
- **API Key 安全**：key 不明文传输，仅显示末 4 位脱敏（`••••xxxx`），空值不覆盖已有配置。

### 9. 产物面板（顶栏 📁）

点击顶栏 📁 按钮打开右侧 **420px 产物面板**，与聊天区同屏并存：

**💬 聊天提取 Tab**：agent 输出后自动抽取，4 种规则：
1. ` ```typescript:src/api.ts ` — 带文件名的围栏代码块
2. ` ```html ` 等带语言标识的围栏
3. `<file path="xxx">...</file>` 路径标记
4. `https://...` URL 链接；整段带 `# 标题` 的 markdown

**🗂 工作区 Tab**：扫描 workspace 的 `docs/ src/ web/ scripts/` 等产出目录，按修改时间倒序，最新在顶。

**渲染能力**：
- **Markdown**：marked.js 完整渲染（表格/代码块/图片/链接）
- **HTML**：iframe sandbox 预览 + 「🌐 浏览器打开」按钮（blob URL）
- **代码**：语法高亮 + 复制
- **JSON**：格式化预览
- **URL**：可点击卡片

**安全防护**（对齐 clowder-ai F063）：路径越界→403，`.env`/`.git`/`node_modules` 黑名单→403，文件 >1MB→413。

### 10. 图片附件

- 上传或 Ctrl+V 粘贴，单张 ≤8MB，一次最多 5 张。
- 前端显示缩略图；后端路径注入 agent prompt。

---

## 推荐使用流程

1. 打开 `http://localhost:7878/`，用 ⚙ 配置好 CLI 路径和 API Key。
2. 在对话模式直接提问，或用 `@codex` 等指定 agent。
3. 切换到"拆任务"模式，让 agent 生成任务列表。
4. 执行 pending 任务，观察 A2A 链式执行过程。
5. 在 Hub > Gate 中人工审查，通过则沉淀，不通过则返工。
6. 点击顶栏 📁 查看 agent 产出的文档/代码，HTML 文件可直接用浏览器打开。
7. 踩坑后查看 Hub > Lessons 的 pattern 分析，把有效经验晋升到长期记忆。

---

## 文件结构

```text
myteamOUO/
├── README.md                    # 项目首页（本文件）
├── HANDOVER.md                  # 交接文档，新对话先读它
├── ISSUES.md                    # 原始问题追踪
├── docs/
│   ├── problem-course.md        # 课程化问题文档，按标签检索
│   ├── clowder-html-gap.md      # clowder-ai 交互差距对比
│   └── architecture-evaluation.md
├── skills-registry/             # myteam 官方 Skill 源（入库）
│   ├── index.json               # 市场清单
│   └── {name}/SKILL.md          # 每个 skill 详细文档
├── myteam.py                    # Python 统一入口
├── server.mjs                   # Node HTTP server，REST + SSE
├── agent-utils.mjs              # agent 配置、解析器、任务工具、SOP状态机
├── plan.mjs                     # CLI 拆任务入口
├── dispatch.mjs                 # CLI 执行入口
├── web/
│   ├── app.html                 # 控制台 HTML
│   ├── app.css                  # 控制台样式
│   └── app.js                   # 控制台交互逻辑
└── .myteam/                     # 运行时数据，全部不入库
    ├── agents.yaml              # 默认角色说明（入库）
    ├── skills.yaml              # skill 清单（入库，fallback用）
    ├── skills/{name}/SKILL.md   # 本地安装的 skill（不入库）
    ├── skills-state.json        # skill 启用/挂载状态（不入库）
    ├── agents.json              # 动态 agent 配置（不入库）
    ├── avatars/                 # agent 头像（不入库）
    ├── settings.json            # 工作区配置（不入库）
    ├── uploads/                 # 图片附件（不入库）
    ├── tasks.jsonl              # 运行时任务（不入库）
    ├── lessons.jsonl            # 踩坑记录（不入库）
    ├── invocations.jsonl        # 调用记录（不入库）
    ├── memory.md                # 晋升后的长期记忆（不入库）
    ├── memory.json              # session 历史（不入库）
    └── runs/                    # 任务备份（不入库）
```

---

## 本地运行数据（不入库）

以下文件和目录不会提交到 GitHub：

`.env` · `.myteam/agents.json` · `.myteam/skills/` · `.myteam/skills-state.json` · `.myteam/avatars/` · `.myteam/settings.json` · `.myteam/uploads/` · `.myteam/*.jsonl` · `.myteam/memory.*` · `.myteam/runs/` · `reports/`

---

## 路线图

**短期**

1. Backlog 视图：把失败、返工、下一轮任务集中管理。
2. 本地 RAG MVP：检索文档/任务/经验，注入 agent prompt。
3. 产物面板：支持编辑已生成的文件并保存回工作区。

**中期**

1. provider 层抽象：同时支持本地 CLI 和 LangChain。
2. workflow 层：为 LangGraph 做准备。

**长期**

1. LangGraph 管自迭代状态机。
2. LangChain 管模型和工具接口。
3. RAG 管项目记忆和证据检索。

---

## 文档入口

| 文档 | 说明 |
|---|---|
| `HANDOVER.md` | 交接文档，新 agent 接手前先读，含架构设计、API 全表、重要经验 |
| `docs/problem-course.md` | 课程化问题文档，按标签检索坑点和解法 |
| `ISSUES.md` | 原始问题追踪记录 |
| `docs/clowder-html-gap.md` | 与 clowder-ai 的交互差距对比 |
| `docs/architecture-evaluation.md` | LangChain / LangGraph / RAG 接入评估 |

---

## 新对话冷启动提示

```text
项目：myteamOUO，本地 A2A 协作工具 MVP。
GitHub: https://github.com/jhryo25/myteamOUO
本地路径: F:\py project\myteamOUO

请先读取 HANDOVER.md，再读取 docs/problem-course.md 和 ISSUES.md。
用户编程经验不多，说明要简单，代码注释用中文。
不要提交 .env、.myteam 运行时数据或 reports/。
继续工作前先检查 git status。
```
