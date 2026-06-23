import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

export const DEFAULT_LANGGRAPH_DB = '.myteam/langgraph.sqlite';

let sharedCheckpointer = null;
let sharedPath = '';

export function createSqliteCheckpointer(file = process.env.MYTEAM_LANGGRAPH_DB || DEFAULT_LANGGRAPH_DB) {
  const target = resolve(file);
  mkdirSync(dirname(target), { recursive: true });
  return SqliteSaver.fromConnString(target);
}

export function getSharedCheckpointer(file = process.env.MYTEAM_LANGGRAPH_DB || DEFAULT_LANGGRAPH_DB) {
  const target = resolve(file);
  if (!sharedCheckpointer || sharedPath !== target) {
    sharedCheckpointer?.db?.close?.();
    sharedCheckpointer = createSqliteCheckpointer(target);
    sharedPath = target;
  }
  return sharedCheckpointer;
}

export function closeSharedCheckpointer() {
  sharedCheckpointer?.db?.close?.();
  sharedCheckpointer = null;
  sharedPath = '';
}

/**
 * 从持久化的 adapter descriptor 重建 LangGraph ports。
 *
 * descriptor: { workflowRunId, sessionId, agentKeys, taskScope, approvalFingerprint, options }
 * callbacks: {
 *   executeTask(task, ctx) => Promise<executionResult>,
 *   reviewTask(task, execution, ctx) => Promise<reviewOutcome>,
 *   transitionTask(task, nextState, meta) => Promise<updatedTask>,
 *   materializeSpawns(parent, requests, ctx) => Promise<Array<task>>,
 *   applyClarification(task, answer, ctx) => Promise<updatedTask>,
 *   emit(event, data) => void,
 *   onWorkflowComplete(summary, state) => Promise<void>,
 * }
 * cliConfig: reconstructed CLI config (agent key -> { path, ... })
 *
 * 返回 ports 对象，可直接传入 LangGraphDispatchEngine。
 */
export function reconstructPorts(descriptor, callbacks, cliConfig) {
  const agentKeys = Array.isArray(descriptor.agentKeys) ? descriptor.agentKeys : [];
  const availableAgents = agentKeys.filter((key) => cliConfig?.[key]?.path);

  return {
    emit: callbacks.emit || (() => {}),
    executeTask: (task, ctx) => {
      if (typeof callbacks.executeTask !== 'function') {
        throw new Error('executeTask callback is required');
      }
      return callbacks.executeTask(task, {
        ...ctx,
        descriptor,
        availableAgents,
      });
    },
    reviewTask: (task, execution, ctx) => {
      if (typeof callbacks.reviewTask !== 'function') {
        throw new Error('reviewTask callback is required');
      }
      return callbacks.reviewTask(task, execution, {
        ...ctx,
        descriptor,
        availableAgents,
      });
    },
    transitionTask: (task, nextState, meta) => {
      if (typeof callbacks.transitionTask !== 'function') {
        throw new Error('transitionTask callback is required');
      }
      return callbacks.transitionTask(task, nextState, meta);
    },
    materializeSpawns: (parent, requests, ctx) => {
      if (typeof callbacks.materializeSpawns === 'function') {
        return callbacks.materializeSpawns(parent, requests, {
          ...ctx,
          descriptor,
        });
      }
      return [];
    },
    applyClarification: (task, answer, ctx) => {
      if (typeof callbacks.applyClarification === 'function') {
        return callbacks.applyClarification(task, answer, {
          ...ctx,
          descriptor,
        });
      }
      return task;
    },
    onWorkflowComplete: (summary, state) => {
      if (typeof callbacks.onWorkflowComplete === 'function') {
        return callbacks.onWorkflowComplete(summary, state);
      }
    },
  };
}
