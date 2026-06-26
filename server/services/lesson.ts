// Lesson 管理 — 踩坑记录、模式检测和经验检索 (TypeScript)
import { randomUUID } from 'crypto';

interface Repository {
  append(collection: string, record: Record<string, unknown>): unknown;
  list(collection: string): LessonRecord[];
}

interface LessonRecord {
  id: string;
  task_id: string;
  task_title: string;
  goal: string;
  agent: string;
  session_id: string;
  run_id: string;
  error: string;
  pattern: LessonPattern;
  timestamp: string;
  source_task_snapshot: TaskSnapshot;
  relevance_score?: number;
}

interface TaskSnapshot {
  id: string;
  title: string;
  goal: string;
  accept: string;
  steps: string[];
  agent: string;
  session_id: string;
  run_id: string;
  status: string;
  result: string | null;
}

type LessonPattern =
  | 'agent-not-configured'
  | 'cli-exit-error'
  | 'timeout'
  | 'connection-lost'
  | 'context-overflow'
  | 'stream-disconnect'
  | 'permission-denied'
  | 'output-parse-failed'
  | 'unknown';

interface TaskRef {
  id: string;
  title: string;
  goal: string;
  accept: string;
  steps: string[];
  agent: string;
  session_id: string;
  run_id: string;
  status: string;
  result: string | null;
}

function classifyPattern(errMsg: string): LessonPattern {
  if (/missing path|未配置/i.test(errMsg)) return 'agent-not-configured';
  if (/exit code/i.test(errMsg)) return 'cli-exit-error';
  if (/timeout/i.test(errMsg)) return 'timeout';
  if (/ECONNREFUSED|ECONNRESET|stream disconnected/i.test(errMsg)) return 'connection-lost';
  if (/context length|token/i.test(errMsg)) return 'context-overflow';
  if (/Reconnecting/i.test(errMsg)) return 'stream-disconnect';
  if (/EPERM|EACCES/i.test(errMsg)) return 'permission-denied';
  if (/parse_failed|JSON/i.test(errMsg)) return 'output-parse-failed';
  return 'unknown';
}

export function appendLesson(task: TaskRef, error: Error | { message?: string } | string): LessonRecord {
  const errMsg = String(
    (error as Error)?.message || (error as { message?: string })?.message || error || ''
  );
  const pattern = classifyPattern(errMsg);

  const lesson: LessonRecord = {
    id: randomUUID().slice(0, 8),
    task_id: task.id,
    task_title: task.title,
    goal: task.goal,
    agent: task.agent,
    session_id: task.session_id || '',
    run_id: task.run_id || '',
    error: errMsg.slice(0, 500),
    pattern,
    timestamp: new Date().toISOString(),
    source_task_snapshot: {
      id: task.id,
      title: task.title,
      goal: task.goal,
      accept: task.accept,
      steps: task.steps || [],
      agent: task.agent,
      session_id: task.session_id || '',
      run_id: task.run_id || '',
      status: task.status,
      result: task.result || null,
    },
  };
  return lesson;
}

export function relevantLessons(
  lessons: LessonRecord[],
  text: string = '',
  agent: string = '',
  limit: number = 3,
): (LessonRecord & { relevance_score: number })[] {
  const query = String(text || '').toLowerCase();
  return lessons
    .map((lesson) => {
      const searchable = [
        lesson.pattern, lesson.error, lesson.task_title, lesson.goal,
      ].filter(Boolean).join(' ').toLowerCase();
      let score = lesson.agent === agent ? 2 : 0;
      for (const token of query.split(/[\s,，。；;、|]+/).filter((t) => t.length >= 2)) {
        if (searchable.includes(token)) score += 1;
      }
      return { ...lesson, relevance_score: score };
    })
    .filter((l) => l.relevance_score > 0)
    .sort((a, b) =>
      b.relevance_score - a.relevance_score ||
      String(b.timestamp).localeCompare(String(a.timestamp)),
    )
    .slice(0, limit);
}

export function buildLessonContext(lessons: LessonRecord[]): string {
  if (!lessons.length) return '';
  return `【历史踩坑（仅作风险提示，不覆盖当前任务要求）】\n${
    lessons.map((l, i) =>
      `${i + 1}. [${l.pattern || 'unknown'}] ${l.task_title || l.id || '历史任务'}：${String(l.error || '').slice(0, 240)}`
    ).join('\n')
  }`;
}
