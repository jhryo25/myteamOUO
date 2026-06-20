# myteam 问题课程文档

更新时间：2026-06-20

这份文档把 myteamOUO 从 MVP 到当前版本遇到的问题整理成“课程卡片”。它不是流水账，而是给后续开发者和 agent 检索用的经验库：遇到相似问题时，先搜标签或关键词，再按卡片里的解法处理。

## 如何检索

建议优先搜这些标签：

| 标签 | 适合搜索的问题 |
| --- | --- |
| `bug` | 功能坏了、接口报错、页面状态不对 |
| `ux` | 用户看不懂、点了没反馈、流程焦虑 |
| `agent` | agent 配置、路由、启动、调用 |
| `windows` | Windows 路径、权限、spawn、端口 |
| `session` | 会话、历史、命名、回收站 |
| `skills` | 技能按需加载、技能命中、prompt 注入 |
| `hub` | Hub 信息架构、哪些信息该展示 |
| `image` | 图片上传、缩略图、多模态输入 |
| `self-iteration` | 自迭代、Gate、review、learn、backlog |
| `security` | 本地隐私、运行时文件、上传边界 |
| `lesson` | 已沉淀的可复用经验 |

## 课程 1：本地 agent 不是“路径存在”就能用

标签：`bug`, `agent`, `windows`, `lesson`

现象：Codex 路径看起来存在，但拆任务时报 `spawn EPERM`。

原因：WindowsApps 里的某些可执行文件是受系统保护的入口，`existsSync(path)` 只能说明文件路径存在，不能说明当前 Node 进程能启动它。

解法：
- 后端新增 `checkAgentLaunchable()`，用轻量 `--help` 真实启动一次。
- `/api/status` 返回 `configured / exists / available / error`。
- 前端拆任务只展示 `available=true` 的 agent。

验证：
- `GET /api/status` 能看到不可启动原因。
- 不可启动的 agent 不再出现在拆任务候选里。

复用提醒：所有 CLI 工具都不要只用“文件存在”判断可用性，要做启动级检测。

## 课程 2：Kimi 接入不能只写 `.env`

标签：`agent`, `ux`, `arch`

现象：`.env.example` 有 `KIMI_PATH`，但界面、状态 API、@mention、任务执行链都不认识 Kimi。

原因：配置模板只是入口，真正接入需要贯通“配置、状态、路由、调用、前端展示、任务分配”整条链。

解法：
- 在 `agent-utils.mjs` 中加入 Kimi 的调用模板。
- `/api/status`、`/api/agents`、Agent 抽屉、plan/dispatch 都支持 Kimi。
- Kimi 默认使用参数模式：`kimi -p "{prompt}" --output-format text`。

验证：
- Agent 抽屉能看到 Kimi。
- Kimi 可启动时，拆任务默认可选择 Kimi。
- `@kimi` 能路由。

复用提醒：新增 agent 要按“配置 -> 状态 -> 路由 -> 执行 -> UI -> 验证”检查，不要只改一个地方。

## 课程 3：agent 数量不能写死

标签：`agent`, `arch`, `ux`, `lesson`

现象：项目最初只认识 `codex / claude / kimi`，用户希望灵活增减 agent。

原因：前后端都把 agent key 写死，后续接 Qwen、Gemini、本地模型时会不断改代码。

解法：
- 新增 `.myteam/agents.json` 作为本地动态 agent 注册表。
- `readAgentRegistry()` 合并默认 agent 和用户新增 agent。
- `buildCliConfig()` 根据注册表动态生成 CLI 配置。
- 前端设置抽屉支持新增/删除 agent。

验证：
- `/api/agents` 返回动态列表。
- 新增 agent 后，状态、mention 候选、配置抽屉都会更新。

复用提醒：MVP 可以有默认值，但业务列表不要长期写死在代码里。

## 课程 4：@mention 前后端必须一致

标签：`bug`, `ux`, `agent`, `lesson`

现象：前端提示 `@agent` 可路由，但后端实际识别规则不一致，或者新增 agent 后后端仍只认识旧三种。

原因：前端 autocomplete、后端 `parseAtMention()`、后端 `stripAtMentions()` 使用了不同规则。

解法：
- 后端统一使用动态 agent key 解析 mention。
- 前端 mention 补全从 `/api/status` 的 agent 列表生成。
- mention 只在行首或新行开头触发，避免普通文本误触发。

验证：
- 输入 `@k` 能补全 Kimi。
- 新增 agent 后，也能作为 mention 候选。
- 普通句子中提到 `@xxx` 不误触发。

