# myteamOUO

myteamOUO 是 myteam 的轻量级 A2A 协作工具 MVP。

它要解决的问题是：如何用低成本的方式，让多个 agent 像一个小团队一样协作，并且能留下任务记录、审查结果和自迭代线索。

## 当前版本能做什么

第一步只做项目骨架：

- 创建 `.myteam` 协作目录。
- 创建默认 agent 配置。
- 创建任务记录、踩坑记录和长期记忆文件。
- 提供 `init`、`status`、`ui` 三个命令。
- 提供 `index.html` 作为最小 HTML 验收页面。

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

生成后，打开 `index.html` 就能看到当前 MVP 骨架状态。

## `.myteam` 目录是什么

`.myteam` 可以理解成 myteam 的“协作大脑”。

- `.myteam/agents.yaml`：保存 controller、worker、reviewer 三类 agent。
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
