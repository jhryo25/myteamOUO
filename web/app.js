// ── 工具 ─────────────────────────────────────────────────────
function esc(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const skillRegistryCache = {};
const skillRegistryRequests = {};

async function fetchSkillRegistry(source) {
  if (skillRegistryCache[source]) return skillRegistryCache[source];
  if (!skillRegistryRequests[source]) {
    skillRegistryRequests[source] = fetch(`/api/skills/registry?source=${encodeURIComponent(source)}`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
        skillRegistryCache[source] = data;
        return data;
      })
      .finally(() => { delete skillRegistryRequests[source]; });
  }
  return skillRegistryRequests[source];
}

function prefetchSkillRegistry(source) {
  fetchSkillRegistry(source).catch(() => {});
}

setTimeout(() => prefetchSkillRegistry('clowder-ai'), 0);

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
  const links = [];
  const isLocalHtml = value => /\.html?$/i.test(value.split(/[?#]/)[0]) &&
    /^(?:file:\/\/|[A-Za-z]:[\\/]|\.{0,2}[\\/]|(?:reports?|outputs?|dist|build|public)[\\/])/i.test(value);
  const asLink = (path, label, code = false) => {
    const index = links.length;
    links.push(`<button class="local-html-link" type="button" data-html-path="${path}" title="使用默认浏览器打开">${code ? `<code>${label}</code>` : label}<span aria-hidden="true">↗</span></button>`);
    return `\x01HTML${index}\x01`;
  };

  let rendered = text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, label, path) => isLocalHtml(path) ? asLink(path, label) : whole)
    .replace(/`([^`]+)`/g, (_, code) => isLocalHtml(code) ? asLink(code, code, true) : `<code class="rb-inline-code">${code}</code>`)
    .replace(/(?:file:\/\/\/[^\s<>"']+\.html?|[A-Za-z]:[\\/][^\s<>"']+\.html?|(?:\.{0,2}[\\/]|(?:reports?|outputs?|dist|build|public)[\\/])[^\s<>"']+\.html?)/gi,
      path => isLocalHtml(path) ? asLink(path, path, true) : path)
    .replace(/\*\*([^*]+)\*\*/g, '<span class="rb-bold">$1</span>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<span class="rb-italic">$1</span>');
  rendered = rendered.replace(/\x01HTML(\d+)\x01/g, (_, index) => links[+index]);
  return rendered;
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

  // 自定义块允许模型按列表层级缩进；结束标记也兼容 CRLF 和行尾空格。
  text = text.replace(/^[ \t]*:::(card|checklist|role)([^\r\n]*)\r?\n([\s\S]*?)\r?\n[ \t]*:::[ \t]*$/gm, (m, type, attrs, body) => {
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

function showToast(message, tone = 'info', duration = 3200) {
  let stack = document.getElementById('toastStack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  let toast = [...stack.querySelectorAll('.app-toast')].find(item => item.dataset.message === message);
  if (!toast) {
    toast = document.createElement('div');
    toast.className = `app-toast ${tone}`;
    toast.dataset.message = message;
    toast.textContent = message;
    stack.appendChild(toast);
  }
  clearTimeout(toast._removeTimer);
  toast._removeTimer = setTimeout(() => toast.remove(), duration);
  return toast;
}

async function openLocalHtml(path, button) {
  const oldText = button?.innerHTML;
  let missing = false;
  if (button) {
    button.disabled = true;
    button.dataset.opening = 'true';
  }
  try {
    const response = await fetch('/api/workspace/open-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      const failure = new Error(data.error || `HTTP ${response.status}`);
      failure.status = response.status;
      throw failure;
    }
    if (button) button.title = `已使用默认浏览器打开 ${data.path}`;
    return data;
  } catch (error) {
    missing = error.status === 404;
    if (missing && button) {
      button.classList.add('missing');
      button.title = '文件不存在或已移动';
    }
    showToast(`无法打开文件：${error.message}`, 'error');
    throw error;
  } finally {
    if (button) {
      button.disabled = missing;
      button.dataset.opening = 'false';
      if (oldText) button.innerHTML = oldText;
    }
  }
}

chatEl.addEventListener('click', event => {
  const button = event.target.closest?.('[data-html-path]');
  if (!button || !chatEl.contains(button)) return;
  event.preventDefault();
  openLocalHtml(button.dataset.htmlPath, button).catch(() => {});
});

// 每个 session 维护自己的 typing bubble 引用（对齐 clowder-ai per-thread liveness）
const sessionBubbles = new Map(); // sessionId → { bubble, agentKey }
let agentTypingBubble = null; // 当前可见 session 的 typing bubble 快捷引用

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

function addSubagentLink(taskId, title, agentKey) {
  const row = document.createElement('div');
  const link = esc(title || taskId);
  row.innerHTML = '<div class="bubble system-bubble subagent-link-bubble">-> ' + link + '<button class="subagent-view-btn" data-task-id="' + esc(taskId) + '" data-title="' + esc(title) + '" data-agent="' + esc(agentKey || '') + '">View subagent</button></div>';
  chatEl.appendChild(row);
  row.querySelector('.subagent-view-btn').onclick = () => window.openSubagentSession && window.openSubagentSession(taskId, title, agentKey);
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

// 拆任务失败时的恢复选项（不要一截了之）
function addPlanRecoveryPrompt(goal, failedAgent, message, raw, attachments, agentAttachments) {
  hideWelcome();
  const rawDetail = raw ? `<details class="plan-error-detail"><summary>原始输出（前 400 字）</summary><pre>${esc(raw.slice(0, 400))}</pre></details>` : '';
  // 列出当前可用 agent 备选
  const others = agentConfigList.filter(a => a.available && a.key !== failedAgent);
  const switchBtns = others.map(a => `<button class="recovery-btn" data-action="retry-other" data-agent="${esc(a.key)}">↻ 改用 ${esc(a.label || a.key)}</button>`).join('');

  const row = document.createElement('div');
  row.className = 'bubble-row';
  row.innerHTML = `
    <div class="avatar system-av">!</div>
    <div class="bubble-content-wrap" style="max-width:80%;">
      <div class="bubble system-bubble plan-recovery">
        <div class="plan-recovery-title">✗ ${esc(failedAgent)} 拆任务失败</div>
        <div class="plan-recovery-msg">${esc(message || '')}</div>
        <div class="plan-recovery-hint">${attachments?.length ? '检测到本次包含图片附件。可能是 agent 想调用 view_image 工具读图但失败。' : '可能是 agent 输出非 JSON、超时或 CLI 报错。'}</div>
        ${rawDetail}
        <div class="plan-recovery-actions">
          <button class="recovery-btn primary" data-action="retry-same">↻ 重试 ${esc(failedAgent)}</button>
          ${switchBtns}
          <button class="recovery-btn" data-action="switch-chat">💬 改为对话模式（让 agent 看图回答）</button>
          <button class="recovery-btn" data-action="dismiss">✕ 关闭</button>
        </div>
      </div>
    </div>`;
  row.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = async () => {
      const act = btn.dataset.action;
      if (act === 'dismiss') { row.remove(); return; }
      if (act === 'retry-same') {
        row.remove();
        const radio = document.querySelector(`#planAgentGroup .radio-btn[data-value="${failedAgent}"]`);
        radio?.click();
        document.getElementById('goalInput').value = goal;
        await doPlan(goal);
        return;
      }
      if (act === 'retry-other') {
        const newAgent = btn.dataset.agent;
        row.remove();
        const radio = document.querySelector(`#planAgentGroup .radio-btn[data-value="${newAgent}"]`);
        radio?.click();
        document.getElementById('goalInput').value = goal;
        await doPlan(goal);
        return;
      }
      if (act === 'switch-chat') {
        row.remove();
        // 切对话模式，把 goal 当文本附图发出去
        modeGroup.querySelector('.radio-btn[data-value="chat"]').click();
        await doChat(`@${failedAgent} ${goal}`);
        return;
      }
    };
  });
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

