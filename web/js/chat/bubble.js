// ── chat helpers ─────────────────────────────────────────────
const chatEl = document.getElementById('chatMessages');
const welcome = document.getElementById('chatWelcome');
let productTemplates = [];
let productTemplatesPromise = null;
let productTemplatesFailed = false;
let appWorkspace = '';

function welcomeHealthMarkup() {
  const available = (agentConfigList || []).filter(agent => agent.available);
  if (available.length) {
    return `<div class="welcome-health ready">
      <span class="welcome-health-dot"></span>
      <strong>${available.length} 个 Agent 可启动</strong>
      <span>${esc(available.map(agent => agent.label || agent.key).join('、'))}</span>
      ${appWorkspace ? `<code title="当前工作区">${esc(appWorkspace)}</code>` : ''}
    </div>`;
  }
  return `<button class="welcome-health needs-setup" type="button" data-welcome-action="settings">
    <span class="welcome-health-dot"></span>
    <strong>还没有可启动的 Agent</strong>
    <span>先完成一次本机 CLI 检查</span>
  </button>`;
}

function renderWelcome(target = document.getElementById('chatWelcome')) {
  if (!target) return;
  target.innerHTML = `
    <div class="welcome-eyebrow">LOCAL MULTI-AGENT WORKSPACE</div>
    <h2>从一个真实任务开始</h2>
    <p class="welcome-lead">选择场景后，myteam 只会填入目标；由你确认后再拆解和执行。</p>
    ${welcomeHealthMarkup()}
    <div class="welcome-flow" aria-label="任务闭环">
      <span><b>1</b> 选择场景</span><i>→</i>
      <span><b>2</b> Agent 协作</span><i>→</i>
      <span><b>3</b> 人工验收</span>
    </div>
    <div class="welcome-template-grid">
      ${productTemplates.length ? productTemplates.map(template => `
        <button class="welcome-template" type="button" data-template-id="${esc(template.id)}">
          <span class="welcome-template-icon">${template.icon || '·'}</span>
          <span class="welcome-template-copy">
            <strong>${esc(template.title)}</strong>
            <small>${esc(template.summary)}</small>
            <em>${esc(template.deliverable)}</em>
          </span>
        </button>`).join('') : `<div class="welcome-template-loading">${productTemplatesFailed ? '场景模板暂时不可用，你仍可直接输入目标。' : '正在加载场景模板…'}</div>`}
    </div>
    <p class="welcome-footnote">数据保存在本机；高风险操作仍会在执行前请求审批。</p>`;

  target.querySelector('[data-welcome-action="settings"]')?.addEventListener('click', () => openDrawer());
  target.querySelectorAll('[data-template-id]').forEach(button => {
    button.addEventListener('click', () => applyProductTemplate(button.dataset.templateId));
  });
  if (!productTemplates.length && !productTemplatesFailed) void loadProductTemplates(target);
}

async function loadProductTemplates(target = document.getElementById('chatWelcome')) {
  if (!productTemplatesPromise) {
    productTemplatesPromise = fetch('/api/product-templates')
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        productTemplates = Array.isArray(data.templates) ? data.templates : [];
        productTemplatesFailed = false;
        return productTemplates;
      })
      .catch(() => {
        productTemplatesPromise = null;
        productTemplatesFailed = true;
        return [];
      });
  }
  await productTemplatesPromise;
  if (target?.isConnected && target.id === 'chatWelcome') renderWelcome(target);
}

