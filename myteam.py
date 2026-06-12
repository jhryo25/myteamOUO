# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path


PROJECT_DIR = Path(".myteam")
RUNS_DIR = PROJECT_DIR / "runs"
ENV_FILE = Path(".env")


def load_env_file(path: Path) -> dict[str, str]:
    """读取 .env 文件，返回键值对。文件不存在或行格式不对时静默忽略。"""
    data: dict[str, str] = {}
    if not path.is_file():
        return data
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


_ENV = load_env_file(ENV_FILE)


def get_agent_path(env_key: str) -> Path | None:
    """从 .env 或系统环境变量读取 agent 路径，未配置时返回 None。"""
    raw = _ENV.get(env_key) or os.environ.get(env_key) or ""
    return Path(raw) if raw else None


KIMI_AGENT_PATH = get_agent_path("KIMI_PATH")
CLAUDE_AGENT_PATH = get_agent_path("CLAUDE_PATH")
CODEX_AGENT_PATH = get_agent_path("CODEX_PATH")


def mask_path_for_display(path: Path | None) -> str:
    """对外展示时遮蔽用户名等敏感片段，避免 HTML 暴露真实路径。"""
    if not path:
        return "（未配置，请在 .env 中填入）"
    text = str(path)
    home = os.path.expanduser("~")
    if home and text.startswith(home):
        text = text.replace(home, "~", 1)
    # 进一步遮蔽 Users\xxx
    parts = Path(text).parts
    masked = []
    skip_next = False
    for part in parts:
        if skip_next:
            masked.append("***")
            skip_next = False
            continue
        masked.append(part)
        if part.lower() in ("users", "用户"):
            skip_next = True
    return str(Path(*masked)) if masked else text


AGENTS_TEMPLATE = """# myteam 默认 agent 配置
# 真实路径从 .env 读取，不提交到 git。
agents:
  agent1_kimi:
    role: "Agent1：Kimi 执行 Agent"
    command_env: "KIMI_PATH"
    description: "本地 Kimi CLI，可执行被分配的小任务。"
  agent2_claude:
    role: "Agent2：Claude 主架构 Agent"
    command_env: "CLAUDE_PATH"
    description: "Claude CLI，负责深度分析、架构设计、复杂代码生成。"
  agent3_codex:
    role: "Agent3：Codex 总控/审查 Agent"
    command_env: "CODEX_PATH"
    description: "Codex CLI，负责拆任务、审查、记录经验、规划下一轮迭代。"
workflow:
  - "用户提出目标"
  - "Agent3 Codex 拆分任务和验收标准"
  - "Agent2 Claude 负责复杂实现，Agent1 Kimi 负责轻量执行"
  - "Agent3 Codex 审查输出并生成下一步"
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

## 当前 Agent 阵容

- Agent1：Kimi（轻量执行）
- Agent2：Claude（主架构 / 深度实现）
- Agent3：Codex（总控 / 审查 / 自迭代）

## 配置 CLI 路径

复制 `.env.example` 为 `.env`，填入本机真实路径。`.env` 不会被提交到 git。

## 怎么运行

```powershell
python myteam.py init
python myteam.py status
python myteam.py ui
```
"""


def write_file_if_missing(path: Path, content: str) -> bool:
    if path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def path_exists(path, is_dir: bool = False) -> bool:
    if not path:
        return False
    return path.is_dir() if is_dir else path.is_file()


def init_project() -> None:
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


def check_agent(env_key: str, label: str, path) -> bool:
    """检查 agent CLI 是否存在，控制台输出遮蔽后的路径。"""
    if not path:
        print(f"[未配置] {label}: 请在 .env 中设置 {env_key}")
        return False
    exists = path.is_file()
    mark = "OK" if exists else "缺失"
    print(f"[{mark}] {label}: {mask_path_for_display(path)}")
    return exists


def check_path(path: Path, label: str, is_dir: bool = False) -> bool:
    exists = path_exists(path, is_dir=is_dir)
    mark = "OK" if exists else "缺失"
    print(f"[{mark}] {label}: {path}")
    return exists


