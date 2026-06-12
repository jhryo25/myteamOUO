// ── 工具 ─────────────────────────────────────────────────────
function esc(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Rich Blocks 渲染器 ─────────────────────────────────────────
// 支持: ```code``` / `inline` / **b** / *i* / # h1 / - list / 1. ol
// 自定义块: :::card title="X" / :::checklist title="X" / :::role name="X" tag="Y"
function parseAttrs(s) {
  const attrs = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

function renderInline(text) {
  // 已经 esc 过的文本上做 inline 解析
  return text
    .replace(/`([^`]+)`/g, (_, c) => `<code class="rb-inline-code">${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<span class="rb-bold">$1</span>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<span class="rb-italic">$1</span>');
}

function renderListBlock(lines) {
  const isOrdered = /^\s*\d+\./.test(lines[0]);
  const tag = isOrdered ? 'ol' : 'ul';
  const cls = isOrdered ? 'rb-ol' : 'rb-ul';
  const items = lines.map(l => {
    const m = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    return `<li class="rb-li">${renderInline(esc(m ? m[1] : l))}</li>`;
  }).join('');
  return `<${tag} class="${cls}">${items}</${tag}>`;
}

function renderCustomBlock(type, attrs, body) {
  const a = parseAttrs(attrs || '');
  if (type === 'card') {
    return `<div class="rb-card">
      ${a.title ? `<div class="rb-card-title">${esc(a.title)}</div>` : ''}
      <div class="rb-card-body">${renderRichText(body)}</div>
    </div>`;
  }
  if (type === 'checklist') {
    const items = body.split('\n').filter(l => l.trim()).map(l => {
      const m = l.match(/^\s*(?:\[(x|X| )\]|\-)\s*(.*)$/);
      const done = m && m[1] && m[1].toLowerCase() === 'x';
      const text = m ? m[2] : l.replace(/^\s*-\s*/, '');
      return `<div class="rb-checklist-item${done ? ' done' : ''}">${renderInline(esc(text))}</div>`;
    }).join('');
    return `<div class="rb-checklist">
      ${a.title ? `<div class="rb-checklist-title">📋 ${esc(a.title)}</div>` : ''}
      ${items}
    </div>`;
  }
  if (type === 'role') {
    const initial = (a.name || '?').charAt(0).toUpperCase();
    return `<div class="rb-role">
      <div class="rb-role-avatar">${esc(initial)}</div>
      <div class="rb-role-body">
        <div class="rb-role-name">${esc(a.name || '')}
          ${a.tag ? `<span class="rb-role-tag">${esc(a.tag)}</span>` : ''}
        </div>
        <div class="rb-role-desc">${renderInline(esc(body.trim()))}</div>
      </div>
    </div>`;
  }
  return `<div>${esc(body)}</div>`;
}

function renderRichText(raw) {
  if (!raw) return '';
  // 1) 提取代码块和自定义块占位
  const placeholders = [];
  let text = raw;

  // 自定义块 :::type attrs...\n body \n:::
  text = text.replace(/:::(\w+)([^\n]*)\n([\s\S]*?)\n:::/g, (m, type, attrs, body) => {
    const idx = placeholders.length;
    placeholders.push(renderCustomBlock(type, attrs, body));
    return `\x00BLOCK${idx}\x00`;
  });

  // 代码块 ```lang\n body \n```
  text = text.replace(/```(\w*)\n([\s\S]*?)\n```/g, (m, lang, body) => {
    const idx = placeholders.length;
    const code = esc(body);
    const langLabel = lang ? `<span class="rb-code-lang">${esc(lang)}</span>` : '';
    placeholders.push(`<div class="rb-code"><button class="rb-code-copy" onclick="copyCode(this)">复制</button>${langLabel}<code>${code}</code></div>`);
    return `\x00BLOCK${idx}\x00`;
  });

  // 2) 按行解析
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 占位符独占一行
    const ph = line.match(/^\x00BLOCK(\d+)\x00$/);
    if (ph) {
      out.push(placeholders[+ph[1]]);
      i++;
      continue;
    }
    // 标题
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      out.push(`<div class="rb-h${lvl}">${renderInline(esc(h[2]))}</div>`);
      i++;
      continue;
    }
    // 列表（连续行聚合）
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const block = [];
      while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) {
        block.push(lines[i]);
        i++;
      }
      out.push(renderListBlock(block));
      continue;
    }
    // 空行
    if (!line.trim()) {
      out.push('<br>');
      i++;
      continue;
    }
    // 普通段落（含占位符替换）
    let html = renderInline(esc(line));
    html = html.replace(/&#0;BLOCK(\d+)&#0;|\x00BLOCK(\d+)\x00/g, (m, a, b) => placeholders[+(a || b)]);
    out.push(`<div>${html}</div>`);
    i++;
  }
  return out.join('');
}

