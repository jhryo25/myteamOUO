// myteam HTTP server — REST API + SSE
// 用法：node server.mjs [--port 7878]

import { createServer } from 'http';
import { get as httpsGet } from 'https';
import { get as httpGetModule } from 'http';
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, readdirSync, rmSync, statSync, lstatSync, realpathSync } from 'fs';
import { resolve, basename, dirname, extname, join, sep, relative } from 'path';
import { randomUUID, createHash } from 'crypto';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { loadEnv, buildCliConfig, invokeAgent, extractJson, resolveAgentParser, readTasks, writeAllTasks, appendTask, patchTask, PLAN_PROMPT, buildExecPrompt, buildReviewPrompt, AGENT_KEYS, buildSpawnCommand, checkAgentLaunchable, formatLaunchError, readAgentRegistry, writeAgentRegistry, sanitizeAgentKey, buildRoleCard, validatePhaseTransition, getNextPhase, selectRunnableAgent } from './agent-utils.mjs';
import { getDangerLevel, openPathWithDefaultApp, resolveWorkspaceHtmlPath } from './commandSafety.mjs';
import { repository } from './storage.mjs';
import {
  appendAudit,
  approvalResponse,
  authorizeOperation,
  decideApproval,
  listApprovals,
  listAudit,
  redactSensitive,
} from './governance.mjs';
import { ScheduleService } from './scheduler.mjs';
import {
  ensurePlanSchemaFile,
  parseStructuredPlanOutput,
  buildContinuityCapsule,
  formatContinuityBridge,
  buildTopKEvidenceBridge,
  buildWorkspaceBridge,
  SPAWN_SUBAGENT_PROTOCOL,
  parseSpawnSubagentDirectives,
  createSubagentRun,
  updateSubagentRun,
  listSubagentRuns,
  recoverStaleSubagentRuns,
  appendSubagentMessage,
  listSubagentMessages,
  createTurnPartsCollector,
} from './collaboration-context.mjs';

let ENV = loadEnv();
let CLI_CONFIG = buildCliConfig(ENV);
const LESSONS_FILE = '.myteam/lessons.jsonl';
const SKILLS_FILE = '.myteam/skills.yaml';
const SKILLS_DIR = '.myteam/skills';
const SKILLS_STATE_FILE = '.myteam/skills-state.json';
const INVOCATIONS_FILE = '.myteam/invocations.jsonl';
const SETTINGS_FILE = '.myteam/settings.json';
const UPLOADS_DIR = '.myteam/uploads';
const OUTPUTS_DIR = '.myteam/outputs';
const PLAN_SCHEMA_FILE = ensurePlanSchemaFile();
recoverStaleSubagentRuns();

// skill 市场远程源配置
const SKILL_SOURCES = {
  'myteam-official': {
    label: 'myteam 官方',
    indexUrl: 'https://raw.githubusercontent.com/jhryo25/myteamOUO/main/skills-registry/index.json',
    localIndexPath: 'skills-registry/index.json',
    localBase: 'skills-registry',
    type: 'index',
  },
  'clowder-ai': {
    label: 'clowder-ai',
    indexUrl: 'https://raw.githubusercontent.com/zts212653/clowder-ai/main/cat-cafe-skills/manifest.yaml',
    rawBase: 'https://raw.githubusercontent.com/zts212653/clowder-ai/main/cat-cafe-skills',
    type: 'manifest',
  },
};

// A2A chain task store
const chainTaskMessages = new Map();
const chainTaskSSE = new Map();

function pushChainMessage(taskId, msg) {
  if (!chainTaskMessages.has(taskId)) chainTaskMessages.set(taskId, []);
  chainTaskMessages.get(taskId).push({ ...msg, timestamp: new Date().toISOString() });
  const listeners = chainTaskSSE.get(taskId);
  if (listeners) {
    const sseData = 'data: ' + JSON.stringify(msg) + '\n\n';
    for (const res of listeners) {
      try { res.write(sseData); } catch {}
    }
  }
}

function getChainMessages(taskId) {
  return chainTaskMessages.get(taskId) || [];
}

const shellResults = new Map();

function executeShell(command, runId, context = {}) {
  shellResults.set(runId, { stdout: '', stderr: '', exitCode: null, done: false, startedAt: new Date().toISOString() });
  const isWin = process.platform === 'win32';
  const child = spawn(isWin ? 'powershell' : 'sh', [isWin ? '-Command' : '-c', command], {
    stdio: 'pipe',
    cwd: process.cwd(),
    timeout: 30000,
    windowsHide: true,
  });
  child.stdout.on('data', (d) => {
    const text = d.toString();
    const cur = shellResults.get(runId);
    if (cur) { cur.stdout += text; shellResults.set(runId, cur); }
  });
  child.stderr.on('data', (d) => {
    const text = d.toString();
    const cur = shellResults.get(runId);
    if (cur) { cur.stderr += text; shellResults.set(runId, cur); }
  });
  child.on('close', (code) => {
    const cur = shellResults.get(runId);
    if (cur) { cur.exitCode = code; cur.done = true; cur.finishedAt = new Date().toISOString(); shellResults.set(runId, cur); }
    appendAudit({ operation: 'shell.execute', decision: context.approvalId ? 'authorized' : 'safe_policy', result: code === 0 ? 'succeeded' : 'failed', approvalId: context.approvalId, sessionId: context.sessionId, details: { command, runId, exitCode: code } });
  });
  child.on('error', (err) => {
    const cur = shellResults.get(runId);
    if (cur) { cur.stderr += err.message; cur.exitCode = -1; cur.done = true; cur.finishedAt = new Date().toISOString(); shellResults.set(runId, cur); }
    appendAudit({ operation: 'shell.execute', decision: context.approvalId ? 'authorized' : 'safe_policy', result: 'failed', approvalId: context.approvalId, sessionId: context.sessionId, details: { command, runId, error: err.message } });
  });
}

function findSkillMdInDir(dir) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isFile() && entry.name === 'SKILL.md') return full;
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        const found = findSkillMdInDir(full);
        if (found) return found;
      }
    }
  } catch {}
  return null;
}

function sanitizeSkillName(name) {
  return String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unnamed';
}

function inferSkillName(mdContent, fallback = '') {
  const frontmatter = String(mdContent || '').match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
  const source = frontmatter ? frontmatter[1] : String(mdContent || '').slice(0, 800);
  const match = source.match(/^\s*name:\s*["']?([^"'\r\n#]+)["']?\s*$/m);
  return sanitizeSkillName(match ? match[1] : fallback);
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    if (process.platform === "win32") {
      const cmd = "Expand-Archive -LiteralPath '" + zipPath + "' -DestinationPath '" + destDir + "' -Force";
      const ps = spawn("powershell", ["-NoProfile", "-Command", cmd], { stdio: "pipe" });
      ps.on("close", code => code === 0 ? resolve() : reject(new Error("Expand-Archive exit " + code)));
      ps.stderr.on("data", d => {});
    } else {
      const ps = spawn("unzip", ["-o", zipPath, "-d", destDir], { stdio: "pipe" });
      ps.on("close", code => code === 0 ? resolve() : reject(new Error("unzip exit " + code)));
      ps.stderr.on("data", d => {});
    }
  });
}

function parseGithubUrl(url) {
  const m = String(url).match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:$|\/)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

function isRemoteUrl(str) { return /^https?:\/\//.test(str); }

function cloneAndFindSkillMd(gitUrl) {
  return new Promise((resolve, reject) => {
    const tmpDir = ".myteam/.tmp-skill-clone-" + randomUUID().slice(0,6);
    mkdirSync(tmpDir, { recursive: true });
    const ps = spawn("git", ["clone", "--depth", "1", gitUrl, tmpDir], { stdio: "pipe" });
    let err = "";
    ps.stderr.on("data", d => { err += d.toString(); });
    ps.on("close", code => {
      if (code !== 0) return reject(new Error("git clone failed: " + err.slice(0,200)));
      function findSkillMd(dir) {
        try {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isFile() && entry.name === "SKILL.md") return full;
            if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
              const found = findSkillMd(full);
              if (found) return found;
            }
          }
        } catch {}
        return null;
      }
      const found = findSkillMd(tmpDir);
      if (!found) {
        rmSync(tmpDir, { recursive: true, force: true });
        return reject(new Error("SKILL.md not found in repo"));
      }
      const content = readFileSync(found, "utf8");
      const parsed = parseGithubUrl(gitUrl);
      const skillName = inferSkillName(content, parsed?.repo || basename(dirname(found)));
      rmSync(tmpDir, { recursive: true, force: true });
      resolve({ name: skillName, mdContent: content });
    });
  });
}

const AGENT_STATUS_TTL_MS = 5000;
let agentStatusCache = { time: 0, agents: null };

// ── Studio 团队模板 ───────────────────────────────────────────────────────────
const STUDIO_TEMPLATES = [
  {
    id: 'quick-prototype',
    name: '🚀 快速原型',
    desc: '2 人轻量：Codex 拆任务 + Kimi 快速执行，适合小目标快速出结果。',
    agents: [
      {
        key: 'codex', label: 'Codex', emoji: '🤖',
        roleDescription: '任务规划专家，把目标拆成可验收的子任务并分配给 Kimi 执行。',
        personality: '严谨、有条理、强调验收标准',
        strengths: ['任务拆解', '优先级排序', '验收标准撰写'],
        restrictions: ['不直接编码', '不做最终实现决策'],
      },
      {
        key: 'kimi', label: 'Kimi', emoji: '🌙',
        roleDescription: '快速执行者，接收明确的小任务并尽快产出结果。',
        personality: '高效、简洁、直接给出结果',
        strengths: ['快速执行', '简单任务', '草稿生成'],
        restrictions: [],
      },
    ],
  },
  {
    id: 'full-stack',
    name: '🏗️ 全栈协作',
    desc: '经典 3 人：Codex 规划 + Claude 深度实现 + Kimi 轻量执行，适合中等复杂度项目。',
    agents: [
      {
        key: 'codex', label: 'Codex', emoji: '🤖',
        roleDescription: '总控：拆任务、分配角色、协调进度，负责最终审查和经验沉淀。',
        personality: '严谨、务实、追求代码质量',
        strengths: ['任务拆解', '代码审查', '进度协调'],
        restrictions: ['不直接编码', '不做最终实现决策'],
      },
      {
        key: 'claude', label: 'Claude', emoji: '✦',
        roleDescription: '主架构 / 深度实现：负责复杂模块、架构设计、高质量代码生成。',
        personality: '善于推理、思维发散、喜欢先理解全局再落地细节',
        strengths: ['架构设计', '复杂推理', '长文档生成'],
        restrictions: [],
      },
      {
        key: 'kimi', label: 'Kimi', emoji: '🌙',
        roleDescription: '轻量执行：负责简单任务、草稿补全、CLI 命令执行。',
        personality: '高效、简洁、直接给出结果',
        strengths: ['快速执行', '简单任务', '草稿生成'],
        restrictions: [],
      },
    ],
  },
  {
    id: 'strict-review',
    name: '🔍 严格审查',
    desc: '高质量保障：Codex 规划 + Claude 实现兼审查 + Kimi 执行，双重把关不放水。',
    agents: [
      {
        key: 'codex', label: 'Codex', emoji: '🤖',
        roleDescription: '总控：拆任务、分配角色、最终经验沉淀。坚持验收标准不降低。',
        personality: '严格、务实、不接受"差不多好了"',
        strengths: ['任务拆解', '验收标准撰写', '经验沉淀'],
        restrictions: ['不直接编码'],
      },
      {
        key: 'claude', label: 'Claude', emoji: '✦',
        roleDescription: '主力实现 + 审查官：既负责复杂代码，也负责 Reviewer Gate 决策，引用证据而不是主观感受。',
        personality: '严格、关注细节、引用证据说话',
        strengths: ['架构设计', '代码审查', '逻辑核对', '安全检查'],
        restrictions: ['不跳过测试', '不降低验收标准'],
      },
      {
        key: 'kimi', label: 'Kimi', emoji: '🌙',
        roleDescription: '快速执行：接收明确子任务，执行并汇报结果给 Claude 审查。',
        personality: '高效、透明汇报、不隐瞒错误',
        strengths: ['快速执行', '简单任务'],
        restrictions: ['必须如实汇报执行结果和错误'],
      },
    ],
  },
  {
    id: 'research',
    name: '📖 研究调研',
    desc: '2 人深研：Claude 深度分析 + Codex 归纳整理，适合技术调研、方案评估、文档生成。',
    agents: [
      {
        key: 'claude', label: 'Claude', emoji: '✦',
        roleDescription: '首席研究员：多角度分析、拆解技术方案、产出结构化报告。',
        personality: '细心、引用准确、总结清晰',
        strengths: ['资料检索', '源码解读', '技术对比', '撰写报告'],
        restrictions: ['不做实现', '不下架构结论'],
      },
      {
        key: 'codex', label: 'Codex', emoji: '🤖',
        roleDescription: '整合归纳：把 Claude 的研究成果整理成可操作的任务列表和决策文档。',
        personality: '清晰、简洁、面向行动',
        strengths: ['归纳总结', '任务化输出', '文档整理'],
        restrictions: ['不重复 Claude 的分析'],
      },
    ],
  },
];

function agentKeys() {
  return Object.keys(CLI_CONFIG);
}

function loadSettings() {
  const fallback = { workspace: resolve('.') };
  if (!existsSync(SETTINGS_FILE)) return fallback;
  try {
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...fallback, ...data, workspace: data.workspace || fallback.workspace };
  } catch {
    return fallback;
  }
}

