# myteamOUO 代码审查报告

> **审查人**: Senior Developer (高级开发工程师)  
> **审查日期**: 2026-06-26  
> **项目版本**: v0.1.0  
> **审查范围**: 全部源代码 (~29,600 行)  

---

## 一、项目概览

**myteamOUO** 是一个本地优先的多 Agent 协作控制台，将 Codex、Claude Code、Kimi 等本机 CLI 串成可拆解、可执行、可审查、可恢复的任务流水线。技术架构基于 Node.js + LangGraph + SQLite + 原生 Web UI。

| 指标 | 数值 |
|------|------|
| 总代码行数 | ~29,600 行 |
| 核心模块数 | 15+ |
| 测试文件数 | 17 |
| 工具链脚本 | 15 |
| 语言分布 | JS/Node(90%), Python(3%), HTML/CSS(7%) |

---

## 二、总体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **架构设计** | ⭐⭐⭐⭐ (7.5/10) | LangGraph 工作流编排清晰，状态机设计合理 |
| **代码质量** | ⭐⭐⭐ (6/10) | 核心逻辑有质量但存在巨型文件和全局状态 |
| **安全性** | ⭐⭐⭐⭐ (8/10) | 审批系统、指纹校验、脱敏审计都很到位 |
| **可测试性** | ⭐⭐⭐⭐ (7.5/10) | 关键路径覆盖好，但缺少集成测试 |
| **可维护性** | ⭐⭐⭐ (5.5/10) | 单文件过大、无类型系统是致命短板 |
| **文档完整性** | ⭐⭐⭐⭐ (8/10) | README、ISSUES、HANDOVER 都很详尽 |
| **前端体验** | ⭐⭐⭐ (6/10) | 原生实现功能完备但缺组件化和主题系统 |
| **性能** | ⭐⭐⭐ (6/10) | SQLite WAL 模式好，但无缓存层和懒加载 |

**综合评分: 6.9/10** — 这是一个**有想法、有执行力**的项目，架构思路清晰，但在工程化方面还有很大提升空间。

---

## 三、亮点 (做得好的地方) 💎

### 3.1 架构设计清晰

```
Browser UI → server.mjs → workflow/dispatch-graph.mjs → Agent CLI
                ↓                    ↓
           storage.mjs        LangGraph Checkpointer
                ↓                    ↓
           SQLite (WAL)      .myteam/langgraph.sqlite
```

- **LangGraph 工作流引擎** (`workflow/dispatch-graph.mjs`): 多任务队列、Reviewer Gate、返工闭环、人工审核关卡设计合理。子图(subgraph)模式正确处理了任务执行的生命周期。
- **状态机严格** (`workflow-state.mjs`): 任务生命周期状态转换表(TASK_TRANSITIONS)使用 `Object.freeze` + `Set`，杜绝了非法状态转换。
- **端口模式** (`workflow/ports.mjs`): 副作用隔离做得不错，便于测试和替换。

### 3.2 安全与治理设计到位

```javascript
// governance.mjs — 优秀的审批系统设计
operationFingerprint(type, payload)  // SHA256 指纹防篡改
authorizeOperation(...)              // 指纹一致性校验
redactSensitive(value)              // 递归脱敏 Token/Secret/API Key
```

- **审批流程完整**: 请求 → 校验 → 单次/会话审批 → 超时过期 → 审计日志
- **脱敏审计**: 自动识别并遮蔽敏感字段
- **操作策略表**: `OPERATION_POLICIES` 清晰定义了每种操作的风险等级

### 3.3 问题追踪与经验沉淀

`ISSUES.md` 是一份非常棒的工程记录，每个 bug 都包含：
- 位置精确到文件和行号
- 根因分析透彻
- 解法步骤清晰
- 标签化的教训 (`lesson:xxx`) 便于检索

### 3.4 测试覆盖

17 个测试文件覆盖了：
- LangGraph 多任务队列 ✅
- 返工闭环 ✅
- 审查协议解析 ✅
- SQLite checkpoint 跨实例恢复 ✅
- 人工中断/恢复 ✅
- 工作流卡片与实时活动恢复 ✅

