---
name: review-gate
category: quality
load: progressive
triggers:
  - 审查
  - 验收
  - review
  - 检查结果
  - 判断完成
next:
  - lesson-capture
mounts:
  controller: true
  worker: false
  reviewer: true
  codex: true
  claude: true
  kimi: false
---

# Review Gate

检查任务输出、证据、风险和缺口；不通过时生成返工建议。

## 触发条件

worker 输出完成后，需要判断是否真的通过验收。

## 核心规则

- 对照验收标准检查输出证据。
- 证据不足时要求返工，不把"完成了"当成完成。
- 不能只靠 agent 自己宣布成功，需要实际验证。
- 返工时必须给出明确的返工说明，不能只说"重做"。

## 审查清单

1. 输出是否存在？（文件/命令输出/截图）
2. 输出是否符合验收标准？
3. 是否有明显风险或遗漏？
4. 如果不通过，具体缺什么？

## 判定结果

- ✅ 通过：输出完整且符合验收标准
- ❌ 返工：说明具体缺口 → 任务重回 pending
