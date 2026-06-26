// ── radio group ───────────────────────────────────────────────
function buildRadioGroup(containerId, items, defaultVal) {
  const el = document.getElementById(containerId);
  el.setAttribute('role', 'radiogroup');
  el.innerHTML = '';
  items.forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'radio-btn' + (key === defaultVal ? ' active' : '');
    btn.dataset.value = key;
    btn.textContent = label;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(key === defaultVal));
    btn.onclick = () => {
      el.querySelectorAll('.radio-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-checked', 'true');
    };
    el.appendChild(btn);
  });
}

function getRadio(containerId) {
  return document.querySelector(`#${containerId} .radio-btn.active`)?.dataset.value || '';
}

// ── status ────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const { agents, workspace } = await fetch('/api/status').then(r => r.json());
    appWorkspace = workspace || '';
    agentConfigList = agents;
    const pillsEl = document.getElementById('agentPills');
    pillsEl.innerHTML = agents.map(a =>
      `<span class="agent-pill ${a.available ? 'ok' : 'err'} ${activeAgentKey === a.key ? 'busy' : ''}" data-agent="${esc(a.key)}" title="${esc(a.error || (a.available ? '可启动' : '不可用'))}">
        <span class="dot"></span>${esc(a.label || a.key)}
      </span>`
    ).join('');

    const availableAgents = agents.filter(a => a.available);
    mentionAgents = agents.map(a => ({
      key: a.key,
      label: a.label || a.key,
      emoji: a.emoji || '●',
      available: a.available,
    }));
    buildRadioGroup('planAgentGroup',
      availableAgents.map(a => ({ key: a.key, label: a.label || a.key })),
      availableAgents[0]?.key
    );
    setConnectionStatus(availableAgents.length > 0 ? 'online' : 'degraded');
    if (document.getElementById('chatWelcome')) renderWelcome();
  } catch {
    document.getElementById('agentPills').innerHTML =
      '<span class="agent-pill err"><span class="dot"></span>离线</span>';
    setConnectionStatus('offline');
  }
}

let activeAgentKey = null;

function setActiveAgent(agentKey) {
  activeAgentKey = agentKey || null;
  const run = getSessionRun(currentSessionId);
  const agent = run?.activeAgent || activeAgentKey;
  document.querySelectorAll('.agent-pill').forEach(pill => {
    pill.classList.toggle('busy', Boolean(agent && pill.dataset.agent === agent));
  });
}

function setConnectionStatus(level) {
  let bar = document.getElementById('connectionBar');
  if (level === 'online') {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'connectionBar';
    bar.className = 'connection-bar';
    // 插在 topbar 后面
    const topbar = document.querySelector('.topbar');
    topbar.insertAdjacentElement('afterend', bar);
  }
  if (level === 'offline') {
    bar.className = 'connection-bar offline';
    bar.innerHTML = `<span class="conn-dot"></span> 服务器离线 — 请运行 <code>node server.mjs</code>`;
  } else {
    bar.className = 'connection-bar degraded';
    bar.innerHTML = `<span class="conn-dot"></span> Agent 不可用 — 请检查 .env 配置`;
  }
}

// ── tasks ─────────────────────────────────────────────────────
let allTasks = [];
let currentFilter = 'all';
let currentSearch = '';

// ── 当前运行 invocation 状态（用于实时面板）─────────────────
let runningState = null; // { agent, mode, startedAt, charsOut, charsThink, taskTitle, timerId }

function showRunningPanel(meta) {
  const panel = document.getElementById('runningPanel');
  if (!panel) return;
  if (runningState?.timerId) clearInterval(runningState.timerId);
  runningState = {
    agent: meta.agent || '',
    mode: meta.mode || '',
    taskTitle: meta.taskTitle || '',
    startedAt: Date.now(),
    charsOut: 0,
    charsThink: 0,
    timerId: null,
  };
  panel.classList.remove('hidden');
  renderRunningPanel();
  runningState.timerId = setInterval(renderRunningPanel, 500);
}

function bumpRunningChars(kind, n) {
  if (!runningState) return;
  if (kind === 'thinking') runningState.charsThink += n;
  else runningState.charsOut += n;
}

function hideRunningPanel() {
  const panel = document.getElementById('runningPanel');
  if (runningState?.timerId) clearInterval(runningState.timerId);
  runningState = null;
  if (panel) panel.classList.add('hidden');
}

function renderRunningPanel() {
  if (!runningState) return;
  const elapsedMs = Date.now() - runningState.startedAt;
  const sec = Math.floor(elapsedMs / 1000);
  const elapsedStr = sec < 60 ? `${sec}s` : `${Math.floor(sec/60)}m${sec%60}s`;
  document.getElementById('runningElapsed').textContent = elapsedStr;
  const body = document.getElementById('runningBody');
  if (!body) return;
  const tokOut = Math.round(runningState.charsOut / 4);
  const tokThink = Math.round(runningState.charsThink / 4);
  const meta = agentMeta(runningState.agent);
  body.innerHTML = `
    <div class="running-row">
      <span class="running-agent">${meta.emoji} ${esc(meta.label || runningState.agent)}</span>
      ${runningState.mode ? `<span class="running-mode">${esc(runningState.mode)}</span>` : ''}
    </div>
    ${runningState.taskTitle ? `<div class="running-task">📋 ${esc(runningState.taskTitle)}</div>` : ''}
    <div class="running-stats">
      <span title="输出字符 / token 估算">📤 ${runningState.charsOut} 字符 · ~${tokOut} tok</span>
      ${runningState.charsThink ? `<span title="思考字符">🧠 ${runningState.charsThink} 字符 · ~${tokThink} tok</span>` : ''}
    </div>`;
}

// ── 批量管理 ─────────────────────────────────────────────────
let bulkMode = false;
const selectedTaskIds = new Set();

function toggleBulkMode(on) {
  bulkMode = on;
  selectedTaskIds.clear();
  document.getElementById('tasksBulkBar').classList.toggle('hidden', !on);
  const toggle = document.getElementById('tasksBulkToggle');
  if (toggle) toggle.textContent = on ? '✕ 退出批量' : '☑ 批量管理';
  filterAndRenderTasks();
}

function updateBulkCount() {
  document.getElementById('tasksBulkCount').textContent = `已选 ${selectedTaskIds.size}`;
}

function reconcileBulkSelection(visibleTasks = []) {
  const visibleIds = new Set(visibleTasks.map(task => String(task.id)));
  for (const id of selectedTaskIds) {
    if (!visibleIds.has(id)) selectedTaskIds.delete(id);
  }
  const selectAll = document.getElementById('tasksSelectAll');
  if (selectAll) {
    const selectedVisible = [...visibleIds].filter(id => selectedTaskIds.has(id)).length;
    selectAll.checked = visibleIds.size > 0 && selectedVisible === visibleIds.size;
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.size;
  }
  updateBulkCount();
}

async function bulkApply(action) {
  const ids = [...selectedTaskIds];
  if (!ids.length) return;
  if (action === 'delete' && !confirm(`确定删除 ${ids.length} 个任务？`)) return;
  for (const id of ids) {
    try {
      if (action === 'delete') await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
      else if (action === 'rerun') await fetch(`/api/tasks/${id}/rerun`, { method: 'POST' });
    } catch {}
  }
  selectedTaskIds.clear();
  await loadTasks();
}

function suggestClarificationOptions(question = '') {
  const text = String(question);
  if (/直飞|中转/.test(text)) return ['仅直飞', '允许一次中转', '均可'];
  if (/今天|明天|日期|起止日/.test(text)) return ['按最近可用日期', '今天开始', '明天开始'];
  if (/是否|要不要|需不需要/.test(text)) return ['是', '否'];
  return ['采用 Agent 推荐方案', '按当前默认设置继续'];
}

function normalizeClarificationQuestion(task, value) {
  const question = typeof value === 'string' ? value : value?.question;
  const supplied = Array.isArray(value?.options) ? value.options : [];
  const options = [...new Set(supplied.map(option => String(option || '').trim()).filter(Boolean))].slice(0, 3);
  return {
    taskId: task.id,
    taskTitle: task.title,
    question: String(question || '').trim(),
    options: options.length ? options : suggestClarificationOptions(question).slice(0, 3),
  };
}

function renderClarificationTray(tasks = []) {
  const tray = document.getElementById('clarificationTray');
  if (!tray) return;
  const blockedTasks = tasks.filter(task =>
    task.session_id === currentSessionId && ['pending', 'waiting_input'].includes(task.status) && Array.isArray(task.open_questions) && task.open_questions.length
  );
  if (!blockedTasks.length) {
    tray.classList.add('hidden');
    tray.innerHTML = '';
    return;
  }
  const runId = blockedTasks[0].run_id;
  const questions = blockedTasks
    .filter(task => task.run_id === runId)
    .flatMap(task => task.open_questions.map(question => normalizeClarificationQuestion(task, question)))
    .filter(item => item.question)
    .slice(0, 3);
  tray.innerHTML = `
    <div class="clarification-head">
      <div><strong>任务确实无法继续，需要你的确认</strong><span>请选择最符合情况的一项；只有“其他”需要输入文字。</span></div>
      <span class="clarification-count">${questions.length} 项</span>
    </div>
    <div class="clarification-fields">
      ${questions.map((item, index) => `<fieldset class="clarification-field" data-clarification-index="${index}">
        <legend><b>${index + 1}</b><span>${esc(item.question)}</span></legend>
        <div class="clarification-options">
          ${item.options.map((option, optionIndex) => `<label class="clarification-choice">
            <input type="radio" name="clarification-${index}" value="${esc(option)}" ${optionIndex === 0 ? 'checked' : ''}>
            <span>${esc(option)}</span>
          </label>`).join('')}
          <label class="clarification-choice other-choice">
            <input type="radio" name="clarification-${index}" value="__other__">
            <span>其他</span>
            <input type="text" class="clarification-other-input" placeholder="输入其他情况…" disabled>
          </label>
        </div>
      </fieldset>`).join('')}
    </div>
    <div class="clarification-actions"><button type="button" id="clarificationSubmit">确认并继续执行</button></div>`;
  tray.classList.remove('hidden');
  tray.querySelectorAll('.clarification-field').forEach(field => {
    const custom = field.querySelector('.clarification-other-input');
    field.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.onchange = () => {
        custom.disabled = radio.value !== '__other__' || !radio.checked;
        if (!custom.disabled) custom.focus();
      };
    });
  });
  tray.querySelector('#clarificationSubmit').onclick = async event => {
    const answers = questions.map((item, index) => {
      const field = tray.querySelector(`[data-clarification-index="${index}"]`);
      const selected = field?.querySelector('input[type="radio"]:checked');
      const answer = selected?.value === '__other__'
        ? field.querySelector('.clarification-other-input')?.value.trim() || ''
        : selected?.value || '';
      return { ...item, answer };
    });
    if (answers.some(item => !item.answer)) {
      showToast('请完成全部选择；选择“其他”时需要填写具体内容。', 'warn');
      return;
    }
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = '正在保存…';
    try {
      const response = await fetch('/api/tasks/clarify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSessionId,
          runId,
          answers,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || '保存确认信息失败');
      addUserBubble(`已确认任务信息：\n${answers.map((item, index) => `${index + 1}. ${item.answer}`).join('\n')}`);
      await loadTasks();
      if (!data.remaining?.length) await runDispatch({ runId });
    } catch (error) {
      showToast(error.message, 'error');
      event.currentTarget.disabled = false;
      event.currentTarget.textContent = '确认并继续执行';
    }
  };
}

async function loadTasks() {
  const sid = currentSessionId || '';
  const url = '/api/tasks' + (sid ? '?sessionId=' + encodeURIComponent(sid) : '');
  const { tasks } = await fetch(url).then(r => r.json()).catch(() => ({ tasks: [] }));
  allTasks = tasks;
  filterAndRenderTasks();
  renderClarificationTray(tasks);
  // 有 pending 就显示 dispatch 按钮，否则隐藏
  const hasClarifications = tasks.some(t => t.session_id === currentSessionId && ['pending', 'waiting_input'].includes(t.status) && Array.isArray(t.open_questions) && t.open_questions.length);
  const hasPending = tasks.some(t => t.session_id === currentSessionId && t.status === 'pending');
  const dispatchBtn = document.getElementById('dispatchBtn');
  if (hasPending) {
    dispatchBtn.classList.remove('hidden');
    dispatchBtn.disabled = isCurrentSessionRunning() || hasClarifications;
  } else {
    dispatchBtn.classList.add('hidden');
    dispatchBtn.disabled = true;
  }
  // 统一激活 plan 卡片中的延迟执行按钮
  activateDeferredPlanActions({ hasClarifications, hasPending, isRunning: isCurrentSessionRunning() });
  return tasks;
}

function activateDeferredPlanActions({ hasClarifications = false, hasPending = false, isRunning = false } = {}) {
  const disabled = hasClarifications || isRunning;
  document.querySelectorAll('.plan-suggest-btn[data-agent][disabled]').forEach(btn => {
    btn.disabled = disabled;
    if (disabled) {
      btn.title = hasClarifications ? '任务需要先确认信息才能执行' : '当前会话正在运行中';
    } else {
      btn.removeAttribute('title');
    }
  });
  document.querySelectorAll('.plan-suggest-manual[disabled]').forEach(btn => {
    btn.disabled = false;
  });
}

function filterAndRenderTasks() {
  let filtered = allTasks;
  
  // Apply status filter
  if (currentFilter !== 'all') {
    filtered = filtered.filter(t => t.status === currentFilter);
  }
  
  // Apply search
  if (currentSearch) {
    const term = currentSearch.toLowerCase();
    filtered = filtered.filter(t => 
      (t.id && t.id.toLowerCase().includes(term)) ||
      t.title.toLowerCase().includes(term) ||
      (t.goal && t.goal.toLowerCase().includes(term)) ||
      (t.agent && t.agent.toLowerCase().includes(term))
    );
  }
  
  reconcileBulkSelection(filtered);
  renderTasks(filtered);
}

// Filter chip click handlers
document.querySelectorAll('.filter-chip').forEach(chip => {
  chip.onclick = () => {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    filterAndRenderTasks();
  };
});

// Search input handler
document.getElementById('tasksSearch').oninput = (e) => {
  currentSearch = e.target.value;
  filterAndRenderTasks();
};

// 批量管理按钮
document.getElementById('tasksBulkToggle')?.addEventListener('click', () => toggleBulkMode(!bulkMode));
document.getElementById('tasksBulkBar')?.querySelectorAll('[data-bulk]').forEach(btn => {
  btn.onclick = async () => {
    const act = btn.dataset.bulk;
    if (act === 'cancel') { toggleBulkMode(false); return; }
    await bulkApply(act);
  };
});
document.getElementById('tasksSelectAll')?.addEventListener('change', (e) => {
  const visible = document.querySelectorAll('.task-item[data-id]');
  visible.forEach(item => {
    const id = item.dataset.id;
    if (e.target.checked) selectedTaskIds.add(id);
    else selectedTaskIds.delete(id);
    const cb = item.querySelector('.task-bulk-cb');
    if (cb) cb.checked = e.target.checked;
  });
  updateBulkCount();
});

async function focusTasks(term = '') {
  closeHub();
  layout.classList.add('tasks-expanded');
  const search = document.getElementById('tasksSearch');
  currentFilter = 'all';
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.filter === 'all');
  });
  currentSearch = term;
  search.value = term;
  await loadTasks();
  search.focus();
}

// Task action handlers
async function rerunTask(taskId) {
  try {
    const res = await fetch(`/api/tasks/${taskId}/rerun`, { method: 'POST' });
    if (!res.ok) throw new Error('重跑失败');
    await loadTasks();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteTask(taskId) {
  try {
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('删除失败');
    await loadTasks();
  } catch (err) {
    alert(err.message);
  }
}

const STATUS_DOT = {
  pending:     'sd-pending',
  waiting_input: 'sd-pending',
  in_progress: 'sd-running',
  done:        'sd-done',
  failed:      'sd-failed',
};

function taskLifecycleMeta(task) {
  if (task.status === 'waiting_input' || task.open_questions?.length) return { tone: 'review', label: '等待用户确认' };
  if (task.review_status === 'agent_repair_pending') return { tone: 'blocked', label: 'Reviewer 异常待处理' };
  if (task.gate_status === 'passed') return { tone: 'accepted', label: task.reviewer === 'human' ? '人工已验收' : 'Agent 已验收' };
  if (task.gate_status === 'rework') return { tone: 'rework', label: task.reviewer === 'human' ? '人工要求返工' : 'Agent 要求返工' };
  if (task.status === 'failed') return { tone: 'blocked', label: '失败阻塞' };
  if (['failed', 'parse_failed', 'skipped'].includes(task.review_status)) return { tone: 'blocked', label: '验收异常' };
  if (task.status === 'done') return { tone: 'review', label: 'Agent 验收中' };
  if (task.status === 'in_progress') return { tone: 'running', label: '执行中' };
  return { tone: 'pending', label: '待执行' };
}

function renderTaskReviewSummary(task) {
  if (!task.review_status && !task.review_scorecard) return '';
  const findings = Array.isArray(task.review_findings) ? task.review_findings : [];
  const score = Number.isFinite(Number(task.review_score)) ? `${Number(task.review_score)} 分` : '';
  const scorecard = task.review_scorecard && typeof task.review_scorecard === 'object'
    ? `${Object.values(task.review_scorecard).filter(Boolean).length}/4 人工确认`
    : '';
  return `<div class="task-detail-section task-review-summary">
    <div class="task-detail-label">审查结果</div>
    <div class="task-review-meta">${esc([task.reviewer || 'reviewer', task.review_status, score, scorecard].filter(Boolean).join(' · '))}</div>
    ${task.review_note ? `<div class="task-review-note">${esc(task.review_note)}</div>` : ''}
    ${findings.length ? `<ul>${findings.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function renderTasks(tasks) {
  const el = document.getElementById('tasksList');
  const countEl = document.getElementById('tasksCount');
  // 同步更新窄条的 badge
  const railCount = document.getElementById('tasksRailCount');

  if (!tasks.length) {
    el.innerHTML = '<div class="tasks-empty">暂无任务</div>';
    countEl.classList.add('hidden');
    if (railCount) railCount.textContent = '0';
    return;
  }

  countEl.textContent = tasks.length;
  countEl.classList.remove('hidden');
  if (railCount) railCount.textContent = tasks.length > 99 ? '99+' : tasks.length;

  // group by run_id（倒序，最新 run 在前）
  const runs = {};
  tasks.forEach(t => { (runs[t.run_id] = runs[t.run_id] || []).push(t); });

  el.innerHTML = '';
  Object.entries(runs).reverse().forEach(([rid, items]) => {
    const goal = items[0].goal || rid;
    const shortGoal = goal.length > 28 ? goal.slice(0, 28) + '…' : goal;
    const pendingCnt = items.filter(t => t.status === 'pending').length;
    const doneCnt = items.filter(t => t.status === 'done').length;
    const failedCnt = items.filter(t => t.status === 'failed').length;
    const total = items.length;
    const progressPct = total ? Math.round((doneCnt / total) * 100) : 0;

    const group = document.createElement('div');
    group.className = 'run-group';

    const labelEl = document.createElement('div');
    labelEl.className = 'run-label';
    labelEl.title = goal;
    labelEl.innerHTML = `
      <span class="run-label-chevron">›</span>
      <span style="flex:1">${esc(shortGoal)}</span>
      ${pendingCnt ? `<span style="font-size:10px;background:var(--accent-soft);color:var(--accent);padding:1px 5px;border-radius:4px;">${pendingCnt}</span>` : ''}`;
    labelEl.onclick = () => group.classList.toggle('collapsed');
    group.appendChild(labelEl);

    // 进度条
    const progressEl = document.createElement('div');
    progressEl.className = 'run-progress';
    progressEl.innerHTML = `
      <div class="run-progress-bar">
        <div class="run-progress-fill ${failedCnt ? 'has-failed' : ''}" style="width:${progressPct}%"></div>
      </div>
      <span class="run-progress-text">${doneCnt}/${total}${failedCnt ? ` · ${failedCnt}失败` : ''}</span>`;
    group.appendChild(progressEl);

    const itemsEl = document.createElement('div');
    itemsEl.className = 'run-items';

    items.forEach(task => {
      const item = document.createElement('div');
      item.className = 'task-item' + (task.status === 'in_progress' ? ' active' : '');
      item.dataset.id = task.id;

      const dotCls = STATUS_DOT[task.status] || 'sd-pending';
      const agentLabel = task.executed_by || task.agent || '';
      const lifecycle = taskLifecycleMeta(task);

      const steps = (task.steps || []).map(s => `<li>${esc(s)}</li>`).join('');
      const context = [
        task.why ? `<div><b>为什么做：</b>${esc(task.why)}</div>` : '',
        task.tradeoff ? `<div><b>关键取舍：</b>${esc(task.tradeoff)}</div>` : '',
      ].filter(Boolean).join('');
      const accept = task.accept
        ? `<div class="task-detail-section"><div class="task-detail-label">验收标准</div>
           <div class="task-accept-text">✓ ${esc(task.accept)}</div></div>` : '';
      const result = task.result
        ? `<div class="task-detail-section"><div class="task-detail-label">执行结果</div>
           <pre class="task-result-pre">${esc(task.result)}</pre></div>` : '';
      const error = task.error
        ? `<div class="task-error-text">✗ ${esc(task.error)}</div>` : '';

      item.innerHTML = `
        <div class="task-row" data-task-id="${esc(task.id)}" data-parent-task-id="${esc(task.parent_task_id || '')}" data-chain-depth="${esc(task.chain_depth || 0)}">
          ${bulkMode ? `<input type="checkbox" class="task-bulk-cb" data-task-id="${esc(task.id)}" ${selectedTaskIds.has(task.id) ? 'checked' : ''}>` : ''}
          <span class="task-status-dot ${dotCls}"></span>
          <span class="task-row-title" title="${esc(task.title)}">${esc(task.title)}</span>
          <span class="task-row-agent">${esc(agentLabel)}</span>
          <span class="task-lifecycle-badge ${lifecycle.tone}">${lifecycle.label}</span>
          <div class="task-actions">
            <button class="task-action-btn" data-action="rerun" data-task-id="${esc(task.id)}" title="重新执行">↻</button>
            <button class="task-action-btn danger" data-action="delete" data-task-id="${esc(task.id)}" title="删除">✕</button>
          </div>
          <span class="task-chevron">›</span>
        </div>
        <div class="task-detail">
          ${context ? `<div class="task-detail-section task-context">${context}</div>` : ''}
          ${steps ? `<div class="task-detail-section">
            <div class="task-detail-label">步骤</div>
            <ul>${steps}</ul></div>` : ''}
          ${accept}
          ${result}
          ${error}
          ${renderTaskReviewSummary(task)}
        </div>`;

      item.querySelector('.task-row').onclick = (e) => {
        if (e.target.closest('.task-actions')) return;
        item.classList.toggle('open');
      };

      item.querySelectorAll('.task-action-btn').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          const taskId = btn.dataset.taskId;
          if (action === 'rerun') {
            await rerunTask(taskId);
          } else if (action === 'delete') {
            if (confirm('确定删除此任务？')) {
              await deleteTask(taskId);
            }
          }
        };
      });

      // 批量复选
      const cb = item.querySelector('.task-bulk-cb');
      if (cb) {
        cb.onclick = (e) => e.stopPropagation();
        cb.onchange = () => {
          if (cb.checked) selectedTaskIds.add(task.id);
          else selectedTaskIds.delete(task.id);
          reconcileBulkSelection(tasks);
        };
      }

      itemsEl.appendChild(item);
    });

    group.appendChild(itemsEl);
    el.appendChild(group);
  });
}

function updateTaskDot(id, status) {
  const item = document.querySelector(`.task-item[data-id="${id}"]`);
  if (!item) return;
  const dot = item.querySelector('.task-status-dot');
  if (dot) {
    dot.className = `task-status-dot ${STATUS_DOT[status] || 'sd-pending'}`;
  }
  item.classList.toggle('active', status === 'in_progress');
}

// ── SSE fetch ─────────────────────────────────────────────────
const sessionRuns = new Map();

function getSessionRun(sessionId = currentSessionId) {
  return sessionRuns.get(sessionId || '');
}

function isCurrentSessionRunning() {
  return Boolean(getSessionRun()?.running);
}

function updateVisibleRunState() {
  const run = getSessionRun();
  const stopBtn = document.getElementById('stopBtn');
  stopBtn.classList.toggle('hidden', !run?.running);
  // 恢复正在运行 session 的 typing bubble 到当前 chatEl
  const bubbleInfo = sessionBubbles.get(currentSessionId || '');
  if (run?.running && bubbleInfo?.row) {
    if (!bubbleInfo.row.isConnected) chatEl.appendChild(bubbleInfo.row);
    agentTypingBubble = bubbleInfo.bubble;
  } else if (!run?.running) {
    agentTypingBubble = null;
  }
  setActiveAgent(run?.activeAgent || null);
  updateSendBtnState();
  // 刷新 session 列表的运行状态指示器
  const list = document.getElementById('sessionList');
  if (list) {
    list.querySelectorAll('.session-item').forEach(item => {
      const sid = item.dataset.id;
      const running = Boolean(sessionRuns.get(sid)?.running);
      item.classList.toggle('running', running);
      const badge = item.querySelector('.session-running-badge');
      if (running && !badge) {
        const meta = item.querySelector('.session-item-meta');
        if (meta) {
          const b = document.createElement('span');
          b.className = 'session-running-badge';
          b.innerHTML = '<span class="session-running-dot"></span>运行中';
          meta.insertBefore(b, meta.firstChild);
        }
      } else if (!running && badge) {
        badge.remove();
      }
    });
  }
}

function updateSendBtnState() {
  const run = getSessionRun();
  const hasText = goalInput.value.trim().length > 0 || pendingImages.length > 0;
  if (run?.running) {
    sendBtn.classList.add('queue-mode');
    sendBtn.innerHTML = '⏎';
    sendBtn.title = run.queue.length ? `已排队 ${run.queue.length} 条` : '排队发送（agent 完成后自动发送）';
    sendBtn.disabled = false;
  } else {
    sendBtn.classList.remove('queue-mode');
    sendBtn.innerHTML = '➤';
    sendBtn.title = '发送';
    sendBtn.disabled = !hasText;
  }
}

function appendAgentActivity(activity = {}) {
  if (!agentTypingBubble) return;
  const wrap = agentTypingBubble.closest('.bubble-content-wrap');
  const feed = wrap?.querySelector('.agent-activity-feed');
  if (!feed) return;
  feed.classList.remove('hidden');
  if (!agentTypingBubble.dataset.raw) agentTypingBubble.classList.add('hidden');

  const id = String(activity.id || `activity-${Date.now()}`);
  let row = [...feed.querySelectorAll('.agent-activity-row')].find(item => item.dataset.activityId === id);
  if (!row) {
    row = document.createElement('details');
    row.className = 'agent-activity-row running';
    row.dataset.activityId = id;
    row.innerHTML = '<summary><span class="agent-activity-dot"></span><div class="agent-activity-copy"><strong></strong><span></span></div><span class="agent-activity-chevron">›</span></summary><div class="agent-activity-detail"></div>';
    feed.appendChild(row);
  }

  if (activity.name) row.dataset.activityName = activity.name;
  if (activity.input !== undefined) row._activityInput = activity.input;
  if (activity.output !== undefined) row._activityOutput = activity.output;
  const name = row.dataset.activityName || '工具';
  const completed = activity.phase === 'completed' || activity.phase === 'failed';
  row.classList.toggle('running', !completed);
  row.classList.toggle('completed', completed);
  row.classList.toggle('failed', activity.phase === 'failed');
  row.querySelector('strong').textContent = activity.phase === 'failed'
    ? `${name} 执行失败`
    : completed ? `${name} 已完成` : `正在调用 ${name}`;
  const detail = row.querySelector('.agent-activity-copy span');
  const duration = activity.durationMs ? ` · ${(activity.durationMs / 1000).toFixed(1)}s` : '';
  detail.textContent = `${activity.summary || (completed ? '已返回结果' : '等待工具返回')}${duration}`;
  const detailEl = row.querySelector('.agent-activity-detail');
  const blocks = [];
  if (row._activityInput !== undefined) blocks.push(`<div><span>输入</span><pre>${esc(formatTurnValue(row._activityInput))}</pre></div>`);
  if (row._activityOutput !== undefined) blocks.push(`<div><span>输出</span><pre>${esc(formatTurnValue(row._activityOutput))}</pre></div>`);
  detailEl.innerHTML = blocks.join('');
  row.classList.toggle('has-detail', blocks.length > 0);
  scrollChat();
}

function updatePlanProgress(text = '正在组织任务结构…') {
  if (!agentTypingBubble) return;
  agentTypingBubble.classList.remove('hidden');
  agentTypingBubble.classList.add('plan-progress-bubble');
  agentTypingBubble.innerHTML = `<div class="plan-progress"><span class="spinner"></span><span>${esc(text)}</span></div>`;
}

function finishPlanProgress(taskCount = 0, failed = false) {
  if (!agentTypingBubble) return;
  const bubble = agentTypingBubble;
  const st = typerStates.get(bubble);
  if (st?.rafId) clearTimeout(st.rafId);
  typerStates.delete(bubble);
  bubble.dataset.raw = '';
  bubble.classList.remove('typing-cursor', 'hidden');
  bubble.classList.add('plan-progress-bubble');
  bubble.innerHTML = failed
    ? '<div class="plan-progress failed"><span>计划生成未完成</span></div>'
    : `<div class="plan-progress completed"><span>计划已生成</span><strong>${taskCount} 个任务</strong></div>`;
  const wrap = bubble.closest('.agent-turn');
  wrap?.querySelector('.turn-final-label')?.classList.add('hidden');
  wrap?.querySelector('.bubble-actions')?.classList.add('hidden');
  const timeEl = wrap?.querySelector('[id^="time-"]');
  if (timeEl) timeEl.textContent = formatTime();
}

function formatTurnValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function approvalRiskLabel(risk) {
  return ({ high: '高风险', medium: '中风险', low: '低风险' })[risk] || risk || '未知风险';
}

function approvalContextRows(approval) {
  const payload = approval.payload || {};
  if (approval.operation === 'agent.dispatch') {
    let scope = '当前 pending 任务';
    if (payload.selection === 'all_pending') scope = '全部 pending 任务';
    else if (payload.selection?.startsWith('task:')) scope = `单个任务 ${payload.selection.slice(5)}`;
    else if (payload.selection?.startsWith('run:')) scope = `任务批次 ${payload.selection.slice(4)}`;
    else if (payload.selection?.startsWith('agent:')) scope = `仅 ${payload.selection.slice(6)} 的 pending 任务`;
    return [
      ['执行范围', scope],
      ['任务数量', `${Number(payload.pendingCount || 0)} 条`],
      ['Agent', payload.requestedAgent === 'task_assignment' ? '按任务分配自动选择' : (payload.requestedAgent || '自动选择')],
    ];
  }
  return Object.entries(payload)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .slice(0, 8)
    .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]);
}

