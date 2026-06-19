import { createHash, randomUUID } from 'node:crypto';
import { repository } from './storage.mjs';

const REDACT_KEYS = /token|secret|password|api[-_]?key|authorization|cookie|env/i;
const APPROVAL_TTL_MS = 15 * 60 * 1000;

export const RISK_POLICY = Object.freeze({
  'shell.execute': 'high',
  'skill.install': 'high',
  'skill.delete': 'high',
  'network.fetch': 'medium',
  'config.write': 'high',
  'agent.dispatch': 'medium',
  'schedule.run': 'medium',
});

export function redactSensitive(value, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactSensitive(item, depth + 1));
  if (!value || typeof value !== 'object') {
    const text = String(value ?? '');
    return text.length > 500 ? `${text.slice(0, 500)}…` : value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    REDACT_KEYS.test(key) ? '[redacted]' : redactSensitive(item, depth + 1),
  ]));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function operationFingerprint(type, payload) {
  return createHash('sha256')
    .update(JSON.stringify({ type, payload: stable(payload) }))
    .digest('hex');
}

export function appendAudit(event) {
  return repository.append('audit_events', {
    id: event.id || randomUUID(),
    actor: event.actor || 'local-user',
    operation: event.operation || 'unknown',
    risk: event.risk || RISK_POLICY[event.operation] || 'low',
    decision: event.decision || '',
    result: event.result || '',
    approvalId: event.approvalId || null,
    sessionId: event.sessionId || null,
    details: redactSensitive(event.details || {}),
    timestamp: event.timestamp || new Date().toISOString(),
  });
}

export function requestApproval({ operation, payload = {}, sessionId = '', actor = 'local-user' }) {
  const now = Date.now();
  const fingerprint = operationFingerprint(operation, payload);
  const approval = repository.append('approvals', {
    id: randomUUID(),
    operation,
    risk: RISK_POLICY[operation] || 'medium',
    fingerprint,
    payload: redactSensitive(payload),
    sessionId: sessionId || null,
    actor,
    status: 'pending',
    scope: 'once',
    requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + APPROVAL_TTL_MS).toISOString(),
  });
  appendAudit({
    operation,
    risk: approval.risk,
    decision: 'requested',
    result: 'pending',
    approvalId: approval.id,
    sessionId,
    details: payload,
  });
  return approval;
}

function expireApproval(approval) {
  if (approval && ['pending', 'approved'].includes(approval.status) && Date.parse(approval.expiresAt) <= Date.now()) {
    const expired = { ...approval, status: 'expired', decidedAt: new Date().toISOString() };
    repository.upsert('approvals', expired);
    appendAudit({
      operation: approval.operation,
      risk: approval.risk,
      decision: 'expired',
      result: 'blocked',
      approvalId: approval.id,
      sessionId: approval.sessionId,
    });
    return expired;
  }
  return approval;
}

export function listApprovals({ status = '', limit = 100 } = {}) {
  const approvals = repository.list('approvals', { newestFirst: true, limit })
    .map(expireApproval);
  return status ? approvals.filter((item) => item.status === status) : approvals;
}

export function decideApproval(id, decision, actor = 'local-user') {
  const current = expireApproval(repository.get('approvals', id));
  if (!current) throw new Error('approval not found');
  if (current.status !== 'pending') throw new Error(`approval is ${current.status}`);
  if (!['approve_once', 'approve_session', 'deny'].includes(decision)) throw new Error('invalid decision');
  const approved = decision !== 'deny';
  const next = {
    ...current,
    status: approved ? 'approved' : 'denied',
    scope: decision === 'approve_session' ? 'session' : 'once',
    actor,
    decidedAt: new Date().toISOString(),
  };
  repository.upsert('approvals', next);
  appendAudit({
    operation: next.operation,
    risk: next.risk,
    decision,
    result: approved ? 'approved' : 'denied',
    approvalId: next.id,
    sessionId: next.sessionId,
  });
  return next;
}

export function authorizeOperation({ operation, payload = {}, sessionId = '', approvalId = '' }) {
  const fingerprint = operationFingerprint(operation, payload);
  if (approvalId) {
    const approval = expireApproval(repository.get('approvals', approvalId));
    if (!approval) return { ok: false, error: 'approval not found' };
    if (approval.status !== 'approved') return { ok: false, error: `approval is ${approval.status}` };
    if (approval.operation !== operation || approval.fingerprint !== fingerprint) {
      appendAudit({ operation, decision: 'fingerprint_mismatch', result: 'blocked', approvalId, sessionId });
      return { ok: false, error: 'approval does not match this operation' };
    }
    if (approval.scope === 'session' && approval.sessionId !== (sessionId || null)) {
      return { ok: false, error: 'session approval does not match this session' };
    }
    if (approval.scope === 'once') {
      repository.upsert('approvals', { ...approval, status: 'consumed', consumedAt: new Date().toISOString() });
    }
    appendAudit({ operation, decision: 'authorized', result: 'allowed', approvalId, sessionId, details: payload });
    return { ok: true, approval };
  }
  return { ok: false, approval: requestApproval({ operation, payload, sessionId }) };
}

export function approvalResponse(res, authorization) {
  const status = authorization.approval ? 202 : 403;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(authorization.approval
    ? { ok: false, approvalRequired: true, approval: authorization.approval }
    : { ok: false, error: authorization.error || 'operation not authorized' }));
}

export function listAudit({ limit = 200 } = {}) {
  return repository.list('audit_events', { newestFirst: true, limit });
}
