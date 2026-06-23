/**
 * workflow cleanup module — TTL-based expiry for LangGraph checkpoints and adapter descriptors.
 *
 * 策略：
 *   - 已完成/已取消的 workflow：默认保留 30 天（环境变量 MYTEAM_WORKFLOW_TTL_DAYS）
 *   - 中断/错误的 workflow：保留 7 天（环境变量 MYTEAM_WORKFLOW_INTERRUPTED_TTL_DAYS）
 *   - **不删除** myteam.sqlite 中的业务 Task、Session、Approval 数据
 */

import { resolve } from 'node:path';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

const DEFAULT_TTL_DAYS = Number(process.env.MYTEAM_WORKFLOW_TTL_DAYS) || 30;
const DEFAULT_INTERRUPTED_TTL_DAYS = Number(process.env.MYTEAM_WORKFLOW_INTERRUPTED_TTL_DAYS) || 7;

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

/**
 * 执行一次清理：
 *   1. 列出所有 adapter 描述
 *   2. 按 TTL 过滤过期的
 *   3. 删除 LangGraph checkpoint（通过直接操作 SQLite）
 *   4. 删除 adapter 描述
 *   5. 保留业务数据不动
 *
 * @param {object} checkpointer - LangGraph SqliteSaver 实例，需要 support .db 属性
 * @param {object} storage - MyteamRepository 实例
 * @param {object} options - { completedTtlDays, interruptedTtlDays, dryRun }
 * @returns {{ deleted: number, skipped: number, errors: string[] }}
 */
export async function runWorkflowCleanup(checkpointer, storage, options = {}) {
  const completedTtlDays = Number(options.completedTtlDays ?? DEFAULT_TTL_DAYS);
  const interruptedTtlDays = Number(options.interruptedTtlDays ?? DEFAULT_INTERRUPTED_TTL_DAYS);
  const dryRun = Boolean(options.dryRun);

  const result = { deleted: 0, skipped: 0, errors: [] };

  // 列出所有 adapter
  const adapters = typeof storage.listWorkflowAdapters === 'function'
    ? storage.listWorkflowAdapters()
    : [];

  if (!adapters.length) return result;

  // 获取 LangGraph checkpoint 中存在的 thread_ids
  const db = checkpointer?.db;
  if (!db) {
    result.errors.push('checkpointer has no accessible .db handle');
    return result;
  }

  const thresholdCompleted = daysAgo(completedTtlDays);
  const thresholdInterrupted = daysAgo(interruptedTtlDays);

  for (const adapter of adapters) {
    try {
      const { workflowRunId, updatedAt } = adapter;

      // 判断状态：通过查询 checkpoint snapshot 判断
      let status = 'unknown';
      try {
        const snapshot = await checkpointer.get({
          configurable: { thread_id: String(workflowRunId) },
        });
        if (snapshot?.metadata?.source === 'loop') status = 'interrupted';
        else if (snapshot?.next && snapshot.next.length === 0) status = 'completed';
        else if (snapshot?.next && snapshot.next.length > 0) status = 'interrupted';
        else status = 'completed'; // state exists but no next — treat as completed
      } catch {
        // snapshot read failed — likely stale checkpoint
        status = 'orphaned';
      }

      // 决定是否过期
      let expired = false;
      if (status === 'completed' || status === 'orphaned') {
        expired = updatedAt < thresholdCompleted;
      } else if (status === 'interrupted') {
        expired = updatedAt < thresholdInterrupted;
      }
      // unknown 不自动清理，保守处理

      if (!expired) {
        result.skipped += 1;
        continue;
      }

      if (!dryRun) {
        // 删除 LangGraph checkpoint
        try {
          db.exec(`DELETE FROM checkpoint_blobs WHERE thread_id = ?`, [String(workflowRunId)]);
          db.exec(`DELETE FROM checkpoint_writes WHERE thread_id = ?`, [String(workflowRunId)]);
          db.exec(`DELETE FROM checkpoints WHERE thread_id = ?`, [String(workflowRunId)]);
        } catch (e) {
          result.errors.push(`checkpoint delete failed for ${workflowRunId}: ${e.message}`);
        }

        // 删除 adapter descriptor（业务数据不动）
        try {
          storage.deleteWorkflowAdapter(workflowRunId);
        } catch (e) {
          result.errors.push(`adapter delete failed for ${workflowRunId}: ${e.message}`);
        }
      }

      result.deleted += 1;
      console.warn(
        `[myteam:cleanup] ${dryRun ? '[dry-run] ' : ''}deleted workflow ${workflowRunId} (status=${status}, updated=${updatedAt})`
      );
    } catch (error) {
      result.errors.push(`cleanup error for ${adapter.workflowRunId}: ${error.message}`);
    }
  }

  // 清理 LangGraph checkpoint 中不再有对应 adapter 的 thread（孤儿 checkpoint）
  if (!dryRun) {
    try {
      db.exec(`
        DELETE FROM checkpoints WHERE thread_id NOT IN (
          SELECT DISTINCT workflow_run_id FROM workflow_adapters
        )
      `);
      db.exec(`
        DELETE FROM checkpoint_writes WHERE thread_id NOT IN (
          SELECT DISTINCT workflow_run_id FROM workflow_adapters
        )
      `);
      db.exec(`
        DELETE FROM checkpoint_blobs WHERE thread_id NOT IN (
          SELECT DISTINCT workflow_run_id FROM workflow_adapters
        )
      `);
    } catch (e) {
      result.errors.push(`orphan checkpoint cleanup failed: ${e.message}`);
    }
  }

  return result;
}

/**
 * 手动删除单个 workflow（checkpoint + adapter，不删业务数据）。
 * @param {string} workflowRunId
 * @param {object} checkpointer - LangGraph SqliteSaver 实例
 * @param {object} storage - MyteamRepository 实例
 * @returns {boolean} 是否成功删除
 */
export function deleteWorkflow(workflowRunId, checkpointer, storage) {
  let deleted = false;
  const db = checkpointer?.db;
  if (db) {
    try {
      db.exec(`DELETE FROM checkpoint_blobs WHERE thread_id = ?`, [String(workflowRunId)]);
      db.exec(`DELETE FROM checkpoint_writes WHERE thread_id = ?`, [String(workflowRunId)]);
      db.exec(`DELETE FROM checkpoints WHERE thread_id = ?`, [String(workflowRunId)]);
    } catch (e) {
      console.warn(`[myteam:cleanup] checkpoint delete error for ${workflowRunId}: ${e.message}`);
    }
  }
  if (typeof storage.deleteWorkflowAdapter === 'function') {
    deleted = storage.deleteWorkflowAdapter(workflowRunId);
  }
  return deleted;
}
