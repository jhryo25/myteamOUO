// ── 结构化气泡：plan 任务列表 ─────────────────────────────────
function renderPlanTaskDetail(task) {
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const sections = [];
  if (steps.length) sections.push(`<div class="plan-detail-section"><span>实施步骤</span><ol>${steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol></div>`);
  if (task.tradeoff) sections.push(`<div class="plan-detail-section"><span>取舍</span><p>${esc(task.tradeoff)}</p></div>`);
  if (task.accept) sections.push(`<div class="plan-detail-section plan-detail-accept"><span>验收标准</span><p>${esc(task.accept)}</p></div>`);
  return sections.join('');
}

function renderPlanTaskRow(task, index, agentControl, { open = false } = {}) {
  const steps = Array.isArray(task.steps) ? task.steps : [];
  return `<details class="plan-task-row" data-task-id="${esc(task.id || '')}" data-agent="${esc(task.agent || '')}" ${open ? 'open' : ''}>
    <summary class="plan-task-summary">
      <span class="plan-task-num">${index + 1}</span>
      <div class="plan-task-body">
        <div class="plan-task-name">${esc(task.title)}</div>
        <div class="plan-task-meta">
          ${agentControl}
          ${steps.length ? `<span>${steps.length} 步</span>` : ''}
        </div>
        ${task.why ? `<div class="plan-task-why">${esc(task.why)}</div>` : ''}
      </div>
      <span class="plan-task-chevron" aria-hidden="true">›</span>
    </summary>
    <div class="plan-task-details">${renderPlanTaskDetail(task)}</div>
  </details>`;
}

