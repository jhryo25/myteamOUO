// commandSafety - danger-level classification for shell commands
// Adapted from LobsterAI (commandSafety.ts), enhanced for Windows + cross-platform

import { existsSync, realpathSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function normalizeLocalFileInput(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('缺少文件路径');
  if (value.toLowerCase().startsWith('file://')) {
    try { return fileURLToPath(value); }
    catch { throw new Error('无效的 file:// 路径'); }
  }
  return value;
}

export function resolveWorkspaceHtmlPath(workspace, input, denylist = []) {
  const root = realpathSync(resolve(workspace || '.'));
  const normalized = normalizeLocalFileInput(input);
  const candidate = isAbsolute(normalized) ? resolve(normalized) : resolve(root, normalized.replace(/^[/\\]+/, ''));
  if (!existsSync(candidate)) throw new Error('HTML 文件不存在');
  const real = realpathSync(candidate);
  const rel = relative(root, real);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('HTML 文件不在当前工作区内');
  const segments = rel.toLowerCase().split(/[\\/]+/);
  if (denylist.some(item => segments.includes(String(item).toLowerCase()))) throw new Error('HTML 文件位于禁止访问的目录');
  if (!statSync(real).isFile()) throw new Error('目标不是文件');
  if (!['.html', '.htm'].includes(extname(real).toLowerCase())) throw new Error('仅支持打开 HTML 文件');
  return { abs: real, rel: rel.replace(/\\/g, '/') };
}

export function openPathWithDefaultApp(filePath, options = {}) {
  const platform = options.platform || process.platform;
  const spawnImpl = options.spawnImpl || spawn;
  const [command, args] = platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', filePath]]
    : platform === 'darwin' ? ['open', [filePath]] : ['xdg-open', [filePath]];
  const child = spawnImpl(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref?.();
  return { command, args };
}
