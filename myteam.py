from __future__ import annotations

import argparse
from pathlib import Path


PROJECT_DIR = Path(".myteam")
RUNS_DIR = PROJECT_DIR / "runs"


AGENTS_TEMPLATE = """# myteam 默认 agent 配置
# 先用最少的三类角色跑通 A2A 协作闭环。
agents:
  controller:
    role: "总控 Agent"
    description: "理解目标、拆分任务、分配 worker、检查结果。"
  worker:
    role: "执行 Agent"
    description: "完成被分配的小任务，并输出可检查的结果。"
  reviewer:
    role: "审查 Agent"
    description: "检查结果是否可靠，指出风险、遗漏和下一步。"
"""


MEMORY_TEMPLATE = """# myteam 长期记忆

这里保存已经确认有效的项目经验。

注意：
- 不是所有输出都能写入长期记忆。
- 只有经过 review 或人工确认的经验，才应该放到这里。
- 这样做是为了避免 agent 把错误经验反复带到后续迭代里。
"""


GITIGNORE_TEMPLATE = """# Python 缓存文件
__pycache__/
*.py[cod]

# 本地环境文件
.venv/
venv/
.env

# myteam 运行过程产生的临时记录
.myteam/runs/

# 系统文件
.DS_Store
Thumbs.db
"""


README_TEMPLATE = """# myteam

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
"""


