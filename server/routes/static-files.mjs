// 静态文件路由 — HTML / CSS / JS / 图片 / 头像
// 从 server.mjs handle() 提取，减少主文件的 if/else 分支
import { readFileSync, existsSync } from 'fs';
import { resolve, basename, extname } from 'path';
import { MIME } from '../config.mjs';

/**
 * 处理静态文件请求。返回 true 表示已处理，false 表示未匹配。
 */
export function tryServeStatic(req, res, { pathname }) {
  if (req.method !== 'GET') return false;

  // 首页
  if (pathname === '/' || pathname === '/app.html') {
    try {
      const html = readFileSync('web/app.html', 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return true;
    } catch { return false; }
  }

  // 顶级 CSS/JS
  if (pathname === '/app.css' || pathname === '/app.js') {
    try {
      const ext = pathname.slice(1);
      const content = readFileSync(`web/${ext}`, 'utf8');
      const contentType = ext.endsWith('.css') ? 'text/css' : 'application/javascript';
      res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
      res.end(content);
      return true;
    } catch { return false; }
  }

  // web/ 子目录 (如 css/theme.css, js/utils/*)
  if (/^\/(css|js)\//.test(pathname)) {
    try {
      const safePath = pathname.replace(/\.\./g, '');
      const fullPath = resolve(`web/${safePath}`);
      if (!fullPath.startsWith(resolve('web'))) throw new Error('invalid path');
      const content = readFileSync(fullPath, 'utf8');
      const ct = MIME[extname(fullPath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct });
      res.end(content);
      return true;
    } catch { return false; }
  }

  // 图片附件 (.myteam/uploads/)
  if (pathname.startsWith('/uploads/')) {
    try {
      const fileName = basename(decodeURIComponent(pathname.slice('/uploads/'.length)));
      const uploadsDir = '.myteam/uploads';
      const filePath = resolve(uploadsDir, fileName);
      const uploadRoot = resolve(uploadsDir);
      if (!filePath.startsWith(uploadRoot) || !existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '图片不存在' }));
        return true;
      }
      const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' });
      res.end(readFileSync(filePath));
      return true;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '图片路径不正确' }));
      return true;
    }
  }

  // 头像 (.myteam/avatars/)
  if (pathname.startsWith('/avatars/')) {
    try {
      const fileName = basename(decodeURIComponent(pathname.slice('/avatars/'.length)));
      const avatarsDir = '.myteam/avatars';
      const filePath = resolve(avatarsDir, fileName);
      const avatarRoot = resolve(avatarsDir);
      if (!filePath.startsWith(avatarRoot) || !existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '头像不存在' }));
        return true;
      }
      const type = MIME[extname(filePath).toLowerCase()] || 'image/png';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' });
      res.end(readFileSync(filePath));
      return true;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '头像路径不正确' }));
      return true;
    }
  }

  return false; // 未匹配
}
