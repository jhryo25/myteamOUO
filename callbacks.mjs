// myteam callbacks — LangChain BaseCallbackHandler 实现
// 统一 invocation / audit / timing 日志，取代分散在 server.mjs 各处的
// appendInvocation() / appendAudit() / appendLesson() 调用。
//
// 用法（server.mjs）：
//   import { MyteamCallbackHandler, attachToEngine } from './callbacks.mjs';
//   const handler = new MyteamCallbackHandler({ sessionId, agentKey, mode });
//   // LangGraph 引擎内部节点开始/结束会自动触发 handler
//
// 同时也导出独立函数供非 LangChain 路径（如 CLI dispatch）直接调用。

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { repository } from './storage.mjs';
import { randomUUID } from 'node:crypto';

// ── 轻量请求级 trace ID ───────────────────────────────────────
export function createTraceId(prefix = 'myteam') {
  return `${prefix}:${randomUUID().slice(0, 12)}:${Date.now()}`;
}

// ── Invocation 记录 ───────────────────────────────────────────
export function recordInvocation({
  id, agent, label, sessionId, clientRunId, mode, taskId, runId,
  startedAt, finishedAt, status, outputChars, thinkingChars, toolCalls, error,
}) {
  try {
    repository.append('invocations', {
      id: id || createTraceId('inv'),
      agent: String(agent || ''),
      label: String(label || ''),
      session_id: String(sessionId || ''),
      client_run_id: String(clientRunId || ''),
      mode: String(mode || ''),
      task_id: taskId || null,
      run_id: runId || null,
      started_at: startedAt || new Date().toISOString(),
      finished_at: finishedAt || null,
      status: String(status || 'pending'),
      output_chars: Number(outputChars || 0),
      thinking_chars: Number(thinkingChars || 0),
      tool_calls: Number(toolCalls || 0),
      error: error || null,
    });
  } catch (err) {
    console.error('[myteam] Failed to record invocation:', err.message);
  }
}

