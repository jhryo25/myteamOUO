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
| PlanBoardPanel | 按 agent 展示 running / interrupted / completed，并有继续按钮 | 右侧任务面板有 run 分组和状态筛选 | 保留轻量任务栏，Hub 里增加任务摘要 |
| Mission Hub | 有 backlog、self-claim、线程态势、SOP、治理面板 | 只有本地 `tasks.jsonl` | Hub 总览先暴露自迭代闭环，后续再加 reviewer gate |
| Skills 框架 | 技能按需加载，并展示每个技能挂载到哪些 agent | 已新增 `.myteam/skills.yaml` 静态技能表和 Hub Skills 看板 | 后续升级成按需提示词加载 |
| Quota Board | 展示模型额度、风险等级、刷新和通知 | 目前没有成本/调用可见性 | 后续先记录调用次数、失败率、超时 |
| 输入按钮 | 支持运行中排队发送、强制发送、停止、语音态 | myteam 已有排队发送和停止 | 暂不扩展语音，保持轻量 |

## 本轮已落地

1. 顶部新增 `Hub` 按钮。
2. 新增 `myteam Hub` 抽屉。
3. Hub 包含五个 tab：
   - 总览：可启动 agent、任务数、待执行、失败数。
   - Agent：启动级检测结果和错误原因。
   - Skills：技能、触发条件和挂载到哪些 agent。
   - 任务：run 数、任务状态统计、最近任务。
   - 对比：clowder-ai 与 myteam 的 HTML/交互差距。
4. `.compare/` 加入 `.gitignore`，用于本地对照源码，不进入仓库。
5. 新增 `.myteam/skills.yaml`，先用静态文件保存 Skills 看板数据。

## 下一步建议

1. 做 `reviewer gate`：任务执行后进入 review/test，再允许写入长期记忆。
2. 做 Skills 按需加载：根据任务类型把对应 skill 的提示词注入 agent prompt。
3. 做成本记录：每次 agent 调用记录耗时、退出码、失败原因，先不追求 token 精确统计。
4. 做 backlog 视图：把当前 `tasks.jsonl` 从“执行记录”升级为“任务生命周期”。
