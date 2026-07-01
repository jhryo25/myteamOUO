// Session API 路由 — GET/POST/DELETE /api/sessions, rename, trash, restore, history
// 从 server.mjs handle() 提取

export const TRASH_RETENTION_MS = 5 * 60 * 1000;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
  return true;
}

/**
 * 处理所有 session 相关路由。ctx 需提供:
 *   sessions, activeSessionId, trashedSessions,
 *   getSession, getActiveSession, getAllSessions,
 *   setSessions, setActiveSessionId, setTrashedSessions,
 *   newSession, saveSessions, publicSessionRunState,
 *   readBody(req)
 */
export async function tryServeSessions(req, res, { pathname, url, ctx }) {
  const {
    sessions, activeSessionId, trashedSessions,
    getSession, getActiveSession, getActiveSessionId, getAllSessions,
    setSessions, setActiveSessionId, setTrashedSessions,
    newSession, saveSessions, publicSessionRunState,
    readBody,
  } = ctx;

  // GET /api/sessions — 返回所有 session 列表 + 当前激活
  if (req.method === 'GET' && pathname === '/api/sessions') {
    return json(res, 200, {
      activeId: getActiveSessionId(),
      sessions: sessions.filter(s => !s.ephemeral).map(s => ({
        id: s.id, name: s.name, created_at: s.created_at,
        mode: s.mode || null, message_count: s.history.length,
        run_state: publicSessionRunState(s.run_state),
      })),
    });
  }

  // POST /api/sessions { name?, activeId? }
  if (req.method === 'POST' && pathname === '/api/sessions') {
    const body = await readBody(req);
    if (body.activeId) {
      const target = getSession(body.activeId);
      if (!target) return json(res, 404, { error: 'session 不存在' });
      setActiveSessionId(target.id);
      saveSessions();
      return json(res, 200, { ok: true, activeId: getActiveSessionId() });
    }
    setSessions(getAllSessions().filter(existing => !existing.ephemeral));
    const s = newSession((body.name || '').trim());
    getAllSessions().push(s);
    setActiveSessionId(s.id);
    saveSessions();
    return json(res, 200, { ok: true, session: s, activeId: getActiveSessionId() });
  }

  // POST /api/sessions/:id/rename
  if (req.method === 'POST' && /^\/api\/sessions\/[^/]+\/rename$/.test(pathname)) {
    const id = pathname.split('/')[3];
    const s = sessions.find(s => s.id === id);
    if (!s) return json(res, 404, { error: 'session 不存在' });
    const body = await readBody(req);
    const name = (body.name || '').trim();
    if (!name) return json(res, 400, { error: 'name 不能为空' });
    s.name = name;
    saveSessions();
    return json(res, 200, { ok: true, session: s });
  }

  // DELETE /api/sessions?id=xxx
  if (req.method === 'DELETE' && pathname === '/api/sessions') {
    const id = url.searchParams.get('id');
    const idx = sessions.findIndex(s => s.id === id);
    if (idx < 0) return json(res, 404, { error: 'session 不存在' });
    const deleted = sessions.splice(idx, 1)[0];
    trashedSessions.push({ session: deleted, deletedAt: Date.now() });
    let replacementId = '';
    if (!sessions.length) {
      const replacement = newSession('', { ephemeral: true });
      sessions.push(replacement);
      replacementId = replacement.id;
    }
    if (activeSessionId === id) setActiveSessionId(getAllSessions()[0].id);
    saveSessions();
    return json(res, 200, { ok: true, activeId: getActiveSessionId(), trashed: deleted.id, replacementId });
  }

  // GET /api/sessions/trash
  if (req.method === 'GET' && pathname === '/api/sessions/trash') {
    const now = Date.now();
    const fresh = trashedSessions.filter(t => now - t.deletedAt < TRASH_RETENTION_MS);
    setTrashedSessions(fresh);
    saveSessions();
    const list = fresh.map(t => ({
      id: t.session.id, name: t.session.name,
      deletedAt: t.deletedAt, expiresAt: t.deletedAt + TRASH_RETENTION_MS,
    }));
    return json(res, 200, { trash: list });
  }

  // POST /api/sessions/restore
  if (req.method === 'POST' && pathname === '/api/sessions/restore') {
    const body = await readBody(req);
    const id = body.id;
    const idx = trashedSessions.findIndex(t => t.session.id === id);
    if (idx < 0) return json(res, 404, { error: '回收站中不存在该 session' });
    const restored = trashedSessions.splice(idx, 1)[0].session;
    setSessions(getAllSessions().filter(existing => !existing.ephemeral));
    getAllSessions().push(restored);
    setActiveSessionId(restored.id);
    saveSessions();
    return json(res, 200, { ok: true, session: restored, activeId: getActiveSessionId() });
  }

  // GET /api/history?sessionId=xxx
  if (req.method === 'GET' && pathname === '/api/history') {
    const sid = url.searchParams.get('sessionId') || activeSessionId;
    const s = getSession(sid) || getActiveSession();
    const allHistory = s?.history || [];
    const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '40', 10);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 40, 1), 100);
    const requestedBefore = Number.parseInt(url.searchParams.get('before') || String(allHistory.length), 10);
    const before = Math.min(Math.max(Number.isFinite(requestedBefore) ? requestedBefore : allHistory.length, 0), allHistory.length);
    const start = Math.max(0, before - limit);
    const history = allHistory.slice(start, before);
    return json(res, 200, {
      sessionId: s?.id, history,
      page: { start, end: before, limit, total: allHistory.length, hasMore: start > 0, nextBefore: start > 0 ? start : null },
    });
  }

  return false; // 未匹配
}
