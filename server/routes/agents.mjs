// Agent API 路由 — GET/POST/PATCH /api/agents, avatar upload
// 从 server.mjs handle() 提取
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { readAgentRegistry, writeAgentRegistry, AGENT_KEYS } from '../../agent-utils.mjs';
import { reloadAgentConfig, currentWorkspace } from '../config.mjs';
import { getAgentStatuses, stripSensitive } from '../services/agent-status.mjs';
import { authorizeOperation, approvalResponse } from '../../governance.mjs';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
  return true;
}

function requireApproval(res, operation, payload, approvalId) {
  const authorization = authorizeOperation({ operation, payload, approvalId });
  if (authorization.ok) return true;
  approvalResponse(res, authorization);
  return false;
}

export async function tryServeAgents(req, res, { pathname, ctx }) {
  const { readBody, ENV } = ctx;

  // GET /api/agents — 返回 agent 路径配置（脱敏）
  if (req.method === 'GET' && pathname === '/api/agents') {
    const result = (await getAgentStatuses()).map(stripSensitive);
    return json(res, 200, { agents: result, workspace: currentWorkspace() });
  }

  // PATCH /api/agents/:key — 更新角色卡字段
  const agentPatchMatch = pathname.match(/^\/api\/agents\/([^\/]+)$/);
  if (req.method === 'PATCH' && agentPatchMatch) {
    const agentKey = decodeURIComponent(agentPatchMatch[1]);
    const body = await readBody(req);
    const current = readAgentRegistry(ENV);
    const idx = current.findIndex(a => a.key === agentKey);
    if (idx === -1) return json(res, 404, { error: `agent ${agentKey} 不存在` });
    if (!requireApproval(res, 'config.write', { target: `agent.${agentKey}`, changes: body }, body.approvalId)) return true; // handled (403/code>)
    const allowed = ['label', 'emoji', 'desc', 'baseUrl', 'apiKey', 'model', 'roleDescription', 'personality', 'strengths', 'restrictions', 'nickname', 'avatar', 'color'];
    for (const field of allowed) {
      if (body[field] !== undefined) current[idx][field] = body[field];
    }
    writeAgentRegistry(current);
    reloadAgentConfig();
    return json(res, 200, { ok: true, agent: current[idx] });
  }

  // POST /api/agents/:key/avatar — 上传头像
  const avatarUploadMatch = pathname.match(/^\/api\/agents\/([^\/]+)\/avatar$/);
  if (req.method === 'POST' && avatarUploadMatch) {
    const agentKey = decodeURIComponent(avatarUploadMatch[1]);
    const current = readAgentRegistry(ENV);
    const idx = current.findIndex(a => a.key === agentKey);
    if (idx === -1) return json(res, 404, { error: `agent ${agentKey} 不存在` });
    const body = await readBody(req);
    const { data } = body;
    if (!data || typeof data !== 'string') return json(res, 400, { error: '缺少 data 字段' });
    const match = data.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/);
    if (!match) return json(res, 400, { error: 'data 必须是 base64 图片格式' });
    const [, imgType, base64Data] = match;
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > 2 * 1024 * 1024) return json(res, 400, { error: '图片不能超过 2MB' });
    const avatarsDir = '.myteam/avatars';
    mkdirSync(avatarsDir, { recursive: true });
    const fileName = `${agentKey}.${imgType === 'jpeg' ? 'jpg' : imgType}`;
    writeFileSync(resolve(avatarsDir, fileName), buffer);
    current[idx].avatar = `/avatars/${fileName}`;
    writeAgentRegistry(current);
    reloadAgentConfig();
    return json(res, 200, { ok: true, avatar: current[idx].avatar, agent: current[idx] });
  }

  // POST /api/agents — 写回 .env，实时重载
  if (req.method === 'POST' && pathname === '/api/agents') {
    const body = await readBody(req);
    if (!requireApproval(res, 'config.write', { target: 'agents', agents: body.agents || Object.keys(body).filter(k => AGENT_KEYS.includes(k)) }, body.approvalId)) return true;
    const current = readAgentRegistry(ENV);
    const currentByKey = new Map(current.map(a => [a.key, a]));
    const nextAgents = Array.isArray(body.agents)
      ? body.agents.map(incoming => {
          const prev = currentByKey.get(incoming.key) || {};
          const apiKey = (incoming.apiKey !== undefined && String(incoming.apiKey).trim() !== '') ? incoming.apiKey : prev.apiKey;
          const path = incoming.path !== undefined ? incoming.path : prev.path;
          return { key: incoming.key || prev.key, label: incoming.label || prev.label, path, apiKey, baseUrl: incoming.baseUrl || prev.baseUrl, model: incoming.model || prev.model };
        })
      : current;
    writeAgentRegistry(nextAgents);
    reloadAgentConfig();
    return json(res, 200, { ok: true, agents: nextAgents.map(stripSensitive) });
  }

  return false;
}
