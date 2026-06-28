# LangGraph 重构 P0：状态与关联 ID 契约

本契约是旧编排器与后续 LangGraph 工作流之间的兼容边界。P0 不引入 LangGraph 运行时，先消除状态和 ID 语义上的歧义。

## 权威状态

Workflow Run 使用：

`idle | running | waiting_input | waiting_approval | interrupting | interrupted | completed | error | cancelled`

Task 使用：

`queued | waiting_input | running | reviewing | waiting_approval | rework | interrupted | completed | failed | cancelled`

每条任务通过 `lifecycle` 保存权威状态：

```json
{
  "version": 1,
  "state": "running",
  "revision": 2,
  "updatedAt": "2026-06-21T00:00:00.000Z",
  "reason": "",
  "lastEventId": "execute:task-id:attempt-1",
  "source": "legacy"
}
```

`status`、`phase`、`review_status`、`gate_status` 和 `test_status` 暂时保留给旧 API/UI。所有旧写入会在 repository 边界同步到 `lifecycle`；后续 LangGraph 节点应直接写 canonical lifecycle，再投影为旧字段。

## ID 语义

任务的 `correlation` 固定包含：

- `sessionId`：对话和 UI 上下文，不作为 LangGraph thread ID。
- `workflowRunId`：一次计划/执行工作流，对应未来的 LangGraph `thread_id`。
- `taskId`：工作流内任务 ID。
- `parentTaskId`：派生任务的父任务。
- `invocationId`：一次 Agent/Reviewer 调用。
- `clientRunId`：浏览器流式请求关联 ID，只负责传输层取消和重连。

业务任务仍由 `myteam.sqlite` 保存。未来的 LangGraph checkpointer 只保存执行快照，不能替代任务、会话、审批和产物表。

## 恢复与幂等

- 服务启动时，持久化为 `running` 的任务转成 `interrupted`，旧字段投影为可再次派发的 `pending`。
- 状态事件可以携带 `eventId`；相同事件重复提交不会再次增加 lifecycle revision。
- `interrupt` 节点之前不得直接执行 CLI、文件写入或审批写入。副作用必须在 P1 抽成可幂等的 task/adapter。

## P0 边界

P0 已统一状态、恢复和关联 ID，但没有改变 HTTP/SSE 协议，也没有引入 LangGraph 依赖。P1 将从 `server.mjs` 抽出 AgentExecutor、TaskRepository、ApprovalGateway 和 EventSink。
