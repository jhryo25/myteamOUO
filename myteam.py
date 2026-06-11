# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
from pathlib import Path


PROJECT_DIR = Path(".myteam")
RUNS_DIR = PROJECT_DIR / "runs"
KIMI_AGENT_PATH = Path(r"C:\Users\Administrator\.kimi-code\bin\kimi.exe")


AGENTS_TEMPLATE = f"""# myteam 默认 agent 配置
# 先用两个真实可理解的 agent 展示最小 A2A 协作。
agents:
  agent1_kimi:
    role: "Agent1：Kimi 执行 Agent"
    command: "{KIMI_AGENT_PATH}"
    description: "负责作为外部命令行 agent，后续可执行被分配的小任务。"
    current_status: "已登记，CLI 会检查本地 kimi.exe 是否存在。"
  agent2_codex:
    role: "Agent2：Codex 总控/审查 Agent"
    command: "当前 Codex 对话"
    description: "负责理解目标、拆任务、审查结果、总结经验，并控制下一轮迭代。"
    current_status: "已登记，当前由 Codex 扮演。"
workflow:
  - "用户提出目标"
  - "Agent2 Codex 拆分任务和验收标准"
  - "Agent1 Kimi 执行适合外部 CLI 的任务"
  - "Agent2 Codex 审查输出并生成下一步"
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


README_TEMPLATE = """# myteamOUO

myteamOUO 是 myteam 的轻量级 A2A 协作工具 MVP。

它要解决的问题是：如何用低成本的方式，让多个 agent 像一个小团队一样协作，并且能留下任务记录、审查结果和自迭代线索。

## 当前版本能做什么

第一步只做项目骨架：

- 创建 `.myteam` 协作目录。
- 创建 Agent1 Kimi 和 Agent2 Codex 的协作配置。
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

