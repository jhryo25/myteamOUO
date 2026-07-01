# myteamOUO 代码审查报告

**审查日期**: 2026-06-29
**审查范围**: 全栈代码（server.mjs + server/ 模块 + web/ 前端 + 配置 + CI）
**审查人**: Senior Developer

---

## 评分总览

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构设计 | 6.5/10 | 模块化方向正确，但半成品状态明显 |
| 代码质量 | 5.5/10 | 存在死代码、重复定义、未完成迁移 |
| 安全性 | 6.0/10 | 基础防护到位，但 CORS 和 shell 执行有风险 |
| 可维护性 | 5.0/10 | 双轨并行（server.mjs + server/）造成混乱 |
| 测试覆盖 | 7.0/10 | CI 有 61 case，但数据依赖测试被排除 |
| 前端质量 | 6.5/10 | 组件化好，但 innerHTML XSS 风险未完全消除 |
| **综合** | **6.1/10** | **可用但需技术债清理** |

---

## P0 — 严重问题（必须修复）

### 1. `server/index.mjs` 完全无法运行（死代码）

**文件**: `server/index.mjs`

**问题**: 该文件作为"模块化入口"存在，但实际无法加载运行：

```javascript
// 第 33 行：导入不存在的 export
import { handle as legacyHandle } from './routes/legacy-handle.mjs';
// legacy-handle.mjs 只有 109 行，从未导出 handle 函数

// 第 41 行：引用未定义的 config 变量
config._imports.loadSettings = ls;
// config 在第 43 行才定义，且 config.mjs 没有默认导出

// 第 43 行：无意义的动态导入
const config = (await import('./config.mjs')).default || (await import('./config.mjs'));
// config.mjs 没有默认导出，这行永远得到 undefined
```

**影响**: 
- `server/index.mjs` 是一个"看起来已完成但实际从未被运行过"的死模块
- README 和 HANDOVER 都指向 `node server.mjs`，说明实际入口仍是单体 server.mjs
- 整个 `server/` 目录的模块化拆分是**形式上的**，实际运行时 server.mjs 自己包含了所有逻辑

**修复建议**:
```bash
# 方案 A：删除 server/index.mjs（推荐，因为 server.mjs 仍是实际入口）
rm server/index.mjs

# 方案 B：完成 legacy-handle.mjs 的迁移，让它真正导出 handle 函数
# 这需要把 server.mjs 的 handle() 函数逻辑全部搬过来
```

### 2. `server/config.mjs` 与 `server.mjs` 存在重复定义

**问题**: 以下常量/配置在两个文件中各定义了一遍：

| 定义项 | server.mjs | server/config.mjs |
|--------|------------|-------------------|
| `SKILL_SOURCES` | 第 72-86 行 | 第 24-38 行 |
| `STUDIO_TEMPLATES` | 第 198-330 行 | 第 81-116 行 |
| `AGENT_STATUS_TTL_MS` | 第 194 行 | 第 20 行 |
| `LESSONS_FILE` 等 | 第 60-67 行 | 第 9-16 行 |

**影响**: 修改一处不会同步另一处，导致配置漂移。由于 `server.mjs` 是实际运行入口，`server/config.mjs` 中的定义实际是死代码。

### 3. `server/routes/legacy-handle.mjs` 是空壳文件

**文件**: `server/routes/legacy-handle.mjs`（仅 109 行）

**问题**: 文件注释写着"包含 session、skill、upload、artifact 等全部逻辑，约 2000 行"，但实际只有 import 语句和变量声明，**没有任何函数实现，没有导出**。

```javascript
// 第 107-109 行
// ── 从 server.mjs 提取的所有本地函数 ──
// (包含 session、skill、upload、artifact 等全部逻辑，约 2000 行)
// 这些将逐步迁移到 server/services/ 中
```

**影响**: 这个文件是未完成的迁移产物，被 `server/index.mjs` 导入但无法提供 `handle` 函数。

---

## P1 — 重要问题（建议修复）

### 4. CORS 配置过于宽松

**文件**: `server/middleware/cors.mjs`, `server.mjs`

```javascript
// cors.mjs
'Access-Control-Allow-Origin': '*'  // 允许任意来源

// server.mjs (多处)
res.writeHead(200, { ..., 'Access-Control-Allow-Origin': '*' });
```

**问题**: 
- `Access-Control-Allow-Origin: *` 允许任意网站跨域访问 API
- 虽然是本地工具，但如果用户在浏览器中打开了恶意页面，该页面可以调用 `localhost:7878` 的 API
- 结合 shell 执行接口（`/api/chain-task/shell`），存在 CSRF → RCE 风险链

**修复建议**:
```javascript
const ALLOWED_ORIGINS = ['http://localhost:7878', 'http://127.0.0.1:7878'];
const origin = req.headers.origin;
if (ALLOWED_ORIGINS.includes(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
}
```

### 5. Shell 执行器缺乏命令注入防护

**文件**: `server/services/chain-task.mjs` 第 53-56 行

