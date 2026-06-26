// 路由处理器 (原 server.mjs handle 函数，待进一步拆分为 domain route 模块)
// 每个路由域将逐步迁移到 server/routes/ 下各自的模块文件中

import { createServer } from 'http';
import { get as httpsGet } from 'https';
import { get as httpGetModule } from 'http';
import {
  readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync,
  readdirSync, rmSync, statSync, lstatSync, realpathSync
} from 'fs';
import { resolve, basename, dirname, extname, join, sep, relative } from 'path';
import { randomUUID, createHash } from 'crypto';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import {
  loadEnv, buildCliConfig, invokeAgent, parseReviewResult, resolveAgentParser,
  readTasks, writeAllTasks, appendTask, patchTask, PLAN_PROMPT, buildExecPrompt,
  buildReviewPrompt, AGENT_KEYS, buildSpawnCommand, checkAgentLaunchable,
  formatLaunchError, normalizeAgentFailure, readAgentRegistry, writeAgentRegistry,
  sanitizeAgentKey, buildRoleCard, validatePhaseTransition, getNextPhase,
  selectRunnableAgent
} from '../../agent-utils.mjs';
import { normalizeReviewScorecard, publicProductTemplates, reviewScorecardPasses } from '../../product-guidance.mjs';
import {
  createWorkflowRunId, createWorkflowTaskId,
  recoverInterruptedTaskRecords, synchronizeTaskRecord, transitionTaskLifecycle,
} from '../../workflow-state.mjs';
import { LangGraphDispatchEngine } from '../../workflow/dispatch-graph.mjs';
import { getSharedCheckpointer, reconstructPorts } from '../../workflow/checkpointer.mjs';
import { LangGraphTurnEngine } from '../../workflow/turn-graph.mjs';
import { getDangerLevel, openPathWithDefaultApp, resolveWorkspaceHtmlPath } from '../../commandSafety.mjs';
import { repository } from '../../storage.mjs';
import {
  appendAudit, approvalResponse, authorizeOperation, decideApproval,
  listApprovals, listAudit, redactSensitive,
} from '../../governance.mjs';
import { ScheduleService } from '../../scheduler.mjs';
import {
  ensurePlanSchemaFile, parseStructuredPlanOutput, buildContinuityCapsule,
  formatContinuityBridge, buildTopKEvidenceBridge, buildWorkspaceBridge,
  SPAWN_SUBAGENT_PROTOCOL, parseSpawnSubagentDirectives, createSubagentRun,
  updateSubagentRun, listSubagentRuns, recoverStaleSubagentRuns,
  appendSubagentMessage, listSubagentMessages, createTurnPartsCollector,
  transitionSessionRunState,
} from '../../collaboration-context.mjs';
import { runWorkflowCleanup, deleteWorkflow } from '../../workflow/cleanup.mjs';
import { MyteamCallbackHandler, recordInvocation, createInvocationContext, recordAudit, recordLesson } from '../../callbacks.mjs';
import { DispatchContextCache } from '../../dispatch-context-cache.mjs';

// ── 配置 ──
import { 
  ENV, CLI_CONFIG, LESSONS_FILE, SKILLS_FILE, SKILLS_DIR, SKILLS_STATE_FILE,
  INVOCATIONS_FILE, SETTINGS_FILE, UPLOADS_DIR, OUTPUTS_DIR, PLAN_SCHEMA_FILE,
  SKILL_SOURCES, MIME, SKILL_REGISTRY_TTL_MS, skillRegistryCache,
  STUDIO_TEMPLATES, agentStatusCache, AGENT_STATUS_TTL_MS,
  reloadAgentConfig, clearAgentStatusCache, agentKeys, currentWorkspace,
  _imports,
} from '../config.mjs';
recoverStaleSubagentRuns();

// ── 服务层 ──
import { pushChainMessage, getChainMessages, chainTaskMessages, chainTaskSSE, executeShell, shellResults } from '../services/chain-task.mjs';
import { appendLesson, relevantLessons, buildLessonContext } from '../services/lesson.mjs';
import { loadSettings as loadSettingsFromService, saveSettings, getAgentStatuses, stripSensitive, resolveRunnableAgent } from '../services/agent-status.mjs';
import { httpGet, httpGetBuffer, loadSkillRegistry, resolveLocalSkillPath, readSkillMarkdownFromEntry, parseClowderManifest } from '../services/skill-registry.mjs';

// ── 服务初始化 ──
const scheduleService = new ScheduleService();
let ENV_L = loadEnv();
let CLI_CONFIG_L = buildCliConfig(ENV_L);

const _loadSettings = loadSettingsFromService;
_currentWorkspace = function() { return resolve(_loadSettings().workspace || '.'); };

// ── A2A abort helpers ──
const CHILDREN = new Map();

let langGraphDispatchEngine = null;
async function getDispatchEngine() {
  if (!langGraphDispatchEngine) {
    langGraphDispatchEngine = new LangGraphDispatchEngine();
  }
  return langGraphDispatchEngine;
}

let langGraphCheckpointer = null;
async function getCheckpointer() {
  if (!langGraphCheckpointer) {
    langGraphCheckpointer = await getSharedCheckpointer();
  }
  return langGraphCheckpointer;
}

const dispatchContextCache = new DispatchContextCache();

// ── 对话历史 + Session ──
const MEMORY_FILE = '.myteam/memory.json';
const DEFAULT_SESSION_NAME = '默认对话';
const DEFAULT_DRAFT_SESSION_NAME = '新对话';
let sessions = [];
let activeSessionId = null;
let trashedSessions = [];
const TRASH_RETENTION_MS = 5 * 60 * 1000;

const WORKSPACE_DENYLIST = ['.myteam', '.claude', 'node_modules', '.git', '__pycache__', '.venv', 'venv', '.workbuddy', 'skills-registry'];

// ── 从 server.mjs 提取的所有本地函数 ──
// (包含 session、skill、upload、artifact 等全部逻辑，约 2000 行)
// 这些将逐步迁移到 server/services/ 中
