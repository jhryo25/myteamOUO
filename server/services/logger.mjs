// 结构化日志模块 — 统一日志格式和级别
// 替换项目中的 console.log / console.error

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

let currentLevel = process.env.MYTEAM_LOG_LEVEL || 'info';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  green: '\x1b[32m',
};

function timestamp() {
  return new Date().toISOString();
}

function format(level, message, meta = {}) {
  const base = { t: timestamp(), level };
  if (message && typeof message === 'object') {
    return JSON.stringify({ ...base, ...message });
  }
  if (Object.keys(meta).length) {
    return JSON.stringify({ ...base, msg: String(message), ...meta });
  }
  return JSON.stringify({ ...base, msg: String(message) });
}

function colorize(level, levelLabel) {
  if (process.env.NO_COLOR) return levelLabel;
  switch (level) {
    case 'error': return `${colors.red}${levelLabel}${colors.reset}`;
    case 'warn':  return `${colors.yellow}${levelLabel}${colors.reset}`;
    case 'debug': return `${colors.gray}${levelLabel}${colors.reset}`;
    default:      return `${colors.green}${levelLabel}${colors.reset}`;
  }
}

function shouldLog(level) {
  return (LOG_LEVELS[level] ?? 1) >= (LOG_LEVELS[currentLevel] ?? 1);
}

export const logger = {
  setLevel(level) { if (LOG_LEVELS[level] !== undefined) currentLevel = level; },

  debug(msg, meta) { if (shouldLog('debug')) console.debug(format('debug', msg, meta)); },
  info(msg, meta)  { if (shouldLog('info'))  console.info(format('info', msg, meta)); },
  warn(msg, meta)  { if (shouldLog('warn'))  console.warn(colorize('warn', 'WARN ') + format('warn', msg, meta)); },
  error(msg, meta) { if (shouldLog('error')) console.error(colorize('error', 'ERR ') + format('error', msg, meta)); },

  // HTTP 请求专用日志
  http(method, pathname, statusCode, elapsedMs) {
    if (!shouldLog('info')) return;
    const statusColor = statusCode >= 500 ? colors.red : statusCode >= 400 ? colors.yellow : colors.green;
    const line = `${colors.gray}[${timestamp()}]${colors.reset} ${method} ${pathname} ${statusColor}${statusCode}${colors.reset} ${elapsedMs}ms`;
    (statusCode >= 400 ? console.warn : console.log)(line);
  },
};
