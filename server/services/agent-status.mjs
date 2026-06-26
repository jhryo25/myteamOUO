// Agent 状态服务 — 检测、缓存、脱敏
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { checkAgentLaunchable, readAgentRegistry, validatePhaseTransition, getNextPhase, selectRunnableAgent } from '../../agent-utils.mjs';
import { AGENT_STATUS_TTL_MS, agentStatusCache, clearAgentStatusCache, SETTINGS_FILE, STUDIO_TEMPLATES } from '../config.mjs';

export function loadSettings() {
  const fallback = { workspace: resolve('.') };
  if (!existsSync(SETTINGS_FILE)) return fallback;
  try {
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...fallback, ...data, workspace: data.workspace || fallback.workspace };
  } catch { return fallback; }
}

export function saveSettings(settings) {
  mkdirSync('.myteam', { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

export async function getAgentStatuses({ force = false } = {}) {
  const now = Date.now();
  if (!force && agentStatusCache.agents && now - agentStatusCache.time < AGENT_STATUS_TTL_MS) {
    return agentStatusCache.agents;
  }
  const metaByKey = new Map(readAgentRegistry().map(agent => [agent.key, agent]));
  const { CLI_CONFIG } = await import('../config.mjs');
  const { agentKeys } = await import('../config.mjs');
  const agents = await Promise.all(
    agentKeys().map(async (k) => ({
      ...(await checkAgentLaunchable(k, CLI_CONFIG[k])),
      ...(metaByKey.get(k) || {}),
      path: CLI_CONFIG[k]?.path || '',
    }))
  );
  agentStatusCache.agents = agents; agentStatusCache.time = now; // Update in place
  return agents;
}

export { clearAgentStatusCache };

export function stripSensitive(agent) {
  const { apiKey, ...safe } = agent;
  const key = String(apiKey || '');
  safe.hasApiKey = key.length > 0;
  safe.apiKeyMasked = key.length > 4 ? '....' + key.slice(-4) : key.length > 0 ? '....' : '';
  return safe;
}

export async function resolveRunnableAgent(preferredAgent) {
  const statuses = await getAgentStatuses();
  const { agentKeys } = await import('../config.mjs');
  const preferred = agentKeys().includes(preferredAgent) ? preferredAgent : '';
  const chosen = selectRunnableAgent(statuses, preferred);
  return { agentKey: chosen?.key || preferred || agentKeys()[0] || 'codex', status: chosen };
}

export { STUDIO_TEMPLATES, validatePhaseTransition, getNextPhase };