def show_status() -> None:
    print("myteam 当前状态：\n")

    checks = [
        check_path(PROJECT_DIR, "协作目录", is_dir=True),
        check_path(PROJECT_DIR / "agents.yaml", "agent 配置"),
        check_path(PROJECT_DIR / "tasks.jsonl", "任务记录"),
        check_path(PROJECT_DIR / "lessons.jsonl", "踩坑记录"),
        check_path(PROJECT_DIR / "memory.md", "长期记忆"),
        check_path(RUNS_DIR, "运行记录目录", is_dir=True),
        check_agent("KIMI_PATH", "Agent1 Kimi", KIMI_AGENT_PATH),
        check_agent("CLAUDE_PATH", "Agent2 Claude", CLAUDE_AGENT_PATH),
        check_agent("CODEX_PATH", "Agent3 Codex", CODEX_AGENT_PATH),
    ]

    print("\nAgent 分工：")
    print("- Agent1 Kimi：本地轻量执行 CLI。")
    print("- Agent2 Claude：主架构、深度实现 CLI。")
    print("- Agent3 Codex：总控、审查、自迭代 CLI。")

    if all(checks):
        print("\n状态正常：myteam 已准备好展示三 Agent A2A 协作 MVP。")
    else:
        print("\n状态不完整：请先运行 `python myteam.py init`，并在 .env 中配置 CLI 路径。")


def build_status_item(path: Path, label: str, description: str, is_dir: bool = False) -> str:
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


def build_agent_card(
    name: str,
    role: str,
    description: str,
    path,
    accent_var: str = "--accent",
    badge_class_when_active: str = "ok",
) -> str:
    """生成 agent 卡片，左侧色条区分身份，路径展示脱敏。"""
    if not path:
        badge_class = "unset"
        badge_text = "未配置"
        display_path = f"— 在 .env 中填入对应路径"
    elif path.is_file():
        badge_class = badge_class_when_active
        badge_text = "已检测到"
        display_path = mask_path_for_display(path)
    else:
        badge_class = "unset"
        badge_text = "未检测到"
        display_path = mask_path_for_display(path)

    return f"""          <article class="agent" style="border-left:4px solid var({accent_var});">
            <div class="agent-top">
              <h3>{name}</h3>
              <span class="badge {badge_class}">{badge_text}</span>
            </div>
            <span class="role-tag" style="background:color-mix(in srgb,var({accent_var}) 12%,#fff);color:var({accent_var});">{role}</span>
            <p>{description}</p>
            <div class="path">{display_path}</div>
          </article>"""


_STATUS_BADGE = {
    "pending":     ("⏳ 待执行", "badge-pending"),
    "in_progress": ("🔄 进行中", "badge-progress"),
    "done":        ("✅ 完成",   "badge-done"),
    "failed":      ("❌ 失败",   "badge-failed"),
}


