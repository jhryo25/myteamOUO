# clowder-ai 与 myteam HTML/交互差距记录

更新时间：2026-06-14

## 对比来源

- clowder-ai 本地浅克隆：`.compare/clowder-ai`
- 重点阅读：
  - `README.zh-CN.md`
  - `packages/web/src/components/PlanBoardPanel.tsx`
  - `packages/web/src/components/HubSkillsTab.tsx`
  - `packages/web/src/components/HubQuotaBoardTab.tsx`
  - `packages/web/src/components/mission-control/MissionControlPage.tsx`
  - `packages/web/src/components/ChatInputActionButton.tsx`

## 主要差距

| 主题 | clowder-ai | myteam 当前状态 | MVP 处理 |
|------|------------|----------------|----------|
| Hub 指挥中心 | 有 Capability、Skills、Quota、配置等多 tab 指挥面板 | 原来只有 Agent 配置抽屉 | 新增轻量 `myteam Hub`，集中展示状态、任务和对比 |
| PlanBoardPanel | 按 agent 展示 running / interrupted / completed，并有继续按钮 | 右侧任务面板有 run 分组和状态筛选，Hub Gate 可通过/返工 | 保留轻量任务栏，继续入口后续统一到 Gate / backlog |
| Mission Hub | 有 backlog、self-claim、线程态势、SOP、治理面板 | 已有本地 `tasks.jsonl` + 人工 Reviewer Gate | 后续扩展 backlog / learn / reviewer agent 自动审 |
| Skills 框架 | 技能按需加载，并展示每个技能挂载到哪些 agent | 已新增 `.myteam/skills.yaml` 静态技能表和 Hub Skills 看板 | 后续升级成按需提示词加载 |
| Quota Board | 展示模型额度、风险等级、刷新和通知 | 已新增本地调用记录 `.myteam/invocations.jsonl` 和 Hub 调用 tab | 后续接真实 token/额度 |
| 输入按钮 | 支持运行中排队发送、强制发送、停止、语音态 | myteam 已有排队发送和停止 | 暂不扩展语音，保持轻量 |

## 本轮已落地

1. 顶部新增 `Hub` 按钮。
2. 新增 `myteam Hub` 抽屉。
3. Hub 包含七个 tab：
   - 总览：可启动 agent、任务数、待执行、失败数。
   - Agent：启动级检测结果和错误原因。
   - Skills：技能、触发条件和挂载到哪些 agent。
   - 调用：调用次数、成功/失败、平均耗时、最近调用。
   - Gate：人工 Reviewer Gate，可通过已完成任务或要求返工。
   - 任务：run 数、任务状态统计、最近任务。
   - 对比：clowder-ai 与 myteam 的 HTML/交互差距。
4. `.compare/` 加入 `.gitignore`，用于本地对照源码，不进入仓库。
5. 新增 `.myteam/skills.yaml`，先用静态文件保存 Skills 看板数据。
6. 新增 `.myteam/invocations.jsonl`，记录 agent 调用耗时、状态、退出码和失败原因。
7. 新增人工 Reviewer Gate：`POST /api/tasks/:id/gate` + Hub Gate tab，通过/返工都写回 `tasks.jsonl`。

## 下一步建议

1. 做 Reviewer Agent 自动审：让 reviewer 读取任务验收标准和执行结果，自动生成 Gate 建议。
2. 做 Skills 按需加载：根据任务类型把对应 skill 的提示词注入 agent prompt。
3. 做真实成本统计：从 CLI 输出或模型 provider 获取 token/usage，再替换当前轻量调用统计。
4. 做 backlog 视图：把返工、失败和下一轮建议从“执行记录”升级为“任务生命周期”。
