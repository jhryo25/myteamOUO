// 结构化日志模块 — 统一日志格式和级别
// TypeScript 版本，替换 console.log / console.error

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
type LogMeta = Record<string, unknown>;

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3, silent: 4,
};

let currentLevel: LogLevel =
  (process.env.MYTEAM_LOG_LEVEL as LogLevel) || 'info';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  green: '\x1b[32m',
} as const;

function timestamp(): string {
  return new Date().toISOString();
}

function format(level: LogLevel, message: string | LogMeta, meta: LogMeta = {}): string {
  const base = { t: timestamp(), level };
  if (message && typeof message === 'object') {
    return JSON.stringify({ ...base, ...message });
  }
  if (Object.keys(meta).length) {
    return JSON.stringify({ ...base, msg: String(message), ...meta });
  }
  return JSON.stringify({ ...base, msg: String(message) });
}

function colorize(level: LogLevel, label: string): string {
  if (process.env.NO_COLOR) return label;
  switch (level) {
    case 'error': return `${colors.red}${label}${colors.reset}`;
    case 'warn':  return `${colors.yellow}${label}${colors.reset}`;
    case 'debug': return `${colors.gray}${label}${colors.reset}`;
    default:      return `${colors.green}${label}${colors.reset}`;
  }
}

function shouldLog(level: LogLevel): boolean {
  return (LOG_LEVELS[level] ?? 1) >= (LOG_LEVELS[currentLevel] ?? 1);
}

export interface Logger {
  setLevel(level: LogLevel): void;
  debug(msg: string, meta?: LogMeta): void;
  info(msg: string | LogMeta, meta?: LogMeta): void;
  warn(msg: string | LogMeta, meta?: LogMeta): void;
  error(msg: string | LogMeta, meta?: LogMeta): void;
  http(method: string, pathname: string, statusCode: number, elapsedMs: number): void;
}

export const logger: Logger = {
  setLevel(level: LogLevel): void {
    if (LOG_LEVELS[level] !== undefined) currentLevel = level;
  },

  debug(msg: string, meta?: LogMeta): void {
    if (shouldLog('debug')) console.debug(format('debug', msg, meta));
  },
  info(msg: string | LogMeta, meta?: LogMeta): void {
    if (shouldLog('info')) console.info(format('info', msg, meta));
  },
  warn(msg: string | LogMeta, meta?: LogMeta): void {
    if (shouldLog('warn')) console.warn(colorize('warn', 'WARN ') + format('warn', msg, meta));
  },
  error(msg: string | LogMeta, meta?: LogMeta): void {
    if (shouldLog('error')) console.error(colorize('error', 'ERR ') + format('error', msg, meta));
  },

  http(method: string, pathname: string, statusCode: number, elapsedMs: number): void {
    if (!shouldLog('info')) return;
    const statusColor = statusCode >= 500 ? colors.red : statusCode >= 400 ? colors.yellow : colors.green;
    const line = `${colors.gray}[${timestamp()}]${colors.reset} ${method} ${pathname} ${statusColor}${statusCode}${colors.reset} ${elapsedMs}ms`;
    (statusCode >= 400 ? console.warn : console.log)(line);
  },
};
