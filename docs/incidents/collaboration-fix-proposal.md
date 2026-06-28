# myteamOUO 协作任务中断恢复修复提案

## 问题概述

**现象 1**：`invalid task lifecycle transition: rework -> reviewing`
- 出现在 LangGraph dispatch 运行过程中，reviewer 判定任务需要返工后，workflow 节点尝试将任务从 `rework` 状态推进到 `reviewing` 状态时，状态机拒绝此转换。

**现象 2**：恢复后协作任务中断，无法继续完整的协作流程
- 当前 dispatch workflow 被 lifecycle 状态错误阻断后，剩余任务队列无法继续执行。
- 需要手动从任务面板重新派发被阻塞的任务。
- 如果在 `human_gate` 或 `clarify` 中断点暂停后，服务重启导致 adapter 丢失，resume 无法正常工作。

## 根因分析

### 根因 1：Reviewer rework verdict 写入后 lifecycle.state 不同步

`runAutoReview()` 函数（server.mjs ~4175）在 reviewer 返回 `rework` 时：
1. 通过 `patchTask()` 写入旧版字段（`review_status: 'rework'`, `phase: 'impl'`）
2. 但 `patchTask()` 内部调用的是 `synchronizeTaskRecord()`，不是 `transitionTaskLifecycle()`
3. `synchronizeTaskRecord()` **不会记录** lifecycle.state 的转换
4. 这意味着在 SQLite 中：
   - `phase: 'impl'`（旧字段）
   - `lifecycle.state: 'reviewing'`（未变）
5. 当 LangGraph 的 `rework` 节点尝试 `ports.transitionTask(task, 'rework')`：
   - `transitionTaskLifecycle()` 读出 `lifecycle.state = 'reviewing'`
   - `TASK_TRANSITIONS['reviewing']` 包含 `'rework'` → 转换成功 ✅
   - rework 节点完成后 → `lifecycle.state = 'rework'`
6. 下一次执行时，`execute` 节点尝试 `ports.transitionTask(task, 'running')`：
   - `TASK_TRANSITIONS['rework']` 包含 `'running'` → 转换成功 ✅
7. 但如果任务经历了中断恢复、手动重跑等路径：
   - `lifecycle.state` 可能被某处设置为 `rework` 但没有后续转换
   - 再次 dispatch 时，LangGraph 的 `rework` 节点尝试 `rework → running → reviewing`
   - 如果中间某步失败，状态残留在 `rework`
   - 下一次 `rework` 节点调用 `ports.transitionTask(task, 'rework')`：
     - 状态机检测 `lifecycle.state = 'rework'`，目标也是 `rework`
     - 如果 reworkAttempts 未超限，图会**再次**进入 rework
     - 但如果 execute 节点的 `review_only_pending` 分支被触发，状态是 `rework`，目标却是 `reviewing`
     - **`TASK_TRANSITIONS['rework']` 之前不包含 `'reviewing'`** → 💥 抛错！

### 根因 2：Dispatch 清理不完整，残留状态阻塞后续执行

`activeDispatches.delete(dispatchLockId)` 只在 `/api/dispatch` 的 `finally` 块中执行（行 4842）。
但如果 `engine.run()` 因 lifecycle 异常而崩溃，以下状态可能残留在：

1. **前端** `sessionRuns` Map：`ssePost` 的请求被中断，`sessionRuns` 中的运行记录未清理
2. **前端** `dispatchBtn.disabled = true`：按钮从未恢复可用
3. **服务端** `activeChildren` Map：CLI 进程可能已被 watchdog 清理，但 Map 条目未删
4. **LangGraph checkpoint**：图状态停留在错误节点，下次从同一 checkpoint 恢复会再次进入同一错误节点

### 根因 3：Reviewer 重新读取导致状态不一致

`ports.transitionTask` 的实现（两处）从 SQLite 重新读取任务：
```javascript
const latest = readTasks().find((item) => item.id === task.id) || task;
```

如果 HTTP API 路径（如 human gate 手动操作）已修改了 SQLite 中的任务状态，
但图节点传入的 `state.currentTask` 持有旧的 `lifecycle.state`，
重新读取会导致状态混乱。

## 已应用的修复（Commit 491750a）

### 修复 1：TASK_TRANSITIONS 放行 rework → reviewing

`workflow-state.mjs:48`
```
rework: Set(['waiting_input', 'running', 'reviewing', 'failed', 'cancelled'])
```

### 修复 2：rework 节点入口状态对齐

`workflow/dispatch-graph.mjs` `rework` 节点：检查 `lifecycle.state`，非标准状态先走 `running → reviewing` 对齐。

### 修复 3：ports.transitionTask 信任 graph state

`server.mjs` 两处 `ports.transitionTask`：graph state 中的 `lifecycle.state` 优先于 SQLite 读取。

### 修复 4（本次）：Reviewer rework 时显式同步 lifecycle

`runAutoReview()`：返回 `rework` 时调用 `transitionTaskLifecycle(task, 'rework', {...})` 确保 lifecycle.state 同步更新。

## 仍需改进的恢复能力

### 建议 1：Dispatch 失败时自动清理前端运行状态

`ssePost` 在收到 `'error'` SSE 事件时应自动重置 `sessionRuns` 和按钮状态。
当前 `error` handler 只是显示错误消息，没有清理运行状态。

### 建议 2：Workflow fail-safe：异常节点自动向前跳转

在 dispatch graph 的 `execute` / `review_task` 节点外层增加 try-catch，
当捕获 lifecycle 异常时自动将任务标记为 `failed` 并继续处理剩余任务。

### 建议 3：端到端协作流程测试

编写真实的 CLI agent 端到端测试：
- 验证 "plan → dispatch → execute → review → rework → execute → pass → complete" 全流程
- 验证中断恢复后从 checkpoint 继续执行
- 验证服务重启后 adapter descriptor 重建成功

## 验证状态

- `npm run check` ✅
- 核心单元测试 59/59 通过 ✅
- 端到端协作流程测试：❌ 未覆盖（需真实 CLI agent）