function approvalDetailsMarkup(approval) {
  const effects = Array.isArray(approval.effects) ? approval.effects : [];
  const rows = approvalContextRows(approval);
  return `
    <div class="approval-heading">
      <span class="approval-risk ${esc(approval.risk || 'medium')}">${esc(approvalRiskLabel(approval.risk))}</span>
      <div>
        <div class="dialog-title">${esc(approval.title || approval.operation || '操作审批')}</div>
        <div class="approval-operation">${esc(approval.operation || '')}</div>
      </div>
    </div>
    <p class="approval-reason">${esc(approval.reason || '此操作需要你的明确批准后才能继续。')}</p>
    ${effects.length ? `<div class="approval-section"><div class="approval-section-title">批准后可能发生</div><ul class="approval-effects">${effects.map(effect => `<li>${esc(effect)}</li>`).join('')}</ul></div>` : ''}
    ${rows.length ? `<div class="approval-section"><div class="approval-section-title">本次执行范围</div><div class="approval-context">${rows.map(([label, value]) => `<div class="approval-context-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div></div>` : ''}`;
}

function showApprovalDialog(approval) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `<div class="dialog-box approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-dialog-title">
      ${approvalDetailsMarkup(approval).replace('class="dialog-title"', 'class="dialog-title" id="approval-dialog-title"')}
      <div class="dialog-actions approval-dialog-actions">
        <button class="dialog-cancel-btn" data-decision="deny">取消</button>
        ${approval.sessionId ? '<button class="dialog-choice-btn approval-session-btn" data-decision="approve_session">本会话允许</button>' : ''}
        <button class="dialog-confirm-btn" data-decision="approve_once">批准一次</button>
      </div>
    </div>`;
    const finish = decision => {
      overlay.remove();
      resolve(decision);
    };
    overlay.addEventListener('click', event => {
      const button = event.target.closest('[data-decision]');
      if (button) finish(button.dataset.decision);
      else if (event.target === overlay) finish('deny');
    });
    document.body.appendChild(overlay);
    overlay.querySelector('[data-decision="approve_once"]').focus();
  });
}

async function decideInlineApproval(approval) {
  const decision = await showApprovalDialog(approval);
  const res = await fetch(`/api/approvals/${encodeURIComponent(approval.id)}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '审批失败');
  return decision !== 'deny';
}

async function fetchWithApproval(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (response.status !== 202 || !data.approvalRequired) return { response, data };
  const accepted = await decideInlineApproval(data.approval);
  if (!accepted) return { response, data: { ok: false, error: '用户拒绝操作' } };
  const body = options.body ? JSON.parse(options.body) : {};
  return fetchWithApproval(url, { ...options, body: JSON.stringify({ ...body, approvalId: data.approval.id }) });
}

function ssePost(url, body, handlers) {
  const requestSessionId = body.sessionId || currentSessionId || '';
  const clientRunId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise(resolve => {
    const controller = new AbortController();
    const runState = {
      running: true,
      controller,
      clientRunId,
      mode: body.mode || getMode(),
      queue: getSessionRun(requestSessionId)?.queue || [],
      activeAgent: null,
    };
    sessionRuns.set(requestSessionId, runState);
    updateVisibleRunState();
    
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, clientRunId }),
      signal: controller.signal,
    }).then(async res => {
      if ((res.headers.get('content-type') || '').includes('application/json')) {
        const data = await res.json();
        if (res.status === 202 && data.approvalRequired) {
          const accepted = await decideInlineApproval(data.approval);
          if (accepted) {
            // 把首次 pending 列表传给下一次请求，确保审批前
            // 后看到的 pending 集合相同
            const pendingIds = data.approval.payload?.taskIds || [];
            return ssePost(url, { ...body, approvalId: data.approval.id, _approvalTaskIds: pendingIds }, handlers).then(resolve);
          }
          handlers.error?.({ message: '用户拒绝操作' });
          return resolve(null);
        }
        handlers.error?.({ ...data, message: data.error || `请求失败 (${res.status})` });
        return resolve(null);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const block of parts) {
          let event = 'message', data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            if (line.startsWith('data: '))  data  = line.slice(6).trim();
          }
          let parsed;
          try { parsed = JSON.parse(data); } catch { continue; }
          if (parsed.agent && sessionRuns.get(requestSessionId)?.clientRunId === clientRunId) {
            sessionRuns.get(requestSessionId).activeAgent = parsed.agent;
            if (requestSessionId === currentSessionId) updateVisibleRunState();
          }
          const isBackground = requestSessionId && currentSessionId && requestSessionId !== currentSessionId;
          if (isBackground) {
            // 把 chunk 写进背景 session 的 bubble，切回时能看到进度
            const bgBubble = sessionBubbles.get(requestSessionId)?.bubble;
            if (bgBubble) {
              if (event === 'chunk' && parsed.text) {
                bgBubble.dataset.raw = (bgBubble.dataset.raw || '') + parsed.text;
                bgBubble.innerHTML = streamRender(bgBubble.dataset.raw) + '<span class="stream-cursor">▊</span>';
              }
              if (event === 'status' && parsed.text && !bgBubble.dataset.raw) {
                bgBubble.innerHTML = `<div class="thinking-line"><span class="thinking-dot"></span><span>${esc(parsed.text)}</span></div>`;
              }
            }
            if (event !== 'done' && event !== 'error' && event !== 'aborted') continue;
          }
          handlers[event]?.(parsed);
          if (event === 'done') resolve(parsed);
        }
      }
      resolve(null);
    }).catch(err => {
      if (err.name === 'AbortError') {
        if (requestSessionId === currentSessionId) handlers.aborted?.();
      } else {
        if (requestSessionId === currentSessionId) {
          const rawMessage = String(err?.message || '');
          const message = /network|failed to fetch|fetch failed/i.test(rawMessage)
            ? '连接已中断，任务可能仍在后台运行；刷新页面可恢复进度'
            : rawMessage;
          handlers.error?.({ message });
        }
      }
      resolve(null);
    }).finally(() => {
      const run = sessionRuns.get(requestSessionId);
      if (run?.clientRunId === clientRunId) {
        sessionRuns.delete(requestSessionId);
        // 完成 background session 的 bubble — finishTyping 替代品
        const bgInfo = sessionBubbles.get(requestSessionId);
        if (bgInfo?.bubble && requestSessionId !== currentSessionId) {
          const bubble = bgInfo.bubble;
          bubble.classList.remove('typing-cursor');
          const raw = bubble.dataset.raw || '';
          if (raw) { try { bubble.innerHTML = renderRichText(raw); } catch {} }
          const timeEl = bubble.closest('.bubble-content-wrap')?.querySelector('[id^="time-"]');
          if (timeEl) timeEl.textContent = formatTime();
        }
        // 清掉 sessionBubbles 里的引用
        sessionBubbles.delete(requestSessionId);
        if (requestSessionId === currentSessionId) updateVisibleRunState();
        if (run.queue.length && run.mode === 'chat') {
          const next = run.queue.shift();
          setTimeout(() => doChat(next, requestSessionId), 100);
        }
      }
    });
  });
}

// Stop button handler
document.getElementById('stopBtn').onclick = async () => {
  const run = getSessionRun();
  if (run?.controller) {
    run.controller.abort();
    const response = await fetch('/api/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, clientRunId: run.clientRunId }),
    });
    if (response.ok) {
      const result = await response.json();
      if (!result.settled) await waitForSessionRecovery();
      else await loadSessions();
      renderSessionRecovery();
    }
  }
};

// ── 模式切换 ──────────────────────────────────────────────────
const modeGroup       = document.getElementById('modeGroup');
const planAgentLabel  = document.getElementById('planAgentLabel');
const planAgentGroupEl= document.getElementById('planAgentGroup');
const mentionHint     = document.getElementById('mentionHint');
const sendBtn         = document.getElementById('sendBtn');
const attachBtn       = document.getElementById('attachBtn');
const imageInput      = document.getElementById('imageInput');
const attachmentTray  = document.getElementById('attachmentTray');
let pendingImages = [];
const goalInput       = document.getElementById('goalInput');   // 统一在此声明，避免 TDZ

modeGroup.querySelectorAll('.radio-btn').forEach(btn => {
  btn.onclick = () => {
    modeGroup.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const isPlan = btn.dataset.value === 'plan';
    planAgentLabel.classList.toggle('hidden', !isPlan);
    planAgentGroupEl.classList.toggle('hidden', !isPlan);
    renderMentionHint();
    goalInput.placeholder = isPlan
      ? '输入目标，例如：帮我整理一份本周工作计划…'
      : '输入消息，或用 @claude / @codex / @kimi 指定 agent…';
  };
});

function getMode() {
  return modeGroup.querySelector('.radio-btn.active')?.dataset.value || 'chat';
}

// ── @mention 实时提示 ─────────────────────────────────────────
const MENTION_RE = /(?:^|\n)\s*@([a-zA-Z0-9_-]+)\b/i;
let mentionAgents = [
  { key: 'claude', label: 'claude', available: false },
  { key: 'codex', label: 'codex', available: false },
  { key: 'kimi', label: 'kimi', available: false },
];
let mentionActiveIndex = 0;

function getMentionQuery() {
  const caret = goalInput.selectionStart ?? goalInput.value.length;
  const before = goalInput.value.slice(0, caret);
  const match = before.match(/(^|[\s\n])@([a-zA-Z]*)$/);
  if (!match) return null;
  const start = before.length - match[2].length - 1;
  return { query: match[2].toLowerCase(), start, end: caret };
}

function getMentionMatches(query) {
  return mentionAgents
    .filter(agent => agent.key.toLowerCase().startsWith(query))
    .sort((a, b) => Number(b.available) - Number(a.available) || a.key.localeCompare(b.key));
}

function applyMentionCompletion(agentKey) {
  const info = getMentionQuery();
  if (!info) return;
  const before = goalInput.value.slice(0, info.start);
  const after = goalInput.value.slice(info.end);
  const nextValue = `${before}@${agentKey} ${after}`;
  const caret = before.length + agentKey.length + 2;
  goalInput.value = nextValue;
  goalInput.focus();
  goalInput.setSelectionRange(caret, caret);
  renderMentionHint();
  updateSendBtnState();
}

function renderMentionHint() {
  const m = goalInput.value.match(MENTION_RE);
  const info = getMentionQuery();

  if (getMode() !== 'chat') {
    mentionHint.classList.add('hidden');
    mentionHint.innerHTML = '';
    return;
  }

  if (info) {
    const matches = getMentionMatches(info.query);
    if (matches.length) {
      mentionActiveIndex = Math.min(mentionActiveIndex, matches.length - 1);
      mentionHint.innerHTML = `
        <span class="mention-hint-label">@agent</span>
        ${matches.map((agent, index) => `
          <button class="mention-option ${index === mentionActiveIndex ? 'active' : ''}" data-agent="${esc(agent.key)}" type="button">
            @${esc(agent.key)}
            <span>${agent.available ? '可用' : '未配置'}</span>
          </button>
        `).join('')}`;
      mentionHint.querySelectorAll('.mention-option').forEach(btn => {
        btn.onclick = () => applyMentionCompletion(btn.dataset.agent);
      });
      mentionHint.classList.remove('hidden');
      return;
    }
  }

  if (m && mentionAgents.some(agent => agent.key === m[1].toLowerCase())) {
    mentionHint.textContent = `→ 将路由给 ${m[1].toLowerCase()}`;
    mentionHint.classList.remove('hidden');
  } else {
    mentionHint.classList.add('hidden');
    mentionHint.innerHTML = '';
  }
}

goalInput.addEventListener('input', () => {
  goalInput.style.height = 'auto';
  goalInput.style.height = Math.min(goalInput.scrollHeight, 120) + 'px';
  updateSendBtnState();
  mentionActiveIndex = 0;
  renderMentionHint();
});

