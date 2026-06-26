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
const artifactsSessionName = document.getElementById('artifactsSessionName');
const artifactsResizeHandle = document.getElementById('artifactsResizeHandle');

let apVisible = false;
let apActiveTab = 'chat'; // 'chat' | 'workspace'
let apCurrentArtifact = null;
let apArtifacts = [];
let apWsFiles = [];

const AP_PANEL_WIDTH_KEY = 'myteam.artifactsPanelWidth';
function setArtifactsPanelWidth(width) {
  const min = 420;
  const max = Math.max(min, window.innerWidth - 280);
  const next = Math.max(min, Math.min(max, Number(width) || 0));
  document.documentElement.style.setProperty('--files-panel-width', `${next}px`);
  return next;
}
const savedArtifactsPanelWidth = Number(localStorage.getItem(AP_PANEL_WIDTH_KEY));
if (savedArtifactsPanelWidth > 0 && window.innerWidth > 720) setArtifactsPanelWidth(savedArtifactsPanelWidth);

artifactsResizeHandle?.addEventListener('pointerdown', event => {
  if (window.innerWidth <= 720) return;
  event.preventDefault();
  artifactsResizeHandle.setPointerCapture(event.pointerId);
  artifactsPanel.classList.add('resizing');
  document.body.classList.add('artifacts-resizing');
  const resize = moveEvent => setArtifactsPanelWidth(window.innerWidth - moveEvent.clientX);
  const finish = upEvent => {
    const width = setArtifactsPanelWidth(window.innerWidth - upEvent.clientX);
    localStorage.setItem(AP_PANEL_WIDTH_KEY, String(width));
    artifactsPanel.classList.remove('resizing');
    document.body.classList.remove('artifacts-resizing');
    artifactsResizeHandle.removeEventListener('pointermove', resize);
    artifactsResizeHandle.removeEventListener('pointerup', finish);
    artifactsResizeHandle.removeEventListener('pointercancel', finish);
  };
  artifactsResizeHandle.addEventListener('pointermove', resize);
  artifactsResizeHandle.addEventListener('pointerup', finish);
  artifactsResizeHandle.addEventListener('pointercancel', finish);
});
artifactsResizeHandle?.addEventListener('dblclick', () => {
  document.documentElement.style.removeProperty('--files-panel-width');
  localStorage.removeItem(AP_PANEL_WIDTH_KEY);
});
window.addEventListener('resize', () => {
  const saved = Number(localStorage.getItem(AP_PANEL_WIDTH_KEY));
  if (saved > 0 && window.innerWidth > 720) {
    const width = setArtifactsPanelWidth(saved);
    localStorage.setItem(AP_PANEL_WIDTH_KEY, String(width));
  }
});

function resetArtifactPreview(message = '选择左侧文件查看内容') {
  apCurrentArtifact = null;
  artifactsPreviewHeader.classList.add('hidden');
  artifactsPreviewTitle.textContent = '';
  artifactsOpenBtn.style.display = 'none';
  artifactsPreviewContent.innerHTML = `<div class="artifacts-empty" style="padding:24px">${esc(message)}</div>`;
}

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
    resetArtifactPreview(apActiveTab === 'chat' ? '本次对话暂无文件' : '工作区暂无未归属文件');
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
    const attributedPaths = new Set(apArtifacts.map(item => String(item.path || '').replace(/\\/g, '/').toLowerCase()));
    apWsFiles = (wsData.files || []).filter(file => !attributedPaths.has(String(file.path || '').replace(/\\/g, '/').toLowerCase()));
    artifactsSessionName.textContent = chatData.session ? `${chatData.session.name} · ${chatData.session.id}` : '未选择对话';
    artifactsBtnCount.textContent = apArtifacts.length > 99 ? '99+' : String(apArtifacts.length);
    artifactsBtnCount.classList.toggle('hidden', apArtifacts.length === 0);
    const currentBelongsToTab = apCurrentArtifact && (
      (apActiveTab === 'chat' && apCurrentArtifact.source === 'chat')
      || (apActiveTab === 'workspace' && apCurrentArtifact.source === 'workspace')
    );
    if (!currentBelongsToTab) resetArtifactPreview(apActiveTab === 'chat' ? '本次对话暂无文件' : '工作区暂无未归属文件');
    renderArtifactList();
    // 默认选中第一项
    if (!currentBelongsToTab) {
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
          <div class="artifact-item-meta">${esc(a.taskTitle ? `任务：${a.taskTitle}` : a.agent || '对话输出')} · ${apRelativeTime(a.createdAt)}</div>
        </div>
        <span class="artifact-item-badge">${esc(a.type)}</span>
      </div>
    `).join('');
    artifactsList.querySelectorAll('.artifact-item[data-source=chat]').forEach(el => {
      el.onclick = () => selectArtifact(apArtifacts[+el.dataset.idx]);
    });
  } else {
    if (!apWsFiles.length) {
      artifactsList.innerHTML = '<div class="artifacts-empty">工作区暂无近期文件。这里仅展示尚未能归属到当前会话的文件。</div>';
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
