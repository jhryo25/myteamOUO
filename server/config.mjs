// myteam server — 共享配置 & 常量
import { resolve } from 'path';
import { loadEnv, buildCliConfig, readAgentRegistry } from '../agent-utils.mjs';
import { ensurePlanSchemaFile, recoverStaleSubagentRuns } from '../collaboration-context.mjs';

export let ENV = loadEnv();
export let CLI_CONFIG = buildCliConfig(ENV);

export const LESSONS_FILE = '.myteam/lessons.jsonl';
export const SKILLS_FILE = '.myteam/skills.yaml';
export const SKILLS_DIR = '.myteam/skills';
export const SKILLS_STATE_FILE = '.myteam/skills-state.json';
export const INVOCATIONS_FILE = '.myteam/invocations.jsonl';
export const SETTINGS_FILE = '.myteam/settings.json';
export const UPLOADS_DIR = '.myteam/uploads';
export const OUTPUTS_DIR = '.myteam/outputs';
export const PLAN_SCHEMA_FILE = ensurePlanSchemaFile();

// Agent 状态缓存
export const AGENT_STATUS_TTL_MS = 5000;
export let agentStatusCache = { time: 0, agents: null };

// skill 市场远程源配置
export const SKILL_SOURCES = {
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

// 静态文件 MIME 类型表
export const MIME = {
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

export const SKILL_REGISTRY_TTL_MS = 5 * 60 * 1000;
export const skillRegistryCache = new Map();

export function reloadAgentConfig() {
  ENV = loadEnv();
  CLI_CONFIG = buildCliConfig(ENV);
  clearAgentStatusCache();
}

export function clearAgentStatusCache() {
  agentStatusCache = { time: 0, agents: null };
}

export function agentKeys() {
  return Object.keys(CLI_CONFIG);
}

export function currentWorkspace() {
  return resolve(loadSettings().workspace || '.');
}

// 需延迟导入的模块以避免循环依赖
export const _imports = {
  loadSettings: null,  // 将由会话服务设置
};

export function loadSettings() { return _imports.loadSettings?.() || { workspace: '.' }; }

export const STUDIO_TEMPLATES = [
  {
    id: 'quick-prototype', name: '快速原型',
    desc: '2 人轻量：Codex 拆任务 + Kimi 快速执行，适合小目标快速出结果。',
    agents: [
      { key: 'codex', label: 'Codex', emoji: '...', roleDescription: '任务规划专家，把目标拆成可验收的子任务并分配给 Kimi 执行。', personality: '严谨、有条理、强调验收标准', strengths: ['任务拆解', '优先级排序', '验收标准撰写'], restrictions: ['不直接编码', '不做最终实现决策'] },
      { key: 'kimi', label: 'Kimi', emoji: '...', roleDescription: '快速执行者，接收明确的小任务并尽快产出结果。', personality: '高效、简洁、直接给出结果', strengths: ['快速执行', '简单任务', '草稿生成'], restrictions: [] },
    ],
  },
  {
    id: 'full-stack', name: '全栈协作',
    desc: '经典 3 人：Codex 规划 + Claude 深度实现 + Kimi 轻量执行，适合中等复杂度项目。',
    agents: [
      { key: 'codex', label: 'Codex', emoji: '...', roleDescription: '总控：拆任务、分配角色、协调进度，负责最终审查和经验沉淀。', personality: '严谨、务实、追求代码质量', strengths: ['任务拆解', '代码审查', '进度协调'], restrictions: ['不直接编码', '不做最终实现决策'] },
      { key: 'claude', label: 'Claude', emoji: '...', roleDescription: '主架构 / 深度实现：负责复杂模块、架构设计、高质量代码生成。', personality: '善于推理、思维发散、喜欢先理解全局再落地细节', strengths: ['架构设计', '复杂推理', '长文档生成'], restrictions: [] },
      { key: 'kimi', label: 'Kimi', emoji: '...', roleDescription: '轻量执行：负责简单任务、草稿补全、CLI 命令执行。', personality: '高效、简洁、直接给出结果', strengths: ['快速执行', '简单任务', '草稿生成'], restrictions: [] },
    ],
  },
  {
    id: 'strict-review', name: '严格审查',
    desc: '高质量保障：Codex 规划 + Claude 实现兼审查 + Kimi 执行，双重把关不放水。',
    agents: [
      { key: 'codex', label: 'Codex', emoji: '...', roleDescription: '总控：拆任务、分配角色、最终经验沉淀。坚持验收标准不降低。', personality: '严格、务实、不接受"差不多好了"', strengths: ['任务拆解', '验收标准撰写', '经验沉淀'], restrictions: ['不直接编码'] },
      { key: 'claude', label: 'Claude', emoji: '...', roleDescription: '主力实现 + 审查官：既负责复杂代码，也负责 Reviewer Gate 决策，引用证据而不是主观感受。', personality: '严格、关注细节、引用证据说话', strengths: ['架构设计', '代码审查', '逻辑核对', '安全检查'], restrictions: ['不跳过测试', '不降低验收标准'] },
      { key: 'kimi', label: 'Kimi', emoji: '...', roleDescription: '快速执行：接收明确子任务，执行并汇报结果给 Claude 审查。', personality: '高效、透明汇报、不隐瞒错误', strengths: ['快速执行', '简单任务'], restrictions: ['必须如实汇报执行结果和错误'] },
    ],
  },
  {
    id: 'research', name: '研究调研',
    desc: '2 人深研：Claude 深度分析 + Codex 归纳整理，适合技术调研、方案评估、文档生成。',
    agents: [
      { key: 'claude', label: 'Claude', emoji: '...', roleDescription: '首席研究员：多角度分析、拆解技术方案、产出结构化报告。', personality: '细心、引用准确、总结清晰', strengths: ['资料检索', '源码解读', '技术对比', '撰写报告'], restrictions: ['不做实现', '不下架构结论'] },
      { key: 'codex', label: 'Codex', emoji: '...', roleDescription: '整合归纳：把 Claude 的研究成果整理成可操作的任务列表和决策文档。', personality: '清晰、简洁、面向行动', strengths: ['归纳总结', '任务化输出', '文档整理'], restrictions: ['不重复 Claude 的分析'] },
    ],
  },
];

// 确保 recoverStaleSubagentRuns 在模块加载时执行
recoverStaleSubagentRuns();