def _build_tasks_section() -> str:
    """读取 tasks.jsonl，生成任务列表 HTML。文件空或不存在时返回提示块。"""
    tasks_file = PROJECT_DIR / "tasks.jsonl"
    if not tasks_file.is_file() or not tasks_file.stat().st_size:
        return """      <section>
        <h2 class="section-title">任务列表</h2>
        <div class="tasks-empty">暂无任务 &mdash; 运行 <code class="inline-code">python myteam.py plan "你的目标"</code> 生成第一批任务</div>
      </section>"""

    records = []
    for line in tasks_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    if not records:
        return """      <section>
        <h2 class="section-title">任务列表</h2>
        <div class="tasks-empty">tasks.jsonl 内容无法解析</div>
      </section>"""

    # 按 run_id 分组
    runs: dict[str, list] = {}
    for r in records:
        rid = r.get("run_id", "unknown")
        runs.setdefault(rid, []).append(r)

    html_parts = ['      <section>', '        <h2 class="section-title">任务列表</h2>']
    for rid, items in runs.items():
        goal = items[0].get("goal", rid)
        created = items[0].get("created_at", "")[:16].replace("T", " ")
        html_parts.append(f'        <div class="run-group">')
        html_parts.append(f'          <div class="run-header"><span class="run-goal">{goal}</span><span class="run-meta">{created} UTC · {len(items)} 个任务</span></div>')
        html_parts.append(f'          <div class="task-list">')
        for task in items:
            status = task.get("status", "pending")
            badge_text, badge_cls = _STATUS_BADGE.get(status, (status, "badge-pending"))
            steps_html = "".join(f"<li>{s}</li>" for s in task.get("steps", []))
            accept = task.get("accept", "")
            accept_html = f'<div class="task-accept">✓ {accept}</div>' if accept else ""
            # 推荐 agent / 实际执行者
            agent_hint = task.get("executed_by") or task.get("agent", "")
            agent_html = f'<span class="task-agent">{agent_hint}</span>' if agent_hint else ""
            # 执行结果折叠
            result = task.get("result", "")
            error  = task.get("error", "")
            result_html = ""
            if result:
                preview = result[:120].replace("<", "&lt;").replace(">", "&gt;")
                full    = result.replace("<", "&lt;").replace(">", "&gt;")
                result_html = f'<details class="task-result"><summary>查看结果（前 120 字）…</summary><pre>{full}</pre></details>'
            elif error:
                result_html = f'<div class="task-error">✗ {error}</div>'
            html_parts.append(f"""            <div class="task-card">
              <div class="task-top">
                <span class="task-title">{task.get('title','')}</span>
                <div class="task-meta">{agent_html}<span class="badge {badge_cls}">{badge_text}</span></div>
              </div>
              {"<ul class='task-steps'>" + steps_html + "</ul>" if steps_html else ""}
              {accept_html}
              {result_html}
            </div>""")
        html_parts.append('          </div>')
        html_parts.append('        </div>')
    html_parts.append('      </section>')
    return "\n".join(html_parts)