function addPlanCard(goal, tasks, opts = {}) {
  const { deferActions = false } = opts;
  hideWelcome();
  // 可用 agent 列表（用于下拉）
  const availableAgents = (window.agentConfigList || mentionAgents)
    .filter(a => a.available !== false);
  const agentOptions = availableAgents.map(a =>
    `<option value="${esc(a.key)}">${esc(a.label || a.key)}</option>`
  ).join('');

  const rows = tasks.map((t, i) => {
    // agent 下拉：默认选中 plan 推荐的 agent，若不可用则保留显示但标记
    const selectedAgent = t.agent || '';
    const isAvailable = availableAgents.some(a => a.key === selectedAgent);
    const selectHtml = `<select class="plan-task-agent-select" data-task-id="${esc(t.id)}" title="修改执行 agent">
      ${agentOptions}
      ${!isAvailable && selectedAgent ? `<option value="${esc(selectedAgent)}" disabled>${esc(selectedAgent)}（不可用）</option>` : ''}
    </select>`;
    // 设置 selected 需要在 DOM 后操作，先用 data 属性传递
    return renderPlanTaskRow(t, i, selectHtml, { open: i === 0 });
  }).join('');

  // 统计各 agent 的 pending 任务数，只生成可用 agent 的建议按钮
  const agentCounts = {};
  tasks.forEach(t => { agentCounts[t.agent] = (agentCounts[t.agent] || 0) + 1; });
  const availableKeys = new Set(availableAgents.map(a => a.key));
  const suggestionBtns = Object.entries(agentCounts)
    .filter(([agent]) => availableKeys.has(agent))
    .map(([agent, cnt]) =>
      deferActions
        ? `<button class="plan-suggest-btn" data-agent="${esc(agent)}" disabled title="任务列表即将加载完成...">▶ 让 ${esc(agent)} 执行 (${cnt} 条)</button>`
        : `<button class="plan-suggest-btn" data-agent="${esc(agent)}">▶ 让 ${esc(agent)} 执行 (${cnt} 条)</button>`
    ).join('');

  const row = document.createElement('div');
  row.className = 'bubble-row';
  row.innerHTML = `
    <div class="avatar system-av">📋</div>
    <div class="plan-card">
      <div class="plan-card-header">
        <div><span class="plan-card-kicker">执行计划</span><div class="plan-card-title">${esc(goal)}</div></div>
        <span class="plan-card-count">${tasks.length} 个任务</span>
      </div>
      ${rows}
      <div class="plan-suggest-row">
        <span class="plan-suggest-label">建议执行方式：</span>
        ${suggestionBtns}
        <button class="plan-suggest-btn plan-suggest-manual" ${deferActions ? 'disabled' : ''}>手动选择任务</button>
      </div>
    </div>`;

  // 初始化各下拉的 selected 值
  row.querySelectorAll('.plan-task-row[data-agent]').forEach(taskRow => {
    const sel = taskRow.querySelector('.plan-task-agent-select');
    if (sel) sel.value = taskRow.dataset.agent;
  });

  // 下拉修改 agent → PATCH 到后端
  row.querySelectorAll('.plan-task-agent-select').forEach(sel => {
    sel.onclick = event => event.stopPropagation();
    sel.onchange = async () => {
      const taskId = sel.dataset.taskId;
      const newAgent = sel.value;
      const taskRow = sel.closest('.plan-task-row');
      const previousAgent = taskRow?.dataset.agent || tasks.find(task => task.id === taskId)?.agent || '';
      sel.disabled = true;
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/agent`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent: newAgent }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);

        // 计划卡、任务抽屉共享同一份最新数据，避免 PATCH 成功后任务列表仍显示旧 agent。
        const planTask = tasks.find(task => task.id === taskId);
        if (planTask) planTask.agent = data.task.agent;
        const cachedTask = allTasks.find(task => task.id === taskId);
        if (cachedTask) cachedTask.agent = data.task.agent;
        if (taskRow) taskRow.dataset.agent = data.task.agent;
        filterAndRenderTasks();
      } catch (e) {
        sel.value = previousAgent;
        addSystemMsg(`修改 agent 失败：${e.message}`);
      } finally {
        sel.disabled = false;
      }
    };
  });

  // 按 agent 执行：dispatch 时只跑对应 agent 的 pending
  row.querySelectorAll('.plan-suggest-btn[data-agent]').forEach(btn => {
    btn.onclick = () => {
      runDispatch({ agentOnly: btn.dataset.agent });
    };
  });
  // 手动：展开任务面板
  row.querySelector('.plan-suggest-manual').onclick = () => {
    document.getElementById('tasksExpandBtn').click();
  };

  chatEl.appendChild(row);
  scrollChat();
}

// ── 结构化气泡：dispatch 结果摘要 ─────────────────────────────
function addResultCard(title, agent, summary, ok) {
  hideWelcome();
  const row = document.createElement('div');
  row.className = 'bubble-row';
  row.innerHTML = `
    <div class="avatar ${ok ? 'system-av' : 'system-av'}">${ok ? '✅' : '❌'}</div>
    <div class="result-card">
      <div class="result-card-header ${ok ? 'ok' : 'fail'}">
        ${ok ? '✓' : '✗'} ${esc(title)}
        <span class="plan-task-agent">${esc(agent)}</span>
      </div>
      ${summary ? `<div class="result-card-summary">${esc(summary)}</div>` : ''}
    </div>`;
  chatEl.appendChild(row);
  scrollChat();
}

const WORKFLOW_SESSION_KEY = 'myteam.workflowBySession';
const workflowViewState = new Map();

function readWorkflowSessionMap() {
  try { return JSON.parse(localStorage.getItem(WORKFLOW_SESSION_KEY) || '{}') || {}; }
  catch { return {}; }
}

function rememberSessionWorkflow(sessionId, workflowRunId) {
  if (!sessionId || !workflowRunId) return;
  const entries = readWorkflowSessionMap();
  entries[sessionId] = workflowRunId;
  localStorage.setItem(WORKFLOW_SESSION_KEY, JSON.stringify(entries));
}

function rememberedSessionWorkflow(sessionId = currentSessionId) {
  return sessionId ? String(readWorkflowSessionMap()[sessionId] || '') : '';
}

function workflowInterruptValue(interrupts = []) {
  const interrupt = Array.isArray(interrupts) ? interrupts[0] : null;
  return interrupt?.value || interrupt || null;
}

function normalizeWorkflowView(input = {}) {
  const previous = workflowViewState.get(input.workflowRunId || input.checkpoint?.threadId || '') || {};
  const values = input.values || previous.values || {};
  const interrupts = input.interrupts ?? previous.interrupts ?? [];
  const interrupt = workflowInterruptValue(interrupts);
  const workflowRunId = String(input.workflowRunId || values.workflowRunId || input.checkpoint?.threadId || previous.workflowRunId || '');
  const failedTaskIds = input.failedTaskIds || values.failedTaskIds || previous.failedTaskIds || [];
  const completedTaskIds = input.completedTaskIds || values.completedTaskIds || previous.completedTaskIds || [];
  const failedTasks = input.failedTasks || previous.failedTasks
    || (values.tasks || []).filter(task => failedTaskIds.map(String).includes(String(task.id)));
  const failedTask = failedTasks.find(task => task.status === 'failed' || ['failed', 'agent_repair_pending'].includes(task.review_status))
    || failedTasks[0]
    || null;
  const currentTask = input.task || input.currentTask || interrupt?.task || values.currentTask || failedTask || previous.currentTask || null;
  const explicitStatus = String(input.status || values.status || previous.status || 'running');
  const terminalStatus = ['completed', 'completed_with_errors', 'failed', 'error', 'adapter_unavailable', 'cancelled'].includes(explicitStatus);
  const live = terminalStatus ? { ...(input.live || previous.live || {}), active: false } : (input.live || previous.live || null);
  const status = interrupts.length
    ? 'interrupted'
    : live?.active && !terminalStatus
      ? 'running'
      : explicitStatus;
  return {
    ...previous,
    ...input,
    workflowRunId,
    values,
    status,
    interrupts,
    interrupt,
    currentTask,
    live,
    error: input.error ?? currentTask?.error ?? previous.error ?? '',
    failedTaskIds: [...new Set(failedTaskIds.map(String))],
    failedTasks,
    completedTaskIds: [...new Set(completedTaskIds.map(String))],
    done: Number(input.done ?? completedTaskIds.length ?? previous.done ?? 0),
    failed: Number(input.failed ?? failedTaskIds.length ?? previous.failed ?? 0),
    next: input.next || previous.next || [],
    checkpoint: input.checkpoint || previous.checkpoint || null,
  };
}

function workflowStatusCopy(view) {
  if (view.status === 'interrupted') return { tone: 'paused', icon: 'Ⅱ', label: '等待你的操作', title: '工作流已暂停' };
  if (['completed_with_errors', 'failed', 'error', 'adapter_unavailable'].includes(view.status) || view.failed > 0) {
    return { tone: 'failed', icon: '!', label: '存在失败节点', title: '工作流需要处理' };
  }
  if (view.status === 'completed') return { tone: 'completed', icon: '✓', label: 'Checkpoint 已完成', title: '工作流执行完成' };
  return { tone: 'running', icon: '↻', label: 'Checkpoint 运行中', title: 'LangGraph 工作流' };
}

function workflowQuestionText(question) {
  return typeof question === 'string' ? question : String(question?.question || question?.text || '请补充信息');
}

function workflowCheckpointMeta(view) {
  const node = view.next?.length
    ? view.next.join(' → ')
    : view.status === 'completed'
      ? 'END'
      : (view.failed > 0 || view.failedTaskIds.length ? 'FAILED' : '等待恢复');
  const step = Number.isFinite(view.checkpoint?.step) ? `step ${view.checkpoint.step}` : 'step —';
  const saved = view.checkpoint?.createdAt ? new Date(view.checkpoint.createdAt).toLocaleString() : '刚刚同步';
  return { node, step, saved };
}

function renderWorkflowCard(input = {}) {
  const view = normalizeWorkflowView(input);
  if (!view.workflowRunId || (currentSessionId && input.sessionId && input.sessionId !== currentSessionId)) return null;
  workflowViewState.set(view.workflowRunId, view);
  rememberSessionWorkflow(currentSessionId, view.workflowRunId);
  hideWelcome();

  chatEl.querySelectorAll('.workflow-card').forEach(card => {
    if (card.dataset.workflowId !== view.workflowRunId) card.remove();
  });
  let row = chatEl.querySelector(`.workflow-card[data-workflow-id="${CSS.escape(view.workflowRunId)}"]`);
  if (!row) {
    row = document.createElement('section');
    row.className = 'workflow-card';
    row.dataset.workflowId = view.workflowRunId;
    chatEl.appendChild(row);
  }

  const copy = workflowStatusCopy(view);
  const meta = workflowCheckpointMeta(view);
  const taskTitle = view.currentTask?.title || view.currentTask?.id || '等待选择任务';
  const interruptKind = view.interrupt?.kind || '';
  const questions = Array.isArray(view.interrupt?.questions) ? view.interrupt.questions : [];
  const review = view.interrupt?.review || view.values?.review || null;
  const retryCandidates = view.failedTasks?.length
    ? view.failedTasks
    : (['failed', 'error', 'adapter_unavailable'].includes(view.status) && view.currentTask?.id ? [view.currentTask] : []);

  const clarificationMarkup = interruptKind === 'clarification'
    ? `<div class="workflow-questions">${questions.map((question, index) => `
        <label><span>${esc(workflowQuestionText(question))}</span><input data-workflow-answer="${index}" data-question="${esc(workflowQuestionText(question))}" placeholder="输入后继续"></label>`).join('')}</div>`
    : '';
  const reviewMarkup = interruptKind === 'human_gate'
    ? `<div class="workflow-review">
        <span>Reviewer：${esc(review?.reviewer || '自动审查')}</span>
        <strong>${esc(review?.verdict === 'pass' ? '建议通过' : review?.verdict || '等待人工确认')}</strong>
        ${review?.suggestion ? `<p>${esc(review.suggestion)}</p>` : ''}
        <textarea class="workflow-comment" rows="2" placeholder="可选：补充通过说明或返工要求"></textarea>
      </div>`
    : '';
  const pausedActions = interruptKind === 'human_gate'
    ? `<button class="workflow-action primary" data-workflow-action="pass">通过并继续</button><button class="workflow-action" data-workflow-action="rework">要求返工</button>`
    : interruptKind === 'clarification'
      ? `<button class="workflow-action primary" data-workflow-action="clarify">提交信息并继续</button>`
      : '';
  const retryRows = retryCandidates.map(task => {
    const reviewOnly = (task.failure_stage === 'review' || task.review_only_pending) && task.previous_result;
    const scope = reviewOnly ? 'review' : 'execute';
    const actionable = task.status === 'failed' || ['failed', 'agent_repair_pending'].includes(task.review_status);
    const canRetry = actionable && task.retryable !== false;
    const stateText = !actionable ? '已重置，等待执行' : reviewOnly ? 'Agent 结果已保留' : 'Agent 执行失败';
    return `<div class="workflow-failure-row">
      <div><strong>${esc(task.title || task.id)}</strong><span>${esc(stateText)}${task.error ? ` · ${task.error}` : ''}</span></div>
      ${canRetry ? `<button class="workflow-action danger" data-workflow-action="retry" data-retry-scope="${scope}" data-task-ids="${esc(String(task.id))}">${reviewOnly ? '只重试 Reviewer' : '重试 Agent'}</button>` : `<em>${actionable ? '不可自动重试' : '无需重试'}</em>`}
    </div>`;
  }).join('');
  const retryPanel = retryRows
    ? `<div class="workflow-failures"><div class="workflow-failures-title">失败节点处理 <span>逐项判断，不会一键重跑全部任务</span></div>${retryRows}</div>`
    : '';
  const liveText = view.live?.statusText || view.activityText || '';
  const liveMarkup = view.status === 'running'
    ? `<div class="workflow-live"><span class="workflow-live-dot"></span><div><strong>${esc(liveText || '工作流正在运行')}</strong><small>${esc(view.live?.agent ? `${view.live.agent} · ${view.live.phase || 'working'}` : (view.phase || 'LangGraph 正在切换节点'))}</small></div></div>`
    : '';

  row.className = `workflow-card ${copy.tone}`;
  row.innerHTML = `
    <div class="workflow-card-icon" aria-hidden="true">${copy.icon}</div>
    <div class="workflow-card-main">
      <div class="workflow-card-head"><strong>${copy.title}</strong><span class="workflow-status">${copy.label}</span></div>
      <div class="workflow-current"><span>当前节点</span><b>${esc(meta.node)}</b><em>${esc(taskTitle)}</em></div>
      ${liveMarkup}
      ${view.error ? `<div class="workflow-error">${esc(view.error)}</div>` : ''}
      ${reviewMarkup}${clarificationMarkup}${retryPanel}
      <details class="workflow-checkpoint">
        <summary>Checkpoint 状态</summary>
        <div class="workflow-checkpoint-grid">
          <span>完成 <b>${view.done}</b></span><span>失败 <b>${view.failed}</b></span><span>${esc(meta.step)}</span><span>${esc(meta.saved)}</span>
        </div>
        <code title="${esc(view.workflowRunId)}">${esc(view.workflowRunId)}</code>
      </details>
      <div class="workflow-actions">${pausedActions}<button class="workflow-action quiet" data-workflow-action="refresh">刷新状态</button></div>
    </div>`;

  row.querySelectorAll('[data-workflow-action]').forEach(button => {
    button.onclick = async () => {
      const action = button.dataset.workflowAction;
      const setBusy = busy => row.querySelectorAll('button, input, textarea').forEach(control => { control.disabled = busy; });
      setBusy(true);
      try {
        if (action === 'refresh') await refreshWorkflowCard(view.workflowRunId);
        if (action === 'pass' || action === 'rework') {
          const comment = row.querySelector('.workflow-comment')?.value.trim() || '';
          await runDispatch({ resumeWorkflowId: view.workflowRunId, resumeValue: { decision: action, comment } });
        }
        if (action === 'clarify') {
          const answers = [...row.querySelectorAll('[data-workflow-answer]')].map(input => ({
            question: input.dataset.question,
            answer: input.value.trim(),
          }));
          if (answers.some(item => !item.answer)) throw new Error('请先填写全部待确认信息');
          await runDispatch({ resumeWorkflowId: view.workflowRunId, resumeValue: { answers } });
        }
        if (action === 'retry') await retryWorkflowTasks(view, button.dataset.taskIds.split(',').filter(Boolean), button.dataset.retryScope || 'execute');
      } catch (error) {
        showToast(error.message || '工作流操作失败', 'error');
      } finally {
        if (row.isConnected) setBusy(false);
      }
    };
  });
  scrollChat();
  return row;
}

async function refreshWorkflowCard(workflowRunId, { quiet = false } = {}) {
  if (!workflowRunId) return null;
  try {
    const response = await fetch(`/api/workflows/${encodeURIComponent(workflowRunId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Checkpoint 读取失败 (${response.status})`);
    return renderWorkflowCard({ ...data, workflowRunId });
  } catch (error) {
    if (!quiet) showToast(error.message, 'error');
    return null;
  }
}

async function restoreWorkflowCard(sessionId = currentSessionId) {
  const linkedWorkflowId = new URLSearchParams(location.search).get('workflow') || '';
  const workflowRunId = linkedWorkflowId || rememberedSessionWorkflow(sessionId);
  if (!workflowRunId || sessionId !== currentSessionId) return;
  await refreshWorkflowCard(workflowRunId, { quiet: true });
}

async function retryWorkflowTasks(view, taskIds = [], retryScope = 'execute') {
  const ids = [...new Set(taskIds.map(String).filter(Boolean))];
  if (!ids.length) throw new Error('Checkpoint 中没有可重试的任务');
  for (const taskId of ids) {
    const action = retryScope === 'review' ? 'retry-review' : 'rerun';
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/${action}`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `任务 ${taskId} 重置失败`);
  }
  await loadTasks();
  const nextWorkflowId = `${view.workflowRunId}:retry:${Date.now()}`;
  renderWorkflowCard({
    workflowRunId: nextWorkflowId,
    status: 'running',
    task: view.currentTask,
    activityText: retryScope === 'review' ? '正在复用 Agent 结果并重新启动 Reviewer' : '正在重新启动 Agent 执行节点',
    next: [retryScope === 'review' ? 'review_task' : 'run_task'],
    failed: 0,
    failedTaskIds: [],
    error: '',
  });
  showToast(retryScope === 'review' ? 'Agent 结果已保留，正在重试 Reviewer' : `已重置 ${ids.length} 个失败节点，正在重新派发`, 'success');
  await runDispatch({
    taskIds: ids,
    workflowId: nextWorkflowId,
    humanGate: true,
  });
}

function createTaskReviewCard({ id = '', title = '', reviewer = '', verdict = '', strategy = '', score = null, findings = [], suggestion = '', reason = '' } = {}) {
  const passed = verdict === 'pass';
  const rework = verdict === 'rework';
  const repairing = verdict === 'agent_repair_pending'; // 兼容旧历史数据
  const reviewing = verdict === 'reviewing'; // P2: 验收进行中的交互反馈
  const card = document.createElement('div');
  if (id) card.id = id;
  card.className = `task-review-chat-card ${passed ? 'passed' : rework || repairing ? 'rework' : reviewing ? 'reviewing' : 'fallback'}`;
  const strategyLabel = strategy === 'self_review' ? 'Agent 自验收' : strategy === 'cross_agent' ? '跨 Agent 验收' : '验收兜底';
  card.innerHTML = reviewing
    ? `<div class="task-review-chat-icon">⟳</div>
       <div class="task-review-chat-main">
         <div class="task-review-chat-title">${esc(title || id || '任务')} · 正在验收中</div>
         <div class="task-review-chat-meta">${esc([reviewer, strategyLabel].filter(Boolean).join(' · '))}</div>
         ${reason ? `<div class="task-review-chat-note">${esc(reason)}</div>` : ''}
         <div class="task-review-spinner"></div>
       </div>`
    : `<div class="task-review-chat-icon">${passed ? '✓' : rework ? '↻' : '!'}</div>
      <div class="task-review-chat-main">
        <div class="task-review-chat-title">${esc(title || id || '任务')} · ${passed ? '验收通过' : rework ? '要求返工' : repairing ? 'Reviewer 协议异常（执行结果已保留）' : '自动验收未完成'}</div>
        <div class="task-review-chat-meta">${esc([reviewer, strategyLabel, score !== null ? `${score} 分` : ''].filter(Boolean).join(' · '))}</div>
        ${suggestion || reason ? `<div class="task-review-chat-note">${esc(suggestion || reason)}</div>` : ''}
        ${findings?.length ? `<ul>${findings.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
      </div>
      ${!passed && !rework && !repairing ? '<button class="task-review-fallback-btn">打开验收 Gate</button>' : ''}`;
  card.querySelector('.task-review-fallback-btn')?.addEventListener('click', () => {
    hubActiveTab = 'gate';
    openHub();
  });
  return card;
}

function addTaskReviewCard(review) {
  hideWelcome();
  // P2: 如果已有同一任务的验收卡片，更新而非重复添加
  if (review.id) {
    const existing = document.getElementById(review.id);
    if (existing) {
      const updated = createTaskReviewCard(review);
      existing.replaceWith(updated);
      scrollChat();
      return updated;
    }
  }
  const card = createTaskReviewCard(review);
  chatEl.appendChild(card);
  scrollChat();
  return card;
}

