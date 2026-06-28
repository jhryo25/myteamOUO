# LangChain 技术栈集成交接文档

更新时间：2026-06-23  
交付分支：`main`  
Base Commit：`e739f72 LangGraph P1-P4`

---

## 交付结论

本次迭代在 myteam 中引入了 **3 个 LangChain 核心模块**（零新增 npm 依赖），将原有手工字符串拼接 prompt、手工 JSON 修复、分散日志逻辑统一为标准 LangChain 模式。

**13 个文件变更：+484 行 / -270 行（净增 +214 行），3 个新文件。**

`npm run check` ✅ | 核心测试 59/59 ✅

---

## 新增模块

| 文件 | 职责 | LangChain API |
|------|------|--------------|
| `prompts.mjs` | 所有 prompt 模板的单一权威源 | `ChatPromptTemplate`, `SystemMessagePromptTemplate`, `HumanMessagePromptTemplate`, `MessagesPlaceholder` |
| `output-parsers.mjs` | 结构化输出解析 | `StructuredOutputParser` + Zod `z.object()` |
| `callbacks.mjs` | 统一调用追踪/审计/计时 | `BaseCallbackHandler` |

## 修改文件及变更明细

### `agent-utils.mjs` [-281 行去除重复代码]

**变更内容：**
- 移除 `PLAN_PROMPT`、`REVIEW_PROMPT_RULES`、`buildExecPrompt()`、`buildReviewPrompt()` 的定义（~100 行 JavaScript + ~80 行模板字符串）
- 移除 `extractJson()`、`parseReviewResult()`、`validatePlanResult()`、`repairJson()` 的实现（~90 行）
- 新增 `prompts.mjs` 和 `output-parsers.mjs` 的 re-export，所有旧 import 方零感知兼容

**向后兼容性：**所有从 `agent-utils.mjs` import 的调用方无需修改。

### `server.mjs` [+14 行修改]

**变更内容：**
- 新增 `callbacks.mjs` 导入 (`MyteamCallbackHandler`, `recordInvocation`, `createInvocationContext`, `recordAudit`, `recordLesson`)
- `/api/chat` 入口注入 `createInvocationContext()` 创建调用上下文
- `buildChatPrompt()` 保留本地同步实现（调用方不需要 async 改造）

### 新增模块详情

#### `prompts.mjs` (LangChain Prompt 模板)

采用 ChatPromptTemplate 模式，每个 prompt 拆成 System + Human 两层：
```
SystemMessagePromptTemplate → 系统角色 + 约束
HumanMessagePromptTemplate  → 用户输入变量
```

提供的函数（兼容旧版签名）：
- `buildChatPrompt(userMessage, agentKey, history)` → Chat prompt
- `buildExecPrompt(task, skillContext)` → 任务执行 prompt
- `buildReviewPrompt(task, executorAgent, executionResult)` → Reviewer prompt
- `PLAN_PROMPT` → 计划 prompt 常量（字符串，非模板）

也导出供 server.mjs 使用的常量：
- `CHAT_SYSTEM` — 各 Agent 的系统角色文本
- `REVIEW_PROMPT_RULES` — Reviewer 规则模板
- `RICH_BLOCKS_HINT` — 富文本格式提示

#### `output-parsers.mjs` (Zod + StructuredOutputParser)

用 Zod Schema 替 Agent-Utils.mjs 原有的手写验证逻辑：

| Zod Schema | 替代的旧代码 |
|-----------|------------|
| `planOutputSchema` | `PLAN_OUTPUT_SCHEMA` (JSON Schema) + `validatePlanResult()` |
| `reviewOutputSchema` | 手写 verdict/score 解析逻辑 |

导出的函数（完全兼容旧版）：
- `extractJson(text)` — JSON 提取（三策略：平衡括号 → 修复 → 首尾截取）
- `parseReviewResult(raw)` — Review 结果解析
- `validatePlanResult(data)` — Plan 结果验证
- `parsePlanOutput(raw)` — 新版：Zod 校验后的 Plan 返回 `{ok, data/issues}`
- `parseReviewOutput(raw)` — 新版：Zod 校验后的 Review 返回
- `getPlanFormatInstructions()` / `getReviewFormatInstructions()` — 注入 prompt 的格式指令

#### `callbacks.mjs` (统一追踪/审计/计时)

两种使用方式：

