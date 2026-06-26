// myteam server — 路由注册表
// 替代原来 server.mjs 中 3000+ 行的巨型 handle() 函数
// 每个路由模块导出 register(map) 向此表注册 handler

/** @type {Map<string, Function[]>} */
const routeMap = new Map();  // method:path → [handler]

export function get(path, handler) {
  const key = `GET:${path}`;
  if (!routeMap.has(key)) routeMap.set(key, []);
  routeMap.get(key).push(handler);
}

export function post(path, handler) {
  const key = `POST:${path}`;
  if (!routeMap.has(key)) routeMap.set(key, []);
  routeMap.get(key).push(handler);
}

export function patch(path, handler) {
  const key = `PATCH:${path}`;
  if (!routeMap.has(key)) routeMap.set(key, []);
  routeMap.get(key).push(handler);
}

export function del(path, handler) {
  const key = `DELETE:${path}`;
  if (!routeMap.has(key)) routeMap.set(key, []);
  routeMap.get(key).push(handler);
}

/** 注册带参数匹配的路由（如 /api/approvals/:id/decision） */
export function match(method, pattern, handler) {
  const key = `${method.toUpperCase()}:${pattern}`;
  if (!routeMap.has(key)) routeMap.set(key, []);
  routeMap.get(key).push(handler);
}

/**
 * 执行路由匹配
 * @returns {Promise<boolean>} 是否已处理
 */
export async function dispatch(req, res, { pathname, url, scheduleService, langGraphDispatchEngine, langGraphCheckpointer, dispatchContextCache }) {
  const method = req.method;
  
  // 1. 精确匹配
  const exactKey = `${method}:${pathname}`;
  if (routeMap.has(exactKey)) {
    for (const handler of routeMap.get(exactKey)) {
      const result = await handler(req, res, { url, pathname, scheduleService, langGraphDispatchEngine, langGraphCheckpointer, dispatchContextCache });
      if (result !== false) return true;
    }
  }

  // 2. 模式匹配
  for (const [key, handlers] of routeMap) {
    const [registeredMethod, pattern] = key.split(/:(.+)/);
    if (registeredMethod !== method) continue;
    if (!pattern.includes(':')) continue; // 不是模式路由
    
    const paramNames = [];
    const regexStr = pattern.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    const regex = new RegExp('^' + regexStr + '$');
    const matchResult = pathname.match(regex);
    
    if (matchResult) {
      const params = {};
      paramNames.forEach((name, i) => { params[name] = decodeURIComponent(matchResult[i + 1]); });
      const extendedCtx = { url, pathname, params, scheduleService, langGraphDispatchEngine, langGraphCheckpointer, dispatchContextCache };
      for (const handler of handlers) {
        const result = await handler(req, res, extendedCtx);
        if (result !== false) return true;
      }
    }
  }

  return false; // 未匹配
}