HTML_TEMPLATE = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>myteam MVP 验收面板</title>
  <style>
    :root {
      --bg: #f7f8fa;
      --surface: #ffffff;
      --text: #18202f;
      --muted: #5d6878;
      --line: #d9dee7;
      --accent: #126b5c;
      --accent-soft: #dff3ee;
      --warn: #8a5a00;
      --warn-soft: #fff2cf;
      --shadow: 0 14px 40px rgba(24, 32, 47, 0.08);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
      line-height: 1.6;
    }

    .shell {
      width: min(1080px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0 44px;
    }

    header {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(260px, 0.7fr);
      gap: 24px;
      align-items: stretch;
      margin-bottom: 24px;
    }

    .intro,
    .panel,
    .status-item {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }

    .intro {
      padding: 28px;
    }

    h1 {
      margin: 0 0 12px;
      font-size: 34px;
      line-height: 1.18;
    }

    h2 {
      margin: 0 0 14px;
      font-size: 20px;
    }

    p {
      margin: 0;
      color: var(--muted);
    }

    .commands {
      display: grid;
      gap: 10px;
      padding: 22px;
    }

    code {
      display: block;
      padding: 10px 12px;
      overflow-wrap: anywhere;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #111827;
      color: #f8fafc;
      font-family: Consolas, "Courier New", monospace;
      font-size: 14px;
    }

    main {
      display: grid;
      gap: 24px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .status-item {
      padding: 16px;
      min-height: 112px;
    }

    .status-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 8px;
    }

    .status-name {
      font-weight: 700;
    }

    .badge {
      flex: 0 0 auto;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
    }

    .ok {
      color: var(--accent);
      background: var(--accent-soft);
    }

    .missing {
      color: var(--warn);
      background: var(--warn-soft);
    }

    .path {
      margin-top: 8px;
      color: var(--muted);
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .panel {
      padding: 22px;
    }

    .steps {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 14px;
    }

    .step {
      border-left: 4px solid var(--accent);
      padding: 8px 10px;
      background: #f9fbfb;
      border-radius: 6px;
      color: var(--muted);
      min-height: 80px;
    }

    .step strong {
      display: block;
      color: var(--text);
      margin-bottom: 4px;
    }

    footer {
      margin-top: 24px;
      color: var(--muted);
      font-size: 14px;
    }

    @media (max-width: 820px) {
      header,
      .grid,
      .steps {
        grid-template-columns: 1fr;
      }

      h1 {
        font-size: 28px;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <section class="intro">
        <h1>myteam MVP 验收面板</h1>
        <p>这个页面用来检查第一版骨架是否已经准备好：CLI、协作目录、agent 配置、任务记录和自迭代入口。</p>
      </section>
      <aside class="panel commands">
        <h2>常用命令</h2>
        <code>python myteam.py init</code>
        <code>python myteam.py status</code>
        <code>python myteam.py ui</code>
      </aside>
    </header>

    <main>
      <section>
        <h2>骨架状态</h2>
        <div class="grid">
__STATUS_ITEMS__
        </div>
      </section>

      <section class="panel">
        <h2>最小自迭代闭环</h2>
        <p>当前版本先准备存放记录的位置，下一步会让 Controller Agent 把目标拆成任务。</p>
        <div class="steps">
          <div class="step"><strong>1. 目标</strong>写清楚本轮要解决的问题。</div>
          <div class="step"><strong>2. 分工</strong>controller 分配 worker 和 reviewer。</div>
          <div class="step"><strong>3. 审查</strong>用证据判断任务是否真的完成。</div>
          <div class="step"><strong>4. 迭代</strong>总结经验，生成下一轮 backlog。</div>
        </div>
      </section>
    </main>

    <footer>这是本地静态 HTML 页面，不需要安装前端框架。</footer>
  </div>
</body>
</html>
"""


def write_file_if_missing(path: Path, content: str) -> bool:
    """如果文件不存在就写入；如果已存在就不覆盖。"""
    if path.exists():
        return False

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def init_project() -> None:
    """初始化 myteam 的最小协作目录。"""
    already_initialized = PROJECT_DIR.exists()

    PROJECT_DIR.mkdir(exist_ok=True)
    RUNS_DIR.mkdir(exist_ok=True)

    created_files = []
    skipped_files = []

    default_files = {
        PROJECT_DIR / "agents.yaml": AGENTS_TEMPLATE,
        PROJECT_DIR / "tasks.jsonl": "",
        PROJECT_DIR / "lessons.jsonl": "",
        PROJECT_DIR / "memory.md": MEMORY_TEMPLATE,
        Path("README.md"): README_TEMPLATE,
        Path("index.html"): build_ui_html(),
        Path(".gitignore"): GITIGNORE_TEMPLATE,
    }

    for file_path, content in default_files.items():
        if write_file_if_missing(file_path, content):
            created_files.append(file_path)
        else:
            skipped_files.append(file_path)

    if already_initialized:
        print("myteam 已经初始化过，本次不会覆盖已有文件。")
    else:
        print("myteam 初始化完成。")

    if created_files:
        print("\n新创建的文件：")
        for file_path in created_files:
            print(f"- {file_path}")

    if skipped_files:
        print("\n已存在并保留的文件：")
        for file_path in skipped_files:
            print(f"- {file_path}")

    print("\n下一步建议：运行 `python myteam.py status` 查看项目状态。")


def check_path(path: Path, label: str, is_dir: bool = False) -> bool:
    """检查关键文件或目录是否存在，并用中文输出结果。"""
    exists = path.is_dir() if is_dir else path.is_file()
    mark = "OK" if exists else "缺失"
    print(f"[{mark}] {label}: {path}")
    return exists


def show_status() -> None:
    """显示 myteam 当前骨架是否完整。"""
    print("myteam 当前状态：\n")

    checks = [
        check_path(PROJECT_DIR, "协作目录", is_dir=True),
        check_path(PROJECT_DIR / "agents.yaml", "agent 配置"),
        check_path(PROJECT_DIR / "tasks.jsonl", "任务记录"),
        check_path(PROJECT_DIR / "lessons.jsonl", "踩坑记录"),
        check_path(PROJECT_DIR / "memory.md", "长期记忆"),
        check_path(RUNS_DIR, "运行记录目录", is_dir=True),
    ]

    if all(checks):
        print("\n状态正常：myteam 已准备好进入下一步。")
    else:
        print("\n状态不完整：请先运行 `python myteam.py init` 修复缺失文件。")


def build_status_item(path: Path, label: str, description: str, is_dir: bool = False) -> str:
    """生成 HTML 状态卡片，方便用户直接在页面里验收。"""
    exists = path.is_dir() if is_dir else path.is_file()
    badge_class = "ok" if exists else "missing"
    badge_text = "已就绪" if exists else "缺失"
    return f"""          <article class="status-item">
            <div class="status-top">
              <span class="status-name">{label}</span>
              <span class="badge {badge_class}">{badge_text}</span>
            </div>
            <p>{description}</p>
            <div class="path">{path}</div>
          </article>"""


def build_ui_html() -> str:
    """根据当前项目文件状态生成验收页面。"""
    items = [
        build_status_item(PROJECT_DIR, "协作目录", "保存 myteam 的协作数据。", is_dir=True),
        build_status_item(PROJECT_DIR / "agents.yaml", "agent 配置", "保存 controller、worker、reviewer。"),
        build_status_item(PROJECT_DIR / "tasks.jsonl", "任务记录", "后续保存每个任务的输入、状态和输出。"),
        build_status_item(PROJECT_DIR / "lessons.jsonl", "踩坑记录", "后续保存失败原因和修复经验。"),
        build_status_item(PROJECT_DIR / "memory.md", "长期记忆", "保存确认有效的长期经验。"),
        build_status_item(RUNS_DIR, "运行记录", "后续保存每轮自迭代证据。", is_dir=True),
    ]
    return HTML_TEMPLATE.replace("__STATUS_ITEMS__", "\n".join(items))


def write_ui() -> None:
    """生成最小 HTML 验收界面。"""
    output_path = Path("index.html")
    output_path.write_text(build_ui_html(), encoding="utf-8")
    print("HTML 验收页面已生成：index.html")
    print("你可以在文件管理器中打开它，或者用浏览器打开 D:\\myteam\\index.html。")


def build_parser() -> argparse.ArgumentParser:
    """创建命令行解析器。"""
    parser = argparse.ArgumentParser(
        prog="myteam",
        description="myteam：轻量 A2A 协作工具 MVP。",
    )
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("init", help="初始化 .myteam 协作目录")
    subparsers.add_parser("status", help="查看 myteam 当前状态")
    subparsers.add_parser("ui", help="生成最小 HTML 验收页面")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "init":
        init_project()
    elif args.command == "status":
        show_status()
    elif args.command == "ui":
        write_ui()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
