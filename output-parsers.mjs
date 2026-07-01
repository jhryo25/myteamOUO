// myteam output parsers — LangChain StructuredOutputParser + Zod
// 替换 agent-utils.mjs 中的 extractJson / parseReviewResult / validatePlanResult。
//
// 用法：
//   import { parsePlanOutput, parseReviewOutput, extractJson } from './output-parsers.mjs';
//   const plan = parsePlanOutput(rawText);  // { ok: true, data: {...} } | { ok: false, reason: '...' }

import { StructuredOutputParser } from '@langchain/core/output_parsers';
import { z } from 'zod';

// ── Plan 输出 Schema（Zod） ────────────────────────────────────
const openQuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(1).max(3),
});

const taskSchema = z.object({
  title: z.string().min(1),
  why: z.string().default(''),
  tradeoff: z.string().default(''),
  open_questions: z.array(openQuestionSchema).max(3).default([]),
  steps: z.array(z.string()).default([]),
  accept: z.string().default(''),
  agent: z.string().min(1),
});

export const planOutputSchema = z.object({
  goal: z.string().min(1),
  tasks: z.array(taskSchema).min(1).max(7),
});

// ── Review 输出 Schema（Zod） ──────────────────────────────────
export const reviewOutputSchema = z.object({
  verdict: z.enum(['pass', 'rework']),
  severity: z.enum(['none', 'P1', 'P2', 'P3']).default('none'),
  score: z.number().int().min(0).max(100).nullable().default(null),
  findings: z.array(z.string()).default([]),
  suggestion: z.string().max(500).default(''),
});

// ── Parsers ────────────────────────────────────────────────────
const _planParser = StructuredOutputParser.fromZodSchema(planOutputSchema);
const _reviewParser = StructuredOutputParser.fromZodSchema(reviewOutputSchema);

export function getPlanFormatInstructions() {
  return _planParser.getFormatInstructions();
}

export function getReviewFormatInstructions() {
  return _reviewParser.getFormatInstructions();
}

// ── extractJson（保留兼容，语义不变） ───────────────────────────
export function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  let cleaned = text.replace(/```(?:json|JSON)?\s*/g, '```').replace(/```/g, '');
  // Strategy 1: find ALL balanced {...} candidates and try JSON.parse on each.
  const candidates = [];
  for (let start = 0; start < cleaned.length; start++) {
    if (cleaned[start] !== '{') continue;
    let d = 0, inStr = false, esc = false;
    for (let i = start; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') d++;
      else if (c === '}') {
        d--;
        if (d === 0) {
          const candidate = cleaned.slice(start, i + 1);
          try { return JSON.parse(candidate); }
          catch { candidates.push(candidate); }
          break;
        }
      }
    }
  }
  // Strategy 2: try repairing truncated JSON
  for (const cand of candidates) {
    const repaired = repairJson(cand);
    if (repaired) {
      try { return JSON.parse(repaired); } catch {}
    }
  }
  // Strategy 3: take from first { to last } and attempt repair
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const blob = cleaned.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(blob); } catch {}
    const repaired = repairJson(blob);
    if (repaired) { try { return JSON.parse(repaired); } catch {} }
  }
  return null;
}

function repairJson(s) {
  let t = s;
  t = t.replace(/,\s*([}\]])/g, '$1');
  let braces = 0, brackets = 0, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === '[') brackets++;
    else if (c === ']') brackets--;
  }
  if (inStr) t += '"';
  while (brackets > 0) { t += ']'; brackets--; }
  while (braces > 0) { t += '}'; braces--; }
  return t;
}

// ── 结构化解析（Zod 校验） ─────────────────────────────────────
export function parsePlanOutput(raw) {
  const parsed = extractJson(raw || '');
  if (!parsed) return { ok: false, reason: '无法从输出中提取 JSON' };
  const result = planOutputSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, reason: `Schema 校验失败: ${issues}`, issues: result.error.issues };
  }
  return { ok: true, data: result.data };
}

// 保守关键词裁决（参考 clowder-ai）：reviewer 没输出合法 JSON 时，
// 从原文关键词推断 verdict，避免 review_protocol_failed 卡死。rework 信号优先（更保守）。
function detectVerdictByKeyword(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  if (/拒绝|不通过|返工|打回|重做|rework|reject|不合格|需修复|阻塞合入|有问题需|未达标/i.test(t)) {
    return { verdict: 'rework', severity: 'P2', score: null, findings: [],
      suggestion: t.slice(0, 200).replace(/\s+/g, ' ').trim(), _source: 'keyword_rework' };
  }
  if (/通过|放行|LGTM|approve|验收通过|合格|达标|已完成|完整|没问题|高质量/i.test(t)) {
    return { verdict: 'pass', severity: 'none', score: null, findings: [],
      suggestion: t.slice(0, 200).replace(/\s+/g, ' ').trim(), _source: 'keyword_pass' };
  }
  return null;
}

export function parseReviewOutput(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const parsed = extractJson(text);
  if (!parsed) {
    // 兼容旧版文本 verdict 匹配
    const fallback = text.match(/\bverdict\s*["']?\s*[:=：]\s*["']?\s*(pass|rework)\b/i)?.[1]?.toLowerCase() || '';
    if (fallback) {
      return {
        verdict: fallback,
        severity: 'none',
        score: null,
        findings: [],
        suggestion: '',
        _source: 'text_fallback',
      };
    }
    return detectVerdictByKeyword(text);
  }
  // 支持嵌套结构（旧版兼容）: parsed.review / parsed.result
  const candidate = parsed?.review && typeof parsed.review === 'object'
    ? parsed.review
    : parsed?.result && typeof parsed.result === 'object'
      ? parsed.result
      : parsed;
  const result = reviewOutputSchema.safeParse(candidate);
  if (result.success) return { ...result.data, _source: 'zod' };
  // Zod 校验失败时尝试直接取 verdict
  const explicit = String(candidate?.verdict || '').trim().toLowerCase();
  const fallback = text.match(/\bverdict\s*["']?\s*[:=：]\s*["']?\s*(pass|rework)\b/i)?.[1]?.toLowerCase() || '';
  const verdict = ['pass', 'rework'].includes(explicit) ? explicit : fallback;
  if (!verdict) return detectVerdictByKeyword(text);
  const rawScore = Number(candidate?.score);
  const score = Number.isFinite(rawScore)
    ? Math.max(0, Math.min(100, Math.round(rawScore)))
    : null;
  return {
    ...(candidate && typeof candidate === 'object' ? candidate : {}),
    verdict,
    severity: candidate?.severity || 'none',
    score,
    findings: Array.isArray(candidate?.findings) ? candidate.findings.map(String) : [],
    suggestion: String(candidate?.suggestion || '').slice(0, 500),
    _source: 'hybrid',
  };
}

// 向后兼容旧版 validatePlanResult（返回 { ok, reason }）
export function validatePlanResult(data) {
  if (!data || typeof data !== 'object') return { ok: false, reason: '返回值不是对象' };
  const result = planOutputSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, reason: result.error.issues.map(i => i.message).join('; ') };
  }
  return { ok: true, data: result.data };
}

// 向后兼容旧版 parseReviewResult
export { parseReviewOutput as parseReviewResult };
