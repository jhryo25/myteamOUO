import { DatabaseSync } from 'node:sqlite';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const ENTITY_TABLES = [
  'sessions',
  'messages',
  'trashed_sessions',
  'tasks',
  'lessons',
  'invocations',
  'subagent_runs',
  'subagent_messages',
  'approvals',
  'audit_events',
  'schedules',
  'schedule_runs',
];

const WORKFLOW_ADAPTER_TABLE = 'workflow_adapters';
const CHAIN_TASK_MESSAGES_TABLE = 'chain_task_messages';

const LEGACY_FILES = {
  tasks: '.myteam/tasks.jsonl',
  lessons: '.myteam/lessons.jsonl',
  invocations: '.myteam/invocations.jsonl',
  subagent_runs: '.myteam/subagent-runs.jsonl',
  subagent_messages: '.myteam/subagent-messages.jsonl',
};

function parseJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`legacy JSONL parse failed: ${file}:${index + 1}: ${error.message}`);
      }
    });
}

function parseEntityRow(row) {
  if (!row) return null;
  return JSON.parse(row.data);
}

export class MyteamRepository {
  constructor(file = process.env.MYTEAM_DB_PATH || '.myteam/myteam.sqlite', options = {}) {
    this.file = resolve(file);
    mkdirSync(dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
    if (options.importLegacy !== false) this.importLegacy();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    const applied = new Set(
      this.db.prepare('SELECT version FROM schema_migrations').all().map((row) => Number(row.version)),
    );
    if (!applied.has(1)) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const table of ENTITY_TABLES) {
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS ${table} (
              id TEXT PRIMARY KEY,
              parent_id TEXT,
              ordinal INTEGER NOT NULL DEFAULT 0,
              data TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_${table}_parent ON ${table}(parent_id);
            CREATE INDEX IF NOT EXISTS idx_${table}_ordinal ON ${table}(ordinal);
          `);
        }
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
          .run(1, new Date().toISOString());
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw new Error(`database migration failed: ${error.message}`);
      }
    }
    if (!applied.has(2)) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS ${WORKFLOW_ADAPTER_TABLE} (
            workflow_run_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            agent_keys TEXT NOT NULL,
            task_scope TEXT NOT NULL,
            approval_fingerprint TEXT,
            options_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS ${CHAIN_TASK_MESSAGES_TABLE} (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            agent_key TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_chain_task_messages_task ON ${CHAIN_TASK_MESSAGES_TABLE}(task_id);
          CREATE INDEX IF NOT EXISTS idx_chain_task_messages_session ON ${CHAIN_TASK_MESSAGES_TABLE}(session_id);
        `);
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
          .run(2, new Date().toISOString());
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw new Error(`database migration v2 failed: ${error.message}`);
      }
    }
  }

  getMeta(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  setMeta(key, value) {
    this.db.prepare(`
      INSERT INTO app_meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, JSON.stringify(value));
  }

  list(table, { parentId = null, newestFirst = false, limit = 0 } = {}) {
    this.assertTable(table);
    const where = parentId === null ? '' : ' WHERE parent_id = ?';
    const order = newestFirst ? 'ordinal DESC, created_at DESC' : 'ordinal ASC, created_at ASC';
    const limitSql = limit > 0 ? ` LIMIT ${Math.max(1, Number(limit))}` : '';
    const statement = this.db.prepare(`SELECT data FROM ${table}${where} ORDER BY ${order}${limitSql}`);
    const rows = parentId === null ? statement.all() : statement.all(parentId);
    return rows.map(parseEntityRow);
  }

  get(table, id) {
    this.assertTable(table);
    return parseEntityRow(this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id));
  }

  upsert(table, value, { parentId = null, ordinal = null } = {}) {
    this.assertTable(table);
    const now = new Date().toISOString();
    const item = { ...value };
    item.id = String(item.id || randomUUID());
    const existing = this.db.prepare(`SELECT ordinal, created_at FROM ${table} WHERE id = ?`).get(item.id);
    const nextOrdinal = ordinal ?? existing?.ordinal ?? this.nextOrdinal(table);
    this.db.prepare(`
      INSERT INTO ${table}(id, parent_id, ordinal, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        parent_id = excluded.parent_id,
        ordinal = excluded.ordinal,
        data = excluded.data,
        updated_at = excluded.updated_at
    `).run(item.id, parentId, nextOrdinal, JSON.stringify(item), existing?.created_at || now, now);
    return item;
  }

  append(table, value, options = {}) {
    return this.upsert(table, value, { ...options, ordinal: this.nextOrdinal(table) });
  }

  replace(table, values, { parentId = null } = {}) {
    this.assertTable(table);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (parentId === null) this.db.prepare(`DELETE FROM ${table}`).run();
      else this.db.prepare(`DELETE FROM ${table} WHERE parent_id = ?`).run(parentId);
      values.forEach((value, index) => this.upsert(table, value, { parentId, ordinal: index }));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  remove(table, id) {
    this.assertTable(table);
    return this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0;
  }

  saveSessionState({ activeId, sessions = [], trashedSessions = [] }, { inTransaction = false } = {}) {
    if (!inTransaction) this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM messages').run();
      this.db.prepare('DELETE FROM sessions').run();
      this.db.prepare('DELETE FROM trashed_sessions').run();
      sessions.forEach((session, sessionIndex) => {
        const { history = [], ...metadata } = session;
        this.upsert('sessions', metadata, { ordinal: sessionIndex });
        history.forEach((message, messageIndex) => {
          this.upsert('messages', {
            ...message,
            id: message.id || `${session.id}:${messageIndex}`,
          }, { parentId: session.id, ordinal: messageIndex });
        });
      });
      trashedSessions.forEach((entry, index) => {
        const session = entry.session || entry;
        this.upsert('trashed_sessions', {
          ...entry,
          id: session.id,
        }, { ordinal: index });
      });
      this.setMeta('active_session_id', activeId || sessions[0]?.id || '');
      if (!inTransaction) this.db.exec('COMMIT');
    } catch (error) {
      if (!inTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  loadSessionState() {
    const sessions = this.list('sessions').map((session) => ({
      ...session,
      history: this.list('messages', { parentId: session.id }).map(({ id, ...message }) => message),
    }));
    const trashedSessions = this.list('trashed_sessions').map(({ id, ...entry }) => entry);
    return {
      activeId: this.getMeta('active_session_id', sessions[0]?.id || ''),
      sessions,
      trashedSessions,
    };
  }

  importLegacy() {
    if (this.getMeta('legacy_import_v1', false)) return;
    const hasData = ENTITY_TABLES.some((table) => {
      const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
      return Number(row.count) > 0;
    });
    if (hasData) {
      this.setMeta('legacy_import_v1', { skipped: true, reason: 'database-not-empty' });
      return;
    }

    const memoryFile = '.myteam/memory.json';
    const existingFiles = [memoryFile, ...Object.values(LEGACY_FILES)].filter(existsSync);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = join('.myteam', 'migrations', `legacy-${stamp}`);
    if (existingFiles.length) {
      mkdirSync(backupDir, { recursive: true });
      for (const file of existingFiles) copyFileSync(file, join(backupDir, basename(file)));
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [table, file] of Object.entries(LEGACY_FILES)) {
        parseJsonl(file).forEach((item, index) => this.upsert(table, item, {
          parentId: table === 'subagent_messages' ? item.runId || null : null,
          ordinal: index,
        }));
      }
      if (existsSync(memoryFile)) {
        const state = JSON.parse(readFileSync(memoryFile, 'utf8'));
        this.saveSessionState({
          activeId: state.activeId,
          sessions: Array.isArray(state.sessions) ? state.sessions : [],
          trashedSessions: Array.isArray(state.trashedSessions) ? state.trashedSessions : [],
        }, { inTransaction: true });
      }
      this.setMeta('legacy_import_v1', { importedAt: new Date().toISOString(), backupDir });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw new Error(`legacy import failed; source files were preserved: ${error.message}`);
    }
  }

  nextOrdinal(table) {
    const row = this.db.prepare(`SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM ${table}`).get();
    return Number(row.next);
  }

  assertTable(table) {
    if (!ENTITY_TABLES.includes(table)) throw new Error(`unsupported repository table: ${table}`);
  }

  // ── workflow adapter descriptor persistence ─────────────────────────

  upsertWorkflowAdapter(workflowRunId, descriptor) {
    const now = new Date().toISOString();
    const existing = this.db.prepare(
      `SELECT created_at FROM ${WORKFLOW_ADAPTER_TABLE} WHERE workflow_run_id = ?`
    ).get(workflowRunId);
    this.db.prepare(`
      INSERT INTO ${WORKFLOW_ADAPTER_TABLE}(workflow_run_id, session_id, agent_keys, task_scope, approval_fingerprint, options_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_run_id) DO UPDATE SET
        session_id = excluded.session_id,
        agent_keys = excluded.agent_keys,
        task_scope = excluded.task_scope,
        approval_fingerprint = excluded.approval_fingerprint,
        options_json = excluded.options_json,
        updated_at = excluded.updated_at
    `).run(
      workflowRunId,
      String(descriptor.sessionId || ''),
      JSON.stringify(descriptor.agentKeys || []),
      JSON.stringify(descriptor.taskScope || {}),
      descriptor.approvalFingerprint || null,
      JSON.stringify(descriptor.options || {}),
      existing?.created_at || now,
      now,
    );
  }

  getWorkflowAdapter(workflowRunId) {
    const row = this.db.prepare(
      `SELECT * FROM ${WORKFLOW_ADAPTER_TABLE} WHERE workflow_run_id = ?`
    ).get(workflowRunId);
    if (!row) return null;
    return {
      workflowRunId: row.workflow_run_id,
      sessionId: row.session_id,
      agentKeys: JSON.parse(row.agent_keys),
      taskScope: JSON.parse(row.task_scope),
      approvalFingerprint: row.approval_fingerprint || null,
      options: JSON.parse(row.options_json || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listWorkflowAdapters({ olderThanDays = 0, limit = 0 } = {}) {
    let sql = `SELECT workflow_run_id, created_at, updated_at FROM ${WORKFLOW_ADAPTER_TABLE}`;
    const params = [];
    if (olderThanDays > 0) {
      const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
      sql += ' WHERE updated_at < ?';
      params.push(cutoff);
    }
    sql += ' ORDER BY updated_at ASC';
    if (limit > 0) {
      sql += ` LIMIT ${Math.max(1, Number(limit))}`;
    }
    return this.db.prepare(sql).all(...params).map((row) => ({
      workflowRunId: row.workflow_run_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  deleteWorkflowAdapter(workflowRunId) {
    return this.db.prepare(
      `DELETE FROM ${WORKFLOW_ADAPTER_TABLE} WHERE workflow_run_id = ?`
    ).run(workflowRunId).changes > 0;
  }

  // ── chain task message persistence ──────────────────────────────────

  insertChainMessage({ id, taskId, sessionId, role, content, agentKey }) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO ${CHAIN_TASK_MESSAGES_TABLE}(id, task_id, session_id, role, content, agent_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(id || randomUUID()),
      String(taskId || ''),
      String(sessionId || ''),
      String(role || 'system'),
      String(content || ''),
      agentKey || null,
      now,
    );
  }

  listChainMessages(taskId) {
    return this.db.prepare(
      `SELECT * FROM ${CHAIN_TASK_MESSAGES_TABLE} WHERE task_id = ? ORDER BY created_at ASC`
    ).all(taskId).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      agentKey: row.agent_key,
      createdAt: row.created_at,
    }));
  }

  listAllChainMessages({ limit = 5000 } = {}) {
    return this.db.prepare(
      `SELECT * FROM ${CHAIN_TASK_MESSAGES_TABLE} ORDER BY created_at ASC LIMIT ?`
    ).all(limit).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      agentKey: row.agent_key,
      createdAt: row.created_at,
    }));
  }

  deleteChainMessages(taskId) {
    return this.db.prepare(
      `DELETE FROM ${CHAIN_TASK_MESSAGES_TABLE} WHERE task_id = ?`
    ).run(taskId).changes;
  }

  close() {
    this.db.close();
  }
}

export const repository = new MyteamRepository(undefined, {
  importLegacy: process.env.MYTEAM_SKIP_LEGACY_IMPORT !== '1',
});
