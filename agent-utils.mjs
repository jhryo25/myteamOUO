// myteam 公共 Agent 调用工具
// plan.mjs / dispatch.mjs / server.mjs 均 import 此文件

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { repository } from './storage.mjs';
import {
  normalizeTaskRecord,
  synchronizeTaskRecord,
} from './workflow-state.mjs';

// ── 从 LangChain prompts 模块重导出，保持向后兼容 ──────────────
export {
  buildChatPrompt,
  buildExecPrompt,
  buildReviewPrompt,
  CHAT_SYSTEM,
  PLAN_PROMPT,
  REVIEW_PROMPT_RULES,
  RICH_BLOCKS_HINT,
} from './prompts.mjs';

export const AGENT_KEYS = ['codex', 'claude', 'kimi'];
export const AGENTS_FILE = '.myteam/agents.json';

export function selectRunnableAgent(statuses = [], preferredAgent = '') {
  const preferred = String(preferredAgent || '');
  return statuses.find((agent) => agent.key === preferred && agent.available)
    || statuses.find((agent) => agent.available)
    || statuses.find((agent) => agent.key === preferred)
    || statuses[0]
    || null;
}

const DEFAULT_AGENT_DEFS = [
  {
    key: 'codex',
    label: 'Codex',
    emoji: '🤖',
    desc: '总控 / 审查 / 自迭代',
    envKey: 'CODEX_PATH',
    inputMode: 'stdin',
    argsTemplate: 'exec - --json --skip-git-repo-check',
    checkTemplate: '--help',
    roleDescription: '任务规划、代码审查、自迭代协调者',
    personality: '严谨、务实、追求代码质量，习惯先问清楚需求再动手',
    strengths: ['任务拆解', '代码审查', '进度协调'],
    restrictions: [],
    // 对齐 clowder-ai CatConfig: avatar/color/nickname
    nickname: '',
    avatar: '',
    color: { primary: '#5B8C5A', secondary: '#D4E6D3' },
  },
  {
    key: 'claude',
    label: 'Claude',
    emoji: '✦',
    desc: '主架构 / 深度实现',
    envKey: 'CLAUDE_PATH',
    inputMode: 'stdin',
    argsTemplate: '-p - --output-format stream-json --verbose',
    checkTemplate: '--help',
    roleDescription: '深度分析、系统架构设计、复杂代码生成',
    personality: '善于推理、思维发散、喜欢先理解全局再落地细节',
    strengths: ['架构设计', '复杂推理', '长文档生成'],
    restrictions: [],
    nickname: '',
    avatar: '',
    color: { primary: '#9B7EBD', secondary: '#E8DFF5' },
  },
  {
    key: 'kimi',
    label: 'Kimi',
    emoji: '🌙',
    desc: '轻量执行 / 快速草稿',
    envKey: 'KIMI_PATH',
    inputMode: 'arg',
    argsTemplate: '--prompt {prompt} --output-format stream-json',
    checkTemplate: '--help',
    roleDescription: '快速执行、轻量任务、草稿生成',
    personality: '高效、简洁、直接给出结果，不绕弯子',
    strengths: ['快速执行', '简单任务', '草稿生成'],
    restrictions: [],
    nickname: '',
    avatar: '',
    color: { primary: '#5B9BD5', secondary: '#D6E9F8' },
  },
];

