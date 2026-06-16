---
name: lesson-capture
category: memory
load: progressive
triggers:
  - 记录经验
  - 踩坑
  - 失败记录
  - 沉淀经验
next:
  - task-planning
mounts:
  controller: true
  worker: false
  reviewer: true
  codex: true
  claude: true
  kimi: true
---

# Lesson Capture

把失败原因转成结构化 lessons，只把确认过的经验写入长期记忆。

## 触发条件

任务失败、返工或出现新的踩坑经验。

## 核心规则

- 只记录已经验证的失败原因和改进经验，不记录猜测或未确认结论。
- 经验必须可复用，不能只记"这次出错了"。
- 写入 `.myteam/lessons.jsonl` 的经验要结构化。
- 只有经过 review 或人工确认的经验，才写入长期记忆。

## 经验结构

```json
{
  "pattern": "错误类型分类",
  "cause": "根本原因",
  "fix": "修复方式",
  "prevention": "下次如何避免"
}
```