function renderAttachmentTray() {
  if (!pendingImages.length) {
    attachmentTray.classList.add('hidden');
    attachmentTray.innerHTML = '';
    return;
  }
  attachmentTray.classList.remove('hidden');
  attachmentTray.innerHTML = pendingImages.map((item, index) => `
    <div class="attachment-chip">
      <img src="${esc(item.previewUrl)}" alt="${esc(item.file.name)}">
      <span>${esc(item.file.name)}</span>
      <button class="attachment-remove" data-index="${index}" type="button">×</button>
    </div>
  `).join('');
  attachmentTray.querySelectorAll('.attachment-remove').forEach(btn => {
    btn.onclick = () => {
      const [removed] = pendingImages.splice(Number(btn.dataset.index), 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      renderAttachmentTray();
      updateSendBtnState();
    };
  });
}

function clearPendingImages() {
  pendingImages.forEach(item => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  pendingImages = [];
  renderAttachmentTray();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadPendingImages() {
  if (!pendingImages.length) return [];
  const files = await Promise.all(pendingImages.map(async item => ({
    name: item.file.name,
    type: item.file.type,
    dataUrl: await fileToDataUrl(item.file),
  })));
  const res = await fetch('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '图片上传失败');
  return (data.uploads || []).map((upload, index) => ({
    ...upload,
    previewUrl: upload.url || pendingImages[index]?.previewUrl || '',
  }));
}

attachBtn.onclick = () => imageInput.click();
imageInput.onchange = () => {
  const next = Array.from(imageInput.files || [])
    .filter(file => file.type.startsWith('image/'))
    .map(file => ({ file, previewUrl: URL.createObjectURL(file) }));
  pendingImages.push(...next);
  const overflow = pendingImages.splice(5);
  overflow.forEach(item => URL.revokeObjectURL(item.previewUrl));
  imageInput.value = '';
  renderAttachmentTray();
  updateSendBtnState();
};

// ctrl+v 粘贴图片到输入框
goalInput.addEventListener('paste', (e) => {
  const items = Array.from(e.clipboardData?.items || []);
  const imageItems = items.filter(it => it.kind === 'file' && it.type.startsWith('image/'));
  if (!imageItems.length) return;
  e.preventDefault();
  const newOnes = imageItems.map(it => {
    const file = it.getAsFile();
    if (!file) return null;
    // 给粘贴的图片起个有意义的名字
    const ext = file.type.split('/')[1] || 'png';
    const named = file.name && file.name !== 'image.png'
      ? file
      : new File([file], `pasted-${Date.now()}.${ext}`, { type: file.type });
    return { file: named, previewUrl: URL.createObjectURL(named) };
  }).filter(Boolean);
  pendingImages.push(...newOnes);
  const overflow = pendingImages.splice(5);
  overflow.forEach(item => URL.revokeObjectURL(item.previewUrl));
  renderAttachmentTray();
  updateSendBtnState();
});

// ── send 入口：按模式分发 ─────────────────────────────────────
async function doSend() {
  const text = goalInput.value.trim();
  if (!text && !pendingImages.length) return;
  // 当前 session 运行中且 chat 模式 → 入队
  const currentRun = getSessionRun();
  if (currentRun?.running) {
    if (getMode() !== 'chat') {
      addSystemMsg('当前对话正在运行，请等完成后再拆任务。');
      return;
    }
    if (pendingImages.length) {
      addSystemMsg('正在运行时暂不排队图片消息，请等当前 agent 完成后再发送图片。');
      return;
    }
    currentRun.queue.push(text);
    goalInput.value = '';
    goalInput.style.height = '';
    mentionHint.classList.add('hidden');
    addSystemMsg(`⏳ 已排队：「${text.slice(0, 30)}${text.length > 30 ? '…' : ''}」`);
    updateSendBtnState();
    return;
  }
  if (getMode() === 'plan') {
    await doPlan(text);
  } else {
    await doChat(text);
  }
}

sendBtn.onclick = doSend;
goalInput.addEventListener('keydown', e => {
  const mentionInfo = getMentionQuery();
  if (getMode() === 'chat' && mentionInfo && !mentionHint.classList.contains('hidden')) {
    const matches = getMentionMatches(mentionInfo.query);
    if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      mentionActiveIndex = (mentionActiveIndex + step + matches.length) % matches.length;
      renderMentionHint();
      return;
    }
    if (matches.length && (e.key === 'Tab' || e.key === 'Enter')) {
      e.preventDefault();
      applyMentionCompletion(matches[mentionActiveIndex]?.key || matches[0].key);
      return;
    }
    if (e.key === 'Escape') {
      mentionHint.classList.add('hidden');
      return;
    }
  }
  // 中文输入法保护：检查 isComposing 或 keyCode 229
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { 
    e.preventDefault(); 
    doSend(); 
  }
});

// ── chat 模式 ─────────────────────────────────────────────────
async function doChat(message, sessionId = currentSessionId, options = {}) {
  const isResume = Boolean(options.resume);
  let attachments = [];
  if (!isResume) {
    try {
      attachments = await uploadPendingImages();
    } catch (err) {
      addSystemMsg(`图片发送失败：${err.message}`);
      return;
    }
  }
  if (!isResume) {
    goalInput.value = '';
    goalInput.style.height = '';
    clearPendingImages();
  }
  mentionHint.classList.add('hidden');

  addUserBubble(isResume ? '继续上次对话' : message, { attachments });

  let bubble = null;

  const agentAttachments = attachments.map(({ previewUrl, ...attachment }) => attachment);
  await ssePost('/api/chat', { message, sessionId, attachments: agentAttachments, mode: 'chat', resume: isResume }, {
    start: ({ agent }) => {
      setActiveAgent(agent);
      bubble = startAgentBubble(agent, sessionId);
      showRunningPanel({ agent, mode: '对话' });
    },
    part: appendTurnPart,
    chunk: ({ text }) => { appendTyping(text); bumpRunningChars('chunk', (text || '').length); },
    thinking: ({ text }) => { appendThinking(text); bumpRunningChars('thinking', (text || '').length); },
    activity: appendAgentActivity,
    status: ({ text, phase }) => updateAgentStatus(text, phase),
    error: ({ message: msg }) => {
      finishTyping();
      hideRunningPanel();
      addSystemMsg(`✗ ${msg}`);
      loadSessions().then(() => renderSessionRecovery());
    },
    done: () => {
      const stats = collectFinishStats();
      finishTyping(stats);
      hideRunningPanel();
      loadSessions();
      loadArtifacts();
    },
    aborted: () => {
      finishTyping();
      hideRunningPanel();
      loadSessions().then(() => renderSessionRecovery());
    },
  });

  goalInput.focus();
}

// ── plan 模式 ─────────────────────────────────────────────────
async function doPlan(goal) {
  const agent = getRadio('planAgentGroup')
    || mentionAgents.find((item) => item.available)?.key
    || mentionAgents[0]?.key
    || 'codex';

  let attachments = [];
  try {
    attachments = await uploadPendingImages();
  } catch (err) {
    addSystemMsg(`图片发送失败：${err.message}`);
    return;
  }
  clearPendingImages();

  goalInput.value = '';
  goalInput.style.height = '';
  document.getElementById('dispatchBtn').disabled = true;

  const agentAttachments = attachments.map(({ previewUrl, ...a }) => a);
  addUserBubble(`📋 ${goal}`, { attachments });
  setActiveAgent(agent);
  startAgentBubble(agent, currentSessionId);
  showRunningPanel({ agent, mode: '拆任务' });

  await ssePost('/api/plan', { goal, agent, sessionId: currentSessionId, attachments: agentAttachments, mode: 'plan' }, {
    start: ({ agent }) => setActiveAgent(agent),
    status: ({ text, phase }) => updateAgentStatus(text, phase),
    chunk: ({ text }) => { updatePlanProgress(); bumpRunningChars('chunk', (text || '').length); },
    thinking: ({ text }) => { appendThinking(text); bumpRunningChars('thinking', (text || '').length); },
    activity: appendAgentActivity,
    error: ({ message, raw }) => {
      finishPlanProgress(0, true);
      hideRunningPanel();
      addPlanRecoveryPrompt(goal, agent, message, raw, attachments, agentAttachments);
    },
    done: ({ runId, written, tasks }) => {
      finishPlanProgress(tasks?.length || written || 0);
      hideRunningPanel();
      if (tasks && tasks.length) {
        addPlanCard(goal, tasks, { deferActions: true });
      } else {
        addSystemMsg(`✓ 拆解完成，共 ${written} 条任务（run_id: ${runId}）`);
      }
    },
    aborted: () => {
      finishPlanProgress(0, true);
      hideRunningPanel();
      addSystemMsg('⏹ 已中断');
    },
  });

  sendBtn.disabled = false;
  await loadTasks();
}

// ── dispatch ─────────────────────────────────────────────────
document.getElementById('dispatchBtn').onclick = () => runDispatch();

async function runDispatch(options = {}) {
  const dispatchBtn = document.getElementById('dispatchBtn');
  const dispatchSpinner = document.getElementById('dispatchSpinner');
  const { resumeWorkflowId = '', resumeValue = null, ...dispatchOptions } = options;
  let activeWorkflowId = resumeWorkflowId || rememberedSessionWorkflow(currentSessionId);

  // 防止重复提交：如果审批对话框正在显示，直接返回
  if (document.querySelector('.dialog-overlay')) {
    console.warn('[myteam] 审批对话框正在显示中，跳过重复点击');
    return;
  }

  const showWorkflowLive = (statusText, phase = 'working', extra = {}) => {
    if (!activeWorkflowId) return;
    const previousTask = workflowViewState.get(activeWorkflowId)?.currentTask || null;
    const currentTask = extra.currentTask ? { ...(previousTask || {}), ...extra.currentTask } : previousTask;
    renderWorkflowCard({
      workflowRunId: activeWorkflowId,
      status: 'running',
      interrupts: [],
      ...extra,
      currentTask,
      live: {
        active: true,
        statusText,
        phase,
        agent: extra.agent || '',
        currentActivity: extra.currentActivity || null,
        lastActivityAt: new Date().toISOString(),
      },
    });
  };

  dispatchBtn.disabled = true;
  dispatchSpinner.classList.remove('hidden');

  try {
    const agentOnlyText = dispatchOptions.agentOnly ? `（仅 ${dispatchOptions.agentOnly}）` : '';
    addSystemMsg(resumeWorkflowId ? '正在从 checkpoint 恢复工作流…' : `开始执行 pending 任务${agentOnlyText}…`);
    if (resumeWorkflowId) {
      renderWorkflowCard({ workflowRunId: resumeWorkflowId, status: 'running', interrupts: [], error: '' });
    }

    const url = resumeWorkflowId
      ? `/api/workflows/${encodeURIComponent(resumeWorkflowId)}/resume`
      : '/api/dispatch';
    const body = resumeWorkflowId
      ? { value: resumeValue, sessionId: currentSessionId, mode: 'dispatch' }
      : { ...dispatchOptions, humanGate: dispatchOptions.humanGate ?? false, sessionId: currentSessionId, mode: 'dispatch' };

    // 如果本次 dispatch 没有 approvalId，在 ssePost 内部审批失败后，
    // finally 需要正确恢复按钮状态。ssePost 内部会重试。
    await ssePost(url, body, {
      'workflow-start': ({ workflowRunId, ...state }) => {
        activeWorkflowId = workflowRunId;
        rememberSessionWorkflow(currentSessionId, workflowRunId);
        renderWorkflowCard({ ...state, workflowRunId, status: 'running', interrupts: [] });
      },
      'workflow-interrupt': ({ workflowRunId, interrupts }) => {
        activeWorkflowId = workflowRunId || activeWorkflowId;
        renderWorkflowCard({ workflowRunId: activeWorkflowId, status: 'interrupted', interrupts });
      },
      start:        ({ count }) => addSystemMsg(`共 ${count} 条任务待执行`),
      'task-start': ({ id, title, agent }) => {
        if (activeWorkflowId) renderWorkflowCard({
          workflowRunId: activeWorkflowId,
          status: 'running',
          interrupts: [],
          next: ['run_task'],
          currentTask: { id, title, agent },
          live: { active: true, statusText: `${agent} 正在启动任务`, phase: 'starting', agent, taskId: id, taskTitle: title },
        });
        setActiveAgent(agent);
        updateTaskDot(id, 'in_progress');
        const task = allTasks.find(item => item.id === id);
        if (task) renderSessionRunningTask({ ...task, status: 'in_progress', started_at: new Date().toISOString() }, {
          taskId: id, taskTitle: title, agentKey: agent, phase: 'starting', statusText: `${agent} 正在启动`, startedAt: new Date().toISOString(),
        });
        startAgentBubble(agent, currentSessionId);
        updateAgentStatus(`${agent} 正在执行：${title}`);
        showRunningPanel({ agent, mode: '执行任务', taskTitle: title });
      },
      chunk:        ({ text }) => { appendTyping(text); bumpRunningChars('chunk', (text || '').length); bumpSessionRunningTaskMetric('output', (text || '').length); },
      thinking:     ({ text }) => { appendThinking(text); bumpRunningChars('thinking', (text || '').length); bumpSessionRunningTaskMetric('thinking', (text || '').length); },
      part:         appendTurnPart,
      activity:     activity => {
        appendAgentActivity(activity);
        updateSessionRunningTaskCard({ phase: activity.phase || 'running', currentActivity: activity, lastActivityAt: new Date().toISOString() });
        const label = activity.phase === 'completed' ? `${activity.name || '工具'} 已完成` : `正在调用 ${activity.name || '工具'}`;
        showWorkflowLive(activity.summary ? `${label}：${activity.summary}` : label, activity.phase || 'tool', { currentActivity: activity });
      },
      status:       ({ text, phase }) => {
        updateAgentStatus(text, phase);
        updateSessionRunningTaskCard({ statusText: text, phase, lastActivityAt: new Date().toISOString() });
        showWorkflowLive(text, phase || 'working');
      },
      'task-done':  ({ id, title, agent, summary }) => {
        const stats = collectFinishStats();
        const hadOutput = finishTyping(stats);
        hideRunningPanel();
        updateTaskDot(id, 'done');
        stopRunningTaskCardTimer();
        chatEl.querySelector('.session-running-task')?.remove();
        if (title && !hadOutput) addResultCard(title, agent, summary, true);
        showWorkflowLive('Agent 执行结果已保存，正在启动 Reviewer', 'review', { currentTask: { id, title, agent } });
      },
      'task-review-resume': ({ id, title, reviewer, message }) => {
        showWorkflowLive(message || '复用 Agent 结果，只重试 Reviewer', 'review', { currentTask: { id, title, reviewer } });
        // P2: 验收阶段让用户感知更强的交互反馈
        const existReview = document.getElementById(`trc-${CSS.escape(id)}`);
        if (!existReview) addTaskReviewCard({ id: `trc-${id}`, title, reviewer, verdict: 'reviewing', reason: message || '正在重新启动 Reviewer' });
      },
      'task-review-start': ({ id, title, reviewer, strategy }) => {
        addSystemMsg(`${reviewer} 正在${strategy === 'self_review' ? '自验收' : '验收'}任务「${title || ''}」…`);
        showWorkflowLive(`${reviewer || 'Reviewer'} 正在${strategy === 'self_review' ? '自验收' : '验收'}「${title || ''}」`, 'review', { currentTask: { id, title, reviewer } });
        // P2: 验收阶段开始时在聊天区插入明确的验收进度卡片
        const existReview = document.getElementById(`trc-${CSS.escape(id)}`);
        if (!existReview) addTaskReviewCard({ id: `trc-${id}`, title, reviewer: reviewer || 'Reviewer', verdict: 'reviewing', strategy, reason: `${reviewer || 'Reviewer'} 正在${strategy === 'self_review' ? '自验收' : '跨 Agent 验收'}「${title || id}」` });
      },
      'task-review-done': review => {
        // P2 修复：验收完成时统一用 trc- 前缀 id，确保替换掉验收中卡片
        review.id = review.id ? `trc-${review.id}` : review.id;
        addTaskReviewCard(review);
        if (review.verdict === 'rework') {
          showWorkflowLive('Reviewer 要求返工：当前任务将重新执行，不会进入下一任务', 'rework', {
            currentTask: { id: review.id, title: review.title, review_status: 'rework' },
          });
        } else if (review.verdict === 'pass') {
          showWorkflowLive('Reviewer 已通过，等待你的人工确认', 'gate', {
            currentTask: { id: review.id, title: review.title, review_status: 'pass' },
          });
        }
        loadTasks();
      },
      'task-review-skip': ({ id, reason }) => {
        addTaskReviewCard({ id, verdict: 'skipped', reason: reason === 'no-reviewer' ? '没有可用的 Reviewer Agent' : reason });
        loadTasks();
      },
      'task-review-failed': ({ id, title, reviewer, reason, error, retryable, code }) => {
        addTaskReviewCard({ id, reviewer, verdict: 'failed', reason: error || reason || '自动验收失败' });
        showWorkflowLive(error || reason || 'Reviewer 失败，工作流正在停止', 'review_failed', {
          currentTask: { id, title, reviewer, failure_stage: 'review', retryable, error: error || reason, review_status: 'failed' },
          error: error || reason,
          reviewErrorCode: code,
        });
        loadTasks();
      },
      'task-review-retrying': ({ reviewer, attempt, maxAttempts }) => {
        showWorkflowLive(`${reviewer || 'Reviewer'} 输出格式异常，正在进行最后一次格式修复（${attempt + 1}/${maxAttempts}）`, 'review_repair');
      },
      'task-review-repair': review => { addTaskReviewCard({ ...review, verdict: 'failed' }); loadTasks(); },
      'task-failed':({ id, title, agent, error }) => {
        finishTyping();
        hideRunningPanel();
        updateTaskDot(id, 'failed');
        addResultCard(title || id, agent || '', error, false);
        if (activeWorkflowId) renderWorkflowCard({
          workflowRunId: activeWorkflowId,
          status: 'running',
          interrupts: [],
          currentTask: { id, title, agent },
          error,
          live: { active: true, statusText: '节点失败，工作流正在安全停止', phase: 'halting', agent },
        });
      },
      'worklist-chain': ({ from, to, parent_id, chain_task_id }) => {
        finishTyping();
        addSystemMsg(`→ ${from} 触发了 @${to} 继续执行`);
      },
      paused: ({ workflowRunId, interrupts, ...state }) => {
        activeWorkflowId = workflowRunId || activeWorkflowId;
        finishTyping();
        hideRunningPanel();
        renderWorkflowCard({ ...state, workflowRunId: activeWorkflowId, status: 'interrupted', interrupts });
        void refreshWorkflowCard(activeWorkflowId, { quiet: true });
      },
      done: ({ workflowRunId, done, failed, status }) => {
        activeWorkflowId = workflowRunId || activeWorkflowId;
        hideRunningPanel();
        if (failed > 0) {
          addSystemMsg(`执行结束：${done} 成功 / ${failed} 失败，可在工作流卡片中重试失败节点。`);
        } else {
          addSystemMsg(`✓ 全部执行完毕：${done} 成功`);
        }
        if (activeWorkflowId) {
          renderWorkflowCard({ workflowRunId: activeWorkflowId, status: status || (failed ? 'failed' : 'completed'), done, failed, interrupts: [], live: { active: false } });
          void refreshWorkflowCard(activeWorkflowId, { quiet: true });
        }
      },
      error: ({ message, code }) => {
        hideRunningPanel();
        addSystemMsg(`✗ ${message}`);
        if (activeWorkflowId) renderWorkflowCard({
          workflowRunId: activeWorkflowId,
          status: code === 'workflow_adapter_unavailable' ? 'adapter_unavailable' : 'error',
          error: message,
          interrupts: [],
        });
      },
      aborted: () => {
        finishTyping();
        hideRunningPanel();
        addSystemMsg('⏹ 已中断执行，可从工作流卡片查看 checkpoint。');
        if (activeWorkflowId) void refreshWorkflowCard(activeWorkflowId, { quiet: true });
      },
    });
  } finally {
    dispatchSpinner.classList.add('hidden');
    await loadTasks();
  }
}

// ── agent 管理面板 ────────────────────────────────────────────
const settingsBtn    = document.getElementById('settingsBtn');
const settingsDrawer = document.getElementById('settingsDrawer');
const drawerMask     = document.getElementById('drawerMask');
const drawerClose    = document.getElementById('drawerClose');
const agentFormEl    = document.getElementById('agentForm');
const drawerSaveBtn  = document.getElementById('drawerSaveBtn');
const drawerSaveTip  = document.getElementById('drawerSaveTip');
const workspaceInput = document.getElementById('workspaceInput');
const workspaceSaveBtn = document.getElementById('workspaceSaveBtn');
const workspaceTip = document.getElementById('workspaceTip');
const agentAddBtn = document.getElementById('agentAddBtn');
const hubBtn         = document.getElementById('hubBtn');
const hubMask        = document.getElementById('hubMask');
const hubDrawer      = document.getElementById('hubDrawer');
const hubClose       = document.getElementById('hubClose');
const hubTabs        = document.getElementById('hubTabs');
const hubBody        = document.getElementById('hubBody');

const AGENT_META = {
  codex:  { label: 'Agent · Codex',  emoji: '🤖', desc: '总控 / 审查 / 自迭代' },
  claude: { label: 'Agent · Claude', emoji: '✨', desc: '主架构 / 深度实现' },
  kimi:   { label: 'Agent · Kimi',   emoji: '🌙', desc: '轻量执行 / 快速草稿' },
};

// 角色卡模板（参考 clowder-ai 多角色 cat 设定）
const ROLE_TEMPLATES = [
  { key: '',         label: '— 选择模板套用 —' },
  { key: 'planner',  label: '📋 规划师',
    roleDescription: '任务拆解与规划专家，把目标拆成可验收的子任务。',
    personality: '严谨、有条理、强调验收标准',
    strengths: ['任务拆解','优先级排序','验收标准撰写','依赖识别'],
    restrictions: ['不直接编码','不做最终实现决策'] },
  { key: 'architect', label: '🏛 架构师',
    roleDescription: '系统架构设计，关注技术选型、模块边界、可扩展性。',
    personality: '深度思考、追求长期可维护',
    strengths: ['架构设计','技术选型','重构方案','性能取舍'],
    restrictions: ['不写琐碎实现','不做产品决策'] },
  { key: 'implementer', label: '⚒ 实现工程师',
    roleDescription: '把已确定方案转化为可运行代码。',
    personality: '务实、追求可读性与正确性',
    strengths: ['代码实现','单测编写','调试','PR 提交'],
    restrictions: ['不擅自改架构','不跳过测试'] },
  { key: 'reviewer', label: '🔍 审查员',
    roleDescription: 'PR / 任务结果审查者，负责 Reviewer Gate 决策。',
    personality: '严格、关注细节、引用证据',
    strengths: ['代码审查','逻辑核对','安全检查','给出返工建议'],
    restrictions: ['不直接修改代码','只给评审意见'] },
  { key: 'researcher', label: '🔬 调研员',
    roleDescription: '阅读文档/源码并产出结构化报告。',
    personality: '细心、引用准确、总结清晰',
    strengths: ['资料检索','源码解读','技术对比','撰写报告'],
    restrictions: ['不做实现','不下架构结论'] },
  { key: 'writer', label: '📝 文档作者',
    roleDescription: '面向用户/开发者的文档撰写。',
    personality: '清晰、简洁、面向读者',
    strengths: ['README','使用文档','变更日志','API 说明'],
    restrictions: ['不直接编码'] },
];

function applyRoleTemplate(card, key) {
  const tpl = ROLE_TEMPLATES.find(t => t.key === key);
  if (!tpl || !tpl.key) return;
  const set = (field, value) => {
    const el = card.querySelector(`.role-input[data-field="${field}"]`);
    if (el && value !== undefined) el.value = Array.isArray(value) ? value.join('，') : value;
  };
  set('roleDescription', tpl.roleDescription);
  set('personality', tpl.personality);
  set('strengths', tpl.strengths);
  set('restrictions', tpl.restrictions);
}

let agentConfigList = [];

function agentMeta(agentKey) {
  const dynamic = agentConfigList.find(a => a.key === agentKey) || mentionAgents.find(a => a.key === agentKey);
  const fallback = AGENT_META[agentKey] || {};
  return {
    label: dynamic?.label || fallback.label || agentKey,
    emoji: dynamic?.emoji || fallback.emoji || '●',
    desc: dynamic?.desc || fallback.desc || '',
    nickname: dynamic?.nickname || '',
    avatar: dynamic?.avatar || '',
    color: dynamic?.color || { primary: '#888', secondary: '#ddd' },
  };
}

function renderAgentAvatar(agentKey) {
  const meta = agentMeta(agentKey);
  const hasImage = meta.avatar && meta.avatar.startsWith('/avatars/');
  const ringColor = meta.color?.primary || '#888';
  const displayName = meta.nickname || meta.label;
  
  if (hasImage) {
    return `<div class="agent-avatar" style="border-color:${ringColor}">
      <img src="${meta.avatar}" alt="${esc(displayName)}" />
    </div>`;
  }
  return `<div class="avatar ${agentKey}-av" style="border-color:${ringColor}">${meta.emoji}</div>`;
}

function openDrawer() {
  closeHub();
  settingsDrawer.classList.remove('hidden');
  drawerMask.classList.remove('hidden');
  loadAgentConfig();
  initStudioTemplates();
}
function closeDrawer() {
  settingsDrawer.classList.add('hidden');
  drawerMask.classList.add('hidden');
}

// ── Studio 团队模板 ────────────────────────────────────────────────────────
let studioTemplates = [];

async function initStudioTemplates() {
  const sel = document.getElementById('studioSelect');
  const applyBtn = document.getElementById('studioApplyBtn');
  const preview = document.getElementById('studioPreview');
  if (!sel) return;

  if (!studioTemplates.length) {
    try {
      const data = await fetch('/api/studio-templates').then(r => r.json());
      studioTemplates = data.templates || [];
    } catch { studioTemplates = []; }
  }

  // 填充 options
  sel.innerHTML = '<option value="">— 选择模板快速配置整个团队 —</option>'
    + studioTemplates.map(t =>
        `<option value="${esc(t.id)}">${esc(t.name)}</option>`
      ).join('');

  sel.onchange = () => {
    const tpl = studioTemplates.find(t => t.id === sel.value);
    applyBtn.disabled = !tpl;
    if (tpl) {
      preview.innerHTML = `<strong>${esc(tpl.name)}</strong> — ${esc(tpl.desc)}<br>
        角色：${tpl.agents.map(a => `<b>${esc(a.label)}</b>（${esc(a.roleDescription)}）`).join(' · ')}`;
      preview.classList.remove('hidden');
    } else {
      preview.classList.add('hidden');
    }
  };

  applyBtn.onclick = async () => {
    const tpl = studioTemplates.find(t => t.id === sel.value);
    if (!tpl) return;
    if (!confirm(`应用「${tpl.name}」模板？\n这会覆盖所有 agent 的角色卡（路径/API Key/模型不变）。`)) return;
    applyBtn.disabled = true;
    applyBtn.textContent = '应用中…';
    try {
      const res = await fetch('/api/studio-templates/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: tpl.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '应用失败');
      addSystemMsg(`✓ 已应用团队模板「${data.template}」，角色卡已更新。`);
      preview.innerHTML = `✅ 已应用「${esc(data.template)}」`;
      sel.value = '';
      applyBtn.disabled = true;
      applyBtn.textContent = '一键应用';
      await loadAgentConfig(); // 刷新表单
    } catch (err) {
      addSystemMsg(`✗ 模板应用失败：${err.message}`);
      applyBtn.disabled = false;
      applyBtn.textContent = '一键应用';
    }
  };
}

settingsBtn.onclick = openDrawer;
drawerClose.onclick = closeDrawer;
drawerMask.onclick  = closeDrawer;

// ── Hub 指挥抽屉 ─────────────────────────────────────────────
let hubActiveTab = 'overview';
let hubState = { agents: [], tasks: [], skills: [], selectedSkills: [], skillsSummary: null, skillContextPreview: '', skillUsage: [], invocations: [], invocationSummary: null, costLedger: { rows: [], summary: {} }, lessons: [], subagents: [], subagentSummary: null, approvals: [], audit: [], schedules: [], scheduleRuns: [] };

function openHub() {
  closeDrawer();
  hubDrawer.classList.remove('hidden');
  hubMask.classList.remove('hidden');
  loadHub();
}

function closeHub() {
  hubDrawer.classList.add('hidden');
  hubMask.classList.add('hidden');
}

async function loadHub() {
  hubBody.innerHTML = '<div class="hub-loading">正在读取本地状态…</div>';
  try {
    const skillText = goalInput?.value?.trim() || '';
    // 根据当前输入框、模式和拆任务 agent，按需选择本次真正需要注入的 skill。
    const skillPhase = getMode() === 'plan' ? 'plan' : 'run';
    const skillAgent = planAgentGroupEl.querySelector('.radio-btn.active')?.dataset.value || '';
    const skillUrl = `/api/skills?phase=${encodeURIComponent(skillPhase)}&agent=${encodeURIComponent(skillAgent)}&text=${encodeURIComponent(skillText)}`;
    const sessionQuery = encodeURIComponent(currentSessionId || '');
    const [status, taskData, skillData, skillUsageData, invocationData, costData, lessonData, subagentData, approvalData, auditData, scheduleData, scheduleRunData] = await Promise.all([
      fetch('/api/status').then(r => r.json()),
      fetch('/api/tasks').then(r => r.json()).catch(() => ({ tasks: [] })),
      fetch(skillUrl).then(r => r.json()).catch(() => ({ skills: [], selected: [], summary: null, contextPreview: '' })),
      fetch('/api/skills/usage?sessionId=' + sessionQuery).then(r => r.json()).catch(() => ({ usage: [] })),
      fetch('/api/invocations?sessionId=' + sessionQuery).then(r => r.json()).catch(() => ({ invocations: [], summary: null })),
      fetch('/api/cost-ledger?sessionId=' + sessionQuery).then(r => r.json()).catch(() => ({ rows: [], summary: {} })),
      fetch('/api/lessons').then(r => r.json()).catch(() => ({ lessons: [] })),
      fetch('/api/subagents?sessionId=' + encodeURIComponent(currentSessionId || '')).then(r => r.json()).catch(() => ({ runs: [], summary: null })),
      fetch('/api/approvals').then(r => r.json()).catch(() => ({ approvals: [] })),
      fetch('/api/audit?limit=100').then(r => r.json()).catch(() => ({ events: [] })),
      fetch('/api/schedules').then(r => r.json()).catch(() => ({ schedules: [] })),
      fetch('/api/schedule-runs').then(r => r.json()).catch(() => ({ runs: [] })),
    ]);
    hubState = {
      agents: status.agents || [],
      tasks: taskData.tasks || [],
      skills: skillData.skills || [],
      selectedSkills: skillData.selected || [],
      skillsSummary: skillData.summary || null,
      skillContextPreview: skillData.contextPreview || '',
      skillUsage: skillUsageData.usage || [],
      invocations: invocationData.invocations || [],
      invocationSummary: invocationData.summary || null,
      costLedger: costData || { rows: [], summary: {} },
      lessons: lessonData.lessons || [],
      subagents: subagentData.runs || [],
      subagentSummary: subagentData.summary || null,
      approvals: approvalData.approvals || [],
      audit: auditData.events || [],
      schedules: scheduleData.schedules || [],
      scheduleRuns: scheduleRunData.runs || [],
    };
    renderHub();
  } catch (err) {
    hubBody.innerHTML = `<div class="hub-empty">Hub 加载失败：${esc(err.message || err)}</div>`;
  }
}

function taskStats(tasks) {
  const stats = { total: tasks.length, pending: 0, in_progress: 0, done: 0, failed: 0, runs: new Set() };
  tasks.forEach(t => {
    if (stats[t.status] !== undefined) stats[t.status]++;
    if (t.run_id) stats.runs.add(t.run_id);
  });
  return { ...stats, runs: stats.runs.size };
}

function gateStats(tasks) {
  const stats = { needsReview: 0, passed: 0, rework: 0, blocked: 0 };
  tasks.forEach(t => {
    if (t.gate_status === 'passed') stats.passed++;
    else if (t.gate_status === 'rework') stats.rework++;
    else if (t.status === 'failed') stats.blocked++;
    else if (t.status === 'done') stats.needsReview++;
  });
  return stats;
}

function gateBadge(task) {
  if (task.gate_status === 'passed') return { tone: 'ok', text: '已通过' };
  if (task.gate_status === 'rework') return { tone: 'warn', text: '需返工' };
  if (task.status === 'failed') return { tone: 'err', text: '失败阻塞' };
  if (task.status === 'done') return { tone: 'info', text: '待审核' };
  return { tone: 'warn', text: task.status || 'pending' };
}

function formatDuration(ms) {
  const n = Number(ms || 0);
  if (!n) return '-';
  if (n < 1000) return `${n}ms`;
  const sec = n / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

function agentTone(agent) {
  if (agent.available) return 'ok';
  if (agent.configured || agent.exists) return 'err';
  return 'warn';
}

function statusText(agent) {
  if (agent.available) return '可启动';
  return agent.error || (agent.configured ? '不可启动' : '未配置');
}

function renderHub() {
  hubTabs.querySelectorAll('.hub-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === hubActiveTab);
  });
  hubBody.scrollTop = 0;
  let renderer;
  if (hubActiveTab === 'agents') renderer = renderHubAgents;
  else if (hubActiveTab === 'skills') renderer = renderHubSkills;
  else if (hubActiveTab === 'lessons') renderer = renderHubLessons;
  else if (hubActiveTab === 'invocations') renderer = renderHubInvocations;
  else if (hubActiveTab === 'costs') renderer = renderHubCosts;
  else if (hubActiveTab === 'gate') renderer = renderHubGate;
  else if (hubActiveTab === 'subagents') renderer = renderHubSubagents;
  else if (hubActiveTab === 'approvals') renderer = renderHubApprovals;
  else if (hubActiveTab === 'schedules') renderer = renderHubSchedules;
  else if (hubActiveTab === 'tasks') renderer = renderHubTasks;
  else renderer = renderHubOverview;
  renderer();
  hubBody.insertAdjacentHTML('afterbegin', hubTabIntro(hubActiveTab));
}

function hubTabIntro(tab) {
  const map = {
    overview:    { icon: '📊', title: '总览', desc: 'agent / 任务 / 调用 / 课程的整体快照。点 KPI 数字可跳转对应 tab。' },
    agents:      { icon: '🤖', title: 'Agent 管理', desc: '查看并配置 CLI 路径、Base URL、API Key、模型、角色卡。可使用模板快速套用。' },
    skills:      { icon: '🧩', title: 'Skills 路由', desc: '配置按需、常驻或手动加载，并按当前会话追溯每一次真实命中。' },
    lessons:     { icon: '📚', title: 'Lessons 风险记忆', desc: '失败经验会在后续相似任务中作为风险上下文注入；任务删除后仍保留来源快照。' },
    invocations: { icon: '⏱', title: '调用追踪', desc: '当前会话的 agent 调用：做了什么、属于哪个任务、用了哪些 Skill/Lesson、结果如何。' },
    costs:       { icon: '💰', title: '任务成本账本', desc: '按任务/会话汇总调用次数、耗时、失败和估算 Token；通过 Gate 才计为已验收。' },
    gate:        { icon: '🚦', title: 'Reviewer Gate', desc: '任务完成后的人工通过 / 返工节点。后续将由 reviewer agent 自动审。' },
    subagents:   { icon: '⑂', title: '子代理运行', desc: '结构化 spawn_subagent 派生的运行记录、状态和结果。' },
    approvals:   { icon: '✓', title: '审批与审计', desc: '敏感操作必须由服务端签发审批，批准后的操作指纹必须完全匹配。' },
    schedules:   { icon: '◷', title: '定时任务', desc: 'Cron 触发后默认暂停等待审批，同一计划不会并发重入。' },
    tasks:       { icon: '📋', title: '任务清单', desc: 'pending / in_progress / done / failed 全量任务。可点 ▶ 重跑或查看 lesson。' },
  };
  const m = map[tab] || { icon: '·', title: tab, desc: '' };
  return `<div class="hub-tab-intro">
    <span class="hub-tab-intro-icon">${m.icon}</span>
    <div class="hub-tab-intro-text">
      <strong>${esc(m.title)}</strong>
      <span>${esc(m.desc)}</span>
    </div>
  </div>`;
}

function renderHubOverview() {
  const stats = taskStats(hubState.tasks);
  const gates = gateStats(hubState.tasks);
  const available = hubState.agents.filter(a => a.available).length;
  hubBody.innerHTML = `
    <div class="hub-kpi-grid">
      <div class="hub-kpi"><div class="hub-kpi-label">可启动 Agent</div><div class="hub-kpi-value">${available}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">技能数</div><div class="hub-kpi-value">${hubState.skills.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">调用数</div><div class="hub-kpi-value">${hubState.invocationSummary?.total || 0}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">失败</div><div class="hub-kpi-value">${stats.failed}</div></div>
    </div>
    <section class="hub-section">
      <div class="hub-section-title">自迭代闭环 <span class="hub-mini-note">myteam MVP 当前骨架</span></div>
      <div class="hub-flow">
      <div class="hub-flow-step"><strong>goal / plan</strong><span>用户目标进入拆任务模式，生成可验收任务。</span></div>
      <div class="hub-flow-step"><strong>assign / run</strong><span>按 agent 字段分发，执行记录写入 tasks。</span></div>
      <div class="hub-flow-step"><strong>review / test</strong><span>Hub Gate 已能人工通过或要求返工，待审核 ${gates.needsReview} 条。</span></div>
      <div class="hub-flow-step"><strong>learn / backlog</strong><span>失败写 lessons，通过 Gate 后再沉淀长期经验。</span></div>
      </div>
    </section>
    <section class="hub-section">
      <div class="hub-section-title">下一步路线 <span class="hub-mini-note">只展示可执行方向</span></div>
      <div class="hub-list">
        <div class="hub-row"><div class="hub-row-main"><div class="hub-row-title">Reviewer Agent 自动审</div><div class="hub-row-meta">当前是人工 Gate；下一步让 reviewer agent 读取验收标准自动给结论。</div></div><span class="hub-badge info">下一步</span></div>
        <div class="hub-row"><div class="hub-row-main"><div class="hub-row-title">真实成本统计</div><div class="hub-row-meta">当前已有调用次数和耗时；下一步接 token/usage。</div></div><span class="hub-badge warn">待做</span></div>
        <div class="hub-row"><div class="hub-row-main"><div class="hub-row-title">Backlog 视图</div><div class="hub-row-meta">把返工、失败和下一轮建议沉淀成任务生命周期。</div></div><span class="hub-badge info">可扩展</span></div>
      </div>
      <div class="hub-actions">
        <button class="hub-action-btn" data-hub-action="plan">切到拆任务</button>
        <button class="hub-action-btn" data-hub-action="tasks">展开任务面板</button>
      </div>
    </section>`;
  hubBody.querySelectorAll('.hub-section').forEach(section => {
    if (section.textContent.includes('下一步路线')) section.remove();
  });
  bindHubActions();
}

function renderHubSubagents() {
  const runs = hubState.subagents || [];
  const summary = hubState.subagentSummary || { total: runs.length, running: 0, done: 0, error: 0 };
  const statusMeta = {
    running: { tone: 'info', label: '运行中' },
    done: { tone: 'ok', label: '已完成' },
    error: { tone: 'err', label: '失败' },
  };
  hubBody.innerHTML = `
    <div class="hub-kpi-grid">
      <div class="hub-kpi"><div class="hub-kpi-label">总运行</div><div class="hub-kpi-value">${summary.total || 0}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">运行中</div><div class="hub-kpi-value">${summary.running || 0}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">已完成</div><div class="hub-kpi-value">${summary.done || 0}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">失败</div><div class="hub-kpi-value">${summary.error || 0}</div></div>
    </div>
    <section class="hub-section">
      <div class="hub-section-title">Subagent runs <span class="hub-mini-note">spawn_subagent 生命周期</span></div>
      <div class="hub-list">
        ${runs.length ? runs.map(run => {
          const meta = statusMeta[run.status] || statusMeta.error;
          return `<div class="hub-row">
            <div class="hub-row-main">
              <div class="hub-row-title">${esc(run.label || run.task || run.id)}</div>
              <div class="hub-row-meta">${esc(run.agent || 'unknown')} · ${esc(run.taskId || run.id)}</div>
              ${run.error ? `<div class="hub-row-meta">${esc(run.error)}</div>` : ''}
            </div>
            <div class="hub-row-side">
              <span class="hub-badge ${meta.tone}">${meta.label}</span>
              <button class="hub-mini-btn" data-subagent-run="${esc(run.id)}">查看</button>
            </div>
          </div>`;
        }).join('') : '<div class="hub-empty">暂无子代理运行。执行任务时 agent 可通过 spawn_subagent 协议派生。</div>'}
      </div>
    </section>`;
  hubBody.querySelectorAll('[data-subagent-run]').forEach(btn => {
    btn.onclick = () => {
      const run = runs.find(item => item.id === btn.dataset.subagentRun);
      if (run && window.openSubagentSession) {
        window.openSubagentSession(run.taskId || run.id, run.label || run.task, run.agent);
        closeHub();
      }
    };
  });
}

function renderHubApprovals() {
  const pending = hubState.approvals.filter(item => item.status === 'pending');
  const statusTone = { pending: 'warn', approved: 'ok', consumed: 'info', denied: 'err', expired: 'err' };
  hubBody.innerHTML = `
    <div class="hub-kpi-grid">
      <div class="hub-kpi"><div class="hub-kpi-label">待审批</div><div class="hub-kpi-value">${pending.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">审批记录</div><div class="hub-kpi-value">${hubState.approvals.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">审计事件</div><div class="hub-kpi-value">${hubState.audit.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">默认有效期</div><div class="hub-kpi-value">15m</div></div>
    </div>
    <section class="hub-section">
      <div class="hub-section-title">待处理审批</div>
      <div class="hub-list">
        ${pending.length ? pending.map(item => `<div class="hub-row">
          <div class="hub-row-main">
            <div class="hub-row-title">${esc(item.title || item.operation)}</div>
            <div class="hub-row-meta">${esc(approvalRiskLabel(item.risk))} · ${esc(new Date(item.requestedAt).toLocaleString())}</div>
            <div class="hub-approval-reason">${esc(item.reason || '此操作需要明确批准后才能继续。')}</div>
            <div class="approval-context hub-approval-context">${approvalContextRows(item).map(([label, value]) => `<div class="approval-context-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
          </div>
          <div class="hub-row-side approval-actions">
            <button class="hub-mini-btn" data-approval-id="${esc(item.id)}" data-decision="approve_once">批准一次</button>
            ${item.sessionId ? `<button class="hub-mini-btn" data-approval-id="${esc(item.id)}" data-decision="approve_session">本会话批准</button>` : ''}
            <button class="hub-mini-btn danger" data-approval-id="${esc(item.id)}" data-decision="deny">拒绝</button>
          </div>
        </div>`).join('') : '<div class="hub-empty">当前没有待审批操作。</div>'}
      </div>
    </section>
    <section class="hub-section">
      <div class="hub-section-title">最近审计 <span class="hub-mini-note">敏感字段已脱敏</span></div>
      <div class="hub-list">
        ${hubState.audit.slice(0, 30).map(event => `<div class="hub-row">
          <div class="hub-row-main"><div class="hub-row-title">${esc(event.operation)}</div><div class="hub-row-meta">${esc(event.decision || '-')} · ${esc(event.result || '-')} · ${esc(new Date(event.timestamp).toLocaleString())}</div></div>
          <span class="hub-badge ${statusTone[event.result] || (event.result === 'succeeded' ? 'ok' : 'info')}">${esc(event.risk || 'low')}</span>
        </div>`).join('') || '<div class="hub-empty">暂无审计事件。</div>'}
      </div>
    </section>`;
  hubBody.querySelectorAll('[data-approval-id]').forEach(button => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        const res = await fetch(`/api/approvals/${encodeURIComponent(button.dataset.approvalId)}/decision`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: button.dataset.decision }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '审批失败');
        await loadHub();
      } catch (error) {
        addSystemMsg(`审批失败：${error.message}`);
        button.disabled = false;
      }
    };
  });
}

function renderHubSchedules() {
  const runBySchedule = new Map();
  hubState.scheduleRuns.forEach(run => { if (!runBySchedule.has(run.scheduleId)) runBySchedule.set(run.scheduleId, run); });
  const running = hubState.scheduleRuns.filter(run => ['running', 'waiting_approval'].includes(run.status)).length;
  hubBody.innerHTML = `
    <div class="hub-kpi-grid">
      <div class="hub-kpi"><div class="hub-kpi-label">计划数</div><div class="hub-kpi-value">${hubState.schedules.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">已启用</div><div class="hub-kpi-value">${hubState.schedules.filter(item => item.enabled).length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">活动运行</div><div class="hub-kpi-value">${running}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">运行记录</div><div class="hub-kpi-value">${hubState.scheduleRuns.length}</div></div>
    </div>
    <section class="hub-section schedule-create">
      <div class="hub-section-title">新建计划</div>
      <div class="schedule-form">
        <input id="scheduleName" placeholder="名称" maxlength="100">
        <input id="scheduleCron" placeholder="Cron，例如 0 9 * * 1-5" value="0 9 * * 1-5">
        <input id="scheduleTimezone" placeholder="时区" value="${esc(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}">
        <select id="scheduleAgent"><option value="codex">Codex</option><option value="claude">Claude</option><option value="kimi">Kimi</option></select>
        <select id="scheduleMode"><option value="chat">对话执行</option><option value="plan">拆解计划</option><option value="dispatch">任务执行</option></select>
        <textarea id="scheduleGoal" placeholder="定时任务目标"></textarea>
        <button class="hub-action-btn" id="scheduleCreateBtn">创建</button>
      </div>
    </section>
    <section class="hub-section">
      <div class="hub-section-title">计划列表</div>
      <div class="hub-list">
        ${hubState.schedules.length ? hubState.schedules.map(item => {
          const lastRun = runBySchedule.get(item.id);
          return `<div class="hub-row">
            <div class="hub-row-main">
              <div class="hub-row-title">${esc(item.name)}</div>
              <div class="hub-row-meta">${esc(item.expression)} · ${esc(item.timezone)} · ${esc(item.agent)} / ${esc(item.mode)}</div>
              <div class="hub-row-meta">下次：${esc(new Date(item.nextRunAt).toLocaleString())}${lastRun ? ` · 最近：${esc(lastRun.status)}` : ''}</div>
            </div>
            <div class="hub-row-side schedule-actions">
              <label class="skill-toggle" title="启用或暂停"><input type="checkbox" data-schedule-toggle="${esc(item.id)}" ${item.enabled ? 'checked' : ''}><span class="skill-toggle-track"><span class="skill-toggle-thumb"></span></span></label>
              <button class="hub-mini-btn" data-schedule-run="${esc(item.id)}">运行</button>
              <button class="hub-mini-btn danger" data-schedule-delete="${esc(item.id)}">删除</button>
            </div>
          </div>`;
        }).join('') : '<div class="hub-empty">暂无定时任务。</div>'}
      </div>
    </section>
    <section class="hub-section">
      <div class="hub-section-title">运行历史</div>
      <div class="hub-list">${hubState.scheduleRuns.slice(0, 30).map(run => `<div class="hub-row"><div class="hub-row-main"><div class="hub-row-title">${esc(run.scheduleId)}</div><div class="hub-row-meta">${esc(run.status)} · ${esc(new Date(run.createdAt).toLocaleString())}${run.error ? ` · ${esc(run.error)}` : ''}</div></div></div>`).join('') || '<div class="hub-empty">暂无运行记录。</div>'}</div>
    </section>`;

  document.getElementById('scheduleCreateBtn').onclick = async () => {
    const payload = {
      name: document.getElementById('scheduleName').value.trim(),
      expression: document.getElementById('scheduleCron').value.trim(),
      timezone: document.getElementById('scheduleTimezone').value.trim(),
      agent: document.getElementById('scheduleAgent').value,
      mode: document.getElementById('scheduleMode').value,
      goal: document.getElementById('scheduleGoal').value.trim(),
    };
    try {
      const res = await fetch('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建失败');
      await loadHub();
    } catch (error) { addSystemMsg(`创建定时任务失败：${error.message}`); }
  };
  hubBody.querySelectorAll('[data-schedule-toggle]').forEach(input => {
    input.onchange = async () => {
      await fetch(`/api/schedules/${encodeURIComponent(input.dataset.scheduleToggle)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: input.checked }) });
      await loadHub();
    };
  });
  hubBody.querySelectorAll('[data-schedule-run]').forEach(button => {
    button.onclick = async () => {
      await fetch(`/api/schedules/${encodeURIComponent(button.dataset.scheduleRun)}/run`, { method: 'POST' });
      await loadHub();
    };
  });
  hubBody.querySelectorAll('[data-schedule-delete]').forEach(button => {
    button.onclick = async () => {
      if (!confirm('确定删除这个定时任务？')) return;
      await fetch(`/api/schedules/${encodeURIComponent(button.dataset.scheduleDelete)}`, { method: 'DELETE' });
      await loadHub();
    };
  });
}