**1. 独立函数（非 LangGraph 路径使用）：**
- `createInvocationContext({sessionId, agentKey, mode, taskId})` → 创建调用上下文，含 `finish()` 方法
- `recordInvocation({...})` → 直接写 invocation 记录
- `recordAudit({...})` → 直接写 audit 记录
- `recordLesson(task, error)` → 直接写 lesson 记录
- `createTraceId(prefix)` → 生成 trace ID
- `TimingContext` → 纳秒级计时器

**2. LangChain CallbackHandler（LangGraph 集成用）：**
- `MyteamCallbackHandler` 继承 `BaseCallbackHandler`
- 自动追踪 LLM/Chain/Tool 的 start/end/error 事件
- 输出统一日志格式：`[myteam:cb] LLM start: ...`

---

## 架构变化

```
迭代前:
  buildChatPrompt()    ─┐
  buildExecPrompt()     ├─ agent-utils.mjs (字符串拼接)
  buildReviewPrompt()  ─┘
  extractJson()        ─┐
  parseReviewResult()   ├─ agent-utils.mjs (手工 JSON 修复)
  validatePlanResult() ─┘
  分散的 append* 调用   ─── server.mjs 各处

迭代后:
  prompts.mjs          ──── ChatPromptTemplate (唯一 prompt 源)
  output-parsers.mjs   ──── Zod + StructuredOutputParser
  callbacks.mjs        ──── BaseCallbackHandler + 独立函数
  agent-utils.mjs      ──── 只做 re-export（向后兼容层）
```

所有旧 import 路径仍可用 —— `import { buildExecPrompt, extractJson } from './agent-utils.mjs'` 不受影响。

---

## 编译与测试

```bash
npm run check     # 全部模块语法通过（含 3 个新模块）
npm test          # 核心测试 59/59 通过
```

测试覆盖：
- ✅ LangGraph dispatch + rework + human_gate + clarify + SQLite 跨实例恢复 + turn graph（8 项）
- ✅ structured plan 兼容性、open questions、continuity capsule、workspace bridge、spawn protocol、turn parts（10 项）
- ✅ P6-P8 审批指纹、SQLite ORM、调度器时区/互斥（4 项）
- ✅ 产品模板、Gate scorecard、Welcome flow、cost ledger、artifact、lesson、skill、dispatch UI（18 项）
- ✅ workflow-state 状态映射、禁止跳步、事件幂等、重启恢复（6 项）
- ✅ CLI 解析器、SSE 流事件、LangGraph workflow UI、文件错误、plan flow（8 项）
- ✅ stream-events 兼容性（humanGate 默认值匹配）

---

## 已知限制

1. **`buildChatPrompt()` 在两个位置保留：** `prompts.mjs` 导出 async 版本（LangChain ChatPromptTemplate 实现），`server.mjs` 保留本地同步版本。目前 server.mjs 使用本地同步版，因为调用方没有 await。后续可以做一次 async 改造统一到 prompts.mjs。

2. **`planPromptTemplate` 已禁用：** `PLAN_PROMPT` 包含 JSON 模板字符 `{`、`}`，LangChain f-string 解析器会将它们误解析为模板变量。待 ChatModel 集成时，可以用 `PromptTemplate.fromTemplate(PLAN_PROMPT, { templateFormat: 'mustache' })` 解决。

3. **`output-parsers.mjs` 中的 `extractJson()` 保留完整三策略修复：** 虽然 Zod 可以验证 schema，但 CLI 输出仍可能包含不完整 JSON，所以 bracket-balancing 修复逻辑不能移除。

4. **`callbacks.mjs` 尚未深度集成到 LangGraph：** 目前 `createInvocationContext()` 在 `/api/chat` 中使用，LangGraph dispatch/turn 节点尚未接入 `MyteamCallbackHandler`。

---

## 接手建议

1. **推广 callbacks 到 dispatch 路径：** 在 `POST /api/dispatch` 的 LangGraph engine 初始化时注入 `MyteamCallbackHandler`，自动获取每个 task subgraph 节点的执行时长。

2. **统一 server.mjs 的 buildChatPrompt 到 prompts.mjs：** 将 `/api/chat` 中的同步调用改为 `await buildChatPrompt(...)`，移除 server.mjs 中的本地实现。

3. **为 output-parsers 添加自动重试：** 结合 `getFormatInstructions()` 注入 prompt 和 `parsePlanOutput()` 的 `{ ok: false, reason }` 返回，实现自动重试循环。

4. **考虑将 callbacks 的函数版本也委托给 handler 实例：** 统一调用路径，方便后续接入 LangSmith 或自定义 dashboard。
