# myteam 与 LobsterAI 对比（2026-06-19）

本报告基于本地 `LobsterAI-main` 源码阅读。LobsterAI 未安装依赖或启动 Electron/OpenClaw，因此这里只声明源码级结论，不把未运行能力写成实测结果。

## 采用

| 方向 | LobsterAI 做法 | myteam 落地 |
|---|---|---|
| 权限 | 敏感工具调用进入 permission request，由用户批准 | P6 用服务端审批对象、操作指纹、单次/会话授权和脱敏审计覆盖 myteam 管理入口 |
| 持久化 | SQLite 保存会话、消息、配置、任务等状态 | P7 用 Node 内置 SQLite、WAL、事务和 migration 统一关键运行状态 |
| 调度 | Cron 任务关联 Cowork session 和运行历史 | P8 支持五段 Cron、时区、审批暂停、互斥和运行历史 |
| 子代理 | 状态机、消息缓存和数据库持久化 | P1/P5 使用结构化 spawn 协议和 SQLite run/message 生命周期 |
| 上下文 | continuity、memory 与工作区状态恢复 | P2-P4 使用 Capsule、Top-K Evidence 和 Workspace Bridge |
| 流式交互 | thinking 消息流式期间默认展开，tool use/result 独立成组，只有无可渲染内容时显示等待指示器 | myteam 将 Kimi NDJSON 规范化为 thinking / activity / chunk 三类 SSE；展示工具开始、完成和摘要 |

## 简化采用

| 方向 | 取舍 |
|---|---|
| 桌面权限模型 | myteam 是本地 HTTP 应用，不复制 Electron IPC；只在 REST/SSE 边界执行策略和审计 |
| Skills | 保留文件系统 Skill 和轻量 registry，不引入完整 Expert Kit/市场服务；安装和卸载必须审批 |
| 产物预览 | 采用 LobsterAI 的本地路径识别与系统默认应用打开思路；myteam 只实现工作区 HTML，并在 HTTP 服务端增加 realpath 边界校验 |
| Memory | 保留显式 lessons/memory 和 Continuity Capsule，不引入后台推断式记忆写入 |
| Scheduler | 采用进程内 timer + SQLite 恢复，不引入 OpenClaw gateway；错过触发默认 skipped |
| 流式运行时 | 采用 LobsterAI 的消息分层和可见状态设计，不引入 OpenClaw event runtime；继续由本地 CLI parser 转换为 SSE |

## 暂不采用

| 方向 | 原因 |
|---|---|
| Electron/OpenClaw runtime | 会改变项目“单 Node 服务、本地 CLI 编排”的核心定位和部署成本 |
| IM 多渠道网关 | 需要凭证治理、远程暴露和持续运维，当前安全收益比不合适 |
| 完整 MCP 市场 | 当前 Skills 已满足本地渐进扩展；应先稳定审批、存储和调度 |
| 自动预授权定时任务 | 无人值守敏感操作风险过高，默认暂停待审批更符合 myteam 当前信任模型 |

## 下一步建议

1. 将 agent CLI 内部工具调用接入可选的原生 permission adapter，缩小 P6 的控制边界。
2. 给 migration 增加导出/恢复 CLI，提供运维级灾难恢复路径。
3. 为 scheduler 增加通知渠道，但必须复用审批与审计，不另开绕过路径。

## 交互补充（2026-06-20）

- LobsterAI 在系统提示中要求 Agent 用 `[名称](file:///absolute/path)` 输出文件，并由 renderer 识别 `file://`，主进程调用 Electron `shell.openPath()`。
- myteam 不引入 Electron IPC，改为把 HTML 路径渲染成按钮，点击后请求本地 Node 服务；服务端验证工作区边界后调用系统文件关联。
- LobsterAI 的能力入口由 Agent/工具协议承载。myteam 因此移除顶部手工 Shell 输入入口，但保留 Agent 的 `shell-exec` Skill、审批和审计。
- Skills 市场属于远端清单读取，不需要复制完整市场服务；共享前端缓存、后台预取和服务端 TTL 已能消除重复等待。
