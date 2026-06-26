// Skill 市场注册表 — 从远程拉取 / 解析 skill 清单
import { get as httpsGet } from 'https';
import { get as httpGetModule } from 'http';
import { readFileSync } from 'fs';
import { SKILL_SOURCES, SKILL_REGISTRY_TTL_MS, skillRegistryCache } from '../config.mjs';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith('https') ? httpsGet : httpGetModule;
    getter(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function httpGetBuffer(url) {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith('https') ? httpsGet : httpGetModule;
    getter(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function readSkillSourceIndex(srcCfg) {
  if (skillRegistryCache.has(srcCfg.localIndexPath)) {
    const cached = skillRegistryCache.get(srcCfg.localIndexPath);
    if (Date.now() - cached.time < SKILL_REGISTRY_TTL_MS) return cached.data;
    skillRegistryCache.delete(srcCfg.localIndexPath);
  }
  try {
    const data = await httpGet(srcCfg.indexUrl);
    const parsed = JSON.parse(data);
    skillRegistryCache.set(srcCfg.localIndexPath, { time: Date.now(), data: parsed });
    return parsed;
  } catch { return null; }
}

export function resolveLocalSkillPath(srcCfg, entryUrl) {
  if (!srcCfg.localBase) return null;
  const idx = entryUrl.indexOf('/skills/');
  if (idx >= 0) return srcCfg.localBase + entryUrl.slice(idx);
  return null;
}

export async function readSkillMarkdownFromEntry(srcCfg, entry) {
  if (entry.source === 'local') {
    // 从本地 skills-registry 读取
    const localPath = resolveLocalSkillPath(srcCfg, entry.skillMdUrl || entry.url || '');
    if (!localPath) return entry;
    try {
      entry.markdown_content = readFileSync(localPath, 'utf8');
    } catch (e) { entry.markdown_error = e.message; }
    return entry;
  }
  try {
    const rawUrl = entry.skillMdUrl || entry.url || '';
    if (srcCfg.rawBase && rawUrl.startsWith('/')) {
      entry.markdown_content = await httpGet(srcCfg.rawBase + rawUrl);
    } else if (rawUrl.startsWith('http')) {
      entry.markdown_content = await httpGet(rawUrl);
    }
  } catch (e) { entry.markdown_error = e.message; }
  return entry;
}

export function parseClowderManifest(yamlText, rawBase) {
  // clowder-ai manifest.yaml → myteam skill 列表
  const skills = [];
  const lines = yamlText.split('\n');
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('- ')) {
      if (current) skills.push(current);
      current = { source: 'clowder-ai' };
    } else if (current && line.match(/^ {4}(\w+):\s*(.*)/)) {
      const key = RegExp.$1, val = RegExp.$2.trim().replace(/^["']|["']$/g, '');
      if (key === 'name') current.name = val;
      else if (key === 'description') current.description = val;
      else if (key === 'category') current.category = val;
      else if (key === 'trigger') current.trigger = val;
      else if (key === 'path') current.skillMdUrl = val.startsWith('http') ? val : (rawBase + '/' + val);
    }
  }
  if (current) skills.push(current);
  return { skills, total: skills.length };
}

export async function loadSkillRegistry(source, srcCfg) {
  if (!srcCfg) return null;
  if (srcCfg.type === 'index') {
    const data = await readSkillSourceIndex(srcCfg);
    if (!data) return null;
    return { source, skills: data.skills || data, total: (data.skills || data).length };
  }
  if (srcCfg.type === 'manifest') {
    try {
      const manifest = await httpGet(srcCfg.indexUrl);
      return { source, ...parseClowderManifest(manifest, srcCfg.rawBase) };
    } catch { return null; }
  }
  return null;
}

export { httpGet, httpGetBuffer };