function copyCode(btn) {
  const code = btn.parentElement.querySelector('code');
  if (!code) return;
  navigator.clipboard.writeText(code.textContent).then(() => {
    const old = btn.textContent;
    btn.textContent = '✓ 已复制';
    setTimeout(() => { btn.textContent = old; }, 1200);
  });
}

// ── chat helpers ─────────────────────────────────────────────
const chatEl = document.getElementById('chatMessages');
const welcome = document.getElementById('chatWelcome');
let agentTypingBubble = null;

function hideWelcome() {
  const el = document.getElementById('chatWelcome');
  if (el && el.parentNode) el.remove();
}

function addSystemMsg(text) {
  const row = document.createElement('div');
  row.innerHTML = `<div class="bubble system-bubble">${esc(text)}</div>`;
  chatEl.appendChild(row);
  scrollChat();
}

function addUserBubble(text) {
  hideWelcome();
  const row = document.createElement('div');
  row.className = 'bubble-row user';
  row.innerHTML = `
    <div>
      <div class="bubble-name">你</div>
      <div class="bubble user-bubble">${esc(text)}</div>
    </div>
    <div class="avatar user-av">我</div>`;
  chatEl.appendChild(row);
  scrollChat();
}

function startAgentBubble(agentKey) {
  hideWelcome();
  const avatarMap = {
    codex:  { cls: 'codex-av',  emoji: '🤖', name: 'Codex' },
    claude: { cls: 'claude-av', emoji: '✨', name: 'Claude' },
  };
  const a = avatarMap[agentKey] || { cls: 'system-av', emoji: '●', name: agentKey };

  const row = document.createElement('div');
  row.className = 'bubble-row';
  row.innerHTML = `
    <div class="avatar ${a.cls}">${a.emoji}</div>
    <div>
      <div class="bubble-name">${a.name}</div>
      <div class="bubble agent-bubble typing-cursor" id="typingBubble"></div>
    </div>`;
  chatEl.appendChild(row);
  agentTypingBubble = row.querySelector('#typingBubble');
  scrollChat();
  return agentTypingBubble;
}

function appendTyping(text) {
  if (!agentTypingBubble) return;
  // 流式阶段保留 textContent，在 finishTyping 时一次性渲染富文本
  agentTypingBubble.dataset.raw = (agentTypingBubble.dataset.raw || '') + text;
  agentTypingBubble.textContent = agentTypingBubble.dataset.raw;
  scrollChat();
}

function finishTyping() {
  if (agentTypingBubble) {
    agentTypingBubble.classList.remove('typing-cursor');
    const raw = agentTypingBubble.dataset.raw || agentTypingBubble.textContent;
    if (raw) {
      try {
        agentTypingBubble.innerHTML = renderRichText(raw);
      } catch (err) {
        console.error('renderRichText failed:', err);
      }
    }
    agentTypingBubble = null;
  }
}

function scrollChat() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

