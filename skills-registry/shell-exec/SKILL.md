---
name: shell-exec
category: system
load: progressive
triggers:
  - execute command
  - run script
  - shell
  - powershell
  - cmd
  - system operation
mounts:
  controller: false
  worker: true
  reviewer: false
  codex: true
  claude: false
  kimi: true
---

# Shell Exec

Execute local shell commands with explicit safety review and streamed stdout/stderr.

## Use When

- A task requires checking the local environment, running a script, or verifying generated files.
- The command result is needed as evidence for completion.

## Rules

- Classify destructive or state-changing commands before execution.
- Ask for confirmation before destructive, delete, force-push, permission, registry, or process-kill commands.
- Capture stdout, stderr, exit code, and the exact command.
- Prefer narrow commands that operate in the current workspace.

## Evidence Template

```
command: <exact command>
exit: <exit code>
stdout: <important lines>
stderr: <important lines or empty>
```
