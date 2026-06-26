// ─── Skills management ───────────────────────────────────────────
(function() {
const svBackBtn = document.getElementById("svBackBtn");
const skillsPageBtn = document.getElementById("skillsPageBtn");
const skillsView = document.getElementById("skillsView");
const chatArea = document.querySelector(".chat-area");
const svInstalledList = document.getElementById("svInstalledList");
const svMarketList = document.getElementById("svMarketList");
const svSourceBtns = document.getElementById("svSourceBtns");
const svMarketSearch = document.getElementById("svMarketSearch");
if (!skillsPageBtn) return;
let currentSource = "myteam-official";
const marketCache = skillRegistryCache;
skillsPageBtn.addEventListener("click", () => showSkillsView());
svBackBtn && svBackBtn.addEventListener("click", () => hideSkillsView());
function showSkillsView() {
  skillsView.classList.remove("hidden");
  chatArea.style.display = "none";
  loadInstalledSkills();
  loadMarketSources();
  prefetchSkillRegistry("clowder-ai");
}
function hideSkillsView() { skillsView.classList.add("hidden"); chatArea.style.display = ""; }
document.querySelectorAll(".sv-tab").forEach(tab => { tab.addEventListener("click", () => { document.querySelectorAll(".sv-tab").forEach(t=>t.classList.remove("active")); tab.classList.add("active"); var p=tab.dataset.stab; document.querySelectorAll(".sv-panel").forEach(p=>p.classList.add("hidden")); if (p==="installed") { document.getElementById("svPanelInstalled").classList.remove("hidden"); loadInstalledSkills(); } if (p==="market") { document.getElementById("svPanelMarket").classList.remove("hidden"); loadMarketSkills(); } if (p==="import") { document.getElementById("svPanelImport").classList.remove("hidden"); } }); });
async function loadInstalledSkills() {
  try {
    const data = await fetch("/api/skills").then(r=>r.json());
    var skills = data.skills || data || [];
    if (!skills.length) { svInstalledList.innerHTML = "<div class=\"sv-empty\">No skills installed.</div>"; return; }
    svInstalledList.innerHTML = skills.map(s => {
      var enabled = s.enabled !== false;
      var cat = s.category || "general";
      var desc = (s.description || s.trigger || "").slice(0,120);
      return "<div class=\"sv-card " + (enabled?"":"disabled") + "\"><div class=\"sv-card-header\"><span class=\"sv-card-name\">"+esc(s.name)+"</span><span class=\"sv-card-cat\">"+esc(cat)+"</span><div class=\"sv-card-actions\"><label class=\"sv-toggle\"><input type=\"checkbox\" class=\"sv-toggle-cb\" data-skill=\""+esc(s.name)+"\" "+(enabled?"checked":"")+"><span class=\"sv-toggle-track\"><span class=\"sv-toggle-thumb\"></span></span></label><button class=\"sv-uninstall-btn\" data-skill=\""+esc(s.name)+"\">🗑</button></div></div><div class=\"sv-card-desc\">"+esc(desc)+"</div>"+(s.mounts?"<div class=\"sv-card-mounts\">"+Object.entries(s.mounts).filter(([_,v])=>v).map(([k])=>"<span class=\"sv-mount-tag\">"+esc(k)+"</span>").join("")+"</div>":"")+"</div>";
    }).join("");
    svInstalledList.querySelectorAll(".sv-toggle-cb").forEach(cb => { cb.addEventListener("change", async () => { var n=cb.dataset.skill; var en=cb.checked; await fetch("/api/skills/"+encodeURIComponent(n)+"/toggle", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({enabled:en}) }); }); });
    svInstalledList.querySelectorAll(".sv-uninstall-btn").forEach(btn => { btn.addEventListener("click", async () => { var n=btn.dataset.skill; if (!confirm("Uninstall "+n+"?")) return; await fetchWithApproval("/api/skills/"+encodeURIComponent(n), { method:"DELETE", headers:{"Content-Type":"application/json"}, body:"{}" }); loadInstalledSkills(); }); });
  } catch(e) { svInstalledList.innerHTML = "<div class=\"sv-empty\">Load failed: "+esc(e.message)+"</div>"; }
}
async function loadMarketSources() {
  const sources = ["myteam-official", "clowder-ai"];
  svSourceBtns.innerHTML = sources.map(s=>"<button class=\"sv-src-btn "+(s===currentSource?"active":"")+"\" data-src=\""+esc(s)+"\">"+esc(s)+"</button>").join("");
  svSourceBtns.querySelectorAll(".sv-src-btn").forEach(btn => { btn.addEventListener("click", () => { currentSource=btn.dataset.src; svSourceBtns.querySelectorAll(".sv-src-btn").forEach(b=>b.classList.toggle("active",b.dataset.src===currentSource)); loadMarketSkills(); }); });
  svMarketSearch.oninput = () => renderMarketSkills(currentSource);
  loadMarketSkills();
}
async function loadMarketSkills() {
  const requestedSource = currentSource;
  if (marketCache[requestedSource]) {
    renderMarketSkills(requestedSource);
    return;
  }
  svMarketList.innerHTML = "<div class=\"sv-empty\">正在加载市场…</div>";
  try {
    await fetchSkillRegistry(requestedSource);
    if (requestedSource === currentSource) renderMarketSkills(requestedSource);
  } catch(e) { if (requestedSource === currentSource) svMarketList.innerHTML = "<div class=\"sv-empty\">Load failed: "+esc(e.message)+"</div>"; }
}
function renderMarketSkills(source) {
    var skills = marketCache[source]?.skills || [];
    var filter = svMarketSearch.value.toLowerCase();
    if (filter) skills = skills.filter(s => (s.name||"").toLowerCase().includes(filter) || (s.description||s.trigger||"").toLowerCase().includes(filter));
    if (!skills.length) { svMarketList.innerHTML = "<div class=\"sv-empty\">"+(filter?"No matches":"No skills")+"</div>"; return; }
    svMarketList.innerHTML = skills.map(s => {
      var installed = s.installed;
      return "<div class=\"sv-card "+(installed?"installed":"")+"\"><div class=\"sv-card-header\"><span class=\"sv-card-name\">"+esc(s.name)+"</span><span class=\"sv-card-cat\">"+esc(s.category||"general")+"</span><div class=\"sv-card-actions\"><button class=\"sv-install-btn "+(installed?"installed":"")+"\" data-skill=\""+esc(s.name)+"\" data-source=\""+esc(source)+"\" "+(installed?"disabled":"")+">"+(installed?"Installed":"Install")+"</button></div></div><div class=\"sv-card-desc\">"+esc((s.description||s.trigger||"").slice(0,150))+"</div></div>";
    }).join("");
    svMarketList.querySelectorAll(".sv-install-btn:not([disabled])").forEach(btn => { btn.addEventListener("click", async () => { var n=btn.dataset.skill; var source=btn.dataset.source; btn.disabled=true; btn.textContent="Installing..."; try { var approved = await fetchWithApproval("/api/skills/install", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({source,name:n}) }); var res=approved.response; var data=approved.data; if (!res.ok || !data.ok) throw new Error(data.error || "install failed"); btn.textContent="Installed"; btn.classList.add("installed"); btn.closest(".sv-card")?.classList.add("installed"); var cached=marketCache[source]?.skills?.find(s=>s.name===n); if (cached) cached.installed=true; loadInstalledSkills(); } catch(e) { btn.disabled=false; btn.textContent="Install"; alert("安装失败："+e.message); } }); });
}
document.getElementById("svImportGithubBtn") && document.getElementById("svImportGithubBtn").addEventListener("click", () => doImport({url:document.getElementById("svImportGithub").value.trim()}));
document.getElementById("svImportUrlBtn") && document.getElementById("svImportUrlBtn").addEventListener("click", () => doImport({url:document.getElementById("svImportUrl").value.trim()}));
document.getElementById("svImportPathBtn") && document.getElementById("svImportPathBtn").addEventListener("click", () => { var p=document.getElementById("svImportPath").value.trim(); doImport(p.toLowerCase().endsWith(".zip")?{zip:p}:{path:p}); });
async function doImport(payload) {
  var st = document.getElementById("svImportStatus");
  st.classList.remove("hidden"); st.textContent = "Installing..."; st.className="sv-import-status";
  try {
    var approvedResult = await fetchWithApproval("/api/skills/install-source", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
    var data = approvedResult.data;
    if (data.ok) { st.textContent = "Installed: "+data.skill.name; st.classList.add("success"); loadInstalledSkills(); }
    else throw new Error(data.error||"unknown");
  } catch(e) { st.textContent = "Failed: "+e.message; st.classList.add("error"); }
}
})();

