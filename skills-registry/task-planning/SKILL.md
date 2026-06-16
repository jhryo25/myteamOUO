---
name: task-planning
category: planning
load: progressive
triggers:
  - 拆任务
  - 目标拆解
  - 生成任务列表
  - 任务规划
next:
  - cli-execution
mounts:
  controller: true
  worker: false
  reviewer: false
  codex: true
  claude: true
  kimi: true
---

# Task Planning

把目标拆成 3-7 个小任务，并写清步骤、验收标准和建议 agent。

## 触发条件

用户输入目标，需要拆成可验收任务。

## 核心规则

- 只输出可验证的小任务，优先包含步骤、验收标准、建议 agent 和失败时的下一步。
- 每个任务带五件套：why / tradeoff / open_questions / steps / accept。
- 任务数量 3-7 个，不要过细也不要遗漏关键步骤。
- 优先按依赖顺序排列，前置任务先执行。

## 输出格式

```json
{
  "tasks": [
    {
      "title": "任务标题",
      "why": "为什么做这个",
      "tradeoff": "取舍说明",
      "open_questions": ["还需要确认的问题"],
      "steps": ["步骤1", "步骤2"],
      "accept": "验收标准",
      "agent": "建议执行 agent"
    }
  ]
}
```