export function sanitizeAgentKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function splitArgs(template, prompt = '') {
  const text = String(template || '').trim();
  if (!text) return [];
  // 先拆模板再替换 prompt，避免长 prompt 被空格拆成多个 CLI 参数。
  return text
    .match(/"([^"]*)"|'([^']*)'|\S+/g)
    ?.map(part => part.replace(/^["']|["']$/g, '').replaceAll('{prompt}', prompt)) || [];
}

export function readAgentRegistry(ENV = loadEnv(), file = AGENTS_FILE) {
  let saved = [];
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      saved = Array.isArray(data.agents) ? data.agents : [];
    } catch {
      saved = [];
    }
  }

  const byKey = new Map(DEFAULT_AGENT_DEFS.map(agent => [agent.key, { ...agent }]));
  for (const raw of saved) {
    const key = sanitizeAgentKey(raw.key);
    if (!key) continue;
    const base = byKey.get(key) || {};
    const savedArgsTemplate = raw.argsTemplate || base.argsTemplate || '-p {prompt}';
    const argsTemplate = key === 'kimi'
      ? savedArgsTemplate.replace(/(^|\s)--print(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim()
      : savedArgsTemplate;
    byKey.set(key, {
      ...base,
      ...raw,
      key,
      label: raw.label || base.label || key,
      emoji: raw.emoji || base.emoji || '●',
      desc: raw.desc || base.desc || '',
      inputMode: raw.inputMode === 'stdin' ? 'stdin' : 'arg',
      argsTemplate,
      checkTemplate: raw.checkTemplate || base.checkTemplate || '--help',
      envKey: raw.envKey || base.envKey || `${key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_PATH`,
      removable: raw.removable ?? !AGENT_KEYS.includes(key),
      baseUrl: String(raw.baseUrl ?? base.baseUrl ?? ''),
      model: String(raw.model ?? base.model ?? ''),
      apiKey: String(raw.apiKey ?? base.apiKey ?? ''),
      // 角色卡字段
      roleDescription: raw.roleDescription ?? base.roleDescription ?? '',
      personality: raw.personality ?? base.personality ?? '',
      strengths: Array.isArray(raw.strengths) ? raw.strengths : (base.strengths ?? []),
      restrictions: Array.isArray(raw.restrictions) ? raw.restrictions : (base.restrictions ?? []),
      // 对齐 clowder-ai CatConfig: avatar/color/nickname
      nickname: String(raw.nickname ?? base.nickname ?? '').trim(),
      avatar: String(raw.avatar ?? base.avatar ?? '').trim(),
      color: (raw.color && typeof raw.color === 'object')
        ? { primary: String(raw.color.primary || base.color?.primary || '#888'), secondary: String(raw.color.secondary || base.color?.secondary || '#ddd') }
        : (base.color || { primary: '#888', secondary: '#ddd' }),
    });
  }

  return [...byKey.values()].map(agent => ({
    ...agent,
    path: agent.path ?? ENV[agent.envKey] ?? '',
  }));
}

export function writeAgentRegistry(agents, file = AGENTS_FILE) {
  mkdirSync('.myteam', { recursive: true });
  const cleaned = agents
    .map(agent => {
      const key = sanitizeAgentKey(agent.key);
      if (!key) return null;
      return {
        key,
        label: String(agent.label || key).trim() || key,
        emoji: String(agent.emoji || '●').trim() || '●',
        desc: String(agent.desc || '').trim(),
        path: String(agent.path || '').trim(),
        inputMode: agent.inputMode === 'stdin' ? 'stdin' : 'arg',
        argsTemplate: String(agent.argsTemplate || '-p {prompt}').trim(),
        checkTemplate: String(agent.checkTemplate || '--help').trim(),
        removable: agent.removable ?? !AGENT_KEYS.includes(key),
        baseUrl: String(agent.baseUrl || '').trim(),
        model: String(agent.model || '').trim(),
        apiKey: String(agent.apiKey || '').trim(),
        // 角色卡字段
        roleDescription: String(agent.roleDescription || '').trim(),
        personality: String(agent.personality || '').trim(),
        strengths: Array.isArray(agent.strengths) ? agent.strengths.map(String).filter(Boolean) : [],
        restrictions: Array.isArray(agent.restrictions) ? agent.restrictions.map(String).filter(Boolean) : [],
        // 对齐 clowder-ai CatConfig: avatar/color/nickname
        nickname: String(agent.nickname || '').trim(),
        avatar: String(agent.avatar || '').trim(),
        color: (agent.color && typeof agent.color === 'object')
          ? { primary: String(agent.color.primary || '#888'), secondary: String(agent.color.secondary || '#ddd') }
          : { primary: '#888', secondary: '#ddd' },
      };
    })
    .filter(Boolean);
  writeFileSync(file, JSON.stringify({ agents: cleaned }, null, 2), 'utf8');
  return cleaned;
}

/**
 * 构建角色卡 system prompt 头部（对齐 clowder-ai buildStaticIdentity）
 * 注入到每次 agent 调用的 prompt 最前面
 */
export function buildRoleCard(agentDef) {
  if (!agentDef) return '';
  const lines = [];
  const name = agentDef.label || agentDef.key;
  if (agentDef.roleDescription) {
    lines.push(`你是 ${name}，角色：${agentDef.roleDescription}`);
  }
  if (agentDef.personality) {
    lines.push(`性格：${agentDef.personality}`);
  }
  if (agentDef.strengths?.length) {
    lines.push(`擅长：${agentDef.strengths.join('、')}`);
  }
  if (agentDef.restrictions?.length) {
    lines.push(`\n你的硬限制：${agentDef.restrictions.join('、')}。被要求做这类任务时请明确说明无法完成。`);
  }
  return lines.length ? lines.join('\n') + '\n\n' : '';
}

// ── .env 读取 ─────────────────────────────────────────────────
export function loadEnv(envPath = '.env') {
  if (!existsSync(envPath)) return {};
  const result = {};
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [k, ...rest] = line.split('=');
    result[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
  return result;
}

// 各 agent CLI 对应的环境变量前缀（baseUrl / apiKey / model 通过 env 注入，避免 CLI 不识别 --base-url）
const AGENT_ENV_MAP = {
  codex:  { baseUrl: 'OPENAI_BASE_URL',     apiKey: 'OPENAI_API_KEY',     model: 'OPENAI_MODEL' },
  claude: { baseUrl: 'ANTHROPIC_BASE_URL',  apiKey: 'ANTHROPIC_API_KEY',  model: 'ANTHROPIC_MODEL' },
  kimi:   { baseUrl: 'KIMI_BASE_URL',       apiKey: 'KIMI_API_KEY',       model: 'KIMI_MODEL' },
};

function buildAgentSpawnEnv(agent) {
  // 从当前进程环境开始，但先清除可能从宿主机泄露的认证/代理变量，
  // 避免 IDE 集成（如 VSCode Claude Code）的环境变量与 agent 配置冲突。
  // 典型场景：ANTHROPIC_AUTH_TOKEN=PROXY_MANAGED 会覆盖 ANTHROPIC_API_KEY，
  // 导致 Claude CLI 用 OAuth token 而非 agent 的 API key 去认证。
  const env = { ...process.env };
  const CONFLICTING_ENV_VARS = [
    // Claude / Anthropic — IDE 集成/本地代理残留
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
    // Codex / OpenAI — 可能被其他工具设置的代理/认证
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_ORG_ID',
    'OPENAI_PROJECT_ID',
    // IDE hook 回调地址 — CLI 可能尝试回调不存在的 hook server
    'CLAUDE_CODE_HOOK_URL',
  ];
  for (const key of CONFLICTING_ENV_VARS) {
    delete env[key];
  }

  const mapping = AGENT_ENV_MAP[agent.key] || {};
  // 写入按 agent 类型映射的 env 名
  if (agent.baseUrl && mapping.baseUrl) env[mapping.baseUrl] = agent.baseUrl;
  if (agent.apiKey  && mapping.apiKey)  env[mapping.apiKey]  = agent.apiKey;
  if (agent.model   && mapping.model)   env[mapping.model]   = agent.model;
  // 额外写入通用名，方便自定义 CLI 读取
  if (agent.baseUrl) env.AGENT_BASE_URL = agent.baseUrl;
  if (agent.apiKey)  env.AGENT_API_KEY  = agent.apiKey;
  if (agent.model)   env.AGENT_MODEL    = agent.model;
  return env;
}

// ── CLI 配置工厂（接受已解析的 ENV） ─────────────────────────
export function buildCliConfig(ENV) {
  const config = {};
  for (const agent of readAgentRegistry(ENV)) {
    // 注意：不再把 --base-url / --api-key / --model 强行拼到 argsTemplate，
    // 因为不同 CLI 不一定识别（如 claude CLI 不识别 --base-url）。
    // 通过 spawnOptions.env 注入，由 CLI 自行读取对应 env 变量。
    // 用户如果显式在 argsTemplate 里写了 {model}/{baseUrl}/{apiKey}，仍按模板替换。
    let effectiveTemplate = agent.argsTemplate
      .replaceAll('{model}',   agent.model   || '')
      .replaceAll('{baseUrl}', agent.baseUrl || '')
      .replaceAll('{apiKey}',  agent.apiKey  || '');
    config[agent.key] = {
      ...agent,
      path: agent.path || '',
      inputMode: agent.inputMode,
      args: (prompt) => splitArgs(effectiveTemplate, prompt),
      checkArgs: () => splitArgs(agent.checkTemplate || '--help'),
      spawnOptions: {
        stdio: [agent.inputMode === 'stdin' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        env: buildAgentSpawnEnv(agent),
      },
    };
  }
  return config;
}

// ── NDJSON 解析器 ─────────────────────────────────────────────
// clowder-ai 对齐：各 agent CLI 均使用 --output-format stream-json / --json
// 解析器返回 { text, thinking } 或字符串（兼容旧调用）；返回 null 表示当前行无 chunk

function parseClaude(line) {
  // claude --output-format stream-json
  // - type=assistant → message.content[].text 是正文
  // - type=stream_event 中 thinking_delta 是思考流
  try {
    const e = JSON.parse(line);
    if (e.type === 'assistant') {
      const blocks = e.message?.content ?? [];
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
      const thinking = blocks.filter(b => b.type === 'thinking').map(b => b.thinking || b.text || '').join('');
      if (!text && !thinking) return null;
      return { text: text || '', thinking: thinking || '' };
    }
    if (e.type === 'stream_event') {
      const s = e.event;
      if (s?.type === 'content_block_delta') {
        const d = s.delta;
        if (d?.type === 'thinking_delta') return { text: '', thinking: d.thinking || '' };
        if (d?.type === 'text_delta') return { text: d.text || '', thinking: '' };
      }
    }
  } catch {}
  return null;
}

function parseCodex(line) {
  // codex exec --json 输出 JSONL，每行一个事件。常见类型：
  //   thread.started / turn.started  — 启动信号（无文本）
  //   agent_message_delta / item.delta — 增量文本（更早展现给用户）
  //   reasoning / agent_reasoning_delta — 思考流
  //   item.completed                 — 完整段输出（兜底）
  //   error / turn.failed           — 失败事件（必须抛出，否则前端傻等）
  try {
    const e = JSON.parse(line);
    // 失败事件 → 抛错让外层 reject
    if (e.type === 'error' || e.type === 'turn.failed') {
      const msg = e.message || e.error?.message || JSON.stringify(e);
      throw Object.assign(new Error(`codex: ${msg}`), { __agentError: true });
    }
    // 增量文本（不同 codex 版本字段名不同）
    if (e.type === 'agent_message_delta' && typeof e.delta === 'string') return { text: e.delta, thinking: '' };
    if (e.type === 'item.delta' && typeof e.delta?.text === 'string') return { text: e.delta.text, thinking: '' };
    if (e.type === 'response.output_text.delta' && typeof e.delta === 'string') return { text: e.delta, thinking: '' };
    // 思考流
    if (e.type === 'agent_reasoning_delta' && typeof e.delta === 'string') return { text: '', thinking: e.delta };
    if (e.type === 'response.reasoning.delta' && typeof e.delta === 'string') return { text: '', thinking: e.delta };
    // 完整段（兜底）
    if (e.type === 'item.completed' && e.item?.text) return { text: e.item.text, thinking: '' };
    if (e.type === 'agent_message' && typeof e.message === 'string') return { text: e.message, thinking: '' };
  } catch (err) {
    if (err && err.__agentError) throw err;
  }
  return null;
}

function parseKimi(line) {
  // kimi --output-format stream-json：正文、工具调用和工具结果是独立 NDJSON 行。
  try {
    const e = JSON.parse(line);
    if (e.type === 'error' || e.status === 'error' || e.error) {
      const raw = e.error?.message || e.message || e.error || JSON.stringify(e);
      throw Object.assign(new Error(String(raw)), { __agentError: true });
    }
    if (e.role === 'assistant') {
      const content = e.content;
      let text = '';
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) {
        text = content
          .map(b => (typeof b === 'string' ? b : (b?.text || b?.content || '')))
          .filter(Boolean)
          .join('');
      }
      let thinking = '';
      if (typeof e.thinking === 'string') thinking = e.thinking;
      else if (typeof e.reasoning === 'string') thinking = e.reasoning;
      else if (typeof e.reasoning_content === 'string') thinking = e.reasoning_content;
      const activities = Array.isArray(e.tool_calls)
        ? e.tool_calls.map((call) => {
            const fn = call?.function || {};
            let input = fn.arguments;
            try { input = typeof input === 'string' ? JSON.parse(input) : input; } catch {}
            return {
              id: String(call?.id || ''),
              phase: 'started',
              name: String(fn.name || call?.name || '工具'),
              summary: summarizeToolInput(input),
              input,
            };
          })
        : [];
      if (!text && !thinking && activities.length === 0) return null;
      return { text, thinking, activities };
    }
    if (e.role === 'tool') {
      return {
        text: '',
        thinking: '',
        activities: [{
          id: String(e.tool_call_id || ''),
          phase: 'completed',
          name: '',
          summary: summarizeToolResult(e.content),
          output: e.content,
        }],
      };
    }
  } catch (err) {
    if (err?.__agentError) throw err;
  }
  return null;
}

function summarizeToolInput(input) {
  if (input === null || input === undefined || input === '') return '';
  if (typeof input !== 'object') return String(input).replace(/\s+/g, ' ').slice(0, 120);
  const preferred = ['path', 'file_path', 'command', 'query', 'pattern', 'url', 'description'];
  for (const key of preferred) {
    if (input[key] !== null && input[key] !== undefined && input[key] !== '') {
      return String(input[key]).replace(/\s+/g, ' ').slice(0, 120);
    }
  }
  return Object.keys(input).slice(0, 4).join('、');
}

function summarizeToolResult(content) {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
  if (!text) return '无返回内容';
  const total = text.match(/Total lines in file:\s*(\d+)/i)?.[1];
  if (total) return `返回 ${total} 行`;
  const lines = text.split(/\r?\n/).length;
  return lines > 1 ? `返回 ${lines} 行` : `返回 ${text.length} 个字符`;
}

function parseText(line) {
  return `${line}\n`;
}

export function normalizeAgentFailure(agentKey, rawError, exitCode = null) {
  const agentName = String(agentKey || 'Agent');
  const detail = String(rawError?.message || rawError || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
  const rateLimited = /(?:\b429\b|too many requests|rate[\s_-]*limit(?:ed|ing)?|resource[_\s-]*exhausted)/i.test(detail);
  if (rateLimited) {
    return {
      code: 'rate_limited',
      httpStatus: 429,
      retryable: true,
      message: `${agentName === 'kimi' || agentName.startsWith('kimi-') ? 'Kimi' : agentName} 请求过于频繁（HTTP 429），本次执行已暂停。请稍后重试。`,
      detail,
      exitCode,
    };
  }
  return {
    code: 'agent_failed',
    httpStatus: null,
    retryable: false,
    message: detail || `${agentName} 执行失败${exitCode === null ? '' : `（退出码 ${exitCode}）`}`,
    detail,
    exitCode,
  };
}

export const PARSERS = { codex: parseCodex, claude: parseClaude, kimi: parseKimi };

export function resolveAgentParser(agentKey, cfg = {}) {
  if (PARSERS[agentKey]) return PARSERS[agentKey];
  const key = String(agentKey || '').toLowerCase();
  const path = String(cfg.path || '').toLowerCase();
  for (const [base, parser] of Object.entries(PARSERS)) {
    if (key.startsWith(`${base}-`) || key.startsWith(`${base}_`) || path.includes(base)) return parser;
  }
  return parseText;
}

// Parser 既支持旧版字符串，也支持结构化 { text, thinking, activities }。
// 静默调用（Plan/Reviewer）只应收集正文；直接拼接对象会得到 "[object Object]"。
export function parsedAgentOutputText(parsed) {
  if (typeof parsed === 'string') return parsed;
  if (!parsed || typeof parsed !== 'object') return '';
  return typeof parsed.text === 'string' ? parsed.text : '';
}

export function buildSpawnCommand(cfg, args) {
  const isCmd = cfg.path.toLowerCase().endsWith('.cmd');
  if (isCmd) {
    return {
      spawnPath: 'powershell',
      spawnArgs: ['-NoProfile', '-Command', "& '" + cfg.path + "' " + args.map(a => "'" + a.replace(/'/g, "''") + "'").join(' ')],
    };
  }
  return {
    spawnPath: cfg.path,
    spawnArgs: args,
  };
}

export function formatLaunchError(agentKey, err) {
  const code = err?.code ? `${err.code}: ` : '';
  return `${agentKey} 启动失败：${code}${err?.message || '未知错误'}`;
}

export function checkAgentLaunchable(agentKey, cfg, timeoutMs = 3000) {
  const path = cfg?.path || '';
  if (!path) {
    return Promise.resolve({
      key: agentKey,
      path,
      configured: false,
      exists: false,
      available: false,
      error: '未配置路径',
    });
  }

  if (!existsSync(path)) {
    return Promise.resolve({
      key: agentKey,
      path,
      configured: true,
      exists: false,
      available: false,
      error: '文件不存在',
    });
  }

  const args = cfg.checkArgs ? cfg.checkArgs() : ['--help'];
  const { spawnPath, spawnArgs } = buildSpawnCommand(cfg, args);

  return new Promise((resolve) => {
    let child;
    let finished = false;

    const finish = (available, error = '') => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        key: agentKey,
        path,
        configured: true,
        exists: true,
        available,
        error,
      });
    };

    const timer = setTimeout(() => {
      try { child?.kill('SIGTERM'); } catch {}
      finish(false, '检测超时，CLI 没有及时响应');
    }, timeoutMs);

    try {
      // 这里只做很轻的 --help 检测，用来确认“文件能不能被系统启动”。
      child = spawn(spawnPath, spawnArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      child.on('error', (err) => {
        if (err.code === 'EPERM') {
          finish(true, '');
        }
      });
    } catch (err) {
      finish(false, formatLaunchError(agentKey, err));
      return;
    }

    child.on('error', (err) => {
      finish(false, formatLaunchError(agentKey, err));
    });

    child.on('close', (code) => {
      if (code === 0) finish(true);
      else finish(false, `检测命令退出码 ${code}`);
    });
  });
}

// ── Agent 调用（stdin pipe，支持 .cmd 自动中转 cmd.exe） ───────
// 教训1 (02-cli-engineering): readline 接管 stdout 后 child.stdout.on('data') 不再触发。
//   watchdog 必须在 rl.on('line') 和 stderr.on('data') 里刷新，不能只靠 stdout 流。
// 教训1: 超时时间 30min，匹配复杂任务（代码分析/长篇写作）实际需要。
export function invokeAgent(CLI_CONFIG, agentKey, prompt, {
  silent = false,
  timeoutMs = 30 * 60 * 1000,
  outputSchemaPath = '',
} = {}) {
  const cfg = CLI_CONFIG[agentKey];
  if (!cfg?.path) throw new Error(`${agentKey} 路径未在 .env 中配置（${agentKey.toUpperCase()}_PATH）`);

  const parser = resolveAgentParser(agentKey, cfg);

  const args = cfg.args(prompt);
  if (outputSchemaPath && agentKey === 'codex' && !args.includes('--output-schema')) {
    args.push('--output-schema', outputSchemaPath);
  }
  const { spawnPath, spawnArgs } = buildSpawnCommand(cfg, args);

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let watchdog = null;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearInterval(watchdog);
      reject(err);
    };

    try {
      child = spawn(spawnPath, spawnArgs, cfg.spawnOptions);
    } catch (err) {
      fail(new Error(formatLaunchError(agentKey, err)));
      return;
    }

    child.on('error', (err) => {
      fail(new Error(formatLaunchError(agentKey, err)));
    });

    if (cfg.inputMode !== 'arg') {
      try {
        child.stdin.write(prompt, 'utf8');
        child.stdin.end();
      } catch (err) {
        fail(new Error(formatLaunchError(agentKey, err)));
        return;
      }
    }

    let fullText = '';
    let stderrText = '';
    let lastActivity = Date.now();
    // 教训1: 只靠 stdout 会漏掉 thinking/工具调用期间的 stderr 活跃信号
    const touch = () => { lastActivity = Date.now(); };

    watchdog = setInterval(() => {
      if (Date.now() - lastActivity > timeoutMs) {
        child.kill('SIGTERM');
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 3000);
        fail(new Error(`timeout after ${timeoutMs / 60000}min`));
      }
    }, 10_000);

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      touch(); // 教训1: readline 接管后在这里刷新 watchdog
      if (!line.trim()) return;
      const text = parsedAgentOutputText(parser(line));
      if (text) {
        if (!silent) process.stdout.write(text);
        fullText += text;
      }
    });

    child.stderr?.on('data', (data) => {
      touch(); // 教训1: stderr 也是活跃信号（thinking/工具调用输出在这里）
      const msg = data.toString();
      stderrText += msg;
      if (stderrText.length > 4000) stderrText = stderrText.slice(-4000);
      if (msg.includes('Reading additional input')) return;
      if (!silent) process.stderr.write(`[stderr] ${msg}`);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      if (!silent) process.stdout.write('\n');
      if (code !== 0) {
        const detail = stderrText.trim();
        reject(new Error(detail ? `exit code ${code}: ${detail}` : `exit code ${code}`));
      }
      else resolve(fullText);
    });
  });
}

