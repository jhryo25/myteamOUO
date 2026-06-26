// A2A chain task store — 多 Agent 链式任务的消息与 shell 执行器
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { repository } from '../../storage.mjs';
import { appendAudit } from '../../governance.mjs';

// chain task 消息缓存 (内存 + SQlite 双写)
export const chainTaskMessages = new Map();
export const chainTaskSSE = new Map();

export function pushChainMessage(taskId, msg) {
  const fullMessage = { ...msg, timestamp: new Date().toISOString() };
  if (!chainTaskMessages.has(taskId)) chainTaskMessages.set(taskId, []);
  chainTaskMessages.get(taskId).push(fullMessage);
  // 双写 SQLite：服务重启后消息不丢失
  try {
    repository.insertChainMessage({
      id: `${taskId}:${chainTaskMessages.get(taskId).length}:${randomUUID().slice(0, 6)}`,
      taskId,
      sessionId: '',
      role: msg.role || (msg.type || 'system'),
      content: JSON.stringify(msg),
      agentKey: msg.agent || null,
    });
  } catch (e) {
    // 静默失败：内存缓存仍保留，不影响执行
  }
  const listeners = chainTaskSSE.get(taskId);
  if (listeners) {
    const sseData = 'data: ' + JSON.stringify(msg) + '\n\n';
    for (const res of listeners) {
      try { res.write(sseData); } catch {}
    }
  }
}

export function getChainMessages(taskId) {
  // 先从 SQLite 查询（含服务重启恢复的消息），再合并内存中的热缓存
  const memory = chainTaskMessages.get(taskId) || [];
  try {
    const persisted = repository.listChainMessages(taskId);
    return persisted.map((row) => {
      try { return JSON.parse(row.content); } catch { return { type: row.role, content: row.content, timestamp: row.createdAt }; }
    });
  } catch (e) {
    return memory.length ? memory : [];
  }
}

// Shell 执行器
export const shellResults = new Map();

export function executeShell(command, runId, context = {}) {
  shellResults.set(runId, { stdout: '', stderr: '', exitCode: null, done: false, startedAt: new Date().toISOString() });
  const isWin = process.platform === 'win32';
  const child = spawn(isWin ? 'powershell' : 'sh', [isWin ? '-Command' : '-c', command], {
    stdio: 'pipe',
    cwd: process.cwd(),
    timeout: 30000,
    windowsHide: true,
  });
  child.stdout.on('data', (d) => {
    const text = d.toString();
    const cur = shellResults.get(runId);
    if (cur) { cur.stdout += text; shellResults.set(runId, cur); }
  });
  child.stderr.on('data', (d) => {
    const text = d.toString();
    const cur = shellResults.get(runId);
    if (cur) { cur.stderr += text; shellResults.set(runId, cur); }
  });
  child.on('close', (code) => {
    const cur = shellResults.get(runId);
    if (cur) { cur.exitCode = code; cur.done = true; cur.finishedAt = new Date().toISOString(); shellResults.set(runId, cur); }
    appendAudit({ operation: 'shell.execute', decision: context.approvalId ? 'authorized' : 'safe_policy', result: code === 0 ? 'succeeded' : 'failed', approvalId: context.approvalId, sessionId: context.sessionId, details: { command, runId, exitCode: code } });
  });
  child.on('error', (err) => {
    const cur = shellResults.get(runId);
    if (cur) { cur.stderr += err.message; cur.exitCode = -1; cur.done = true; cur.finishedAt = new Date().toISOString(); shellResults.set(runId, cur); }
    appendAudit({ operation: 'shell.execute', decision: context.approvalId ? 'authorized' : 'safe_policy', result: 'failed', approvalId: context.approvalId, sessionId: context.sessionId, details: { command, runId, error: err.message } });
  });
}