const REVIEW_SCORECARD_LABELS = {
  correctness: '结果正确',
  completeness: '交付完整',
  evidence: '证据充分',
  safety: '风险可接受',
};

function renderHubGate() {
  const stats = gateStats(hubState.tasks);
  const gateTasks = [...hubState.tasks]
    .filter(t => t.status === 'done' || t.status === 'failed' || t.gate_status === 'rework' || t.gate_status === 'passed')
    .slice(-10)
    .reverse();
  hubBody.innerHTML = `
    <div class="hub-kpi-grid">
      <div class="hub-kpi"><div class="hub-kpi-label">待审核</div><div class="hub-kpi-value">${stats.needsReview}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">已通过</div><div class="hub-kpi-value">${stats.passed}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">需返工</div><div class="hub-kpi-value">${stats.rework}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">失败阻塞</div><div class="hub-kpi-value">${stats.blocked}</div></div>
    </div>
    <section class="hub-section">
      <div class="hub-section-title">Reviewer Gate <span class="hub-mini-note">MVP 先人工确认，后续接 reviewer agent</span></div>
      <div class="hub-list">
        ${gateTasks.length ? gateTasks.map(t => {
          const badge = gateBadge(t);
          const canReview = t.status === 'done' && t.gate_status !== 'passed';
          const findings = Array.isArray(t.review_findings) ? t.review_findings : [];
          const priorScorecard = t.review_scorecard && typeof t.review_scorecard === 'object'
            ? Object.entries(REVIEW_SCORECARD_LABELS).map(([key, label]) => `${t.review_scorecard[key] ? '✓' : '○'} ${label}`).join(' · ')
            : '';
          return `<div class="hub-row gate-task-row">
            <div class="hub-row-main">
              <div class="hub-row-title">${esc(t.title || t.id)}</div>
              <div class="hub-row-meta">${esc(t.agent || 'unknown')} · ${esc(t.run_id || '无 run')} · ${esc(t.accept || '无验收说明')}</div>
              ${t.review_status ? `<div class="gate-auto-review">
                <strong>自动审查：${esc(t.review_status)}${Number.isFinite(Number(t.review_score)) ? ` · ${Number(t.review_score)} 分` : ''}</strong>
                ${t.review_note ? `<span>${esc(t.review_note)}</span>` : ''}
                ${findings.length ? `<ul>${findings.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
              </div>` : ''}
              ${t.review_note ? `<div class="hub-row-meta">Gate 说明：${esc(t.review_note)}</div>` : ''}
              ${canReview ? `<div class="gate-review-card" data-gate-card="${esc(t.id)}">
                <div class="gate-scorecard-title">人工验收评分卡 <span>全部确认后才可通过</span></div>
                <div class="gate-scorecard-options">
                  ${Object.entries(REVIEW_SCORECARD_LABELS).map(([key, label]) => `<label><input type="checkbox" data-score-key="${key}"> ${label}</label>`).join('')}
                </div>
                <textarea class="gate-review-note" rows="2" placeholder="通过时可补充说明；返工时请写清需要修改的内容"></textarea>
                <div class="gate-scorecard-actions">
                  <button class="hub-mini-btn" data-hub-action="gate-pass" data-task-id="${esc(t.id)}" disabled>确认通过</button>
                  <button class="hub-mini-btn danger" data-hub-action="gate-rework" data-task-id="${esc(t.id)}" disabled>要求返工</button>
                </div>
              </div>` : priorScorecard ? `<div class="gate-scorecard-history">${esc(priorScorecard)}</div>` : ''}
            </div>
            <div class="hub-row-side">
              <span class="hub-badge ${badge.tone}">${badge.text}</span>
            </div>
          </div>`;
        }).join('') : '<div class="hub-empty">暂无可审核任务。执行任务完成后，这里会出现 Gate 操作。</div>'}
      </div>
    </section>
    <section class="hub-section">
      <div class="hub-section-title">规则 <span class="hub-mini-note">防止自迭代失控</span></div>
      <div class="hub-list">
        <div class="hub-row"><div class="hub-row-main"><div class="hub-row-title">通过 Gate</div><div class="hub-row-meta">任务保持 done，并写入 review_status=passed / test_status=manual_passed。</div></div><span class="hub-badge ok">可沉淀</span></div>
        <div class="hub-row"><div class="hub-row-main"><div class="hub-row-title">要求返工</div><div class="hub-row-meta">任务回到 pending，下一次执行会带上返工说明和上一次结果摘要。</div></div><span class="hub-badge warn">再执行</span></div>
      </div>
    </section>`;
  bindHubActions();
  bindGateScorecards();
}

function bindGateScorecards() {
  hubBody.querySelectorAll('.gate-review-card').forEach(card => {
    const checks = [...card.querySelectorAll('[data-score-key]')];
    const note = card.querySelector('.gate-review-note');
    const pass = card.querySelector('[data-hub-action="gate-pass"]');
    const rework = card.querySelector('[data-hub-action="gate-rework"]');
    const update = () => {
      pass.disabled = !checks.every(input => input.checked);
      rework.disabled = !note.value.trim();
    };
    checks.forEach(input => input.addEventListener('change', update));
    note.addEventListener('input', update);
    update();
  });
}

function renderHubAgents() {
  hubBody.innerHTML = `
    <section class="hub-section">
      <div class="hub-section-title">Agent 状态 <span class="hub-mini-note">启动级检测，不只看文件是否存在</span></div>
      <div class="hub-list">
        ${hubState.agents.map(a => {
          const meta = AGENT_META[a.key] || { label: a.key, desc: '' };
          return `<div class="hub-row">
            <div class="hub-row-main">
              <div class="hub-row-title">${esc(meta.label)}</div>
              <div class="hub-row-meta">${esc(meta.desc)} · ${esc(a.path || '未配置路径')}</div>
              ${a.available ? '' : `<div class="hub-row-meta">${esc(a.error || '')}</div>`}
            </div>
            <span class="hub-badge ${agentTone(a)}">${esc(statusText(a))}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="hub-actions">
        <button class="hub-action-btn" data-hub-action="settings">打开 Agent 配置</button>
      </div>
    </section>`;
  bindHubActions();
}

function renderHubSkills() {
  const categories = [...new Set(hubState.skills.map(s => s.category).filter(Boolean))];
  const selectedNames = new Set(hubState.selectedSkills.map(s => s.name));
  const enabled = hubState.skills.filter(s => s.enabled !== false);
  const disabled = hubState.skills.filter(s => s.enabled === false);

  const mountKeys = ['controller', 'worker', 'reviewer', 'codex', 'claude', 'kimi'];

  function skillCard(skill, { showMounts = false, showInstall = false, installed = false } = {}) {
    const isEnabled = skill.enabled !== false;
    const isSelected = selectedNames.has(skill.name);
    const loadingLabels = { on_demand: '按需命中', always: '常驻加载', manual: '手动指定' };
    const mountsHtml = showMounts ? `
      <div class="skill-install-tip">加载策略：
        <select class="skill-loading-select" data-skill="${esc(skill.name)}">
          ${Object.entries(loadingLabels).map(([value, label]) => `<option value="${value}" ${skill.loading === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <span>手动模式用 @skill:${esc(skill.name)} 指定</span>
      </div>
      <div class="skill-mounts">
        ${mountKeys.map(k => `
          <label class="skill-mount-label">
            <input type="checkbox" class="skill-mount-cb" data-skill="${esc(skill.name)}" data-mount="${k}"
              ${skill.mounts?.[k] ? 'checked' : ''}>
            <span>${esc(k)}</span>
          </label>`).join('')}
      </div>` : '';

    const actionsHtml = showInstall
      ? `<button class="skill-install-btn ${installed ? 'installed' : ''}"
           data-skill="${esc(skill.name)}" data-source="${esc(skill.source || 'clowder-ai')}"
           ${installed ? 'disabled' : ''}>${installed ? '✓ 已安装' : '⬇ 安装'}</button>`
      : `<label class="skill-toggle" title="${isEnabled ? '点击禁用' : '点击启用'}">
           <input type="checkbox" class="skill-toggle-cb" data-skill="${esc(skill.name)}" ${isEnabled ? 'checked' : ''}>
           <span class="skill-toggle-track"><span class="skill-toggle-thumb"></span></span>
         </label>
         <button class="skill-uninstall-btn" data-skill="${esc(skill.name)}" title="卸载">🗑</button>`;

    return `<div class="skill-card ${isEnabled ? '' : 'disabled'} ${isSelected ? 'matched' : ''}">
      <div class="skill-card-header">
        <span class="skill-card-name">${esc(skill.name)}</span>
        <span class="skill-card-cat">${esc(skill.category || 'general')}</span>
        ${isSelected ? '<span class="skill-matched-badge">命中</span>' : ''}
        <div class="skill-card-actions">${actionsHtml}</div>
      </div>
      <div class="skill-card-desc">${esc((skill.description || skill.trigger || '').slice(0, 120))}</div>
      ${mountsHtml}
    </div>`;
  }

  hubBody.innerHTML = `
    <div class="hub-kpi-grid">
      <div class="hub-kpi"><div class="hub-kpi-label">技能总数</div><div class="hub-kpi-value">${hubState.skills.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">分类</div><div class="hub-kpi-value">${categories.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">当前会话命中</div><div class="hub-kpi-value">${hubState.skillUsage.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">加载策略</div><div class="hub-kpi-value">3 种</div></div>
    </div>

    <div class="skill-tabs">
      <button class="skill-tab active" data-stab="loaded">命中溯源 <span class="skill-tab-count">${hubState.skillUsage.length}</span></button>
      <button class="skill-tab" data-stab="preview-hit">当前输入预览 <span class="skill-tab-count">${hubState.selectedSkills.length}</span></button>
      <button class="skill-tab" data-stab="installed">已安装 <span class="skill-tab-count">${hubState.skills.length}</span></button>
      <button class="skill-tab" data-stab="market">🛒 市场</button>
      <button class="skill-tab" data-stab="preview">Prompt 预览</button>
    </div>

    <div class="skill-tab-panel" data-spanel="loaded">
      ${hubState.skillUsage.length ? hubState.skillUsage.slice(0, 30).map(u => `<div class="hub-row">
        <div class="hub-row-main"><div class="hub-row-title">${esc(u.skill)} · ${esc(u.agent || 'unknown')}</div>
        <div class="hub-row-meta">${esc(u.mode || 'call')} · ${esc(u.task_title || u.task_id || '会话调用')} · invocation ${esc(u.invocation_id)}</div>
        <div class="hub-row-meta">${esc(u.timestamp || '')} · ${esc(u.loading || 'on_demand')} / ${esc(u.reason || 'matched')}</div></div>
        <span class="hub-badge ${u.status === 'success' ? 'ok' : u.status === 'interrupted' ? 'warn' : 'err'}">${esc(u.status || 'unknown')}</span>
      </div>`).join('') : '<div class="hub-empty">当前会话还没有真实 Skill 调用记录。这里不会再用输入框预估值冒充命中次数。</div>'}
    </div>

    <div class="skill-tab-panel hidden" data-spanel="preview-hit">
      ${hubState.selectedSkills.length ? hubState.selectedSkills.map(s => skillCard(s, { showMounts: false })).join('') : '<div class="hub-empty">当前输入没有匹配到 Skill。</div>'}
    </div>

    <div class="skill-tab-panel hidden" data-spanel="installed">
      <div class="skill-install-tip">挂载复选框控制该 skill 注入哪些角色/agent 的 prompt。</div>
      ${hubState.skills.length
        ? hubState.skills.map(s => skillCard(s, { showMounts: true })).join('')
        : '<div class="hub-empty">还没有安装任何 skill。去市场 Tab 安装。</div>'}
    </div>

    <div class="skill-tab-panel hidden" data-spanel="market">
      <div class="skill-market-bar">
        <div class="skill-source-btns">
          <button class="skill-src-btn active" data-src="myteam-official">myteam 官方</button>
          <button class="skill-src-btn" data-src="clowder-ai">clowder-ai</button>
        </div>
        <input class="skill-search-input" placeholder="搜索 skill…" />
      </div>
      <div class="skill-market-list" id="skillMarketList">
        <div class="hub-loading">点击上方源名称加载市场列表…</div>
      </div>
    </div>

    <div class="skill-tab-panel hidden" data-spanel="preview">
      <div class="hub-section-title">注入给 agent 的 Prompt 摘要 <span class="hub-mini-note">仅展示 enabled + 命中的部分</span></div>
      <pre class="hub-code-block">${esc(hubState.skillContextPreview || '暂无匹配 skill。')}</pre>
    </div>
  `;

  // ── Tab 切换 ──
  hubBody.querySelectorAll('.skill-tab').forEach(btn => {
    btn.onclick = () => {
      hubBody.querySelectorAll('.skill-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.stab;
      hubBody.querySelectorAll('.skill-tab-panel').forEach(p => {
        p.classList.toggle('hidden', p.dataset.spanel !== target);
      });
    };
  });

  // ── 启用/禁用 Toggle ──
  hubBody.querySelectorAll('.skill-toggle-cb').forEach(cb => {
    cb.onchange = async () => {
      const name = cb.dataset.skill;
      await fetch(`/api/skills/${encodeURIComponent(name)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: cb.checked }),
      });
      await loadHub();
    };
  });

  // ── 挂载 Checkbox ──
  hubBody.querySelectorAll('.skill-mount-cb').forEach(cb => {
    cb.onchange = async () => {
      const name = cb.dataset.skill;
      const mount = cb.dataset.mount;
      await fetch(`/api/skills/${encodeURIComponent(name)}/mounts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [mount]: cb.checked }),
      });
    };
  });

  // ── 卸载按钮 ──
  hubBody.querySelectorAll('.skill-uninstall-btn').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.skill;
      if (!confirm(`确认卸载 skill: ${name}？`)) return;
      await fetchWithApproval(`/api/skills/${encodeURIComponent(name)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      await loadHub();
    };
  });

  // ── 市场源切换 ──
  let currentMarketSrc = 'myteam-official';
  const marketCache = skillRegistryCache;

  async function loadMarket(src) {
    currentMarketSrc = src;
    hubBody.querySelectorAll('.skill-src-btn').forEach(b => b.classList.toggle('active', b.dataset.src === src));
    const listEl = document.getElementById('skillMarketList');
    if (!listEl) return;
    if (marketCache[src]) { renderMarketList(marketCache[src].skills || [], listEl); return; }
    listEl.innerHTML = '<div class="hub-loading">加载中…</div>';
    try {
      const data = await fetchSkillRegistry(src);
      if (currentMarketSrc !== src || !listEl.isConnected) return;
      renderMarketList(data.skills || [], listEl);
    } catch (err) {
      listEl.innerHTML = `<div class="hub-empty">加载失败：${esc(err.message)}</div>`;
    }
  }

  function renderMarketList(skills, container, filter = '') {
    const lower = filter.toLowerCase();
    const filtered = filter ? skills.filter(s =>
      s.name.includes(lower) || (s.description || '').toLowerCase().includes(lower) ||
      (s.category || '').toLowerCase().includes(lower)
    ) : skills;

    container.innerHTML = filtered.length ? filtered.map(s => `
      <div class="skill-card ${s.installed ? 'installed' : ''}">
        <div class="skill-card-header">
          <span class="skill-card-name">${esc(s.name)}</span>
          <span class="skill-card-cat">${esc(s.category || 'general')}</span>
          <div class="skill-card-actions">
            <button class="skill-install-btn ${s.installed ? 'installed' : ''}"
              data-skill="${esc(s.name)}" data-source="${esc(currentMarketSrc)}"
              ${s.installed ? 'disabled' : ''}>
              ${s.installed ? '✓ 已安装' : '⬇ 安装'}
            </button>
          </div>
        </div>
        <div class="skill-card-desc">${esc((s.description || s.trigger || '').slice(0, 150))}</div>
      </div>`).join('')
      : `<div class="hub-empty">没有匹配"${esc(filter)}"的 skill</div>`;

    // 绑定安装按钮
    container.querySelectorAll('.skill-install-btn:not([disabled])').forEach(btn => {
      btn.onclick = async () => {
        const name = btn.dataset.skill;
        const source = btn.dataset.source;
        btn.disabled = true;
        btn.textContent = '安装中…';
        try {
          const { response: res, data } = await fetchWithApproval('/api/skills/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source, name }),
          });
          if (!res.ok) throw new Error(data.error || '安装失败');
          btn.textContent = '✓ 已安装';
          btn.classList.add('installed');
          // 更新缓存
          if (marketCache[source]) {
            const entry = marketCache[source].skills?.find(s => s.name === name);
            if (entry) entry.installed = true;
          }
          addSystemMsg(`✓ Skill "${name}" 安装成功`);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '⬇ 安装';
          addSystemMsg(`✗ 安装失败：${err.message}`);
        }
      };
    });
  }

  hubBody.querySelectorAll('.skill-src-btn').forEach(btn => {
    btn.onclick = () => loadMarket(btn.dataset.src);
  });

  hubBody.querySelector('.skill-search-input')?.addEventListener('input', e => {
    const listEl = document.getElementById('skillMarketList');
    if (!listEl || !marketCache[currentMarketSrc]) return;
    renderMarketList(marketCache[currentMarketSrc].skills || [], listEl, e.target.value);
  });

  hubBody.querySelectorAll('.skill-loading-select').forEach(select => {
    select.onchange = async () => {
      await fetch(`/api/skills/${encodeURIComponent(select.dataset.skill)}/loading`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loading: select.value }),
      });
      await loadHub();
    };
  });

  prefetchSkillRegistry('myteam-official');
  prefetchSkillRegistry('clowder-ai');
}

