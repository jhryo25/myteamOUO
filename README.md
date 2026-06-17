# myteamOUO

Lightweight local-first A2A (Agent-to-Agent) collaboration cockpit. No cloud, no database, no complex framework — just agents, tasks, review gates, and lessons, all from your local terminal.

Based on [clowder-ai](https://github.com/zts212653/clowder-ai) architecture, inspired by [LobsterAI](https://github.com/netease-youdao/LobsterAI).

## Quick Start

```bash
git clone https://github.com/jhryo25/myteamOUO.git
cd myteamOUO
# configure .env with agent CLI paths
cp .env.example .env
# start the server
node server.mjs --port 7878
```

Open http://localhost:7878 in browser.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Browser (localhost:7878)              │
│  Chat | Tasks | Skills | Shell | Artifacts | Sessions  │
├─────────────────────────────────────────────────────────┤
│                   server.mjs (HTTP + SSE)               │
│  agent-utils.mjs (spawn, stream, parse)                │
│  commandSafety.mjs (shell danger classification)       │
├─────────────────────────────────────────────────────────┤
│  codex CLI     │  claude CLI    │  kimi CLI            │
│  (stdin mode)  │  (stdin mode)  │  (arg mode)          │
└─────────────────────────────────────────────────────────┘
```

## Features

### Multi-Agent Collaboration
- Define agents with role cards, personalities, strengths, and restrictions
- `@codex`, `@claude`, `@kimi` mention routing in chat
- Plan mode: goal decomposition into verifiable subtasks (3-7 items)
- Auto-review gate after each task execution
- Cross-model A2A chain: agent output `@mentions` trigger follow-up tasks

### Skills Marketplace
- Installed / Market / Import tabbed management UI
- Multi-source install: GitHub URL (auto clone + find SKILL.md), remote ZIP, local path
- Toggle enable/disable, uninstall, mount configuration per skill
- Skill routing: context-aware skill injection into agent prompts
- Registered skills: task-planning, cli-execution, review-gate, lesson-capture, html-ui-alignment, shell-exec

### Shell Command Execution
- Execute PowerShell/cmd commands directly from the UI
- Three-tier danger classification: safe / caution / destructive
- Destructive commands trigger a confirmation modal
- Live SSE streaming of stdout + stderr with exit code display
- Commands survive page refresh (no abort on SSE disconnect)

### Streaming Chat UX
- Typewriter effect with markdown streaming
- Collapsible thinking panel (auto-expand on first chunk, respects user toggle)
- Sticky scroll: auto-scroll only when user is near the bottom
- Structured content detection with smart flicker prevention
- @mention hints, image attachments, session history

### Subagent Session View
- A2A chain tasks show a 🔍 button to open independent conversation views
- Real-time SSE streaming of subagent progress (task-start/done/failed)
- Auto-polling (3s interval) with message deduplication
- Clickable subagent links in chat from worklist-chain events

### Artifacts & Outputs
- Auto-extract code blocks, HTML, JSON, markdown from agent output
- HTML artifacts automatically saved to `.myteam/outputs/` as real files
- `GET /api/outputs/file?name=` serves HTML with correct Content-Type
- Artifacts panel with preview, copy, and open-in-browser

### Refresh Resilience
- `in_progress` tasks restored from `tasks.jsonl` after page refresh
- Pending tasks in same run as completed tasks shown as running
- `patchTask(in_progress)` runs before SSE stream starts to prevent race
- Session history persisted in `.myteam/memory.json`

## Configuration

Edit `.env` to set agent CLI paths:

```env
CODEX_PATH=C:\path\to\codex.exe
CLAUDE_PATH=C:\path\to\claude.exe
KIMI_PATH=C:\path\to\kimi.exe
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Agent connection status |
| GET | `/api/tasks` | List all tasks |
| POST | `/api/plan` | Plan goal decomposition (SSE) |
| POST | `/api/dispatch` | Execute pending tasks (SSE) |
| GET | `/api/history` | Chat conversation history |
| GET | `/api/sessions` | Session list |
| GET | `/api/skills` | Installed skills with routing |
| POST | `/api/skills/install` | Install from market source |
| POST | `/api/skills/install-source` | Install from GitHub/URL/local |
| POST | `/api/shell/exec` | Execute shell command |
| POST | `/api/shell/exec-confirm` | Confirm dangerous command |
| GET | `/api/shell/stream` | Shell output SSE stream |
| GET | `/api/chain-task/messages` | Subagent conversation messages |
| GET | `/api/chain-task/stream` | Subagent SSE stream |
| GET | `/api/outputs` | List generated HTML files |
| GET | `/api/outputs/file` | Serve generated HTML |
| GET | `/api/running` | Active child processes |
| POST | `/api/abort` | Stop all running processes |
| GET | `/api/artifacts` | Chat-extracted artifacts |

## File Structure

```
myteamOUO/
├── server.mjs              # HTTP server + all API endpoints
├── agent-utils.mjs         # Agent spawn, stream, parse utilities
├── commandSafety.mjs       # Shell command danger classification
├── plan.mjs                # CLI: goal decomposition
├── dispatch.mjs            # CLI: task execution
├── web/
│   ├── app.html            # Single-page app shell
│   ├── app.js              # All frontend logic
│   └── app.css             # All styles
├── skills-registry/
│   └── index.json          # Official skill marketplace index
├── .myteam/                # Local workspace (gitignored)
│   ├── tasks.jsonl         # Task persistence
│   ├── memory.json         # Session/chat persistence
│   ├── lessons.jsonl       # Failure lessons
│   ├── skills/             # Installed skill SKILL.md files
│   └── outputs/            # Auto-saved HTML files
└── .env                    # Agent CLI configuration
```

## Credits

Inspired by and aligned with:
- [clowder-ai](https://github.com/zts212653/clowder-ai) — A2A architecture, skill manifest, cross-model review
- [LobsterAI](https://github.com/netease-youdao/LobsterAI) — Skill marketplace UI, subagent tracking, command safety