# myteam A2A Handover (2026-06-17)

## This Round (2026-06-17)

### Shell Command Execution (aligned with LobsterAI commandSafety)
- Added commandSafety.mjs: danger-level classification (safe / caution / destructive)
- Added POST /api/shell/exec, POST /api/shell/exec-confirm, GET /api/shell/stream endpoints
- executeShell(): spawn(powershell) with stdout/stderr/exitCode capture, 30s timeout
- Frontend: Shell button in topbar -> prompt -> dangerous command confirm modal -> SSE live terminal output
- Registered skill: shell-exec in skills-registry/index.json

### Skills Management Page (aligned with LobsterAI SkillsView)
- Topbar Skills button -> 3 Tabs: Installed / Market / Import
- Installed: toggle enable/disable, uninstall, mount tags
- Market: source switch (myteam-official / clowder-ai), search, one-click install
- Import: GitHub URL (git clone + auto-find SKILL.md), remote ZIP, local path
- New endpoint: POST /api/skills/install-source for multi-source install
- Helper functions: extractZip, parseGithubUrl, cloneAndFindSkillMd, findSkillMdInDir

### Subagent Session View (aligned with LobsterAI SubagentSessionDetail)
- A2A chain tasks show a 🔍 button, click to open independent conversation view
- worklist-chain SSE events show clickable links
- Backend: chainTaskMessages Map + pushChainMessage/getChainMessages
- GET /api/chain-task/messages?taskId= + GET /api/chain-task/stream?taskId= (SSE)
- executeTask pushes task-start/done/failed messages when depth > 0

### Agent HTML Output Auto-Save
- extractArtifacts saves HTML artifacts to .myteam/outputs/ directory
- GET /api/outputs lists generated files
- GET /api/outputs/file?name= serves raw HTML (Content-Type: text/html)

### Streaming UX Improvements
- scrollChat() changed to sticky mode (auto-scroll only if within 120px of bottom)
- Typewriter tick removed forced scrollChat() call
- streamRender JSON detection added s.length < 200 threshold to prevent flickering
- Thinking panel: auto-expand only on first chunk (data-auto-expanded flag), respects user collapse
- updateAgentStatus now only updates span textContent, no more innerHTML replace
- patchTask(in_progress) now runs BEFORE sseSend(task-start) to prevent refresh race

### Refresh Resilience
- restoreRunningState checks both /api/running and tasks.jsonl
- in_progress tasks restored from file
- Pending tasks in same run as done tasks also shown as "running"
- loadHistory added hideWelcome() for correct conversation history display

### New Files
| File | Description |
|---|---|
| commandSafety.mjs | Shell command danger-level classification |
| .myteam/skills/shell-exec/SKILL.md | shell-exec skill definition |

### Modified Files
| File | Changes |
|---|---|
| server.mjs | Multi-source skill install, shell endpoints, chain-task API, HTML output save, executeShell |
| web/app.html | Skills/Shell buttons, Skills view, Subagent view, Shell confirm modal |
| web/app.js | Skills/Subagent/Shell modules, scroll optimize, thinking panel, refresh restore |
| web/app.css | All new module styles |
| skills-registry/index.json | Registered shell-exec skill |

### Architecture Decisions
- Multi-source install uses separate /api/skills/install-source endpoint, original /api/skills/install untouched
- Shell execution does NOT abort on SSE close — processes continue after page refresh
- Chain task messages stored in chainTaskMessages Map (memory only, not persisted to disk)
- web/app.js apply_patch is sensitive to Chinese characters — prefer direct editing for future changes

