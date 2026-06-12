# myteamOUO

myteamOUO 是 myteam 的轻量级 A2A 协作工具 MVP。

它要解决的问题是：如何用低成本的方式，让多个 agent 像一个小团队一样协作，并且能留下任务记录、审查结果和自迭代线索。

## 当前 Agent 阵容

| Agent | 角色 | 定位 |
|-------|------|------|
| Agent1 Kimi | 轻量执行 | 接收明确小任务：草稿、命令执行、内容补充 |
| Agent2 Claude | 主架构 / 深度实现 | 深度分析、架构设计、复杂代码生成 |
| Agent3 Codex | 总控 / 审查 / 自迭代 | 拆任务、决定派工、审查证据、记录经验 |

## 配置 CLI 路径（重要）

真实路径不会提交到 GitHub，统一通过 `.env` 文件管理。

1. 复制 `.env.example` 为 `.env`
2. 在 `.env` 中填入本机真实路径，例如：

```env
KIMI_PATH=C:\path\to\kimi.exe
CLAUDE_PATH=C:\path\to\claude.cmd
CODEX_PATH=C:\path\to\codex.cmd
```

`.gitignore` 已包含 `.env`，本地路径不会被推上去。

## 当前版本能做什么

- 创建 `.myteam` 协作目录
- 登记 Agent1 Kimi / Agent2 Claude / Agent3 Codex 的协作配置
- 创建任务记录、踩坑记录和长期记忆文件
- 提供 `init`、`status`、`ui` 三个命令
- 提供 `index.html` 最小 HTML 验收页面（路径已脱敏展示）

## 怎么运行

```powershell
python myteam.py init      # 初始化骨架
python myteam.py status    # 查看状态（含三 CLI 检测）
python myteam.py ui        # 重新生成验收页面
python myteam.py plan "目标描述"              # 调用 Codex 拆任务（默认）
python myteam.py plan "目标描述" --agent claude  # 指定用 Claude 拆
```

也可以直接用 Node.js 调用：

```powershell
node plan.mjs "目标描述"
node plan.mjs "目标描述" --agent claude
```

## `.myteam` 目录是什么

- `.myteam/agents.yaml`：登记三个 Agent 的角色与对应环境变量名
- `.myteam/tasks.jsonl`：任务记录
- `.myteam/lessons.jsonl`：踩坑记录
- `.myteam/memory.md`：长期经验
- `.myteam/runs/`：每轮自迭代运行记录

## GitHub 版本管控

```text
https://github.com/jhryo25/myteamOUO
```

```powershell
git status
git add .
git commit -m "你的提交说明"
git push
```

## 下一步

- 加 `plan` 命令：Controller Agent 把目标拆成可执行小任务
- 加 `dispatch` 命令：根据任务类型派给 Kimi / Claude / Codex
