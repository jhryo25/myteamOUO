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

function addResumePrompt(text, hasFailed) {
  const row = document.createElement('div');
  row.innerHTML = `
    <div class="bubble system-bubble resume-prompt">
      <span>${esc(text)}</span>
      <button class="resume-btn">▶ 继续执行剩余任务</button>
    </div>`;
  row.querySelector('.resume-btn').onclick = () => {
    row.remove();
    document.getElementById('dispatchBtn').click();
  };
  chatEl.appendChild(row);
  scrollChat();
}

function showCopiedFeedback(btn) {
  const orig = btn.textContent;
  btn.textContent = '✓';
  btn.style.color = 'var(--green)';
  setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1200);
}

function formatTime(ts = Date.now()) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function bindBubbleActions(row, text, type) {
  row.querySelector('[data-action="copy"]').onclick = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    showCopiedFeedback(row.querySelector('[data-action="copy"]'));
  };
  const delBtn = row.querySelector('[data-action="delete"]');
  if (delBtn) {
    delBtn.onclick = () => row.remove();
  }
}

function addUserBubble(text, { prepend = false, scroll = true, attachments = [] } = {}) {
  hideWelcome();
  const row = document.createElement('div');
  row.className = 'bubble-row user';
  const attachmentHtml = attachments.length ? `<div class="user-attachments">
          ${attachments.map(a => {
            const name = a.name || 'image';
            const src = a.url || a.previewUrl || '';
            if (src) {
              return `<a class="user-attachment-thumb" href="${esc(src)}" target="_blank" rel="noreferrer" title="${esc(name)}">
                <img src="${esc(src)}" alt="${esc(name)}">
                <span>${esc(name)}</span>
              </a>`;
            }
            return `<span class="user-attachment-chip">图片 ${esc(name)}</span>`;
          }).join('')}
        </div>` : '';
  row.innerHTML = `
    <div class="bubble-content-wrap">
      <div class="bubble-name">你 <span class="bubble-time">${formatTime()}</span></div>
      <div class="bubble user-bubble">
        ${esc(text || '（图片消息）')}
        ${attachmentHtml}
      </div>
      <div class="bubble-actions">
        <button class="bubble-action-btn" data-action="copy" title="复制">⎘</button>
        <button class="bubble-action-btn danger" data-action="delete" title="删除">✕</button>
      </div>
    </div>
    <div class="avatar user-av">我</div>`;
  bindBubbleActions(row, text, 'user');
  if (prepend) {
    const pager = document.getElementById('historyPager');
    chatEl.insertBefore(row, pager ? pager.nextSibling : chatEl.firstElementChild);
  }
  else chatEl.appendChild(row);
  if (scroll) scrollChat();
  return row;
}