生成后，打开 `index.html` 就能看到当前 MVP 骨架状态和 Agent1/Agent2 协作功能。
"""


def write_file_if_missing(path: Path, content: str) -> bool:
    """如果文件不存在就写入；如果已存在就不覆盖。"""
    if path.exists():
        return False

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def path_exists(path: Path, is_dir: bool = False) -> bool:
    """统一检查文件或目录是否存在。"""
    return path.is_dir() if is_dir else path.is_file()


def init_project() -> None:
    """初始化 myteam 的最小协作目录。"""
    already_initialized = PROJECT_DIR.exists()

    PROJECT_DIR.mkdir(exist_ok=True)
    RUNS_DIR.mkdir(exist_ok=True)

    default_files = {
        PROJECT_DIR / "agents.yaml": AGENTS_TEMPLATE,
        PROJECT_DIR / "tasks.jsonl": "",
        PROJECT_DIR / "lessons.jsonl": "",
        PROJECT_DIR / "memory.md": MEMORY_TEMPLATE,
        Path("README.md"): README_TEMPLATE,
        Path("index.html"): build_ui_html(),
        Path(".gitignore"): GITIGNORE_TEMPLATE,
    }

    created_files = []
    skipped_files = []

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
    exists = path_exists(path, is_dir=is_dir)
    mark = "OK" if exists else "缺失"
    print(f"[{mark}] {label}: {path}")
    return exists


def show_status() -> None:
    """显示 myteam 当前骨架和 agent 是否准备好。"""
    print("myteam 当前状态：\n")

    checks = [
        check_path(PROJECT_DIR, "协作目录", is_dir=True),
        check_path(PROJECT_DIR / "agents.yaml", "agent 配置"),
        check_path(PROJECT_DIR / "tasks.jsonl", "任务记录"),
        check_path(PROJECT_DIR / "lessons.jsonl", "踩坑记录"),
        check_path(PROJECT_DIR / "memory.md", "长期记忆"),
        check_path(RUNS_DIR, "运行记录目录", is_dir=True),
        check_path(KIMI_AGENT_PATH, "Agent1 Kimi 可执行文件"),
    ]

    print("\nAgent 分工：")
    print("- Agent1：Kimi，负责后续外部 CLI 执行任务。")
    print("- Agent2：Codex，负责总控、审查和自迭代计划。")

    if all(checks):
        print("\n状态正常：myteam 已准备好展示 Agent1/Agent2 协作 MVP。")
    else:
        print("\n状态不完整：请先运行 `python myteam.py init`，并确认 Kimi 路径是否正确。")


def build_status_item(path: Path, label: str, description: str, is_dir: bool = False) -> str:
    """生成 HTML 状态卡片，方便用户直接在页面里验收。"""
    exists = path_exists(path, is_dir=is_dir)
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
    """根据当前项目文件状态生成最小 HTML 验收页面。"""
    status_items = "\n".join(
        [
            build_status_item(PROJECT_DIR, "协作目录", "保存 myteam 的协作数据。", is_dir=True),
            build_status_item(PROJECT_DIR / "agents.yaml", "agent 配置", "登记 Agent1 Kimi 和 Agent2 Codex。"),
            build_status_item(PROJECT_DIR / "tasks.jsonl", "任务记录", "后续保存每个任务的输入、状态和输出。"),
            build_status_item(PROJECT_DIR / "lessons.jsonl", "踩坑记录", "后续保存失败原因和修复经验。"),
            build_status_item(PROJECT_DIR / "memory.md", "长期记忆", "保存确认有效的长期经验。"),
            build_status_item(KIMI_AGENT_PATH, "Agent1 Kimi", "本地 Kimi CLI，可作为外部执行 agent。"),
        ]
    )

    kimi_badge = "已检测到" if KIMI_AGENT_PATH.is_file() else "未检测到"
    kimi_badge_class = "ok" if KIMI_AGENT_PATH.is_file() else "missing"

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>myteam A2A MVP 验收面板</title>
  <style>
    :root {{
      --bg: #f6f7f9;
      --surface: #ffffff;
      --text: #18202f;
      --muted: #5f6b7a;
      --line: #dce2ea;
      --accent: #0f766e;
      --accent-soft: #def5ef;
      --blue: #275db3;
      --blue-soft: #e8f0ff;
      --warn: #8a5a00;
      --warn-soft: #fff2cf;
      --shadow: 0 16px 44px rgba(24, 32, 47, 0.08);
    }}

    * {{
      box-sizing: border-box;
    }}

    body {{
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
      line-height: 1.6;
    }}

    .shell {{
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0 44px;
    }}

    header {{
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
      gap: 18px;
      margin-bottom: 18px;
    }}

    .panel,
    .agent,
    .status-item,
    .step {{
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }}

    .panel {{
      padding: 22px;
    }}

    h1 {{
      margin: 0 0 10px;
      font-size: 34px;
      line-height: 1.18;
    }}

    h2 {{
      margin: 0 0 14px;
      font-size: 20px;
    }}

    h3 {{
      margin: 0 0 8px;
      font-size: 17px;
    }}

    p {{
      margin: 0;
      color: var(--muted);
    }}

    code {{
      display: block;
      padding: 10px 12px;
      margin-top: 10px;
      overflow-wrap: anywhere;
      border-radius: 6px;
      background: #111827;
      color: #f8fafc;
      font-family: Consolas, "Courier New", monospace;
      font-size: 14px;
    }}

    main {{
      display: grid;
      gap: 18px;
    }}

    .agents {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }}

    .agent {{
      padding: 18px;
      min-height: 180px;
    }}

    .agent-top,
    .status-top {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }}

    .badge {{
      flex: 0 0 auto;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
    }}

    .ok {{
      color: var(--accent);
      background: var(--accent-soft);
    }}

    .missing {{
      color: var(--warn);
      background: var(--warn-soft);
    }}

    .codex {{
      color: var(--blue);
      background: var(--blue-soft);
    }}

    .path {{
      margin-top: 10px;
      color: var(--muted);
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
      overflow-wrap: anywhere;
    }}

    .grid {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }}

    .status-item {{
      padding: 16px;
      min-height: 120px;
    }}

    .status-name {{
      font-weight: 700;
    }}

    .flow {{
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }}

    .step {{
      padding: 14px;
      border-left: 4px solid var(--accent);
      min-height: 120px;
    }}

    .step strong {{
      display: block;
      margin-bottom: 6px;
      color: var(--text);
    }}

    footer {{
      margin-top: 18px;
      color: var(--muted);
      font-size: 14px;
    }}

    @media (max-width: 860px) {{
      header,
      .agents,
      .grid,
      .flow {{
        grid-template-columns: 1fr;
      }}

      h1 {{
        font-size: 28px;
      }}
    }}
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <section class="panel">
        <h1>myteam A2A MVP 验收面板</h1>
        <p>这个页面展示你要做的核心功能：Agent1 Kimi 负责执行，Agent2 Codex 负责总控、审查和自迭代。</p>
      </section>
      <aside class="panel">
        <h2>本地命令</h2>
        <code>python myteam.py status</code>
        <code>python myteam.py ui</code>
      </aside>
    </header>

    <main>
      <section class="panel">
        <h2>双 Agent 角色</h2>
        <div class="agents">
          <article class="agent">
            <div class="agent-top">
              <h3>Agent1：Kimi</h3>
              <span class="badge {kimi_badge_class}">{kimi_badge}</span>
            </div>
            <p>定位：外部执行 Agent。后续适合接收明确的小任务，例如生成草稿、执行命令、补充方案。</p>
            <div class="path">{KIMI_AGENT_PATH}</div>
          </article>
          <article class="agent">
            <div class="agent-top">
              <h3>Agent2：Codex</h3>
              <span class="badge codex">当前对话</span>
            </div>
            <p>定位：总控和审查 Agent。负责拆任务、决定交给谁、检查证据、记录经验，并规划下一轮迭代。</p>
            <div class="path">Codex in this workspace</div>
          </article>
        </div>
      </section>

      <section>
        <h2>骨架状态</h2>
        <div class="grid">
{status_items}
        </div>
      </section>

      <section class="panel">
        <h2>你要做的功能如何运转</h2>
        <div class="flow">
          <div class="step"><strong>1. 用户给目标</strong>例如：低成本搭建一个协作性强的 A2A 工具。</div>
          <div class="step"><strong>2. Codex 拆任务</strong>把目标拆成可执行、可检查的小任务，并写明验收标准。</div>
          <div class="step"><strong>3. Kimi 执行任务</strong>Agent1 接收明确任务，产出结果或执行记录。</div>
          <div class="step"><strong>4. Codex 审查迭代</strong>Agent2 检查证据，更新 lessons、memory 和下一轮 backlog。</div>
        </div>
      </section>
    </main>

    <footer>这是最小可行性 HTML，不依赖前端框架；后续可以扩展成真正的任务面板。</footer>
  </div>
</body>
</html>
"""


def write_ui() -> None:
    """生成最小 HTML 验收界面。"""
    output_path = Path("index.html")
    output_path.write_text(build_ui_html(), encoding="utf-8")
    print("HTML 验收页面已生成：index.html")
    print("你可以打开 D:\\myteam\\index.html 查看 Agent1/Agent2 协作展示。")


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
