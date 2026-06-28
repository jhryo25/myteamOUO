# Plan 模式交互分析：任务列表 / 确认提示框 / Dispatch 按钮 同步弹出问题

## 现象
用户发起 "拆任务" (Plan) 后：
1. 任务卡片 (plan card) 在聊天区渲染
2. `clarificationTray`（确认提示框）同时在消息输入框上方弹出
3. `dispatchBtn`（执行 pending 任务按钮）也同时变亮启用
4. 用户不清楚应该点哪个：确认提示框里的"确认并继续执行"、plan card 里的"▶ 让 XXX 执行"、还是顶部的 dispatch 按钮

## 根因分析

### 时序追踪

```
doPlan(goal)                                   [web/app.js:2538]
  ├── ssePost('/api/plan', ...)                [line 2563]
  │     ├── SSE 事件流中收到 task-start, chunk, ...
  │     └── done: ({ runId, written, tasks })   [line 2574]
  │           ├── finishPlanProgress(...)
  │           ├── hideRunningPanel()
  │           ├── addPlanCard(goal, tasks)      ← ① 渲染任务卡片 (含"▶ 让 XXX 执行"按钮)
  │           └── (return)
  │
  └── (ssePost 完成后)
      ├── sendBtn.disabled = false
      └── await loadTasks()                     ← ② 拉取最新任务列表
            ├── filterAndRenderTasks()
            ├── renderClarificationTray(tasks)  ← ③ 渲染确认提示框
            └── dispatchBtn.disabled = hasClarifications || isRunning  ← ④ 决定 dispatch 按钮状态
```

**关键发现**：`addPlanCard()` 在 SSE 的 `done` 事件回调中被调用（步骤①），而 `renderClarificationTray()` 在随后的 `loadTasks()` 中被调用（步骤③）。
两者几乎同时出现在 UI 上，时间差 < 200ms（取决于 `/api/tasks` 网络延迟）。

### 三个入口互相竞争

| UI 元素 | 触发位置 | 条件 | 行为 |
|---------|---------|------|------|
| Plan 卡片中的 `▶ 让 XXX 执行` | `addPlanCard()` 内部 | Plan 返回了 tasks 且 agent 可用 | 直接调 `runDispatch({ agentOnly })`，跳过审批 |
| `clarificationTray` 的 `确认并继续执行` | `renderClarificationTray()` 内部 | 有 `open_questions` 非空的任务 | 提交答案后自动调 `runDispatch({ runId })` |
| `dispatchBtn` | `loadTasks()` 内部 | `hasPending && !hasClarifications` | 打开标准 dispatch 流程（含审批） |

### 冲突场景

1. **Plan 生成有 `open_questions` 的任务**：
   - `addPlanCard()` 仍然渲染了"▶ 让 XXX 执行"按钮
   - `renderClarificationTray()` 也同时弹出确认提示框
   - 用户点击 plan 卡中的执行按钮 → 立即 dispatch → 服务端返回 409 `clarification_required`
   - 用户看到错误消息但不知道为什么

2. **Plan 生成无 `open_questions` 的任务**：
   - `addPlanCard()` 渲染执行按钮
   - `dispatchBtn` 显示为可用
   - `clarificationTray` 不显示
   - 三个入口变成一个，但 plan 卡片中的"▶ 让 XXX 执行"和顶部 dispatch 按钮功能重叠

3. **用户点击 plan 卡片中的执行按钮时绕过审批**：
   - `plan-suggest-btn[data-agent]` 直接调 `runDispatch({ agentOnly })` （行 930-932）
   - `runDispatch` 会调用 `ssePost('/api/dispatch', body)`
   - `ssePost` 会触发审批流程（从 `governance.mjs` → `requireApproval`）
   - 但 plan 卡片的执行按钮在视觉上没有"审批确认"的提示，用户不知道会弹出审批对话框

## 核心问题

**`addPlanCard()` 在 `loadTasks()` 之前执行，导致 plan 卡片渲染时还没有 `clarificationTray` 和 `dispatchBtn` 的最终状态。** 当 `loadTasks()` 完成时，三个 UI 元素同时出现，争夺用户的注意力。

## 修复方案

### 方案 A：顺序化渲染（低风险，推荐）

在 `loadTasks()` 完成前隐藏 plan 卡片中的执行按钮，等 `loadTasks()` 完成后一次性显示正确状态：

```javascript
// doPlan > done handler:
done: ({ runId, written, tasks }) => {
  finishPlanProgress(tasks?.length || written || 0);
  hideRunningPanel();
  if (tasks && tasks.length) {
    addPlanCard(goal, tasks, { pending: true }); // 先隐藏执行按钮
  }
}

// doPlan 末尾:
sendBtn.disabled = false;
await loadTasks();  // 这个会 renderClarificationTray 和 update dispatchBtn
// 然后批量更新 plan 卡片中的按钮状态
updatePlanCardActions(); // 根据 hasClarifications/hasPending 决定显示哪些按钮
```

### 方案 B：合并入口（中风险）

只保留一个执行入口：
- 如果 `clarificationTray` 显示 → 只允许"确认并继续执行"
- 如果有 pending 无 clarification → 只允许 dispatch 按钮
- Plan 卡片去掉独立的执行按钮，改为显示"查看详情"引导用户到任务面板

### 方案 C：延迟 plan 卡片按钮（最简单的快速修复）

在 `addPlanCard()` 中，将执行按钮初始设为 `disabled`，然后在下一次 `loadTasks()` 完成后由 `updatePlanCardActions()` 统一启用/禁用/隐藏：

```javascript
// addPlanCard > plan-suggest-btn[data-agent]:
btn.disabled = hasClarifications || isCurrentSessionRunning();
```

## 建议

采用**方案 A**——在两个宏任务（SSE done 回调 vs loadTasks）之间添加协调点。改动最小，且不需要重构现有的三个执行入口。

具体步骤：
1. `addPlanCard()` 接收 `options` 参数，`{ pending: true }` 时隐藏执行按钮
2. `loadTasks()` 末尾检查是否有未激活的 plan 卡片，调用 `updatePlanCardActions()`
3. `updatePlanCardActions()` 读取当前 `hasClarifications` / `hasPending` 状态，决定各按钮的 disabled 属性
