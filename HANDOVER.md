# myteam 交接文档（2026-06-17）

## 当前状态

- 分支：`main`
- 远端：`origin https://github.com/jhryo25/myteamOUO.git`
- 本轮基于 2026-06-17 的更新提交做 review，并修复了 skill market、shell、outputs、刷新恢复相关的运行时问题。
- README 已改为中文说明，覆盖当前功能、架构、API、运行时数据和本轮修复。

## 本轮已完成

### 1. 重新拉取代码

已从 `origin/main` fast-forward 到 `190b87e`：

```text
docs: rewrite README with all new features
```

今天新增的主要代码提交是：

```text
7b9b680 feat: skill marketplace UI, shell execution, subagent session view, HTML auto-save, streaming UX improvements
190b87e docs: rewrite README with all new features
```

### 2. Review 并修复 Bug

本轮确认并修复的问题：

- `skills-registry/index.json` 注册了 `shell-exec`，但缺少 `skills-registry/shell-exec/SKILL.md`，导致市场安装 404。
- 官方 market 只读 GitHub main，不读当前 checkout，本地新增 registry 条目无法立即验证。
- 本地 `skills-registry/index.json` 带 BOM 时，`JSON.parse` 会失败并返回 502。
- 前端 Skills 页面市场安装按钮误调 `/api/skills/install-source`，但后端市场安装接口是 `/api/skills/install`。
- `server.mjs` 新增逻辑使用了 `dirname()`，但没有从 `path` 导入。
- `/api/outputs/file` 使用不存在的 `chr(92)`，请求带反斜杠文件名时会抛运行时错误。
- 远程 ZIP 安装用 UTF-8 文本写入 ZIP，会破坏二进制文件。
- HTML artifact 保存会把 `foo.html` 写成 `foo.html.html`，且文件名缺少安全清理。
- `restoreRunningState()` 合成运行态时缺 `startedAt`，刷新后计时可能 NaN。
- 子代理按钮注入逻辑可能给普通任务也加入口，现在只对链式子任务显示。
- 生成目录 `.myteam/outputs/` 和临时 skill 目录缺少 gitignore。

### 3. 文档更新

已更新：

- `README.md`：中文 README，包含快速启动、功能、架构、API、文件结构、本轮修复和验证结果。
- `HANDOVER.md`：中文交接文档，记录本轮改动、验证、注意事项和后续建议。

### 4. Lesson 沉淀

已写入本地 `.myteam/lessons.jsonl`：

```text
review-20260617-skill-market-shell
```

核心经验：

- registry/market/file 类功能不能只做语法检查，必须跑本地服务验证完整路径。
- 本地 checkout 应优先于远程 main，避免本地新 registry 条目无法验证。
- JSON 读取要考虑 BOM。
- 外部传入的 name/path 必须 sanitize/basename。
- 二进制下载必须用 Buffer。
- 前端调用要检查 `res.ok` 和后端返回契约。

该文件在 `.gitignore` 中，作为本地长期记忆，不会随 git push 上传。

## 代码改动清单

### `.gitignore`

- 新增忽略：
  - `.myteam/outputs/`
  - `.myteam/.tmp-skill-*`

### `server.mjs`

- 从 `path` 导入 `dirname`。
- 移除未使用的 `isDangerousCommand` 导入。
- 新增 `sanitizeSkillName()` 和 `inferSkillName()`。
- 新增 `httpGetBuffer()`，用于远程 ZIP 二进制下载。
- 新增 `readSkillSourceIndex()`，官方 registry 优先读本地 `skills-registry/index.json`，并 strip BOM。
- 新增 `resolveLocalSkillPath()` 和 `readSkillMarkdownFromEntry()`，支持本地 registry 条目直接读本地 SKILL.md。
- `cloneAndFindSkillMd()` 会清理临时 clone 目录。
- `/api/skills/install` 会清理 skill name。
- `/api/skills/install-source` 会从 frontmatter `name:` 推断 skill 名。
- `saveArtifactFile()` 使用安全文件名，不再重复追加扩展名。
- `/api/outputs/file` 修复反斜杠检测和路径 join。

### `web/app.js`

- 任务行增加 `data-task-id`、`data-parent-task-id`、`data-chain-depth`。
- 刷新恢复运行态时默认 `running = []`、`tasks = []`。
- 从 tasks.jsonl 合成运行态时补齐 `startedAt`。
- Skills 市场安装按钮改为调用 `/api/skills/install`，并检查 `res.ok` 与 `data.ok`。
- 子代理按钮只注入到链式子任务。

### `skills-registry/index.json`

- `updated_at` 更新到 `2026-06-17`。
- 保留 `shell-exec` 注册项。

### `skills-registry/shell-exec/SKILL.md`

- 新增官方 skill 定义。
- 描述 shell 执行、风险确认、stdout/stderr/exit code 证据模板。

### `README.md`

- 改为中文。
- 记录当前功能、API、架构、运行时数据、本轮修复和验证结果。

## 已验证

静态检查：

```bash
node --check server.mjs
node --check web/app.js
git diff --check
```

命令安全分类：

```text
Write-Output OK => safe
git push origin main => caution
git reset --hard HEAD => destructive
Remove-Item -Recurse .\tmp => caution
```

本地临时服务验证（端口 7879）：

```text
registryShell=shell-exec:shell-exec/SKILL.md
marketInstall=shell-exec
shellStream 包含 stdout "OK\r\n" 且 exitCode=0
badNameStatus=400
```

## 注意事项

- 浏览器自动点击验证本轮没有执行：当前会话没有暴露可用的 in-app browser 工具；已用服务级 API 验证覆盖关键路径。
- `.myteam/lessons.jsonl` 是本地运行时记忆，已记录本轮 lesson，但不会被 git 提交。
- `chainTaskMessages` 仍是内存 Map；服务重启后子代理历史不会持久化。
- Shell 执行目前有 30 秒 timeout，前端 SSE 断开不主动终止命令。
- 官方 registry 的本地优先策略只对 `myteam-official` 生效；`clowder-ai` 仍走远程 manifest。

## 后续建议

- 给 `/api/skills/install`、`/api/skills/install-source`、`/api/outputs/file` 补自动化测试。
- 子代理消息如果要跨服务重启保留，可落到 `.myteam/chain-messages.jsonl`。
- Shell 执行建议增加 allowlist 工作目录和更细的 Windows 命令拆分策略。
- 若 Browser 插件可用，补一轮页面级验证：打开 Skills、安装 market skill、执行 safe shell、打开 artifacts panel。