// ─── Task sub-agent button ───────────────────────────────────────────
// inject sub-agent view button into task rows with parent_task_id
var origLoadTasks = window.loadTasks;
if (typeof loadTasks === "function") {
  var orig = loadTasks;
  loadTasks = async function() { await orig.apply(this, arguments); injectSubagentButtons(); };
}
function injectSubagentButtons() {
  document.querySelectorAll(".task-row").forEach(row => {
    if (row.querySelector(".task-subagent-btn")) return;
    if (!row.dataset.parentTaskId && Number(row.dataset.chainDepth || 0) <= 0) return;
    var id = row.dataset.taskId || row.querySelector("[data-task-id]")?.dataset?.taskId;
    if (!id) return;
    var titleEl = row.querySelector(".task-row-title");
    var agentEl = row.querySelector(".task-row-agent");
    var title = titleEl?.title || titleEl?.textContent || "";
    var agent = agentEl?.textContent || "";
    var btn = document.createElement("button");
    btn.className = "task-subagent-btn";
    btn.textContent = "🔍";
    btn.title = "View subagent";
    btn.onclick = (e) => { e.stopPropagation(); if (window.openSubagentSession) window.openSubagentSession(id, title, agent); };
    var actions = row.querySelector(".task-actions");
    if (actions) actions.insertAdjacentElement("beforebegin", btn);
  });
}