复用提醒：凡是“提示”和“执行”有关的逻辑，都要共用同一套规则。

## 课程 5：session 不应该强迫用户先命名

标签：`ux`, `session`

现象：点击新建 session 时，用户还没开始提问就被要求命名。

原因：系统把“整理会话”放在“开始对话”之前，增加新手负担。

解法：
- 新建 session 使用默认标题。
- 用户发送第一条消息后，系统自动从问题中生成短标题。
- 仍保留后续手动重命名能力。

验证：
- 新建 session 不再弹命名阻塞。
- 第一条问题发送后，侧边栏标题自动变得可读。

复用提醒：命名、分类、整理这类动作，尽量从用户真实输入中自动推断。

## 课程 6：图片不能只当文件名显示

标签：`image`, `ux`, `agent`, `bug`

现象：用户发图后，聊天栏只显示文件名，agent 也没有针对图片回答。

原因：
- 前端只展示附件 chip，没有缩略图。
- 后端 `/api/chat` 之前要求 `message` 非空，只发图会被拒绝。
- 后端给 agent 的图片说明太弱，容易被当作普通路径忽略。

解法：
- `/api/uploads` 保存图片到 `.myteam/uploads/`，返回本地绝对路径和 `/uploads/...` URL。
- 新增只读 `/uploads/:file` 静态路由，用于缩略图展示。
- 用户消息气泡和历史消息都支持图片缩略图。
- 只发图时自动补一句“请分析我刚上传的图片”。
- prompt 中明确要求 agent 先观察图片；如果无法读取图片，必须说明能力限制。

验证：
- 上传接口返回 `url`。
- 访问 `/uploads/...` 返回 `image/png` 等图片类型。
- 只发图片不会再报 `message 不能为空`。

复用提醒：多模态 MVP 至少要同时处理“可见预览”和“agent 可理解输入”。真正视觉能力仍取决于具体 agent CLI 是否支持读图。

## 课程 7：上传文件要有边界

标签：`image`, `security`, `lesson`

现象：如果不限制图片大小和访问路径，后续可能误传大图或暴露本地目录。

原因：上传附件属于本地文件写入和读取能力，必须默认保守。

解法：
- 单张图片限制 8MB。
- 最多一次上传 5 张。
- 静态图片路由只允许读取 `.myteam/uploads/` 内的文件名。
- `.myteam/uploads/` 加入 `.gitignore`。

验证：
- 大图会返回清晰错误。
- `/uploads/` 不能读取上传目录以外的文件。

复用提醒：任何“让用户上传文件”的功能，都要同时考虑大小限制、路径限制和是否入库。

## 课程 8：运行中没有反馈会制造焦虑

标签：`ux`, `agent`, `observability`

现象：agent 启动或思考时页面长时间无变化，用户不知道它是不是卡住了。

原因：SSE 只推送最终文本 chunk，没有把 `starting / thinking / streaming` 这些状态暴露给前端。

解法：
- `streamAgent()` 在启动、等待首字、开始输出时发送 `status` SSE。
- 前端 agent 气泡在无正文前显示“正在启动 / 正在思考 / 开始输出”。

验证：
- 运行 agent 后，气泡先出现状态行，而不是空白。

复用提醒：等待超过 1 秒的动作，都应该给用户状态反馈。

## 课程 9：Hub 不是把所有信息都展示给用户

标签：`hub`, `ux`, `product`

现象：Hub 里曾经展示 clowder-ai 对比和下部路线，用户认为这些不应该放在产品界面。

原因：开发决策信息和用户操作信息混在一起，会让界面显得复杂。

解法：
- Hub 保留当前可操作状态：Agent、Skills、Lessons、调用、Gate、任务。
- 差距对比迁移到 `docs/clowder-html-gap.md`。
- LangChain / LangGraph / RAG 评估迁移到 `docs/architecture-evaluation.md`。

验证：
- Hub 页面不再展示“对比”tab。
- 用户仍可在 docs 中查到技术评估。

复用提醒：产品界面放“下一步能做什么”，技术文档放“为什么这么做”。

## 课程 10：Skills 先按需加载，不要一次塞满 prompt

标签：`skills`, `prompt`, `cost`, `lesson`

现象：如果所有技能说明都塞进 prompt，会浪费上下文，也会干扰 agent。

原因：技能是能力目录，不是每次任务都需要全部加载。

