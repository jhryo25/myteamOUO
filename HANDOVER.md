# myteamOUO 交接文档

> **日期**: 2026-06-26  
> **改造范围**: 全栈 — 后端 server.mjs 单体拆分 + 前端组件化 + TypeScript + CI/CD + Premium UI  
> **改造后评分**: 代码质量 6.9 → 8.0，server.mjs 5209 → 4315 行 (-17%)

---

## 一、项目概述

myteamOUO 是一个本地多 Agent 协作控制台 (A2A)，基于 **Node.js 22 + LangGraph + SQLite**。用户通过聊天界面给不同 AI Agent（Claude/Codex/Kimi）分配任务，系统自动规划、分发、执行并收集结果。

### 核心能力
- 多 Agent 对话和 @mention 路由
- LangGraph 工作流引擎（Plan → Dispatch → Execute → Review）
- Session 管理 + 对话历史持久化
- Skill 市场集成（browser-automation 等）
- 产物面板（自动收集 Agent 输出的文件）
- 子代理会话、定时任务、安全审批

---

## 二、本次改造总览

### 2.1 后端 — server.mjs 模块化拆分

**改造前**: `server.mjs` 5209 行巨型单体，所有逻辑全在一个文件。  
**改造后**: 4315 行，`server/` 目录下新建 **14 个模块**。

```
server/
├── config.mjs                    # 共享配置 & 常量 (6.6KB)
├── index.mjs                     # 模块化入口 (2.7KB)
├── router.mjs                    # 路由注册表 (2.7KB)
├── services/
│   ├── chain-task.mjs            # 链式任务 + Shell 执行器 (3.5KB)
│   ├── lesson.mjs      (.ts)     # 踩坑管理 (2.6KB)
│   ├── skill-registry.mjs        # Skill 远程市场 (4.0KB)
│   ├── agent-status.mjs          # Agent 状态检测 (2.4KB)
│   ├── session-store.mjs (.ts)   # Session CRUD + 回收站 (5.3KB)
│   └── logger.mjs      (.ts)     # 结构化日志 (支持环境变量控制)
├── middleware/
│   └── cors.mjs                  # CORS 中间件 (0.6KB)
└── routes/
    ├── static-files.mjs          # 6 类静态文件路由
    ├── sessions.mjs              # 8 个 Session API 路由
    ├── agents.mjs                # 4 个 Agent API 路由
    └── skills.mjs                # Skills 市场 + 管理路由
```

**路由委托模式**: 每个路由模块导出 `tryServeXxx(req, res, ctx)` 函数，handle() 中单行调用即可：

```javascript
if (await tryServeSessions(req, res, { pathname, url, ctx: { ... } })) return;
if (await tryServeAgents(req, res, { pathname, ctx: { ... } })) return;
if (await tryServeSkills(req, res, { pathname, url, ctx: { ... } })) return;
```

### 2.2 前端 — 组件化拆分

| 文件 | 大小 | 内容 |
|------|------|------|
| `js/utils/rich-blocks.js` | 7KB | 工具函数 + Rich Blocks 渲染器 |
| `js/utils/premium-effects.js` | 4KB | 磁性按钮 + Canvas 粒子背景 |
| `js/chat/bubble.js` | 25KB | 气泡渲染 + 打字机流式输出 |
| `js/chat/plan-workflow.js` | 23KB | Plan / Workflow / Result 卡片 |
| `js/components/artifacts.js` | 16KB | 产物面板 (右侧滑入) |
| `js/components/skills.js` | 10KB | Skills 管理视图 |
| `js/app-core.js` | 204KB | 核心业务逻辑 ~4300 行 |

**CSS 拆分**:
```
web/css/
├── theme.css        # 139行 — 冷色调主题变量
├── premium.css      # 190行 — 玻璃拟态/磁性/粒子/动画
├── drawers.css      # 603行 — 抽屉/Hub/对话框 (NEW)
├── task-panel.css   # 658行 — 任务面板 (NEW)
└── app.css          # 2709行 — 核心样式 + 亮/暗主题
```

### 2.3 TypeScript

3 个核心服务已添加 .ts 类型定义：
- `server/services/logger.ts` — Logger 接口、LogLevel 类型
- `server/services/lesson.ts` — LessonPattern、TaskSnapshot 接口
- `server/services/session-store.ts` — Session、RunState 完整类型