function renderHubLessons() {
  const lessons = [...(hubState.lessons || [])].reverse();
  const recent = lessons.slice(0, 12);
  const byAgent = lessons.reduce((acc, lesson) => {
    const key = lesson.agent || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const topAgent = Object.entries(byAgent).sort((a, b) => b[1] - a[1])[0];
  hubBody.innerHTML = `
    <div class="hub-kpi-grid">
      <div class="hub-kpi"><div class="hub-kpi-label">Lessons</div><div class="hub-kpi-value">${lessons.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">最近记录</div><div class="hub-kpi-value">${recent.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">主要 Agent</div><div class="hub-kpi-value">${esc(topAgent?.[0] || '-')}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">协作作用</div><div class="hub-kpi-value">风险注入</div></div>
    </div>
    <section class="hub-section">
      <div class="hub-section-title">踩坑记录 <span class="hub-mini-note">相似任务执行前自动检索 Top 3，并写入调用的 lesson_ids</span></div>
      <div class="hub-list">
        ${recent.length ? recent.map(lesson => {
          const when = lesson.timestamp ? formatTime(lesson.timestamp) : '-';
          const taskKey = lesson.task_id || lesson.task_title || '';
          const error = String(lesson.error || '无错误摘要');
          return `<div class="hub-row">
            <div class="hub-row-main">
              <div class="hub-row-title">${esc(lesson.task_title || lesson.task_id || '未命名任务')}</div>
              <div class="hub-row-meta">${esc(lesson.agent || 'unknown')} · ${esc(when)} · ${esc(lesson.task_id || '无 task_id')}</div>
              <div class="hub-row-meta">${esc(error.length > 150 ? `${error.slice(0, 150)}...` : error)}</div>
            </div>
            <div class="hub-row-side">
              <span class="hub-badge ${lesson.source_task_exists ? 'warn' : 'info'}">${lesson.source_task_exists ? '已关联' : '快照保留'}</span>
              ${taskKey ? `<div class="hub-row-actions">
                ${lesson.source_task_exists ? `<button class="hub-mini-btn" data-hub-action="lesson-task" data-task-query="${esc(taskKey)}">查看任务</button>` : `<button class="hub-mini-btn" data-hub-action="lesson-snapshot" data-lesson-id="${esc(lesson.id)}">查看快照</button>`}
                ${lesson.session_id ? `<button class="hub-mini-btn" data-hub-action="lesson-session" data-session-id="${esc(lesson.session_id)}">关联对话</button>` : ''}
              </div>` : ''}
            </div>
          </div>`;
        }).join('') : '<div class="hub-empty">暂无踩坑记录。任务失败时会自动写入 lessons。</div>'}
      </div>
    </section>`;
  bindHubActions();
}

function renderHubInvocations() {
  const summary = hubState.invocationSummary || { total: 0, success: 0, failed: 0, interrupted: 0, avgDurationMs: 0, byAgent: {} };
  const recent = hubState.invocations.slice(0, 30);
  const agentRows = Object.entries(summary.byAgent || {});
  const statusLabel = { success: '已完成', failed: '失败', interrupted: '已中断', running: '执行中' };
  hubBody.innerHTML = `
    <div class="hub-kpi-grid">
      <div class="hub-kpi"><div class="hub-kpi-label">调用总数</div><div class="hub-kpi-value">${summary.total || 0}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">成功</div><div class="hub-kpi-value">${summary.success || 0}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">失败</div><div class="hub-kpi-value">${summary.failed || 0}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">平均耗时</div><div class="hub-kpi-value">${formatDuration(summary.avgDurationMs)}</div></div>
    </div>
    <section class="hub-section">
      <div class="hub-section-title">按 Agent 汇总 <span class="hub-mini-note">轻量成本/稳定性信号</span></div>
      <div class="hub-list">
        ${agentRows.length ? agentRows.map(([agent, row]) => `<div class="hub-row">
          <div class="hub-row-main">
            <div class="hub-row-title">${esc(agent)}</div>
            <div class="hub-row-meta">成功 ${row.success || 0} · 失败 ${row.failed || 0} · 中断 ${row.interrupted || 0}</div>
          </div>
          <span class="hub-badge ${row.failed ? 'warn' : 'ok'}">${row.total || 0} 次</span>
        </div>`).join('') : '<div class="hub-empty">还没有 agent 调用记录。下一次对话、拆任务或执行任务后会自动记录。</div>'}
      </div>
    </section>
    <section class="hub-section">
      <div class="hub-section-title">当前会话调用链 <span class="hub-mini-note">点击记录展开输入/输出摘要；旧记录可能暂无关联字段</span></div>
      <div class="hub-list">
        ${recent.length ? recent.map(i => `<div class="hub-row hub-invocation-row" data-invocation-id="${esc(i.id)}">
          <div class="hub-row-main">
            <div class="hub-row-title">${esc(i.agent)} · ${esc(i.mode || i.label || 'call')} ${i.task_title ? `· ${esc(i.task_title)}` : ''}</div>
            <div class="hub-row-meta">${esc(i.started_at || '')} · ${formatDuration(i.duration_ms)} · 输入约 ${i.input_tokens_est || Math.ceil((i.prompt_chars || 0) / 4)} token · 输出约 ${i.output_tokens_est || Math.ceil((i.output_chars || 0) / 4)} token</div>
            <div class="hub-row-meta">session ${esc(i.session_id || '旧记录未关联')} · task ${esc(i.task_id || '-')} · run ${esc(i.run_id || '-')} · invocation ${esc(i.id)}</div>
            ${(i.skills || []).length ? `<div class="hub-row-meta">Skills：${i.skills.map(s => esc(s.name || s)).join('、')}</div>` : ''}
            ${(i.lesson_ids || []).length ? `<div class="hub-row-meta">Lessons：${i.lesson_ids.map(esc).join('、')}</div>` : ''}
            ${i.error ? `<div class="hub-row-meta">${esc(i.error)}</div>` : ''}
            <div class="hub-trace-preview hidden"><strong>输入摘要</strong>\n${esc(i.prompt_preview || '旧记录未保存')}\n\n<strong>输出摘要</strong>\n${esc(i.output_preview || i.stderr || '暂无输出')}</div>
          </div>
          <span class="hub-badge ${i.status === 'success' ? 'ok' : i.status === 'interrupted' ? 'warn' : 'err'}">${esc(statusLabel[i.status] || i.status || '未知')}</span>
        </div>`).join('') : '<div class="hub-empty">暂无调用记录。</div>'}
      </div>
    </section>
    `;
  hubBody.querySelectorAll('.hub-invocation-row').forEach(row => {
    row.onclick = () => row.querySelector('.hub-trace-preview')?.classList.toggle('hidden');
  });
}

function renderHubCosts() {
  const ledger = hubState.costLedger || { rows: [], summary: {} };
  const summary = ledger.summary || {};
  hubBody.innerHTML = `
    <div class="hub-kpi-grid">
      <div class="hub-kpi"><div class="hub-kpi-label">调用次数</div><div class="hub-kpi-value">${summary.calls || 0}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">总耗时</div><div class="hub-kpi-value">${formatDuration(summary.duration_ms || 0)}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">估算 Token</div><div class="hub-kpi-value">${((summary.input_tokens_est || 0) + (summary.output_tokens_est || 0)).toLocaleString()}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">已验收任务</div><div class="hub-kpi-value">${summary.accepted_tasks || 0}</div></div>
    </div>
    <section class="hub-section">
      <div class="hub-section-title">当前会话成本账本 <span class="hub-mini-note">${esc(ledger.estimation || '')}</span></div>
      <div class="hub-list">${(ledger.rows || []).length ? ledger.rows.map(row => `<div class="hub-row">
        <div class="hub-row-main">
          <div class="hub-row-title">${esc(row.task_title || (row.task_id ? `任务 ${row.task_id}` : '会话调用'))}</div>
          <div class="hub-row-meta">${row.calls} 次调用 · ${formatDuration(row.duration_ms)} · 失败 ${row.failures} · 输入约 ${row.input_tokens_est} / 输出约 ${row.output_tokens_est} token</div>
          <div class="hub-row-meta">task ${esc(row.task_id || '-')} · run ${esc(row.run_id || '-')} · session ${esc(row.session_id || '-')}</div>
        </div>
        <span class="hub-badge ${row.accepted ? 'ok' : row.failures ? 'err' : 'warn'}">${row.accepted ? '已验收' : row.status === 'conversation' ? '会话' : '未验收'}</span>
      </div>`).join('') : '<div class="hub-empty">当前会话尚无可核算调用。新调用会自动记账。</div>'}</div>
    </section>`;
}

function renderHubTasks() {
  const stats = taskStats(hubState.tasks);
  const gates = gateStats(hubState.tasks);
  const recent = [...hubState.tasks].slice(-6).reverse();
  hubBody.innerHTML = `
    <div class="hub-kpi-grid">
      <div class="hub-kpi"><div class="hub-kpi-label">Run 数</div><div class="hub-kpi-value">${stats.runs}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">待执行</div><div class="hub-kpi-value">${stats.pending}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">执行中</div><div class="hub-kpi-value">${stats.in_progress}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">待审核</div><div class="hub-kpi-value">${gates.needsReview}</div></div>
    </div>
    <section class="hub-section">
      <div class="hub-section-title">最近任务 <span class="hub-mini-note">来自 .myteam/tasks.jsonl</span></div>
      <div class="hub-list">
        ${recent.length ? recent.map(t => `<div class="hub-row">
          <div class="hub-row-main">
            <div class="hub-row-title">${esc(t.title || t.id)}</div>
            <div class="hub-row-meta">${esc(t.agent || 'unknown')} · ${esc(t.run_id || '无 run')} · ${esc(t.accept || '无验收说明')}</div>
          </div>
          <span class="hub-badge ${t.status === 'done' ? (t.gate_status === 'passed' ? 'ok' : 'info') : t.status === 'failed' ? 'err' : t.status === 'in_progress' ? 'info' : 'warn'}">${esc(t.gate_status === 'passed' ? 'done+gate' : t.status || 'pending')}</span>
        </div>`).join('') : '<div class="hub-empty">暂无任务。切到拆任务模式生成第一批任务。</div>'}
      </div>
      <div class="hub-actions">
        <button class="hub-action-btn" data-hub-action="tasks">展开任务面板</button>
      </div>
    </section>`;
  bindHubActions();
}

function bindHubActions() {
  hubBody.querySelectorAll('[data-hub-action]').forEach(btn => {
    btn.onclick = async () => {
      const action = btn.dataset.hubAction;
      if (action === 'settings') openDrawer();
      if (action === 'tasks') {
        await focusTasks('');
      }
      if (action === 'plan') {
        closeHub();
        modeGroup.querySelector('.radio-btn[data-value="plan"]').click();
        goalInput.focus();
      }
      if (action === 'gate-pass' || action === 'gate-rework') {
        await submitGateDecision(btn.dataset.taskId, action === 'gate-pass' ? 'pass' : 'rework', btn);
      }
      if (action === 'lesson-task') {
        await focusTasks(btn.dataset.taskQuery || '');
      }
      if (action === 'lesson-snapshot') {
        const lesson = (hubState.lessons || []).find(item => item.id === btn.dataset.lessonId);
        const snapshot = lesson?.source_task_snapshot;
        alert(snapshot ? `任务：${snapshot.title || snapshot.id}\n目标：${snapshot.goal || '-'}\n验收：${snapshot.accept || '-'}\n状态：${snapshot.status || '-'}` : '该历史记录暂无快照。');
      }
      if (action === 'lesson-session' && btn.dataset.sessionId) {
        closeHub();
        await switchSession(btn.dataset.sessionId);
      }
      if (action === 'skill-import') {
        await openSkillImportDialog();
      }
    };
  });
}

async function openSkillImportDialog() {
  const sample = `- name: my-new-skill
  category: codeReview
  trigger: '@codex'
  description: 简短描述
  load: progressive
  mounts:
    worker: true
    reviewer: true
  prompt: "在执行前，请先 …"`;
  const yaml = prompt('粘贴 skill 的 YAML 定义（参考下面格式）：\n\n' + sample, sample);
  if (!yaml || !yaml.trim()) return;
  try {
    const { response: res, data } = await fetchWithApproval('/api/skills/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml }),
    });
    if (!res.ok) throw new Error(data.error || '导入失败');
    addSystemMsg(`✓ Skill 已导入，当前共 ${data.total} 条`);
    await loadHub();
  } catch (err) {
    addSystemMsg(`✗ Skill 导入失败：${err.message}`);
  }
}

async function submitGateDecision(taskId, decision, btn) {
  if (!taskId) return;
  const card = btn.closest('.gate-review-card');
  const note = card?.querySelector('.gate-review-note')?.value.trim() || '';
  const scorecard = card ? Object.fromEntries(
    [...card.querySelectorAll('[data-score-key]')].map(input => [input.dataset.scoreKey, input.checked])
  ) : null;
  if (decision === 'rework' && !note) {
    showToast('请先写清返工内容，让下一位 Agent 知道要修改什么。', 'warn');
    return;
  }
  btn.disabled = true;
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, note, scorecard }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gate 操作失败');
    addSystemMsg(decision === 'pass'
      ? `任务 ${taskId} 已通过 Reviewer Gate。`
      : `任务 ${taskId} 已要求返工，已回到 pending。`);
    await loadTasks();
    await loadHub();
  } catch (err) {
    addSystemMsg(`Gate 操作失败：${err.message}`);
    btn.disabled = false;
  }
}

