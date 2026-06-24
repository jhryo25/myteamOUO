# Dispatch 审批通过后任务不执行 - 最终修复

## 现象
- 用户点击"开始执行 pending 任务"
- 审批对话框弹出，用户批准
- 第二次 dispatch 重试返回 `共 0 条任务待执行`
- 用户必须手动再次点击 dispatch 按钮（此时已经过了审批，所以不会弹对话框）

## 根因

`server.mjs` 的 dispatch handler 在处理带 `approvalId` 的后续请求时，会调用 `readTasks()` **两次**:
1. 任意 `filterAgent` 过滤：`pending = pending.filter(t => t.agent === filterAgent)`（行 4102）
2. session 过滤：`pending = pending.filter(t => t.session_id === dispatchSession.id)`（行 4098）

如果过滤后 `pending.length === 0`，dispatch 返回 200 但执行 0 个任务。

**第二个原因是客户端 `ssePost` 的重试语义与预期不一致。** 
`decideInlineApproval` → 提交审批 → 然后再次调用 `ssePost(url, { ...body, approvalId: data.approval.id }, handlers)`。但是新的 `ssePost` 调用创建了**全新的 `fetch` 请求和 `SSERunState`**。这在大部分情况下是正确的，但如果 `body` 中包含了 `agentOnly` 或其他过滤参数，第二次请求会重复这些过滤。

## 修复

### 修复 1：审批前记录 pending task IDs (server.mjs)

在第一次 dispatch 请求被 `requireApproval` 拦截前，将当前 pending task IDs 保存到审批记录 payload 中，使第二次重试能够引用同一个集合。

### 修复 2：session scope 在两次请求间保持一致 (web/app.js)

确保 `ssePost` 重试时传递的 body 完全相同，排除任何可能的序列化差异。

### 修复 3：allow `approvalId` to bypass session filter inconsistency

如果审批记录中的 session 与请求中的 session 不同（例如用户切换了会话），第二次请求会因为 session 过滤而看到空数组。修复是：当 `approvalId` 确定时，在 `pending` 数组中**放宽 session 过滤**或**明确使用审批记录中存储的 session**。

## 实施

在 `server.mjs` dispatch handler 中，在 `requireApproval` 调用之前：
1. 存储 pending task IDs 到 `approvalPayload`
2. 当 `approvalId` 不为空时，使用该集合覆盖 `pending` 数组