// ── Output Parsers 重导出（从 output-parsers.mjs） ───────────
// 旧版 extractJson / parseReviewResult / validatePlanResult / repairJson 已迁至 output-parsers.mjs。
// 此处重导出以保持所有 import 方（server.mjs / dispatch.mjs / plan.mjs）无感知兼容。
export {
  extractJson,
  parseReviewResult,
  validatePlanResult,
  parsePlanOutput,
  parseReviewOutput,
  getPlanFormatInstructions,
  getReviewFormatInstructions,
} from './output-parsers.mjs';

export function readTasks() {
  return repository.list('tasks').map((task) => normalizeTaskRecord(task));
}

export function writeAllTasks(tasks) {
  repository.replace('tasks', tasks.map((task) => normalizeTaskRecord(task, {
    preferLegacy: task?.lifecycle?.source !== 'canonical',
  })));
}

export function appendTask(record) {
  return repository.append('tasks', normalizeTaskRecord(record, { preferLegacy: true }));
}

export function patchTask(id, patch) {
  const task = repository.get('tasks', id);
  if (!task) return null;
  const { lifecycle_event_id: eventId = '', lifecycle_reason: reason = '', ...taskPatch } = patch;
  const updated = synchronizeTaskRecord(task, taskPatch, {
    eventId,
    reason,
  });
  repository.upsert('tasks', updated);
  return updated;
}

