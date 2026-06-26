// HTML 转义 & 通用工具函数
// 从 web/app.js 提取

export function esc(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function formatTime(ts = Date.now()) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function showToast(message, tone = 'info', duration = 3200) {
  const existing = document.querySelector('.myteam-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = `myteam-toast toast-${tone}`;
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, duration);
}
