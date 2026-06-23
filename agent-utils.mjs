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

// ── JSON 提取 + 幻觉限制验证 ─────────────────────────────────
// 教训2 (02-cli-engineering): AI 会产生幻觉，解析结果要做二次验证。
// IMP-005: 修复贪心匹配问题，使用括号配对算法找到第一个完整的 JSON 对象
export function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  // strip markdown code fences and common wrapper noise
  let cleaned = text.replace(/```(?:json|JSON)?\s*/g, '```').replace(/```/g, '');
  // Strategy 1: find ALL balanced {...} candidates and try JSON.parse on each.
  // Handles JSON surrounded by prose, multiple blocks, trailing content.
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
  // Strategy 2: try repairing truncated JSON by closing open braces/brackets.
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

export function parseReviewResult(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const parsed = extractJson(text);
  const candidate = parsed?.review && typeof parsed.review === 'object'
    ? parsed.review
    : parsed?.result && typeof parsed.result === 'object'
      ? parsed.result
      : parsed;
  const explicit = String(candidate?.verdict || '').trim().toLowerCase();
  const fallback = text.match(/\bverdict\s*["']?\s*[:=：]\s*["']?\s*(pass|rework)\b/i)?.[1]?.toLowerCase() || '';
  const verdict = ['pass', 'rework'].includes(explicit) ? explicit : fallback;
  if (!verdict) return null;
  const rawScore = Number(candidate?.score);
  const score = Number.isFinite(rawScore)
    ? Math.max(0, Math.min(10, rawScore > 10 && rawScore <= 100 ? rawScore / 10 : rawScore))
    : candidate?.score;
  return {
    ...(candidate && typeof candidate === 'object' ? candidate : {}),
    verdict,
    score,
  };
}

// Best-effort repair of truncated/malformed JSON: trim trailing commas,
// close unterminated strings, and balance braces/brackets.
function repairJson(s) {
  let t = s;
  // remove trailing commas before } or ]
  t = t.replace(/,\s*([}\]])/g, '$1');
  // balance brackets
  let braces = 0, brackets = 0, inStr = false, esc = false;
  let lastQuoteIdx = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; lastQuoteIdx = i; continue; }
    if (inStr) continue;
    if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === '[') brackets++;
    else if (c === ']') brackets--;
  }
  // if a string is still open, close it
  if (inStr) t += '"';
  // close unbalanced brackets/braces
  while (brackets > 0) { t += ']'; brackets--; }
  while (braces > 0) { t += '}'; braces--; }
  return t;
}

// 教训2: 对 plan 结果做严格验证，tasks 非空且每条必含 title，防止幻觉写入
export function validatePlanResult(data) {
  if (!data || typeof data !== 'object') return { ok: false, reason: '返回值不是对象' };
  if (!Array.isArray(data.tasks) || data.tasks.length === 0) return { ok: false, reason: 'tasks 数组为空或缺失' };
  for (let i = 0; i < data.tasks.length; i++) {
    const t = data.tasks[i];
    if (!t || typeof t !== 'object') return { ok: false, reason: `tasks[${i}] 不是对象` };
    if (!t.title || typeof t.title !== 'string' || !t.title.trim()) {
      return { ok: false, reason: `tasks[${i}] 缺少 title 字段` };
    }
  }
  return { ok: true };
}

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

// ── 共享 Prompt（IMP-004: 从 server.mjs / plan.mjs / dispatch.mjs 抽取） ──
// 对齐 clowder-ai cross-cat-handoff 五件套（What/Why/Tradeoff/Open/Next）
// 拆任务时同步产出 why / tradeoff / open_questions，让接手 agent 知道"为什么这么做"
export const PLAN_PROMPT = `你是 myteam 的任务规划 agent。
用户会给你一个目标，把它拆成 3-7 个可执行、可验收的小任务。

【强制规则】
- 无论用户说什么，你的唯一输出是下方 JSON，不得有任何其他文字
- 不要分析用户意图，不要解释，不要思考过程，不要 markdown 代码块
- 如果目标是一个问题或闲聊，也必须把它拆成任务返回，不要直接回答
- 第一个字符必须是 {，最后一个字符必须是 }
- 严禁调用任何工具（包括 view_image / read_image / read_file / web_search / shell 等）。本阶段不需要看图或读文件。如果任务需要这些操作，请把"分析图片"或"阅读文件"作为子任务标题写到 JSON 里，由后续执行阶段处理。
- 严禁请求授权、严禁等待用户确认。直接基于用户文字目标拆解。

【交接五件套规则（对齐 clowder-ai cross-cat-handoff）】
- title 是 What（做什么）；steps 是怎么做；accept 是怎么算完
- why 必填：为什么这个任务存在、不做会怎样
- tradeoff 可选：放弃了哪个备选方案，一句话即可，没有就写空串
- 默认自主采用合理假设和行业常见默认值，不要因为一般偏好、可逆选择或能从上下文推断的信息反问用户
- 只有缺失信息会让任务无法继续、造成明显错误或触发不可逆风险时，才填写 open_questions；最多 3 项，否则写 []
- 每个 open_questions 项必须给出 question 和 1-3 个互斥、可直接选择的 options；界面会额外提供“其他”文本选项

严格按以下 JSON 格式返回：
{
  "goal": "<原始目标>",
  "tasks": [
    {
      "title": "<任务标题：What>",
      "why": "<为什么要做这个任务>",
      "tradeoff": "<放弃的备选方案，可空>",
      "open_questions": [{"question": "<确实无法合理推断的问题>", "options": ["<推荐选项>", "<备选项>"]}],
      "steps": ["<步骤1>", "<步骤2>"],
      "accept": "<验收标准>",
      "agent": "<推荐执行者: claude|codex|kimi>"
    }
  ]
}`;