// ── 轻量 SOP 状态机 ──────────────────────────────────────────
// 阶段：pending → impl → quality_gate → review → gate → done
// 每个阶段转换时检查前置条件，防止跳步

export const SOP_PHASES = ['pending', 'impl', 'quality_gate', 'review', 'gate', 'done'];

export const SOP_TRANSITIONS = {
  pending:      { next: 'impl',          requires: [] },
  impl:         { next: 'quality_gate',  requires: ['status=done'] },
  quality_gate: { next: 'review',        requires: ['quality_gate_status=pass'] },
  review:       { next: 'gate',          requires: ['review_status=pass'] },
  gate:         { next: 'done',          requires: ['gate_status=passed'] },
  done:         { next: null,            requires: [] },
};

export function validatePhaseTransition(task, targetPhase) {
  const currentPhase = task.phase || 'pending';
  const currentIdx = SOP_PHASES.indexOf(currentPhase);
  const targetIdx = SOP_PHASES.indexOf(targetPhase);

  if (targetIdx === -1) {
    return { ok: false, reason: `未知阶段：${targetPhase}` };
  }
  if (targetIdx <= currentIdx) {
    return { ok: false, reason: `不能回退：${currentPhase} → ${targetPhase}` };
  }

  // 检查前置条件
  const transition = SOP_TRANSITIONS[currentPhase];
  if (!transition || transition.next !== targetPhase) {
    return { ok: false, reason: `不允许跳步：${currentPhase} → ${targetPhase}（必须经过 ${transition?.next || '无'}）` };
  }

  for (const req of transition.requires) {
    const [field, value] = req.split('=');
    if (task[field] !== value) {
      return { ok: false, reason: `前置条件未满足：${field}=${value}（当前 ${task[field] || 'null'}）` };
    }
  }

  return { ok: true };
}

export function getNextPhase(task) {
  const currentPhase = task.phase || 'pending';
  const transition = SOP_TRANSITIONS[currentPhase];
  return transition?.next || null;
}