### 3.5 SQLite 数据层

- WAL 模式（并发读写友好）
- 迁移机制（`schema_migrations` 表）
- 旧 JSONL 数据自动导入（`importLegacy`）
- 外键约束

---

## 四、严重问题 (必须修复) 🔴

### P0-1: server.mjs 是巨型单体 (5209 行)

```
server.mjs: 5209 行 — 占全部后端代码的 50%
```

**问题**: 
- 一个文件承载了 HTTP 路由、SSE、Skill 管理、Agent 执行、Shell 执行、文件服务、审批处理、会话管理等所有逻辑
- 代码导航极其困难，任何修改都影响整个文件
- 合并冲突概率极高

**影响**: 新人接手成本巨大，改动风险高，无法独立部署子功能

**修复方案**: 按功能域拆分为独立模块：

```
server/
  ├── index.mjs           # 入口，组装 express/路由
  ├── routes/
  │   ├── chat.mjs        # /api/chat 相关
  │   ├── session.mjs     # /api/sessions 相关
  │   ├── skills.mjs      # /api/skills 相关
  │   ├── approvals.mjs   # /api/approvals 相关
  │   ├── schedules.mjs   # /api/schedules 相关
  │   └── artifacts.mjs   # /api/artifacts 相关
  ├── middleware/
  │   ├── auth.mjs
  │   ├── cors.mjs
  │   └── error-handler.mjs
  └── services/
      ├── agent-executor.mjs
      ├── skill-manager.mjs
      └── sse-bus.mjs
```

### P0-2: web/app.js 是巨型前端文件 (5975 行)

**问题**:
- 零框架、零组件、零状态管理
- 所有 UI 逻辑挤在一个文件里
- 全局变量满天飞
- 每次渲染都是直接操作 DOM

**影响**: UI bug 难以定位，任何改动都可能引发连锁反应

**修复方案**: 渐进式引入轻量框架或至少做模块拆分：

```
web/
  ├── index.html
  ├── css/
  │   ├── variables.css
  │   ├── components/
  │   │   ├── chat.css
  │   │   ├── hub.css
  │   │   ├── settings.css
  │   │   └── artifacts.css
  │   └── themes/
  │       ├── light.css
  │       └── dark.css
  ├── js/
  │   ├── app.js          # 入口
  │   ├── components/
  │   │   ├── chat-area.js
  │   │   ├── message-bubble.js
  │   │   ├── hub-panel.js
  │   │   ├── settings-drawer.js
  │   │   └── artifact-panel.js
  │   ├── state/
  │   │   └── store.js
  │   └── utils/
  │       ├── dom.js
  │       ├── rich-renderer.js
  │       └── sse-client.js
  └── assets/
```

### P0-3: 完全缺少 TypeScript / 类型系统

**问题**: 29,600 行 JavaScript 没有任何类型安全保障。

**影响**:
- 参数拼写错误只能在运行时发现
- IDE 无法提供智能提示
- 重构时极易漏改
- 新人看代码无法通过类型推断理解数据结构

```javascript
// 当前：完全无类型，只能靠注释
function pushChainMessage(taskId, msg) {
  const fullMessage = { ...msg, timestamp: new Date().toISOString() };
  // msg 是什么结构？taskId 是 string 还是 number？
}

// 应该是：
interface ChainMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  type?: 'reasoning' | 'tool_call' | 'final';
}

function pushChainMessage(taskId: string, msg: ChainMessage): void {
  const fullMessage: ChainMessage & { timestamp: string } = {
    ...msg,
    timestamp: new Date().toISOString()
  };
}
```

---

## 五、重要问题 (应该修复) 🟠

### P1-1: 全局可变状态

```javascript
// server.mjs — 多处全局 Map
const chainTaskMessages = new Map();  // 89行
const chainTaskSSE = new Map();       // 90行
const shellResults = new Map();       // 131行

// agent-utils.mjs — 模块级缓存
const _chatTemplates = new Map();     // 52行
```

**问题**: 并发请求时可能产生竞态条件，测试难以隔离。

**修复**: 将这些状态封装到带生命周期的类中，或使用 `AsyncLocalStorage` 做请求级隔离。