def build_ui_html() -> str:
    status_items = "\n".join(
        [
            build_status_item(PROJECT_DIR, "协作目录", "保存 myteam 的协作数据。", is_dir=True),
            build_status_item(PROJECT_DIR / "agents.yaml", "agent 配置", "登记三个 Agent 的角色与配置。"),
            build_status_item(PROJECT_DIR / "tasks.jsonl", "任务记录", "保存每个任务的输入、状态和输出。"),
            build_status_item(PROJECT_DIR / "lessons.jsonl", "踩坑记录", "保存失败原因和修复经验。"),
            build_status_item(PROJECT_DIR / "memory.md", "长期记忆", "保存确认有效的长期经验。"),
            build_status_item(ENV_FILE, ".env 配置", "本机 CLI 路径配置（不入库）。"),
        ]
    )

    agent_cards = "\n".join(
        [
            build_agent_card(
                "Agent1：Kimi",
                "轻量执行 Agent",
                "适合接收明确的小任务：草稿、命令执行、内容补充。",
                KIMI_AGENT_PATH,
                "--accent",
                "ok",
            ),
            build_agent_card(
                "Agent2：Claude",
                "主架构 / 深度实现 Agent",
                "负责深度分析、架构设计、复杂代码生成。",
                CLAUDE_AGENT_PATH,
                "--purple",
                "claude",
            ),
            build_agent_card(
                "Agent3：Codex",
                "总控 / 审查 / 自迭代 Agent",
                "负责拆任务、决定派工、审查证据、记录经验、规划下一轮。",
                CODEX_AGENT_PATH,
                "--blue",
                "codex",
            ),
        ]
    )

    tasks_section = _build_tasks_section()

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>myteam A2A MVP 验收面板</title>
  <style>
    :root {{
      --bg: #f0f2f5;
      --surface: #ffffff;
      --text: #18202f;
      --muted: #5f6b7a;
      --line: #dce2ea;
      --accent: #0f766e;
      --accent-soft: #d1faf3;
      --blue: #1d4ed8;
      --blue-soft: #dbeafe;
      --purple: #7c3aed;
      --purple-soft: #ede9fe;
      --gray: #64748b;
      --gray-soft: #f1f5f9;
      --warn: #92400e;
      --warn-soft: #fef3c7;
      --shadow: 0 2px 8px rgba(24,32,47,.07), 0 8px 24px rgba(24,32,47,.05);
    }}

    * {{ box-sizing: border-box; margin: 0; padding: 0; }}

    body {{
      background: var(--bg);
      color: var(--text);
      font-family: "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
      line-height: 1.6;
    }}

    .shell {{
      width: min(1160px, calc(100% - 32px));
      margin: 0 auto;
      padding: 36px 0 52px;
    }}

    /* ── header ── */
    header {{
      display: grid;
      grid-template-columns: 1fr 260px;
      gap: 16px;
      margin-bottom: 24px;
    }}

    .panel {{
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: var(--shadow);
      padding: 24px;
    }}

    h1 {{
      font-size: 28px;
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: 8px;
      color: var(--text);
    }}

    .subtitle {{ color: var(--muted); font-size: 14px; }}
    .subtitle + .subtitle {{ margin-top: 4px; }}

    .env-tag {{
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      background: #e2e8f0;
      color: #334155;
      font-family: Consolas, monospace;
      font-size: 12px;
      vertical-align: middle;
    }}

    /* ── cmd panel ── */
    .cmd-panel h2 {{
      font-size: 15px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .05em;
      margin-bottom: 10px;
    }}

    code {{
      display: block;
      padding: 9px 12px;
      border-radius: 6px;
      background: #0f172a;
      color: #e2e8f0;
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
      overflow-wrap: anywhere;
    }}

    code + code {{ margin-top: 8px; }}

    /* ── main grid ── */
    main {{ display: grid; gap: 24px; }}

    /* ── section header ── */
    .section-title {{
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 14px;
    }}

    /* ── agents ── */
    .agents {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0,1fr));
      gap: 14px;
    }}

    .agent {{
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: var(--shadow);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 210px;
    }}

    .agent-top {{
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }}

    .agent-top h3 {{
      font-size: 16px;
      font-weight: 700;
      line-height: 1.3;
      color: var(--text);
    }}

    .badge {{
      flex: 0 0 auto;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }}

    .ok      {{ color: var(--accent); background: var(--accent-soft); }}
    .claude  {{ color: var(--purple); background: var(--purple-soft); }}
    .codex   {{ color: var(--blue);   background: var(--blue-soft);   }}
    .unset   {{ color: var(--gray);   background: var(--gray-soft);   }}

    .role-tag {{
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      width: fit-content;
    }}

    .agent p {{
      color: var(--muted);
      font-size: 14px;
      flex: 1;
    }}

    .path {{
      font-family: Consolas, "Courier New", monospace;
      font-size: 12px;
      color: #94a3b8;
      overflow-wrap: anywhere;
      word-break: break-all;
    }}

    .notice {{
      margin-top: 4px;
      padding: 8px 14px;
      border-radius: 6px;
      background: var(--gray-soft);
      color: var(--gray);
      font-size: 13px;
    }}

    /* ── status grid ── */
    .grid {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0,1fr));
      gap: 12px;
    }}

    .status-item {{
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: var(--shadow);
      padding: 16px;
      min-height: 110px;
    }}

    .status-top {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }}

    .status-name {{
      font-weight: 700;
      font-size: 14px;
    }}

    .status-item p {{
      color: var(--muted);
      font-size: 13px;
    }}

    .status-item .path {{
      margin-top: 8px;
    }}

    /* ── flow ── */
    .flow {{
      display: grid;
      grid-template-columns: repeat(4, minmax(0,1fr));
      gap: 12px;
    }}

    .step {{
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: var(--shadow);
      padding: 16px;
      border-left: 4px solid var(--accent);
      min-height: 110px;
    }}

    .step strong {{
      display: block;
      font-size: 14px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 6px;
    }}

    .step p {{
      color: var(--muted);
      font-size: 13px;
    }}

    footer {{
      margin-top: 20px;
      color: #94a3b8;
      font-size: 13px;
      text-align: center;
    }}

    @media (max-width: 900px) {{
      header {{ grid-template-columns: 1fr; }}
      .agents {{ grid-template-columns: repeat(2, minmax(0,1fr)); }}
      .grid, .flow {{ grid-template-columns: repeat(2, minmax(0,1fr)); }}
    }}

    @media (max-width: 560px) {{
      .agents, .grid, .flow {{ grid-template-columns: 1fr; }}
      h1 {{ font-size: 22px; }}
    }}

    /* ── tasks ── */
    .run-group {{
      margin-bottom: 16px;
    }}

    .run-header {{
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      padding: 8px 14px;
      background: var(--gray-soft);
      border-radius: 8px 8px 0 0;
      border: 1px solid var(--line);
      border-bottom: none;
    }}

    .run-goal {{
      font-weight: 700;
      font-size: 14px;
      color: var(--text);
    }}

    .run-meta {{
      font-size: 12px;
      color: var(--muted);
      white-space: nowrap;
    }}

    .task-list {{
      border: 1px solid var(--line);
      border-radius: 0 0 8px 8px;
      overflow: hidden;
    }}

    .task-card {{
      background: var(--surface);
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
    }}

    .task-card:last-child {{
      border-bottom: none;
    }}

    .task-top {{
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 6px;
    }}

    .task-title {{
      font-weight: 600;
      font-size: 14px;
      color: var(--text);
    }}

    .task-meta {{
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }}

    .task-agent {{
      font-size: 11px;
      color: var(--muted);
      background: var(--gray-soft);
      padding: 2px 7px;
      border-radius: 999px;
    }}

    .task-steps {{
      margin: 4px 0 6px 18px;
      color: var(--muted);
      font-size: 13px;
    }}

    .task-steps li {{ margin-bottom: 2px; }}

    .task-accept {{
      font-size: 12px;
      color: var(--accent);
      margin-top: 4px;
    }}

    .tasks-empty {{
      padding: 20px 16px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--muted);
      font-size: 14px;
    }}

    .task-result {{
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
    }}

    .task-result summary {{
      cursor: pointer;
      color: var(--blue);
      font-size: 13px;
    }}

    .task-result pre {{
      margin-top: 6px;
      padding: 10px;
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 6px;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-all;
      overflow: auto;
      max-height: 300px;
    }}

    .task-error {{
      margin-top: 6px;
      font-size: 13px;
      color: #991b1b;
    }}

    .inline-code {{
      display: inline;
      padding: 2px 6px;
      background: #e2e8f0;
      color: #334155;
      border-radius: 4px;
      font-family: Consolas, monospace;
      font-size: 13px;
    }}

    .badge-pending  {{ color: #92400e; background: #fef3c7; }}
    .badge-progress {{ color: var(--blue);   background: var(--blue-soft); }}
    .badge-done     {{ color: var(--accent); background: var(--accent-soft); }}
    .badge-failed   {{ color: #991b1b; background: #fee2e2; }}
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <section class="panel">
        <h1>myteam A2A MVP 验收面板</h1>
        <p class="subtitle">三 Agent 协作：Kimi 轻量执行 · Claude 深度实现 · Codex 总控审查</p>
        <p class="subtitle">真实 CLI 路径仅在本机 <span class="env-tag">.env</span> 中读取，不会写入 GitHub</p>
      </section>
      <aside class="panel cmd-panel">
        <h2>本地命令</h2>
        <code>python myteam.py status</code>
        <code>python myteam.py ui</code>
      </aside>
    </header>

    <main>
      <section>
        <h2 class="section-title">三 Agent 角色</h2>
        <div class="agents">
{agent_cards}
        </div>
        <div class="notice">路径已脱敏 · 原始路径仅存于本机 .env · 不会进入 git 历史</div>
      </section>

      <section>
        <h2 class="section-title">骨架状态</h2>
        <div class="grid">
{status_items}
        </div>
      </section>

{tasks_section}

      <section class="panel">
        <h2 class="section-title">A2A 协作流程</h2>
        <div class="flow">
          <div class="step"><strong>1. 用户给目标</strong><p>例如：搭建一个低成本 A2A 协作工具。</p></div>
          <div class="step"><strong>2. Codex 拆任务</strong><p>拆成可执行、可检查的小任务，写明验收标准。</p></div>
          <div class="step"><strong>3. Claude / Kimi 执行</strong><p>Claude 负责复杂实现，Kimi 负责轻量执行。</p></div>
          <div class="step"><strong>4. Codex 审查迭代</strong><p>检查证据，更新 lessons、memory 和下一轮 backlog。</p></div>
        </div>
      </section>
    </main>

    <footer>MVP 验收页 · 不依赖前端框架 · 后续扩展为真正的任务面板</footer>
  </div>
</body>
</html>
"""


def run_plan(goal: str, agent_key: str = "codex") -> None:
    """委托 plan.mjs 执行，保持 Python CLI 入口统一。"""
    plan_script = Path(__file__).parent / "plan.mjs"
    if not plan_script.is_file():
        print("找不到 plan.mjs，请确认文件存在。")
        return
    cmd = ["node", str(plan_script), goal, "--agent", agent_key]
    try:
        subprocess.run(cmd, check=False)
    except FileNotFoundError:
        print("找不到 node 命令，请先安装 Node.js (v18+)。")


def run_dispatch(run_id: str = "", task_id: str = "", agent_key: str = "") -> None:
    """委托 dispatch.mjs 执行 pending 任务。"""
    dispatch_script = Path(__file__).parent / "dispatch.mjs"
    if not dispatch_script.is_file():
        print("找不到 dispatch.mjs，请确认文件存在。")
        return
    cmd = ["node", str(dispatch_script)]
    if run_id:
        cmd += ["--run-id", run_id]
    if task_id:
        cmd += ["--task-id", task_id]
    if agent_key:
        cmd += ["--agent", agent_key]
    try:
        subprocess.run(cmd, check=False)
    except FileNotFoundError:
        print("找不到 node 命令，请先安装 Node.js (v18+)。")


def run_serve(port: int = 7878) -> None:
    """启动 server.mjs，自动打开浏览器。"""
    import threading, webbrowser, time
    server_script = Path(__file__).parent / "server.mjs"
    if not server_script.is_file():
        print("找不到 server.mjs，请确认文件存在。")
        return
    url = f"http://localhost:{port}"
    print(f"启动 myteam 控制台 → {url}")
    print("按 Ctrl+C 停止服务\n")
    def open_browser():
        time.sleep(1.2)
        webbrowser.open(url)
    threading.Thread(target=open_browser, daemon=True).start()
    try:
        subprocess.run(["node", str(server_script), "--port", str(port)], check=False)
    except FileNotFoundError:
        print("找不到 node 命令，请先安装 Node.js (v18+)。")
    except KeyboardInterrupt:
        print("\n服务已停止。")


def write_ui() -> None:
    output_path = Path("index.html")
    output_path.write_text(build_ui_html(), encoding="utf-8")
    print("HTML 验收页面已生成：index.html")
    print("打开 index.html 即可查看三 Agent 协作展示。")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="myteam",
        description="myteam：轻量 A2A 协作工具 MVP。",
    )
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("init", help="初始化 .myteam 协作目录")
    subparsers.add_parser("status", help="查看 myteam 当前状态")
    subparsers.add_parser("ui", help="生成最小 HTML 验收页面")

    plan_parser = subparsers.add_parser("plan", help="调用 agent 把目标拆成任务列表")
    plan_parser.add_argument("goal", help="要拆解的目标描述")
    plan_parser.add_argument(
        "--agent", default="codex", choices=["codex", "claude"],
        help="调用哪个 agent（默认 codex）",
    )

    dispatch_parser = subparsers.add_parser("dispatch", help="执行 tasks.jsonl 中的 pending 任务")
    dispatch_parser.add_argument("--run-id", default="", help="只执行指定 run_id 的任务")
    dispatch_parser.add_argument("--task-id", default="", help="只执行指定 task_id")
    dispatch_parser.add_argument(
        "--agent", default="", choices=["", "codex", "claude"],
        help="覆盖任务的 agent 字段",
    )

    serve_parser = subparsers.add_parser("serve", help="启动交互控制台（默认 http://localhost:7878）")
    serve_parser.add_argument("--port", type=int, default=7878, help="监听端口（默认 7878）")

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
    elif args.command == "plan":
        run_plan(args.goal, args.agent)
    elif args.command == "dispatch":
        run_dispatch(
            run_id=getattr(args, "run_id", ""),
            task_id=getattr(args, "task_id", ""),
            agent_key=getattr(args, "agent", ""),
        )
    elif args.command == "serve":
        run_serve(port=getattr(args, "port", 7878))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