function startAgentBubble(agentKey, sessionId = currentSessionId) {
  hideWelcome();
  const meta = agentMeta(agentKey);
  const displayName = meta.nickname || meta.label;

  const uid = `bubble-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const thinkUid = `think-${uid}`;
  const timeUid  = `time-${uid}`;

  const row = document.createElement('div');
  row.className = 'bubble-row';
  row.dataset.sessionId = sessionId || '';
  row.innerHTML = `
    ${renderAgentAvatar(agentKey)}
    <div class="bubble-content-wrap agent-turn">
      <div class="bubble-name">${esc(displayName)} <span class="bubble-time" id="${timeUid}"></span></div>
      <div class="thinking-panel hidden" id="${thinkUid}">
        <button class="thinking-toggle" type="button" aria-expanded="false">
          <span class="thinking-chevron">›</span>
          <span class="thinking-brain">🧠</span>
          <span class="thinking-label">思考过程</span>
          <span class="thinking-count-badge" id="cnt-${uid}"></span>
          <span class="thinking-preview" id="prev-${uid}"></span>
        </button>
        <div class="thinking-body hidden" id="body-${uid}"></div>
      </div>
      <div class="agent-activity-feed hidden" aria-live="polite"></div>
      <div class="turn-final-label hidden">最终输出</div>
      <div class="bubble agent-bubble typing-cursor" id="${uid}">
        <div class="agent-waiting" aria-label="正在启动 ${esc(displayName)}">
          <span class="agent-waiting-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>${esc(displayName)} 启动中</span>
        </div>
      </div>
      <div class="bubble-actions">
        <button class="bubble-action-btn" data-action="copy" title="复制">⎘</button>
      </div>
    </div>`;

  chatEl.appendChild(row);
  const bubble = row.querySelector(`#${uid}`);

  // 绑定 thinking 折叠按钮
  const toggleBtn = row.querySelector('.thinking-toggle');
  toggleBtn?.addEventListener('click', () => {
    const body = row.querySelector(`#body-${uid}`);
    const preview = row.querySelector(`#prev-${uid}`);
    const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
    toggleBtn.querySelector('.thinking-chevron').textContent = isExpanded ? '›' : '⌄';
    body?.classList.toggle('hidden', isExpanded);
    if (preview) preview.style.display = isExpanded ? '' : 'none';
  });

  // 复制按钮
  row.querySelector('[data-action="copy"]').onclick = () => {
    const content = bubble.dataset.raw || bubble.textContent || '';
    navigator.clipboard.writeText(content).catch(() => {});
    showCopiedFeedback(row.querySelector('[data-action="copy"]'));
  };

  agentTypingBubble = bubble;
  if (sessionId) sessionBubbles.set(sessionId, { bubble, row, uid, thinkUid, timeUid });

  scrollChat();
  return bubble;
}