// ── 结构化气泡：plan 任务列表 ─────────────────────────────────
function addPlanCard(goal, tasks) {
  hideWelcome();
  const rows = tasks.map((t, i) => {
    const steps = (t.steps || []).length;
    return `<div class="plan-task-row">
      <span class="plan-task-num">${i + 1}</span>
      <div class="plan-task-body">
        <div class="plan-task-name">${esc(t.title)}</div>
        <div class="plan-task-meta">
          <span class="plan-task-agent">${esc(t.agent)}</span>
          ${steps ? `<span>${steps} 步</span>` : ''}
        </div>
        ${t.accept ? `<div class="plan-task-accept">✓ ${esc(t.accept)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  const row = document.createElement('div');
  row.className = 'bubble-row';
  row.innerHTML = `
    <div class="avatar system-av">📋</div>
    <div class="plan-card">
      <div class="plan-card-title">🎯 ${esc(goal)}</div>
      ${rows}
    </div>`;
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

// ── radio group ───────────────────────────────────────────────
function buildRadioGroup(containerId, items, defaultVal) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  items.forEach(({ key, label }) => {
    const btn = document.createElement('div');
    btn.className = 'radio-btn' + (key === defaultVal ? ' active' : '');
    btn.dataset.value = key;
    btn.textContent = label;
    btn.onclick = () => {
      el.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
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
    const { agents } = await fetch('/api/status').then(r => r.json());
    const pillsEl = document.getElementById('agentPills');
    pillsEl.innerHTML = agents.map(a =>
      `<span class="agent-pill ${a.available ? 'ok' : 'err'}">
        <span class="dot"></span>${a.key}
      </span>`
    ).join('');

    const availableAgents = agents.filter(a => a.available);
    buildRadioGroup('planAgentGroup',
      availableAgents.map(a => ({ key: a.key, label: a.key })),
      availableAgents[0]?.key
    );
  } catch {
    document.getElementById('agentPills').innerHTML =
      '<span class="agent-pill err"><span class="dot"></span>离线</span>';
    addSystemMsg('⚠ 无法连接 server.mjs，请先运行：node server.mjs');
  }
}

// ── tasks ─────────────────────────────────────────────────────
let allTasks = [];
let currentFilter = 'all';
let currentSearch = '';

async function loadTasks() {
  const { tasks } = await fetch('/api/tasks').then(r => r.json()).catch(() => ({ tasks: [] }));
  allTasks = tasks;
  filterAndRenderTasks();
  // 有 pending 就启用 dispatch 按钮
  const hasPending = tasks.some(t => t.status === 'pending');
  document.getElementById('dispatchBtn').disabled = !hasPending;
  return tasks;
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
      t.title.toLowerCase().includes(term) ||
      (t.goal && t.goal.toLowerCase().includes(term)) ||
      (t.agent && t.agent.toLowerCase().includes(term))
    );
  }
  
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
  in_progress: 'sd-running',
  done:        'sd-done',
  failed:      'sd-failed',
};

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

    const itemsEl = document.createElement('div');
    itemsEl.className = 'run-items';

    items.forEach(task => {
      const item = document.createElement('div');
      item.className = 'task-item' + (task.status === 'in_progress' ? ' active' : '');
      item.dataset.id = task.id;

      const dotCls = STATUS_DOT[task.status] || 'sd-pending';
      const agentLabel = task.executed_by || task.agent || '';

      const steps = (task.steps || []).map(s => `<li>${esc(s)}</li>`).join('');
      const accept = task.accept
        ? `<div class="task-detail-section"><div class="task-detail-label">验收标准</div>
           <div class="task-accept-text">✓ ${esc(task.accept)}</div></div>` : '';
      const result = task.result
        ? `<div class="task-detail-section"><div class="task-detail-label">执行结果</div>
           <pre class="task-result-pre">${esc(task.result)}</pre></div>` : '';
      const error = task.error
        ? `<div class="task-error-text">✗ ${esc(task.error)}</div>` : '';

      item.innerHTML = `
        <div class="task-row">
          <span class="task-status-dot ${dotCls}"></span>
          <span class="task-row-title" title="${esc(task.title)}">${esc(task.title)}</span>
          <span class="task-row-agent">${esc(agentLabel)}</span>
          <div class="task-actions">
            <button class="task-action-btn" data-action="rerun" data-task-id="${esc(task.id)}" title="重新执行">↻</button>
            <button class="task-action-btn danger" data-action="delete" data-task-id="${esc(task.id)}" title="删除">✕</button>
          </div>
          <span class="task-chevron">›</span>
        </div>
        <div class="task-detail">
          ${steps ? `<div class="task-detail-section">
            <div class="task-detail-label">步骤</div>
            <ul>${steps}</ul></div>` : ''}
          ${accept}
          ${result}
          ${error}
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
let currentAbortController = null;

function ssePost(url, body, handlers) {
  return new Promise(resolve => {
    currentAbortController = new AbortController();
    const stopBtn = document.getElementById('stopBtn');
    stopBtn.classList.remove('hidden');
    
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: currentAbortController.signal,
    }).then(async res => {
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
          handlers[event]?.(parsed);
          if (event === 'done') resolve(parsed);
        }
      }
      resolve(null);
    }).catch(err => {
      if (err.name === 'AbortError') {
        handlers.aborted?.();
      } else {
        handlers.error?.({ message: err.message });
      }
      resolve(null);
    }).finally(() => {
      stopBtn.classList.add('hidden');
      currentAbortController = null;
    });
  });
}

// Stop button handler
document.getElementById('stopBtn').onclick = async () => {
  if (currentAbortController) {
    currentAbortController.abort();
    await fetch('/api/abort', { method: 'POST' });
  }
};

// ── 模式切换 ──────────────────────────────────────────────────
const modeGroup       = document.getElementById('modeGroup');
const planAgentLabel  = document.getElementById('planAgentLabel');
const planAgentGroupEl= document.getElementById('planAgentGroup');
const mentionHint     = document.getElementById('mentionHint');
const sendBtn         = document.getElementById('sendBtn');
const goalInput       = document.getElementById('goalInput');   // 统一在此声明，避免 TDZ

modeGroup.querySelectorAll('.radio-btn').forEach(btn => {
  btn.onclick = () => {
    modeGroup.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const isPlan = btn.dataset.value === 'plan';
    planAgentLabel.classList.toggle('hidden', !isPlan);
    planAgentGroupEl.classList.toggle('hidden', !isPlan);
    goalInput.placeholder = isPlan
      ? '输入目标，例如：帮我整理一份本周工作计划…'
      : '输入消息，或用 @claude / @codex 指定 agent…';
  };
});

function getMode() {
  return modeGroup.querySelector('.radio-btn.active')?.dataset.value || 'chat';
}

// ── @mention 实时提示 ─────────────────────────────────────────
const MENTION_RE = /@(claude|codex)\b/i;

goalInput.addEventListener('input', () => {
  goalInput.style.height = 'auto';
  goalInput.style.height = Math.min(goalInput.scrollHeight, 120) + 'px';

  const m = goalInput.value.match(MENTION_RE);
  if (m && getMode() === 'chat') {
    mentionHint.textContent = `→ 将路由给 ${m[1].toLowerCase()}`;
    mentionHint.classList.remove('hidden');
  } else {
    mentionHint.classList.add('hidden');
  }
});

// ── send 入口：按模式分发 ─────────────────────────────────────
async function doSend() {
  const text = goalInput.value.trim();
  if (!text) return;
  if (getMode() === 'plan') {
    await doPlan(text);
  } else {
    await doChat(text);
  }
}

sendBtn.onclick = doSend;
goalInput.addEventListener('keydown', e => {
  // 中文输入法保护：检查 isComposing 或 keyCode 229
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { 
    e.preventDefault(); 
    doSend(); 
  }
});

// ── chat 模式 ─────────────────────────────────────────────────
async function doChat(message) {
  goalInput.value = '';
  goalInput.style.height = '';
  mentionHint.classList.add('hidden');
  sendBtn.disabled = true;

  addUserBubble(message);

  // 检测 @mention 用于 UI 预期
  const mentionMatch = message.match(MENTION_RE);
  const expectedAgent = mentionMatch ? mentionMatch[1].toLowerCase() : null;

  let bubble = null;

  await ssePost('/api/chat', { message, sessionId: currentSessionId }, {
    start: ({ agent }) => {
      bubble = startAgentBubble(agent);
    },
    chunk: ({ text }) => appendTyping(text),
    error: ({ message: msg }) => {
      finishTyping();
      addSystemMsg(`✗ ${msg}`);
    },
    done: () => {
      finishTyping();
      loadSessions(); // 刷新消息计数
    },
    aborted: () => {
      finishTyping();
      addSystemMsg('⏹ 已中断');
    },
  });

  sendBtn.disabled = false;
  goalInput.focus();
}

// ── plan 模式 ─────────────────────────────────────────────────
async function doPlan(goal) {
  const agent = getRadio('planAgentGroup') || 'codex';

  goalInput.value = '';
  goalInput.style.height = '';
  sendBtn.disabled = true;
  document.getElementById('dispatchBtn').disabled = true;

  addUserBubble(`📋 ${goal}`);
  addSystemMsg(`正在让 ${agent} 拆解任务…`);
  startAgentBubble(agent);

  await ssePost('/api/plan', { goal, agent }, {
    chunk: ({ text }) => appendTyping(text),
    error: ({ message }) => {
      finishTyping();
      addSystemMsg(`✗ 拆任务失败：${message}`);
    },
    done: ({ runId, written, tasks }) => {
      finishTyping();
      if (tasks && tasks.length) {
        addPlanCard(goal, tasks);
      } else {
        addSystemMsg(`✓ 拆解完成，共 ${written} 条任务（run_id: ${runId}）`);
      }
    },
    aborted: () => {
      finishTyping();
      addSystemMsg('⏹ 已中断');
    },
  });

  sendBtn.disabled = false;
  await loadTasks();
}

// ── dispatch ─────────────────────────────────────────────────
document.getElementById('dispatchBtn').onclick = async () => {
  const dispatchBtn = document.getElementById('dispatchBtn');
  const dispatchSpinner = document.getElementById('dispatchSpinner');

  dispatchBtn.disabled = true;
  dispatchSpinner.classList.remove('hidden');
  sendBtn.disabled = true;

  try {
    addSystemMsg('开始执行所有 pending 任务…');

    await ssePost('/api/dispatch', {}, {
      start:        ({ count }) => addSystemMsg(`共 ${count} 条任务待执行`),
      'task-start': ({ id, title, agent }) => {
        updateTaskDot(id, 'in_progress');
        startAgentBubble(agent);
        appendTyping(`[${title}]\n`);
      },
      chunk:        ({ text }) => appendTyping(text),
      'task-done':  ({ id, title, agent, summary }) => {
        finishTyping();
        updateTaskDot(id, 'done');
        if (title) addResultCard(title, agent, summary, true);
      },
      'task-failed':({ id, title, agent, error }) => {
        finishTyping();
        updateTaskDot(id, 'failed');
        addResultCard(title || id, agent || '', error, false);
      },
      'worklist-chain': ({ from, to, parent_id, chain_task_id }) => {
        finishTyping();
        addSystemMsg(`→ ${from} 触发了 @${to} 继续执行`);
      },
      done: ({ done, failed }) => {
        addSystemMsg(`✓ 全部执行完毕：${done} 成功 / ${failed} 失败`);
      },
      error: ({ message }) => addSystemMsg(`✗ ${message}`),
      aborted: () => {
        finishTyping();
        addSystemMsg('⏹ 已中断执行');
      },
    });
  } finally {
    dispatchSpinner.classList.add('hidden');
    sendBtn.disabled = false;
    await loadTasks();
  }
};

// ── agent 管理面板 ────────────────────────────────────────────
const settingsBtn    = document.getElementById('settingsBtn');
const settingsDrawer = document.getElementById('settingsDrawer');
const drawerMask     = document.getElementById('drawerMask');
const drawerClose    = document.getElementById('drawerClose');
const agentFormEl    = document.getElementById('agentForm');
const drawerSaveBtn  = document.getElementById('drawerSaveBtn');
const drawerSaveTip  = document.getElementById('drawerSaveTip');

const AGENT_META = {
  codex:  { label: 'Agent · Codex',  emoji: '🤖', desc: '总控 / 审查 / 自迭代' },
  claude: { label: 'Agent · Claude', emoji: '✨', desc: '主架构 / 深度实现' },
};

function openDrawer() {
  settingsDrawer.classList.remove('hidden');
  drawerMask.classList.remove('hidden');
  loadAgentConfig();
}
function closeDrawer() {
  settingsDrawer.classList.add('hidden');
  drawerMask.classList.add('hidden');
}

settingsBtn.onclick = openDrawer;
drawerClose.onclick = closeDrawer;
drawerMask.onclick  = closeDrawer;

async function loadAgentConfig() {
  agentFormEl.innerHTML = '<div style="color:var(--muted);font-size:13px;">加载中…</div>';
  try {
    const { agents } = await fetch('/api/agents').then(r => r.json());
    agentFormEl.innerHTML = '';
    agents.forEach(a => {
      const meta = AGENT_META[a.key] || { label: a.key, emoji: '●', desc: '' };
      const card = document.createElement('div');
      card.className = 'agent-card';
      card.innerHTML = `
        <div class="agent-card-header">
          <span style="font-size:18px;">${meta.emoji}</span>
          <div>
            <div class="agent-card-name">${meta.label}</div>
            <div style="font-size:11px;color:var(--muted);">${meta.desc}</div>
          </div>
          <span class="agent-status-badge ${a.available ? 'ok' : 'err'}">
            ${a.available ? '✓ 已检测' : '✗ 未检测'}
          </span>
        </div>
        <div class="path-input-row">
          <input class="path-input" data-agent="${a.key}" value="${esc(a.path)}"
            placeholder="填入 CLI 可执行文件路径，例如 C:\\...\\codex.cmd">
          <button class="path-check-btn" data-agent="${a.key}">检测</button>
        </div>
        <div class="path-check-result" data-result="${a.key}"
          style="font-size:11px;margin-top:5px;color:${a.available ? 'var(--green)' : 'var(--muted)'};">
          ${a.available ? `✓ 文件存在` : (a.path ? '✗ 文件不存在' : '未配置')}
        </div>`;
      agentFormEl.appendChild(card);
    });

    // 检测按钮：临时保存当前输入路径后调 /api/agents，看返回的 available
    agentFormEl.querySelectorAll('.path-check-btn').forEach(btn => {
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
            resultEl.textContent = '✓ 文件存在，路径有效';
            if (badge) { badge.className = 'agent-status-badge ok'; badge.textContent = '✓ 已检测'; }
          } else {
            resultEl.style.color = 'var(--red)';
            resultEl.textContent = '✗ 找不到文件，请检查路径';
            if (badge) { badge.className = 'agent-status-badge err'; badge.textContent = '✗ 未检测'; }
          }
        } catch { resultEl.textContent = '检测失败'; }
        btn.textContent = '检测';
      };
    });
  } catch {
    agentFormEl.innerHTML = '<div style="color:var(--red);font-size:13px;">无法加载配置，请确认服务器正在运行。</div>';
  }
}

drawerSaveBtn.onclick = async () => {
  const inputs = agentFormEl.querySelectorAll('.path-input');
  const payload = {};
  inputs.forEach(inp => { payload[inp.dataset.agent] = inp.value.trim(); });

  drawerSaveBtn.disabled = true;
  drawerSaveTip.className = 'drawer-save-tip hidden';

  try {
    const { agents: updated } = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json());

    drawerSaveTip.textContent = '✓ 已保存，配置立即生效';
    drawerSaveTip.className = 'drawer-save-tip ok';
    drawerSaveTip.classList.remove('hidden');

    // 刷新顶部 pills
    loadStatus();
    // 刷新抽屉状态
    setTimeout(loadAgentConfig, 300);
  } catch (err) {
    drawerSaveTip.textContent = `✗ 保存失败：${err.message}`;
    drawerSaveTip.className = 'drawer-save-tip err';
    drawerSaveTip.classList.remove('hidden');
  }
  drawerSaveBtn.disabled = false;
};

// ── Session 管理 ──────────────────────────────────────────────
let currentSessionId = null;

function clearChatArea() {
  chatEl.innerHTML = '';
  agentTypingBubble = null;
  const w = document.createElement('div');
  w.className = 'chat-welcome';
  w.id = 'chatWelcome';
  w.innerHTML = `
    <div class="emoji">🤝</div>
    <h2>欢迎来到 myteam</h2>
    <p>直接发消息和 agent 对话，用 <code style="background:var(--surface2);padding:1px 5px;border-radius:4px;font-size:12px;">@claude</code> 或 <code style="background:var(--surface2);padding:1px 5px;border-radius:4px;font-size:12px;">@codex</code> 指定 agent。<br>切换到「拆任务」模式可以把目标分解成可执行清单。</p>`;
  chatEl.appendChild(w);
  window.welcome = w;
}

function renderSessionList(sessions, activeId) {
  const list = document.getElementById('sessionList');
  list.innerHTML = '';
  sessions.forEach(s => {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === activeId ? ' active' : '');
    item.dataset.id = s.id;
    const d = new Date(s.created_at);
    const timeStr = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    item.innerHTML = `
      <div class="session-item-name">${esc(s.name)}</div>
      <div class="session-item-meta">
        <span>${timeStr}</span>
        ${s.message_count ? `<span>· ${s.message_count} 条</span>` : ''}
      </div>
      <button class="session-item-del" data-sid="${s.id}" title="删除">✕</button>`;
    item.onclick = (e) => {
      if (e.target.closest('.session-item-del')) return;
      if (s.id !== currentSessionId) switchSession(s.id);
    };
    item.querySelector('.session-item-del').onclick = async (e) => {
      e.stopPropagation();
      await deleteSession(s.id);
    };
    list.appendChild(item);
  });
}

async function loadSessions() {
  try {
    const { activeId, sessions } = await fetch('/api/sessions').then(r => r.json());
    currentSessionId = activeId;
    renderSessionList(sessions, activeId);
    return activeId;
  } catch (err) {
    console.error('loadSessions failed:', err);
  }
}

async function switchSession(sessionId) {
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
}

async function createSession() {
  const form = document.getElementById('sessionNewForm');
  const input = document.getElementById('sessionNameInput');
  const confirmBtn = document.getElementById('sessionNewConfirm');
  const cancelBtn = document.getElementById('sessionNewCancel');

  form.classList.remove('hidden');
  input.value = `对话 ${new Date().toLocaleDateString('zh-CN', {month:'numeric', day:'numeric'})}`;
  input.focus();
  input.select();

  return new Promise((resolve) => {
    const cleanup = () => {
      form.classList.add('hidden');
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      input.onkeydown = null;
    };
    confirmBtn.onclick = async () => {
      const name = input.value.trim();
      if (!name) return;
      cleanup();
      const { session } = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }).then(r => r.json());
      if (session) {
        currentSessionId = session.id;
        await loadSessions();
        clearChatArea();
      }
      resolve();
    };
    cancelBtn.onclick = () => { cleanup(); resolve(); };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
    };
  });
}

async function deleteSession(sessionId) {
  const { activeId, trashed } = await fetch(`/api/sessions?id=${sessionId}`, {
    method: 'DELETE',
  }).then(r => r.json());
  if (sessionId === currentSessionId) {
    currentSessionId = activeId;
    clearChatArea();
    await loadHistory();
  }
  await loadSessions();
  showUndoToast(trashed);
}

function showUndoToast(sessionId) {
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
async function loadHistory() {
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
        addUserBubble(h.text);
      } else if (h.role === 'assistant') {
        const avatarMap = {
          codex:  { cls: 'codex-av',  emoji: '🤖', name: 'Codex' },
          claude: { cls: 'claude-av', emoji: '✨', name: 'Claude' },
        };
        const a = avatarMap[h.agent] || { cls: 'system-av', emoji: '●', name: h.agent || 'codex' };
        const row = document.createElement('div');
        row.className = 'bubble-row';
        row.innerHTML = `
          <div class="avatar ${a.cls}">${a.emoji}</div>
          <div>
            <div class="bubble-name">${a.name}</div>
            <div class="bubble agent-bubble">${renderRichText(h.text)}</div>
          </div>`;
        chatEl.appendChild(row);
      }
    });
    scrollChat();
  } catch { /* ignore */ }
}

// ── 初始化 ────────────────────────────────────────────────────
(async function init() {
  loadStatus();
  loadTasks();
  await loadSessions();
  await loadHistory();
})();