hubBtn.onclick = openHub;
hubClose.onclick = closeHub;
hubMask.onclick = closeHub;
hubTabs.querySelectorAll('.hub-tab').forEach(btn => {
  btn.onclick = () => {
    hubActiveTab = btn.dataset.tab;
    renderHub();
  };
});

async function saveAgentList(agents, { scrollToKey = null } = {}) {
  const { response: res, data } = await fetchWithApproval('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agents }),
  });
  if (!res.ok) throw new Error(data.error || '保存 agent 失败');
  agentConfigList = data.agents || agents;
  await loadStatus();
  await loadAgentConfig({ scrollToKey });
  if (!hubDrawer.classList.contains('hidden')) await loadHub();
  return data;
}

async function loadAgentConfig({ scrollToKey = null } = {}) {
  // 记住当前滚动位置，重渲染后恢复
  const drawerBody = agentFormEl.closest('.drawer-body');
  const prevScroll = drawerBody?.scrollTop || 0;
  agentFormEl.innerHTML = '<div style="color:var(--muted);font-size:13px;">加载中…</div>';
  try {
    const { agents, workspace } = await fetch('/api/agents').then(r => r.json());
    agentConfigList = agents;
    if (workspaceInput) workspaceInput.value = workspace || '';
    agentFormEl.innerHTML = '';
    agents.forEach(a => {
      const meta = agentMeta(a.key);
      const statusText = a.available
        ? '✓ 可启动，路径有效'
        : (a.path ? `✗ ${a.error || '文件不可用'}` : '未配置');
      const strengthsStr = Array.isArray(a.strengths) ? a.strengths.join('、') : (a.strengths || '');
      const restrictionsStr = Array.isArray(a.restrictions) ? a.restrictions.join('、') : (a.restrictions || '');
      const card = document.createElement('div');
      card.className = 'agent-card';
      card.dataset.agent = a.key;
      card.innerHTML = `
        <div class="agent-card-header">
          <span style="font-size:18px;">${meta.emoji}</span>
          <div>
            <div class="agent-card-name">${meta.label}</div>
            <div style="font-size:11px;color:var(--muted);">${meta.desc}</div>
          </div>
          <span class="agent-status-badge ${a.available ? 'ok' : 'err'}">
            ${a.available ? '✓ 已检测' : (a.path ? '✗ 不可启动' : '✗ 未配置')}
          </span>
        </div>
        <div class="path-input-row">
          <input class="path-input" data-agent="${a.key}" value="${esc(a.path)}"
            placeholder="填入 CLI 可执行文件路径，例如 C:\\...\\codex.cmd">
          <button class="path-check-btn" data-agent="${a.key}">检测</button>
        </div>
        <div class="path-check-result" data-result="${a.key}"
          style="font-size:11px;margin-top:5px;color:${a.available ? 'var(--green)' : (a.path ? 'var(--red)' : 'var(--muted)')};">
          ${esc(statusText)}
        </div>
        <div class="role-card-fields" style="margin-top:8px;">
          <label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="white-space:nowrap;font-size:12px;color:var(--muted);width:60px;">API Key</span>
            <div style="flex:1;position:relative;display:flex;align-items:center;">
              <input class="role-input api-key-input" data-agent="${a.key}" data-field="apiKey"
                type="password"
                value=""
                placeholder="${a.hasApiKey ? ('已配置 ' + esc(a.apiKeyMasked || '••••')) : 'Bearer Token / API Key（可选，不保存到 git）'}"
                style="flex:1;padding-right:32px;">
              <button type="button" class="api-key-eye" data-agent="${a.key}"
                style="position:absolute;right:6px;background:none;border:none;cursor:pointer;color:var(--muted);font-size:13px;padding:0;line-height:1;"
                title="显示/隐藏">👁</button>
            </div>
          </label>
          <label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="white-space:nowrap;font-size:12px;color:var(--muted);width:60px;">Base URL</span>
            <input class="role-input base-url-input" data-agent="${a.key}" data-field="baseUrl"
              value="${esc(a.baseUrl || '')}" placeholder="例如 https://aigw.ds.163.com/v1" style="flex:1;">
            <button class="path-check-btn fetch-models-btn" data-agent="${a.key}" style="white-space:nowrap;font-size:11px;">拉取模型</button>
          </label>
          <label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="white-space:nowrap;font-size:12px;color:var(--muted);width:60px;">Model</span>
            <select class="role-input model-select" data-agent="${a.key}" data-field="model" style="flex:1;">
              <option value="${esc(a.model || '')}">${a.model ? esc(a.model) : '— 手动填写或先拉取列表 —'}</option>
            </select>
            <input class="role-input model-input" data-agent="${a.key}" data-field="model"
              value="${esc(a.model || '')}" placeholder="或手动输入模型名" style="flex:1;">
          </label>
          <button class="role-card-save-btn model-save-btn" data-agent="${a.key}" style="margin-bottom:0;">保存 API 配置</button>
          <span class="role-card-save-tip hidden" data-tip-model="${a.key}"></span>
        </div>
        <details class="role-card-details">
          <summary class="role-card-summary">角色卡 <span style="font-size:10px;color:var(--muted);">（注入每次调用的 prompt 头部）</span></summary>
          <div class="role-card-fields">
            <div class="agent-template-row full-width">
              <label>📋 模板：</label>
              <select class="agent-template-select" data-agent="${a.key}">
                ${ROLE_TEMPLATES.map(t => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join('')}
              </select>
            </div>
            <label>昵称 <span style="font-size:11px;color:var(--muted);">（不填则使用显示名称）</span>
              <input class="role-input" data-agent="${a.key}" data-field="nickname"
                value="${esc(a.nickname || '')}" placeholder="${esc(a.label || a.key)}">
            </label>
            <label>头像
              <div class="avatar-upload-area">
                <div class="avatar-preview" data-agent="${a.key}">
                  ${a.avatar ? `<img src="${esc(a.avatar)}" alt="avatar">` : meta.emoji}
                </div>
                <input type="file" class="avatar-upload-input" data-agent="${a.key}" accept="image/*" style="display:none;">
                <button type="button" class="avatar-upload-btn" data-agent="${a.key}">上传图片</button>
                ${a.avatar ? `<button type="button" class="avatar-remove-btn" data-agent="${a.key}" style="font-size:11px;color:var(--red);">移除</button>` : ''}
              </div>
            </label>
            <label>主题色
              <div style="display:flex;gap:8px;align-items:center;">
                <input type="color" class="color-input" data-agent="${a.key}" data-field="color.primary"
                  value="${a.color?.primary || '#888888'}" style="width:50px;height:32px;border:1px solid var(--border);border-radius:4px;">
                <span style="font-size:11px;color:var(--muted);">主色</span>
                <input type="color" class="color-input" data-agent="${a.key}" data-field="color.secondary"
                  value="${a.color?.secondary || '#dddddd'}" style="width:50px;height:32px;border:1px solid var(--border);border-radius:4px;">
                <span style="font-size:11px;color:var(--muted);">辅色</span>
              </div>
            </label>
            <label class="full-width">角色描述
              <input class="role-input" data-agent="${a.key}" data-field="roleDescription"
                value="${esc(a.roleDescription || '')}" placeholder="例如：任务规划、代码审查、自迭代协调者">
            </label>
            <label>性格
              <input class="role-input" data-agent="${a.key}" data-field="personality"
                value="${esc(a.personality || '')}" placeholder="例如：严谨、务实、追求代码质量">
            </label>
            <label>擅长（逗号分隔）
              <input class="role-input" data-agent="${a.key}" data-field="strengths"
                value="${esc(strengthsStr)}" placeholder="例如：任务拆解、代码审查">
            </label>
            <label>限制（逗号分隔，空则无限制）
              <input class="role-input" data-agent="${a.key}" data-field="restrictions"
                value="${esc(restrictionsStr)}" placeholder="例如：不处理财务数据、不生成真实个人信息">
            </label>
            <button class="role-card-save-btn" data-agent="${a.key}">保存角色卡</button>
            <span class="role-card-save-tip hidden" data-tip="${a.key}"></span>
          </div>
        </details>`;
      agentFormEl.appendChild(card);

      // 眼睛按钮：切换 API Key 显示/隐藏
      card.querySelectorAll('.api-key-eye').forEach(eyeBtn => {
        eyeBtn.onclick = () => {
          const input = agentFormEl.querySelector(`.api-key-input[data-agent="${eyeBtn.dataset.agent}"]`);
          if (!input) return;
          input.type = input.type === 'password' ? 'text' : 'password';
          eyeBtn.textContent = input.type === 'password' ? '👁' : '🙈';
        };
      });

      // 角色模板下拉
      card.querySelectorAll('.agent-template-select').forEach(sel => {
        sel.onchange = () => {
          applyRoleTemplate(card, sel.value);
          sel.value = '';
        };
      });

      if (a.removable !== false) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'agent-remove-btn';
        const displayName = a.nickname || a.label || a.key;
        removeBtn.textContent = `删除 ${displayName}`;
        removeBtn.title = `key: @${a.key}`;
        removeBtn.onclick = async () => {
          if (!confirm(`确定删除 ${displayName} (@${a.key})？`)) return;
          agentConfigList = agentConfigList.filter(agent => agent.key !== a.key);
          await saveAgentList(agentConfigList);
        };
        card.appendChild(removeBtn);
      }
    });

    // 拉取模型列表按钮
    agentFormEl.querySelectorAll('.fetch-models-btn').forEach(btn => {
      btn.onclick = async () => {
        const key = btn.dataset.agent;
        const urlInput = agentFormEl.querySelector(`.base-url-input[data-agent="${key}"]`);
        const apiKeyInput = agentFormEl.querySelector(`.api-key-input[data-agent="${key}"]`);
        const sel = agentFormEl.querySelector(`.model-select[data-agent="${key}"]`);
        const manualInput = agentFormEl.querySelector(`.model-input[data-agent="${key}"]`);
        const baseUrl = urlInput?.value.trim();
        const apiKey = apiKeyInput?.value.trim() || '';
        if (!baseUrl) { btn.textContent = '需要 URL'; setTimeout(() => { btn.textContent = '拉取模型'; }, 1500); return; }
        btn.disabled = true;
        btn.textContent = '…';
        try {
          const params = new URLSearchParams({ baseUrl });
          if (apiKey) params.set('apiKey', apiKey);
          const { models, error } = await fetch(`/api/models?${params}`).then(r => r.json());
          if (models && models.length) {
            const current = manualInput?.value.trim() || '';
            sel.innerHTML = models.map(m => `<option value="${esc(m)}" ${m === current ? 'selected' : ''}>${esc(m)}</option>`).join('');
            sel.classList.remove('hidden');
            if (manualInput) {
              sel.onchange = () => { manualInput.value = sel.value; };
              if (!current) { manualInput.value = models[0]; sel.value = models[0]; }
            }
            btn.textContent = `✓ ${models.length} 个`;
          } else {
            btn.textContent = error ? '失败' : '空列表';
          }
        } catch { btn.textContent = '请求失败'; }
        btn.disabled = false;
        if (btn.textContent === '失败' || btn.textContent === '请求失败') setTimeout(() => { btn.textContent = '拉取模型'; }, 2000);
      };
    });

    // 保存 API 配置（baseUrl + model）
    agentFormEl.querySelectorAll('.model-save-btn').forEach(btn => {
      btn.onclick = async () => {
        const key = btn.dataset.agent;
        const tip = agentFormEl.querySelector(`[data-tip-model="${key}"]`);
        const baseUrl = agentFormEl.querySelector(`.base-url-input[data-agent="${key}"]`)?.value.trim() || '';
        const apiKey = agentFormEl.querySelector(`.api-key-input[data-agent="${key}"]`)?.value.trim() || '';
        const model = agentFormEl.querySelector(`.model-input[data-agent="${key}"]`)?.value.trim() || '';
        btn.textContent = '保存中…';
        try {
          await fetchWithApproval(`/api/agents/${encodeURIComponent(key)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseUrl, apiKey, model }),
          });
          if (tip) { tip.textContent = '✓ 已保存'; tip.style.color = 'var(--green)'; tip.classList.remove('hidden'); setTimeout(() => tip.classList.add('hidden'), 2000); }
        } catch (e) {
          if (tip) { tip.textContent = `失败：${e.message}`; tip.style.color = 'var(--red)'; tip.classList.remove('hidden'); }
        }
        btn.textContent = '保存 API 配置';
      };
    });

    // 检测按钮：临时保存当前输入路径后调 /api/agents，看返回的 available
    agentFormEl.querySelectorAll('.path-check-btn:not(.fetch-models-btn)').forEach(btn => {
      btn.onclick = async () => {
        const key = btn.dataset.agent;
        const input = agentFormEl.querySelector(`.path-input[data-agent="${key}"]`);
        const resultEl = agentFormEl.querySelector(`.path-check-result[data-result="${key}"]`);
        btn.textContent = '…';
        try {
          const { agents: updated } = await fetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [key]: input.value.trim() }),
          }).then(r => r.json());
          const a = updated.find(x => x.key === key);
          const badge = btn.closest('.agent-card').querySelector('.agent-status-badge');
          if (a?.available) {
            resultEl.style.color = 'var(--green)';
            resultEl.textContent = '✓ 可启动，路径有效';
            if (badge) { badge.className = 'agent-status-badge ok'; badge.textContent = '✓ 已检测'; }
          } else {
            resultEl.style.color = 'var(--red)';
            resultEl.textContent = `✗ ${a?.error || '不可启动，请检查路径'}`;
            if (badge) { badge.className = 'agent-status-badge err'; badge.textContent = input.value.trim() ? '✗ 不可启动' : '✗ 未配置'; }
          }
        } catch { resultEl.textContent = '检测失败'; }
        btn.textContent = '检测';
      };
    });

    // 角色卡保存按钮
    agentFormEl.querySelectorAll('.role-card-save-btn').forEach(btn => {
      btn.onclick = async () => {
        const key = btn.dataset.agent;
        const tip = agentFormEl.querySelector(`.role-card-save-tip[data-tip="${key}"]`);
        const getField = (field) => {
          const el = agentFormEl.querySelector(`.role-input[data-agent="${key}"][data-field="${field}"]`);
          return el ? el.value.trim() : '';
        };
        const getColor = (field) => {
          const el = agentFormEl.querySelector(`.color-input[data-agent="${key}"][data-field="${field}"]`);
          return el ? el.value : '';
        };
        const strengths = getField('strengths').split(/[,，]/).map(s => s.trim()).filter(Boolean);
        const restrictions = getField('restrictions').split(/[,，]/).map(s => s.trim()).filter(Boolean);
        const colorPrimary = getColor('color.primary');
        const colorSecondary = getColor('color.secondary');
        btn.textContent = '保存中…';
        try {
          await fetchWithApproval(`/api/agents/${encodeURIComponent(key)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nickname: getField('nickname'),
              roleDescription: getField('roleDescription'),
              personality: getField('personality'),
              strengths,
              restrictions,
              color: { primary: colorPrimary, secondary: colorSecondary },
            }),
          });
          if (tip) { tip.textContent = '✓ 已保存'; tip.style.color = 'var(--green)'; tip.classList.remove('hidden'); }
          setTimeout(() => tip?.classList.add('hidden'), 2000);
        } catch (e) {
          if (tip) { tip.textContent = '保存失败'; tip.style.color = 'var(--red)'; tip.classList.remove('hidden'); }
        }
        btn.textContent = '保存角色卡';
      };
    });

    // 头像上传按钮
    agentFormEl.querySelectorAll('.avatar-upload-btn').forEach(btn => {
      btn.onclick = () => {
        const key = btn.dataset.agent;
        const input = agentFormEl.querySelector(`.avatar-upload-input[data-agent="${key}"]`);
        input?.click();
      };
    });

    // 头像文件选择
    agentFormEl.querySelectorAll('.avatar-upload-input').forEach(input => {
      input.onchange = async () => {
        const key = input.dataset.agent;
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
          alert('图片大小不能超过 2MB');
          return;
        }
        const reader = new FileReader();
        reader.onload = async (e) => {
          const base64 = e.target.result;
          try {
            const res = await fetch(`/api/agents/${encodeURIComponent(key)}/avatar`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: base64 }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '上传失败');
            // 更新预览
            const preview = agentFormEl.querySelector(`.avatar-preview[data-agent="${key}"]`);
            if (preview) preview.innerHTML = `<img src="${esc(data.avatar)}" alt="avatar">`;
            // 更新 agentConfigList
            const agent = agentConfigList.find(a => a.key === key);
            if (agent) agent.avatar = data.avatar;
            // 添加移除按钮
            const uploadArea = preview?.parentElement;
            if (uploadArea && !uploadArea.querySelector('.avatar-remove-btn')) {
              const removeBtn = document.createElement('button');
              removeBtn.type = 'button';
              removeBtn.className = 'avatar-remove-btn';
              removeBtn.dataset.agent = key;
              removeBtn.style.cssText = 'font-size:11px;color:var(--red);';
              removeBtn.textContent = '移除';
              removeBtn.onclick = async () => {
                try {
                  await fetchWithApproval(`/api/agents/${encodeURIComponent(key)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ avatar: '' }),
                  });
                  if (preview) preview.innerHTML = agentMeta(key).emoji;
                  const agent = agentConfigList.find(a => a.key === key);
                  if (agent) agent.avatar = '';
                  removeBtn.remove();
                } catch (e) {
                  alert('移除失败');
                }
              };
              uploadArea.appendChild(removeBtn);
            }
          } catch (e) {
            alert('上传失败：' + e.message);
          }
        };
        reader.readAsDataURL(file);
      };
    });

    // 头像移除按钮
    agentFormEl.querySelectorAll('.avatar-remove-btn').forEach(btn => {
      btn.onclick = async () => {
        const key = btn.dataset.agent;
        try {
          await fetchWithApproval(`/api/agents/${encodeURIComponent(key)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ avatar: '' }),
          });
          const preview = agentFormEl.querySelector(`.avatar-preview[data-agent="${key}"]`);
          if (preview) preview.innerHTML = agentMeta(key).emoji;
          const agent = agentConfigList.find(a => a.key === key);
          if (agent) agent.avatar = '';
          btn.remove();
        } catch (e) {
          alert('移除失败');
        }
      };
    });
  } catch {
    agentFormEl.innerHTML = '<div style="color:var(--red);font-size:13px;">无法加载配置，请确认服务器正在运行。</div>';
  }
  // 锚定到指定卡片 or 恢复之前的滚动位置
  if (scrollToKey) {
    setTimeout(() => {
      const card = agentFormEl.querySelector(`.agent-card[data-agent="${scrollToKey}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  } else if (drawerBody && prevScroll > 0) {
    setTimeout(() => { drawerBody.scrollTop = prevScroll; }, 50);
  }
}

agentAddBtn.onclick = async () => {
  const availableAgents = agentConfigList.filter(a => a.path && a.available);
  const result = await showCreateAgentDialog(availableAgents);
  if (!result) return;

  const { key, label, baseAgent, template, model, baseUrl, apiKey } = result;
  if (agentConfigList.some(a => a.key === key)) {
    drawerSaveTip.textContent = `@${key} 已存在`;
    drawerSaveTip.className = 'drawer-save-tip err';
    drawerSaveTip.classList.remove('hidden');
    return;
  }

  // 套用角色模板字段
  const tpl = ROLE_TEMPLATES.find(t => t.key === template) || {};

  const newAgent = {
    key,
    label,
    emoji: baseAgent?.emoji || '●',
    desc: baseAgent ? `${baseAgent.desc} (变体)` : '自定义 Agent',
    path: baseAgent?.path || '',
    inputMode: baseAgent?.inputMode || 'arg',
    argsTemplate: baseAgent?.argsTemplate || '-p {prompt}',
    checkTemplate: baseAgent?.checkTemplate || '--help',
    envKey: baseAgent?.envKey || '',
    inheritFrom: baseAgent?.key || '',
    baseUrl,
    apiKey,
    model,
    roleDescription: tpl.roleDescription || '',
    personality: tpl.personality || '',
    strengths: tpl.strengths || [],
    restrictions: tpl.restrictions || [],
    nickname: '',
    avatar: '',
    color: { primary: '#888', secondary: '#ddd' },
    removable: true,
  };

  await saveAgentList([...agentConfigList, newAgent], { scrollToKey: key });
};

// 新建 Agent 变体：复用一个已可启动 CLI，可选覆盖模型/API 配置和角色。
function showCreateAgentDialog(availableAgents) {
  return new Promise((resolve) => {
    const baseOptions = availableAgents.map((a, i) =>
      `<option value="${i}">${esc(a.label)} (@${esc(a.key)})</option>`
    ).join('');

    const tplOptions = ROLE_TEMPLATES.map(t =>
      `<option value="${esc(t.key)}">${esc(t.label)}</option>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog-box agent-create-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-create-title">
        <div class="dialog-title" id="agent-create-title">新建 Agent 变体</div>
        <p class="agent-create-intro">变体复用已有 Agent 的本机 CLI，只覆盖 mention、模型或角色。不会安装新的 CLI。</p>
        <div class="dialog-form">
          <label class="dialog-field">
            <span>1. 复用哪个 Agent？ <b class="field-required">必填</b></span>
            <select class="dialog-input" data-field="base" ${availableAgents.length ? '' : 'disabled'}>
              ${baseOptions || '<option>没有可启动的 Agent</option>'}
            </select>
          </label>
          <div class="agent-inherit-preview" data-field="inherit-preview"></div>
          <label class="dialog-field">
            <span>2. Mention 标识 <b class="field-required">必填</b></span>
            <div class="agent-key-input"><span>@</span><input class="dialog-input" data-field="key" placeholder="例如 kimi-research" autocomplete="off" /></div>
            <small class="dialog-hint">对话中用这个标识指定变体，仅支持小写字母、数字、短横线和下划线。</small>
          </label>
          <label class="dialog-field">
            <span>显示名称</span>
            <input class="dialog-input" data-field="label" placeholder="例如 Kimi Research" />
          </label>
          <div class="agent-create-section-title">模型连接 <span>可选</span></div>
          <label class="dialog-field">
            <span>模型 ID</span>
            <input class="dialog-input" data-field="model" placeholder="留空则继承基础 Agent" autocomplete="off" />
          </label>
          <label class="dialog-field">
            <span>API 地址</span>
            <input class="dialog-input" data-field="baseUrl" placeholder="例如 https://api.example.com/v1" autocomplete="off" />
            <small class="dialog-hint">使用本机 CLI 默认账号时不要填；只有接入自定义兼容接口时才需要。</small>
          </label>
          <label class="dialog-field">
            <span>API Key</span>
            <input class="dialog-input" data-field="apiKey" type="password" placeholder="留空则继承基础 Agent" autocomplete="new-password" />
          </label>
          <label class="dialog-field">
            <span>角色模板</span>
            <select class="dialog-input" data-field="template">${tplOptions}</select>
            <small class="dialog-hint">套用后自动填入角色描述、性格、擅长、限制</small>
          </label>
          ${availableAgents.length ? '' : '<div class="agent-create-error">请先在设置中配置并检测至少一个可启动的 Agent CLI。</div>'}
          <div class="agent-create-error hidden" data-field="error"></div>
        </div>
        <div class="dialog-actions">
          <button class="dialog-cancel-btn">取消</button>
          <button class="dialog-confirm-btn" ${availableAgents.length ? '' : 'disabled'}>创建变体</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const baseSel = overlay.querySelector('[data-field="base"]');
    const keyInp = overlay.querySelector('[data-field="key"]');
    const labelInp = overlay.querySelector('[data-field="label"]');
    const tplSel = overlay.querySelector('[data-field="template"]');
    const modelInp = overlay.querySelector('[data-field="model"]');
    const baseUrlInp = overlay.querySelector('[data-field="baseUrl"]');
    const apiKeyInp = overlay.querySelector('[data-field="apiKey"]');
    const inheritPreview = overlay.querySelector('[data-field="inherit-preview"]');
    const errorEl = overlay.querySelector('[data-field="error"]');

    const renderBase = () => {
      const base = availableAgents[Number(baseSel.value)];
      if (!base) {
        inheritPreview.innerHTML = '';
        return;
      }
      labelInp.placeholder = `${base.label} 变体`;
      modelInp.placeholder = base.model ? `当前：${base.model}` : '留空则使用 CLI 默认模型';
      baseUrlInp.placeholder = base.baseUrl ? `当前：${base.baseUrl}` : '例如 https://api.example.com/v1';
      inheritPreview.innerHTML = `
        <div><span>自动继承</span><strong>${esc(base.label)} 的 CLI 配置</strong></div>
        <code title="${esc(base.path || '')}">${esc(base.path || '未配置路径')}</code>
        <small>可执行路径和启动参数无需重复填写。</small>`;
    };
    baseSel.onchange = renderBase;
    renderBase();

    setTimeout(() => keyInp.focus(), 50);

    const close = (val) => { document.body.removeChild(overlay); resolve(val); };

    overlay.querySelector('.dialog-confirm-btn').onclick = () => {
      const rawKey = keyInp.value.trim();
      const key = rawKey.toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_-]+/g, '-');
      errorEl.classList.add('hidden');
      keyInp.style.borderColor = '';
      if (!key) {
        errorEl.textContent = '请填写 mention 标识，例如 kimi-research。';
        errorEl.classList.remove('hidden');
        keyInp.focus(); keyInp.style.borderColor = 'var(--red)'; return;
      }
      if (agentConfigList.some(agent => agent.key === key)) {
        errorEl.textContent = `@${key} 已存在，请换一个标识。`;
        errorEl.classList.remove('hidden');
        keyInp.focus(); keyInp.style.borderColor = 'var(--red)'; return;
      }
      // 拦截疑似 API key（≥24 位纯十六进制）误填到 key 字段
      if (/^[0-9a-f]{24,}$/.test(key)) {
        keyInp.style.borderColor = 'var(--red)';
        keyInp.title = 'Key 不能是 API 密钥，请填写简短的英文标识（如 codex-dev）';
        keyInp.focus();
        return;
      }
      const idx = baseSel.value;
      const baseAgent = availableAgents[Number(idx)] || null;
      if (!baseAgent) return;
      const label = labelInp.value.trim() || `${baseAgent.label} 变体`;
      close({
        key,
        label,
        baseAgent,
        template: tplSel.value,
        model: modelInp.value.trim() || baseAgent.model || '',
        baseUrl: baseUrlInp.value.trim() || baseAgent.baseUrl || '',
        apiKey: apiKeyInp.value.trim(),
      });
    };
    overlay.querySelector('.dialog-cancel-btn').onclick = () => close(null);
    overlay.onclick = (e) => { if (e.target === overlay) close(null); };
  });
}