### P1-2: 混合语言架构增加维护成本

```
myteam.py (Python CLI 入口) → spawn Node.js → server.mjs
```

**问题**: Python 层只做了参数解析和环境变量读取，却引入了 Python + Node.js 双运行时依赖。

**建议**: 
- 如果只需要 CLI 入口，用 Node.js 直接实现（`bin/myteam.mjs`）
- 或者保留 Python 但不要让它调用 Node，而是让 Python 进程直接作为服务

### P1-3: 错误处理不一致

```javascript
// 模式1：静默失败
try {
  repository.insertChainMessage(...);
} catch (e) {
  // 静默失败：内存缓存仍保留，不影响执行
}

// 模式2：记录日志
try {
  repository.upsertWorkflowAdapter(...);
} catch (e) { /* 静默失败 */ }

// 模式3：抛异常
if (!CLI_CONFIG[agent]?.path) throw new Error(`${agent} 路径未配置`);
```

**问题**: 三种错误处理策略混用，调用方无法预期行为。

**建议**: 
- 统一错误处理策略
- 静默失败至少记录到结构化日志
- 关键路径的错误必须向上传播

### P1-4: 缺少结构化日志

```javascript
console.log(`[${data.id}] ${data.title}`);    // dispatch.mjs
console.error(`  failed: ${data.error}`);
console.log('myteam 初始化完成。');            // myteam.py
```

**建议**: 引入轻量日志库（如 `pino`），统一日志格式、级别和输出目标。

### P1-5: Prompt 管理分散

```
prompts.mjs      → Chat prompt 模板
agent-utils.mjs  → Plan/Exec/Review prompt
collaboration-context.mjs → SPAWN_SUBAGENT_PROTOCOL
myteam.py        → AGENTS_TEMPLATE
```

**建议**: 统一到 `prompts/` 目录，每个 prompt 一个文件，支持模板变量和版本管理。

---

## 六、改进建议 (按优先级) 🟡

### P2-1: 缺少 API 文档/Schema

REST API 没有 OpenAPI/Swagger 文档，没有请求/响应 schema 定义。

**建议**: 引入 `zod` (已在依赖中) 定义所有 API 的输入输出 schema，并自动生成 OpenAPI 文档。

### P2-2: 前端缺少主题系统

当前只支持一种颜色模式，没有暗色主题。

**建议**: 使用 CSS 自定义属性 (已经有了雏形) 实现完整的亮色/暗色切换。

### P2-3: 缺少 CI/CD

没有 GitHub Actions，无法自动运行测试、lint、构建。

**建议**: 添加 `.github/workflows/ci.yml`：
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run check
      - run: npm test
```

### P2-4: web/app.css 过大 (3946 行)

缺少 CSS 架构，所有样式在一个文件。

**建议**: 拆分 CSS，使用 BEM 或 CSS Modules 命名规范，按组件拆分文件。

### P2-5: 工具链脚本太多且未组织

`tools/` 目录下 15 个脚本（普吉岛攻略、美股数据等）混在一起。

**建议**: 按领域分目录：
```
tools/
  ├── finance/
  │   ├── fetch-sina-us-stock.mjs
  │   └── gen-us-stock-report.mjs
  └── travel/
      ├── gen-phuket-guide.mjs
      └── identify-jmu-routes.mjs