// ── Audit 记录 ────────────────────────────────────────────────
export function recordAudit({ operation, decision, result, approvalId, sessionId, details }) {
  try {
    const id = `audit:${randomUUID().slice(0, 8)}`;
    repository.append('audit_events', {
      id,
      operation: String(operation || ''),
      decision: String(decision || ''),
      result: String(result || ''),
      approval_id: approvalId || null,
      session_id: String(sessionId || ''),
      details: details || {},
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[myteam] Failed to record audit:', err.message);
  }
}

// ── Lesson 记录 ───────────────────────────────────────────────
export function recordLesson(task, error) {
  try {
    const errMsg = String(error?.message || error || '');
    let pattern = 'unknown';
    if (/missing path|未配置/i.test(errMsg)) pattern = 'agent-not-configured';
    else if (/exit code/i.test(errMsg)) pattern = 'cli-exit-error';
    else if (/timeout/i.test(errMsg)) pattern = 'timeout';
    else if (/429|rate.limit/i.test(errMsg)) pattern = 'rate-limited';
    else if (/parse|无法解[析释]|不是有效的 JSON/i.test(errMsg)) pattern = 'parse-failure';

    repository.append('lessons', {
      id: `lesson:${randomUUID().slice(0, 8)}`,
      session_id: task?.session_id || '',
      run_id: task?.run_id || '',
      task_id: task?.id || '',
      error: errMsg.slice(0, 500),
      pattern,
      timestamp: new Date().toISOString(),
      source_task_snapshot: {
        id: task?.id,
        title: task?.title,
        goal: task?.goal,
        accept: task?.accept,
        steps: task?.steps || [],
        agent: task?.agent,
        session_id: task?.session_id || '',
        run_id: task?.run_id || '',
        status: task?.status,
        result: task?.result || null,
      },
    });
  } catch (err) {
    console.error('[myteam] Failed to record lesson:', err.message);
  }
}

// ── Timing 辅助 ───────────────────────────────────────────────
export class TimingContext {
  constructor(label = '') {
    this.label = label;
    this.startedAt = 0;
    this.finishedAt = 0;
    this.elapsedMs = 0;
  }

  start() {
    this.startedAt = performance.now();
    return this;
  }

  stop() {
    this.finishedAt = performance.now();
    this.elapsedMs = Math.round(this.finishedAt - this.startedAt);
    return this;
  }

  get summary() {
    return `${this.label}: ${this.elapsedMs}ms`;
  }
}

// ── LangChain CallbackHandler ─────────────────────────────────
export class MyteamCallbackHandler extends BaseCallbackHandler {
  constructor({ sessionId = '', agentKey = '', mode = '', taskId = null } = {}) {
    super();
    this.sessionId = sessionId;
    this.agentKey = agentKey;
    this.mode = mode;
    this.taskId = taskId;
    this.timers = new Map();
    this.toolCallCount = 0;
    this.name = 'myteam_callback_handler';
  }

  async handleLLMStart(_llm, _prompts, runId, _parentRunId, _extraParams, _tags, _metadata, _name) {
    const timer = new TimingContext(`llm:${runId}`).start();
    this.timers.set(runId, timer);
    console.warn(`[myteam:cb] LLM start: ${this.mode} agent=${this.agentKey}`);
  }

  async handleLLMEnd(_output, runId, _parentRunId, _tags) {
    const timer = this.timers.get(runId);
    if (timer) {
      timer.stop();
      console.warn(`[myteam:cb] LLM end: ${timer.summary}`);
      this.timers.delete(runId);
    }
  }

  async handleLLMError(_err, runId, _parentRunId, _tags) {
    const timer = this.timers.get(runId);
    if (timer) {
      timer.stop();
      console.warn(`[myteam:cb] LLM error after ${timer.elapsedMs}ms: ${_err.message}`);
      this.timers.delete(runId);
    }
  }

  async handleChainStart(_chain, _inputs, runId, _parentRunId, _tags, _metadata, _name) {
    const timer = new TimingContext(`chain:${runId}`).start();
    this.timers.set(runId, timer);
    console.warn(`[myteam:cb] Chain start: ${_chain.name || _name || _chain.constructor?.name} mode=${this.mode}`);
  }

  async handleChainEnd(_outputs, runId, _parentRunId, _tags) {
    const timer = this.timers.get(runId);
    if (timer) {
      timer.stop();
      console.warn(`[myteam:cb] Chain end: ${timer.summary}`);
      this.timers.delete(runId);
    }
  }

  async handleChainError(_err, runId, _parentRunId, _tags) {
    const timer = this.timers.get(runId);
    if (timer) {
      timer.stop();
      console.warn(`[myteam:cb] Chain error after ${timer.elapsedMs}ms: ${_err.message}`);
      this.timers.delete(runId);
    }
  }

  async handleToolStart(_tool, _input, runId, _parentRunId, _tags, _metadata, _name) {
    this.toolCallCount += 1;
    const timer = new TimingContext(`tool:${runId}`).start();
    this.timers.set(runId, timer);
    console.warn(`[myteam:cb] Tool start: ${_tool.name || _name || 'unknown'} (count=${this.toolCallCount})`);
  }

  async handleToolEnd(_output, runId, _parentRunId, _tags) {
    const timer = this.timers.get(runId);
    if (timer) {
      timer.stop();
      console.warn(`[myteam:cb] Tool end: ${timer.summary}`);
      this.timers.delete(runId);
    }
  }

  async handleToolError(_err, runId, _parentRunId, _tags) {
    const timer = this.timers.get(runId);
    if (timer) {
      timer.stop();
      console.warn(`[myteam:cb] Tool error after ${timer.elapsedMs}ms: ${_err.message}`);
      this.timers.delete(runId);
    }
  }

  // 用于 server.mjs 现有的 finishInvocation 逻辑
  buildInvocationRecord(status, extra = {}) {
    return {
      agent: this.agentKey,
      label: this.mode,
      session_id: this.sessionId,
      mode: this.mode,
      task_id: this.taskId || null,
      status,
      tool_calls: this.toolCallCount,
      ...extra,
    };
  }
}

// ── 便捷工厂：注入到现有 server.mjs 调用路径 ──────────────────
export function createInvocationContext({ sessionId, agentKey, mode, taskId }) {
  return {
    invocationId: createTraceId(mode || 'inv'),
    startedAt: new Date().toISOString(),
    sessionId,
    agentKey,
    mode,
    taskId,
    outputChars: 0,
    thinkingChars: 0,
    toolCallCount: 0,
    finish(status, extra = {}) {
      recordInvocation({
        id: this.invocationId,
        agent: this.agentKey,
        label: this.mode,
        sessionId: this.sessionId,
        mode: this.mode,
        taskId: this.taskId || null,
        startedAt: this.startedAt,
        finishedAt: new Date().toISOString(),
        status: status || 'unknown',
        outputChars: this.outputChars,
        thinkingChars: this.thinkingChars,
        toolCalls: this.toolCallCount,
        ...extra,
      });
    },
  };
}
