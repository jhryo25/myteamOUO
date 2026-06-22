export const PRODUCT_TEMPLATES = Object.freeze([
  {
    id: 'repo-diagnosis',
    icon: '🛠',
    title: '仓库诊断与修复',
    summary: '从定位问题到实现、测试和跨 Agent 审查。',
    mode: 'plan',
    prompt: '检查当前仓库，找出一个影响用户体验或稳定性的高优先级问题。先说明证据和影响，再完成修复、运行相关测试，并由不同 Agent 按验收标准复核。最终交付：问题说明、改动文件、验证结果和剩余风险。',
    deliverable: '修复说明 + 代码改动 + 验证结果',
  },
  {
    id: 'product-research',
    icon: '🔎',
    title: '竞品研究与产品方案',
    summary: '把资料收集、产品判断和质疑验证拆成协作任务。',
    mode: 'plan',
    prompt: '围绕我接下来补充的产品主题完成竞品研究。请拆分为资料核验、用户与场景分析、竞品矩阵、机会点、方案设计和 Reviewer 质疑。所有关键结论标明证据或说明推断。最终交付：竞品矩阵、优先级机会点和一页产品方案。主题：',
    deliverable: '竞品矩阵 + 机会点 + 一页方案',
  },
  {
    id: 'data-report',
    icon: '📈',
    title: '数据到报告',
    summary: '完成采集、计算、解读、成稿和一致性校验。',
    mode: 'plan',
    prompt: '基于我接下来提供的数据或文件生成一份可复核的分析报告。请拆分数据检查、指标计算、异常识别、结论撰写和一致性验证；不得编造缺失数据。最终交付：结构化报告、关键指标、数据来源和校验结果。数据或文件：',
    deliverable: '分析报告 + 指标口径 + 校验结果',
  },
  {
    id: 'prd-review',
    icon: '🧭',
    title: '需求审查与最小版本',
    summary: '识别目标、用户、风险和最小可验证闭环。',
    mode: 'plan',
    prompt: '审查我接下来提供的需求。请识别目标用户、核心场景、真实痛点、成功指标、依赖和风险，指出空泛或不可验收的描述，再给出最小可验证版本与明确验收标准。最终交付：问题清单、MVP 范围、用户流程和指标方案。需求：',
    deliverable: '问题清单 + MVP + 用户流程',
  },
]);

export const REVIEW_SCORECARD_KEYS = Object.freeze([
  'correctness',
  'completeness',
  'evidence',
  'safety',
]);

export function normalizeReviewScorecard(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  return Object.fromEntries(REVIEW_SCORECARD_KEYS.map(key => [key, input[key] === true]));
}

export function reviewScorecardPasses(scorecard) {
  const normalized = normalizeReviewScorecard(scorecard);
  return Boolean(normalized && REVIEW_SCORECARD_KEYS.every(key => normalized[key]));
}

export function publicProductTemplates() {
  return PRODUCT_TEMPLATES.map(template => ({ ...template }));
}
