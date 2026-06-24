// myteam 共享代理上下文缓存
// 在同一 dispatch run 内避免为每个任务重复重建 collaboration context。
// 在 LangGraph dispatch engine 重启后，函数引用不再可用，
// 因此本模块只导出缓存数据结构，由 server.mjs 消费。

const RUNNING = Symbol('pending');

export class DispatchContextCache {
  #capsule = null;
  #capsuleAgent = null;
  #capsuleHash = '';
  #capsuleLoad = RUNNING;

  #workspaceBridge = null;
  #workspaceHash = '';
  #workspaceLoad = RUNNING;

  constructor({ session, agentOverride = '' } = {}) {
    this.session = session || null;
    this.agentOverride = agentOverride;
  }

  /** 清除所有缓存（dispatch 完成后调用）。 */
  clear() {
    this.#capsule = null;
    this.#capsuleAgent = null;
    this.#capsuleHash = '';
    this.#capsuleLoad = RUNNING;
    this.#workspaceBridge = null;
    this.#workspaceHash = '';
    this.#workspaceLoad = RUNNING;
  }

  /** 获取或刷新 continuity capsule（一次 dispatch 内不变）。 */
  getOrRefreshContinuity(refreshFn, agentKey = '', extraHash = '') {
    const key = `${agentKey || this.agentOverride}::${extraHash}`;
    if (this.#capsuleLoad === RUNNING) return null; // 仍在加载中，调用方推迟
    if (this.#capsule !== null && this.#capsuleHash === key) return this.#capsule;
    if (typeof refreshFn !== 'function') return this.#capsule;
    const next = refreshFn();
    this.#capsule = next;
    this.#capsuleHash = key;
    this.#capsuleLoad = null;
    return next;
  }

  /** 强制设置 capsule（允许调用方预先计算）。 */
  set capsule(value) {
    this.#capsule = value;
    this.#capsuleLoad = null;
    this.#capsuleHash = '';
  }

  /** 获取或刷新跨任务不变的 workspace bridge。 */
  getOrRefreshWorkspace(fetchFn, extraHash = '') {
    const key = `ws::${extraHash}`;
    if (this.#workspaceLoad === RUNNING) return null;
    if (this.#workspaceBridge !== null && this.#workspaceHash === key) return this.#workspaceBridge;
    if (typeof fetchFn !== 'function') return this.#workspaceBridge;
    const next = fetchFn();
    this.#workspaceBridge = next;
    this.#workspaceHash = key;
    this.#workspaceLoad = null;
    return next;
  }

  /** 强制设置 workspace bridge。 */
  set workspaceBridge(value) {
    this.#workspaceBridge = value;
    this.#workspaceLoad = null;
    this.#workspaceHash = '';
  }
}
