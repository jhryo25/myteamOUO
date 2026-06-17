// commandSafety - danger-level classification for shell commands
// Adapted from LobsterAI (commandSafety.ts), enhanced for Windows + cross-platform

const DELETE_PATTERNS = [
  /\brm\b/i, /\brmdir\b/i, /\bunlink\b/i, /\bdel\b/i,
  /\berase\b/i, /\bremove-item\b/i, /\btrash\b/i,
];
const FIND_DELETE = /\bfind\b[\s\S]*\s-delete\b/i;
const GIT_CLEAN = /\bgit\s+clean\b/i;

const RM_RECURSIVE = /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|--recursive)\b/i;
const GIT_FORCE_PUSH = /\bgit\s+push\s+.*(?:--force|-f)\b/i;
const GIT_HARD_RESET = /\bgit\s+reset\s+--hard\b/i;
const DD_CMD = /\bdd\b/i;
const MKFS_CMD = /\bmkfs\b/i;
const FORMAT_CMD = /\bformat\b\s+[a-zA-Z]:/i;

const GIT_PUSH = /\bgit\s+push\b/i;
const KILL_CMD = /\b(kill|killall|pkill|stop-process|taskkill)\b/i;
const CHMOD_CMD = /\b(chmod|chown|icacls|attrib)\b/i;
const REGISTRY_CMD = /\b(reg\s+(add|delete|import)|set-itemproperty|remove-itemproperty)\b/i;

export const DANGER_LEVEL = { SAFE: 'safe', CAUTION: 'caution', DESTRUCTIVE: 'destructive' };

export function getDangerLevel(command) {
  if (RM_RECURSIVE.test(command)) return { level: DANGER_LEVEL.DESTRUCTIVE, reason: 'recursive-delete' };
  if (DD_CMD.test(command)) return { level: DANGER_LEVEL.DESTRUCTIVE, reason: 'disk-overwrite' };
  if (MKFS_CMD.test(command) || FORMAT_CMD.test(command)) return { level: DANGER_LEVEL.DESTRUCTIVE, reason: 'disk-format' };
  if (GIT_FORCE_PUSH.test(command)) return { level: DANGER_LEVEL.DESTRUCTIVE, reason: 'git-force-push' };
  if (GIT_HARD_RESET.test(command)) return { level: DANGER_LEVEL.DESTRUCTIVE, reason: 'git-reset-hard' };
  if (REGISTRY_CMD.test(command)) return { level: DANGER_LEVEL.CAUTION, reason: 'registry-modify' };

  if (isDeleteCommand(command)) return { level: DANGER_LEVEL.CAUTION, reason: 'file-delete' };
  if (GIT_PUSH.test(command)) return { level: DANGER_LEVEL.CAUTION, reason: 'git-push' };
  if (KILL_CMD.test(command)) return { level: DANGER_LEVEL.CAUTION, reason: 'process-kill' };
  if (CHMOD_CMD.test(command)) return { level: DANGER_LEVEL.CAUTION, reason: 'permission-change' };

  return { level: DANGER_LEVEL.SAFE, reason: '' };
}

export function isDeleteCommand(command) {
  return DELETE_PATTERNS.some(r => r.test(command))
    || FIND_DELETE.test(command)
    || GIT_CLEAN.test(command);
}

export function isDangerousCommand(command) {
  return getDangerLevel(command).level !== DANGER_LEVEL.SAFE;
}
