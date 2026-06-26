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