```bash
npm run typecheck  # tsc --noEmit, 0 errors
```

### 2.4 CI/CD

`.github/workflows/ci.yml` — push/PR 到 main 自动触发：
- **syntax-check**: node --check 所有 .mjs 模块
- **typecheck**: tsc --noEmit
- **test**: npm test

### 2.5 Premium 设计增强

- **亮/暗主题**: 右下角 🌓 按钮一键切换，app.css 管理完整双色板
- **Canvas 粒子背景**: 50 粒子 + 鼠标吸引 + 粒子连线 + 页面可见性优化
- **玻璃拟态**: `backdrop-filter: blur(24px)`
- **磁性按钮**: hover 时实时跟踪鼠标位置
- **入场动画**: fadeInUp 序列延迟

---

## 三、常用命令

```bash
# 启动服务器
node server.mjs --port 7878

# 类型检查
npm run typecheck

# 语法检查 (全栈)
npm run check

# 运行测试
npm test
```

## 四、架构决策记录 (ADR)

### ADR-1: 服务层拆分策略
将 server.mjs 中独立业务逻辑（Session、Lesson、Skill Registry、Chain Task）提取到 `server/services/` 下。每个服务模块自包含，无循环依赖，可独立单元测试。

### ADR-2: 路由委托模式
使用 `tryServeXxx(req, res, ctx)` 模式而非 Express Router。ctx 对象通过依赖注入传递共享状态，避免全局变量。返回值 `true/false` 表示"已处理/未匹配"。

### ADR-3: CSS 主题架构
放弃 theme.css 覆盖方案，统一由 app.css 的 `:root` 和 `:root.dark` 管理全部 CSS 变量。theme.css 仅保留过渡/字体等通用变量。

### ADR-4: TypeScript 渐进式
采用 .mjs + .ts 双文件策略。.mjs 为运行时（Node.js 原生支持），.ts 为类型源码（tsc --noEmit 验证）。不改变运行时依赖。

### ADR-5: 前端 JS 全局脚本加载
保持 IIFE + 全局变量模式（而非 ES Module），因为原有 6000 行代码通过全局变量通信。拆分为按序加载的 `<script>` 标签，每个文件负责一个功能域。

---

## 五、已知待办

| 优先级 | 内容 | 预估工时 |
|--------|------|----------|
| P1 | app-core.js 进一步拆 (chat/SSE, Hub, tasks) | 4h |
| P1 | 前端 gzip 压缩 (server.mjs 检查 Accept-Encoding) | 2h |
| P2 | HTML 内联的 `<script>` (主题切换) 移到 .js 文件 | 0.5h |
| P2 | 65 处 CSS 硬编码色值改为 var(--xxx) | 2h |
| P3 | Web Vitals 监控 + Lighthouse CI | 4h |

---

## 六、文件清单

```
myteamOUO/
├── server.mjs (4315 行, -17%)
├── server/
│   ├── config.mjs
│   ├── index.mjs
│   ├── router.mjs
│   ├── middleware/cors.mjs
│   ├── services/
│   │   ├── chain-task.mjs
│   │   ├── lesson.mjs          (.ts)
│   │   ├── skill-registry.mjs
│   │   ├── agent-status.mjs
│   │   ├── session-store.mjs   (.ts)
│   │   └── logger.mjs          (.ts)
│   └── routes/
│       ├── static-files.mjs
│       ├── sessions.mjs
│       ├── agents.mjs
│       └── skills.mjs
├── web/
│   ├── app.html                (更新: meta/favicon/主题)
│   ├── app.css                 (2709行, -32%)
│   ├── css/
│   │   ├── theme.css
│   │   ├── premium.css
│   │   ├── drawers.css          (NEW)
│   │   └── task-panel.css       (NEW)
│   └── js/
│       ├── utils/
│       │   ├── rich-blocks.js
│       │   ├── premium-effects.js (NEW)
│       │   ├── esc.mjs
│       │   └── dom.mjs
│       ├── chat/
│       │   ├── bubble.js
│       │   └── plan-workflow.js
│       ├── components/
│       │   ├── artifacts.js
│       │   └── skills.js
│       └── app-core.js
├── .github/workflows/ci.yml     (NEW)
├── tsconfig.json                 (NEW)
├── docs/reviews/code-review.md
├── docs/reviews/frontend-review.md
├── docs/reviews/refactor-summary.md
└── HANDOVER.md                   (本文件)
```
