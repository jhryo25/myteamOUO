# Dispatch 审批通过后任务不执行问题分析

## 现象

用户点击"开始执行 pending 任务"后：
1. 审批对话框 (dialog-overlay) 弹出
2. 用户选择"批准一次"或"本会话允许"
3. 服务器返回 202 (批准)
4. `ssePost` 调用 `decideInlineApproval()` → POST `/api/approvals/:id/decision`
5. `decideInlineApproval()` 返回 `true`
6. `ssePost` 再次调用 `ssePost(url, { ...body, approvalId }, handlers)` 进行实际 dispatch
7. **但是第二次请求仍然收到 `0 pending` 任务——因为任务状态从未变成 pending**

## 根因

在首次 dispatch 被 `requireApproval` 拦截返回 202 后，前端第二次 dispatch 带上了 `approvalId`。但是服务端在 dispatch handler 中始终调用 `readTasks()` 两次：
- 一次在 `scopedTasks`（行 4081，用于 clarification 检查）
- 一次在 `pending`（行 4096，用于实际的 pending 过滤）

当用户首次点击 (无 approvalId) 时，`pending` 数组中有 N 项。`requireApproval` 返回 202。
当 `ssePost` 重试带 `approvalId` 时，服务器再次调用 `readTasks()`。

**但是服务器返回的第一次 202 响应在 `requireApproval` 之前仍然读到了正确的 pending 数组。** 如果任务状态在两次请求之间被其他操作改变了（如 `loadTasks` 中的 filter），pending 数组会空。

### 可能的具体原因

1. **任务状态不是 `pending`**：拆任务后，任务状态可能被设置为 `waiting_input`（如果有 open_questions）而不是 `pending`。即使没有 open_questions，某个地方也可能把 status 设成了别的值。

2. **`session_id` 不匹配**：dispatch handler 中的 `dispatchSession` 和用户当前看到的 session 不是同一个。

3. **审批指纹 (fingerprint) 变更**：`authorizeOperation` 中的 `operationFingerprint` 在第二次请求时计算了同样的 hash，但如果 `payload` 中任何键值不同（如 selection 字符串、pendingCount），指纹会不匹配。`governance.mjs` 行 193-207 在指纹不匹配时返回 `consumed` 错误。

4. **审批范围 (scope) 限制**：用户选择"批准一次"后，审批被消费 (consumed)。如果由于某种原因第二次重试失败了（但 `ssePost` 不会再次重试），审批记录被消耗但没有执行任何任务。

## 修复方案

### 方案 A：在 dispatch handler 中记录第一次请求的 pending 列表（推荐）

在首次请求被审批拦截前，将 pending 任务 ID 列表保存到审批记录的 `payload` 中。第二次请求时从 `payload.taskIds` 恢复过滤条件。

### 方案 B：让 `ssePost` 在重试失败后重置审批状态

如果第二次请求（带 approvalId）返回 200 但响应中包含 `count: 0`，前端应提示用户"未找到可执行任务，请检查任务状态"。

### 方案 C：诊断当前问题的根因

最可能的原因是 **Plan 完成后任务 status 不是 `pending`**。在 server.mjs 的 `/api/plan` handler 中检查任务是如何被标记为 pending 的——可能是 `appendTask` 被调用但 `status: 'pending'` 没有正确设置。