```

### P2-6: 内存泄漏风险

```javascript
// server.mjs — 这些 Map 只增不减
const chainTaskMessages = new Map();
const shellResults = new Map();
```

**建议**: 添加 TTL 机制或 LRU 淘汰，限制内存占用。

---

## 七、重构路线图

### Phase 1: 止血 (1-2周)
1. ✅ 修复 `.server-stderr.log` / `.server-stdout.log` 的 `.gitignore` 遗漏
2. 🔧 拆分 `server.mjs` → 按路由/服务模块化
3. 🔧 拆分 `web/app.js` → 至少拆成 5-8 个模块
4. 🔧 添加结构化日志库

### Phase 2: 加固 (2-4周)
1. 🔧 引入 TypeScript（至少核心模块）
2. 🔧 封装全局状态到带生命周期的类
3. 🔧 统一错误处理策略
4. 🔧 添加 API schema (zod + OpenAPI)
5. 🔧 添加 CI/CD 流水线

### Phase 3: 优化 (4-6周)
1. 🔧 实现前端亮/暗主题切换
2. 🔧 添加请求级内存淘汰 (TTL/LRU)
3. 🔧 Prompt 管理统一化和版本化
4. 🔧 性能测试和优化
5. 🔧 补充集成测试和 E2E 测试

---

## 八、代码细节问题清单

### 具体代码问题

| # | 文件 | 问题 | 严重度 |
|---|------|------|--------|
| 1 | `server.mjs:89-91` | `chainTaskMessages` / `chainTaskSSE` 全局 Map 无容量限制 | 🟠 |
| 2 | `server.mjs:131` | `shellResults` 无超时清理 | 🟠 |
| 3 | `server.mjs:107-108` | `insertChainMessage` 静默吞错 | 🟡 |
| 4 | `server.mjs:246` | `cloneAndFindSkillMd` 中 `git clone` 无 timeout 控制 | 🟠 |
| 5 | `server.mjs:198` | `extractZip` 硬编码 `Expand-Archive`，无进度回调 | 🟡 |
| 6 | `dispatch.mjs:132` | `upsertWorkflowAdapter` 静默吞错 | 🟡 |
| 7 | `agent-utils.mjs:52` | `_chatTemplates` Map 全局缓存无失效机制 | 🟡 |
| 8 | `storage.mjs:39-48` | `parseJsonl` 解析失败直接 throw，不回退到空数组 | 🟡 |
| 9 | `web/app.js:5` | `esc()` 全局函数，与其他库可能冲突 | 🟡 |
| 10 | `web/app.js:292252 bytes` | 整个文件 292KB，浏览器首次加载耗时 | 🟠 |
| 11 | `collaboration-context.mjs:8` | `MAX_TEXT = 240` 硬编码，不可配置 | 🟡 |
| 12 | `governance.mjs:5` | `APPROVAL_TTL_MS = 15 * 60 * 1000` 硬编码 | 🟡 |

### 拼写/命名问题

| # | 文件 | 问题 |
|---|------|------|
| 1 | `agent-utils.mjs:85` | `restrictions` 拼写正确但建议改 `constraints` (更通用) |
| 2 | `storage.mjs:1` | `DatabaseSync` 是实验性 API，生产环境需评估稳定性 |
| 3 | `collaboration-context.mjs:16` | `dedupe` → 应拼写为 `dedup` (去重) |

---

## 九、依赖分析

```json
{
  "dependencies": {
    "@langchain/core": "^1.1.48",           // ⚠️ 版本较新，注意 API 稳定性
    "@langchain/langgraph": "^1.4.4",       // ⚠️ 同上
    "@langchain/langgraph-checkpoint-sqlite": "^1.0.3",
    "cron-parser": "^5.5.0",                // ✅ 成熟稳定
    "zod": "^4.2.0"                         // ✅ 但项目中几乎没用到
  }
}
```

**问题**: 
- `zod` 已安装但几乎未使用 — 应该在 API 验证中广泛使用
- 使用了 Node.js 实验性 API (`DatabaseSync`) — 需关注 Node 版本兼容性
- 缺少 `express` 或类似 HTTP 框架 — 手写的 `createServer` 是导致 `server.mjs` 膨胀的原因之一

---

## 十、总结

myteamOUO 是一个**有灵魂的项目** — 它的架构思路、安全设计和问题追踪都体现了作者的工程素养。但从"个人项目"到"团队项目"，当前面临的核心瓶颈是 **工程化程度不足**。

**最优先做三件事**：
1. **拆 monolith**: `server.mjs`(5200行) 和 `web/app.js`(6000行) 必须拆分
2. **加类型**: 引入 TypeScript，至少覆盖核心模块
3. **建 CI**: 让测试和 lint 自动化运行

这三个改进可以立即开始，不需要大规模重写，渐进式推进即可。

---

> *审查人: Senior Developer (高级开发工程师)*  
> *"代码可以工作，但让它能长久维护，才是真正工程能力的体现。"*
