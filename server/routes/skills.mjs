// Skills API 路由 — GET/POST/DELETE /api/skills, registry, install, studio-templates
// 从 server.mjs handle() 提取
import { loadSkillRegistry } from '../services/skill-registry.mjs';
import { STUDIO_TEMPLATES } from '../config.mjs';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
  return true;
}

export async function tryServeSkills(req, res, { pathname, url, ctx }) {
  const {
    readSkills, selectSkills, buildSkillContext, getNextSkills,
    readSkillsState, writeSkillsState, readSkillFromDir,
    requireApproval, readBody, sanitizeSkillName, inferSkillName,
    cloneAndFindSkillMd, parseGithubUrl, isRemoteUrl, extractZip,
    findSkillMdInDir, readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync,
    rmSync, SKILLS_DIR, SKILLS_STATE_FILE, SKILL_SOURCES,
    readAgentRegistry, writeAgentRegistry, sanitizeAgentKey, buildRoleCard,
    appendAudit,
  } = ctx;

  // GET /api/skills
  if (req.method === 'GET' && pathname === '/api/skills') {
    const skills = readSkills();
    const text = url.searchParams.get('text') || '';
    const agent = url.searchParams.get('agent') || '';
    const phase = url.searchParams.get('phase') || 'run';
    const currentSkill = url.searchParams.get('current') || '';
    const selected = selectSkills({ text, agent, phase });
    const nextSkills = currentSkill ? getNextSkills(currentSkill) : [];
    return json(res, 200, { skills, selected: selected.map(s => s.name), currentSkill, nextSkills });
  }

  // GET /api/skills/usage
  if (req.method === 'GET' && pathname === '/api/skills/usage') {
    const sessionId = url.searchParams.get('sessionId') || '';
    if (!sessionId) return json(res, 400, { error: '缺少 sessionId 参数' });
    const invocationsFile = '.myteam/invocations.jsonl';
    let records = [];
    try {
      records = readFileSync(invocationsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).reverse();
    } catch {}
    const usage = records
      .filter(r => r.sessionId === sessionId && Array.isArray(r.skills))
      .flatMap(r => (r.skills || []).map(s => ({ skill: s, agent: r.agent, timestamp: r.timestamp })));
    return json(res, 200, { sessionId, usage });
  }

  // POST /api/skills/import
  if (req.method === 'POST' && pathname === '/api/skills/import') {
    const body = await readBody(req);
    if (!requireApproval(res, 'skill.install', { source: body.url || body.content, name: body.name }, body.approvalId)) return true; // handled (403) by approval system
    try {
      let mdContent = '';
      let skillName = '';
      if (body.url && isRemoteUrl(body.url)) {
        const parsed = parseGithubUrl(body.url);
        skillName = sanitizeSkillName(body.name || (parsed?.repo || ''));
        const cloneResult = await cloneAndFindSkillMd(body.url);
        mdContent = cloneResult.mdContent;
        if (!skillName || skillName === 'unnamed') skillName = cloneResult.name;
      } else if (body.content) {
        mdContent = body.content;
        skillName = sanitizeSkillName(body.name || inferSkillName(mdContent));
      } else return json(res, 400, { error: '请提供 url 或 content 字段' });
      mkdirSync(`${SKILLS_DIR}/${skillName}`, { recursive: true });
      writeFileSync(`${SKILLS_DIR}/${skillName}/SKILL.md`, mdContent, 'utf8');
      const state = readSkillsState();
      state[skillName] = { enabled: true, installedAt: new Date().toISOString() };
      writeSkillsState(state);
      appendAudit({ operation: 'skill.install', result: 'succeeded', details: { name: skillName } });
      return json(res, 200, { ok: true, skill: { name: skillName } });
    } catch (err) {
      appendAudit({ operation: 'skill.install', result: 'failed', details: { error: err.message } });
      return json(res, 500, { error: err.message });
    }
  }

  // GET /api/studio-templates
  if (req.method === 'GET' && pathname === '/api/studio-templates') {
    return json(res, 200, { templates: STUDIO_TEMPLATES });
  }

  // POST /api/studio-templates/apply
  if (req.method === 'POST' && pathname === '/api/studio-templates/apply') {
    const body = await readBody(req);
    const template = STUDIO_TEMPLATES.find(t => t.id === body.templateId);
    if (!template) return json(res, 400, { error: '模板不存在' });
    const current = readAgentRegistry();
    const updated = template.agents.map(tpl => {
      const prev = current.find(a => a.key === tpl.key) || {};
      return {
        key: tpl.key,
        label: tpl.label || prev.label,
        emoji: tpl.emoji || prev.emoji,
        path: prev.path || '',
        apiKey: prev.apiKey || '',
        baseUrl: prev.baseUrl || '',
        model: prev.model || '',
        roleDescription: tpl.roleDescription || prev.roleDescription,
        personality: tpl.personality || prev.personality,
        strengths: tpl.strengths || prev.strengths || [],
        restrictions: tpl.restrictions || prev.restrictions || [],
      };
    });
    writeAgentRegistry(updated);
    return json(res, 200, { ok: true, agents: updated.map(a => sanitizeAgentKey(a)), templateId: template.id });
  }

  // GET /api/skills/registry
  if (req.method === 'GET' && pathname === '/api/skills/registry') {
    const source = url.searchParams.get('source') || 'myteam-official';
    const srcCfg = SKILL_SOURCES[source];
    if (!srcCfg) return json(res, 400, { error: '不支持的市场来源' });
    try {
      const registry = await loadSkillRegistry(source, srcCfg);
      if (!registry) return json(res, 502, { error: '无法加载远程市场' });
      const state = readSkillsState();
      registry.skills = registry.skills.map(s => ({
        ...s, installed: !!state[s.name]?.enabled,
      }));
      return json(res, 200, registry);
    } catch (err) {
      return json(res, 502, { error: err.message });
    }
  }

  // POST /api/skills/install
  if (req.method === 'POST' && pathname === '/api/skills/install') {
    const body = await readBody(req);
    const { source = 'myteam-official', name } = body;
    if (!name) return json(res, 400, { error: '缺少 skill 名称' });
    if (!requireApproval(res, 'skill.install', { source, name }, body.approvalId)) return true; // handled (403) by approval system
    try {
      const srcCfg = SKILL_SOURCES[source];
      const registry = await loadSkillRegistry(source, srcCfg);
      const entry = registry?.skills?.find(s => s.name === name);
      if (!entry) return json(res, 404, { error: 'skill 不存在于市场中' });
      const resolved = await readSkillMarkdownFromEntry(srcCfg, entry);
      const mdContent = resolved.markdown_content;
      if (!mdContent) return json(res, 502, { error: '无法读取 skill 内容' });
      mkdirSync(`${SKILLS_DIR}/${sanitizeSkillName(name)}`, { recursive: true });
      writeFileSync(`${SKILLS_DIR}/${sanitizeSkillName(name)}/SKILL.md`, mdContent, 'utf8');
      const state = readSkillsState();
      state[sanitizeSkillName(name)] = { enabled: true, installedAt: new Date().toISOString(), source };
      writeSkillsState(state);
      appendAudit({ operation: 'skill.install', result: 'succeeded', details: { name, source } });
      return json(res, 200, { ok: true, skill: { name: sanitizeSkillName(name) } });
    } catch (err) {
      appendAudit({ operation: 'skill.install', result: 'failed', details: { error: err.message } });
      return json(res, 500, { error: err.message });
    }
  }

  // POST /api/skills/:name/toggle
  const skillToggleMatch = pathname.match(/^\/api\/skills\/([^\/]+)\/toggle$/);
  if (req.method === 'POST' && skillToggleMatch) {
    const skillName = decodeURIComponent(skillToggleMatch[1]);
    const body = await readBody(req);
    const state = readSkillsState();
    state[skillName] = { ...(state[skillName] || {}), enabled: !!body.enabled, updatedAt: new Date().toISOString() };
    writeSkillsState(state);
    return json(res, 200, { ok: true, name: skillName, enabled: state[skillName].enabled });
  }

  // DELETE /api/skills/:name
  const skillDeleteMatch = pathname.match(/^\/api\/skills\/([^\/]+)$/);
  if (req.method === 'DELETE' && skillDeleteMatch) {
    const skillName = decodeURIComponent(skillDeleteMatch[1]);
    if (!requireApproval(res, 'skill.delete', { name: skillName }, (await readBody(req)).approvalId)) return true; // handled (403) by approval system
    try { rmSync(`${SKILLS_DIR}/${skillName}`, { recursive: true, force: true }); } catch {}
    const state = readSkillsState();
    delete state[skillName];
    writeSkillsState(state);
    return json(res, 200, { ok: true, name: skillName });
  }

  return false;
}

// Re-export the skill registry helper
export { readSkillMarkdownFromEntry } from '../services/skill-registry.mjs';