function startAgentBubble(agentKey) {
  hideWelcome();
  const avatarMap = {
    codex:  { cls: 'codex-av',  emoji: '🤖', name: 'Codex' },
    claude: { cls: 'claude-av', emoji: '✨', name: 'Claude' },
    kimi:   { cls: 'kimi-av',   emoji: '🌙', name: 'Kimi' },
  };
  const a = avatarMap[agentKey] || { cls: 'system-av', emoji: '●', name: agentKey };

  const row = document.createElement('div');
  row.className = 'bubble-row';
  row.innerHTML = `
    <div class="avatar ${a.cls}">${a.emoji}</div>
    <div class="bubble-content-wrap">
      <div class="bubble-name">${a.name} <span class="bubble-time" id="bubbleTime"></span></div>
      <details class="thinking-details hidden" id="thinkingDetails">
        <summary class="thinking-summary">💭 思考过程 <span class="thinking-count" id="thinkingCount"></span></summary>
        <div class="thinking-content" id="thinkingContent"></div>
      </details>
      <div class="bubble agent-bubble typing-cursor" id="typingBubble">
        <div class="thinking-line"><span class="thinking-dot"></span><span>正在连接 ${esc(agentKey)}...</span></div>
      </div>
      <div class="bubble-actions">
        <button class="bubble-action-btn" data-action="copy" title="复制">⎘</button>
      </div>
    </div>`;
  chatEl.appendChild(row);
  agentTypingBubble = row.querySelector('#typingBubble');
  // 绑定操作（完成后 content 已渲染）
  row.querySelector('[data-action="copy"]').onclick = () => {
    const content = agentTypingBubble?.dataset.raw || agentTypingBubble?.textContent || '';
    navigator.clipboard.writeText(content).catch(() => {});
    showCopiedFeedback(row.querySelector('[data-action="copy"]'));
  };
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

function appendThinking(text) {
  if (!agentTypingBubble) return;
  const wrap = agentTypingBubble.closest('.bubble-content-wrap');
  if (!wrap) return;
  const details = wrap.querySelector('#thinkingDetails');
  const content = wrap.querySelector('#thinkingContent');
  const count = wrap.querySelector('#thinkingCount');
  if (!details || !content) return;
  details.classList.remove('hidden');
  content.dataset.raw = (content.dataset.raw || '') + text;
  content.textContent = content.dataset.raw;
  if (count) {
    const len = (content.dataset.raw || '').length;
    count.textContent = `（${len} 字符）`;
  }
  // 不自动滚动到 thinking 内容（默认收起，不打扰主输出滚动）
}

function updateAgentStatus(text) {
  if (!agentTypingBubble || agentTypingBubble.dataset.raw) return;
  agentTypingBubble.innerHTML = `<div class="thinking-line"><span class="thinking-dot"></span><span>${esc(text || 'agent 正在处理...')}</span></div>`;
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
    // 填入完成时间戳
    const timeEl = agentTypingBubble.closest('.bubble-content-wrap')?.querySelector('#bubbleTime');
    if (timeEl) timeEl.textContent = formatTime();
    agentTypingBubble = null;
  }
}

function scrollChat() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

