# myteam

myteam 是一个轻量级 A2A 协作工具 MVP。

它要解决的问题是：如何用低成本的方式，让多个 agent 像一个小团队一样协作，并且能留下任务记录、审查结果和自迭代线索。

## 当前版本能做什么

第一步只做项目骨架：

- 创建 `.myteam` 协作目录。
- 创建默认 agent 配置。
- 创建任务记录、踩坑记录和长期记忆文件。
- 提供 `init` 和 `status` 两个命令。

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

当前电脑里暂时没有检测到 `git` 或 `gh` 命令，所以我已经先准备了 `.gitignore`，避免以后把 Python 缓存和运行日志误提交。

等你安装好 Git 后，可以在这个目录里运行：

```powershell
git init
git add .
git commit -m "初始化 myteam MVP 骨架"
```

如果你已经在 GitHub 上创建了仓库，再继续运行：

```powershell
git remote add origin 你的仓库地址
git branch -M main
git push -u origin main
```

## 下一步

下一步会增加 `plan` 命令，让 Controller Agent 把一个目标拆成可以执行和检查的小任务。