解法：
- `.myteam/skills.yaml` 记录技能名称、触发条件、挂载 agent 和 prompt 摘要。
- `/api/skills?text=&agent=&phase=` 根据目标文本、agent、阶段返回命中技能。
- plan/dispatch 只注入命中的 skill 摘要。

验证：
- Hub Skills tab 能看到命中结果。
- 不相关任务不会注入所有技能。

复用提醒：低成本 A2A 项目要优先做“按需上下文”，再做复杂技能系统。

## 课程 11：人工 Gate 是自迭代的安全阀

标签：`self-iteration`, `gate`, `reviewer`, `lesson`

现象：任务执行完就直接标记 done，缺少 review/test gate。

原因：MVP 早期只关注 run，没有把 review 和 test 作为任务生命周期状态。

解法：
- Hub 增加 Gate tab。
- `POST /api/tasks/:id/gate` 支持人工通过或返工。
- 返工会把任务重新放回 pending，并把返工说明带入下一次执行 prompt。

验证：
- 已完成任务可以通过 Gate。
- 返工任务会重新进入待执行列表。

复用提醒：自迭代不要一开始追求全自动，先把“通过/返工”做成结构化状态。

## 课程 12：A2A 链式调用要防循环

标签：`arch`, `agent`, `self-iteration`, `lesson`

现象：agent 回复中 `@mention` 可以触发下游 agent，但两个 agent 可能互相 @，形成 A -> B -> A -> B。

原因：只有最大深度限制，不足以识别乒乓式循环。

解法：
- 给 chain task 传 `chainHistory`。
- 检测最近 4 个 agent 是否形成交替模式。
- 触发熔断事件，停止继续派生。

验证：
- A/B 循环不会无限执行。

复用提醒：多 agent 系统至少要有 depth limit、循环检测和人工接管入口。

## 课程 13：历史渲染不能复用流式打字状态

标签：`bug`, `session`, `ux`

现象：连续 assistant 历史消息加载时，前一条渲染不完整。

原因：历史加载复用了 `agentTypingBubble` 这种单例流式状态，连续消息会互相覆盖。

解法：
- 历史消息走独立的直接渲染函数。
- 流式输出只用于当前正在执行的 agent。

验证：
- 切换 session 后，历史消息完整显示。

复用提醒：实时流和历史回放是两条渲染路径，不要混用全局 typing 状态。

## 课程 14：运行时数据必须默认不入库

标签：`security`, `git`, `lesson`

现象：新增 `.myteam/memory.json`、`.myteam/uploads/`、`.myteam/agents.json` 等运行时文件后，如果忘记 ignore，可能提交用户隐私或本机路径。

原因：每次新增持久化文件时，没有同步更新 `.gitignore`。

解法：
- `.env`、任务记录、调用记录、会话历史、上传图片、动态 agent 本地配置都加入 `.gitignore`。
- 只提交无敏感的模板和说明。

验证：
- `git status --short` 不出现 `.myteam` 运行时数据。

复用提醒：每新增一个本地持久化文件，就立刻问一句：“它该不该进 GitHub？”

## 课程 15：端口占用要给新手可执行提示

标签：`windows`, `ux`, `dev-server`

现象：7878 被旧服务占用时，新服务启动失败。

原因：本地开发经常遗留 Node 进程，新手不知道如何释放端口。

解法：
- 服务启动错误里明确提示端口被占用。
- 给出 Windows 释放端口的命令建议，或建议换端口。

验证：
- 端口占用时不会静默崩溃。

复用提醒：本地工具面向新手时，错误提示必须包含“下一步怎么做”。

## 课程 16：浏览器自动化验证也可能被环境挡住

标签：`qa`, `browser`, `lesson`

现象：Playwright 包存在，但浏览器二进制缺失；Chrome Codex 扩展也未安装/注册，无法自动点击页面。

原因：自动化工具链不等于完整浏览器环境。

解法：
- 先跑语法检查和接口验证。
- 对浏览器自动化阻塞点做明确记录。
- 不为了验证临时安装新依赖，除非用户允许。

验证：
- `node --check`、`git diff --check`、真实 API 验证都通过。
- 最终说明清楚哪些验证没跑成。

复用提醒：验证报告要区分“代码没问题”和“环境无法自动验证”，不要混在一起。

## 课程 17：README 应该讲“解决什么问题”，不只讲“有什么文件”

标签：`docs`, `ux`, `lesson`

现象：README 如果只列启动命令和文件结构，新手不容易理解项目价值。

