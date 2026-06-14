# myteam 架构评估：LangChain / LangGraph / RAG

更新时间：2026-06-14

## 结论

myteam 可以接入 LangChain 或 LangGraph，但 MVP 阶段不建议立刻重构。

- LangChain 适合接在“单个 agent 调用层”：统一模型、工具、结构化输出和中间件。
- LangGraph 适合接在“自迭代流程层”：把 `goal -> plan -> assign -> run -> review -> test -> learn -> backlog` 做成可恢复、有状态、可人工打断的图。
- RAG 适合接在“上下文检索层”：让 agent 在执行前先检索项目文档、任务记录、踩坑记录、交接文档和报告。

## 为什么现在不直接接

当前项目目标是低成本、轻量、本地优先。现在的核心链路是：

1. 本地文件保存状态。
2. 本地 CLI 调用 agent。
3. Hub 只做状态可视化和人工 Gate。
4. Skills 已经先做了按需加载。

如果现在直接引入 LangChain / LangGraph，会增加 npm 依赖、模型 provider 配置、运行时抽象和调试成本。更稳的路线是先保留当前本地 CLI 内核，再逐步抽象接口。

## 接 LangChain 的位置

适合位置：`agent-utils.mjs`

当前 `invokeAgent()` 是直接 spawn 本机 CLI。未来可以新增一个 provider 层：

```text
invokeAgent()
  -> local-cli provider: codex / claude / kimi
  -> langchain provider: createAgent + tools + middleware
```

优势：

- 统一模型接口，后续可以接 OpenAI、Anthropic、Google、Ollama 等。
- 工具调用可以结构化，不必完全依赖 CLI 输出文本。
- 适合做 Reviewer Agent 自动审、结构化 JSON 输出和工具调用。

不适合直接替代的部分：

- 当前本地 CLI 已经能跑 Kimi，替换成本高。
- myteam 的低成本用户路径暂时不需要复杂模型抽象。

## 接 LangGraph 的位置

适合位置：新增 `workflow.mjs` 或 `orchestrator.mjs`

当前流程分散在 `/api/plan`、`/api/dispatch`、`/api/tasks/:id/gate`。未来可以把它们映射成图节点：

```text
goal
  -> plan
  -> assign
  -> run
  -> review_gate
  -> test
  -> learn
  -> backlog
```

优势：

- 自迭代流程更清晰，每个节点有输入、输出和状态。
- 支持长流程恢复，不怕中途失败。
- 适合接 human-in-the-loop：例如 Gate 处暂停，等用户点通过或返工。
- 适合多 agent 协作，后续可以做 controller / worker / reviewer 的状态机。

建议接入时机：

1. `tasks.jsonl` 字段稳定。
2. Reviewer Gate 自动审完成。
3. Backlog 视图完成。
4. 需要跨多轮自动执行时，再考虑 LangGraph。

## 本项目哪里适合 RAG

RAG 不应该一开始拿来“联网搜索所有东西”。myteam 最适合先做本地 RAG。

优先检索范围：

1. `HANDOVER.md`
   - 新对话冷启动。
   - 避免 agent 忘记项目状态。

2. `ISSUES.md`
   - 检索已踩坑经验。
   - 避免重复犯错。

3. `docs/*.md`
   - 检索架构评估、差距记录和设计决策。

4. `.myteam/tasks.jsonl`
   - 检索相似任务、失败任务、返工记录。

5. `.myteam/lessons.jsonl`
   - 检索确认过的失败原因。

6. `reports/`
   - 检索用户生成过的报告、日报、输出样例。

MVP 做法：

```text
用户目标
  -> 本地关键词检索 docs / issues / lessons / tasks
  -> 取前 3-5 段上下文
  -> 注入 plan / run / review prompt
```

后续升级：

```text
关键词检索
  -> 本地 embedding
  -> 向量索引
  -> 混合检索
  -> 引用来源展示
```

## 推荐路线

短期：

1. 保持当前无依赖架构。
2. 完成 Skills 按需加载。
3. 做本地 RAG 的关键词检索版本。
4. 做 Reviewer Agent 自动审。

中期：

1. 抽出 `providers/`，同时支持 local CLI 和 LangChain。
2. 抽出 `workflow/`，准备接 LangGraph。
3. 把人工 Gate 变成 LangGraph interrupt 的候选点。

长期：

1. LangGraph 管自迭代状态机。
2. LangChain 管模型和工具接口。
3. RAG 管项目记忆和证据检索。

