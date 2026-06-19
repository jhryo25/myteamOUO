import { createHash, randomUUID } from 'node:crypto';
import { repository } from './storage.mjs';

const REDACT_KEYS = /token|secret|password|api[-_]?key|authorization|cookie|env/i;
const APPROVAL_TTL_MS = 15 * 60 * 1000;

export const OPERATION_POLICIES = Object.freeze({
  'shell.execute': {
    risk: 'high',
    title: '执行本地命令',
    reason: '该操作会在你的电脑上启动 shell 命令，可能修改文件、进程或系统状态。',
    effects: ['运行用户提交的命令', '读取命令输出与错误信息'],
  },
  'skill.install': {
    risk: 'high',
    title: '安装 Skill',
    reason: 'Skill 会被写入本地并可能在后续 Agent 任务中加载。',
    effects: ['下载或读取 Skill 内容', '写入 .myteam/skills 目录'],
  },
  'skill.delete': {
    risk: 'high',
    title: '卸载 Skill',
    reason: '该操作会删除本地已安装的 Skill 文件和配置。',
    effects: ['删除 Skill 目录', '移除对应启用状态'],
  },
  'network.fetch': {
    risk: 'medium',
    title: '访问远程资源',
    reason: '该操作会向外部地址发起网络请求。',
    effects: ['向目标地址发送请求', '读取远程响应内容'],
  },
  'config.write': {
    risk: 'high',
    title: '修改本地配置',
    reason: '该操作会改变 Agent、工作区或运行配置。',
    effects: ['写入本地配置', '影响后续 Agent 启动方式'],
  },
  'agent.dispatch': {
    risk: 'medium',
    title: '执行 pending 任务',
    reason: '这会启动本机 Agent CLI 执行任务。Agent 可能根据任务内容读写工作区、运行命令或访问网络。',
    effects: [
      '启动本机已配置的 Agent CLI',
      '向 Agent 提供任务目标和当前工作区上下文',
      '实际文件、命令和网络行为取决于任务内容及 CLI 自身权限',
    ],
  },
  'schedule.run': {
    risk: 'medium',
    title: '运行定时任务',
    reason: '这会启动 Agent 执行已保存的定时目标。',
    effects: ['启动本机 Agent CLI', '在会话中保存运行结果'],
  },
});

export const RISK_POLICY = Object.freeze(Object.fromEntries(
  Object.entries(OPERATION_POLICIES).map(([operation, policy]) => [operation, policy.risk]),
));

export function getOperationPolicy(operation) {
  return OPERATION_POLICIES[operation] || {
    risk: 'medium',
    title: '执行敏感操作',
    reason: '该操作可能改变本地数据或运行状态。',
    effects: [],
  };
}

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
  const policy = getOperationPolicy(operation);
  const approval = repository.append('approvals', {
    id: randomUUID(),
    operation,
    risk: policy.risk,
    title: policy.title,
    reason: policy.reason,
    effects: policy.effects,
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
