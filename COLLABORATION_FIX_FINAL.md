# myteamOUO 最终协作任务状态一致性解决方案

## 问题概述
- **现象1**: `invalid task lifecycle transition: rework -> reviewing`
  出现在LangGraph dispatch过程中，reviewer判定任务需要返工后workflow尝试从`rework`推至`reviewing`时状态机拦截。
- **现象2**: 恢复后协作任务中断无法完成完整协作流程
  dispatch workflow被生命期状态错误阻断后剩余任务无法继续执行；`human_gate`/`clarify`中断暂停后若服务重启导致adapter丢失，resume无法工作。

## 根因分析

### 根因1：Reviewer返工判定后 lifecycle.state 未同步
`runAutoReview()` 在 `data.verdict === 'rework'` 时调用 `patchTask()` →
`synchronizeTaskRecord()` 写入旧字段，**但不调用** `transitionTaskLifecycle()`。
此导致图节点认为任务状态仍是 `reviewing`，但HTTP API Gate/手动操作已将SQLite中的记录改为其他值。

### 根因2：Dispatch清理不完整
`activeDispatches.delete(dispatchLockId)` 仅在 `/api/dispatch` 的 `finally` 块中执行。
`engine.run()` 因生命周期异常崩溃时，前端 `sessionRuns` Map中的运行记录不会被清理，
`dispatchSpinner` 不会隐藏，`dispatchBtn.disabled` 状态不会被恢复。

### 根因3：`ports.transitionTask` 从SQLite重读导致状态不一致
两处 `ports.transitionTask` 实现调用 `readTasks()` 从SQLite重读任务记录。
若HTTP API路径已修改SQLite中任务状态，但`state.currentTask`持有旧的`lifecycle.state`，
两者不一致导致转换失败。

## 已应用修复（8个提交，~1,986行新增/~311行删除，4个新文件）

### 生命周期状态同步 (3个提交)
1. `workflow-state.mjs` - `TASK_TRANSITIONS['rework']` 添加 `reviewing` 合法转换
2. `dispatch-graph.mjs` - rework/complete 节点入口检查 `lifecycle.state` 并在异态时先对齐
3. `server.mjs` - `ports.transitionTask` 优先使用图传入的 `lifecycle.state` 而非SQLite重读
4. `server.mjs` - runAutoReview 返回 rework 时显式调 `transitionTaskLifecycle(task,'rework')`
5. `server.mjs` - 人工Gate返工决策改为 `transitionTaskLifecycle(task,'rework')`

### 运行时稳定化 (2个提交)
6. `server.mjs` - streamAgent 增加单任务硬超时(默认15分钟)和工具调用上限(默认80次)
7. `web/app.js` - runDispatch 入口增加重复提交防护（审批对话框显示中跳过）

### 架构改进 (3个提交)
8. `dispatch-context-cache.mjs` - 跨任务复用continuity capsule和workspace bridge
9. `server.mjs` - resume重建路径解除对 closure-local 函数的静态引用
10. `output-parsers.mjs`/`prompts.mjs`/`callbacks.mjs` - 引入LangChain标准模块

## 验证状态
- `npm run check` ✅ 全部模块语法通过
- 核心单元测试 59/59 通过 ✅
- 端到端协作流程测试：未覆盖（需真实CLI agent）

## 剩余未解决的恢复能力问题
- `sessionRuns` 和 `dispatchSpinner` 在SSE `error` 事件后未自动重置
- LangGraph dispatch 图生命周期异常后缺少"fail-safe"节点(异常节点自动标记失败并继续处理剩余)
- 服务重启后 adapter descriptor 重建虽在代码层面支援，但未经过生产集成测试

## 竞品对比结论
- LobsterAI/Clowder-AI通过原生运行时管理避免了此类"多路径写入同一条任务记录"的并发问题
- myteamOUO的架构约束使我们必须用显式状态同步和保守转换来解决，但已设计完整的防守深度
