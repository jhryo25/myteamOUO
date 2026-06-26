// Session 持久化服务 — 从内存 + SQLite/JSON 读写会话数据
import { randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import { repository } from '../../storage.mjs';
import { transitionSessionRunState } from '../../collaboration-context.mjs';

const MEMORY_FILE = '.myteam/memory.json';
const DEFAULT_SESSION_NAME = '默认对话';
const DEFAULT_DRAFT_SESSION_NAME = '新对话';
const TRASH_RETENTION_MS = 5 * 60 * 1000;

let sessions = [];
let activeSessionId = null;
let trashedSessions = [];

export function newSession(name, { ephemeral = false } = {}) {
  return {
    id: randomUUID().slice(0, 8),
    name: name || DEFAULT_DRAFT_SESSION_NAME,
    created_at: new Date().toISOString(),
    history: [],
    continuity: null,
    mode: null,
    run_state: { status: 'idle', updatedAt: Date.now() },
    ephemeral,
  };
}

export function getSession(id) {
  return sessions.find(s => s.id === id) || null;
}

export function getActiveSession() {
  return getSession(activeSessionId) || sessions[0];
}

export function getActiveSessionId() { return activeSessionId; }
export function getAllSessions() { return sessions; }
export function getTrashedSessions() { return trashedSessions; }

export function setSessionRunState(session, status, patch = {}) {
  if (!session) return null;
  session.run_state = transitionSessionRunState(session.run_state, status, patch);
  saveSessions();
  return session.run_state;
}

export function publicSessionRunState(state) {
  if (!state) return { status: 'idle' };
  const { input, error, ...safe } = state;
  return safe;
}

export function recordSessionMode(session, mode) {
  if (!session) return;
  if (!session.mode) session.mode = mode;
  else if (session.mode !== mode) session.mode = 'mixed';
}

function isAutoSessionName(name) {
  const text = String(name || '').trim();
  return !text || text === DEFAULT_SESSION_NAME || text === DEFAULT_DRAFT_SESSION_NAME || /^对话\s*\d+$/.test(text);
}

function summarizeSessionTitle(text) {
  const clean = String(text || '')
    .replace(/(?:^|\n)\s*@(claude|codex|kimi)\b/gi, '')
    .replace(/\s+/g, ' ').replace(/^[，。！？,.!?;；：:\s]+|[，。！？,.!?;；：:\s]+$/g, '').trim();
  const firstSentence = clean.split(/[。！？!?；;\n]/)[0]?.trim() || clean;
  if (!firstSentence) return DEFAULT_DRAFT_SESSION_NAME;
  return firstSentence.length > 22 ? `${firstSentence.slice(0, 22)}...` : firstSentence;
}

export function maybeAutoRenameSession(session, message) {
  if (!session || session.history.length || !isAutoSessionName(session.name)) return;
  session.name = summarizeSessionTitle(message);
}

export function loadSessions() {
  const stored = repository.loadSessionState();
  if (stored.sessions.length) {
    sessions = stored.sessions.map(s => ({
      ...s,
      history: Array.isArray(s.history) ? s.history.slice(-40) : [],
      run_state: s.run_state || { status: 'idle', updatedAt: Date.now() },
    }));
    activeSessionId = stored.activeId && getSession(stored.activeId) ? stored.activeId : sessions[0].id;
    const now = Date.now();
    trashedSessions = stored.trashedSessions
      .filter(entry => now - Number(entry.deletedAt || 0) < TRASH_RETENTION_MS);
    return;
  }
  if (!existsSync(MEMORY_FILE)) {
    sessions = [newSession()];
    activeSessionId = sessions[0].id;
    return;
  }
  try {
    const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf8'));
    if (Array.isArray(data)) {
      const s = newSession(); s.history = data.slice(-40);
      sessions = [s]; activeSessionId = s.id;
      return;
    }
    if (Array.isArray(data.sessions) && data.sessions.length) {
      sessions = data.sessions.map(s => ({
        id: s.id || randomUUID().slice(0, 8),
        name: s.name || DEFAULT_SESSION_NAME,
        created_at: s.created_at || new Date().toISOString(),
        history: Array.isArray(s.history) ? s.history.slice(-40) : [],
        continuity: s.continuity && typeof s.continuity === 'object' ? s.continuity : null,
        mode: s.mode || null,
        run_state: s.run_state || { status: 'idle', updatedAt: Date.now() },
      }));
      activeSessionId = data.activeId && getSession(data.activeId) ? data.activeId : sessions[0].id;
      if (Array.isArray(data.trashedSessions)) {
        const now = Date.now();
        trashedSessions = data.trashedSessions
          .filter(t => now - t.deletedAt < TRASH_RETENTION_MS)
          .map(t => ({ session: t.session, deletedAt: t.deletedAt }));
      }
      return;
    }
  } catch (err) { /* fallback */ }
  sessions = [newSession()];
  activeSessionId = sessions[0].id;
}

export function saveSessions() {
  const data = { sessions, activeId: activeSessionId, trashedSessions };
  repository.saveSessionState(data);
}

export function switchActiveSession(sessionId) {
  const target = getSession(sessionId);
  if (!target) return false;
  activeSessionId = target.id;
  saveSessions();
  return true;
}

export function createAndSwitchSession(name) {
  sessions = sessions.filter(s => !s.ephemeral);
  const s = newSession((name || '').trim());
  sessions.push(s);
  activeSessionId = s.id;
  saveSessions();
  return s;
}

// 允许外部替换 session 列表（批量操作）
export function setSessions(newSessions) { sessions = newSessions; }
export function setActiveSessionId(id) { activeSessionId = id; }
export function setTrashedSessions(newTrash) { trashedSessions = newTrash; }

export { sessions, activeSessionId, trashedSessions };
