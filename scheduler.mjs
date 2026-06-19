import { randomUUID } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import { repository } from './storage.mjs';
import { appendAudit, requestApproval } from './governance.mjs';

const MAX_TIMEOUT_MS = 2_147_000_000;
export const SCHEDULE_RUN_STATES = [
  'queued',
  'waiting_approval',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
];

export function nextCronDate(expression, timezone, currentDate = new Date()) {
  return CronExpressionParser.parse(expression, { currentDate, tz: timezone }).next().toDate();
}

export class ScheduleService {
  constructor({ execute, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } = {}) {
    this.execute = execute || (async () => ({ summary: 'no executor configured' }));
    this.timezone = timezone;
    this.timers = new Map();
    this.running = new Set();
  }

  start() {
    const now = Date.now();
    for (const schedule of this.list()) {
      if (!schedule.enabled) continue;
      if (schedule.nextRunAt && Date.parse(schedule.nextRunAt) < now) {
        repository.append('schedule_runs', {
          id: randomUUID(), scheduleId: schedule.id, status: 'skipped',
          reason: 'trigger missed while service was stopped', createdAt: new Date().toISOString(),
        }, { parentId: schedule.id });
      }
      this.arm(this.refreshNextRun(schedule));
    }
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  list() { return repository.list('schedules'); }
  listRuns(scheduleId = '', limit = 100) {
    return repository.list('schedule_runs', {
      parentId: scheduleId || null,
      newestFirst: true,
      limit,
    });
  }

  create(input) {
    const schedule = this.normalize(input, { id: randomUUID(), enabled: input.enabled !== false });
    repository.upsert('schedules', schedule);
    if (schedule.enabled) this.arm(schedule);
    return schedule;
  }

  update(id, patch) {
    const current = repository.get('schedules', id);
    if (!current) throw new Error('schedule not found');
    const next = this.normalize({ ...current, ...patch }, current);
    repository.upsert('schedules', next);
    this.disarm(id);
    if (next.enabled) this.arm(next);
    return next;
  }

  remove(id) {
    this.disarm(id);
    return repository.remove('schedules', id);
  }

  async trigger(id, { manual = false } = {}) {
    const schedule = repository.get('schedules', id);
    if (!schedule) throw new Error('schedule not found');
    if (this.running.has(id) || this.listRuns(id).some((run) => ['waiting_approval', 'running'].includes(run.status))) {
      const skipped = repository.append('schedule_runs', {
        id: randomUUID(), scheduleId: id, status: 'skipped', reason: 'schedule already active',
        manual, createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      }, { parentId: id });
      return skipped;
    }
    const run = repository.append('schedule_runs', {
      id: randomUUID(), scheduleId: id, status: 'queued', manual,
      createdAt: new Date().toISOString(),
    }, { parentId: id });
    const approval = requestApproval({
      operation: 'schedule.run',
      payload: { scheduleId: id, runId: run.id, goal: schedule.goal, agent: schedule.agent },
      sessionId: schedule.sessionId || '',
    });
    const waiting = { ...run, status: 'waiting_approval', approvalId: approval.id };
    repository.upsert('schedule_runs', waiting, { parentId: id });
    appendAudit({ operation: 'schedule.run', decision: 'queued', result: 'waiting_approval', approvalId: approval.id, details: { scheduleId: id, runId: run.id } });
    return waiting;
  }

  async resumeApproval(approval) {
    if (approval.operation !== 'schedule.run') return null;
    const runId = approval.payload?.runId;
    const run = runId ? repository.get('schedule_runs', runId) : null;
    if (!run || run.status !== 'waiting_approval') return null;
    if (approval.status !== 'approved') {
      const denied = { ...run, status: 'cancelled', reason: approval.status, finishedAt: new Date().toISOString() };
      repository.upsert('schedule_runs', denied, { parentId: run.scheduleId });
      return denied;
    }
    return this.executeRun(run);
  }

  async executeRun(run) {
    if (this.running.has(run.scheduleId)) return run;
    const schedule = repository.get('schedules', run.scheduleId);
    if (!schedule) throw new Error('schedule not found');
    this.running.add(run.scheduleId);
    const active = { ...run, status: 'running', startedAt: new Date().toISOString() };
    repository.upsert('schedule_runs', active, { parentId: run.scheduleId });
    try {
      const result = await this.execute(schedule, active);
      const done = { ...active, status: 'succeeded', summary: String(result?.summary || result || '').slice(0, 2000), sessionId: result?.sessionId || active.sessionId || null, finishedAt: new Date().toISOString() };
      repository.upsert('schedule_runs', done, { parentId: run.scheduleId });
      appendAudit({ operation: 'schedule.run', decision: 'executed', result: 'succeeded', approvalId: run.approvalId, details: { scheduleId: run.scheduleId, runId: run.id } });
      return done;
    } catch (error) {
      const failed = { ...active, status: 'failed', error: String(error.message || error).slice(0, 1000), finishedAt: new Date().toISOString() };
      repository.upsert('schedule_runs', failed, { parentId: run.scheduleId });
      appendAudit({ operation: 'schedule.run', decision: 'executed', result: 'failed', approvalId: run.approvalId, details: { scheduleId: run.scheduleId, runId: run.id, error: failed.error } });
      return failed;
    } finally {
      this.running.delete(run.scheduleId);
    }
  }

  normalize(input, previous = {}) {
    const expression = String(input.expression || '').trim();
    const timezone = String(input.timezone || previous.timezone || this.timezone);
    if (!expression) throw new Error('cron expression required');
    const nextRunAt = nextCronDate(expression, timezone).toISOString();
    const mode = ['chat', 'plan', 'dispatch'].includes(input.mode) ? input.mode : 'chat';
    return {
      ...previous,
      id: input.id || previous.id,
      name: String(input.name || input.goal || 'Scheduled task').trim().slice(0, 100),
      expression,
      timezone,
      goal: String(input.goal || '').trim(),
      agent: ['codex', 'claude', 'kimi'].includes(input.agent) ? input.agent : 'codex',
      mode,
      sessionPolicy: input.sessionPolicy === 'existing' ? 'existing' : 'new',
      sessionId: input.sessionPolicy === 'existing' ? String(input.sessionId || '') : '',
      enabled: input.enabled !== false,
      nextRunAt,
      updatedAt: new Date().toISOString(),
      createdAt: previous.createdAt || new Date().toISOString(),
    };
  }

  refreshNextRun(schedule) {
    const next = { ...schedule, nextRunAt: nextCronDate(schedule.expression, schedule.timezone).toISOString() };
    repository.upsert('schedules', next);
    return next;
  }

  arm(schedule) {
    this.disarm(schedule.id);
    const delay = Math.max(0, Date.parse(schedule.nextRunAt) - Date.now());
    const timer = setTimeout(async () => {
      if (delay > MAX_TIMEOUT_MS) return this.arm(schedule);
      await this.trigger(schedule.id);
      const current = repository.get('schedules', schedule.id);
      if (current?.enabled) this.arm(this.refreshNextRun(current));
    }, Math.min(delay, MAX_TIMEOUT_MS));
    timer.unref?.();
    this.timers.set(schedule.id, timer);
  }

  disarm(id) {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }
}
