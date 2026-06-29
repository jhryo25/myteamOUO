# LangGraph P0–P4 最终交接

更新时间：2026-06-22
交付分支：`codex/langgraph-p0-foundation`
实现基线：`e739f72 用 LangGraph 实现 P1-P4 工作流`

## 交付结论

myteam 的核心编排已经从手写循环迁移到 LangGraph：

- P0：统一 Workflow/Task 生命周期、关联 ID、旧字段兼容和重启恢复契约；
- P1：用 ports 隔离 Agent、Reviewer、Task repository、事件与派生任务副作用；
- P2：接入 SQLite checkpointer、`interrupt()` 和 `Command({ resume })`；
- P3：实现多任务队列、Task subgraph、受限返工和动态 subagent；
- P4：Chat、Plan、Schedule 统一进入 checkpointed turn graph。
- 用户侧：新增工作流暂停卡、恢复按钮、checkpoint 明细与失败节点重试；刷新页面或切换会话后会恢复最近一次工作流卡片。

浏览器 `/api/dispatch` 与 CLI `dispatch.mjs` 已共用 `LangGraphDispatchEngine`，不再各自维护编排循环。现有 REST、SSE、CLI adapter 和业务数据库保持兼容。

## 接手入口

| 文件 | 职责 |
|---|---|
| `workflow-state.mjs` | canonical lifecycle、correlation、兼容投影 |
| `workflow/ports.mjs` | 图与外部副作用之间的契约 |
| `workflow/dispatch-graph.mjs` | 父 dispatch graph、Task subgraph、run/resume/getState |
| `workflow/turn-graph.mjs` | Chat、Plan、Schedule 共用图 |
| `workflow/checkpointer.mjs` | SQLite checkpointer 生命周期 |
| `server.mjs` | HTTP/SSE adapter 与实际 CLI/Reviewer 实现 |
| `dispatch.mjs` | CLI dispatch adapter |
| `tests/langgraph-workflow.test.mjs` | LangGraph 核心行为验收 |

更细的节点流、API 示例与状态边界见 `../architecture/langgraph-p1-p4-implementation.md`。

## 工作流结构

```text
Dispatch parent graph
  initialize
    → select_task
    → clarify? (interrupt)
    → task subgraph
    → enqueue_spawns
    → advance
    → select_task / finish

Task subgraph
  execute
    → review
    → human_gate? (interrupt)
    → complete
    ↘ rework → execute（受 maxReworkAttempts 限制）
    ↘ review_error → halt（保留 Agent 结果，仅允许重试 Reviewer）
```

`workflowRunId` 是 LangGraph `thread_id`；`sessionId` 只表示对话上下文，`clientRunId` 只表示 SSE/取消请求。不要混用三者。

## 数据边界

| 数据 | 存储 |
|---|---|
| Task、Session、Approval、Artifact、审计 | `.myteam/myteam.sqlite` |
| LangGraph checkpoint、channel、next node、interrupt | `.myteam/langgraph.sqlite` |
| 当前 HTTP response、SSE client、请求期 adapter | 进程内存 |

LangGraph checkpoint 不是业务数据真相。所有业务状态仍需通过 ports 写回 canonical lifecycle。

`.myteam/langgraph.sqlite*` 已加入 `.gitignore`，不要提交运行时数据库。

## 运行与验收

```bash
npm install
npm run check
npm test
node server.mjs --port 7878
```

本次交付结果：

- `npm run check` 通过；
- `npm test`：100/100 通过；
- 真实服务可正常启动；
- `/api/status` 与 `/api/running` 正常；
- 空工作流查询返回 404；
- `.myteam/langgraph.sqlite` 可正常创建；
- 服务错误日志为空。

核心行为测试覆盖：多任务与动态 spawn、受限返工、人工 Gate、澄清 interrupt、恢复时不重复 Agent/Reviewer 副作用、SQLite 跨 engine 实例恢复，以及 Chat/Plan/Schedule turn graph。

Reviewer 协议链路已修复结构化 CLI 事件被强转为 `[object Object]` 的根因。协议解析失败现在保留 Agent 结果、立即停止当前队列，并允许只重试 Reviewer；不会伪装成 Agent 返工，也不会继续推进后续任务。

### Reviewer 故障语义

- `invokeAgent()` 只从结构化解析结果读取 `text`，不再把对象隐式拼接为字符串；
- `parseReviewResult()` 兼容 JSON 包装层、大小写 verdict、文本 verdict 兜底和 0–100 分数归一化；
- 协议解析或 Reviewer 调用失败写入 `failure_stage: review`、`review_only_pending: true` 和 `previous_result`；
- `POST /api/tasks/:id/retry-review` 只恢复 Reviewer，跳过已经成功的 Agent 节点；
- 任一 Task subgraph 失败后父图进入 `halt`，剩余任务不再执行；
- 旧记录中的 `agent_repair_pending` 仅用于兼容展示，不再产生新的“内部验收修复队列”状态。

### 用户侧交互

- 工作流卡片展示当前节点、任务、Agent/Reviewer、活动摘要和 checkpoint step；
- 刷新页面后通过 `/api/running`、workflow checkpoint 和会话关联恢复当前执行信息；
- Reviewer 要求返工时明确说明“当前任务重新执行，不进入下一任务”；
- 失败节点逐项判断：执行失败显示“重试 Agent”，验收失败且有保存结果时显示“只重试 Reviewer”，已重置节点显示“无需重试”；
- 点击重试后立即显示新的运行卡片，不再等待第一个 SSE 事件才反馈。

## 运行接口

- `GET /api/workflows/:workflowRunId`：读取 checkpoint 状态；
- `POST /api/workflows/:workflowRunId/resume`：恢复当前进程中的人工 Gate 或澄清 interrupt；
- `POST /api/tasks/:id/retry-review`：保留 Agent 结果，只重试 Reviewer；
- `/api/dispatch` SSE 新增 `workflow-start`、`workflow-interrupt`、`paused`，原进度事件保持兼容。
- `/api/dispatch` 支持 `taskIds` 精确选择；Web 发起的 dispatch 默认启用人工 Gate。

恢复人工 Gate 的 body：

```json
{"resume":{"verdict":"pass","comment":"人工验收通过"}}
```

恢复澄清的 body：

```json
{"resume":{"answers":[{"question":"目标环境？","answer":"Windows"}]}}
```

## 已知限制

唯一明确未收口的生产化边界是“服务重启后的真实 CLI 恢复”：

- SQLite checkpoint 可以跨进程读取；
- `LangGraphDispatchEngine` 已通过新实例恢复测试；
- 但服务端 CLI adapter 仍是请求期闭包，重启后无法自动重建；
- 因此重启后可以查询旧 checkpoint，但 HTTP resume 会返回 `workflow_adapter_unavailable`；
- 同一进程内的暂停与恢复不受影响。

下一步应把 agent 配置、任务作用域、审批上下文和事件目标持久化为可重建的 adapter descriptor，并在服务启动或 resume 请求时按 `workflowRunId` 重建 ports。

## 接手后的建议顺序

1. 完成 adapter descriptor 持久化与跨进程恢复集成测试；
2. 给 workflow 查询/恢复 API 增加权限和过期清理策略；
3. 增加真实 CLI 的 interrupt/resume 端到端测试；
4. 再考虑并行任务、checkpoint 可视化和运行指标，避免先扩展图复杂度。

## 回退原则

需要回退时优先使用 Git revert 保留迁移历史，不要直接删除业务数据库。LangGraph checkpoint 使用独立文件，停止新图入口后可单独归档；业务 Task、Session、Approval 与 Artifact 不依赖它作为权威存储。
