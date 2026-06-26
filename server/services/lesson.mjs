// Lesson 管理 — 踩坑记录、模式检测和经验检索
import { randomUUID } from 'crypto';
import { repository } from '../../storage.mjs';

export function appendLesson(task, error) {
  // 自动 pattern 分类
  const errMsg = String(error?.message || error || '');
  let pattern = 'unknown';
  if (/missing path|未配置/i.test(errMsg)) pattern = 'agent-not-configured';
  else if (/exit code/i.test(errMsg)) pattern = 'cli-exit-error';
  else if (/timeout/i.test(errMsg)) pattern = 'timeout';
  else if (/ECONNREFUSED|ECONNRESET|stream disconnected/i.test(errMsg)) pattern = 'connection-lost';
  else if (/context length|token/i.test(errMsg)) pattern = 'context-overflow';
  else if (/Reconnecting/i.test(errMsg)) pattern = 'stream-disconnect';
  else if (/EPERM|EACCES/i.test(errMsg)) pattern = 'permission-denied';
  else if (/parse_failed|JSON/i.test(errMsg)) pattern = 'output-parse-failed';

  const lesson = {
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
      id: task.id, title: task.title, goal: task.goal, accept: task.accept,
      steps: task.steps || [], agent: task.agent, session_id: task.session_id || '',
      run_id: task.run_id || '', status: task.status, result: task.result || null,
    },
  };
  return repository.append('lessons', lesson);
}

export function relevantLessons(text = '', agent = '', limit = 3) {
  const query = String(text || '').toLowerCase();
  return repository.list('lessons')
    .map((lesson) => {
      const searchable = [lesson.pattern, lesson.error, lesson.task_title, lesson.goal].filter(Boolean).join(' ').toLowerCase();
      let score = lesson.agent === agent ? 2 : 0;
      for (const token of query.split(/[\s,，。；;、|]+/).filter((t) => t.length >= 2)) {
        if (searchable.includes(token)) score += 1;
      }
      return { ...lesson, relevance_score: score };
    })
    .filter((l) => l.relevance_score > 0)
    .sort((a, b) => b.relevance_score - a.relevance_score || String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, limit);
}

export function buildLessonContext(lessons = []) {
  if (!lessons.length) return '';
  return `【历史踩坑（仅作风险提示，不覆盖当前任务要求）】\n${lessons.map((l, i) =>
    `${i + 1}. [${l.pattern || 'unknown'}] ${l.task_title || l.task_id || '历史任务'}：${String(l.error || '').slice(0, 240)}`
  ).join('\n')}`;
}
