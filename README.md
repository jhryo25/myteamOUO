# myteamOUO

轻量级本地 A2A（Agent-to-Agent）协作工具 MVP。

让 Claude 和 Codex 像一个小团队一样协作——对话、拆任务、执行、留记录。

**GitHub**: https://github.com/jhryo25/myteamOUO  
**参考项目**: [clowder-ai](https://github.com/zts212653/clowder-ai) / [cat-cafe-tutorials](https://github.com/zts212653/cat-cafe-tutorials)

---

## 快速启动

```powershell
# 1. 复制 .env.example → .env，填入本地 CLI 路径
cp .env.example .env

# 2. 启动服务
node server.mjs

# 3. 打开浏览器
# http://localhost:7878
```

---

## Agent 阵容

| Agent | 角色 |
|-------|------|
| Kimi | 轻量执行、快速草稿、小任务处理 |
| Claude | 深度分析、架构设计、复杂生成 |
| Codex | 拆任务、代码执行、审查 |

---

## 功能

### 对话模式
- 直接发消息，自动路由给默认 agent
- `@claude` / `@codex` / `@kimi` 指定 agent
- 气泡 hover 显示复制 / 删除操作栏
- 发送按钮状态机：agent 运行中变蓝色排队模式，消息自动入队，完成后依次发送
- 消息时间戳

### 拆任务模式
- 切换到「拆任务」，输入目标
- Agent 返回结构化任务清单（标题 / 步骤 / 验收标准 / 负责 agent）
- plan card 底部推荐执行方式：按 agent 分组 + 手动选择

### 任务执行
- 「执行 pending 任务」按钮（仅在有 pending 时出现）
- 右侧任务面板：run 分组 + 进度条 + 状态 dot（pending / running / done / failed）
- dispatch 中断或有失败时，聊天区出现「继续执行剩余任务」按钮

### Session 管理
- 多对话 session，左侧边栏切换
- `···` hover 菜单：重命名（inline 编辑）/ 删除
- 回收站：30 天内可恢复

### 状态
- topbar agent pill：绿色 = 在线，红色 = 不可用
- 连接状态条：server 离线 / agent 不可用时显示颜色提示条

---

## 文件结构

```
myteamOUO/
├── server.mjs        # Node HTTP server，REST + SSE，端口 7878
├── plan.mjs          # 拆任务：调 agent → .myteam/tasks.jsonl
├── dispatch.mjs      # 执行：读 pending 任务 → 分发 → 写回结果
├── agent-utils.mjs   # 公共模块：loadEnv / invokeAgent / 任务 CRUD
├── web/
│   ├── app.html      # HTML 骨架
│   ├── app.css       # 全部样式
│   └── app.js        # 全部前端逻辑
├── .myteam/
│   ├── agents.yaml   # agent 角色配置（入库）
│   └── tasks.jsonl   # 运行时任务（不入库）
├── HANDOVER.md       # AI 冷启动交接文档
└── ISSUES.md         # 问题 / 解法 / 教训
```

---

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | agent 可用状态 |
| GET | `/api/sessions` | session 列表 |
| POST | `/api/sessions` | 新建 / 切换 session |
| POST | `/api/sessions/:id/rename` | 重命名 session |
| DELETE | `/api/sessions?id=` | 删除（移入回收站） |
| POST | `/api/chat` | SSE 对话流 |
| POST | `/api/plan` | SSE 拆任务流 |
| POST | `/api/dispatch` | SSE 执行任务流 |
| GET | `/api/tasks` | 任务列表 |
| POST | `/api/tasks/:id/rerun` | 重跑单个任务 |
| DELETE | `/api/tasks/:id` | 删除任务 |

---

## 环境变量（`.env`）

```env
KIMI_PATH=C:\Users\Administrator\.kimi-code\bin\kimi.exe
CLAUDE_PATH=C:\path\to\claude.cmd
CODEX_PATH=C:\path\to\codex.cmd
```

`.env` 已在 `.gitignore`，不会上传。

---

## 新对话冷启动 Prompt

```
项目：myteamOUO（本地 A2A 协作工具 MVP）
GitHub: https://github.com/jhryo25/myteamOUO
本地路径: F:\py project\myteamOUO

请先读取 HANDOVER.md 了解当前进度，然后继续下一步工作。
```
