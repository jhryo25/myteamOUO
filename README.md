# myteamOUO

myteamOUO 是 myteam 的轻量级 A2A 协作工具 MVP。

它要解决的问题是：如何用低成本的方式，让多个 agent 像一个小团队一样协作，并且能留下任务记录、审查结果和自迭代线索。

## 当前版本能做什么

第一步只做项目骨架和最小可见演示：

- 创建 `.myteam` 协作目录。
- 创建 Agent1 Kimi 和 Agent2 Codex 的协作配置。
- 创建任务记录、踩坑记录和长期记忆文件。
- 提供 `init`、`status`、`ui` 三个命令。
- 提供 `index.html` 作为最小 HTML 验收页面。

## 当前 Agent 分工

- Agent1：Kimi，路径是 `C:\Users\Administrator\.kimi-code\bin\kimi.exe`。
- Agent2：Codex，也就是当前这个开发助手。

当前 HTML 验收页展示的是最小可行流程：

1. 用户提出目标。
2. Codex 拆任务并写明验收标准。
3. Kimi 执行适合外部 CLI 的小任务。
4. Codex 审查结果，记录经验，并生成下一轮迭代建议。

## 怎么运行

初始化项目：

```powershell
python myteam.py init
```

查看当前状态：

```powershell
python myteam.py status
```

生成 HTML 验收页面：

```powershell
python myteam.py ui
```

生成后，打开 `index.html` 就能看到当前 MVP 骨架状态和 Agent1/Agent2 协作功能。

## `.myteam` 目录是什么

`.myteam` 可以理解成 myteam 的“协作大脑”。

- `.myteam/agents.yaml`：保存 Agent1 Kimi 和 Agent2 Codex 配置。
- `.myteam/tasks.jsonl`：保存任务记录，目前先为空。
- `.myteam/lessons.jsonl`：保存踩坑记录，目前先为空。
- `.myteam/memory.md`：保存长期经验。
- `.myteam/runs/`：后续保存每一轮自迭代的运行记录。

## GitHub 版本管控

本项目已经连接到 GitHub 仓库：

```text
https://github.com/jhryo25/myteamOUO
```

常用命令：

```powershell
git status
git add .
git commit -m "你的提交说明"
git push
```

## 下一步

下一步会增加 `plan` 命令，让 Controller Agent 把一个目标拆成可以执行和检查的小任务。