function saveSettings(settings) {
  mkdirSync('.myteam', { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

function currentWorkspace() {
  return resolve(loadSettings().workspace || '.');
}

function reloadAgentConfig() {
  ENV = loadEnv();
  CLI_CONFIG = buildCliConfig(ENV);
  clearAgentStatusCache();
}

async function getAgentStatuses({ force = false } = {}) {
  const now = Date.now();
  if (!force && agentStatusCache.agents && now - agentStatusCache.time < AGENT_STATUS_TTL_MS) {
    return agentStatusCache.agents;
  }

  const metaByKey = new Map(readAgentRegistry(ENV).map(agent => [agent.key, agent]));
  const agents = await Promise.all(
    agentKeys().map(async (k) => ({
      ...(await checkAgentLaunchable(k, CLI_CONFIG[k])),
      ...(metaByKey.get(k) || {}),
      path: CLI_CONFIG[k]?.path || '',
    }))
  );
  agentStatusCache = { time: now, agents };
  return agents;
}

function clearAgentStatusCache() {
  agentStatusCache = { time: 0, agents: null };
}

// 返回给客户端前剥掉敏感字段，保留脱敏提示
function stripSensitive(agent) {
  const { apiKey, ...safe } = agent;
  const key = String(apiKey || '');
  safe.hasApiKey = key.length > 0;
  safe.apiKeyMasked = key.length > 4
    ? '••••' + key.slice(-4)
    : key.length > 0 ? '••••' : '';
  return safe;
}

async function resolveRunnableAgent(preferredAgent) {
  const statuses = await getAgentStatuses();
  const preferred = agentKeys().includes(preferredAgent) ? preferredAgent : '';
  const chosen = selectRunnableAgent(statuses, preferred);
  return { agentKey: chosen?.key || preferred || agentKeys()[0] || 'codex', status: chosen };
}

function appendLesson(task, error) {
  // 自动 pattern 分类（对齐 clowder-ai self-evolution Mode B）
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
    error: errMsg.slice(0, 500),
    pattern,
    timestamp: new Date().toISOString(),
  };
  return repository.append('lessons', lesson);
}

// 检测重复 pattern（对齐 clowder-ai self-evolution：同类错误 ≥2 次触发改进提案）
function detectPatterns() {
  const lessons = readJsonl(LESSONS_FILE);
  const byPattern = {};
  for (const l of lessons) {
    const p = l.pattern || 'unknown';
    if (!byPattern[p]) byPattern[p] = [];
    byPattern[p].push(l);
  }

  const patterns = Object.entries(byPattern)
    .map(([pattern, items]) => ({
      pattern,
      count: items.length,
      agents: [...new Set(items.map(i => i.agent))],
      first: items[0]?.timestamp,
      last: items[items.length - 1]?.timestamp,
      sample: items[0]?.error?.slice(0, 200) || '',
      needsProposal: items.length >= 2,
    }))
    .sort((a, b) => b.count - a.count);

  return patterns;
}

// 生成改进提案（对齐 clowder-ai Evolution Proposal 5 槽模板）
function generateProposal(pattern) {
  const lessons = readJsonl(LESSONS_FILE).filter(l => l.pattern === pattern.pattern);
  return {
    id: `EP-${randomUUID().slice(0, 6)}`,
    trigger: `同类错误 "${pattern.pattern}" 出现 ${pattern.count} 次`,
    evidence: lessons.slice(0, 5).map(l => `${l.timestamp} [${l.agent}] ${l.task_title}: ${l.error?.slice(0, 100)}`),
    root_cause: `pattern=${pattern.pattern}，涉及 agent: ${pattern.agents.join(', ')}`,
    lever: `最小杠杆：检查 ${pattern.agents.join('/')} 的配置和连接稳定性`,
    verify: `修复后同类错误不再出现`,
    created_at: new Date().toISOString(),
  };
}

function parseScalar(value) {
  const v = String(value || '').trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v.replace(/^["']|["']$/g, '');
}

// ── SKILL.md frontmatter 解析 ──────────────────────────────────────────────
function parseSkillFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm = {};
  let current = null;
  let inList = null; // 当前正在解析的数组字段名

  for (const raw of match[1].split('\n')) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 列表项
    if (trimmed.startsWith('- ')) {
      const val = trimmed.slice(2).trim().replace(/^["']|["']$/g, '');
      if (inList) {
        if (!Array.isArray(fm[inList])) fm[inList] = [];
        fm[inList].push(val);
      }
      continue;
    }

    const kv = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim().replace(/^["']|["']$/g, '');

    if (val === '') {
      // 下一行是列表
      inList = key;
      fm[key] = [];
    } else if (key === 'mounts') {
      inList = null;
      fm.mounts = fm.mounts || {};
    } else if (current === 'mounts' || (inList === null && line.startsWith('  '))) {
      // mounts 下的 key: true/false
      fm.mounts = fm.mounts || {};
      fm.mounts[key] = val === 'true';
    } else {
      inList = null;
      fm[key] = val === 'true' ? true : val === 'false' ? false : val;
    }

    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      current = key;
    }
  }
  return fm;
}

function parseSkillFrontmatterRobust(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const block = match[1];
  const result = { mounts: {}, triggers: [], next: [] };
  let mode = null; // 'triggers' | 'next' | 'mounts' | null

  for (const raw of block.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;

    const indent = line.match(/^(\s*)/)[1].length;

    if (trimmed.startsWith('- ')) {
      const val = trimmed.slice(2).trim().replace(/^["']|["']$/g, '');
      if (mode === 'triggers') { result.triggers.push(val); continue; }
      if (mode === 'next')     { result.next.push(val); continue; }
      continue;
    }

    const kv = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim().replace(/^["']|["']$/g, '');

    if (indent >= 2 && mode === 'mounts') {
      result.mounts[key] = val === 'true';
      continue;
    }

    // 顶层字段
    mode = null;
    if (val === '') {
      if (key === 'triggers') { mode = 'triggers'; }
      else if (key === 'next') { mode = 'next'; }
      else if (key === 'mounts') { mode = 'mounts'; }
    } else {
      result[key] = val === 'true' ? true : val === 'false' ? false : val;
    }
  }

  return result;
}

// ── skills-state.json 读写 ─────────────────────────────────────────────────
function readSkillsState() {
  if (!existsSync(SKILLS_STATE_FILE)) return {};
  try { return JSON.parse(readFileSync(SKILLS_STATE_FILE, 'utf8')); }
  catch { return {}; }
}

function writeSkillsState(state) {
  mkdirSync('.myteam', { recursive: true });
  writeFileSync(SKILLS_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ── 读取单个 SKILL.md 目录下的 skill ─────────────────────────────────────
function readSkillFromDir(skillDir, name) {
  const mdPath = `${skillDir}/${name}/SKILL.md`;
  if (!existsSync(mdPath)) return null;
  const text = readFileSync(mdPath, 'utf8');
  const fm = parseSkillFrontmatterRobust(text);
  // body（frontmatter 之后的内容）作为详细 prompt
  const bodyMatch = text.match(/^---[\s\S]*?---\r?\n([\s\S]*)$/);
  const body = bodyMatch ? bodyMatch[1].trim() : '';
  return {
    name: fm.name || name,
    category: fm.category || 'general',
    load: fm.load || 'progressive',
    trigger: Array.isArray(fm.triggers) ? fm.triggers.join('、') : (fm.trigger || ''),
    triggers: Array.isArray(fm.triggers) ? fm.triggers : [],
    description: fm.description || '',
    prompt: fm.prompt || body.split('\n').slice(0, 3).join(' ').slice(0, 200) || '',
    next: Array.isArray(fm.next) ? fm.next : [],
    mounts: fm.mounts || {},
    _source: fm._source || '',
    _mdPath: mdPath,
  };
}

// ── readSkills：优先目录形态，fallback yaml ────────────────────────────────
function readSkills() {
  const state = readSkillsState();

  // 1. 从 .myteam/skills/{name}/SKILL.md 读取
  const dirSkills = [];
  if (existsSync(SKILLS_DIR)) {
    let entries = [];
    try { entries = readdirSync(SKILLS_DIR, { withFileTypes: true }); } catch { }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = readSkillFromDir(SKILLS_DIR, entry.name);
      if (skill) dirSkills.push(skill);
    }
  }

  // 2. fallback：从老 skills.yaml 读（如果目录为空）
  let baseSkills = dirSkills;
  if (!dirSkills.length && existsSync(SKILLS_FILE)) {
    baseSkills = readSkillsYaml();
  }

  // 3. 合并 skills-state.json（enabled/mounts 覆盖）
  return baseSkills.map(skill => {
    const st = state[skill.name] || {};
    return {
      ...skill,
      enabled: st.enabled !== false, // 默认 enabled
      source: st.source || 'myteam-official',
      mounts: { ...skill.mounts, ...(st.mounts || {}) },
    };
  });
}

// ── 原 skills.yaml 解析（fallback 用） ────────────────────────────────────
function readSkillsYaml() {
  if (!existsSync(SKILLS_FILE)) return [];
  const skills = [];
  let current = null;
  let inMounts = false;
  let inNext = false;

  for (const raw of readFileSync(SKILLS_FILE, 'utf8').split('\n')) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed === 'skills:') continue;

    const item = trimmed.match(/^-\s+name:\s*(.+)$/);
    if (item) {
      current = { name: parseScalar(item[1]), mounts: {}, next: [] };
      skills.push(current);
      inMounts = false;
      inNext = false;
      continue;
    }

    if (!current) continue;
    if (trimmed === 'mounts:') { inMounts = true; inNext = false; continue; }
    if (trimmed === 'next:')   { inNext = true; inMounts = false; continue; }

    if (inNext && trimmed.startsWith('- ')) {
      current.next.push(parseScalar(trimmed.slice(2).trim()));
      continue;
    }

    const kv = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    if (inNext && !trimmed.startsWith('- ')) inNext = false;
    if (inMounts) current.mounts[kv[1]] = Boolean(parseScalar(kv[2]));
    else current[kv[1]] = parseScalar(kv[2]);
  }
  return skills;
}

function skillRoleForPhase(phase) {
  if (phase === 'plan') return 'controller';
  if (phase === 'review') return 'reviewer';
  return 'worker';
}

function splitSkillText(skill) {
  return [
    skill.name,
    skill.category,
    skill.trigger,
    skill.description,
    skill.prompt,
    skill.load,
  ].filter(Boolean).join(' ').toLowerCase();
}

function selectSkills({ text = '', agent = '', phase = 'run' } = {}) {
  const skills = readSkills().filter(s => s.enabled !== false);
  const role = skillRoleForPhase(phase);
  const haystack = String(text || '').toLowerCase();

  const scored = skills.map(skill => {
    let score = 0;
    const skillText = splitSkillText(skill);
    if (skill.mounts?.[role]) score += 3;
    if (agent && skill.mounts?.[agent]) score += 2;
    if (skill.category && haystack.includes(String(skill.category).toLowerCase())) score += 2;
    for (const token of skillText.split(/[\s,，。；;、/|]+/).filter(t => t.length >= 2)) {
      if (haystack.includes(token)) score += 1;
    }
    return { ...skill, score };
  });

  return scored
    .filter(skill => skill.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3);
}

function buildSkillContext(selected) {
  if (!selected.length) return '';
  return selected.map((skill, index) => {
    const prompt = skill.prompt || skill.description || skill.trigger || '按该技能边界完成任务';
    return `${index + 1}. ${skill.name}（${skill.category || 'general'}）：${prompt}`;
  }).join('\n');
}

// 获取指定 skill 的下一阶段推荐 skill（对齐 clowder-ai manifest.yaml 的 next 链）
function getNextSkills(currentSkillName) {
  const skills = readSkills();
  const current = skills.find(s => s.name === currentSkillName);
  if (!current || !current.next || !current.next.length) return [];
  
  return current.next
    .map(name => skills.find(s => s.name === name))
    .filter(Boolean);
}

// ── HTTP GET 工具（用于远程拉取 skill 清单 / SKILL.md） ─────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? httpsGet : httpGetModule;
    const req = get(url, { headers: { 'User-Agent': 'myteamOUO/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGet(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpGetBuffer(url) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? httpsGet : httpGetModule;
    const req = get(url, { headers: { 'User-Agent': 'myteamOUO/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpGetBuffer(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function readSkillSourceIndex(srcCfg) {
  let raw;
  if (srcCfg.localIndexPath && existsSync(srcCfg.localIndexPath)) {
    raw = readFileSync(srcCfg.localIndexPath, 'utf8');
  } else {
    raw = await httpGet(srcCfg.indexUrl);
  }
  return raw.replace(/^\uFEFF/, '');
}

async function loadSkillRegistry(source, srcCfg) {
  const now = Date.now();
  const cached = skillRegistryCache.get(source);
  if (cached?.skills && cached.expiresAt > now) return { skills: cached.skills, cached: true };
  if (cached?.pending) return cached.pending;

  const pending = (async () => {
    try {
      const raw = await readSkillSourceIndex(srcCfg);
      let skills = [];
      if (srcCfg.type === 'index') skills = JSON.parse(raw).skills || [];
      else if (srcCfg.type === 'manifest') skills = parseClowderManifest(raw, srcCfg.rawBase);
      skillRegistryCache.set(source, { skills, expiresAt: Date.now() + SKILL_REGISTRY_TTL_MS });
      return { skills, cached: false };
    } catch (error) {
      if (cached?.skills) {
        skillRegistryCache.set(source, { skills: cached.skills, expiresAt: Date.now() + 30_000 });
        return { skills: cached.skills, cached: true, stale: true };
      }
      skillRegistryCache.delete(source);
      throw error;
    }
  })();

  skillRegistryCache.set(source, { ...cached, pending });
  return pending;
}

function resolveLocalSkillPath(srcCfg, entryUrl) {
  if (!srcCfg.localBase || !entryUrl || entryUrl.startsWith('http')) return null;
  const baseDir = resolve(srcCfg.localBase);
  const candidate = resolve(srcCfg.localBase, entryUrl);
  if (candidate !== baseDir && !candidate.startsWith(baseDir + sep)) return null;
  return existsSync(candidate) ? candidate : null;
}

async function readSkillMarkdownFromEntry(srcCfg, entry) {
  const entryUrl = entry.url || '';
  const localPath = resolveLocalSkillPath(srcCfg, entryUrl);
  if (localPath) return readFileSync(localPath, 'utf8');
  const mdUrl = entryUrl.startsWith('http')
    ? entryUrl
    : `${srcCfg.indexUrl.replace(/\/[^/]+$/, '')}/${entryUrl}`;
  return httpGet(mdUrl);
}

// ── clowder-ai manifest.yaml 转换为 myteam skill 列表 ──────────────────────
// clowder 格式：顶层 skills: 下面是两空格缩进的 skill 名（  feat-lifecycle:），
// skill 字段是四空格缩进，触发词/next 数组项是六空格 + "- "
function parseClowderManifest(yamlText, rawBase) {
  const skills = [];
  let inSkillsBlock = false;
  let current = null;
  let mode = null; // 'description' | 'triggers' | 'next' | null

  for (const raw of yamlText.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.match(/^(\s*)/)[1].length;

    if (trimmed === 'skills:') { inSkillsBlock = true; continue; }
    if (!inSkillsBlock) continue;

    // indent=2 → 新 skill（例如 "  feat-lifecycle:"）
    if (indent === 2 && !trimmed.startsWith('-')) {
      const nameMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (nameMatch) {
        current = {
          name: nameMatch[1],
          category: 'general',
          load: 'progressive',
          description: '',
          triggers: [],
          next: [],
          mounts: { controller: true, worker: true, reviewer: true },
          source: 'clowder-ai',
          url: rawBase ? `${rawBase}/${nameMatch[1]}/SKILL.md` : '',
        };
        skills.push(current);
        mode = null;
      }
      continue;
    }

    if (!current) continue;

    // indent=4 → skill 字段
    if (indent === 4 && !trimmed.startsWith('-')) {
      const kv = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (kv) {
        const key = kv[1];
        const val = kv[2].trim().replace(/^[>|]/, '').trim().replace(/^["']|["']$/g, '');
        if (val === '') {
          mode = key;
        } else {
          mode = key === 'description' ? 'description_inline' : null;
          if (key === 'description') current.description = val;
        }
      }
      continue;
    }

    // indent>=6 → 数组项或续行
    if (indent >= 6) {
      if (trimmed.startsWith('- ')) {
        const val = trimmed.slice(2).trim().replace(/^["']|["']$/g, '');
        if (mode === 'triggers') current.triggers.push(val);
        else if (mode === 'next') current.next.push(val);
      } else if (mode === 'description') {
        current.description += ' ' + trimmed;
      }
    }
  }

  return skills.map(s => ({
    ...s,
    description: s.description.trim().slice(0, 300),
    trigger: s.triggers.slice(0, 3).join('、'),
    prompt: s.description.trim().slice(0, 200),
  }));
}

// ── Artifact 提取（对齐 clowder-ai F148 Phase H：chat-extracted 产物自动追踪）─
const WORKSPACE_DENYLIST = ['.env', '.pem', '.key', 'id_rsa', '.git', 'node_modules', 'secrets'];
// 按 mtime 扫描的"常规产出区"（workspace 根 + 常见产出目录）
const WORKSPACE_SCAN_DIRS = ['', 'docs', 'src', 'web', 'scripts', 'output', 'reports', 'dist'];

function artifactId(sessionId, path, content) {
  const raw = `${sessionId}:${path || ''}:${(content || '').slice(0, 200)}`;
  return createHash('sha1').update(raw).digest('hex').slice(0, 12);
}

/**
 * 从 agent 输出文本中提取 artifacts（4 种规则）
 * 返回 Artifact[]
 */
function extractArtifacts(text, { sessionId, agent, messageIndex }) {
  if (!text) return [];
  const artifacts = [];

  // 规则 1: 围栏代码块，可选带文件路径 ```lang:path/to/file 或 ```lang
  const fenceRe = /```([a-zA-Z0-9_+-]*)(?::([^\s`\n]+))?\n([\s\S]*?)```/g;
  let m;
  while ((m = fenceRe.exec(text)) !== null) {
    const lang = (m[1] || 'text').toLowerCase();
    const rawPath = m[2] || null;
    const content = m[3];
    if (!content?.trim()) continue;

    const type = lang === 'html' ? 'html'
      : lang === 'json' ? 'json'
      : (lang === 'md' || lang === 'markdown') ? 'markdown'
      : 'code';

    const path = rawPath || guessFilename(type, lang, artifacts.length);
    const id = artifactId(sessionId, path, content);
    if (artifacts.some(a => a.id === id)) continue;
    artifacts.push({
      id, type, lang, path, content, agent, sessionId, messageIndex,
      source: 'chat-extracted', createdAt: Date.now(),
      preview: content.trim().slice(0, 80),
    });
    if (type === 'html') saveArtifactFile(artifacts[artifacts.length - 1]);
  }

  // 规则 2: <file path="xxx">...</file> 路径标记
  const fileTagRe = /<file\s+path=["']([^"']+)["']>([\s\S]*?)<\/file>/g;
  while ((m = fileTagRe.exec(text)) !== null) {
    const path = m[1];
    const content = m[2];
    if (!content?.trim()) continue;
    const lang = extToLang(path);
    const type = lang === 'html' ? 'html' : lang === 'json' ? 'json' : 'code';
    const id = artifactId(sessionId, path, content);
    if (artifacts.some(a => a.id === id)) continue;
    artifacts.push({
      id, type, lang, path, content, agent, sessionId, messageIndex,
      source: 'chat-extracted', createdAt: Date.now(),
      preview: content.trim().slice(0, 80),
    });
  }

  // 规则 3: 整段 markdown（无围栏但含 # 标题 + 多行结构）
  // 只在无代码块的回复中触发，避免重复
  if (artifacts.length === 0) {
    const lines = text.split('\n');
    const hasH1 = lines.some(l => /^#{1,3}\s+\S/.test(l));
    const structureLines = lines.filter(l =>
      /^[-*+]\s+\S/.test(l) ||   // 列表
      /^\|.+\|/.test(l) ||        // 表格
      /^#{1,6}\s+\S/.test(l) ||   // 标题
      /^\d+\.\s+\S/.test(l)       // 有序列表
    ).length;
    if (hasH1 && structureLines >= 3 && text.length > 200) {
      const id = artifactId(sessionId, 'agent-output.md', text);
      if (!artifacts.some(a => a.id === id)) {
        artifacts.push({
          id, type: 'markdown', lang: 'md', path: 'agent-output.md',
          content: text, agent, sessionId, messageIndex,
          source: 'chat-extracted', createdAt: Date.now(),
          preview: text.trim().slice(0, 80),
        });
      }
    }
  }

  // 规则 4: URL 链接
  const urlRe = /https?:\/\/[^\s)"'<>\]]+/g;
  while ((m = urlRe.exec(text)) !== null) {
    const url = m[0].replace(/[.,;!?]+$/, '');
    const id = artifactId(sessionId, url, url);
    if (artifacts.some(a => a.id === id)) continue;
    artifacts.push({
      id, type: 'url', lang: '', path: url, content: url, agent, sessionId, messageIndex,
      source: 'chat-extracted', createdAt: Date.now(),
      preview: url,
    });
  }

  return artifacts;
}

// Save artifacts with HTML content as actual files
function saveArtifactFile(artifact) {
  if (artifact.type !== 'html' && artifact.type !== 'markdown' && artifact.type !== 'json') return;
  mkdirSync(OUTPUTS_DIR, { recursive: true });
  const ext = artifact.type === 'html' ? '.html' : artifact.type === 'markdown' ? '.md' : '.json';
  const rawName = basename(String(artifact.path || `artifact-${artifact.id}${ext}`));
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_') || `artifact-${artifact.id}${ext}`;
  const fname = extname(safeName) ? safeName : safeName + ext;
  const fpath = join(OUTPUTS_DIR, fname);
  writeFileSync(fpath, artifact.content, 'utf8');
  artifact.savedFile = fname;
}

function guessFilename(type, lang, idx) {
  if (type === 'html') return `output-${idx + 1}.html`;
  if (type === 'markdown') return `output-${idx + 1}.md`;
  if (type === 'json') return `output-${idx + 1}.json`;
  const exts = { ts: 'ts', js: 'js', py: 'py', sh: 'sh', bash: 'sh', css: 'css', sql: 'sql', yaml: 'yaml', yml: 'yaml' };
  return `output-${idx + 1}.${exts[lang] || 'txt'}`;
}

function extToLang(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const map = { ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', py: 'py', html: 'html', css: 'css', json: 'json', md: 'md', yaml: 'yaml', yml: 'yaml', sh: 'sh', sql: 'sql' };
  return map[ext] || ext;
}

function guessMime(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const map = {
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'application/javascript',
    mjs: 'application/javascript', json: 'application/json', md: 'text/markdown',
    txt: 'text/plain', py: 'text/x-python', ts: 'text/typescript', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf',
  };
  return map[ext] || 'application/octet-stream';
}

function appendInvocation(record) {
  try {
    repository.append('invocations', record);
  } catch (err) {
    console.error('Failed to append invocation:', err.message);
  }
}

function readJsonl(file) {
  if (file === LESSONS_FILE) return repository.list('lessons');
  if (file === INVOCATIONS_FILE) return repository.list('invocations');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function readInvocations() {
  return readJsonl(INVOCATIONS_FILE);
}

function summarizeInvocations(invocations) {
  const total = invocations.length;
  const failed = invocations.filter(i => i.status === 'failed').length;
  const interrupted = invocations.filter(i => i.status === 'interrupted').length;
  const success = invocations.filter(i => i.status === 'success').length;
  const durations = invocations.map(i => Number(i.duration_ms || 0)).filter(n => n > 0);
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((sum, n) => sum + n, 0) / durations.length)
    : 0;
  const byAgent = {};
  invocations.forEach(i => {
    const key = i.agent || 'unknown';
    byAgent[key] ||= { total: 0, success: 0, failed: 0, interrupted: 0 };
    byAgent[key].total++;
    if (byAgent[key][i.status] !== undefined) byAgent[key][i.status]++;
  });
  return { total, success, failed, interrupted, avgDurationMs, byAgent };
}

// ── 对话历史 + Session 隔离（持久化到 .myteam/memory.json） ───
// 数据结构: { sessions: [{ id, name, created_at, history: [...] }], activeId }
const MEMORY_FILE = '.myteam/memory.json';
const DEFAULT_SESSION_NAME = '默认对话';
const DEFAULT_DRAFT_SESSION_NAME = '新对话';

// 内存数据：sessions 数组 + 当前激活的 session id
let sessions = [];
let activeSessionId = null;
let trashedSessions = []; // 回收站：{ session, deletedAt }
const TRASH_RETENTION_MS = 5 * 60 * 1000; // 5 分钟

function newSession(name) {
  return {
    id: randomUUID().slice(0, 8),
    name: name || DEFAULT_DRAFT_SESSION_NAME,
    created_at: new Date().toISOString(),
    history: [],
    continuity: null,
    mode: null, // 'chat' | 'plan' | 'mixed'，由首次/最近一次操作决定
  };
}

function recordSessionMode(session, mode) {
  if (!session) return;
  if (!session.mode) session.mode = mode;
  else if (session.mode !== mode) session.mode = 'mixed';
}

function isAutoSessionName(name) {
  const text = String(name || '').trim();
  return (
    !text ||
    text === DEFAULT_SESSION_NAME ||
    text === DEFAULT_DRAFT_SESSION_NAME ||
    /^对话\s*\d+$/.test(text)
  );
}

function summarizeSessionTitle(text) {
  const clean = String(text || '')
    .replace(/(?:^|\n)\s*@(claude|codex|kimi)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[，。！？,.!?;；：:\s]+|[，。！？,.!?;；：:\s]+$/g, '')
    .trim();
  const firstSentence = clean.split(/[。！？!?；;\n]/)[0]?.trim() || clean;
  if (!firstSentence) return DEFAULT_DRAFT_SESSION_NAME;
  return firstSentence.length > 22 ? `${firstSentence.slice(0, 22)}…` : firstSentence;
}

function maybeAutoRenameSession(session, message) {
  // 新手体验：新建对话时不要求先起名，等第一句话发出后自动生成一个短标题。
  if (!session || session.history.length || !isAutoSessionName(session.name)) return;
  session.name = summarizeSessionTitle(message);
}

function getSession(id) {
  return sessions.find(s => s.id === id) || null;
}

function getActiveSession() {
  return getSession(activeSessionId) || sessions[0];
}

function loadSessions() {
  const stored = repository.loadSessionState();
  if (stored.sessions.length) {
    sessions = stored.sessions.map((session) => ({
      ...session,
      history: Array.isArray(session.history) ? session.history.slice(-40) : [],
    }));
    activeSessionId = stored.activeId && getSession(stored.activeId) ? stored.activeId : sessions[0].id;
    const now = Date.now();
    trashedSessions = stored.trashedSessions
      .filter((entry) => now - Number(entry.deletedAt || 0) < TRASH_RETENTION_MS);
    return;
  }
  if (!existsSync(MEMORY_FILE)) {
    sessions = [newSession()];
    activeSessionId = sessions[0].id;
    return;
  }
  try {
    const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf8'));
    // 旧格式：扁平历史数组，迁移到默认 session
    if (Array.isArray(data)) {
      const s = newSession();
      s.history = data.slice(-40);
      sessions = [s];
      activeSessionId = s.id;
      return;
    }
    if (Array.isArray(data.sessions) && data.sessions.length) {
      sessions = data.sessions.map(s => ({
        id: s.id || randomUUID().slice(0, 8),
        name: s.name || DEFAULT_SESSION_NAME,
        created_at: s.created_at || new Date().toISOString(),
        history: Array.isArray(s.history) ? s.history.slice(-40) : [],
        continuity: s.continuity && typeof s.continuity === 'object' ? s.continuity : null,
        mode: s.mode || null,
      }));
      activeSessionId = data.activeId && getSession(data.activeId)
        ? data.activeId : sessions[0].id;
      if (Array.isArray(data.trashedSessions)) {
        const now = Date.now();
        trashedSessions = data.trashedSessions
          .filter(t => now - t.deletedAt < TRASH_RETENTION_MS)
          .map(t => ({ session: t.session, deletedAt: t.deletedAt }));
      }
      return;
    }
  } catch (err) {
    console.error('Failed to load sessions:', err.message);
  }
  sessions = [newSession()];
  activeSessionId = sessions[0].id;
}

function saveSessions() {
  try {
    const payload = {
      activeId: activeSessionId,
      sessions: sessions.map(s => ({
        ...s,
        history: s.history.slice(-40),
      })),
      trashedSessions: trashedSessions.map(t => ({
        session: t.session,
        deletedAt: t.deletedAt,
      })),
    };
    repository.saveSessionState(payload);
  } catch (err) {
    console.error('Failed to save sessions:', err.message);
  }
}

function refreshSessionContinuity(session, source = 'manual') {
  if (!session) return null;
  session.continuity = buildContinuityCapsule({
    sessionId: session.id,
    history: session.history,
    previous: session.continuity,
    source,
  });
  return session.continuity;
}

// 启动时加载
loadSessions();

const scheduleService = new ScheduleService({
  execute: async (schedule, run) => {
    const { agentKey } = await resolveRunnableAgent(schedule.agent);
    const targetSession = schedule.sessionPolicy === 'existing' && getSession(schedule.sessionId)
      ? getSession(schedule.sessionId)
      : newSession(`定时：${schedule.name}`);
    if (!getSession(targetSession.id)) sessions.push(targetSession);
    const prompt = schedule.mode === 'plan'
      ? `${PLAN_PROMPT}\n\n用户目标：${schedule.goal}`
      : schedule.mode === 'dispatch'
        ? buildExecPrompt({
            id: `schedule-${run.id}`,
            title: schedule.name,
            goal: schedule.goal,
            accept: '完成定时任务目标并给出可验证摘要',
            steps: [],
            agent: agentKey,
          })
        : `这是经用户批准的定时任务。请完成目标并给出简洁结果。\n\n目标：${schedule.goal}`;
    targetSession.history.push({ role: 'user', text: schedule.goal, agent: null, kind: 'schedule-goal', scheduleId: schedule.id, runId: run.id });
    const result = await invokeAgent(CLI_CONFIG, agentKey, prompt, { silent: true });
    targetSession.history.push({ role: 'assistant', text: result, agent: agentKey, kind: 'schedule-result', scheduleId: schedule.id, runId: run.id });
    if (targetSession.history.length > 40) targetSession.history.splice(0, targetSession.history.length - 40);
    refreshSessionContinuity(targetSession, 'scheduled_run');
    saveSessions();
    return { summary: result, sessionId: targetSession.id };
  },
});
scheduleService.start();

// ── @mention 路由解析 ─────────────────────────────────────────
// 参考 clowder-ai 的 parseA2AMentions：用户输入用宽松匹配（任意位置）
// 行首匹配用于 agent 回复里的 @mention（防止代码注释误触发），此处是用户输入不需要
const MENTION_MAP = {
  claude: 'claude',
  codex:  'codex',
  kimi:   'kimi',
};
function parseAtMentionLegacy(text) {
  // 行首匹配（允许前导空白），防止代码/引用中 @mention 误触发路由
  const m = text.match(/(?:^|\n)\s*@(claude|codex|kimi)\b/i);
  return m ? MENTION_MAP[m[1].toLowerCase()] : null;
}

// ── A2A Worklist：从 agent 回复中提取 @mention 触发链式执行 ────
// 行首匹配（允许前导空白），防止代码注释 /  casual 提及误触发
function parseA2AMentionsLegacy(text) {
  const mentions = [];
  const re = /(?:^|\n)\s*@(claude|codex|kimi)\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = MENTION_MAP[m[1].toLowerCase()];
    if (key && !mentions.includes(key)) mentions.push(key);
  }
  return mentions;
}
function dynamicMentionPattern() {
  return /(?:^|\n)\s*@([a-zA-Z0-9_-]+)\b/g;
}

function parseAtMention(text) {
  const m = dynamicMentionPattern().exec(text);
  if (!m) return null;
  const key = sanitizeAgentKey(m[1]);
  return agentKeys().includes(key) ? key : null;
}

function stripAtMentions(text) {
  return String(text || '').replace(dynamicMentionPattern(), (raw, key) => (
    agentKeys().includes(sanitizeAgentKey(key)) ? '' : raw
  )).trim();
}

function parseA2AMentions(text) {
  const mentions = [];
  const re = dynamicMentionPattern();
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = sanitizeAgentKey(m[1]);
    if (key && agentKeys().includes(key) && !mentions.includes(key)) mentions.push(key);
  }
  return mentions;
}
const WORKLIST_MAX_DEPTH = 3; // 防止无限链

// ── 构建带历史的 chat prompt ──────────────────────────────────
const RICH_BLOCKS_HINT = `
你的回复支持以下 Rich Blocks 富文本语法（按需使用，不要强行套用）：
- 普通回复优先使用自然语言和简洁 Markdown；不要复述本提示、角色配置或任何内部标记
- 代码块用三个反引号包裹，可标语言：\`\`\`js ... \`\`\`
- 行内代码 \`code\`，加粗 **text**，斜体 *text*
- 标题 # / ## / ###；列表用 - 或 1.
- 卡片块（用于强调结论或重要信息）：
  :::card title="标题"
  内容支持其它 markdown
  :::
- 清单块（用于待办或步骤，[x] 表示已完成）：
  :::checklist title="待办"
  - [x] 已完成项
  - [ ] 待办项
  :::
- 角色卡仅在用户明确要求生成“角色卡”或“成员档案”时使用；普通自我介绍不要使用：
  :::role name="姓名" tag="标签"
  描述
  :::
- 普通自我介绍用 2-4 句自然语言即可，不要重复身份信息、能力清单或开场项目符号，除非用户明确要求详细介绍
`;

const CHAT_SYSTEM = {
  codex:  `You are Codex, a helpful AI assistant in the myteam workspace. You help with code, analysis, and task planning. Reply in Chinese.${RICH_BLOCKS_HINT}`,
  claude: `You are Claude, a helpful AI assistant in the myteam workspace. You excel at deep thinking, writing, and architecture. Reply in Chinese.${RICH_BLOCKS_HINT}`,
  kimi:   `You are Kimi, a helpful AI assistant in the myteam workspace. You handle lightweight execution, drafting, and quick analysis. Reply in Chinese.${RICH_BLOCKS_HINT}`,
};

function buildChatPrompt(userMessage, agentKey, history) {
  const system = CHAT_SYSTEM[agentKey] || CHAT_SYSTEM.codex;
  // 取最近 10 条历史避免 token 过多
  const recentHistory = (history || []).slice(-10);
  const historyLines = recentHistory
    .map(h => `${h.role === 'user' ? '用户' : (h.agent || 'assistant')}: ${h.text}`)
    .join('\n\n');

  return `${system}

${historyLines ? `对话历史：\n${historyLines}\n\n` : ''}用户: ${userMessage}`;
}

function attachmentPrompt(attachments = []) {
  const list = (Array.isArray(attachments) ? attachments : [])
    .filter(a => a && a.path)
    .map((a, i) => `${i + 1}. ${a.name || basename(a.path)}：${a.path}${a.type ? ` (${a.type})` : ''}`)
    .join('\n');
  return list ? `\n\n【图片输入】\n用户这次发送了图片。请先观察和分析图片，再回答用户的问题。\n如果你的运行环境无法直接读取图片，请明确说明“当前 agent 无法直接读取图片”，并告诉用户需要补充什么信息，不要假装已经看过图片。\n本地图片路径如下：\n${list}` : '';
}

// 给 plan 阶段使用：不传具体路径，避免 agent 自动调 view_image 工具导致失败。
// 拆任务只需要让 agent 知道"有图"，让它据文字目标拆任务，具体读图交给后续执行 agent。
function attachmentPromptForPlan(attachments = []) {
  const arr = Array.isArray(attachments) ? attachments.filter(a => a && a.path) : [];
  if (!arr.length) return '';
  return `\n\n【图片附件提示】\n用户额外上传了 ${arr.length} 张图片（拆任务阶段不需要你查看）。\n请直接根据用户文字目标拆解任务；若任务需要分析图片，请在对应任务里明确写出 "分析图片：xxx"，由具体执行 agent 阶段处理。\n切勿调用 view_image / read_image 等工具，本阶段只输出 JSON。`;
}

const PORT = (() => {
  const i = process.argv.indexOf('--port');
  return i >= 0 ? Number(process.argv[i + 1]) : 7878;
})();

// 重要执行前导出一份可读快照；SQLite 仍是权威存储。
const RUNS_DIR = '.myteam/runs';
function backupTasks() {
  const tasks = readTasks();
  if (!tasks.length) return null;
  mkdirSync(RUNS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${RUNS_DIR}/tasks-backup-${stamp}.jsonl`;
  writeFileSync(dest, tasks.map((task) => JSON.stringify(task)).join('\n') + '\n', 'utf8');
  return dest;
}

// ── SSE 工具 ──────────────────────────────────────────────────
function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
}

function sseSend(res, event, data) {
  const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
  try { res.write(payload); } catch { /* client gone */ }
  // also broadcast to the session bus so reconnected clients get the same event
  if (res._sessionId) busBroadcast(res._sessionId, event, data);
}

// ── 活跃子进程追踪（用于 abort + 刷新恢复） ──────────────────────────────
const activeChildren = new Map(); // id → { child, sessionId, clientRunId, aborted, agentKey, mode, taskTitle, startedAt }
let childIdSeq = 0;

// -- per-session SSE broadcast bus (for refresh reconnect) --
// Each running session gets a bus: listeners (Set<res>) + a ring buffer of
// recent SSE events so a freshly-reconnected client can replay them.
const sessionBuses = new Map(); // sessionId -> { listeners, buffer, agentKey, label, startedAt }
const SESSION_BUFFER_MAX = 500;

function getOrCreateBus(sessionId, agentKey = '', label = '') {
  if (!sessionId) return null;
  if (!sessionBuses.has(sessionId)) {
    sessionBuses.set(sessionId, {
      listeners: new Set(),
      buffer: [],
      agentKey,
      label,
      startedAt: Date.now(),
    });
  }
  const bus = sessionBuses.get(sessionId);
  if (agentKey && !bus.agentKey) bus.agentKey = agentKey;
  if (label && !bus.label) bus.label = label;
  return bus;
}

// Broadcast an SSE event to all listeners of a session and buffer it for replay.
function busBroadcast(sessionId, event, data) {
  const bus = sessionBuses.get(sessionId);
  if (!bus) return;
  const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
  bus.buffer.push(payload);
  if (bus.buffer.length > SESSION_BUFFER_MAX) bus.buffer.shift();
  for (const res of bus.listeners) {
    try { res.write(payload); } catch { /* client gone */ }
  }
}

function busAttach(sessionId, res) {
  const bus = sessionBuses.get(sessionId);
  if (!bus) return false;
  // replay buffered events
  for (const p of bus.buffer) {
    try { res.write(p); } catch { return false; }
  }
  bus.listeners.add(res);
  return true;
}

function busDetach(sessionId, res) {
  const bus = sessionBuses.get(sessionId);
  if (!bus) return;
  bus.listeners.delete(res);
  // teardown the bus when no child is running and no listeners remain
  const stillRunning = [...activeChildren.values()].some(r => r.sessionId === sessionId && !r.aborted);
  if (!stillRunning && bus.listeners.size === 0) {
    sessionBuses.delete(sessionId);
  }
}

function abortChildren({ sessionId = '', clientRunId = '' } = {}) {
  if (!sessionId && !clientRunId) return 0;
  let count = 0;
  for (const [id, record] of activeChildren) {
    if (clientRunId && record.clientRunId !== clientRunId) continue;
    if (!clientRunId && sessionId && record.sessionId !== sessionId) continue;
    record.aborted = true;
    count++;
    try { record.child.kill('SIGTERM'); } catch { /* already dead */ }
  }
  return count;
}

function safeTurnValue(value) {
  if (value === undefined) return undefined;
  const redacted = redactSensitive(value);
  if (typeof redacted === 'string') {
    return redacted
      .replace(/((?:token|secret|password|api[-_]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
      .slice(0, 12000);
  }
  const serialized = JSON.stringify(redacted);
  if (serialized.length <= 12000) return redacted;
  return { truncated: true, preview: serialized.slice(0, 12000) };
}

// ── 调用 agent 并实时流到 SSE ─────────────────────────────────
// 教训1 (02-cli-engineering): readline 接管 stdout 后，child.stdout.on('data') 不再触发。
// watchdog 必须在 rl.on('line') 和 stderr.on('data') 里刷新。
// 教训1: 超时 30min，匹配复杂任务实际需要。
function streamAgent(agentKey, prompt, res, label = 'chunk', {
  skipRoleCard = false,
  sessionId = '',
  clientRunId = '',
  outputSchemaPath = '',
  turnCollector = null,
} = {}) {
  const invocationId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const startedIso = new Date(startedAt).toISOString();
  // tag res with sessionId so sseSend broadcasts to the session bus, and
  // create the bus so a refreshed client can reconnect to this live stream.
  if (sessionId) {
    res._sessionId = sessionId;
    getOrCreateBus(sessionId, agentKey, label);
  }

  const finishInvocation = (status, extra = {}) => {
    appendInvocation({
      id: invocationId,
      agent: agentKey,
      label,
      status,
      started_at: startedIso,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      prompt_chars: prompt.length,
      ...extra,
    });
  };

  const cfg = CLI_CONFIG[agentKey];
  if (!cfg?.path) {
    sseSend(res, 'error', { message: `${agentKey} 路径未在 .env 中配置` });
    finishInvocation('failed', { error: 'missing path' });
    return Promise.reject(new Error('missing path'));
  }

  // 角色卡注入（对齐 clowder-ai buildStaticIdentity）
  const agentDef = skipRoleCard ? null : readAgentRegistry().find(a => a.key === agentKey);
  const roleCard = buildRoleCard(agentDef);
  const fullPrompt = roleCard ? roleCard + prompt : prompt;

  const parser = resolveAgentParser(agentKey, cfg);
  const args = cfg.args(fullPrompt);
  if (outputSchemaPath && agentKey === 'codex' && !args.includes('--output-schema')) {
    args.push('--output-schema', resolve(outputSchemaPath));
  }
  const { spawnPath, spawnArgs } = buildSpawnCommand(cfg, args);

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let watchdog = null;

    const fail = (err, cid = null) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearInterval(watchdog);
      if (cid) activeChildren.delete(cid);
      finishInvocation('failed', { error: err.message });
      reject(err);
    };

    try {
      sseSend(res, 'status', { agent: agentKey, phase: 'starting', text: `${agentKey} 正在启动` });
      child = spawn(spawnPath, spawnArgs, { ...cfg.spawnOptions, cwd: currentWorkspace() });
    } catch (err) {
      fail(new Error(formatLaunchError(agentKey, err)));
      return;
    }

    const cid = ++childIdSeq;
    const childRecord = { 
      child, 
      sessionId, 
      clientRunId, 
      aborted: false,
      agentKey,
      mode: label.startsWith('task-chunk:') ? 'dispatch' : (label === 'chunk' ? 'chat' : label),
      taskTitle: label.startsWith('task-chunk:') ? label.slice('task-chunk:'.length) : null,
      startedAt: new Date().toISOString(),
    };
    activeChildren.set(cid, childRecord);

    child.on('error', (err) => {
      fail(new Error(formatLaunchError(agentKey, err)), cid);
    });

    if (cfg.inputMode !== 'arg') {
      try {
        child.stdin.write(fullPrompt, 'utf8');
        child.stdin.end();
      } catch (err) {
        fail(new Error(formatLaunchError(agentKey, err)), cid);
        return;
      }
    }

    let fullText = '';
    let stderrText = '';
    let lastActivity = Date.now();
    const touch = () => { lastActivity = Date.now(); };
    const thinkingTimer = setTimeout(() => {
      if (!fullText && !settled) {
        sseSend(res, 'status', { agent: agentKey, phase: 'waiting', text: `${agentKey} 运行中` });
      }
    }, 1500);
    const TIMEOUT_MS = 30 * 60 * 1000; // 教训1: 30min

    watchdog = setInterval(() => {
      if (Date.now() - lastActivity > TIMEOUT_MS) {
        child.kill('SIGTERM');
        fail(new Error('timeout after 30min'), cid);
      }
    }, 10_000);

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      touch(); // 教训1: readline 接管后在这里刷新
      if (!line.trim()) return;
      let out;
      try {
        out = parser(line);
      } catch (parseErr) {
        // parser 显式抛错（如 codex turn.failed / error 事件）→ 直接终止 stream
        try { child.kill('SIGTERM'); } catch {}
        fail(new Error(parseErr.message || String(parseErr)), cid);
        return;
      }
      if (!out) return;
      // 兼容旧 parser 返回字符串 vs 新 parser 返回 { text, thinking }
      const text = typeof out === 'string' ? out : (out.text || '');
      const thinking = typeof out === 'string' ? '' : (out.thinking || '');
      const activities = typeof out === 'string' ? [] : (out.activities || []);
      if (text) {
        fullText += text;
        if (fullText.length === text.length) {
          sseSend(res, 'status', { agent: agentKey, phase: 'streaming', text: `${agentKey} 开始输出` });
        }
        if (turnCollector) {
          const part = turnCollector.append({ type: 'final', delta: text });
          if (part) sseSend(res, 'part', part);
        } else {
          sseSend(res, label, { text });
          if (label !== 'chunk') sseSend(res, 'chunk', { text });
        }
      }
      if (thinking) {
        if (turnCollector) {
          const part = turnCollector.append({ type: 'reasoning', delta: thinking });
          if (part) sseSend(res, 'part', part);
        } else {
          sseSend(res, 'thinking', { text: thinking });
        }
      }
      for (const activity of activities) {
        if (turnCollector) {
          const isResult = activity.phase === 'completed' || activity.phase === 'failed';
          const part = turnCollector.append(isResult ? {
            type: 'tool_result', callId: activity.id, name: activity.name,
            status: activity.phase === 'failed' ? 'error' : 'completed',
            summary: activity.summary, output: safeTurnValue(activity.output),
          } : {
            type: 'tool_call', callId: activity.id, name: activity.name,
            status: 'running', summary: activity.summary, input: safeTurnValue(activity.input),
          });
          if (part) sseSend(res, 'part', part);
        } else {
          sseSend(res, 'activity', activity);
        }
      }
    });

    child.stderr?.on('data', (data) => {
      touch(); // 教训1: stderr 也是活跃信号
      stderrText += data.toString();
      if (stderrText.length > 4000) stderrText = stderrText.slice(-4000);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      clearTimeout(thinkingTimer);
      activeChildren.delete(cid);
      const common = {
        exit_code: code,
        output_chars: fullText.length,
      };
      if (childRecord.aborted) {
        finishInvocation('interrupted', { ...common, error: 'aborted' });
        resolve(fullText);
      } else if (code !== 0) {
        const detail = stderrText.trim();
        const err = new Error(detail ? `exit code ${code}: ${detail}` : `exit code ${code}`);
        finishInvocation('failed', { ...common, error: err.message, stderr: detail });
        reject(err);
      } else {
        finishInvocation('success', stderrText.trim() ? { ...common, stderr: stderrText.trim() } : common);
        resolve(fullText);
      }
    });
  });
}

// ── HTTP body 读取 ───────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({}); }
    });
  });
}

function saveUploadFromDataUrl({ name = 'image.png', type = '', dataUrl = '' } = {}) {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('图片数据格式不正确');
  const mime = type || match[1];
  if (!mime.startsWith('image/')) throw new Error('目前只支持图片附件');
  const extMap = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
  const safeName = basename(String(name || 'image')).replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 80);
  const ext = extMap[mime] || (safeName.includes('.') ? '' : '.png');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 8 * 1024 * 1024) throw new Error('单张图片不能超过 8MB');
  mkdirSync(UPLOADS_DIR, { recursive: true });
  const id = randomUUID().slice(0, 8);
  const fileName = `${Date.now()}-${id}-${safeName}${safeName.endsWith(ext) ? '' : ext}`;
  const filePath = `${UPLOADS_DIR}/${fileName}`;
  writeFileSync(filePath, bytes);
  return { id, name: safeName, type: mime, path: resolve(filePath), url: `/uploads/${encodeURIComponent(fileName)}` };
}

// ── 静态文件 MIME ─────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const SKILL_REGISTRY_TTL_MS = 5 * 60 * 1000;
const skillRegistryCache = new Map();

function requireApproval(res, { operation, payload, sessionId = '', approvalId = '' }) {
  const authorization = authorizeOperation({ operation, payload, sessionId, approvalId });
  if (authorization.ok) return true;
  approvalResponse(res, authorization);
  return false;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  return res.end(JSON.stringify(body));
}

// ── 路由 ──────────────────────────────────────────────────────
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method === 'GET' && pathname === '/api/approvals') {
    const status = url.searchParams.get('status') || '';
    return json(res, 200, { approvals: listApprovals({ status }) });
  }

  const approvalDecisionMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/decision$/);
  if (req.method === 'POST' && approvalDecisionMatch) {
    try {
      const body = await readBody(req);
      const approval = decideApproval(decodeURIComponent(approvalDecisionMatch[1]), body.decision, body.actor);
      void scheduleService.resumeApproval(approval);
      return json(res, 200, { ok: true, approval });
    } catch (error) {
      return json(res, /not found/.test(error.message) ? 404 : 409, { error: error.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/audit') {
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200)));
    return json(res, 200, { events: listAudit({ limit }) });
  }

  if (req.method === 'GET' && pathname === '/api/schedules') {
    return json(res, 200, { schedules: scheduleService.list() });
  }

  if (req.method === 'POST' && pathname === '/api/schedules') {
    try {
      return json(res, 201, { ok: true, schedule: scheduleService.create(await readBody(req)) });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const scheduleMatch = pathname.match(/^\/api\/schedules\/([^/]+)$/);
  if (scheduleMatch && req.method === 'PATCH') {
    try {
      return json(res, 200, { ok: true, schedule: scheduleService.update(decodeURIComponent(scheduleMatch[1]), await readBody(req)) });
    } catch (error) {
      return json(res, /not found/.test(error.message) ? 404 : 400, { error: error.message });
    }
  }
  if (scheduleMatch && req.method === 'DELETE') {
    const removed = scheduleService.remove(decodeURIComponent(scheduleMatch[1]));
    return json(res, removed ? 200 : 404, removed ? { ok: true } : { error: 'schedule not found' });
  }

  const scheduleRunMatch = pathname.match(/^\/api\/schedules\/([^/]+)\/run$/);
  if (scheduleRunMatch && req.method === 'POST') {
    try {
      const run = await scheduleService.trigger(decodeURIComponent(scheduleRunMatch[1]), { manual: true });
      return json(res, 202, { ok: true, run });
    } catch (error) {
      return json(res, /not found/.test(error.message) ? 404 : 409, { error: error.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/schedule-runs') {
    const scheduleId = url.searchParams.get('scheduleId') || '';
    return json(res, 200, { runs: scheduleService.listRuns(scheduleId) });
  }

  // 静态首页
  if (req.method === 'GET' && (pathname === '/' || pathname === '/app.html')) {
    const html = readFileSync('web/app.html', 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  // 静态资源（CSS/JS）
  if (req.method === 'GET' && (pathname === '/app.css' || pathname === '/app.js')) {
    const ext = pathname.slice(1); // 'app.css' or 'app.js'
    const content = readFileSync(`web/${ext}`, 'utf8');
    const contentType = ext.endsWith('.css') ? 'text/css' : 'application/javascript';
    res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
    return res.end(content);
  }

  // 图片附件缩略图：只允许读取 .myteam/uploads 目录内的文件。
  if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
    try {
      const fileName = basename(decodeURIComponent(pathname.slice('/uploads/'.length)));
      const filePath = resolve(UPLOADS_DIR, fileName);
      const uploadRoot = resolve(UPLOADS_DIR);
      if (!filePath.startsWith(uploadRoot) || !existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '图片不存在' }));
      }
      const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' });
      return res.end(readFileSync(filePath));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '图片路径不正确' }));
    }
  }

  // 头像静态文件服务：/avatars/:filename → .myteam/avatars/:filename
  if (req.method === 'GET' && pathname.startsWith('/avatars/')) {
    try {
      const fileName = basename(decodeURIComponent(pathname.slice('/avatars/'.length)));
      const avatarsDir = '.myteam/avatars';
      const filePath = resolve(avatarsDir, fileName);
      const avatarRoot = resolve(avatarsDir);
      if (!filePath.startsWith(avatarRoot) || !existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '头像不存在' }));
      }
      const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' });
      return res.end(readFileSync(filePath));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '头像路径不正确' }));
    }
  }

  // POST /api/abort — 中断所有正在执行的 agent 子进程
  if (pathname === '/api/settings') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ settings: loadSettings(), workspace: currentWorkspace() }));
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const workspace = resolve(String(body.workspace || currentWorkspace()).trim() || '.');
      if (!existsSync(workspace)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: '工作区路径不存在' }));
      }
      if (!requireApproval(res, {
        operation: 'config.write',
        payload: { target: 'settings.workspace', workspace },
        approvalId: body.approvalId,
      })) return;
      const settings = { ...loadSettings(), workspace };
      saveSettings(settings);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, settings, workspace }));
    }
  }

  if (req.method === 'POST' && pathname === '/api/uploads') {
    try {
      const body = await readBody(req);
      const files = Array.isArray(body.files) ? body.files : [];
      const uploads = files.slice(0, 5).map(saveUploadFromDataUrl);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, uploads }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  if (req.method === 'POST' && pathname === '/api/abort') {
    const body = await readBody(req);
    const count = abortChildren({
      sessionId: String(body.sessionId || ''),
      clientRunId: String(body.clientRunId || ''),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ aborted: count }));
  }

  // GET /api/sessions — 返回所有 session 列表 + 当前激活
  if (req.method === 'GET' && pathname === '/api/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      activeId: activeSessionId,
      sessions: sessions.map(s => ({
        id: s.id,
        name: s.name,
        created_at: s.created_at,
        mode: s.mode || null,
        message_count: s.history.length,
      })),
    }));
  }

  // POST /api/sessions { name?, activeId? } — 新建或切换 session
  if (req.method === 'POST' && pathname === '/api/sessions') {
    const body = await readBody(req);
    if (body.activeId) {
      const target = getSession(body.activeId);
      if (!target) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'session 不存在' }));
      }
      activeSessionId = target.id;
      saveSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, activeId: activeSessionId }));
    }
    // 新建
    const s = newSession((body.name || '').trim());
    sessions.push(s);
    activeSessionId = s.id;
    saveSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, session: s, activeId: activeSessionId }));
  }

  // POST /api/sessions/:id/rename — 重命名 session
  if (req.method === 'POST' && /^\/api\/sessions\/[^/]+\/rename$/.test(pathname)) {
    const id = pathname.split('/')[3];
    const s = sessions.find(s => s.id === id);
    if (!s) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'session 不存在' }));
    }
    const body = await readBody(req);
    const name = (body.name || '').trim();
    if (!name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'name 不能为空' }));
    }
    s.name = name;
    saveSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, session: s }));
  }

  // DELETE /api/sessions?id=xxx — 删除 session（移入回收站）
  if (req.method === 'DELETE' && pathname === '/api/sessions') {
    const id = url.searchParams.get('id');
    const idx = sessions.findIndex(s => s.id === id);
    if (idx < 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'session 不存在' }));
    }
    const deleted = sessions.splice(idx, 1)[0];
    trashedSessions.push({ session: deleted, deletedAt: Date.now() });
    if (!sessions.length) sessions.push(newSession());
    if (activeSessionId === id) activeSessionId = sessions[0].id;
    saveSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, activeId: activeSessionId, trashed: deleted.id }));
  }

  // GET /api/sessions/trash — 列出回收站中的 session
  if (req.method === 'GET' && pathname === '/api/sessions/trash') {
    const now = Date.now();
    // 清理过期条目
    trashedSessions = trashedSessions.filter(t => now - t.deletedAt < TRASH_RETENTION_MS);
    const list = trashedSessions.map(t => ({
      id: t.session.id,
      name: t.session.name,
      deletedAt: t.deletedAt,
      expiresAt: t.deletedAt + TRASH_RETENTION_MS,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ trash: list }));
  }

  // POST /api/sessions/restore — 从回收站恢复 session
  if (req.method === 'POST' && pathname === '/api/sessions/restore') {
    const body = await readBody(req);
    const id = body.id;
    const idx = trashedSessions.findIndex(t => t.session.id === id);
    if (idx < 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '回收站中不存在该 session' }));
    }
    const restored = trashedSessions.splice(idx, 1)[0].session;
    sessions.push(restored);
    activeSessionId = restored.id;
    saveSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, session: restored, activeId: activeSessionId }));
  }

  // GET /api/history?sessionId=xxx — 返回指定 session 的历史
  if (req.method === 'GET' && pathname === '/api/history') {
    const sid = url.searchParams.get('sessionId') || activeSessionId;
    const s = getSession(sid) || getActiveSession();
    const allHistory = s?.history || [];
    const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '40', 10);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 40, 1), 100);
    const requestedBefore = Number.parseInt(url.searchParams.get('before') || String(allHistory.length), 10);
    const before = Math.min(Math.max(Number.isFinite(requestedBefore) ? requestedBefore : allHistory.length, 0), allHistory.length);
    const start = Math.max(0, before - limit);
    const history = allHistory.slice(start, before);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      sessionId: s?.id,
      history,
      page: {
        start,
        end: before,
        limit,
        total: allHistory.length,
        hasMore: start > 0,
        nextBefore: start > 0 ? start : null,
      },
    }));
  }

  // POST /api/chat { message, sessionId? } — SSE 流式对话，支持 @mention 路由
  if (req.method === 'POST' && pathname === '/api/chat') {
    const body = await readBody(req);
    const message = (body.message || '').trim();
    const clientRunId = String(body.clientRunId || '');
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!message && !attachments.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'message 不能为空' }));
    }

    const session = (body.sessionId && getSession(body.sessionId)) || getActiveSession();
    // 客户端指定 sessionId 时同步切换激活
    if (body.sessionId && getSession(body.sessionId)) activeSessionId = body.sessionId;

    // 解析 @mention 路由；如果默认 codex 不可启动，就自动选一个可用 agent。
    const requestedAgent = parseAtMention(message) || agentKeys()[0] || 'codex';
    const { agentKey, status: agentStatus } = await resolveRunnableAgent(requestedAgent);
    const textMessage = stripAtMentions(message).trim();
    const imageOnlyMessage = attachments.length && !textMessage
      ? '请分析我刚上传的图片，并直接回复你观察到的内容、问题和建议。'
      : textMessage;
    const cleanMessage = `${imageOnlyMessage}${attachmentPrompt(attachments)}`.trim();

    maybeAutoRenameSession(session, cleanMessage || message);
    recordSessionMode(session, 'chat');

    // 存入对话历史（按 session）
    session.history.push({ role: 'user', text: message, agent: null, attachments });
    refreshSessionContinuity(session, 'user_message');
    saveSessions();

    const prompt = buildChatPrompt(cleanMessage, agentKey, session.history);

    sseInit(res);
    sseSend(res, 'start', { agent: agentKey, sessionId: session.id });

    let fullReply = '';
    const turnCollector = createTurnPartsCollector();
    const turnStartedAt = Date.now();
    try {
      if (!agentStatus?.available) {
        throw new Error(`${agentKey} 不可用：${agentStatus?.error || '没有可启动的 agent'}`);
      }
      fullReply = await streamAgent(agentKey, prompt, res, 'chunk', {
        sessionId: session.id,
        clientRunId,
        turnCollector,
      });
      const msgIndex = session.history.length;
      const chatArtifacts = extractArtifacts(fullReply, { sessionId: session.id, agent: agentKey, messageIndex: msgIndex });
      session.history.push({
        role: 'assistant',
        text: fullReply,
        agent: agentKey,
        parts: turnCollector.parts,
        artifacts: chatArtifacts,
        startedAt: turnStartedAt,
        finishedAt: Date.now(),
      });
      if (session.history.length > 40) session.history.splice(0, session.history.length - 40);
      refreshSessionContinuity(session, 'post_run');
      saveSessions();
      sseSend(res, 'done', { agent: agentKey, sessionId: session.id });
    } catch (err) {
      // 不再 pop 用户消息，保留失败现场让用户刷新后能看到
      turnCollector.append({ type: 'error', message: err.message, status: 'error' });
      session.history.push({
        role: 'assistant',
        text: turnCollector.finalText(),
        agent: agentKey,
        kind: 'chat-error',
        parts: turnCollector.parts,
        startedAt: turnStartedAt,
        finishedAt: Date.now(),
      });
      refreshSessionContinuity(session, 'tool_result');
      saveSessions();
      sseSend(res, 'error', { message: err.message });
    }
    return res.end();
  }

  // GET /api/status — agent 配置 + 路径检测
  if (req.method === 'GET' && pathname === '/api/status') {
    const agents = (await getAgentStatuses()).map(stripSensitive);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ agents, workspace: currentWorkspace() }));
  }

  // GET /api/running — 返回当前活跃的子进程信息（用于刷新后恢复状态）
  // GET /api/sessions/:id/stream - reconnect to a running session live SSE stream
  // (replays buffered events + subscribes to future output after a page refresh)
  {
    const m = pathname.match(/^\/api\/sessions\/([\w-]+)\/stream$/);
    if (req.method === 'GET' && m) {
      const sid = m[1];
      sseInit(res);
      const attached = busAttach(sid, res);
      if (!attached) {
        sseSend(res, 'nostream', { sessionId: sid });
        return res.end();
      }
      const cleanup = () => busDetach(sid, res);
      req.on('close', cleanup);
      req.on('aborted', cleanup);
      return;
    }
  }

  if (req.method === 'GET' && pathname === '/api/running') {
    const running = [];
    for (const [cid, record] of activeChildren) {
      if (!record.aborted) {
        running.push({
          cid,
          sessionId: record.sessionId,
          clientRunId: record.clientRunId,
          agentKey: record.agentKey,
          mode: record.mode,
          taskTitle: record.taskTitle,
          startedAt: record.startedAt,
        });
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ running }));
  }

  // GET /api/agents — 返回当前 agent 路径配置（脱敏显示）
  if (req.method === 'GET' && pathname === '/api/agents') {
    const result = (await getAgentStatuses()).map(stripSensitive);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ agents: result, workspace: currentWorkspace() }));
  }

  // PATCH /api/agents/:key — 更新单个 agent 的角色卡字段
  const agentPatchMatch = pathname.match(/^\/api\/agents\/([^\/]+)$/);
  if (req.method === 'PATCH' && agentPatchMatch) {
    const agentKey = decodeURIComponent(agentPatchMatch[1]);
    const body = await readBody(req);
    const current = readAgentRegistry(ENV);
    const idx = current.findIndex(a => a.key === agentKey);
    if (idx === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `agent ${agentKey} 不存在` }));
    }
    if (!requireApproval(res, {
      operation: 'config.write',
      payload: { target: `agent.${agentKey}`, changes: body },
      approvalId: body.approvalId,
    })) return;
    // 只允许更新角色卡字段和基础展示字段
    const allowed = ['label', 'emoji', 'desc', 'baseUrl', 'apiKey', 'model', 'roleDescription', 'personality', 'strengths', 'restrictions', 'nickname', 'avatar', 'color'];
    for (const field of allowed) {
      if (body[field] !== undefined) current[idx][field] = body[field];
    }
    writeAgentRegistry(current);
    reloadAgentConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, agent: current[idx] }));
  }

  // POST /api/agents/:key/avatar — 上传头像
  const avatarUploadMatch = pathname.match(/^\/api\/agents\/([^\/]+)\/avatar$/);
  if (req.method === 'POST' && avatarUploadMatch) {
    const agentKey = decodeURIComponent(avatarUploadMatch[1]);
    const current = readAgentRegistry(ENV);
    const idx = current.findIndex(a => a.key === agentKey);
    if (idx === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `agent ${agentKey} 不存在` }));
    }

    const body = await readBody(req);
    const { data, ext } = body;
    if (!data || typeof data !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '缺少 data 字段（base64 编码的图片）' }));
    }

    // 解析 base64
    const match = data.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/);
    if (!match) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'data 必须是 data:image/xxx;base64,... 格式' }));
    }
    const [, imgType, base64Data] = match;
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > 2 * 1024 * 1024) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '图片大小不能超过 2MB' }));
    }

    // 保存到 .myteam/avatars/:key.ext
    const avatarsDir = '.myteam/avatars';
    mkdirSync(avatarsDir, { recursive: true });
    const fileName = `${agentKey}.${imgType === 'jpeg' ? 'jpg' : imgType}`;
    const filePath = resolve(avatarsDir, fileName);
    writeFileSync(filePath, buffer);

    // 更新 agent.avatar
    current[idx].avatar = `/avatars/${fileName}`;
    writeAgentRegistry(current);
    reloadAgentConfig();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, avatar: current[idx].avatar, agent: current[idx] }));
  }

  // POST /api/agents { codex?: string, claude?: string, kimi?: string } — 写回 .env，实时重载
  if (req.method === 'POST' && pathname === '/api/agents') {
    const body = await readBody(req);
    if (!requireApproval(res, {
      operation: 'config.write',
      payload: { target: 'agents', agents: body.agents || Object.keys(body).filter((key) => AGENT_KEYS.includes(key)) },
      approvalId: body.approvalId,
    })) return;
    const current = readAgentRegistry(ENV);
    const currentByKey = new Map(current.map(a => [a.key, a]));

    const nextAgents = Array.isArray(body.agents)
      ? body.agents.map(incoming => {
          const prev = currentByKey.get(incoming.key) || {};
          const inherited = currentByKey.get(incoming.inheritFrom) || {};
          // apiKey 为空字符串时保留已有值（前端不传明文则不覆盖）
          const apiKey = (incoming.apiKey !== undefined && String(incoming.apiKey).trim() !== '')
            ? String(incoming.apiKey).trim()
            : (prev.apiKey || inherited.apiKey || '');
          return { ...prev, ...incoming, apiKey };
        })
      : current.map(agent => ({
          ...agent,
          path: body[agent.key] !== undefined ? String(body[agent.key] || '').trim() : agent.path,
        }));

    writeAgentRegistry(nextAgents);
    reloadAgentConfig();
    const updatedAgents = (await getAgentStatuses({ force: true })).map(stripSensitive);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, agents: updatedAgents, workspace: currentWorkspace() }));

    const updates = {};
    if (body.codex !== undefined) updates.CODEX_PATH = body.codex.trim();
    if (body.claude !== undefined) updates.CLAUDE_PATH = body.claude.trim();
    if (body.kimi !== undefined) updates.KIMI_PATH = body.kimi.trim();

    if (Object.keys(updates).length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '没有需要更新的字段' }));
    }

    // 读取现有 .env，更新对应 key，写回
    const envPath = '.env';
    let lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split('\n') : [];
    for (const [key, val] of Object.entries(updates)) {
      const idx = lines.findIndex(l => l.startsWith(`${key}=`));
      const newLine = `${key}=${val}`;
      if (idx >= 0) lines[idx] = newLine;
      else lines.push(newLine);
    }
    writeFileSync(envPath, lines.join('\n'), 'utf8');

    // 实时重载 CLI_CONFIG（无需重启服务）
    const newEnv = loadEnv(envPath);
    const newCfg = buildCliConfig(newEnv);
    CLI_CONFIG.codex  = newCfg.codex;
    CLI_CONFIG.claude = newCfg.claude;
    CLI_CONFIG.kimi   = newCfg.kimi;
    clearAgentStatusCache();

    const result = (await getAgentStatuses({ force: true })).map(stripSensitive);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, agents: result }));
  }

  // GET /api/tasks
  if (req.method === 'GET' && pathname === '/api/tasks') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ tasks: readTasks() }));
  }

  // GET /api/models?baseUrl=...&apiKey=... — 从 OpenAI 兼容 API 拉取模型列表
  if (req.method === 'GET' && pathname === '/api/models') {
    const baseUrl = (url.searchParams.get('baseUrl') || '').trim().replace(/\/+$/, '');
    const apiKey = (url.searchParams.get('apiKey') || '').trim();
    if (!baseUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'baseUrl 不能为空' }));
    }
    try {
      const { default: https } = await import('https');
      const { default: http } = await import('http');
      const modelsUrl = new URL(`${baseUrl}/models`);
      const lib = modelsUrl.protocol === 'https:' ? https : http;
      const reqOptions = { timeout: 5000 };
      if (apiKey) reqOptions.headers = { Authorization: `Bearer ${apiKey}` };
      const data = await new Promise((resolve, reject) => {
        const hreq = lib.get(modelsUrl.toString(), reqOptions, (resp) => {
          let body = '';
          resp.on('data', c => { body += c; });
          resp.on('end', () => {
            try { resolve(JSON.parse(body)); } catch { reject(new Error(`返回非 JSON: ${body.slice(0, 80)}`)); }
          });
        });
        hreq.on('error', reject);
        hreq.on('timeout', () => { hreq.destroy(); reject(new Error('请求超时')); });
      });
      const models = (data.data || data.models || []).map(m => typeof m === 'string' ? m : (m.id || m.name || '')).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ models }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ models: [], error: err.message }));
    }
  }


  if (req.method === 'GET' && pathname === '/api/skills') {
    const skills = readSkills();
    const text = url.searchParams.get('text') || '';
    const agent = url.searchParams.get('agent') || '';
    const phase = url.searchParams.get('phase') || 'run';
    const currentSkill = url.searchParams.get('current') || '';
    const selected = selectSkills({ text, agent, phase });
    
    // 如果指定了 current skill，返回推荐的下一阶段 skills
    const nextSkills = currentSkill ? getNextSkills(currentSkill) : [];
    
    const summary = {
      total: skills.length,
      categories: [...new Set(skills.map(s => s.category).filter(Boolean))],
      agents: ['controller', 'worker', 'reviewer', ...agentKeys()],
      selected: selected.length,
      nextRecommended: nextSkills.length,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      skills,
      selected,
      nextSkills,
      summary,
      contextPreview: buildSkillContext(selected),
    }));
  }

  // POST /api/skills/import — 导入 skill（追加 yaml 或单条 JSON）
  if (req.method === 'POST' && pathname === '/api/skills/import') {
    const body = await readBody(req);
    if (!requireApproval(res, {
      operation: 'skill.install',
      payload: { source: 'inline', name: body.skill?.name || 'yaml-import' },
      approvalId: body.approvalId,
    })) return;
    try {
      const lines = [];
      if (typeof body.yaml === 'string' && body.yaml.trim()) {
        // 直接追加 yaml 文本
        lines.push(body.yaml.trimEnd());
      } else if (body.skill && typeof body.skill === 'object') {
        const s = body.skill;
        if (!s.name) throw new Error('skill.name 必填');
        lines.push(`- name: ${s.name}`);
        if (s.category)    lines.push(`  category: ${s.category}`);
        if (s.trigger)     lines.push(`  trigger: ${s.trigger}`);
        if (s.description) lines.push(`  description: ${s.description}`);
        if (s.load)        lines.push(`  load: ${s.load}`);
        if (s.prompt)      lines.push(`  prompt: ${JSON.stringify(s.prompt)}`);
        if (s.mounts && typeof s.mounts === 'object') {
          lines.push('  mounts:');
          for (const [role, on] of Object.entries(s.mounts)) {
            lines.push(`    ${role}: ${on ? 'true' : 'false'}`);
          }
        }
      } else {
        throw new Error('需要 yaml 文本或 skill 对象');
      }
      mkdirSync('.myteam', { recursive: true });
      const header = existsSync(SKILLS_FILE) ? '' : 'skills:\n';
      const append = (header ? header : '') + lines.join('\n') + '\n';
      appendFileSync(SKILLS_FILE, append, 'utf8');
      const skills = readSkills();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, total: skills.length, skills }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // ── Studio 团队模板 API ────────────────────────────────────────────────────

  // GET /api/studio-templates — 列出所有团队模板
  if (req.method === 'GET' && pathname === '/api/studio-templates') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ templates: STUDIO_TEMPLATES }));
  }

  // POST /api/studio-templates/apply { templateId } — 应用模板（只更新角色卡字段，保留路径/apiKey/baseUrl/model）
  if (req.method === 'POST' && pathname === '/api/studio-templates/apply') {
    const body = await readBody(req);
    const { templateId } = body;
    const tpl = STUDIO_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `模板不存在: ${templateId}` }));
    }
    const current = readAgentRegistry(ENV);
    const currentByKey = new Map(current.map(a => [a.key, a]));

    // 只覆盖模板中出现的 agent 的角色卡字段，其余 agent 原样保留
    const merged = current.map(agent => {
      const tplAgent = tpl.agents.find(t => t.key === agent.key);
      if (!tplAgent) return agent;
      return {
        ...agent,
        roleDescription: tplAgent.roleDescription || agent.roleDescription,
        personality:     tplAgent.personality     || agent.personality,
        strengths:       tplAgent.strengths        ?? agent.strengths,
        restrictions:    tplAgent.restrictions     ?? agent.restrictions,
      };
    });

    writeAgentRegistry(merged);
    reloadAgentConfig();
    const updatedAgents = (await getAgentStatuses({ force: true })).map(stripSensitive);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, template: tpl.name, agents: updatedAgents }));
  }

  // ── Skill 市场 & 生命周期 API ─────────────────────────────────────────────

  // GET /api/skills/registry?source=myteam-official|clowder-ai — 远程市场清单
  if (req.method === 'GET' && pathname === '/api/skills/registry') {
    const source = url.searchParams.get('source') || 'myteam-official';
    const srcCfg = SKILL_SOURCES[source];
    if (!srcCfg) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `未知 source: ${source}`, sources: Object.keys(SKILL_SOURCES) }));
    }
    try {
      const registry = await loadSkillRegistry(source, srcCfg);
      let skills = registry.skills;
      // 标记本地已安装的
      const installed = new Set(
        existsSync(SKILLS_DIR) ? readdirSync(SKILLS_DIR, { withFileTypes: true })
          .filter(e => e.isDirectory()).map(e => e.name) : []
      );
      skills = skills.map(s => ({ ...s, installed: installed.has(s.name) }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        source,
        label: srcCfg.label,
        skills,
        sources: Object.keys(SKILL_SOURCES),
        cached: registry.cached,
        stale: Boolean(registry.stale),
      }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `拉取失败: ${err.message}` }));
    }
  }

  // POST /api/skills/install { source, name } — 下载并安装 skill
  if (req.method === 'POST' && pathname === '/api/skills/install') {
    const body = await readBody(req);
    const { source = 'myteam-official' } = body;
    const name = sanitizeSkillName(body.name);
    if (!name || name === 'unnamed') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'name 必填' }));
    }
    if (!requireApproval(res, {
      operation: 'skill.install',
      payload: { source, name },
      approvalId: body.approvalId,
    })) return;
    const srcCfg = SKILL_SOURCES[source];
    if (!srcCfg) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `未知 source: ${source}` }));
    }
    try {
      let mdContent = '';
      if (srcCfg.type === 'index') {
        const raw = await readSkillSourceIndex(srcCfg);
        const data = JSON.parse(raw);
        const entry = (data.skills || []).find(s => s.name === name);
        if (!entry) throw new Error(`市场中找不到 skill: ${name}`);
        mdContent = await readSkillMarkdownFromEntry(srcCfg, entry);
      } else if (srcCfg.type === 'manifest') {
        mdContent = await httpGet(`${srcCfg.rawBase}/${name}/SKILL.md`);
      }

      // 写到 .myteam/skills/{name}/SKILL.md
      const destDir = `${SKILLS_DIR}/${name}`;
      mkdirSync(destDir, { recursive: true });
      writeFileSync(`${destDir}/SKILL.md`, mdContent, 'utf8');

      // 写 skills-state.json（默认 enabled）
      const state = readSkillsState();
      state[name] = { enabled: true, source, installedAt: new Date().toISOString() };
      writeSkillsState(state);

      const skill = readSkillFromDir(SKILLS_DIR, name);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, skill }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `安装失败: ${err.message}` }));
    }
  }

  // POST /api/skills/:name/toggle { enabled } — 启用/禁用 skill
  const skillToggleMatch = pathname.match(/^\/api\/skills\/([^\/]+)\/toggle$/);
  if (req.method === 'POST' && skillToggleMatch) {
    const skillName = decodeURIComponent(skillToggleMatch[1]);
    const body = await readBody(req);
    const state = readSkillsState();
    state[skillName] = { ...(state[skillName] || {}), enabled: Boolean(body.enabled) };
    writeSkillsState(state);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, name: skillName, enabled: state[skillName].enabled }));
  }

  // PATCH /api/skills/:name/mounts { controller, worker, ... } — 调整挂载
  const skillMountsMatch = pathname.match(/^\/api\/skills\/([^\/]+)\/mounts$/);
  if (req.method === 'PATCH' && skillMountsMatch) {
    const skillName = decodeURIComponent(skillMountsMatch[1]);
    const body = await readBody(req);
    const state = readSkillsState();
    state[skillName] = {
      ...(state[skillName] || {}),
      mounts: { ...(state[skillName]?.mounts || {}), ...body },
    };
    writeSkillsState(state);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, name: skillName, mounts: state[skillName].mounts }));
  }

  // DELETE /api/skills/:name — 卸载 skill
  const skillDeleteMatch = pathname.match(/^\/api\/skills\/([^\/]+)$/);
  if (req.method === 'DELETE' && skillDeleteMatch) {
    const skillName = decodeURIComponent(skillDeleteMatch[1]);
    const body = await readBody(req);
    if (!requireApproval(res, {
      operation: 'skill.delete',
      payload: { name: skillName },
      approvalId: body.approvalId,
    })) return;
    const skillPath = `${SKILLS_DIR}/${skillName}`;
    if (existsSync(skillPath)) {
      rmSync(skillPath, { recursive: true, force: true });
    }
    const state = readSkillsState();
    delete state[skillName];
    writeSkillsState(state);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, name: skillName }));
  }

  // GET /api/artifacts?sessionId=&limit=50 — 返回 chat-extracted artifacts
  if (req.method === 'GET' && pathname === '/api/artifacts') {
    const sid = url.searchParams.get('sessionId') || activeSessionId;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 200);
    const target = getSession(sid);
    const artifacts = [];
    if (target) {
      for (const msg of target.history) {
        if (Array.isArray(msg.artifacts)) artifacts.push(...msg.artifacts);
      }
    }
    // 按 createdAt 倒序，同 path 去重（保留最新）
    const seen = new Map();
    for (const a of artifacts.sort((x, y) => y.createdAt - x.createdAt)) {
      const key = a.path || a.id;
      if (!seen.has(key)) seen.set(key, a);
    }
    const result = [...seen.values()].slice(0, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ artifacts: result, total: result.length }));
  }

  // ── Workspace 文件 API（对齐 clowder-ai F063 安全模型）────────────────────

  function wsRoot() { return resolve(currentWorkspace() || '.'); }

  function wsGuard(userPath) {
    const root = wsRoot();
    const abs = resolve(root, userPath.replace(/^\//, ''));
    let real;
    try { real = realpathSync(abs); } catch { real = abs; }
    if (!real.startsWith(root + sep) && real !== root) {
      return { error: '路径越界' };
    }
    const rel = relative(root, real);
    for (const deny of WORKSPACE_DENYLIST) {
      if (rel.startsWith(deny) || rel.includes(sep + deny) || basename(real).includes(deny)) {
        return { error: '路径被禁止访问' };
      }
    }
    return { abs: real, rel };
  }

  function wsIsTextFile(filePath) {
    const textExts = new Set([
      'txt','md','markdown','html','htm','css','js','mjs','cjs','ts','tsx','jsx','json','yaml','yml',
      'py','rb','go','rs','java','c','cpp','h','sh','bash','zsh','fish','sql','xml','svg','toml','ini',
      'env','example','gitignore','csv','log','conf','cfg','vue','svelte',
    ]);
    return textExts.has(extname(filePath).slice(1).toLowerCase());
  }

  // GET /api/workspace/recent?limit=20 — 最近修改的文件（常规产出区扫描）
  if (req.method === 'GET' && pathname === '/api/workspace/recent') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
    const root = wsRoot();
    const files = [];

    for (const dir of WORKSPACE_SCAN_DIRS) {
      const scanPath = dir ? join(root, dir) : root;
      if (!existsSync(scanPath)) continue;
      try {
        const entries = readdirSync(scanPath, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isFile()) continue;
          const abs = join(scanPath, e.name);
          const rel = relative(root, abs);
          const denied = WORKSPACE_DENYLIST.some(d =>
            rel.startsWith(d) || rel.includes(sep + d) || e.name.includes(d)
          );
          if (denied) continue;
          try {
            const st = statSync(abs);
            files.push({ path: rel.replace(/\\/g, '/'), name: e.name, size: st.size, mtime: st.mtimeMs });
          } catch { /* skip */ }
        }
      } catch { /* dir not readable */ }
    }

    files.sort((a, b) => b.mtime - a.mtime);
    const result = files.slice(0, limit).map(f => ({
      ...f,
      type: wsIsTextFile(f.name) ? 'text' : 'binary',
      lang: extToLang(f.name),
      mimeType: guessMime(f.name),
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ files: result }));
  }

  // GET /api/workspace/file?path= — 读取文件内容
  if (req.method === 'GET' && pathname === '/api/workspace/file') {
    const userPath = url.searchParams.get('path') || '';
    const guard = wsGuard(userPath);
    if (guard.error) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: guard.error }));
    }
    if (!existsSync(guard.abs)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '文件不存在' }));
    }
    const st = statSync(guard.abs);
    if (st.size > 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '文件超过 1MB 限制', size: st.size }));
    }
    if (!wsIsTextFile(guard.abs)) {
      res.writeHead(415, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '二进制文件暂不支持文本预览', size: st.size }));
    }
    const content = readFileSync(guard.abs, 'utf8');
    const sha256 = createHash('sha256').update(content).digest('hex').slice(0, 16);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      path: guard.rel.replace(/\\/g, '/'),
      content,
      size: st.size,
      mtime: st.mtimeMs,
      sha256,
      lang: extToLang(basename(guard.abs)),
      mimeType: guessMime(basename(guard.abs)),
    }));
  }

  // GET /api/workspace/raw?path= — 原始文件字节流（HTML 浏览器打开用）
  if (req.method === 'GET' && pathname === '/api/workspace/raw') {
    const userPath = url.searchParams.get('path') || '';
    const guard = wsGuard(userPath);
    if (guard.error) {
      res.writeHead(403); return res.end(guard.error);
    }
    if (!existsSync(guard.abs)) {
      res.writeHead(404); return res.end('Not Found');
    }
    const st = statSync(guard.abs);
    if (st.size > 4 * 1024 * 1024) {
      res.writeHead(413); return res.end('Too Large');
    }
    const mime = guessMime(basename(guard.abs));
    res.writeHead(200, { 'Content-Type': mime });
    return res.end(readFileSync(guard.abs));
  }

  // POST /api/workspace/open-html — 使用系统默认浏览器打开工作区 HTML
  if (req.method === 'POST' && pathname === '/api/workspace/open-html') {
    try {
      const body = await readBody(req);
      const target = resolveWorkspaceHtmlPath(wsRoot(), body.path, WORKSPACE_DENYLIST);
      openPathWithDefaultApp(target.abs);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, path: target.rel }));
    } catch (error) {
      const message = String(error?.message || error);
      const status = /不存在/.test(message) ? 404 : /不在|禁止|仅支持|无效|缺少|不是文件/.test(message) ? 400 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: message }));
    }
  }

  // GET /api/invocations — 返回 agent 调用记录，用于轻量成本/稳定性看板
  if (req.method === 'GET' && pathname === '/api/invocations') {
    const invocations = readInvocations();
    const recent = invocations.slice(-200).reverse();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      summary: summarizeInvocations(invocations),
      invocations: recent,
    }));
  }

  // PATCH /api/tasks/:id/agent — 修改任务分配的 agent
  const taskAgentMatch = pathname.match(/^\/api\/tasks\/([^\/]+)\/agent$/);
  if (req.method === 'PATCH' && taskAgentMatch) {
    const taskId = decodeURIComponent(taskAgentMatch[1]);
    const body = await readBody(req);
    const newAgent = (body.agent || '').trim();
    if (!newAgent) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'agent 不能为空' }));
    }
    const tasks = readTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '任务不存在' }));
    }
    task.agent = newAgent;
    writeAllTasks(tasks);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, task }));
  }

  // POST /api/tasks/:id/rerun — 重新执行单个任务
  const rerunMatch = pathname.match(/^\/api\/tasks\/([^\/]+)\/rerun$/);
  if (req.method === 'POST' && rerunMatch) {
    const taskId = decodeURIComponent(rerunMatch[1]);
    const tasks = readTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '任务不存在' }));
    }
    
    // 重置任务状态为 pending
    task.status = 'pending';
    task.result = null;
    task.error = null;
    task.started_at = null;
    task.finished_at = null;
    task.gate_status = null;
    task.review_status = null;
    task.review_note = null;
    task.reviewed_at = null;
    task.reviewer = null;
    task.test_status = null;
    task.previous_result = null;
    writeAllTasks(tasks);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, task }));
  }

  // POST /api/tasks/:id/gate — 人工 Reviewer Gate：通过或要求返工
  const gateMatch = pathname.match(/^\/api\/tasks\/([^\/]+)\/gate$/);
  if (req.method === 'POST' && gateMatch) {
    const taskId = decodeURIComponent(gateMatch[1]);
    const body = await readBody(req);
    const decision = body.decision;
    const note = (body.note || '').trim();
    const tasks = readTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '任务不存在' }));
    }

    if (!['pass', 'rework'].includes(decision)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'decision 必须是 pass 或 rework' }));
    }

    if (decision === 'pass' && task.status !== 'done') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '只有已完成任务才能通过 Gate' }));
    }

    const now = new Date().toISOString();
    if (decision === 'pass') {
      Object.assign(task, {
        gate_status: 'passed',
        review_status: 'passed',
        review_note: note || '人工确认通过',
        reviewed_at: now,
        reviewer: 'human',
        test_status: 'manual_passed',
        phase: 'done', // SOP: gate → done (最终完成)
      });
    } else {
      Object.assign(task, {
        status: 'pending',
        gate_status: 'rework',
        review_status: 'rework',
        review_note: note || '人工要求返工，请按验收标准补齐结果',
        reviewed_at: now,
        reviewer: 'human',
        test_status: 'manual_rework',
        previous_result: task.result || task.previous_result || null,
        result: null,
        error: null,
        started_at: null,
        finished_at: null,
        phase: 'impl', // SOP: rework 回退到 impl
      });
    }

    writeAllTasks(tasks);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, task }));
  }

  // POST /api/tasks/:id/phase — 手动推进 SOP 阶段（用于自动流程未覆盖的场景）
  const phaseMatch = pathname.match(/^\/api\/tasks\/([^\/]+)\/phase$/);
  if (req.method === 'POST' && phaseMatch) {
    const taskId = decodeURIComponent(phaseMatch[1]);
    const body = await readBody(req);
    const targetPhase = body.phase;
    const tasks = readTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '任务不存在' }));
    }

    const validation = validatePhaseTransition(task, targetPhase);
    if (!validation.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: validation.reason }));
    }

    task.phase = targetPhase;
    task.phase_updated_at = new Date().toISOString();
    writeAllTasks(tasks);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, task }));
  }

  // DELETE /api/tasks/:id — 删除单个任务
  const deleteMatch = pathname.match(/^\/api\/tasks\/([^\/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const taskId = decodeURIComponent(deleteMatch[1]);
    const tasks = readTasks();
    const filtered = tasks.filter(t => t.id !== taskId);
    if (filtered.length === tasks.length) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '任务不存在' }));
    }
    writeAllTasks(filtered);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, deleted: taskId }));
  }

  // GET /api/lessons — 返回踩坑记录
  if (req.method === 'GET' && pathname === '/api/lessons') {
    const lessons = repository.list('lessons');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ lessons }));
  }

  // GET /api/lessons/patterns — 返回 pattern 分析和改进提案（对齐 clowder-ai self-evolution）
  if (req.method === 'GET' && pathname === '/api/lessons/patterns') {
    const patterns = detectPatterns();
    const proposals = patterns
      .filter(p => p.needsProposal)
      .map(p => generateProposal(p));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ patterns, proposals }));
  }

  // POST /api/lessons/promote — 晋升有效经验到 memory.md（对齐 clowder-ai 知识成熟度阶梯）
  if (req.method === 'POST' && pathname === '/api/lessons/promote') {
    const body = await readBody(req);
    const lessonId = body.lessonId;
    const insight = (body.insight || '').trim();
    
    if (!lessonId || !insight) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'lessonId 和 insight 必填' }));
    }

    const lessons = readJsonl(LESSONS_FILE);
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'lesson 不存在' }));
    }

    // 追加到 memory.md
    const memoryFile = '.myteam/memory.md';
    const entry = `\n## ${lesson.task_title} (${lesson.pattern})\n\n${insight}\n\n- 来源: ${lesson.timestamp}\n- Agent: ${lesson.agent}\n- 原始错误: ${lesson.error?.slice(0, 200)}\n`;
    appendFileSync(memoryFile, entry, 'utf8');

    // 标记 lesson 为已晋升
    lesson.promoted = true;
    lesson.promoted_at = new Date().toISOString();
    lesson.promoted_insight = insight;
    repository.upsert('lessons', lesson);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, lesson }));
  }

  // POST /api/plan { goal, agent, sessionId?, attachments? } — SSE 流式返回
  if (req.method === 'POST' && pathname === '/api/plan') {
    const body = await readBody(req);
    const goal = (body.goal || '').trim();
    const clientRunId = String(body.clientRunId || '');
    const requestedAgent = body.agent || '';
    const { agentKey, status: agentStatus } = await resolveRunnableAgent(requestedAgent);
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!goal && !attachments.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'goal 不能为空' }));
    }

    const session = (body.sessionId && getSession(body.sessionId)) || getActiveSession();
    if (body.sessionId && getSession(body.sessionId)) activeSessionId = body.sessionId;
    recordSessionMode(session, 'plan');
    maybeAutoRenameSession(session, goal || '图片拆任务');
    session.history.push({ role: 'user', text: goal, agent: null, kind: 'plan-goal', attachments });
    refreshSessionContinuity(session, 'user_message');
    saveSessions();

    sseInit(res);
    sseSend(res, 'start', { goal, agent: agentKey, sessionId: session.id });

    try {
      if (!agentStatus?.available) {
        throw new Error(`${agentKey} 不可用：${agentStatus?.error || '没有可启动的 agent'}。请在右上角 Agent 配置里换成可启动的 CLI。`);
      }
      if (requestedAgent && requestedAgent !== agentKey) {
        sseSend(res, 'status', { agent: agentKey, phase: 'fallback', text: `${requestedAgent} 不可用，已自动改用 ${agentKey} 拆任务` });
      }
      const effectiveGoal = goal || '请根据上传的图片内容制定合理的执行计划';
      const skillContext = buildSkillContext(selectSkills({ text: effectiveGoal, agent: agentKey, phase: 'plan' }));
      // 拆任务阶段不让 agent 直接看图（避免 view_image 工具调用导致 exit 1）；
      // 只告知"有图"，由后续执行 agent 阶段处理读图。
      const imgPrompt = attachmentPromptForPlan(attachments);
      const prompt = `${PLAN_PROMPT}${skillContext ? `\n\n本次按需加载的 Skills：\n${skillContext}` : ''}\n\n用户目标：${effectiveGoal}${imgPrompt}`;
      const raw = await streamAgent(agentKey, prompt, res, 'chunk', {
        skipRoleCard: true,
        sessionId: session.id,
        clientRunId,
        outputSchemaPath: agentKey === 'codex' ? PLAN_SCHEMA_FILE : '',
      });
      const parsedPlan = parseStructuredPlanOutput(raw, {
        goal: effectiveGoal,
        defaultAgent: agentKey,
        allowedAgents: agentKeys(),
      });
      if (!parsedPlan.ok) {
        console.error('[plan] structured plan failed. raw length:', raw.length);
        console.error('[plan] raw output (first 2000 chars):\n' + raw.slice(0, 2000));
        const reason = raw.trim() ? parsedPlan.reason : parsedPlan.reason + ' (agent output empty - likely only thinking stream or CLI error)';
        session.history.push({
          role: 'system',
          text: `plan failed: ${reason}\nraw (first 400):\n${raw.slice(0, 400)}`,
          agent: agentKey,
          kind: 'plan-error',
        });
        saveSessions();
        sseSend(res, 'error', { message: `plan parse failed (${reason})`, raw: raw.slice(0, 400) });
        return res.end();
      }
      const data = parsedPlan.data;
      const runId = randomUUID().slice(0, 8);
      const now = new Date().toISOString();
      data.tasks.forEach((t, i) => {
        appendTask({
          id: `${runId}-${i + 1}`,
          run_id: runId,
          created_at: now,
          session_id: session.id, // 关联 session
          goal: data.goal || goal,
          title: t.title ?? `任务 ${i + 1}`,
          // 五件套（对齐 clowder-ai cross-cat-handoff）
          why: t.why ?? '',
          tradeoff: t.tradeoff ?? '',
          open_questions: Array.isArray(t.open_questions) ? t.open_questions : [],
          steps: t.steps ?? [],
          accept: t.accept ?? '',
          agent: t.agent ?? agentKey,
          status: 'pending',
          phase: 'pending', // SOP 状态机初始阶段
        });
      });
      const taskSummaries = data.tasks.map((t, i) => ({
        id: `${runId}-${i + 1}`,
        title: t.title ?? `任务 ${i + 1}`,
        agent: t.agent ?? agentKey,
        accept: t.accept ?? '',
        steps: t.steps ?? [],
        why: t.why ?? '',
        tradeoff: t.tradeoff ?? '',
        open_questions: Array.isArray(t.open_questions) ? t.open_questions : [],
      }));
      // 把 plan 结果写入 session 历史，刷新后能复现
      session.history.push({
        role: 'plan',
        agent: agentKey,
        kind: 'plan-result',
        runId,
        goal: data.goal || goal,
        tasks: taskSummaries,
        text: `已拆分为 ${taskSummaries.length} 个任务（run ${runId}）`,
      });
      saveSessions();
      sseSend(res, 'done', {
        runId,
        written: data.tasks.length,
        tasks: taskSummaries,
        structuredMode: parsedPlan.mode || (agentKey === 'codex' ? 'schema' : 'compat'),
      });
    } catch (err) {
      session.history.push({
        role: 'system',
        text: `拆任务失败：${err.message}`,
        agent: agentKey,
        kind: 'plan-error',
      });
      saveSessions();
      // 把完整错误信息（含 stderr）暴露给前端，方便用户排查
      sseSend(res, 'error', { message: err.message, raw: '' });
    }
    return res.end();
  }

  // POST /api/dispatch { runId?, taskId?, agent? } — SSE
  // 支持 A2A Worklist：agent 回复中的 @mention 自动触发链式任务
  if (req.method === 'POST' && pathname === '/api/dispatch') {
    const body = await readBody(req);
    const clientRunId = String(body.clientRunId || '');
    const sessionId = String(body.sessionId || '');
    const filterRun = body.runId || '';
    const filterTask = body.taskId || '';
    const filterAgent = body.agentOnly || '';
    const agentOverride = body.agent || '';
    const dispatchSession = getSession(sessionId) || getActiveSession();

    let pending = readTasks().filter(t => t.status === 'pending');
    if (filterRun) pending = pending.filter(t => t.run_id === filterRun);
    if (filterTask) pending = pending.filter(t => t.id === filterTask);
    if (filterAgent) pending = pending.filter(t => t.agent === filterAgent);

    const selection = filterTask
      ? `task:${filterTask}`
      : filterRun
        ? `run:${filterRun}`
        : filterAgent
          ? `agent:${filterAgent}`
          : 'all_pending';

    if (!requireApproval(res, {
      operation: 'agent.dispatch',
      payload: {
        selection,
        pendingCount: pending.length,
        requestedAgent: agentOverride || 'task_assignment',
      },
      sessionId: dispatchSession?.id || sessionId,
      approvalId: body.approvalId,
    })) return;

    sseInit(res);
    sseSend(res, 'start', { count: pending.length, agentOnly: filterAgent || null });

    // 教训4: dispatch 前先备份，防止执行过程中数据意外丢失
    const backupPath = backupTasks();
    if (backupPath) sseSend(res, 'backup', { path: backupPath });

    if (!pending.length) {
      sseSend(res, 'done', { done: 0, failed: 0 });
      return res.end();
    }

    let done = 0, failed = 0;

    function buildTaskCollaborationContext(task) {
      const capsule = refreshSessionContinuity(dispatchSession, 'dispatch');
      const continuity = formatContinuityBridge(capsule);
      const evidence = buildTopKEvidenceBridge({
        query: [task.goal, task.title, task.accept, ...(task.steps || [])].join('\n'),
        history: dispatchSession?.history || [],
        capsule,
        k: 3,
      });
      const workspace = buildWorkspaceBridge({ workspace: currentWorkspace() });
      saveSessions();
      return [continuity, evidence, workspace].filter(Boolean).join('\n\n');
    }

    // 自动 reviewer：对齐 clowder-ai cross-model review 铁律
    // 选一个 != executor 的可用 agent 做静默调用，解析 JSON 写回 task。
    // 失败/无可用 reviewer 时降级为 review_status=skipped，不影响主流程。
    async function runAutoReview(task, executorAgent, executionResult, collaborationContext = '') {
      try {
        const statuses = await getAgentStatuses();
        const reviewer = statuses.find(a => a.available && a.key !== executorAgent);
        if (!reviewer) {
          patchTask(task.id, {
            review_status: 'skipped',
            review_note: '没有可用的 != executor 的 reviewer agent',
            reviewer: null,
            reviewed_at: new Date().toISOString(),
          });
          sseSend(res, 'task-review-skip', { id: task.id, reason: 'no-reviewer' });
          return;
        }
        sseSend(res, 'task-review-start', { id: task.id, reviewer: reviewer.key });
        const reviewPrompt = buildReviewPrompt(task, executorAgent, executionResult)
          + (collaborationContext ? '\n\n【协作上下文】\n' + collaborationContext : '');
        // 静默调用：reviewer 不流式发到前端，避免和 executor 输出混在一起
        const raw = await invokeAgent(CLI_CONFIG, reviewer.key, reviewPrompt, { silent: true, timeoutMs: 5 * 60 * 1000 });
        const data = extractJson(raw || '');
        if (!data || typeof data !== 'object' || !['pass', 'rework'].includes(data.verdict)) {
          patchTask(task.id, {
            review_status: 'parse_failed',
            review_note: 'reviewer 输出无法解析为有效 JSON',
            reviewer: reviewer.key,
            reviewed_at: new Date().toISOString(),
            review_raw: String(raw || '').slice(0, 600),
          });
          sseSend(res, 'task-review-failed', { id: task.id, reviewer: reviewer.key, reason: 'parse_failed' });
          return;
        }
        const findings = Array.isArray(data.findings) ? data.findings.map(String).filter(Boolean) : [];
        patchTask(task.id, {
          review_status: data.verdict,        // 'pass' | 'rework'
          review_severity: data.severity || 'none',
          review_score: Number.isFinite(Number(data.score)) ? Number(data.score) : null,
          review_findings: findings,
          review_note: String(data.suggestion || '').slice(0, 500),
          reviewer: reviewer.key,
          reviewed_at: new Date().toISOString(),
          phase: data.verdict === 'pass' ? 'review' : 'impl', // SOP: impl → review (pass) or back to impl (rework)
        });
        sseSend(res, 'task-review-done', {
          id: task.id,
          reviewer: reviewer.key,
          verdict: data.verdict,
          severity: data.severity || 'none',
          score: data.score ?? null,
          findings,
          suggestion: data.suggestion || '',
        });
      } catch (err) {
        patchTask(task.id, {
          review_status: 'failed',
          review_note: `reviewer 调用失败：${err.message}`,
          reviewed_at: new Date().toISOString(),
        });
        sseSend(res, 'task-review-failed', { id: task.id, error: err.message });
      }
    }

    // 执行单个任务并返回结果文本（用于 worklist 链检测）
    async function executeTask(task, depth = 0, chainHistory = []) {
      // 优先用 agentOverride（全局覆盖），其次用任务分配的 agent（需可用），最后 fallback 到第一个可用 agent
      let agentKey = agentOverride;
      if (!agentKey) {
        const statuses = await getAgentStatuses();
        const taskAgentStatus = statuses.find(a => a.key === task.agent);
        if (taskAgentStatus?.available) {
          agentKey = task.agent;
        } else {
          // 任务指定的 agent 不可用，找第一个可用的
          const fallback = statuses.find(a => a.available);
          agentKey = fallback?.key || agentKeys()[0] || 'codex';
          sseSend(res, 'system', { text: `⚠️ ${task.agent} 不可用，改用 ${agentKey} 执行任务「${task.title}」` });
        }
      }
      let subagentRunId = task.subagent_run_id || '';
      if (depth > 0 && !subagentRunId) {
        const run = createSubagentRun({
          parentSessionId: dispatchSession?.id || sessionId,
          parentTaskId: task.parent_task_id || '',
          taskId: task.id,
          agent: agentKey,
          task: task.title,
          label: task.title,
        });
        subagentRunId = run.id;
      }
      patchTask(task.id, {
        status: 'in_progress',
        started_at: new Date().toISOString(),
        subagent_run_id: subagentRunId || null,
      });
      sseSend(res, 'task-start', {
        id: task.id,
        title: task.title,
        agent: agentKey,
        subagentRunId: subagentRunId || null,
      });
      if (depth > 0) {
        pushChainMessage(task.id, { type: 'task-start', agent: agentKey, title: task.title, subagentRunId });
        updateSubagentRun(subagentRunId, { status: 'running', agent: agentKey });
        appendSubagentMessage(subagentRunId, { type: 'system', content: 'Subagent started: ' + task.title });
      }
      try {
        const skillText = [task.goal, task.title, task.accept, ...(task.steps || [])].join('\n');
        const skillContext = buildSkillContext(selectSkills({ text: skillText, agent: agentKey, phase: 'run' }));
        const collaborationContext = buildTaskCollaborationContext(task);
        const execPrompt = buildExecPrompt(task, skillContext)
          + '\n\n【协作上下文】\n' + collaborationContext
          + '\n\n【子代理派生协议】\n' + SPAWN_SUBAGENT_PROTOCOL;
        const result = await streamAgent(agentKey, execPrompt, res, `task-chunk:${task.id}`, { sessionId, clientRunId });
        const taskArtifacts = extractArtifacts(result, { sessionId, agent: agentKey, messageIndex: null });
        patchTask(task.id, {
          status: 'done',
          finished_at: new Date().toISOString(),
          executed_by: agentKey,
          result: result?.slice(0, 2000),
          artifacts: taskArtifacts,
          phase: 'impl', // SOP: pending → impl
        });
        const summary = result ? result.slice(0, 200) : '';
        sseSend(res, 'task-done', {
          id: task.id,
          title: task.title,
          agent: agentKey,
          summary,
          subagentRunId: subagentRunId || null,
        });
        done++;
        if (depth > 0) {
          pushChainMessage(task.id, { type: 'task-done', agent: agentKey, title: task.title, summary, subagentRunId });
          appendSubagentMessage(subagentRunId, { type: 'assistant', content: result || '' });
          updateSubagentRun(subagentRunId, {
            status: 'done',
            finishedAt: Date.now(),
            resultSummary: summary,
          });
        } else if (dispatchSession) {
          dispatchSession.history.push({
            role: 'assistant',
            agent: agentKey,
            kind: 'task-result',
            taskId: task.id,
            text: result?.slice(0, 1600) || '',
          });
          if (dispatchSession.history.length > 40) {
            dispatchSession.history.splice(0, dispatchSession.history.length - 40);
          }
          refreshSessionContinuity(dispatchSession, 'post_run');
          saveSessions();
        }

        // 推荐下一阶段 skill（对齐 clowder-ai manifest.yaml 的 next 链）
        const currentSkills = selectSkills({ text: skillText, agent: agentKey, phase: 'run' });
        if (currentSkills.length > 0) {
          const nextSkills = getNextSkills(currentSkills[0].name);
          if (nextSkills.length > 0) {
            sseSend(res, 'skill-next-recommend', {
              id: task.id,
              currentSkill: currentSkills[0].name,
              nextSkills: nextSkills.map(s => ({ name: s.name, category: s.category, prompt: s.prompt })),
            });
          }
        }

        // 跨 agent 自动 review（对齐 clowder-ai cross-model review 铁律）
        // 链式 worklist 任务（chain_depth > 0）跳过 review，避免审查链爆炸
        if (depth === 0) {
          await runAutoReview(
            { ...task, ...readTasks().find(t => t.id === task.id) },
            agentKey,
            result,
            collaborationContext,
          );
        }

        // A2A Worklist：扫描回复中的 @mention，自动创建并执行链式任务
        if (result && depth < WORKLIST_MAX_DEPTH) {
          const structuredSpawns = parseSpawnSubagentDirectives(result, agentKeys());
          const spawnRequests = structuredSpawns.length
            ? structuredSpawns
            : parseA2AMentions(result).map((agent) => ({
                agent,
                task: '继续处理「' + task.title + '」的后续工作',
                label: task.title,
                accept: '',
              }));
          for (const spawnRequest of spawnRequests) {
            const nextAgent = spawnRequest.agent;
            if (nextAgent === agentKey) continue; // 跳过自己，防止死循环
            
            // IMP-002: 乒乓球熔断检测（防止 A→B→A→B 无限交替）
            const newHistory = [...chainHistory, agentKey];
            const tail = newHistory.slice(-4);
            const isPingPong = tail.length >= 4
              && tail[0] === tail[2] && tail[1] === tail[3]
              && tail[0] !== tail[1];
            if (isPingPong) {
              sseSend(res, 'worklist-circuit-break', {
                reason: `乒乓球熔断：${tail.join(' → ')} 交替循环，终止链式执行`,
                chain_history: newHistory,
              });
              continue;
            }
            
            const chainId = randomUUID().slice(0, 8);
            // IMP-003: 携带上游 agent 的分析摘要（参考 clowder-ai 五件套交接）
            const upstreamSummary = result.slice(0, 300).replace(/\n+/g, ' ').trim();
            const chainTask = {
              id: `${task.run_id}-w${chainId}`,
              run_id: task.run_id,
              created_at: new Date().toISOString(),
              session_id: dispatchSession?.id || sessionId,
              goal: task.goal,
              title: `[A2A] ${agentKey} → @${nextAgent}: ${spawnRequest.label || task.title}`,
              why: '由上游 agent 通过 spawn_subagent 协议派生',
              steps: [
                `上游 ${agentKey} 的分析：${upstreamSummary}`,
                spawnRequest.task,
              ],
              accept: spawnRequest.accept || '',
              agent: nextAgent,
              status: 'pending',
              parent_task_id: task.id,
              chain_depth: depth + 1,
              spawn_protocol: structuredSpawns.length ? 'spawn_subagent' : 'mention-fallback',
            };
            appendTask(chainTask);
            sseSend(res, 'worklist-chain', {
              from: agentKey,
              to: nextAgent,
              parent_id: task.id,
              chain_task_id: chainTask.id,
            });
            await executeTask(chainTask, depth + 1, newHistory);
          }
        }
        return result;
      } catch (err) {
        patchTask(task.id, {
          status: 'failed',
          finished_at: new Date().toISOString(),
          executed_by: agentKey,
          error: err.message,
        });
        appendLesson(task, err);
        sseSend(res, 'task-failed', { id: task.id, title: task.title, agent: agentKey, error: err.message });
        failed++;
        if (depth > 0) {
          pushChainMessage(task.id, { type: 'task-failed', agent: agentKey, title: task.title, error: err.message, subagentRunId });
          appendSubagentMessage(subagentRunId, { type: 'system', content: 'Subagent failed: ' + err.message, isError: true });
          updateSubagentRun(subagentRunId, {
            status: 'error',
            finishedAt: Date.now(),
            error: err.message,
          });
        }
        return null;
      }
    }

    for (const task of pending) {
      await executeTask(task, 0);
    }

    sseSend(res, 'done', { done, failed });
    return res.end();
  }

  if (req.method === 'POST' && pathname === '/api/skills/install-source') {
    const body = await readBody(req);
    const { url, path: localPath, zip: zipPath } = body;
    const requestedName = body.name ? sanitizeSkillName(body.name) : '';
    if (!requireApproval(res, {
      operation: 'skill.install',
      payload: { source: url || localPath || zipPath || 'unknown', name: requestedName },
      approvalId: body.approvalId,
    })) return;
    try {
      let mdContent = '';
      let skillName = requestedName;
      if (url && parseGithubUrl(url)) {
        const r = await cloneAndFindSkillMd(url);
        mdContent = r.mdContent;
        skillName = skillName || r.name;
      } else if (url && isRemoteUrl(url)) {
        const tmpDir = '.myteam/.tmp-skill-dl-' + randomUUID().slice(0,6);
        mkdirSync(tmpDir, { recursive: true });
        const zipFile = tmpDir + '/skill.zip';
        const raw = await httpGetBuffer(url);
        writeFileSync(zipFile, raw);
        await extractZip(zipFile, tmpDir);
        const found = findSkillMdInDir(tmpDir);
        if (!found) throw new Error('ZIP has no SKILL.md');
        mdContent = readFileSync(found, 'utf8');
        skillName = skillName || inferSkillName(mdContent, basename(dirname(found)));
      } else if (localPath || zipPath) {
        const src = localPath || zipPath;
        const absPath = resolve(src);
        if (!existsSync(absPath)) throw new Error('Path not found');
        const st = statSync(absPath);
        if (st.isDirectory()) {
          const found = findSkillMdInDir(absPath);
          if (!found) throw new Error('No SKILL.md in dir');
          mdContent = readFileSync(found, 'utf8');
          skillName = skillName || inferSkillName(mdContent, basename(dirname(found)));
        } else if (absPath.toLowerCase().endsWith('.zip')) {
          const tmpDir = '.myteam/.tmp-skill-extract-' + randomUUID().slice(0,6);
          mkdirSync(tmpDir, { recursive: true });
          await extractZip(absPath, tmpDir);
          const found = findSkillMdInDir(tmpDir);
          if (!found) throw new Error('ZIP has no SKILL.md');
          mdContent = readFileSync(found, 'utf8');
          skillName = skillName || inferSkillName(mdContent, basename(dirname(found)));
        } else {
          throw new Error('Need dir or .zip');
        }
      } else {
        throw new Error('No install source');
      }
      skillName = sanitizeSkillName(skillName);
      const destDir = SKILLS_DIR + '/' + skillName;
      mkdirSync(destDir, { recursive: true });
      writeFileSync(destDir + '/SKILL.md', mdContent, 'utf8');
      const state = readSkillsState();
      state[skillName] = { enabled: true, source: 'local', installedAt: new Date().toISOString() };
      writeSkillsState(state);
      const skill = readSkillFromDir(SKILLS_DIR, skillName);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, skill }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Install failed: ' + err.message }));
    }
  }

  if (req.method === 'POST' && pathname === '/api/shell/exec') {
    const body = await readBody(req);
    const command = (body.command || '').trim();
    if (!command) { res.writeHead(400); return res.end(JSON.stringify({ error: 'command required' })); }
    const danger = getDangerLevel(command);
    if (danger.level !== 'safe') {
      if (!requireApproval(res, {
        operation: 'shell.execute',
        payload: { command, level: danger.level, reason: danger.reason },
        sessionId: body.sessionId,
        approvalId: body.approvalId,
      })) return;
    }
    const runId = randomUUID().slice(0, 8);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, runId, command, level: 'safe' }));
    executeShell(command, runId, { approvalId: body.approvalId, sessionId: body.sessionId });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/shell/exec-confirm') {
    const body = await readBody(req);
    const command = (body.command || '').trim();
    if (!command) { res.writeHead(400); return res.end(JSON.stringify({ error: 'command required' })); }
    const danger = getDangerLevel(command);
    if (!requireApproval(res, {
      operation: 'shell.execute',
      payload: { command, level: danger.level, reason: danger.reason },
      sessionId: body.sessionId,
      approvalId: body.approvalId,
    })) return;
    const runId = randomUUID().slice(0, 8);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, runId, command }));
    executeShell(command, runId, { approvalId: body.approvalId, sessionId: body.sessionId });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/shell/stream') {
    const runId = url.searchParams.get('runId') || '';
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const interval = setInterval(() => {
      const data = shellResults.get(runId);
      if (data) { res.write('data: ' + JSON.stringify(data) + '\n\n'); if (data.done) { clearInterval(interval); shellResults.delete(runId); res.end(); } }
    }, 500);
    req.on('close', () => { clearInterval(interval); });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/outputs') {
    const list = existsSync(OUTPUTS_DIR) ? readdirSync(OUTPUTS_DIR).filter(f => f.endsWith('.html')) : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ files: list }));
  }

  if (req.method === 'GET' && pathname === '/api/outputs/file') {
    const fname = url.searchParams.get('name') || '';
    if (!fname || fname.includes('..') || fname.includes('/') || fname.includes('\\')) {
      res.writeHead(400); return res.end('invalid name');
    }
    const fpath = join(OUTPUTS_DIR, fname);
    if (!existsSync(fpath)) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(readFileSync(fpath, 'utf8'));
  }

  if (req.method === 'GET' && pathname === '/api/subagents') {
    const parentSessionId = url.searchParams.get('sessionId') || '';
    const runs = listSubagentRuns(parentSessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      runs,
      summary: {
        total: runs.length,
        running: runs.filter((run) => run.status === 'running').length,
        done: runs.filter((run) => run.status === 'done').length,
        error: runs.filter((run) => run.status === 'error').length,
      },
    }));
  }

  const subagentMessagesMatch = pathname.match(/^\/api\/subagents\/([^/]+)\/messages$/);
  if (req.method === 'GET' && subagentMessagesMatch) {
    const runId = decodeURIComponent(subagentMessagesMatch[1]);
    const run = listSubagentRuns().find((item) => item.id === runId) || null;
    const messages = listSubagentMessages(runId);
    res.writeHead(run ? 200 : 404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(run ? { run, messages } : { error: 'subagent run 不存在' }));
  }

  if (req.method === 'GET' && pathname === '/api/chain-task/messages') {
    const taskId = url.searchParams.get('taskId') || '';
    const persistedRun = listSubagentRuns().find((run) => run.taskId === taskId) || null;
    const persisted = persistedRun ? listSubagentMessages(persistedRun.id) : [];
    const messages = persisted.length
      ? persisted.map((message) => {
          if (message.isError) {
            return {
              type: 'task-failed',
              agent: persistedRun.agent,
              title: persistedRun.label,
              error: message.content,
              timestamp: message.timestamp,
            };
          }
          if (message.type === 'assistant') {
            return {
              type: 'task-done',
              agent: persistedRun.agent,
              title: persistedRun.label,
              summary: String(message.content || '').slice(0, 200),
              timestamp: message.timestamp,
            };
          }
          return {
            type: 'task-start',
            agent: persistedRun.agent,
            title: persistedRun.label,
            timestamp: message.timestamp,
          };
        })
      : getChainMessages(taskId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ taskId, run: persistedRun, messages }));
  }

  if (req.method === 'GET' && pathname === '/api/chain-task/stream') {
    const taskId = url.searchParams.get('taskId') || '';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    if (!chainTaskSSE.has(taskId)) chainTaskSSE.set(taskId, new Set());
    chainTaskSSE.get(taskId).add(res);
    const existing = getChainMessages(taskId);
    if (existing.length > 0) {
      for (const msg of existing) {
        res.write('data: ' + JSON.stringify(msg) + '\n\n');
      }
    }
    res.write('data: ' + JSON.stringify({ type: 'connected', taskId }) + '\n\n');
    req.on('close', () => {
      if (chainTaskSSE.has(taskId)) chainTaskSSE.get(taskId).delete(res);
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

const server = createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error('handler error:', err);
    if (!res.headersSent) res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ 端口 ${PORT} 已被占用。`);
    console.error(`  请先关闭占用该端口的进程，或用以下命令强制释放：`);
    console.error(`\n    Windows: for /f "tokens=5" %a in ('netstat -aon ^| findstr ":${PORT}"') do taskkill /F /PID %a`);
    console.error(`\n  或指定其他端口：py -3 myteam.py serve --port 7879\n`);
  } else {
    console.error('server error:', err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`\n  myteam server running on http://localhost:${PORT}\n`);
});