export function buildExecPrompt(task, skillContext = '') {
  const steps = (task.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const accept = task.accept ? `\n验收标准：${task.accept}` : '';
  const reworkNote = task.review_note ? `\n返工说明：${task.review_note}` : '';
  const previousResult = task.previous_result
    ? `\n上一次结果摘要：${String(task.previous_result).slice(0, 600)}`
    : '';
  const skills = skillContext ? `\n本次按需加载的 Skills：\n${skillContext}` : '';

  // 五件套交接上下文（对齐 clowder-ai cross-cat-handoff）
  // 让接手 agent 看到 Why / Tradeoff / Open Questions，避免"只知道做什么不知道为什么"
  const handoffParts = [];
  if (task.why)       handoffParts.push(`Why（为什么做）：${task.why}`);
  if (task.tradeoff)  handoffParts.push(`Tradeoff（放弃的方案）：${task.tradeoff}`);
  const openList = Array.isArray(task.open_questions) ? task.open_questions.filter(Boolean) : [];
  if (openList.length) handoffParts.push(`Open Questions（待澄清点）：\n${openList.map(q => `  - ${typeof q === 'string' ? q : q.question}`).join('\n')}`);
  const clarificationAnswers = Array.isArray(task.clarification_answers) ? task.clarification_answers : [];
  if (clarificationAnswers.length) handoffParts.push(`用户确认结果：\n${clarificationAnswers.map(item => `  - ${item.question} → ${item.answer}`).join('\n')}`);
  if (task.clarification_other) handoffParts.push(`用户其他补充：${task.clarification_other}`);
  const handoff = handoffParts.length ? `\n【上游交接】\n${handoffParts.join('\n')}` : '';

  // 上游任务结果（A2A 链式时由调用方注入，结构化展示）
  const upstreamCtx = task.upstream_context ? `\n【上游任务输出】\n${String(task.upstream_context).slice(0, 800)}` : '';

  return `你是 myteam 的执行 agent，请完成以下任务。

【自主执行原则】
- 优先根据任务上下文、行业常见默认值和可逆方案自主完成，不要把能够自行判断的问题反问用户
- 计划阶段的必要确认已经在 open_questions 中处理；执行时如仍有轻微歧义，采用风险最低的合理假设并在结果中说明
- 只有缺失信息会导致任务完全无法继续或产生明显不可逆风险时，才停止并说明阻塞原因

任务标题：${task.title}
所属目标：${task.goal}
${handoff}
执行步骤：
${steps || '（无具体步骤，请自行判断）'}
${accept}
${reworkNote}
${previousResult}
${upstreamCtx}
${skills}

请执行上述任务，给出完整的执行结果和说明。
如有未澄清的 Open Questions，请在结果开头先给出你的处理方式。`;
}

// ── 自动 reviewer prompt（对齐 clowder-ai cross-model review 铁律） ──
// 让另一个 agent 审已完成任务，输出结构化 JSON：verdict / severity / findings / suggestion
// 铁律：reviewer 必须 != executor（同猫不能 review 自己）
export const REVIEW_PROMPT_RULES = `你是 myteam 的 Reviewer agent。
你正在 review 另一个 agent 的任务执行结果。

【强制规则】
- 唯一输出是 JSON，第一个字符必须是 {，最后一个字符必须是 }
- 不要 markdown 代码块、不要解释、不要思考过程
- 严禁调用任何工具
- 严禁请求授权或等待用户确认

【评审维度】
1. 验收对齐：执行结果是否覆盖了 accept 标准
2. 五件套呼应：是否回应了 Why / Tradeoff / Open Questions
3. 完整性：steps 是否都执行
4. 质量：是否有明显错误、遗漏或幻觉

【严重度】
- P1: 阻塞合入，必须返工
- P2: 应当修复，但可在下一轮处理
- P3: nice to have

严格按以下 JSON 返回：
{
  "verdict": "<pass|rework>",
  "severity": "<none|P1|P2|P3>",
  "score": <0-10 整数>,
  "findings": ["<具体问题1>", "<具体问题2>"],
  "suggestion": "<给执行 agent 的下一步建议，一句话>"
}`;

export function buildReviewPrompt(task, executorAgent, executionResult) {
  const openList = Array.isArray(task.open_questions) ? task.open_questions.filter(Boolean).map(q => typeof q === 'string' ? q : q.question) : [];
  const handoffParts = [];
  if (task.why)      handoffParts.push(`Why：${task.why}`);
  if (task.tradeoff) handoffParts.push(`Tradeoff：${task.tradeoff}`);
  if (openList.length) handoffParts.push(`Open Questions：${openList.join(' / ')}`);
  const handoff = handoffParts.length ? `\n【原始交接五件套】\n${handoffParts.join('\n')}` : '';
  const steps = (task.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n');

  return `${REVIEW_PROMPT_RULES}

【被审任务】
任务标题：${task.title}
所属目标：${task.goal}
执行 agent：${executorAgent}
${handoff}
执行步骤：
${steps || '（无）'}
验收标准：${task.accept || '（未指定）'}

【执行结果】
${String(executionResult || '').slice(0, 2000)}

请给出结构化 review JSON。`;
}

// ── 轻量 SOP 状态机（对齐 clowder-ai development.yaml） ──
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