// 旧的简单选择对话框（保留用于其他场景）
function showChoiceDialog(title, choices) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog-box">
        <div class="dialog-title">${esc(title)}</div>
        <div class="dialog-choices">
          ${choices.map((c, i) => `<button class="dialog-choice-btn" data-idx="${i}">${esc(c)}</button>`).join('')}
        </div>
        <button class="dialog-cancel-btn">取消</button>
      </div>
    `;
    document.body.appendChild(overlay);
    
    overlay.querySelectorAll('.dialog-choice-btn').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx);
        document.body.removeChild(overlay);
        resolve(idx);
      };
    });
    
    overlay.querySelector('.dialog-cancel-btn').onclick = () => {
      document.body.removeChild(overlay);
      resolve(null);
    };
  });
}

workspaceSaveBtn.onclick = async () => {
  workspaceSaveBtn.disabled = true;
  try {
    const { response: res, data } = await fetchWithApproval('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: workspaceInput.value.trim() }),
    });
    if (!res.ok) throw new Error(data.error || '保存失败');
    workspaceInput.value = data.workspace || workspaceInput.value;
    workspaceTip.style.color = 'var(--green)';
    workspaceTip.textContent = '已保存，后续 agent 会在这个工作区运行。';
  } catch (err) {
    workspaceTip.style.color = 'var(--red)';
    workspaceTip.textContent = err.message;
  }
  workspaceSaveBtn.disabled = false;
};

drawerSaveBtn.onclick = async () => {
  // 从 UI 收集每个 agent 的完整字段（path + baseUrl + apiKey + model + 角色卡）
  const cards = agentFormEl.querySelectorAll('.agent-card[data-agent]');
  const nextAgents = agentConfigList.map(orig => ({ ...orig }));
  cards.forEach(card => {
    const key = card.dataset.agent;
    const target = nextAgents.find(a => a.key === key);
    if (!target) return;
    const get = (sel) => card.querySelector(sel)?.value?.trim() ?? '';
    const pathVal    = get(`.path-input[data-agent="${key}"]`);
    const baseUrl    = get(`.base-url-input[data-agent="${key}"]`);
    const apiKey     = get(`.api-key-input[data-agent="${key}"]`);
    const model      = get(`.model-input[data-agent="${key}"]`)
                    || get(`.model-text-input[data-agent="${key}"]`);
    if (pathVal !== undefined) target.path = pathVal;
    if (baseUrl !== undefined) target.baseUrl = baseUrl;
    if (apiKey !== undefined)  target.apiKey = apiKey;
    if (model !== undefined)   target.model = model;
    // 角色卡字段（nickname 空时自动 fallback 到 label，避免用户重复填写）
    const nicknameRaw = card.querySelector(`.role-input[data-agent="${key}"][data-field="nickname"]`)?.value?.trim();
    const roleDesc  = card.querySelector(`.role-input[data-agent="${key}"][data-field="roleDescription"]`)?.value?.trim();
    const personality = card.querySelector(`.role-input[data-agent="${key}"][data-field="personality"]`)?.value?.trim();
    const strengthsRaw = card.querySelector(`.role-input[data-agent="${key}"][data-field="strengths"]`)?.value?.trim();
    const restrictionsRaw = card.querySelector(`.role-input[data-agent="${key}"][data-field="restrictions"]`)?.value?.trim();
    const colorPrimary = card.querySelector(`.color-input[data-agent="${key}"][data-field="color.primary"]`)?.value;
    const colorSecondary = card.querySelector(`.color-input[data-agent="${key}"][data-field="color.secondary"]`)?.value;
    // nickname 不填则不强制写入，保留已有值（agentMeta 渲染时 fallback 到 label）
    if (nicknameRaw !== undefined) target.nickname = nicknameRaw;
    if (roleDesc !== undefined) target.roleDescription = roleDesc;
    if (personality !== undefined) target.personality = personality;
    if (strengthsRaw !== undefined) target.strengths = strengthsRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    if (restrictionsRaw !== undefined) target.restrictions = restrictionsRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    if (colorPrimary || colorSecondary) {
      target.color = { primary: colorPrimary || target.color?.primary || '#888', secondary: colorSecondary || target.color?.secondary || '#ddd' };
    }
  });

  drawerSaveBtn.disabled = true;
  drawerSaveTip.className = 'drawer-save-tip hidden';

  try {
    await saveAgentList(nextAgents);
    drawerSaveTip.textContent = '✓ 已保存全部配置（path + API + 角色卡），立即生效';
    drawerSaveTip.className = 'drawer-save-tip ok';
    drawerSaveTip.classList.remove('hidden');
    loadStatus();
  } catch (err) {
    drawerSaveTip.textContent = `✗ 保存失败：${err.message}`;
    drawerSaveTip.className = 'drawer-save-tip err';
    drawerSaveTip.classList.remove('hidden');
  }
  drawerSaveBtn.disabled = false;
};

// ── Session 管理 ──────────────────────────────────────────────
let currentSessionId = null;
let sessionStateById = new Map();
const HIDDEN_DRAFT_SESSION_KEY = 'myteam.hiddenDraftSessionId';
const HISTORY_PAGE_SIZE = 20;
let historyPage = { hasMore: false, nextBefore: null, loading: false };

function clearChatArea() {
  // 保留当前仍在运行的 bubble row（data-session-id 匹配）——切走再切回时能看到
  // 其余 DOM 全清，然后重建
  chatEl.innerHTML = '';
  // agentTypingBubble 指向当前可见 session，切 session 后会由 updateVisibleRunState 重建
  agentTypingBubble = null;
  historyPage = { hasMore: false, nextBefore: null, loading: false };
  const w = document.createElement('div');
  w.className = 'chat-welcome';
  w.id = 'chatWelcome';
  chatEl.appendChild(w);
  renderWelcome(w);
  window.welcome = w;
}

function sessionModeBadge(mode) {
  if (mode === 'plan') return `<span class="session-mode-badge plan" title="拆任务模式">📋 任务</span>`;
  if (mode === 'mixed') return `<span class="session-mode-badge mixed" title="对话+任务">🔀 混合</span>`;
  if (mode === 'chat') return `<span class="session-mode-badge chat" title="对话模式">💬 对话</span>`;
  return '';
}

function renderSessionList(sessions, activeId) {
  const list = document.getElementById('sessionList');
  list.innerHTML = '';
  const newestFirst = [...sessions].sort((a, b) => {
    const aTime = Date.parse(a.created_at) || 0;
    const bTime = Date.parse(b.created_at) || 0;
    return bTime - aTime;
  });
  newestFirst.forEach(s => {
    const isRunning = Boolean(sessionRuns.get(s.id)?.running);
    const isInterrupted = s.run_state?.status === 'interrupted';
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === activeId ? ' active' : '') + (isRunning ? ' running' : '');
    item.dataset.id = s.id;
    const d = new Date(s.created_at);
    const timeStr = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    item.innerHTML = `
      <div class="session-item-header">
        <div class="session-item-name" data-editing="false">${esc(s.name)}</div>
        <button class="session-delete-btn" title="删除">✕</button>
      </div>
      <div class="session-item-meta">
        ${isRunning ? '<span class="session-running-badge"><span class="session-running-dot"></span>运行中</span>' : ''}
        ${isInterrupted ? '<span class="session-mode-badge interrupted">可继续</span>' : ''}
        ${sessionModeBadge(s.mode)}
        <span>${timeStr}</span>
        ${s.message_count ? `<span>· ${s.message_count} 条</span>` : ''}
      </div>`;

    const nameEl = item.querySelector('.session-item-name');
    const deleteBtn = item.querySelector('.session-delete-btn');

    // 点击主体切换 session
    item.onclick = (e) => {
      if (e.target.closest('.session-delete-btn')) return;
      if (nameEl.contentEditable === 'true') return;
      if (s.id !== currentSessionId) switchSession(s.id);
    };

    // 双击改名
    nameEl.ondblclick = (e) => {
      e.stopPropagation();
      startRenameSession(s.id, nameEl);
    };

    // 删除按钮
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      if (isRunning) {
        addSystemMsg('⚠ 该 session 正在运行，请先停止后再删除。');
        return;
      }
      await deleteSession(s.id);
    };

    list.appendChild(item);
  });
}

function startRenameSession(sessionId, nameEl) {
  const original = nameEl.textContent;
  nameEl.contentEditable = 'true';
  nameEl.classList.add('editing');
  nameEl.focus();
  // 选中全文
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  const finish = async (save) => {
    nameEl.contentEditable = 'false';
    nameEl.classList.remove('editing');
    const newName = nameEl.textContent.trim();
    if (!save || !newName || newName === original) {
      nameEl.textContent = original;
      return;
    }
    try {
      await fetch(`/api/sessions/${sessionId}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      await loadSessions();
    } catch {
      nameEl.textContent = original;
    }
  };

  nameEl.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { finish(false); }
  };
  nameEl.onblur = () => finish(true);
}

async function loadSessions() {
  try {
    const { activeId, sessions } = await fetch('/api/sessions').then(r => r.json());
    currentSessionId = activeId;
    const hiddenDraftId = localStorage.getItem(HIDDEN_DRAFT_SESSION_KEY) || '';
    const hiddenDraft = sessions.find(session => session.id === hiddenDraftId);
    if (!hiddenDraft || hiddenDraft.message_count > 0) localStorage.removeItem(HIDDEN_DRAFT_SESSION_KEY);
    const visibleSessions = sessions.filter(session => session.id !== hiddenDraftId || session.message_count > 0);
    sessionStateById = new Map(visibleSessions.map(session => [session.id, session.run_state || { status: 'idle' }]));
    renderSessionList(visibleSessions, activeId);
    return activeId;
  } catch (err) {
    console.error('loadSessions failed:', err);
  }
}

async function switchSession(sessionId) {
  const leavingRun = getSessionRun(currentSessionId);
  if (leavingRun?.running) {
    addSystemMsg('⏳ 当前 session 任务在后台继续运行，结果会自动入库，刷新或切回可查看。');
  }
  await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activeId: sessionId }),
  });

  currentSessionId = sessionId;
  clearChatArea();
  await loadSessions();
  await loadHistory();
  await loadTasks();
  updateVisibleRunState();
  // 刷新产物面板
  if (typeof refreshArtifactsOnSessionChange === 'function') refreshArtifactsOnSessionChange();
  // 强制锚定到最新一条消息（图片/卡片渲染完成后再滚动）
  scrollToBottomAfterLayout();
}

function scrollToBottomAfterLayout() {
  chatEl.scrollTop = chatEl.scrollHeight;
  // 图片加载完后再钉一次底部
  const imgs = chatEl.querySelectorAll('img');
  imgs.forEach(img => {
    if (img.complete) return;
    img.addEventListener('load',  () => { chatEl.scrollTop = chatEl.scrollHeight; }, { once: true });
    img.addEventListener('error', () => { chatEl.scrollTop = chatEl.scrollHeight; }, { once: true });
  });
}

async function createSession() {
  localStorage.removeItem(HIDDEN_DRAFT_SESSION_KEY);
  const { session } = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).then(r => r.json());
  if (session) {
    currentSessionId = session.id;
    await loadSessions();
    clearChatArea();
    updateVisibleRunState();
    goalInput.focus();
  }
}

async function deleteSession(sessionId) {
  const deletingLastVisibleSession = sessionStateById.size === 1;
  const { activeId, trashed } = await fetch(`/api/sessions?id=${sessionId}`, {
    method: 'DELETE',
  }).then(r => r.json());
  if (deletingLastVisibleSession && activeId && activeId !== sessionId) {
    localStorage.setItem(HIDDEN_DRAFT_SESSION_KEY, activeId);
  }
  if (sessionId === currentSessionId) {
    currentSessionId = activeId;
    clearChatArea();
    await loadHistory();
    updateVisibleRunState();
  }
  await loadSessions();
  showUndoToast(trashed);
}

function showUndoToast(sessionId) {
  document.querySelectorAll('.undo-toast').forEach(existing => existing.remove());
  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.innerHTML = `<span>对话已删除</span><button class="undo-btn">撤销</button>`;
  document.body.appendChild(toast);
  const undoBtn = toast.querySelector('.undo-btn');
  undoBtn.onclick = async () => {
    await fetch('/api/sessions/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sessionId }),
    });
    await loadSessions();
    await loadHistory();
    toast.remove();
  };
  setTimeout(() => { if (toast.isConnected) toast.remove(); }, 5000);
}

// Sidebar 折叠
const layout = document.getElementById('layout');
document.getElementById('sidebarToggle').onclick = () => {
  const collapsed = layout.classList.toggle('sidebar-collapsed');
  document.getElementById('sidebarToggle').textContent = collapsed ? '›' : '‹';
};

// 新建按钮
document.getElementById('sidebarNewBtn').onclick = createSession;

// 任务面板展开/收起
document.getElementById('tasksExpandBtn').onclick = () => {
  layout.classList.add('tasks-expanded');
};
document.getElementById('tasksCollapseBtn').onclick = () => {
  layout.classList.remove('tasks-expanded');
};

// ── 加载历史对话 ──────────────────────────────────────────────
async function loadHistoryLegacy() {
  try {
    const url = currentSessionId
      ? `/api/history?sessionId=${currentSessionId}`
      : '/api/history';
    const { history, sessionId } = await fetch(url).then(r => r.json());
    if (sessionId) currentSessionId = sessionId;
    if (!history || !history.length) return;
    hideWelcome();
    history.forEach(h => {
      if (h.role === 'user') {
        addUserBubble(h.text, { attachments: h.attachments || [] });
      } else if (h.role === 'assistant') {
        const meta = agentMeta(h.agent);
        const displayName = meta.nickname || meta.label;
        const row = document.createElement('div');
        row.className = 'bubble-row';
        row.innerHTML = `
          ${renderAgentAvatar(h.agent)}
          <div>
            <div class="bubble-name">${esc(displayName)}</div>
            <div class="bubble agent-bubble">${renderRichText(h.text)}</div>
          </div>`;
        chatEl.appendChild(row);
      }
    });
    scrollChat();
  } catch { /* ignore */ }
}

// ── 初始化 ────────────────────────────────────────────────────
function renderTurnParts(parts, fallbackText = '') {
  if (!Array.isArray(parts) || !parts.length) {
    return `<div class="turn-final"><div class="bubble agent-bubble">${renderRichText(fallbackText)}</div></div>`;
  }
  const toolResults = new Map(parts.filter(part => part.type === 'tool_result').map(part => [part.callId, part]));
  return `<div class="turn-timeline">${parts.map(part => {
    if (part.type === 'reasoning') {
      const text = String(part.text || '');
      const preview = text.split(/\n+/).filter(Boolean).at(-1) || '';
      return `<details class="turn-part turn-reasoning">
        <summary><span class="turn-part-dot"></span><strong>思考过程</strong><span>${text.length} 字</span><em>${esc(preview.slice(0, 80))}</em></summary>
        <div class="turn-reasoning-body">${esc(text)}</div>
      </details>`;
    }
    if (part.type === 'tool_call') {
      const result = toolResults.get(part.callId);
      const failed = result?.status === 'error' || part.status === 'error';
      const status = failed ? '失败' : result ? '已完成' : '未完成';
      const blocks = [];
      if (part.input !== undefined) blocks.push(`<div><span>输入</span><pre>${esc(formatTurnValue(part.input))}</pre></div>`);
      if (result?.output !== undefined) blocks.push(`<div><span>输出</span><pre>${esc(formatTurnValue(result.output))}</pre></div>`);
      const duration = result?.durationMs ? ` · ${(result.durationMs / 1000).toFixed(1)}s` : '';
      return `<details class="turn-part turn-tool ${failed ? 'failed' : 'completed'}" ${blocks.length ? '' : 'data-empty="true"'}>
        <summary><span class="turn-part-dot"></span><strong>${esc(part.name || result?.name || '工具')} ${status}</strong><span>${esc(result?.summary || part.summary || '')}${duration}</span><i>›</i></summary>
        <div class="agent-activity-detail">${blocks.join('')}</div>
      </details>`;
    }
    if (part.type === 'tool_result' && parts.some(item => item.type === 'tool_call' && item.callId === part.callId)) return '';
    if (part.type === 'final') {
      return `<section class="turn-final"><div class="turn-final-label">最终输出</div><div class="bubble agent-bubble">${renderRichText(part.text || '')}</div></section>`;
    }
    if (part.type === 'interrupted') return `<div class="turn-interrupted">回复已中断，可继续完成剩余工作。</div>`;
    if (part.type === 'error') return `<div class="turn-error">${esc(part.message || 'Agent 执行失败')}</div>`;
    return '';
  }).join('')}</div>`;
}