// ── 结构化气泡：plan 任务列表 ─────────────────────────────────
function addPlanCard(goal, tasks) {
  hideWelcome();
  // 可用 agent 列表（用于下拉）
  const availableAgents = (window.agentConfigList || mentionAgents)
    .filter(a => a.available !== false);
  const agentOptions = availableAgents.map(a =>
    `<option value="${esc(a.key)}">${esc(a.label || a.key)}</option>`
  ).join('');

  const rows = tasks.map((t, i) => {
    const steps = (t.steps || []).length;
    // agent 下拉：默认选中 plan 推荐的 agent，若不可用则保留显示但标记
    const selectedAgent = t.agent || '';
    const isAvailable = availableAgents.some(a => a.key === selectedAgent);
    const selectHtml = `<select class="plan-task-agent-select" data-task-id="${esc(t.id)}" title="修改执行 agent">
      ${agentOptions}
      ${!isAvailable && selectedAgent ? `<option value="${esc(selectedAgent)}" disabled>${esc(selectedAgent)}（不可用）</option>` : ''}
    </select>`;
    // 设置 selected 需要在 DOM 后操作，先用 data 属性传递
    return `<div class="plan-task-row" data-task-id="${esc(t.id)}" data-agent="${esc(selectedAgent)}">
      <span class="plan-task-num">${i + 1}</span>
      <div class="plan-task-body">
        <div class="plan-task-name">${esc(t.title)}</div>
        <div class="plan-task-meta">
          ${selectHtml}
          ${steps ? `<span>${steps} 步</span>` : ''}
        </div>
        ${t.accept ? `<div class="plan-task-accept">✓ ${esc(t.accept)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  // 统计各 agent 的 pending 任务数，只生成可用 agent 的建议按钮
  const agentCounts = {};
  tasks.forEach(t => { agentCounts[t.agent] = (agentCounts[t.agent] || 0) + 1; });
  const availableKeys = new Set(availableAgents.map(a => a.key));
  const suggestionBtns = Object.entries(agentCounts)
    .filter(([agent]) => availableKeys.has(agent))
    .map(([agent, cnt]) =>
      `<button class="plan-suggest-btn" data-agent="${esc(agent)}">
        ▶ 让 ${esc(agent)} 执行 (${cnt} 条)
      </button>`
    ).join('');

  const row = document.createElement('div');
  row.className = 'bubble-row';
  row.innerHTML = `
    <div class="avatar system-av">📋</div>
    <div class="plan-card">
      <div class="plan-card-title">🎯 ${esc(goal)}</div>
      ${rows}
      <div class="plan-suggest-row">
        <span class="plan-suggest-label">建议执行方式：</span>
        ${suggestionBtns}
        <button class="plan-suggest-btn plan-suggest-manual">手动选择任务</button>
      </div>
    </div>`;

  // 初始化各下拉的 selected 值
  row.querySelectorAll('.plan-task-row[data-agent]').forEach(taskRow => {
    const sel = taskRow.querySelector('.plan-task-agent-select');
    if (sel) sel.value = taskRow.dataset.agent;
  });

  // 下拉修改 agent → PATCH 到后端
  row.querySelectorAll('.plan-task-agent-select').forEach(sel => {
    sel.onchange = async () => {
      const taskId = sel.dataset.taskId;
      const newAgent = sel.value;
      try {
        await fetch(`/api/tasks/${encodeURIComponent(taskId)}/agent`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent: newAgent }),
        });
      } catch (e) {
        addSystemMsg(`修改 agent 失败：${e.message}`);
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
    agentConfigList = agents;
    const pillsEl = document.getElementById('agentPills');
    pillsEl.innerHTML = agents.map(a =>
      `<span class="agent-pill ${a.available ? 'ok' : 'err'} ${activeAgentKey === a.key ? 'busy' : ''}" data-agent="${esc(a.key)}" title="${esc(a.error || (a.available ? '可启动' : '不可用'))}">
        <span class="dot"></span>${a.key}
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
  } catch {
    document.getElementById('agentPills').innerHTML =
      '<span class="agent-pill err"><span class="dot"></span>离线</span>';
    setConnectionStatus('offline');
  }
}

let activeAgentKey = null;

function setActiveAgent(agentKey) {
  activeAgentKey = agentKey || null;
  document.querySelectorAll('.agent-pill').forEach(pill => {
    pill.classList.toggle('busy', Boolean(activeAgentKey && pill.dataset.agent === activeAgentKey));
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

async function loadTasks() {
  const { tasks } = await fetch('/api/tasks').then(r => r.json()).catch(() => ({ tasks: [] }));
  allTasks = tasks;
  filterAndRenderTasks();
  // 有 pending 就显示 dispatch 按钮，否则隐藏
  const hasPending = tasks.some(t => t.status === 'pending');
  const dispatchBtn = document.getElementById('dispatchBtn');
  if (hasPending) {
    dispatchBtn.classList.remove('hidden');
    dispatchBtn.disabled = false;
  } else {
    dispatchBtn.classList.add('hidden');
    dispatchBtn.disabled = true;
  }
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
      (t.id && t.id.toLowerCase().includes(term)) ||
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
let isRunning = false;
const messageQueue = [];

function setRunning(running) {
  isRunning = running;
  updateSendBtnState();
}

function updateSendBtnState() {
  const hasText = goalInput.value.trim().length > 0 || pendingImages.length > 0;
  if (isRunning) {
    sendBtn.classList.add('queue-mode');
    sendBtn.innerHTML = '⏎';
    sendBtn.title = messageQueue.length ? `已排队 ${messageQueue.length} 条` : '排队发送（agent 完成后自动发送）';
    sendBtn.disabled = false;
  } else {
    sendBtn.classList.remove('queue-mode');
    sendBtn.innerHTML = '➤';
    sendBtn.title = '发送';
    sendBtn.disabled = !hasText;
  }
}

function ssePost(url, body, handlers) {
  const requestSessionId = body.sessionId || currentSessionId;
  return new Promise(resolve => {
    currentAbortController = new AbortController();
    const stopBtn = document.getElementById('stopBtn');
    stopBtn.classList.remove('hidden');
    setRunning(true);
    
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
          // 跨 session 守门：用户已切到其他 session 时，丢弃流事件，避免污染当前 DOM。
          // done/error 仍要执行以释放状态；history 由后端落盘，刷新可见。
          if (requestSessionId && currentSessionId && requestSessionId !== currentSessionId
              && event !== 'done' && event !== 'error' && event !== 'aborted') {
            continue;
          }
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
      // 只有当前 session 的请求才清状态条；如果用户切到别的 session，原请求结束时不要影响新 session 的运行状态
      if (!currentSessionId || currentSessionId === requestSessionId) {
        stopBtn.classList.add('hidden');
        currentAbortController = null;
        setActiveAgent(null);
        setRunning(false);
        // 消费排队消息
        if (messageQueue.length && getMode() === 'chat') {
          const next = messageQueue.shift();
          setTimeout(() => doChat(next), 100);
        }
      }
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
  // 运行中且 chat 模式 → 入队
  if (isRunning && getMode() === 'chat') {
    if (pendingImages.length) {
      addSystemMsg('正在运行时暂不排队图片消息，请等当前 agent 完成后再发送图片。');
      return;
    }
    messageQueue.push(text);
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
async function doChat(message) {
  let attachments = [];
  try {
    attachments = await uploadPendingImages();
  } catch (err) {
    addSystemMsg(`图片发送失败：${err.message}`);
    return;
  }
  goalInput.value = '';
  goalInput.style.height = '';
  clearPendingImages();
  mentionHint.classList.add('hidden');

  addUserBubble(message, { attachments });

  let bubble = null;

  const agentAttachments = attachments.map(({ previewUrl, ...attachment }) => attachment);
  await ssePost('/api/chat', { message, sessionId: currentSessionId, attachments: agentAttachments }, {
    start: ({ agent }) => {
      setActiveAgent(agent);
      bubble = startAgentBubble(agent);
    },
    chunk: ({ text }) => appendTyping(text),
    thinking: ({ text }) => appendThinking(text),
    status: ({ text }) => updateAgentStatus(text),
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

  goalInput.focus();
}

// ── plan 模式 ─────────────────────────────────────────────────
async function doPlan(goal) {
  const agent = getRadio('planAgentGroup') || 'codex';

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
  addSystemMsg(`正在让 ${agent} 拆解任务…`);
  setActiveAgent(agent);
  startAgentBubble(agent);

  await ssePost('/api/plan', { goal, agent, sessionId: currentSessionId, attachments: agentAttachments }, {
    start: ({ agent }) => setActiveAgent(agent),
    status: ({ text }) => updateAgentStatus(text),
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
document.getElementById('dispatchBtn').onclick = () => runDispatch();

async function runDispatch(options = {}) {
  const dispatchBtn = document.getElementById('dispatchBtn');
  const dispatchSpinner = document.getElementById('dispatchSpinner');

  dispatchBtn.disabled = true;
  dispatchSpinner.classList.remove('hidden');

  try {
    const agentOnlyText = options.agentOnly ? `（仅 ${options.agentOnly}）` : '';
    addSystemMsg(`开始执行 pending 任务${agentOnlyText}…`);

    await ssePost('/api/dispatch', options, {
      start:        ({ count }) => addSystemMsg(`共 ${count} 条任务待执行`),
      'task-start': ({ id, title, agent }) => {
        setActiveAgent(agent);
        updateTaskDot(id, 'in_progress');
        startAgentBubble(agent);
        appendTyping(`[${title}]\n`);
      },
      chunk:        ({ text }) => appendTyping(text),
      status:       ({ text }) => updateAgentStatus(text),
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
        if (failed > 0) {
          addResumePrompt(`✓ 执行完毕：${done} 成功 / ${failed} 失败`, true);
        } else {
          addSystemMsg(`✓ 全部执行完毕：${done} 成功`);
        }
      },
      error: ({ message }) => addSystemMsg(`✗ ${message}`),
      aborted: () => {
        finishTyping();
        addResumePrompt('⏹ 已中断执行，仍有未完成任务', false);
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

let agentConfigList = [];

function agentMeta(agentKey) {
  const dynamic = agentConfigList.find(a => a.key === agentKey) || mentionAgents.find(a => a.key === agentKey);
  const fallback = AGENT_META[agentKey] || {};
  return {
    label: dynamic?.label || fallback.label || agentKey,
    emoji: dynamic?.emoji || fallback.emoji || '●',
    desc: dynamic?.desc || fallback.desc || '',
  };
}

function openDrawer() {
  closeHub();
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

// ── Hub 指挥抽屉 ─────────────────────────────────────────────
let hubActiveTab = 'overview';
let hubState = { agents: [], tasks: [], skills: [], selectedSkills: [], skillsSummary: null, skillContextPreview: '', invocations: [], invocationSummary: null, lessons: [] };

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
    const [status, taskData, skillData, invocationData, lessonData] = await Promise.all([
      fetch('/api/status').then(r => r.json()),
      fetch('/api/tasks').then(r => r.json()).catch(() => ({ tasks: [] })),
      fetch(skillUrl).then(r => r.json()).catch(() => ({ skills: [], selected: [], summary: null, contextPreview: '' })),
      fetch('/api/invocations').then(r => r.json()).catch(() => ({ invocations: [], summary: null })),
      fetch('/api/lessons').then(r => r.json()).catch(() => ({ lessons: [] })),
    ]);
    hubState = {
      agents: status.agents || [],
      tasks: taskData.tasks || [],
      skills: skillData.skills || [],
      selectedSkills: skillData.selected || [],
      skillsSummary: skillData.summary || null,
      skillContextPreview: skillData.contextPreview || '',
      invocations: invocationData.invocations || [],
      invocationSummary: invocationData.summary || null,
      lessons: lessonData.lessons || [],
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
  if (hubActiveTab === 'agents') return renderHubAgents();
  if (hubActiveTab === 'skills') return renderHubSkills();
  if (hubActiveTab === 'lessons') return renderHubLessons();
  if (hubActiveTab === 'invocations') return renderHubInvocations();
  if (hubActiveTab === 'gate') return renderHubGate();
  if (hubActiveTab === 'tasks') return renderHubTasks();
  return renderHubOverview();
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
          return `<div class="hub-row">
            <div class="hub-row-main">
              <div class="hub-row-title">${esc(t.title || t.id)}</div>
              <div class="hub-row-meta">${esc(t.agent || 'unknown')} · ${esc(t.run_id || '无 run')} · ${esc(t.accept || '无验收说明')}</div>
              ${t.review_note ? `<div class="hub-row-meta">Gate 说明：${esc(t.review_note)}</div>` : ''}
            </div>
            <div class="hub-row-side">
              <span class="hub-badge ${badge.tone}">${badge.text}</span>
              ${canReview ? `<div class="hub-row-actions">
                <button class="hub-mini-btn" data-hub-action="gate-pass" data-task-id="${esc(t.id)}">通过</button>
                <button class="hub-mini-btn danger" data-hub-action="gate-rework" data-task-id="${esc(t.id)}">返工</button>
              </div>` : ''}
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
  const mountKeys = ['controller', 'worker', 'reviewer', 'codex', 'claude', 'kimi'];
  const categories = [...new Set(hubState.skills.map(s => s.category).filter(Boolean))];
  const selectedNames = new Set(hubState.selectedSkills.map(s => s.name));
  hubBody.innerHTML = `
    <div class="hub-kpi-grid">
      <div class="hub-kpi"><div class="hub-kpi-label">技能总数</div><div class="hub-kpi-value">${hubState.skills.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">分类</div><div class="hub-kpi-value">${categories.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">本次加载</div><div class="hub-kpi-value">${hubState.selectedSkills.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">加载方式</div><div class="hub-kpi-value">按需</div></div>
    </div>
    <section class="hub-section">
      <div class="hub-section-title">本次按需加载 <span class="hub-mini-note">根据当前输入、模式和 agent 选择</span></div>
      <div class="hub-list">
        ${hubState.selectedSkills.length ? hubState.selectedSkills.map(skill => `<div class="hub-row">
          <div class="hub-row-main">
            <div class="hub-row-title">${esc(skill.name)}</div>
            <div class="hub-row-meta">${esc(skill.category || '-')} · score ${skill.score || 0} · ${esc(skill.prompt || skill.description || '')}</div>
          </div>
          <span class="hub-badge ok">${esc(skill.load || 'progressive')}</span>
        </div>`).join('') : '<div class="hub-empty">当前输入还没有匹配到 skill。输入目标后再打开 Hub，或切到拆任务模式查看。</div>'}
      </div>
    </section>
    <section class="hub-section">
      <div class="hub-section-title">Skills Registry <span class="hub-mini-note">来自 .myteam/skills.yaml，执行时只注入命中的部分</span></div>
      ${hubState.skills.length ? `<div class="hub-table-wrap">
        <table class="hub-skills-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>分类</th>
              <th>触发条件</th>
              <th>加载</th>
              <th>挂载</th>
            </tr>
          </thead>
          <tbody>
            ${hubState.skills.map(skill => `<tr>
              <td><span class="hub-skill-name ${selectedNames.has(skill.name) ? 'active' : ''}">${esc(skill.name)}</span></td>
              <td>${esc(skill.category || '-')}</td>
              <td>${esc(skill.trigger || skill.description || '-')}</td>
              <td>${esc(skill.load || 'manual')}</td>
              <td><div class="hub-mounts">
                ${mountKeys.map(key => `<span class="hub-mount ${skill.mounts?.[key] ? 'on' : ''}">${esc(key)}</span>`).join('')}
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<div class="hub-empty">还没有技能清单。请检查 .myteam/skills.yaml。</div>'}
    </section>
    <section class="hub-section">
      <div class="hub-section-title">Prompt Preview <span class="hub-mini-note">真实执行时注入给 agent 的 skill 摘要</span></div>
      <pre class="hub-code-block">${esc(hubState.skillContextPreview || '暂无匹配 skill。')}</pre>
    </section>`;
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
      <div class="hub-kpi"><div class="hub-kpi-label">来源</div><div class="hub-kpi-value">失败</div></div>
    </div>
    <section class="hub-section">
      <div class="hub-section-title">踩坑记录 <span class="hub-mini-note">来自 .myteam/lessons.jsonl</span></div>
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
              <span class="hub-badge err">lesson</span>
              ${taskKey ? `<div class="hub-row-actions">
                <button class="hub-mini-btn" data-hub-action="lesson-task" data-task-query="${esc(taskKey)}">查看任务</button>
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
  const recent = hubState.invocations.slice(0, 8);
  const agentRows = Object.entries(summary.byAgent || {});
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
      <div class="hub-section-title">最近调用 <span class="hub-mini-note">来自 .myteam/invocations.jsonl</span></div>
      <div class="hub-list">
        ${recent.length ? recent.map(i => `<div class="hub-row">
          <div class="hub-row-main">
            <div class="hub-row-title">${esc(i.agent)} · ${esc(i.label || 'call')}</div>
            <div class="hub-row-meta">${esc(i.started_at || '')} · ${formatDuration(i.duration_ms)} · prompt ${i.prompt_chars || 0} 字符 · 输出 ${i.output_chars || 0} 字符</div>
            ${i.error ? `<div class="hub-row-meta">${esc(i.error)}</div>` : ''}
          </div>
          <span class="hub-badge ${i.status === 'success' ? 'ok' : i.status === 'interrupted' ? 'warn' : 'err'}">${esc(i.status || 'unknown')}</span>
        </div>`).join('') : '<div class="hub-empty">暂无调用记录。</div>'}
      </div>
    </section>
    `;
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
    };
  });
}

async function submitGateDecision(taskId, decision, btn) {
  if (!taskId) return;
  btn.disabled = true;
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/gate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
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

async function saveAgentList(agents) {
  const res = await fetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agents }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '保存 agent 失败');
  agentConfigList = data.agents || agents;
  await loadStatus();
  await loadAgentConfig();
  if (!hubDrawer.classList.contains('hidden')) await loadHub();
  return data;
}

async function loadAgentConfig() {
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
        <details class="role-card-details">
          <summary class="role-card-summary">角色卡 <span style="font-size:10px;color:var(--muted);">（注入每次调用的 prompt 头部）</span></summary>
          <div class="role-card-fields">
            <label>角色描述
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
      if (a.removable !== false) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'agent-remove-btn';
        removeBtn.textContent = `删除 @${a.key}`;
        removeBtn.onclick = async () => {
          agentConfigList = agentConfigList.filter(agent => agent.key !== a.key);
          await saveAgentList(agentConfigList);
        };
        card.appendChild(removeBtn);
      }
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
        const strengths = getField('strengths').split(/[,，]/).map(s => s.trim()).filter(Boolean);
        const restrictions = getField('restrictions').split(/[,，]/).map(s => s.trim()).filter(Boolean);
        btn.textContent = '保存中…';
        try {
          await fetch(`/api/agents/${encodeURIComponent(key)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              roleDescription: getField('roleDescription'),
              personality: getField('personality'),
              strengths,
              restrictions,
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
  } catch {
    agentFormEl.innerHTML = '<div style="color:var(--red);font-size:13px;">无法加载配置，请确认服务器正在运行。</div>';
  }
}

agentAddBtn.onclick = async () => {
  const rawKey = prompt('请输入新 agent 的 key，例如 qwen 或 gemini：');
  const key = (rawKey || '').trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_-]+/g, '-');
  if (!key) return;
  if (agentConfigList.some(a => a.key === key)) {
    drawerSaveTip.textContent = `@${key} 已存在`;
    drawerSaveTip.className = 'drawer-save-tip err';
    drawerSaveTip.classList.remove('hidden');
    return;
  }
  const label = prompt('显示名称（可以直接回车使用 key）：') || key;
  await saveAgentList([...agentConfigList, {
    key,
    label,
    emoji: '●',
    desc: '自定义 Agent',
    path: '',
    inputMode: 'arg',
    argsTemplate: '-p {prompt}',
    checkTemplate: '--help',
    removable: true,
  }]);
};

workspaceSaveBtn.onclick = async () => {
  workspaceSaveBtn.disabled = true;
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: workspaceInput.value.trim() }),
    });
    const data = await res.json();
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
const HISTORY_PAGE_SIZE = 20;
let historyPage = { hasMore: false, nextBefore: null, loading: false };

function clearChatArea() {
  chatEl.innerHTML = '';
  agentTypingBubble = null;
  historyPage = { hasMore: false, nextBefore: null, loading: false };
  const w = document.createElement('div');
  w.className = 'chat-welcome';
  w.id = 'chatWelcome';
  w.innerHTML = `
    <div class="emoji">🤝</div>
    <h2>欢迎来到 myteam</h2>
    <p>直接发消息和 agent 对话，用 <code style="background:var(--surface2);padding:1px 5px;border-radius:4px;font-size:12px;">@claude</code>、<code style="background:var(--surface2);padding:1px 5px;border-radius:4px;font-size:12px;">@codex</code> 或 <code style="background:var(--surface2);padding:1px 5px;border-radius:4px;font-size:12px;">@kimi</code> 指定 agent。<br>切换到「拆任务」模式可以把目标分解成可执行清单。</p>`;
  chatEl.appendChild(w);
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
  sessions.forEach(s => {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === activeId ? ' active' : '');
    item.dataset.id = s.id;
    const d = new Date(s.created_at);
    const timeStr = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    item.innerHTML = `
      <div class="session-item-name" data-editing="false">${esc(s.name)}</div>
      <div class="session-item-meta">
        ${sessionModeBadge(s.mode)}
        <span>${timeStr}</span>
        ${s.message_count ? `<span>· ${s.message_count} 条</span>` : ''}
      </div>
      <button class="session-item-more" title="更多操作">···</button>
      <div class="session-popover hidden">
        <button class="session-popover-item" data-action="rename">✏ 重命名</button>
        <button class="session-popover-item danger" data-action="delete">✕ 删除</button>
      </div>`;

    const nameEl = item.querySelector('.session-item-name');
    const moreBtn = item.querySelector('.session-item-more');
    const popover = item.querySelector('.session-popover');

    // 点击主体切换 session
    item.onclick = (e) => {
      if (e.target.closest('.session-item-more') || e.target.closest('.session-popover')) return;
      if (nameEl.contentEditable === 'true') return;
      if (s.id !== currentSessionId) switchSession(s.id);
    };

    // ··· 按钮开关 popover
    moreBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = !popover.classList.contains('hidden');
      // 关掉其他所有 popover
      document.querySelectorAll('.session-popover').forEach(p => p.classList.add('hidden'));
      if (!isOpen) popover.classList.remove('hidden');
    };

    // popover 菜单项
    popover.querySelectorAll('.session-popover-item').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        popover.classList.add('hidden');
        if (btn.dataset.action === 'delete') {
          await deleteSession(s.id);
        } else if (btn.dataset.action === 'rename') {
          startRenameSession(s.id, nameEl);
        }
      };
    });

    list.appendChild(item);
  });

  // 全局点击关闭所有 popover
  if (!list._popoverCloseHandler) {
    list._popoverCloseHandler = (e) => {
      if (!e.target.closest('.session-item-more') && !e.target.closest('.session-popover')) {
        document.querySelectorAll('.session-popover').forEach(p => p.classList.add('hidden'));
      }
    };
    document.addEventListener('click', list._popoverCloseHandler);
  }
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
    renderSessionList(sessions, activeId);
    return activeId;
  } catch (err) {
    console.error('loadSessions failed:', err);
  }
}

async function switchSession(sessionId) {
  // 如果当前有正在运行的请求（属于其他 session），提示用户后台继续，不打断
  if (isRunning && currentAbortController) {
    addSystemMsg('⏳ 当前 session 任务在后台继续运行，结果会自动入库，刷新或切回可查看。');
  }
  await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activeId: sessionId }),
  });
  // 关键：清掉运行状态绑定（旧 SSE 仍在后台跑，但前端不再受其约束）
  currentAbortController = null;
  setRunning(false);
  setActiveAgent(null);
  document.getElementById('stopBtn')?.classList.add('hidden');

  currentSessionId = sessionId;
  clearChatArea();
  await loadSessions();
  await loadHistory();
  await loadTasks();
}

async function createSession() {
  const { session } = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }).then(r => r.json());
  if (session) {
    currentSessionId = session.id;
    await loadSessions();
    clearChatArea();
    goalInput.focus();
  }
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
        const avatarMap = {
          codex:  { cls: 'codex-av',  emoji: '🤖', name: 'Codex' },
          claude: { cls: 'claude-av', emoji: '✨', name: 'Claude' },
          kimi:   { cls: 'kimi-av',   emoji: '🌙', name: 'Kimi' },
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
function renderAssistantHistoryBubble(h) {
  const avatarMap = {
    codex:  { cls: 'codex-av',  emoji: '🤖', name: 'Codex' },
    claude: { cls: 'claude-av', emoji: '✦', name: 'Claude' },
    kimi:   { cls: 'kimi-av',   emoji: '🌙', name: 'Kimi' },
  };
  const a = avatarMap[h.agent] || { cls: 'system-av', emoji: '●', name: h.agent || 'codex' };
  const row = document.createElement('div');
  row.className = 'bubble-row';
  row.innerHTML = `
    <div class="avatar ${a.cls}">${a.emoji}</div>
    <div class="bubble-content-wrap">
      <div class="bubble-name">${a.name}</div>
      <div class="bubble agent-bubble">${renderRichText(h.text)}</div>
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
    const taskRows = h.tasks.map((t, i) => `
      <div class="plan-task-row">
        <span class="plan-task-num">${i + 1}</span>
        <div class="plan-task-body">
          <div class="plan-task-name">${esc(t.title)}</div>
          <div class="plan-task-meta">
            <span class="plan-task-agent">${esc(t.agent || '')}</span>
            ${(t.steps || []).length ? `<span>${t.steps.length} 步</span>` : ''}
          </div>
          ${t.accept ? `<div class="plan-task-accept">✓ ${esc(t.accept)}</div>` : ''}
        </div>
      </div>`).join('');
    row.innerHTML = `
      <div class="avatar system-av">📋</div>
      <div class="plan-card">
        <div class="plan-card-title">🎯 ${esc(h.goal || '')} <span style="font-size:11px;color:var(--muted);font-weight:normal;">（历史 run ${esc(h.runId || '')}）</span></div>
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
  historyPage.loading = true;
  updateHistoryPager();
  const prevHeight = chatEl.scrollHeight;
  const prevTop = chatEl.scrollTop;
  try {
    const params = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
    if (currentSessionId) params.set('sessionId', currentSessionId);
    if (older && historyPage.nextBefore !== null) params.set('before', String(historyPage.nextBefore));
    const { history, sessionId, page } = await fetch(`/api/history?${params.toString()}`).then(r => r.json());
    if (sessionId) currentSessionId = sessionId;
    if (history && history.length) {
      if (older) {
        history.slice().reverse().forEach(h => renderHistoryEntry(h, true));
        chatEl.scrollTop = prevTop + (chatEl.scrollHeight - prevHeight);
      } else {
        history.forEach(h => renderHistoryEntry(h, false));
        scrollChat();
      }
    }
    historyPage.hasMore = Boolean(page?.hasMore);
    historyPage.nextBefore = page?.nextBefore ?? null;
  } catch {
    // Chat still works if history cannot be loaded.
  } finally {
    historyPage.loading = false;
    updateHistoryPager();
  }
}

(async function init() {
  loadStatus();
  loadTasks();
  await loadSessions();
  await loadHistory();
})();
