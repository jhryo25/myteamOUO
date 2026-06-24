// myteam prompt templates — LangChain ChatPromptTemplate 模式
// 完全向后兼容：现有 agent-utils.mjs 和 server.mjs 的调用方不需要任何改动。
//
// 用法：
//   import { buildChatPrompt, buildExecPrompt, buildReviewPrompt, PLAN_PROMPT } from './prompts.mjs';
//   const prompt = buildChatPrompt({ userMessage, agentKey, history });
//   行为与旧版 agent-utils.mjs / server.mjs 完全一致。

import {
  ChatPromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
} from '@langchain/core/prompts';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';

// ── Rich Blocks 提示（server.mjs 原有常量） ──────────────────────
export const RICH_BLOCKS_HINT = `
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
- 角色卡仅在用户明确要求生成"角色卡"或"成员档案"时使用；普通自我介绍不要使用：
  :::role name="姓名" tag="标签"
  描述
  :::
- 普通自我介绍用 2-4 句自然语言即可，不要重复身份信息、能力清单或开场项目符号，除非用户明确要求详细介绍
`;

// ── 各 Agent 系统角色 ─────────────────────────────────────────
export const CHAT_SYSTEM = {
  codex:  `You are Codex, a helpful AI assistant in the myteam workspace. You help with code, analysis, and task planning. Reply in Chinese. Prefer reasonable assumptions over asking follow-up questions. Ask only when missing information makes useful progress impossible or creates irreversible risk; when asking, provide 1-3 mutually exclusive suggested answers plus an Other option.${RICH_BLOCKS_HINT}`,
  claude: `You are Claude, a helpful AI assistant in the myteam workspace. You excel at deep thinking, writing, and architecture. Reply in Chinese. Prefer reasonable assumptions over asking follow-up questions. Ask only when missing information makes useful progress impossible or creates irreversible risk; when asking, provide 1-3 mutually exclusive suggested answers plus an Other option.${RICH_BLOCKS_HINT}`,
  kimi:   `You are Kimi, a helpful AI assistant in the myteam workspace. You handle lightweight execution, drafting, and quick analysis. Reply in Chinese. Prefer reasonable assumptions over asking follow-up questions. Ask only when missing information makes useful progress impossible or creates irreversible risk; when asking, provide 1-3 mutually exclusive suggested answers plus an Other option.${RICH_BLOCKS_HINT}`,
};

// ── Chat Prompt 模板 ───────────────────────────────────────────
const _chatTemplates = new Map();

function getChatTemplate(agentKey) {
  if (!_chatTemplates.has(agentKey)) {
    const system = CHAT_SYSTEM[agentKey] || CHAT_SYSTEM.codex;
    _chatTemplates.set(agentKey, ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(system),
      new MessagesPlaceholder('history'),
      HumanMessagePromptTemplate.fromTemplate('{userMessage}'),
    ]));
  }
  return _chatTemplates.get(agentKey);
}

/**
 * 构建 Chat prompt（替换 server.mjs 的 buildChatPrompt）。
 * 签名与旧版兼容：
 *   buildChatPrompt(userMessage, agentKey, history)
 * 也支持对象形式：
 *   buildChatPrompt({ userMessage, agentKey, history })
 */
export async function buildChatPrompt(userMessage, agentKey, history) {
  let parsed;
  if (typeof userMessage === 'object' && userMessage !== null) {
    parsed = userMessage;
  } else {
    parsed = { userMessage, agentKey, history };
  }
  const msg = String(parsed.userMessage || '');
  const key = String(parsed.agentKey || 'codex');
  const hist = Array.isArray(parsed.history) ? parsed.history.slice(-10) : [];

  // 把旧版 { role, text, agent } 格式转成 LangChain 消息对象
  const langChainMessages = hist.map((h) => {
    const content = String(h.text || '');
    if (h.role === 'user') return new HumanMessage(content);
    return new AIMessage(content);
  });

  const template = getChatTemplate(key);
  return template.format({
    userMessage: msg,
    history: langChainMessages,
  });
}

// ── Plan Prompt 模板 ───────────────────────────────────────────
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
- 每个 open_questions 项必须给出 question 和 1-3 个互斥、可直接选择的 options；界面会额外提供"其他"文本选项

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

// LangChain 侧：plan prompt 的结构化版本（给 ChatModel 用）
// 注意：PLAN_PROMPT 包含 JSON 模板字符 {，LangChain 的 f-string 模板解析器会误解析。
// 因此使用 PromptTemplate（不带 f-string 解析）或直接用字符串。
export const planPromptTemplate = null; // 预留接口，待 ChatModel 集成时启用