function renderSessionRecovery() {
  chatEl.querySelector('.session-recovery')?.remove();
  const state = sessionStateById.get(currentSessionId);
  if (!['interrupted', 'error'].includes(state?.status)) return;
  hideWelcome();
  const card = document.createElement('div');
  card.className = 'session-recovery';
  const interrupted = state.status === 'interrupted';
  card.innerHTML = `
    <div class="session-recovery-copy">
      <div class="session-recovery-title">${interrupted ? '上次回复已中断' : '上次执行未完成'}</div>
      <div class="session-recovery-desc">保留当前会话上下文，继续完成剩余工作，不重复已经完成的部分。</div>
    </div>
    <button class="session-recovery-btn">继续对话</button>`;
  card.querySelector('button').onclick = async event => {
    event.currentTarget.disabled = true;
    card.remove();
    await doChat('', currentSessionId, { resume: true });
  };
  chatEl.appendChild(card);
  scrollChat();
}

let runningTaskCardTimer = null;

function runningPhaseLabel(phase = '') {
  return ({ starting: '正在启动 Agent', waiting: '等待 Agent 输出', thinking: '正在分析', streaming: '正在生成结果', running: '正在调用工具', working: '正在处理工具结果', completed: '工具调用完成' })[phase] || '任务执行中';
}

function updateSessionRunningTaskCard({ phase, statusText, currentActivity, outputChars, thinkingChars, lastActivityAt } = {}) {
  const card = chatEl.querySelector('.session-running-task');
  if (!card) return;
  if (outputChars !== undefined) card.dataset.outputChars = String(outputChars);
  if (thinkingChars !== undefined) card.dataset.thinkingChars = String(thinkingChars);
  if (phase) card.dataset.phase = phase;
  const status = currentActivity?.summary || statusText;
  if (status) card.querySelector('.session-running-status').textContent = status;
  if (phase) card.querySelector('.session-running-phase').textContent = runningPhaseLabel(phase);
  card.querySelector('.session-running-metrics').textContent = `输出 ${Number(card.dataset.outputChars || 0).toLocaleString()} 字符 · 分析 ${Number(card.dataset.thinkingChars || 0).toLocaleString()} 字符`;
  if (lastActivityAt) card.querySelector('.session-running-active').textContent = `最后活跃 ${formatTime(lastActivityAt)}`;
}

function bumpSessionRunningTaskMetric(kind, amount) {
  const card = chatEl.querySelector('.session-running-task');
  if (!card) return;
  const key = kind === 'thinking' ? 'thinkingChars' : 'outputChars';
  updateSessionRunningTaskCard({
    phase: kind === 'thinking' ? 'thinking' : 'streaming',
    statusText: kind === 'thinking' ? 'Agent 正在分析任务' : 'Agent 正在生成结果',
    [key]: Number(card.dataset[key] || 0) + Number(amount || 0),
    lastActivityAt: new Date().toISOString(),
  });
}

function stopRunningTaskCardTimer() {
  if (runningTaskCardTimer) clearInterval(runningTaskCardTimer);
  runningTaskCardTimer = null;
}

function renderSessionRunningTask(task, run = {}) {
  stopRunningTaskCardTimer();
  chatEl.querySelector('.session-running-task')?.remove();
  if (!task || task.session_id !== currentSessionId) return;
  hideWelcome();
  const card = document.createElement('div');
  card.className = 'session-running-task';
  card.dataset.taskId = task.id;
  card.dataset.outputChars = String(run.outputChars || 0);
  card.dataset.thinkingChars = String(run.thinkingChars || 0);
  const started = Date.parse(task.started_at || run.startedAt || '') || Date.now();
  card.innerHTML = `
    <span class="session-running-pulse"></span>
    <div class="session-running-copy">
      <strong>任务正在后台执行</strong>
      <span>${esc(task.title || run.taskTitle || task.id)} · ${esc(task.executed_by || task.agent || run.agentKey || '')}</span>
      <span class="session-running-status">${esc(run.statusText || runningPhaseLabel(run.phase))}</span>
      <small><span class="session-running-phase">${esc(runningPhaseLabel(run.phase))}</span> · <span class="session-running-metrics">输出 ${Number(run.outputChars || 0).toLocaleString()} 字符 · 分析 ${Number(run.thinkingChars || 0).toLocaleString()} 字符</span></small>
      <small>刷新页面不会中断任务 · 已运行 <span class="session-running-elapsed">${esc(formatDuration(Date.now() - started))}</span> · <span class="session-running-active">${run.lastActivityAt ? `最后活跃 ${formatTime(run.lastActivityAt)}` : '等待状态更新'}</span></small>
    </div>
    <button type="button">查看任务</button>`;
  card.querySelector('button').onclick = () => document.getElementById('tasksExpandBtn')?.click();
  chatEl.appendChild(card);
  updateSessionRunningTaskCard(run);
  let pollTick = 0;
  runningTaskCardTimer = setInterval(async () => {
    if (!card.isConnected || currentSessionId !== task.session_id) return stopRunningTaskCardTimer();
    card.querySelector('.session-running-elapsed').textContent = formatDuration(Date.now() - started);
    pollTick += 1;
    if (pollTick % 2) return;
    try {
      const { running = [] } = await fetch('/api/running').then(response => response.json());
      const active = running.find(item => item.sessionId === currentSessionId && (!item.taskId || item.taskId === task.id));
      if (active) updateSessionRunningTaskCard(active);
      else {
        const { tasks = [] } = await fetch('/api/tasks').then(response => response.json());
        if (!tasks.some(item => item.id === task.id && item.status === 'in_progress')) {
          card.remove();
          stopRunningTaskCardTimer();
          loadTasks();
        }
      }
    } catch {}
  }, 1000);
  scrollChat();
}

async function waitForSessionRecovery(attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await loadSessions();
    if (['interrupted', 'error'].includes(sessionStateById.get(currentSessionId)?.status)) return true;
    await new Promise(resolveWait => setTimeout(resolveWait, 300));
  }
  showToast('Agent 仍在停止中，请稍后再继续', 'info');
  return false;
}

function renderAssistantHistoryBubble(h) {
  const meta = agentMeta(h.agent);
  const displayName = meta.nickname || meta.label;
  const row = document.createElement('div');
  row.className = 'bubble-row';
  const timestamp = h.finishedAt || h.startedAt;
  row.innerHTML = `
    ${renderAgentAvatar(h.agent)}
    <div class="bubble-content-wrap agent-turn">
      <div class="bubble-name">${esc(displayName)}${timestamp ? ` <span class="bubble-time">${formatTime(timestamp)}</span>` : ''}</div>
      ${renderTurnParts(h.parts, h.text)}
      <div class="bubble-actions">
        <button class="bubble-action-btn" data-action="copy" title="复制">⧉</button>
      </div>
    </div>`;
  bindBubbleActions(row, h.text || '', 'assistant');
  return row;
}

function renderHistoryEntry(h, prepend = false) {
  if (h.role === 'user') {
    return addUserBubble(h.text, { prepend, scroll: false, attachments: h.attachments || [] });
  }
  if (h.role === 'assistant' && h.kind === 'task-review') {
    hideWelcome();
    const card = createTaskReviewCard({
      id: h.taskId,
      title: h.taskTitle,
      reviewer: h.agent,
      ...(h.review || {}),
    });
    if (prepend) {
      const pager = document.getElementById('historyPager');
      chatEl.insertBefore(card, pager ? pager.nextSibling : chatEl.firstElementChild);
    } else {
      chatEl.appendChild(card);
    }
    return card;
  }
  if (h.role === 'assistant') {
    hideWelcome();
    const row = renderAssistantHistoryBubble(h);
    if (prepend) {
      const pager = document.getElementById('historyPager');
      chatEl.insertBefore(row, pager ? pager.nextSibling : chatEl.firstElementChild);
    } else {
      chatEl.appendChild(row);
    }
    return row;
  }
  if (h.role === 'plan' && h.kind === 'plan-result' && Array.isArray(h.tasks)) {
    // 复现 plan card（不带交互按钮，只展示）
    hideWelcome();
    const row = document.createElement('div');
    row.className = 'bubble-row';
    const taskRows = h.tasks.map((t, i) => renderPlanTaskRow(
      t,
      i,
      `<span class="plan-task-agent">${esc(t.agent || '')}</span>`,
      { open: i === 0 },
    )).join('');
    row.innerHTML = `
      <div class="avatar system-av">📋</div>
      <div class="plan-card">
        <div class="plan-card-header">
          <div><span class="plan-card-kicker">历史计划 · ${esc(h.runId || '')}</span><div class="plan-card-title">${esc(h.goal || '')}</div></div>
          <span class="plan-card-count">${h.tasks.length} 个任务</span>
        </div>
        ${taskRows}
      </div>`;
    if (prepend) {
      const pager = document.getElementById('historyPager');
      chatEl.insertBefore(row, pager ? pager.nextSibling : chatEl.firstElementChild);
    } else {
      chatEl.appendChild(row);
    }
    return row;
  }
  if (h.role === 'system') {
    // 失败/系统消息历史
    hideWelcome();
    const row = document.createElement('div');
    const isError = h.kind === 'plan-error' || h.kind === 'chat-error';
    row.innerHTML = `<div class="bubble system-bubble${isError ? ' system-bubble-error' : ''}">${esc(h.text)}</div>`;
    if (prepend) {
      const pager = document.getElementById('historyPager');
      chatEl.insertBefore(row, pager ? pager.nextSibling : chatEl.firstElementChild);
    } else {
      chatEl.appendChild(row);
    }
    return row;
  }
  return null;
}

function updateHistoryPager() {
  let pager = document.getElementById('historyPager');
  if (!historyPage.hasMore) {
    if (pager) pager.remove();
    return;
  }
  if (!pager) {
    pager = document.createElement('button');
    pager.id = 'historyPager';
    pager.className = 'history-pager';
    pager.onclick = () => loadHistory({ older: true });
    chatEl.insertBefore(pager, chatEl.firstElementChild);
  }
  pager.textContent = historyPage.loading ? '加载中...' : '加载更早记录';
  pager.disabled = historyPage.loading;
}

async function loadHistory({ older = false } = {}) {
  if (historyPage.loading) return;
  const requestedSessionId = currentSessionId;
  historyPage.loading = true;
  updateHistoryPager();
  const prevHeight = chatEl.scrollHeight;
  const prevTop = chatEl.scrollTop;
  try {
    const params = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
    if (currentSessionId) params.set('sessionId', currentSessionId);
    if (older && historyPage.nextBefore !== null) params.set('before', String(historyPage.nextBefore));
    const { history, sessionId, page } = await fetch(`/api/history?${params.toString()}`).then(r => r.json());
    if (requestedSessionId && requestedSessionId !== currentSessionId) return;
    if (sessionId) currentSessionId = sessionId;
    if (history && history.length) {
      hideWelcome();
      if (older) {
        history.slice().reverse().forEach(h => renderHistoryEntry(h, true));
        chatEl.scrollTop = prevTop + (chatEl.scrollHeight - prevHeight);
      } else {
        history.forEach(h => renderHistoryEntry(h, false));
        // 直接定位到底部，不做滚动动画（用户点对话就从最新消息开始看）
        chatEl.scrollTop = chatEl.scrollHeight;
      }
    }
    historyPage.hasMore = Boolean(page?.hasMore);
    historyPage.nextBefore = page?.nextBefore ?? null;
    if (!older) {
      renderSessionRecovery();
      await restoreWorkflowCard(currentSessionId);
    }
  } catch {
    // Chat still works if history cannot be loaded.
  } finally {
    historyPage.loading = false;
    updateHistoryPager();
  }
}

(async function init() {
  await loadStatus();
  await loadSessions();
  await loadTasks();
  await loadHistory();
  await restoreRunningState();
  loadArtifacts();
})();

// Reconnect to a running session live SSE stream after a page refresh.
// Replays buffered events + subscribes to future output, feeding chunks
// into a freshly created typing bubble so the user sees ongoing progress.
async function reconnectSessionStream(sessionId, agentKey, taskTitle) {
  if (!sessionId) return;
  // only reconnect for the currently visible session
  if (sessionId !== currentSessionId) return;
  try {
    // History has already restored persisted parts; only subscribe to new live events.
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/stream?replay=0`);
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let bubble = null;
    const ensureBubble = (agent) => {
      if (bubble) return bubble;
      setActiveAgent(agent || agentKey);
      bubble = startAgentBubble(agent || agentKey, sessionId);
      showRunningPanel({ agent: agent || agentKey, mode: 'reconnect', taskTitle: taskTitle || '' });
      return bubble;
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const block of parts) {
        let event = 'message', data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7).trim();
          if (line.startsWith('data: '))  data  = line.slice(6).trim();
        }
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        if (event === 'nostream') { break; }
        if (event === 'start') { ensureBubble(parsed.agent || agentKey); continue; }
        if (event === 'status') {
          ensureBubble(parsed.agent || agentKey);
          updateAgentStatus(parsed.text, parsed.phase);
          updateSessionRunningTaskCard({ statusText: parsed.text, phase: parsed.phase, lastActivityAt: new Date().toISOString() });
          const workflowRunId = rememberedSessionWorkflow(sessionId);
          if (workflowRunId) renderWorkflowCard({ workflowRunId, status: 'running', live: { active: true, statusText: parsed.text, phase: parsed.phase, agent: parsed.agent || agentKey, lastActivityAt: new Date().toISOString() } });
          continue;
        }
        if (event === 'part') { ensureBubble(parsed.agent || agentKey); appendTurnPart(parsed); continue; }
        if (event === 'chunk' && parsed.text) { ensureBubble(parsed.agent || agentKey); appendTyping(parsed.text); bumpRunningChars('chunk', (parsed.text||'').length); bumpSessionRunningTaskMetric('output', (parsed.text || '').length); continue; }
        if (event === 'thinking' && parsed.text) { appendThinking(parsed.text); bumpRunningChars('thinking', (parsed.text||'').length); bumpSessionRunningTaskMetric('thinking', (parsed.text || '').length); continue; }
        if (event === 'activity') {
          appendAgentActivity(parsed);
          updateSessionRunningTaskCard({ phase: parsed.phase || 'running', currentActivity: parsed, lastActivityAt: new Date().toISOString() });
          const workflowRunId = rememberedSessionWorkflow(sessionId);
          const activityText = parsed.summary ? `${parsed.name || '工具'}：${parsed.summary}` : `${parsed.name || '工具'} ${parsed.phase === 'completed' ? '已完成' : '运行中'}`;
          if (workflowRunId) renderWorkflowCard({ workflowRunId, status: 'running', live: { active: true, statusText: activityText, phase: parsed.phase || 'tool', agent: agentKey, currentActivity: parsed, lastActivityAt: new Date().toISOString() } });
          continue;
        }
        if (event === 'task-review-done') { addTaskReviewCard(parsed); loadTasks(); continue; }
        if (event === 'task-review-retrying') { updateSessionRunningTaskCard({ statusText: `Reviewer 正在修复输出格式（${parsed.attempt}/${parsed.maxAttempts}）`, phase: 'working', lastActivityAt: new Date().toISOString() }); continue; }
        if (event === 'task-review-repair') { addTaskReviewCard({ ...parsed, verdict: 'agent_repair_pending' }); loadTasks(); continue; }
        if (event === 'task-review-skip') { addTaskReviewCard({ ...parsed, verdict: 'skipped', reason: '没有可用的 Reviewer Agent' }); loadTasks(); continue; }
        if (event === 'task-review-failed') { addTaskReviewCard({ ...parsed, verdict: 'failed', reason: parsed.error || parsed.reason || '自动验收失败' }); loadTasks(); continue; }
        if (event === 'done') { finishTyping(collectFinishStats()); hideRunningPanel(); stopRunningTaskCardTimer(); chatEl.querySelector('.session-running-task')?.remove(); loadTasks(); loadSessions(); break; }
        if (event === 'error') { finishTyping(); hideRunningPanel(); stopRunningTaskCardTimer(); chatEl.querySelector('.session-running-task')?.remove(); addSystemMsg(`? ${parsed.message||''}`); break; }
      }
    }
  } catch (e) {
    console.warn('reconnect stream failed:', e);
  }
}

// 刷新后恢复运行中任务状态
async function restoreRunningState() {
  try {
    const [runningRes, tasksRes] = await Promise.all([
      fetch('/api/running'),
      fetch('/api/tasks')
    ]);
    const { running = [], dispatches = [] } = await runningRes.json();
    const { tasks = [] } = await tasksRes.json();
    for (const dispatch of dispatches) {
      if (dispatch.workflowRunId) {
        rememberSessionWorkflow(dispatch.sessionId, dispatch.workflowRunId);
        if (dispatch.sessionId === currentSessionId) {
          await refreshWorkflowCard(dispatch.workflowRunId, { quiet: true });
        }
      }
      if (running.some(item => item.sessionId === dispatch.sessionId)) continue;
      const nextTask = tasks.find(task => task.session_id === dispatch.sessionId && task.status === 'pending');
      running.push({
        sessionId: dispatch.sessionId,
        clientRunId: dispatch.clientRunId,
        agentKey: dispatch.agentKey || nextTask?.agent || '',
        mode: 'dispatch',
        taskId: dispatch.taskId || nextTask?.id || '',
        taskTitle: dispatch.taskTitle || nextTask?.title || '正在切换到下一项任务',
        workflowRunId: dispatch.workflowRunId || '',
        phase: dispatch.phase || 'waiting',
        statusText: dispatch.statusText || '当前批次仍在执行，正在切换任务',
        startedAt: dispatch.startedAt,
        lastActivityAt: dispatch.lastActivityAt || null,
      });
    }
    const inProgress = tasks.filter(t => t.status === 'in_progress');
    for (const t of inProgress) {
      const existing = running.find(r => r.sessionId === t.session_id && (!r.taskId || r.taskId === t.id));
      if (existing) {
        existing.taskId ||= t.id;
        if (!existing.taskTitle || existing.taskTitle === existing.taskId) existing.taskTitle = t.title;
      } else {
        running.push({
          sessionId: t.session_id,
          taskId: t.id,
          agentKey: t.executed_by || t.agent,
          mode: 'dispatch',
          taskTitle: t.title,
          startedAt: t.started_at || t.updated_at || new Date().toISOString(),
        });
      }
    }
    if (!running || !running.length) return;
    
    running.forEach(r => {
      // 恢复 session 运行标记
      if (r.sessionId) {
        sessionRuns.set(r.sessionId, {
          running: true,
          mode: r.mode,
          activeAgent: r.agentKey,
          clientRunId: r.clientRunId,
          startedAt: r.startedAt ? new Date(r.startedAt).getTime() : Date.now(),
        });
      }
      
      // 如果是当前 session，恢复 runningState 面板
      if (r.sessionId === currentSessionId) {
        const activeTask = tasks.find(task => task.id === r.taskId)
          || inProgress.find(task => task.session_id === currentSessionId);
        const workflowRunId = r.workflowRunId || rememberedSessionWorkflow(currentSessionId);
        if (workflowRunId) renderWorkflowCard({
          workflowRunId,
          status: 'running',
          task: activeTask || null,
          live: {
            active: true,
            statusText: r.statusText || `${r.agentKey || 'Agent'} 正在执行「${r.taskTitle || activeTask?.title || ''}」`,
            phase: r.phase || 'working',
            agent: r.agentKey || activeTask?.agent || '',
            currentActivity: r.currentActivity || null,
            startedAt: r.startedAt || null,
            lastActivityAt: r.lastActivityAt || null,
            outputChars: Number(r.outputChars || 0),
            thinkingChars: Number(r.thinkingChars || 0),
          },
        });
        renderSessionRunningTask(activeTask, r);
        showRunningPanel({
          agent: r.agentKey,
          mode: r.mode,
          taskTitle: r.taskTitle || '',
        });
        // 恢复已消耗的时间
        if (runningState) {
          runningState.startedAt = r.startedAt ? new Date(r.startedAt).getTime() : Date.now();
        }
      }
    });
    updateVisibleRunState();
    // Reconnect to any running session live SSE stream so ongoing output
    // continues flowing after a page refresh (replays buffered events).
    const currentRun = running.find(r => r.sessionId === currentSessionId);
    if (currentRun) {
      reconnectSessionStream(currentRun.sessionId, currentRun.agentKey, currentRun.taskTitle);
    }
  } catch (e) {
    console.warn('恢复运行状态失败:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// 产物面板（Artifacts Panel）P3+P4+P5
// 对齐 clowder-ai F063（workspace explorer）+ F148（artifact ledger）
// ═══════════════════════════════════════════════════════════════


// ─── Subagent session ───────────────────────────────────────────
(function() {
const saBackBtn = document.getElementById("saBackBtn");
if (!saBackBtn) return;
const saView = document.getElementById("subagentView");
const saTitle = document.getElementById("saTitle");
const saStatus = document.getElementById("saStatus");
const saMessages = document.getElementById("saMessages");
const saEmpty = document.getElementById("saEmpty");
const chatArea = document.querySelector(".chat-area");
let saPollTimer = null;
let currentTaskId = null;
const knownMsgIds = new Set();
saBackBtn.addEventListener("click", () => hideSubagentView());
window.openSubagentSession = function(taskId, taskTitle, agentKey) {
  currentTaskId = taskId;
  saTitle.textContent = taskTitle || taskId;
  saStatus.textContent = ""; saStatus.className = "sa-status";
  saMessages.innerHTML = ""; saEmpty.textContent = "Loading..."; saEmpty.style.display = "block";
  knownMsgIds.clear();
  showSubagentView();
  loadChainMessages(taskId);
  startPolling(taskId);
};
function showSubagentView() { saView.classList.remove("hidden"); chatArea.style.display = "none"; }
function hideSubagentView() { saView.classList.add("hidden"); chatArea.style.display = ""; stopPolling(); }
async function loadChainMessages(taskId) {
  try {
    const data = await fetch("/api/chain-task/messages?taskId=" + encodeURIComponent(taskId)).then(r=>r.json());
    if (data.messages) { for (const msg of data.messages) { if (!knownMsgIds.has(msg.timestamp+msg.type)) { knownMsgIds.add(msg.timestamp+msg.type); renderChainMessage(msg); } } }
  } catch(e) {}
}
function startPolling(taskId) { stopPolling(); saPollTimer = setInterval(() => loadChainMessages(taskId), 3000); }
function stopPolling() { if (saPollTimer) { clearInterval(saPollTimer); saPollTimer = null; } }
function renderChainMessage(msg) {
  saEmpty.style.display = "none";
  const div = document.createElement("div"); div.className = "sa-msg " + (msg.type||"");
  var h;
  if (msg.type === "task-start") h = "🚀 " + (msg.agent||"") + " start: " + (msg.title||"");
  else if (msg.type === "task-done") { h = "✅ " + (msg.agent||"") + " done"; if (msg.summary) h += ": " + esc(msg.summary.slice(0,200)); saStatus.textContent = "✓ Done"; saStatus.className = "sa-status done"; }
  else if (msg.type === "task-failed") { h = "❌ " + (msg.agent||"") + " failed: " + esc((msg.error||"").slice(0,200)); saStatus.textContent = "✗ Failed"; saStatus.className = "sa-status failed"; }
  else h = JSON.stringify(msg);
  div.innerHTML = "<div class=\"sa-system-msg " + ((msg.type==="task-done")?"done":(msg.type==="task-failed")?"failed":"") + "\">" + h + "</div>";
  saMessages.appendChild(div); saMessages.scrollTop = saMessages.scrollHeight;
}
})();

