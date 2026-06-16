---
name: html-ui-alignment
category: frontend
load: progressive
triggers:
  - UI 对比
  - 前端对齐
  - clowder-ai
  - 界面差距
  - HTML 对比
next:
  - cli-execution
  - review-gate
mounts:
  controller: true
  worker: true
  reviewer: true
  codex: true
  claude: true
  kimi: true
---

# HTML UI Alignment

识别 Hub、任务面板、消息操作、状态提示等 UI 差距，并提出 MVP 可落地改动。

## 触发条件

对比 clowder-ai 和 myteam 的 HTML、交互或信息架构。

## 核心规则

- 只提出能在 MVP 内落地的 UI 改动。
- 差距结论写入文档，不塞进主界面。
- 对照参考实现，给出具体的代码位置和改动建议。
- 改动前先说明"当前是什么"，再说"对齐后应该是什么"。

## 分析框架

1. 视觉层：颜色、排版、间距、图标
2. 交互层：操作反馈、状态提示、动画
3. 信息架构层：数据展示顺序、分组逻辑
4. 功能层：缺失的交互入口