```javascript
export function executeShell(command, runId, context = {}) {
  const isWin = process.platform === 'win32';
  const child = spawn(isWin ? 'powershell' : 'sh', 
    [isWin ? '-Command' : '-c', command], { ... });
```

**问题**:
- `command` 直接传入 shell 执行，虽然有 `commandSafety.mjs` 做危险等级分类
- 但 `getDangerLevel()` 只做正则匹配，可被绕过（如 `r""m -rf /`、变量拼接等）
- `commandSafety.mjs` 的 `DESTRUCTIVE` 级别检查是否在调用链中强制阻断？需要确认

**修复建议**:
- 对 `DESTRUCTIVE` 级别命令强制要求审批（已有 `governance.mjs`，需确认调用链）
- 考虑使用白名单机制限制可执行命令类型
- 在日志中记录所有 shell 执行命令（已有 `appendAudit`，确认覆盖）

### 6. 前端大量使用 innerHTML 存在 XSS 风险

**文件**: `web/js/app-core.js`（20+ 处）, `web/app.js`

```javascript
// app-core.js 第 38 行
pillsEl.innerHTML = agents.map(a =>
  `<span class="agent-pill ${a.available ? 'ok' : 'err'} ..." 
    title="${esc(a.error || ...)}">
    <span class="dot"></span>${esc(a.label || a.key)}
  </span>`
).join('');
```

**问题**:
- 虽然使用了 `esc()` 函数转义，但 `esc()` 只处理 `& < > "`，**没有转义单引号 `'`**
- 如果 agent label 包含单引号，且被用在单引号属性中，可导致 XSS
- `app-core.js` 第 4284 行直接拼接 `msg.type` 到 HTML，未转义

```javascript
// app-core.js 第 4284 行 — 未转义
div.innerHTML = "<div class=\"sa-system-msg ...\">" + h + "</div>";
// h 中包含 esc() 处理过的内容，但 msg.type 等字段未处理
```

**修复建议**:
```javascript
// 增强 esc 函数
function esc(s) {
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');  // 新增单引号转义
}
```

### 7. `.mjs` 和 `.ts` 双文件并存但无构建流程

**文件**: `server/services/logger.mjs` + `logger.ts` 等

**问题**:
- `logger.mjs` 和 `logger.ts` 内容几乎完全相同
- `tsconfig.json` 设置 `noEmit: true`，即 TypeScript 文件不会被编译
- 运行时实际加载的是 `.mjs` 文件，`.ts` 文件仅用于类型检查
- 这意味着 `.ts` 文件是**纯类型注解副本**，两份代码需手动同步

**影响**: 
- 修改 `.mjs` 后忘记同步 `.ts`，类型检查会通过但运行时行为不一致
- 反之，修改 `.ts` 后忘记同步 `.mjs`，类型安全形同虚设

**修复建议**:
- 方案 A：删除 `.ts` 文件，在 `.mjs` 中使用 JSDoc 注释提供类型（`// @ts-check`）
- 方案 B：使用 `tsx` 或 `ts-node` 直接运行 `.ts`，删除 `.mjs`
- 方案 C：配置 tsc 编译输出，CI 检查编译产物与 `.mjs` 一致

---

## P2 — 改进建议

### 8. 大量空 catch 块吞噬错误

**统计**: 全项目 24+ 处 `catch {}` 或 `catch { /* comment */ }`

```javascript
// 典型示例
try { child?.kill('SIGTERM'); } catch {}
try { return JSON.parse(repaired); } catch {}
try { res.write(sseData); } catch {}
```

**问题**: 
- 静默吞噬错误，调试困难
- 部分场景合理（如 SSE 客户端断开），但应至少 debug 级别日志
- `logger` 模块已存在但未被使用

**修复建议**:
```javascript
// 合理的静默场景也应记录
try { res.write(sseData); } catch (e) { 
  logger.debug('SSE write failed', { error: e.message });
}
```

### 9. `server.mjs` 仍有 4315 行，模块化不彻底

**现状**:
- `server.mjs`: 4315 行（实际运行入口）
- `server/routes/agents.mjs`: 81 行（提取的路由）
- `server/routes/skills.mjs`: 80+ 行（提取的路由）
- `server/routes/sessions.mjs`: 80+ 行（提取的路由）

**问题**: 虽然提取了部分路由到独立模块，但 `server.mjs` 仍包含：
- `handle()` 主路由函数（3000+ 行）
- session 管理
- skill 安装/克隆逻辑
- 文件上传
- SSE 流处理
- Studio 模板定义

**建议**: 继续按域拆分 `handle()` 函数，目标将 `server.mjs` 降至 500 行以内。

### 10. `web/app.js`（5975 行）仍是单体文件

**现状**: 虽然拆分出了 7 个 JS 文件，但 `app.js` 仍有 5975 行，且 `app-core.js` 有 4288 行。

**问题**: 
- `app.js` 和 `app-core.js` 的职责边界不清晰
- `app.js` 包含 Rich Blocks 渲染器、skill registry 缓存等
- `app-core.js` 包含几乎所有 UI 逻辑