原因：项目文档没有先回答“我为什么需要它”。

解法：
- README 顶部增加“它解决的问题”。
- 功能介绍按用户目标组织：协作、拆任务、执行、审查、记忆、扩展。
- 把复杂实现细节放到 HANDOVER 和课程文档。

验证：
- 新用户先读 README 能知道 myteam 能做什么。

复用提醒：面向新手的项目，README 先讲用途，再讲命令，再讲结构。

## 课程 18：CLI prompt 占位符不能先替换再按空格拆分

标签：`bug`, `agent`, `kimi`, `image`, `windows`, `splitArgs`, `lesson`

现象：用户上传图片后，Kimi 气泡显示“正在启动”，随后只出现 `exit code 1`。

实际排查到两个连续问题：

1. Kimi 的 sessions 目录不可写，stderr 里是 `EPERM: operation not permitted, mkdir ...`。
2. 修好权限后，Kimi 又报 `unknown command 'are'`。

原因：

- Kimi 每次 prompt 模式都会创建本地 session。当前由 Codex 启动的 myteam 服务运行身份对 `C:\Users\Administrator\.kimi-code\sessions` 没有写权限。
- `splitArgs()` 的旧逻辑是先把 `{prompt}` 替换成长文本，再按空格拆分。这样 `-p {prompt}` 会被拆成 `-p`, `You`, `are`, ...，prompt 内容被当成 CLI 参数甚至 command。

解法：

- 给本机 `CodexSandboxUsers` 增加 `.kimi-code` 写权限，让当前服务能创建 Kimi session。
- `splitArgs()` 改为先拆模板，再把 `{prompt}` 替换成一个完整参数。
- `streamAgent()` 和 `invokeAgent()` 捕获 stderr，失败时展示真实错误。

验证：

- `/api/chat` 调用 Kimi 能正常流式输出。
- 使用真实截图作为图片附件时，Kimi 能读取并描述截图内容。
- 调用记录里失败时会保存 stderr，不再只有 `exit code 1`。

复用提醒：所有 CLI 模板里的大文本占位符都要按“一个参数”处理。任何 agent 失败都要优先展示 stderr，不要只展示退出码。

## 后续建议

1. 把本文件接入本地 RAG：当用户遇到错误时，先检索本课程文档和 `ISSUES.md`。
2. 在 Hub Lessons tab 里增加“打开课程卡片”链接。
3. Reviewer Agent 自动 Gate 前，先让它引用本课程文档中的相关标签。
4. 新增问题时，优先追加一张课程卡片，而不是只写散乱备注。
## 课程 19：能力不等于导航入口

标签：`ux`, `agent`, `shell`, `lesson`

当 Shell 是 Agent 的执行能力时，把它做成顶部“输入 PowerShell”按钮会把责任转嫁给用户，也会让审批模型显得割裂。正确做法是让 Agent 通过 Skill/工具协议调用，服务端统一审批和审计；用户界面只呈现任务意图、风险原因和结果。

## 课程 20：远端市场切换需要跨视图缓存

标签：`skills`, `cache`, `performance`, `lesson`

组件内部缓存只能优化一次挂载。应用同时有 Hub Skills 和独立 Skills 页面时，应共享数据缓存和进行中的 Promise，并在空闲时预取慢源；服务端再用 TTL、并发合并和 stale fallback 控制远端波动。

## 课程 21：本地文件链接是安全功能，不只是 Markdown 样式

标签：`artifact`, `security`, `windows`, `lesson`

识别 `file://`、Windows 绝对路径和相对输出路径只是第一步。打开前必须对 realpath 做工作区边界校验、拒绝敏感目录和非目标扩展名，再通过不经过命令 shell 的系统文件关联启动默认应用。

## 课程 22：先统一事件契约，再做实时与历史 UI

标签：`agent`, `stream`, `sqlite`, `ux`, `lesson`

如果前端只消费临时的 `thinking / activity / chunk` 回调，实时画面可以很好看，但刷新后只剩一段纯文本；反过来，如果数据库只保存最终正文，也无法恢复工具调用过程。应先定义稳定、有序、可持久化的 `turn.parts`，再让实时 SSE 和历史回放分别消费同一契约。工具调用必须用稳定 `callId` 配对，Agent 变体也必须继承基础 CLI parser，否则原始 NDJSON 会穿透到聊天气泡。

复用提醒：流式事件是传输形式，parts 才是领域模型；兼容字段可以保留，但不能继续作为唯一历史来源。