// ── 执行 Prompt 模板 ──────────────────────────────────────────
const _execTemplate = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(`你是 myteam 的执行 agent，请完成以下任务。

【自主执行原则】
- 优先根据任务上下文、行业常见默认值和可逆方案自主完成，不要把能够自行判断的问题反问用户
- 计划阶段的必要确认已经在 open_questions 中处理；执行时如仍有轻微歧义，采用风险最低的合理假设并在结果中说明
- 只有缺失信息会导致任务完全无法继续或产生明显不可逆风险时，才停止并说明阻塞原因`),
  HumanMessagePromptTemplate.fromTemplate(`任务标题：{title}
所属目标：{goal}
{handoff}
执行步骤：
{steps}
{accept}
{reworkNote}
{previousResult}
{upstreamContext}
{skills}

请执行上述任务，给出完整的执行结果和说明。
如有未澄清的 Open Questions，请在结果开头先给出你的处理方式。

【工具权限说明】
本次执行中所有工具调用已自动批准，无需等待用户确认权限。
请直接完成全部任务，不要因权限问题中断执行。`),
]);

/**
 * 构建执行 prompt（替换 agent-utils.mjs 的 buildExecPrompt）。
 * 签名与旧版完全兼容：
 *   buildExecPrompt(task, skillContext?)
 */
export async function buildExecPrompt(task = {}, skillContext = '') {
  const steps = (task.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const accept = task.accept ? `\n验收标准：${task.accept}` : '';
  const reworkNote = task.review_note ? `\n返工说明：${task.review_note}` : '';
  const previousResult = task.previous_result
    ? `\n上一次结果摘要：${String(task.previous_result).slice(0, 600)}`
    : '';
  const skills = skillContext ? `\n本次按需加载的 Skills：\n${skillContext}` : '';

  // 五件套交接上下文
  const handoffParts = [];
  if (task.why)       handoffParts.push(`Why（为什么做）：${task.why}`);
  if (task.tradeoff)  handoffParts.push(`Tradeoff（放弃的方案）：${task.tradeoff}`);
  const openList = Array.isArray(task.open_questions) ? task.open_questions.filter(Boolean) : [];
  if (openList.length) handoffParts.push(`Open Questions（待澄清点）：\n${openList.map(q => `  - ${typeof q === 'string' ? q : q.question}`).join('\n')}`);
  const clarificationAnswers = Array.isArray(task.clarification_answers) ? task.clarification_answers : [];
  if (clarificationAnswers.length) handoffParts.push(`用户确认结果：\n${clarificationAnswers.map(item => `  - ${item.question} → ${item.answer}`).join('\n')}`);
  if (task.clarification_other) handoffParts.push(`用户其他补充：${task.clarification_other}`);
  const handoff = handoffParts.length ? `\n【上游交接】\n${handoffParts.join('\n')}` : '';

  const upstreamCtx = task.upstream_context ? `\n【上游任务输出】\n${String(task.upstream_context).slice(0, 800)}` : '';

  return _execTemplate.format({
    title: task.title || '',
    goal: task.goal || '',
    handoff,
    steps: steps || '（无具体步骤，请自行判断）',
    accept,
    reworkNote,
    previousResult,
    upstreamContext: upstreamCtx,
    skills,
  });
}

// ── Review Prompt 模板 ─────────────────────────────────────────
export const REVIEW_PROMPT_RULES = `你是 myteam 的 Reviewer agent。
你正在 review 另一个 agent 的任务执行结果。

【强制规则】
- 唯一输出是 JSON，第一个字符必须是左大括号，最后一个字符必须是右大括号
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

const _reviewTemplate = ChatPromptTemplate.fromMessages([
  SystemMessagePromptTemplate.fromTemplate(REVIEW_PROMPT_RULES),
  HumanMessagePromptTemplate.fromTemplate(`【被审任务】
任务标题：{title}
所属目标：{goal}
执行 agent：{executorAgent}
{handoff}
执行步骤：
{steps}
验收标准：{accept}

【执行结果】
{executionResult}

请给出结构化 review JSON。`),
]);

/**
 * 构建 review prompt（替换 agent-utils.mjs 的 buildReviewPrompt）。
 * 签名与旧版完全兼容：
 *   buildReviewPrompt(task, executorAgent, executionResult)
 */
export async function buildReviewPrompt(task = {}, executorAgent = '', executionResult = '') {
  const openList = Array.isArray(task.open_questions) ? task.open_questions.filter(Boolean).map(q => typeof q === 'string' ? q : q.question) : [];
  const handoffParts = [];
  if (task.why)      handoffParts.push(`Why：${task.why}`);
  if (task.tradeoff) handoffParts.push(`Tradeoff：${task.tradeoff}`);
  if (openList.length) handoffParts.push(`Open Questions：${openList.join(' / ')}`);
  const handoff = handoffParts.length ? `\n【原始交接五件套】\n${handoffParts.join('\n')}` : '';
  const steps = (task.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n');

  return _reviewTemplate.format({
    title: task.title || '',
    goal: task.goal || '',
    executorAgent: String(executorAgent || ''),
    handoff,
    steps: steps || '（无）',
    accept: task.accept || '（未指定）',
    executionResult: String(executionResult || '').slice(0, 2000),
  });
}
