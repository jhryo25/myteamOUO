# LangGraph 重构 P1–P4 实现说明

## 结论

P1–P4 已落成一条共享的 LangGraph 编排链。浏览器 `/api/dispatch` 与 CLI `dispatch.mjs` 不再各自维护任务循环；Chat、Plan 和 Schedule 也通过统一的 checkpointed turn graph 执行。业务 Task、Session、Approval 与 Artifact 仍保存在 `.myteam/myteam.sqlite`，LangGraph 快照独立保存在 `.myteam/langgraph.sqlite`。

## P1：边界与共享引擎

- `workflow/ports.mjs` 定义执行、审查、状态转换、派生任务、澄清、事件和完成回调端口。
- `workflow/dispatch-graph.mjs` 成为浏览器与 CLI 共用的 dispatch engine。
- CLI 调用和现有服务实现保留为 adapter；图只接收结构化输入，不直接依赖 HTTP response、子进程或业务 SQLite。
- P0 的 canonical lifecycle 与 correlation ID 继续作为业务状态契约，`workflowRunId` 映射 LangGraph `thread_id`。

## P2：checkpoint、interrupt 与恢复

- `workflow/checkpointer.mjs` 使用 `SqliteSaver`，默认数据库为 `.myteam/langgraph.sqlite`。
- 澄清问题和人工 Reviewer Gate 使用 LangGraph `interrupt()`；恢复使用 `Command({ resume })`。
- `GET /api/workflows/:workflowRunId` 查询 checkpoint 状态。
- `POST /api/workflows/:workflowRunId/resume` 恢复当前进程中暂停的工作流。
- 单测覆盖“恢复不重复执行 interrupt 之前的 Agent/Reviewer 副作用”和“用新 engine 实例从同一 SQLite checkpoint 恢复”。

## P3：多任务、返工与派生子任务

父图负责：

```text
initialize → select_task → clarify? → task subgraph
           → enqueue_spawns → advance → select_task → finish
```

Task subgraph 负责：

```text
execute → review → human_gate? → complete
                    └─ rework → execute（有上限）
```

- 支持顺序消费多任务队列。
- `<spawn_subagent>` 结果由父图物化并追加到队列，保留父任务与工作流关联。
- 返工由 `maxReworkAttempts` 限制，派生深度由 `maxSpawnDepth` 限制。
- 图事件继续映射到现有 SSE；新增 `workflow-start`、`workflow-interrupt` 与 `paused`。

## P4：其他入口统一

- `workflow/turn-graph.mjs` 为 Chat、Plan、Schedule 提供轻量 StateGraph。
- 三类入口使用独立 `workflowRunId` 和同一 SQLite checkpointer，CLI 调用细节仍由原 adapter 承担。
- 这样可以逐步在不改 HTTP/SSE 载荷的前提下增加节点、重试、观测和恢复策略。

## API 示例

Dispatch SSE 开始事件会返回工作流 ID：

```json
{"workflowRunId":"dispatch:...","engine":"langgraph"}
```

查询：

```http
GET /api/workflows/dispatch%3A...
```

恢复人工 Gate：

```http
POST /api/workflows/dispatch%3A.../resume
Content-Type: application/json

{"resume":{"verdict":"pass","comment":"人工验收通过"}}
```

恢复澄清：

```json
{"resume":{"answers":[{"question":"目标环境？","answer":"Windows"}]}}
```

## 状态与持久化边界

| 数据 | 权威存储 |
|---|---|
| Task、Session、Approval、Artifact、审计 | `.myteam/myteam.sqlite` |
| LangGraph channel、next node、interrupt、checkpoint | `.myteam/langgraph.sqlite` |
| SSE 请求与取消 | 内存中的 client run registry |

Checkpoint 不是业务数据库，也不替代任务生命周期写入。节点副作用必须经 ports 更新业务状态。

## 当前限制

SQLite checkpoint 能跨进程读取，图引擎也已验证能用新实例恢复；但服务端真实 CLI adapter 仍是请求期闭包。服务重启后查询 checkpoint 可用，HTTP 恢复执行会返回 `workflow_adapter_unavailable`，直到把 agent 配置、任务作用域与事件目标持久化为可重建 adapter 描述。当前进程内的人工暂停与恢复不受影响。

## 验证

- `npm run check`
- `npm test`：`96/96`
- 行为测试见 `tests/langgraph-workflow.test.mjs`：多任务与 spawn、受限返工、人工 Gate、澄清、SQLite 跨实例恢复、Chat/Plan/Schedule turn graph。