// 轻量流式 markdown：仅安全处理换行/粗体/inline code，避免半截代码块、半截 JSON 暴露源文本
function streamRender(raw) {
  let s = String(raw || '');
  // 流式阶段先隐藏 Rich Block 协议行，完成后再由 renderRichText 生成组件。
  s = s
    .replace(/^[ \t]*:::(?:card|checklist|role)\b[^\r\n]*$/gm, '')
    .replace(/^[ \t]*:::[ \t]*$/gm, '');
  // 隐藏未闭合的 ``` 代码块（等完成后再渲染）
  const fenceCount = (s.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) {
    const lastFence = s.lastIndexOf('```');
    s = s.slice(0, lastFence) + '\n_⏳ 正在生成代码块…_';
  }
  // structured content (JSON/plan): sticky placeholder during streaming to avoid flicker
  if (streamRender._isStructured || /^\s*[{[]/.test(s.trim())) {
    if (/^\s*[{[]/.test(s.trim())) streamRender._isStructured = true;
    return '<span class="stream-pending">' + '\u23f3 \u6b63\u5728\u751f\u6210\u7ed3\u6784\u5316\u5185\u5bb9\u2026' + '</span>';
  }
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/`([^`\n]+)`/g, '<code class="rb-inline-code">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// ── 打字机节流（参考 clowder-ai StreamingText）────────────────
const TYPER_CHARS_PER_TICK = 2;   // 每帧追加字符数
const TYPER_TICK_MS        = 16;  // ~60fps
const typerStates = new WeakMap(); // bubble → { pending, displayed, rafId }

function _flushTyper(bubble) {
  const st = typerStates.get(bubble);
  if (!st) return;
  if (st.displayed.length >= st.pending.length) {
    st.rafId = null;
    bubble.dataset.raw = st.displayed;
    // 末尾光标渲染
    bubble.innerHTML = streamRender(st.displayed) + '<span class="stream-cursor">▊</span>';
    return;
  }
  // 一次推进若干字符（配合 setTimeout 平滑节流）
  const next = Math.min(st.displayed.length + TYPER_CHARS_PER_TICK, st.pending.length);
  st.displayed = st.pending.slice(0, next);
  bubble.dataset.raw = st.displayed;
  bubble.innerHTML = streamRender(st.displayed) + '<span class="stream-cursor">▊</span>';
  st.rafId = setTimeout(() => _flushTyper(bubble), TYPER_TICK_MS);
}

function appendTyping(text) {
  if (!agentTypingBubble || !text) return;
  agentTypingBubble.classList.remove('hidden');
  agentTypingBubble.closest('.agent-turn')?.querySelector('.turn-final-label')?.classList.remove('hidden');
  let st = typerStates.get(agentTypingBubble);
  if (!st) {
    st = { pending: '', displayed: '', rafId: null };
    typerStates.set(agentTypingBubble, st);
  }
  st.pending += text;
  if (!st.rafId) st.rafId = setTimeout(() => _flushTyper(agentTypingBubble), TYPER_TICK_MS);
}

function appendThinking(text) {
  if (!agentTypingBubble || !text) return;
  const wrap = agentTypingBubble.closest('.bubble-content-wrap');
  if (!wrap) return;
  const panel = wrap.querySelector('.thinking-panel');
  const body  = wrap.querySelector('.thinking-body');
  const cnt   = wrap.querySelector('[id^="cnt-"]');
  const prev  = wrap.querySelector('[id^="prev-"]');
  if (!panel || !body) return;
  if (!agentTypingBubble.dataset.raw) agentTypingBubble.classList.add('hidden');
  // 参考 LobsterAI：真实思考流到达后立即展示，生成期间默认展开。
  panel.classList.remove('hidden');
  body.classList.remove('hidden');
  const toggle = wrap.querySelector('.thinking-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'true');
    const chevron = toggle.querySelector('.thinking-chevron');
    if (chevron) chevron.textContent = '⌄';
  }
  body.dataset.raw = (body.dataset.raw || '') + text;
  body.textContent = body.dataset.raw;
  const len = (body.dataset.raw || '').length;
  if (cnt) cnt.textContent = `${len} 字`;
  // 默认折叠状态下，预览显示最新一行片段（参考 clowder-ai ThinkingContent preview）
  const isExpanded = toggle?.getAttribute('aria-expanded') === 'true';
  if (prev) {
    if (isExpanded) {
      prev.style.display = 'none';
    } else {
      prev.style.display = '';
      const lastChunk = (body.dataset.raw || '').split(/\n+/).filter(Boolean).slice(-1)[0] || '';
      const slice = lastChunk.slice(0, 80);
      prev.textContent = slice + (lastChunk.length > 80 ? '…' : '');
    }
  }
}

function updateAgentStatus(text, phase = '') {
  if (!agentTypingBubble || agentTypingBubble.dataset.raw) return;
  if (phase === 'waiting' || phase === 'starting') {
    agentTypingBubble.classList.remove('hidden');
    agentTypingBubble.innerHTML = `<div class="agent-waiting" aria-label="${esc(text || 'Agent 运行中')}">
      <span class="agent-waiting-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>${esc(text || 'Agent 运行中')}</span>
    </div>`;
    scrollChat();
    return;
  }
  agentTypingBubble.innerHTML = `<div class="thinking-line"><span class="thinking-dot"></span><span>${esc(text || 'agent 正在处理...')}</span></div>`;
  scrollChat();
}

function collectFinishStats() {
  if (!runningState) return null;
  return {
    elapsedMs: Date.now() - runningState.startedAt,
    charsOut: runningState.charsOut,
    charsThink: runningState.charsThink,
    agent: runningState.agent,
  };
}

function finishTyping(stats = null) {
  if (!agentTypingBubble) return false;
  // 强制 flush 打字机：把剩余字符全部填入
  const st = typerStates.get(agentTypingBubble);
  let raw = agentTypingBubble.dataset.raw || '';
  if (st) {
    if (st.rafId) clearTimeout(st.rafId);
    st.displayed = st.pending;
    raw = st.pending;
    agentTypingBubble.dataset.raw = raw;
    typerStates.delete(agentTypingBubble);
  }
  agentTypingBubble.classList.remove('typing-cursor');
  if (raw) {
    try { agentTypingBubble.innerHTML = renderRichText(raw); } catch (err) { console.error('renderRichText failed:', err); }
  }
  const wrap = agentTypingBubble.closest('.bubble-content-wrap');
  const timeEl = wrap?.querySelector('[id^="time-"]');
  if (timeEl) timeEl.textContent = formatTime();
  // 在气泡下方追加 token / 耗时摘要
  if (stats && wrap) {
    const sec = Math.floor((stats.elapsedMs || 0) / 1000);
    const elapsed = sec < 60 ? `${sec}s` : `${Math.floor(sec/60)}m${sec%60}s`;
    const tokOut = Math.round((stats.charsOut || 0) / 4);
    const tokThink = Math.round((stats.charsThink || 0) / 4);
    const meta = document.createElement('div');
    meta.className = 'bubble-token-meta';
    meta.innerHTML = `
      <span title="耗时">⏱ ${elapsed}</span>
      <span title="输出字符 / token 估算">📤 ${stats.charsOut || 0} 字 · ~${tokOut} tok</span>
      ${stats.charsThink ? `<span title="思考字符">🧠 ${stats.charsThink} 字 · ~${tokThink} tok</span>` : ''}
    `;
    // 插到 bubble-actions 之前
    const actions = wrap.querySelector('.bubble-actions');
    if (actions) wrap.insertBefore(meta, actions);
    else wrap.appendChild(meta);
  }
  // Reveal thinking panel after agent finishes generating (collapsed by default)
  const thinkPanel = wrap ? wrap.querySelector('.thinking-panel') : null;
  const thinkBody  = wrap ? wrap.querySelector('.thinking-body')  : null;
  const thinkToggle = wrap ? wrap.querySelector('.thinking-toggle') : null;
  if (thinkPanel && thinkBody && (thinkBody.dataset.raw || '').trim()) {
    thinkPanel.classList.remove('hidden');
    // ensure collapsed (thumbnail) state: body hidden, toggle not expanded
    thinkBody.classList.add('hidden');
    if (thinkToggle) {
      thinkToggle.setAttribute('aria-expanded', 'false');
      const chev = thinkToggle.querySelector('.thinking-chevron');
      if (chev) chev.textContent = '\u203a';
    }
    const thinkCnt  = wrap.querySelector('[id^="cnt-"]');
    const thinkPrev = wrap.querySelector('[id^="prev-"]');
    if (thinkCnt) thinkCnt.textContent = thinkBody.dataset.raw.length + ' \u5b57';
    if (thinkPrev) {
      thinkPrev.style.display = '';
      const lastChunk = (thinkBody.dataset.raw || '').split(/\n+/).filter(Boolean).slice(-1)[0] || '';
      thinkPrev.textContent = lastChunk.slice(0, 80) + (lastChunk.length > 80 ? '\u2026' : '');
    }
  }
  agentTypingBubble = null;
  return Boolean(raw.trim());
}

function appendTurnPart(part = {}) {
  if (part.type === 'reasoning') {
    appendThinking(part.delta || part.text || '');
    bumpRunningChars('thinking', (part.delta || part.text || '').length);
    return;
  }
  if (part.type === 'final') {
    appendTyping(part.delta || part.text || '');
    bumpRunningChars('chunk', (part.delta || part.text || '').length);
    return;
  }
  if (part.type === 'tool_call') {
    appendAgentActivity({
      id: part.callId || part.id,
      phase: 'started',
      name: part.name,
      summary: part.summary,
      input: part.input,
    });
    return;
  }
  if (part.type === 'tool_result') {
    appendAgentActivity({
      id: part.callId || part.id,
      phase: part.status === 'error' ? 'failed' : 'completed',
      name: part.name,
      summary: part.summary,
      output: part.output,
      durationMs: part.durationMs,
    });
    return;
  }
  if (part.type === 'error' && agentTypingBubble) {
    const wrap = agentTypingBubble.closest('.agent-turn');
    const error = document.createElement('div');
    error.className = 'turn-error';
    error.textContent = part.message || 'Agent 执行失败';
    wrap?.insertBefore(error, wrap.querySelector('.bubble-actions'));
  }
}

function scrollChat() {
  const dist = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight;
  if (dist < 120) chatEl.scrollTop = chatEl.scrollHeight;
}

// ── 结构化气泡：plan 任务列表 ─────────────────────────────────
function renderPlanTaskDetail(task) {
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const questions = Array.isArray(task.open_questions) ? task.open_questions : [];
  const sections = [];
  if (steps.length) sections.push(`<div class="plan-detail-section"><span>实施步骤</span><ol>${steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol></div>`);
  if (task.tradeoff) sections.push(`<div class="plan-detail-section"><span>取舍</span><p>${esc(task.tradeoff)}</p></div>`);
  if (questions.length) sections.push(`<div class="plan-detail-section"><span>待确认</span><ul>${questions.map(question => `<li>${esc(question)}</li>`).join('')}</ul></div>`);
  if (task.accept) sections.push(`<div class="plan-detail-section plan-detail-accept"><span>验收标准</span><p>${esc(task.accept)}</p></div>`);
  return sections.join('');
}

function renderPlanTaskRow(task, index, agentControl, { open = false } = {}) {
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const questions = Array.isArray(task.open_questions) ? task.open_questions : [];
  return `<details class="plan-task-row" data-task-id="${esc(task.id || '')}" data-agent="${esc(task.agent || '')}" ${open ? 'open' : ''}>
    <summary class="plan-task-summary">
      <span class="plan-task-num">${index + 1}</span>
      <div class="plan-task-body">
        <div class="plan-task-name">${esc(task.title)}</div>
        <div class="plan-task-meta">
          ${agentControl}
          ${steps.length ? `<span>${steps.length} 步</span>` : ''}
          ${questions.length ? `<span>${questions.length} 项待确认</span>` : ''}
        </div>
        ${task.why ? `<div class="plan-task-why">${esc(task.why)}</div>` : ''}
      </div>
      <span class="plan-task-chevron" aria-hidden="true">›</span>
    </summary>
    <div class="plan-task-details">${renderPlanTaskDetail(task)}</div>
  </details>`;
}

function addPlanCard(goal, tasks) {
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
      `<button class="plan-suggest-btn" data-agent="${esc(agent)}">
        ▶ 让 ${esc(agent)} 执行 (${cnt} 条)
      </button>`
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
    sel.onclick = event => event.stopPropagation();
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

async function loadTasks() {
  const sid = currentSessionId || '';
  const url = '/api/tasks' + (sid ? '?sessionId=' + encodeURIComponent(sid) : '');
  const { tasks } = await fetch(url).then(r => r.json()).catch(() => ({ tasks: [] }));
  allTasks = tasks;
  filterAndRenderTasks();
  // 有 pending 就显示 dispatch 按钮，否则隐藏
  const hasPending = tasks.some(t => t.status === 'pending');
  const dispatchBtn = document.getElementById('dispatchBtn');
  if (hasPending) {
    dispatchBtn.classList.remove('hidden');
    dispatchBtn.disabled = isCurrentSessionRunning();
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
        <div class="task-row" data-task-id="${esc(task.id)}" data-parent-task-id="${esc(task.parent_task_id || '')}" data-chain-depth="${esc(task.chain_depth || 0)}">
          ${bulkMode ? `<input type="checkbox" class="task-bulk-cb" data-task-id="${esc(task.id)}" ${selectedTaskIds.has(task.id) ? 'checked' : ''}>` : ''}
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

      // 批量复选
      const cb = item.querySelector('.task-bulk-cb');
      if (cb) {
        cb.onclick = (e) => e.stopPropagation();
        cb.onchange = () => {
          if (cb.checked) selectedTaskIds.add(task.id);
          else selectedTaskIds.delete(task.id);
          updateBulkCount();
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
          if (accepted) return ssePost(url, { ...body, approvalId: data.approval.id }, handlers).then(resolve);
          handlers.error?.({ message: '用户拒绝操作' });
          return resolve(null);
        }
        handlers.error?.({ message: data.error || `请求失败 (${res.status})` });
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
        addPlanCard(goal, tasks);
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

  dispatchBtn.disabled = true;
  dispatchSpinner.classList.remove('hidden');

  try {
    const agentOnlyText = options.agentOnly ? `（仅 ${options.agentOnly}）` : '';
    addSystemMsg(`开始执行 pending 任务${agentOnlyText}…`);

    await ssePost('/api/dispatch', { ...options, sessionId: currentSessionId, mode: 'dispatch' }, {
      start:        ({ count }) => addSystemMsg(`共 ${count} 条任务待执行`),
      'task-start': ({ id, title, agent }) => {
        setActiveAgent(agent);
        updateTaskDot(id, 'in_progress');
        startAgentBubble(agent, currentSessionId);
        updateAgentStatus(`${agent} 正在执行：${title}`);
        showRunningPanel({ agent, mode: '执行任务', taskTitle: title });
      },
      chunk:        ({ text }) => { appendTyping(text); bumpRunningChars('chunk', (text || '').length); },
      thinking:     ({ text }) => { appendThinking(text); bumpRunningChars('thinking', (text || '').length); },
      activity:     appendAgentActivity,
      status:       ({ text, phase }) => updateAgentStatus(text, phase),
      'task-done':  ({ id, title, agent, summary }) => {
        const stats = collectFinishStats();
        const hadOutput = finishTyping(stats);
        hideRunningPanel();
        updateTaskDot(id, 'done');
        if (title && !hadOutput) addResultCard(title, agent, summary, true);
      },
      'task-failed':({ id, title, agent, error }) => {
        finishTyping();
        hideRunningPanel();
        updateTaskDot(id, 'failed');
        addResultCard(title || id, agent || '', error, false);
      },
      'worklist-chain': ({ from, to, parent_id, chain_task_id }) => {
        finishTyping();
        addSystemMsg(`→ ${from} 触发了 @${to} 继续执行`);
      },
      done: ({ done, failed }) => {
        hideRunningPanel();
        if (failed > 0) {
          addResumePrompt(`✓ 执行完毕：${done} 成功 / ${failed} 失败`, true);
        } else {
          addSystemMsg(`✓ 全部执行完毕：${done} 成功`);
        }
      },
      error: ({ message }) => { hideRunningPanel(); addSystemMsg(`✗ ${message}`); },
      aborted: () => {
        finishTyping();
        hideRunningPanel();
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
let hubState = { agents: [], tasks: [], skills: [], selectedSkills: [], skillsSummary: null, skillContextPreview: '', invocations: [], invocationSummary: null, lessons: [], subagents: [], subagentSummary: null, approvals: [], audit: [], schedules: [], scheduleRuns: [] };

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
    const [status, taskData, skillData, invocationData, lessonData, subagentData, approvalData, auditData, scheduleData, scheduleRunData] = await Promise.all([
      fetch('/api/status').then(r => r.json()),
      fetch('/api/tasks').then(r => r.json()).catch(() => ({ tasks: [] })),
      fetch(skillUrl).then(r => r.json()).catch(() => ({ skills: [], selected: [], summary: null, contextPreview: '' })),
      fetch('/api/invocations').then(r => r.json()).catch(() => ({ invocations: [], summary: null })),
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
      invocations: invocationData.invocations || [],
      invocationSummary: invocationData.summary || null,
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
    skills:      { icon: '🧩', title: 'Skills 路由', desc: '按需加载的 Skill 清单。支持导入新 skill；agent 调用时根据 mention 路由按需注入。' },
    lessons:     { icon: '📚', title: 'Lessons 课程', desc: 'agent 失败时记录的踩坑与原因，供下次任务规划参考。' },
    invocations: { icon: '⏱', title: '调用历史', desc: '所有 agent CLI 调用记录：耗时、状态、退出码、stderr。可定位疑难 case。' },
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
  const categories = [...new Set(hubState.skills.map(s => s.category).filter(Boolean))];
  const selectedNames = new Set(hubState.selectedSkills.map(s => s.name));
  const enabled = hubState.skills.filter(s => s.enabled !== false);
  const disabled = hubState.skills.filter(s => s.enabled === false);

  const mountKeys = ['controller', 'worker', 'reviewer', 'codex', 'claude', 'kimi'];

  function skillCard(skill, { showMounts = false, showInstall = false, installed = false } = {}) {
    const isEnabled = skill.enabled !== false;
    const isSelected = selectedNames.has(skill.name);
    const mountsHtml = showMounts ? `
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
      <div class="hub-kpi"><div class="hub-kpi-label">本次命中</div><div class="hub-kpi-value">${hubState.selectedSkills.length}</div></div>
      <div class="hub-kpi"><div class="hub-kpi-label">加载方式</div><div class="hub-kpi-value">按需</div></div>
    </div>

    <div class="skill-tabs">
      <button class="skill-tab active" data-stab="loaded">本次加载 <span class="skill-tab-count">${hubState.selectedSkills.length}</span></button>
      <button class="skill-tab" data-stab="installed">已安装 <span class="skill-tab-count">${hubState.skills.length}</span></button>
      <button class="skill-tab" data-stab="market">🛒 市场</button>
      <button class="skill-tab" data-stab="preview">Prompt 预览</button>
    </div>

    <div class="skill-tab-panel" data-spanel="loaded">
      ${hubState.selectedSkills.length
        ? hubState.selectedSkills.map(s => skillCard(s, { showMounts: false })).join('')
        : '<div class="hub-empty">当前输入没有匹配到 skill。输入目标或切到拆任务模式再打开 Hub。</div>'}
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
    sessionStateById = new Map(sessions.map(session => [session.id, session.run_state || { status: 'idle' }]));
    renderSessionList(sessions, activeId);
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
  const { activeId, trashed } = await fetch(`/api/sessions?id=${sessionId}`, {
    method: 'DELETE',
  }).then(r => r.json());
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
    if (!older) renderSessionRecovery();
  } catch {
    // Chat still works if history cannot be loaded.
  } finally {
    historyPage.loading = false;
    updateHistoryPager();
  }
}

(async function init() {
  await loadStatus();
  loadTasks();
  await loadSessions();
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
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/stream`);
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
        if (event === 'status') { ensureBubble(parsed.agent || agentKey); updateAgentStatus(parsed.text, parsed.phase); continue; }
        if (event === 'part') { ensureBubble(parsed.agent || agentKey); appendTurnPart(parsed); continue; }
        if (event === 'chunk' && parsed.text) { ensureBubble(parsed.agent || agentKey); appendTyping(parsed.text); bumpRunningChars('chunk', (parsed.text||'').length); continue; }
        if (event === 'thinking' && parsed.text) { appendThinking(parsed.text); bumpRunningChars('thinking', (parsed.text||'').length); continue; }
        if (event === 'activity') { appendAgentActivity(parsed); continue; }
        if (event === 'done') { finishTyping(collectFinishStats()); hideRunningPanel(); loadSessions(); break; }
        if (event === 'error') { finishTyping(); hideRunningPanel(); addSystemMsg(`? ${parsed.message||''}`); break; }
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
    const { running = [] } = await runningRes.json();
    const { tasks = [] } = await tasksRes.json();
    const inProgress = tasks.filter(t => t.status === 'in_progress');
    for (const t of inProgress) {
      if (!running.some(r => r.sessionId === t.run_id)) {
        running.push({
          sessionId: t.run_id,
          agentKey: t.executed_by || t.agent,
          mode: 'dispatch',
          taskTitle: t.title,
          startedAt: t.started_at || t.updated_at || new Date().toISOString(),
        });
      }
    }
    const activeRunIds = new Set(running.map(r => r.sessionId));
    const doneTasks = tasks.filter(t => t.status === 'done');
    for (const d of doneTasks) {
      const pendingInRun = tasks.filter(t => t.run_id === d.run_id && t.status === 'pending');
      if (pendingInRun.length > 0 && !activeRunIds.has(d.run_id)) {
        activeRunIds.add(d.run_id);
        const firstPending = pendingInRun[0];
        running.push({
          sessionId: firstPending.run_id,
          agentKey: firstPending.agent,
          mode: 'dispatch',
          taskTitle: firstPending.title,
          startedAt: firstPending.started_at || firstPending.updated_at || new Date().toISOString(),
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

const artifactsBtn = document.getElementById('artifactsBtn');
const artifactsPanel = document.getElementById('artifactsPanel');
const artifactsPanelClose = document.getElementById('artifactsPanelClose');
const artifactsRefreshBtn = document.getElementById('artifactsRefreshBtn');
const artifactsBtnCount = document.getElementById('artifactsBtnCount');
const artifactsList = document.getElementById('artifactsList');
const artifactsPreviewWrap = document.getElementById('artifactsPreviewWrap');
const artifactsPreviewHeader = document.getElementById('artifactsPreviewHeader');
const artifactsPreviewTitle = document.getElementById('artifactsPreviewTitle');
const artifactsPreviewContent = document.getElementById('artifactsPreviewContent');
const artifactsCopyBtn = document.getElementById('artifactsCopyBtn');
const artifactsOpenBtn = document.getElementById('artifactsOpenBtn');

let apVisible = false;
let apActiveTab = 'chat'; // 'chat' | 'workspace'
let apCurrentArtifact = null;
let apArtifacts = [];
let apWsFiles = [];

// ── 面板开关 ─────────────────────────────────────────────────
function openArtifactsPanel() {
  apVisible = true;
  artifactsPanel.classList.remove('hidden');
  artifactsBtn.classList.add('active');
  document.body.classList.add('artifacts-open');
  loadArtifacts();
}
function closeArtifactsPanel() {
  apVisible = false;
  artifactsPanel.classList.add('hidden');
  artifactsBtn.classList.remove('active');
  document.body.classList.remove('artifacts-open');
}
function toggleArtifactsPanel() {
  if (apVisible) closeArtifactsPanel(); else openArtifactsPanel();
}

artifactsBtn.onclick = toggleArtifactsPanel;
artifactsPanelClose.onclick = closeArtifactsPanel;
artifactsRefreshBtn.onclick = () => loadArtifacts();

// ── Tab 切换 ─────────────────────────────────────────────────
artifactsPanel.querySelectorAll('.ap-tab').forEach(btn => {
  btn.onclick = () => {
    artifactsPanel.querySelectorAll('.ap-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    apActiveTab = btn.dataset.aptab;
    apCurrentArtifact = null;
    renderArtifactList();
    if (apActiveTab === 'chat' && apArtifacts.length) selectArtifact(apArtifacts[0]);
    else if (apActiveTab === 'workspace' && apWsFiles.length) selectWsFile(apWsFiles[0]);
  };
});

// ── 数据加载 ─────────────────────────────────────────────────
async function loadArtifacts() {
  const sid = currentSessionId || '';
  try {
    const [chatData, wsData] = await Promise.all([
      fetch('/api/artifacts?sessionId=' + encodeURIComponent(sid)).then(r => r.json()).catch(() => ({ artifacts: [] })),
      fetch('/api/workspace/recent?limit=30').then(r => r.json()).catch(() => ({ files: [] })),
    ]);
    apArtifacts = chatData.artifacts || [];
    apWsFiles = wsData.files || [];
    artifactsBtnCount.textContent = apArtifacts.length > 99 ? '99+' : String(apArtifacts.length);
    artifactsBtnCount.classList.toggle('hidden', apArtifacts.length === 0);
    renderArtifactList();
    // 默认选中第一项
    if (!apCurrentArtifact) {
      if (apActiveTab === 'chat' && apArtifacts.length) selectArtifact(apArtifacts[0]);
      else if (apActiveTab === 'workspace' && apWsFiles.length) selectWsFile(apWsFiles[0]);
    }
  } catch (e) {
    artifactsList.innerHTML = '<div class="artifacts-empty">加载失败：' + esc(String(e)) + '</div>';
  }
}

// ── 列表渲染 ─────────────────────────────────────────────────
const AP_TYPE_ICON = {
  html: '🌐', markdown: '📝', md: '📝', code: '📄', json: '{ }',
  url: '🔗', file: '📁', ts: '🔷', py: '🐍', sh: '⚙', sql: '🗄',
};
function apTypeIcon(type, lang) {
  return AP_TYPE_ICON[lang] || AP_TYPE_ICON[type] || '📄';
}
function apRelativeTime(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return '刚刚';
  if (d < 3600000) return Math.round(d / 60000) + ' 分钟前';
  if (d < 86400000) return Math.round(d / 3600000) + ' 小时前';
  return new Date(ts).toLocaleDateString();
}

function renderArtifactList() {
  if (apActiveTab === 'chat') {
    if (!apArtifacts.length) {
      artifactsList.innerHTML = '<div class="artifacts-empty">暂无会话文件。Agent 输出或引用文件后会自动收集。</div>';
      return;
    }
    artifactsList.innerHTML = apArtifacts.map((a, i) => `
      <div class="artifact-item ${apCurrentArtifact?.id === a.id ? 'selected' : ''}" data-idx="${i}" data-source="chat">
        <span class="artifact-item-icon">${apTypeIcon(a.type, a.lang)}</span>
        <div class="artifact-item-info">
          <div class="artifact-item-name">${esc(a.path || a.id)}</div>
          <div class="artifact-item-meta">${esc(a.agent || '')} · ${apRelativeTime(a.createdAt)}</div>
        </div>
        <span class="artifact-item-badge">${esc(a.type)}</span>
      </div>
    `).join('');
    artifactsList.querySelectorAll('.artifact-item[data-source=chat]').forEach(el => {
      el.onclick = () => selectArtifact(apArtifacts[+el.dataset.idx]);
    });
  } else {
    if (!apWsFiles.length) {
      artifactsList.innerHTML = '<div class="artifacts-empty">工作区暂无近期文件。</div>';
      return;
    }
    artifactsList.innerHTML = apWsFiles.map((f, i) => `
      <div class="artifact-item ${apCurrentArtifact?.path === f.path && apCurrentArtifact?.source === 'workspace' ? 'selected' : ''}" data-idx="${i}" data-source="ws">
        <span class="artifact-item-icon">${apTypeIcon('file', f.lang)}</span>
        <div class="artifact-item-info">
          <div class="artifact-item-name">${esc(f.name)}</div>
          <div class="artifact-item-meta">${esc(f.path)} · ${apRelativeTime(f.mtime)}</div>
        </div>
        <span class="artifact-item-badge">${esc(f.lang || f.name.split('.').pop())}</span>
      </div>
    `).join('');
    artifactsList.querySelectorAll('.artifact-item[data-source=ws]').forEach(el => {
      el.onclick = () => selectWsFile(apWsFiles[+el.dataset.idx]);
    });
  }
}

// ── 选中 artifact ─────────────────────────────────────────────
function selectArtifact(a) {
  apCurrentArtifact = { ...a, source: 'chat' };
  renderArtifactPreview();
  artifactsList.querySelectorAll('.artifact-item').forEach(el => {
    el.classList.toggle('selected', apArtifacts[+el.dataset.idx]?.id === a.id);
  });
}

async function selectWsFile(f) {
  artifactsPreviewContent.innerHTML = '<div class="artifacts-empty">加载中…</div>';
  artifactsPreviewHeader.classList.remove('hidden');
  artifactsPreviewTitle.textContent = f.path;
  artifactsOpenBtn.style.display = f.lang === 'html' ? '' : 'none';
  if (f.lang === 'html') {
    artifactsOpenBtn.onclick = () => openLocalHtml(f.path, artifactsOpenBtn).catch(() => {});
  }
  try {
    const data = await fetch('/api/workspace/file?path=' + encodeURIComponent(f.path)).then(r => r.json());
    if (data.error) throw new Error(data.error);
    apCurrentArtifact = { ...f, source: 'workspace', content: data.content, type: data.lang || 'code' };
    renderWsFilePreview(f, data.content);
  } catch (e) {
    artifactsPreviewContent.innerHTML = '<div class="artifacts-empty">读取失败：' + esc(String(e)) + '</div>';
  }
  artifactsList.querySelectorAll('.artifact-item').forEach(el => {
    el.classList.toggle('selected', apWsFiles[+el.dataset.idx]?.path === f.path);
  });
}

// ── 渲染预览 ─────────────────────────────────────────────────
function renderArtifactPreview() {
  if (!apCurrentArtifact) return;
  const a = apCurrentArtifact;
  artifactsPreviewHeader.classList.remove('hidden');
  artifactsPreviewTitle.textContent = a.path || a.id;

  const isHtml = a.type === 'html' || a.lang === 'html';
  artifactsOpenBtn.style.display = isHtml ? '' : 'none';
  if (isHtml) {
    artifactsOpenBtn.onclick = () => openLocalHtml(a.path, artifactsOpenBtn).catch(() => {});
  }

  if (a.type === 'url') {
    artifactsPreviewContent.innerHTML = `<a class="ap-url-card" href="${esc(a.content)}" target="_blank" rel="noopener"><span>🔗</span><span class="ap-url-text">${esc(a.content)}</span></a>`;
    return;
  }
  if (isHtml) {
    artifactsPreviewContent.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.className = 'ap-iframe';
    iframe.sandbox = 'allow-scripts';
    iframe.srcdoc = a.content || '';
    artifactsPreviewContent.appendChild(iframe);
    return;
  }
  const isMd = a.type === 'markdown' || a.lang === 'md' || a.lang === 'markdown';
  if (isMd) {
    const div = document.createElement('div');
    div.className = 'ap-md-render';
    div.innerHTML = (typeof marked !== 'undefined') ? marked.parse(a.content || '') : '<pre>' + esc(a.content || '') + '</pre>';
    artifactsPreviewContent.innerHTML = '';
    artifactsPreviewContent.appendChild(div);
    return;
  }
  if (a.type === 'json') {
    try {
      const parsed = JSON.parse(a.content);
      artifactsPreviewContent.innerHTML = `<pre class="ap-code-block">${esc(JSON.stringify(parsed, null, 2))}</pre>`;
    } catch {
      artifactsPreviewContent.innerHTML = `<pre class="ap-code-block">${esc(a.content || '')}</pre>`;
    }
    return;
  }
  artifactsPreviewContent.innerHTML = `<pre class="ap-code-block">${esc(a.content || '')}</pre>`;
}

function renderWsFilePreview(f, content) {
  artifactsPreviewContent.innerHTML = '';
  const lang = f.lang || '';
  if (lang === 'html') {
    const iframe = document.createElement('iframe');
    iframe.className = 'ap-iframe';
    iframe.sandbox = 'allow-scripts';
    iframe.srcdoc = content;
    artifactsPreviewContent.appendChild(iframe);
  } else if ((lang === 'md' || lang === 'markdown') && typeof marked !== 'undefined') {
    const div = document.createElement('div');
    div.className = 'ap-md-render';
    div.innerHTML = marked.parse(content || '');
    artifactsPreviewContent.appendChild(div);
  } else {
    artifactsPreviewContent.innerHTML = `<pre class="ap-code-block">${esc(content || '')}</pre>`;
  }
}

// ── 复制 ─────────────────────────────────────────────────────
artifactsCopyBtn.onclick = async () => {
  const content = apCurrentArtifact?.content || '';
  try {
    await navigator.clipboard.writeText(content);
    artifactsCopyBtn.textContent = '✓ 已复制';
    setTimeout(() => { artifactsCopyBtn.textContent = '📋 复制'; }, 1500);
  } catch {
    artifactsCopyBtn.textContent = '复制失败';
    setTimeout(() => { artifactsCopyBtn.textContent = '📋 复制'; }, 1500);
  }
};

// ── session 切换时刷新 ────────────────────────────────────────
function refreshArtifactsOnSessionChange() {
  apCurrentArtifact = null;
  apArtifacts = [];
  loadArtifacts();
}
// 挂载到全局供 session 切换调用
window.refreshArtifactsOnSessionChange = refreshArtifactsOnSessionChange;

// ── chat 气泡内联角标 ─────────────────────────────────────────
function injectArtifactBadges(bubbleEl, artifacts) {
  if (!artifacts || !artifacts.length) return;
  const pres = bubbleEl.querySelectorAll('pre');
  artifacts.forEach((a, i) => {
    const pre = pres[i];
    if (!pre || pre.querySelector('.artifact-inline-badge')) return;
    const badge = document.createElement('span');
    badge.className = 'artifact-inline-badge';
    badge.textContent = '📁 ' + (a.path || '查看产物');
    badge.onclick = (e) => {
      e.stopPropagation();
      openArtifactsPanel();
      apActiveTab = 'chat';
      artifactsPanel.querySelectorAll('.ap-tab').forEach(b => b.classList.toggle('active', b.dataset.aptab === 'chat'));
      renderArtifactList();
      setTimeout(() => selectArtifact(a), 60);
    };
    pre.style.position = 'relative';
    pre.insertAdjacentElement('afterbegin', badge);
  });
}
window.injectArtifactBadges = injectArtifactBadges;

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

// ─── Skills management ───────────────────────────────────────────
(function() {
const svBackBtn = document.getElementById("svBackBtn");
const skillsPageBtn = document.getElementById("skillsPageBtn");
const skillsView = document.getElementById("skillsView");
const chatArea = document.querySelector(".chat-area");
const svInstalledList = document.getElementById("svInstalledList");
const svMarketList = document.getElementById("svMarketList");
const svSourceBtns = document.getElementById("svSourceBtns");
const svMarketSearch = document.getElementById("svMarketSearch");
if (!skillsPageBtn) return;
let currentSource = "myteam-official";
const marketCache = skillRegistryCache;
skillsPageBtn.addEventListener("click", () => showSkillsView());
svBackBtn && svBackBtn.addEventListener("click", () => hideSkillsView());
function showSkillsView() {
  skillsView.classList.remove("hidden");
  chatArea.style.display = "none";
  loadInstalledSkills();
  loadMarketSources();
  prefetchSkillRegistry("clowder-ai");
}
function hideSkillsView() { skillsView.classList.add("hidden"); chatArea.style.display = ""; }
document.querySelectorAll(".sv-tab").forEach(tab => { tab.addEventListener("click", () => { document.querySelectorAll(".sv-tab").forEach(t=>t.classList.remove("active")); tab.classList.add("active"); var p=tab.dataset.stab; document.querySelectorAll(".sv-panel").forEach(p=>p.classList.add("hidden")); if (p==="installed") { document.getElementById("svPanelInstalled").classList.remove("hidden"); loadInstalledSkills(); } if (p==="market") { document.getElementById("svPanelMarket").classList.remove("hidden"); loadMarketSkills(); } if (p==="import") { document.getElementById("svPanelImport").classList.remove("hidden"); } }); });
async function loadInstalledSkills() {
  try {
    const data = await fetch("/api/skills").then(r=>r.json());
    var skills = data.skills || data || [];
    if (!skills.length) { svInstalledList.innerHTML = "<div class=\"sv-empty\">No skills installed.</div>"; return; }
    svInstalledList.innerHTML = skills.map(s => {
      var enabled = s.enabled !== false;
      var cat = s.category || "general";
      var desc = (s.description || s.trigger || "").slice(0,120);
      return "<div class=\"sv-card " + (enabled?"":"disabled") + "\"><div class=\"sv-card-header\"><span class=\"sv-card-name\">"+esc(s.name)+"</span><span class=\"sv-card-cat\">"+esc(cat)+"</span><div class=\"sv-card-actions\"><label class=\"sv-toggle\"><input type=\"checkbox\" class=\"sv-toggle-cb\" data-skill=\""+esc(s.name)+"\" "+(enabled?"checked":"")+"><span class=\"sv-toggle-track\"><span class=\"sv-toggle-thumb\"></span></span></label><button class=\"sv-uninstall-btn\" data-skill=\""+esc(s.name)+"\">🗑</button></div></div><div class=\"sv-card-desc\">"+esc(desc)+"</div>"+(s.mounts?"<div class=\"sv-card-mounts\">"+Object.entries(s.mounts).filter(([_,v])=>v).map(([k])=>"<span class=\"sv-mount-tag\">"+esc(k)+"</span>").join("")+"</div>":"")+"</div>";
    }).join("");
    svInstalledList.querySelectorAll(".sv-toggle-cb").forEach(cb => { cb.addEventListener("change", async () => { var n=cb.dataset.skill; var en=cb.checked; await fetch("/api/skills/"+encodeURIComponent(n)+"/toggle", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({enabled:en}) }); }); });
    svInstalledList.querySelectorAll(".sv-uninstall-btn").forEach(btn => { btn.addEventListener("click", async () => { var n=btn.dataset.skill; if (!confirm("Uninstall "+n+"?")) return; await fetchWithApproval("/api/skills/"+encodeURIComponent(n), { method:"DELETE", headers:{"Content-Type":"application/json"}, body:"{}" }); loadInstalledSkills(); }); });
  } catch(e) { svInstalledList.innerHTML = "<div class=\"sv-empty\">Load failed: "+esc(e.message)+"</div>"; }
}
async function loadMarketSources() {
  const sources = ["myteam-official", "clowder-ai"];
  svSourceBtns.innerHTML = sources.map(s=>"<button class=\"sv-src-btn "+(s===currentSource?"active":"")+"\" data-src=\""+esc(s)+"\">"+esc(s)+"</button>").join("");
  svSourceBtns.querySelectorAll(".sv-src-btn").forEach(btn => { btn.addEventListener("click", () => { currentSource=btn.dataset.src; svSourceBtns.querySelectorAll(".sv-src-btn").forEach(b=>b.classList.toggle("active",b.dataset.src===currentSource)); loadMarketSkills(); }); });
  svMarketSearch.oninput = () => renderMarketSkills(currentSource);
  loadMarketSkills();
}
async function loadMarketSkills() {
  const requestedSource = currentSource;
  if (marketCache[requestedSource]) {
    renderMarketSkills(requestedSource);
    return;
  }
  svMarketList.innerHTML = "<div class=\"sv-empty\">正在加载市场…</div>";
  try {
    await fetchSkillRegistry(requestedSource);
    if (requestedSource === currentSource) renderMarketSkills(requestedSource);
  } catch(e) { if (requestedSource === currentSource) svMarketList.innerHTML = "<div class=\"sv-empty\">Load failed: "+esc(e.message)+"</div>"; }
}
function renderMarketSkills(source) {
    var skills = marketCache[source]?.skills || [];
    var filter = svMarketSearch.value.toLowerCase();
    if (filter) skills = skills.filter(s => (s.name||"").toLowerCase().includes(filter) || (s.description||s.trigger||"").toLowerCase().includes(filter));
    if (!skills.length) { svMarketList.innerHTML = "<div class=\"sv-empty\">"+(filter?"No matches":"No skills")+"</div>"; return; }
    svMarketList.innerHTML = skills.map(s => {
      var installed = s.installed;
      return "<div class=\"sv-card "+(installed?"installed":"")+"\"><div class=\"sv-card-header\"><span class=\"sv-card-name\">"+esc(s.name)+"</span><span class=\"sv-card-cat\">"+esc(s.category||"general")+"</span><div class=\"sv-card-actions\"><button class=\"sv-install-btn "+(installed?"installed":"")+"\" data-skill=\""+esc(s.name)+"\" data-source=\""+esc(source)+"\" "+(installed?"disabled":"")+">"+(installed?"Installed":"Install")+"</button></div></div><div class=\"sv-card-desc\">"+esc((s.description||s.trigger||"").slice(0,150))+"</div></div>";
    }).join("");
    svMarketList.querySelectorAll(".sv-install-btn:not([disabled])").forEach(btn => { btn.addEventListener("click", async () => { var n=btn.dataset.skill; var source=btn.dataset.source; btn.disabled=true; btn.textContent="Installing..."; try { var approved = await fetchWithApproval("/api/skills/install", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({source,name:n}) }); var res=approved.response; var data=approved.data; if (!res.ok || !data.ok) throw new Error(data.error || "install failed"); btn.textContent="Installed"; btn.classList.add("installed"); btn.closest(".sv-card")?.classList.add("installed"); var cached=marketCache[source]?.skills?.find(s=>s.name===n); if (cached) cached.installed=true; loadInstalledSkills(); } catch(e) { btn.disabled=false; btn.textContent="Install"; alert("安装失败："+e.message); } }); });
}
document.getElementById("svImportGithubBtn") && document.getElementById("svImportGithubBtn").addEventListener("click", () => doImport({url:document.getElementById("svImportGithub").value.trim()}));
document.getElementById("svImportUrlBtn") && document.getElementById("svImportUrlBtn").addEventListener("click", () => doImport({url:document.getElementById("svImportUrl").value.trim()}));
document.getElementById("svImportPathBtn") && document.getElementById("svImportPathBtn").addEventListener("click", () => { var p=document.getElementById("svImportPath").value.trim(); doImport(p.toLowerCase().endsWith(".zip")?{zip:p}:{path:p}); });
async function doImport(payload) {
  var st = document.getElementById("svImportStatus");
  st.classList.remove("hidden"); st.textContent = "Installing..."; st.className="sv-import-status";
  try {
    var approvedResult = await fetchWithApproval("/api/skills/install-source", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
    var data = approvedResult.data;
    if (data.ok) { st.textContent = "Installed: "+data.skill.name; st.classList.add("success"); loadInstalledSkills(); }
    else throw new Error(data.error||"unknown");
  } catch(e) { st.textContent = "Failed: "+e.message; st.classList.add("error"); }
}
})();

// ─── Task sub-agent button ───────────────────────────────────────────
// inject sub-agent view button into task rows with parent_task_id
var origLoadTasks = window.loadTasks;
if (typeof loadTasks === "function") {
  var orig = loadTasks;
  loadTasks = async function() { await orig.apply(this, arguments); injectSubagentButtons(); };
}
function injectSubagentButtons() {
  document.querySelectorAll(".task-row").forEach(row => {
    if (row.querySelector(".task-subagent-btn")) return;
    if (!row.dataset.parentTaskId && Number(row.dataset.chainDepth || 0) <= 0) return;
    var id = row.dataset.taskId || row.querySelector("[data-task-id]")?.dataset?.taskId;
    if (!id) return;
    var titleEl = row.querySelector(".task-row-title");
    var agentEl = row.querySelector(".task-row-agent");
    var title = titleEl?.title || titleEl?.textContent || "";
    var agent = agentEl?.textContent || "";
    var btn = document.createElement("button");
    btn.className = "task-subagent-btn";
    btn.textContent = "🔍";
    btn.title = "View subagent";
    btn.onclick = (e) => { e.stopPropagation(); if (window.openSubagentSession) window.openSubagentSession(id, title, agent); };
    var actions = row.querySelector(".task-actions");
    if (actions) actions.insertAdjacentElement("beforebegin", btn);
  });
}