**建议**: 
- 将 `app.js` 中的 `renderInline`、`parseAttrs` 等移入 `utils/rich-blocks.js`
- 将 `app-core.js` 按 UI 组件进一步拆分（session-list、chat-input、task-panel 等）

### 11. CI 测试排除策略不够优雅

**文件**: `.github/workflows/ci.yml` 第 78-88 行

```yaml
- name: Run test suite (excluding data-dependent tests)
  run: |
    node --test \
      tests/collaboration-context.test.mjs \
      tests/e2e-lifecycle.test.mjs \
      ...（手动列出 8 个测试文件）
```

**问题**: 
- 手动维护测试文件列表，新增测试文件容易遗漏
- 数据依赖测试（phuket-guide、jmu-routes 等）完全不在 CI 中运行

**建议**:
```yaml
# 方案：使用测试标签或条件跳过
- name: Run tests
  run: node --test tests/*.test.mjs
  env:
    CI: 'true'
# 在数据依赖测试中：
# if (process.env.CI && !existsSync('reports/')) { it.skip('requires data'); return; }
```

### 12. `package.json` 的 `check` 脚本维护成本高

```json
"check": "node --check server.mjs && node --check dispatch.mjs && ...（15+ 个文件）"
```

**问题**: 每新增一个 `.mjs` 文件就要手动加入 check 脚本。

**建议**:
```json
"check": "node --check **/*.mjs"
# 或使用 glob 脚本
"check": "node scripts/syntax-check-all.mjs"
```

### 13. TypeScript 配置 `moduleResolution: "bundler"` 不匹配

**文件**: `tsconfig.json`

```json
"module": "ES2022",
"moduleResolution": "bundler",
```

**问题**: `bundler` 模式解析适用于打包工具（webpack/vite），但项目使用 Node.js 原生 ESM。应使用 `nodeNext`。

**建议**:
```json
"moduleResolution": "nodeNext"
```

---

## 架构建议

### 当前架构问题

```
实际运行: server.mjs (4315行单体) ← 所有逻辑都在这里
         ↓
假装拆分: server/index.mjs (死代码，无法运行)
         server/config.mjs (重复定义，未被运行时使用)
         server/routes/legacy-handle.mjs (空壳)
         server/routes/agents.mjs (被 server.mjs 导入使用 ✓)
         server/routes/skills.mjs (被 server.mjs 导入使用 ✓)
         server/routes/sessions.mjs (被 server.mjs 导入使用 ✓)
```

### 建议目标架构

```
server.mjs (入口，<100行)
  └─ server/index.mjs (应用初始化)
       ├─ server/config.mjs (唯一配置源)
       ├─ server/router.mjs (路由注册表)
       ├─ server/routes/
       │    ├─ agents.mjs
       │    ├─ skills.mjs
       │    ├─ sessions.mjs
       │    ├─ chat.mjs (SSE 流)
       │    ├─ chain-task.mjs
       │    ├─ artifacts.mjs
       │    └─ hub.mjs (统计/审批/调度)
       └─ server/services/
            ├─ logger.mjs
            ├─ session-store.mjs
            ├─ lesson.mjs
            └─ ...
```

---

## 安全检查清单

| 项目 | 状态 | 说明 |
|------|------|------|
| .env 已在 .gitignore | ✅ | 敏感配置不入库 |
| API key 脱敏 | ✅ | `stripSensitive()` 移除 apiKey |
| 审计日志 | ✅ | `appendAudit()` 记录敏感操作 |
| 命令危险等级分类 | ✅ | `commandSafety.mjs` 实现 |
| 路径遍历防护 | ✅ | `resolveWorkspaceHtmlPath` 实现 |
| CORS 限制 | ❌ | `*` 过于宽松 |
| Shell 注入防护 | ⚠️ | 依赖正则，可被绕过 |
| XSS 防护 | ⚠️ | esc() 未转义单引号 |
| 输入验证 | ⚠️ | 部分路由缺少 body 校验 |
| 速率限制 | ❌ | 无 |

---

## 优先级排序

| 优先级 | 问题 | 工作量 |
|--------|------|--------|
| P0-1 | 删除或修复 server/index.mjs | 0.5h |
| P0-2 | 消除 config 重复定义 | 1h |
| P0-3 | 删除空壳 legacy-handle.mjs | 0.5h |
| P1-4 | 收紧 CORS 配置 | 0.5h |
| P1-5 | Shell 执行审批链确认 | 1h |
| P1-6 | 修复 esc() 单引号转义 | 0.5h |
| P1-7 | .mjs/.ts 双轨问题决策 | 2h |
| P2-8 | 空 catch 块添加日志 | 1h |
| P2-9 | 继续拆分 server.mjs | 8h+ |
| P2-10 | 继续拆分 app.js/app-core.js | 4h+ |

---

## 总结

项目功能完整、CI 流程已建立、基础安全防护到位。但**模块化拆分是半成品**：`server/index.mjs` 是死代码，`legacy-handle.mjs` 是空壳，配置存在重复定义。建议优先清理 P0 问题（删除死代码），再逐步推进 P1 安全加固。