function applyProductTemplate(templateId) {
  const template = productTemplates.find(item => item.id === templateId);
  if (!template) return;
  const planButton = document.querySelector('#modeGroup .radio-btn[data-value="plan"]');
  if (template.mode === 'plan') planButton?.click();
  const input = document.getElementById('goalInput');
  input.value = template.prompt;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  showToast(`已填入「${template.title}」，补充主题后再发送。`, 'success');
}

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
      <div class="live-output-panel hidden" id="live-${uid}">
        <button class="live-output-toggle" type="button" aria-expanded="false">
          <span class="live-output-chevron">›</span>
          <span class="live-output-label">实时输出</span>
          <span class="live-output-count" id="livecnt-${uid}"></span>
        </button>
        <div class="live-output-body hidden" id="livebody-${uid}"></div>
      </div>
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

  // 绑定 实时输出 折叠按钮
  const liveToggle = row.querySelector('.live-output-toggle');
  liveToggle?.addEventListener('click', () => {
    const liveBody = row.querySelector(`#livebody-${uid}`);
    const isExpanded = liveToggle.getAttribute('aria-expanded') === 'true';
    liveToggle.setAttribute('aria-expanded', String(!isExpanded));
    liveToggle.querySelector('.live-output-chevron').textContent = isExpanded ? '›' : '⌄';
    liveBody?.classList.toggle('hidden', isExpanded);
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
  const wrap = agentTypingBubble.closest('.bubble-content-wrap');
  const liveBody = wrap?.querySelector('.live-output-body');
  // 无面板时回退到旧行为（直接写主气泡），保证不退步
  if (!liveBody) {
    agentTypingBubble.classList.remove('hidden');
    let st = typerStates.get(agentTypingBubble);
    if (!st) { st = { pending: '', displayed: '', rafId: null }; typerStates.set(agentTypingBubble, st); }
    st.pending += text;
    if (!st.rafId) st.rafId = setTimeout(() => _flushTyper(agentTypingBubble), TYPER_TICK_MS);
    return;
  }
  // 主气泡保留三点（不覆盖）；流式文本进可折叠"实时输出"面板（默认收起）
  agentTypingBubble.dataset.raw = (agentTypingBubble.dataset.raw || '') + text;
  const panel = wrap.querySelector('.live-output-panel');
  panel?.classList.remove('hidden');
  const cnt = wrap.querySelector('[id^="livecnt-"]');
  if (cnt) cnt.textContent = `${agentTypingBubble.dataset.raw.length} 字`;
  let st = typerStates.get(liveBody);
  if (!st) { st = { pending: '', displayed: '', rafId: null }; typerStates.set(liveBody, st); }
  st.pending += text;
  if (!st.rafId) st.rafId = setTimeout(() => _flushTyper(liveBody), TYPER_TICK_MS);
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
  if (!agentTypingBubble) return;
  // 已有三点指示器：仅更新文案 span，保留 .agent-waiting-dots 动画结构，避免重建闪烁
  const waiting = agentTypingBubble.querySelector('.agent-waiting');
  if (waiting) {
    const label = waiting.querySelector('span:last-child');
    if (label && text) label.textContent = text;
    return;
  }
  agentTypingBubble.classList.remove('hidden');
  const indicator = (phase === 'waiting' || phase === 'starting')
    ? `<span class="agent-waiting-dots" aria-hidden="true"><i></i><i></i><i></i></span>`
    : `<span class="thinking-dot"></span>`;
  agentTypingBubble.innerHTML = `<div class="agent-waiting" aria-label="${esc(text || 'Agent 运行中')}">${indicator}<span>${esc(text || 'Agent 运行中')}</span></div>`;
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
  const wrap = agentTypingBubble.closest('.bubble-content-wrap');
  // 清理实时输出面板的 typer（回退路径下主气泡 typer 也清掉）
  const liveBody = wrap?.querySelector('.live-output-body');
  if (liveBody) {
    const liveSt = typerStates.get(liveBody);
    if (liveSt) { if (liveSt.rafId) clearTimeout(liveSt.rafId); typerStates.delete(liveBody); }
  }
  const mainSt = typerStates.get(agentTypingBubble);
  if (mainSt) { if (mainSt.rafId) clearTimeout(mainSt.rafId); typerStates.delete(agentTypingBubble); }
  let raw = agentTypingBubble.dataset.raw || '';
  agentTypingBubble.classList.remove('typing-cursor');
  if (raw) {
    try { agentTypingBubble.innerHTML = renderRichText(raw); } catch (err) { console.error('renderRichText failed:', err); }
  }
  // 全文已进主气泡：隐藏实时输出面板，显示"最终输出"标签
  wrap?.querySelector('.live-output-panel')?.classList.add('hidden');
  wrap?.querySelector('.turn-final-label')?.classList.remove('hidden');
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

