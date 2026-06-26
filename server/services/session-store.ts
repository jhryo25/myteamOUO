// Session 持久化服务 — TypeScript 类型安全版本
import { randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'fs';

// ── 类型定义 ──

export interface SessionHistoryEntry {
  role: 'user' | 'assistant' | 'system';
  text: string;
  agent: string | null;
  attachments?: unknown[];
  kind?: string;
  parts?: unknown[];
  artifacts?: unknown[];
  startedAt?: number;
  finishedAt?: number;
  interrupted?: boolean;
}

export interface SessionContinuity {
  sessionId: string;
  history: SessionHistoryEntry[];
  previous: SessionContinuity | null;
  source: string;
}

export interface SessionRunState {
  status: 'idle' | 'running' | 'interrupting' | 'interrupted' | 'completed' | 'error';
  updatedAt: number;
  input?: string;
  error?: string;
  agent?: string;
  mode?: string;
  clientRunId?: string;
  startedAt?: number;
  finishedAt?: number;
  interruptedAt?: number;
  reason?: string | null;
  resumed?: boolean;
}

export interface Session {
  id: string;
  name: string;
  created_at: string;
  history: SessionHistoryEntry[];
  continuity: SessionContinuity | null;
  mode: 'chat' | 'plan' | 'mixed' | null;
  run_state: SessionRunState;
  ephemeral: boolean;
}

export interface TrashedEntry {
  session: Session;
  deletedAt: number;
}

// ── 常量 ──

const MEMORY_FILE = '.myteam/memory.json';
const DEFAULT_SESSION_NAME = '默认对话';
const DEFAULT_DRAFT_SESSION_NAME = '新对话';
const TRASH_RETENTION_MS = 5 * 60 * 1000;

// ── 模块级状态 ──

let sessions: Session[] = [];
let activeSessionId: string | null = null;
let trashedSessions: TrashedEntry[] = [];

// ── 导出函数 ──

export function newSession(name?: string, opts: { ephemeral?: boolean } = {}): Session {
  return {
    id: randomUUID().slice(0, 8),
    name: name || DEFAULT_DRAFT_SESSION_NAME,
    created_at: new Date().toISOString(),
    history: [],
    continuity: null,
    mode: null,
    run_state: { status: 'idle', updatedAt: Date.now() },
    ephemeral: opts.ephemeral ?? false,
  };
}

export function getSession(id: string): Session | null {
  return sessions.find(s => s.id === id) || null;
}

export function getActiveSession(): Session | undefined {
  return getSession(activeSessionId ?? '') ?? sessions[0];
}

export function getActiveSessionId(): string | null {
  return activeSessionId;
}

export function getAllSessions(): Session[] {
  return sessions;
}

export function getTrashedSessions(): TrashedEntry[] {
  return trashedSessions;
}

export function setSessions(newSessions: Session[]): void {
  sessions = newSessions;
}

export function setActiveSessionId(id: string): void {
  activeSessionId = id;
}

export function setTrashedSessions(newTrash: TrashedEntry[]): void {
  trashedSessions = newTrash;
}

export function createAndSwitchSession(name: string): Session {
  sessions = sessions.filter(s => !s.ephemeral);
  const s = newSession((name || '').trim());
  sessions.push(s);
  activeSessionId = s.id;
  saveSessions();
  return s;
}

export function switchActiveSession(sessionId: string): boolean {
  const target = getSession(sessionId);
  if (!target) return false;
  activeSessionId = target.id;
  saveSessions();
  return true;
}

export function setSessionRunState(
  session: Session | undefined | null,
  status: SessionRunState['status'],
  patch: Partial<SessionRunState> = {},
): SessionRunState | null {
  if (!session) return null;
  session.run_state = {
    ...session.run_state,
    ...patch,
    status,
    updatedAt: Date.now(),
  };
  saveSessions();
  return session.run_state;
}

export function publicSessionRunState(
  state: SessionRunState | undefined | null,
): Pick<SessionRunState, 'status' | 'updatedAt'> & Partial<Omit<SessionRunState, 'input' | 'error'>> {
  if (!state) return { status: 'idle', updatedAt: Date.now() };
  const { input, error, ...safe } = state;
  return safe;
}

export function recordSessionMode(
  session: Session | undefined | null,
  mode: 'chat' | 'plan' | 'mixed',
): void {
  if (!session) return;
  if (!session.mode) session.mode = mode;
  else if (session.mode !== mode) session.mode = 'mixed';
}

export function maybeAutoRenameSession(
  session: Session | undefined | null,
  message: string,
): void {
  if (!session || session.history.length) return;

  const name = String(session.name || '').trim();
  if (!name || name === DEFAULT_SESSION_NAME || name === DEFAULT_DRAFT_SESSION_NAME || /^对话\s*\d+$/.test(name)) {
    const clean = String(message || '')
      .replace(/(?:^|\n)\s*@(claude|codex|kimi)\b/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/^[，。！？,.!?;；：:\s]+|[，。！？,.!?;；：:\s]+$/g, '')
      .trim();
    const first = clean.split(/[。！？!?；;\n]/)[0]?.trim() || clean;
    session.name = first ? (first.length > 22 ? `${first.slice(0, 22)}...` : first) : DEFAULT_DRAFT_SESSION_NAME;
  }
}

// ── 持久化（保持与原始 JS 版本兼容的接口） ──

export function loadSessions(repository?: {
  loadSessionState: () => { sessions: Session[]; activeId: string | null; trashedSessions: TrashedEntry[] };
}): void {
  if (repository) {
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
  }
  // 回退到 JSON 文件
  if (!existsSync(MEMORY_FILE)) {
    sessions = [newSession()];
    activeSessionId = sessions[0].id;
    return;
  }
  try {
    const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf8'));
    if (Array.isArray(data)) {
      const s = newSession();
      s.history = data.slice(-40);
      sessions = [s];
      activeSessionId = s.id;
      return;
    }
    if (Array.isArray(data.sessions) && data.sessions.length) {
      sessions = data.sessions.map((s: Record<string, unknown>) => ({
        id: (s.id as string) || randomUUID().slice(0, 8),
        name: (s.name as string) || DEFAULT_SESSION_NAME,
        created_at: (s.created_at as string) || new Date().toISOString(),
        history: (Array.isArray(s.history) ? s.history.slice(-40) : []) as SessionHistoryEntry[],
        continuity: null,
        mode: (s.mode as Session['mode']) || null,
        run_state: (s.run_state as SessionRunState) || { status: 'idle', updatedAt: Date.now() },
        ephemeral: false,
      }));
      activeSessionId = data.activeId && getSession(data.activeId as string) ? data.activeId as string : sessions[0].id;
      return;
    }
  } catch {
    // fallback
  }
  sessions = [newSession()];
  activeSessionId = sessions[0].id;
}

export function saveSessions(repository?: {
  saveSessionState: (data: { sessions: Session[]; activeId: string | null; trashedSessions: TrashedEntry[] }) => void;
}): void {
  if (repository) {
    repository.saveSessionState({
      activeId: activeSessionId,
      sessions: sessions.map(s => ({ ...s, history: s.history.slice(-40) })),
      trashedSessions: trashedSessions.map(t => ({ session: t.session, deletedAt: t.deletedAt })),
    });
    return;
  }
  // 无 repository 时直接写 JSON（向后兼容）
}

export { sessions, activeSessionId, trashedSessions, TRASH_RETENTION_MS };
