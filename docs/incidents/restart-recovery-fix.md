# myteamOUO restart recovery checklist

## Current state

- Repository layer: adapter descriptors are persisted to SQLite (`workflow_adapters` table)
- Port reconstruction: `reconstructPorts()` in `workflow/checkpointer.mjs` provides the factory
- Resume endpoint: `POST /api/workflows/:id/resume` attempts to rebuild from persisted descriptor before returning 409
- Two critical gaps remain that prevent actual production restart recovery.

## Gap 1: Resume rebuild references closure-local functions

The resume handler (`server.mjs` lines 3980-3991) calls closure-local `executeTask()` and `runAutoReview()`:

```javascript
// line 3980: closure-local executeTask()
rebuildCallbacks.executeTask = async (task) => {
  return executeTask(task, Number(task.chain_depth || 0), task.chain_history || [], { graphManaged: true });
};

// line 3983: closure-local runAutoReview()
rebuildCallbacks.reviewTask = async (task, execution) => {
  return runAutoReview(
    task,
    execution?.agent || task.executed_by || task.agent,
    execution?.result || task.previous_result || '',
    execution?.collaborationContext || buildTaskCollaborationContext(task),
    { deferGate: Boolean(descriptor.options?.requireHumanGate) },
  );
};
```

These functions are defined inside the `POST /api/dispatch` closure (line 4374 for `executeTask`, line 4175 for `runAutoReview`). After restart, `executeTask` and `runAutoReview` are `undefined`.

**Fix**: Extract `executeTask` and `runAutoReview` to module-level functions that accept all their dependencies as parameters, then call them from both the dispatch closure and the resume rebuild path.

## Gap 2: buildTaskCollaborationContext references dispatch closure variables

The resume rebuild path creates a new `buildTaskCollaborationContext` but it references `dispatchSession`, `currentWorkspace()`, `contextCache`, `relevantLessons`, `buildWorkspaceBridge`, `refreshSessionContinuity`, etc. Most of these are module-level functions and will work. But `relevantLessons` and `buildLessonContext` are module-level, so they should be fine too.

The actual missing references after restart are:

| Missing | Reason |
|---------|--------|
| `executeTask` | closure-local in POST /api/dispatch |
| `runAutoReview` | closure-local in POST /api/dispatch |
| `materializeGraphSpawns` | closure-local in POST /api/dispatch |
| `buildSpawnCommand` | imported from agent-utils.mjs — actually available! |
| `streamAgent` | module-level in server.mjs — actually available! |

So the fix needs to extract just `executeTask`, `runAutoReview`, and `materializeGraphSpawns` to module level.

## Implementation plan

### Step 1: Extract executeTask to module level

Move the core execution logic from the `POST /api/dispatch` closure to a module-level function that takes `deps` as its first argument:

```javascript
async function reborn_executeTask(deps, task, { depth = 0, chainHistory = [], graphManaged = false } = {}) {
  const {
    agentOverride, getAgentStatuses, agentKeys, buildTaskCollaborationContext,
    buildExecPrompt, SPAWN_SUBAGENT_PROTOCOL, createTurnPartsCollector,
    selectSkills, buildSkillContext, relevantLessons, streamAgent,
    patchTask, pushChainMessage, updateSubagentRun, appendSubagentMessage,
    createSubagentRun, resolve, resolveAgentParser, buildSpawnCommand, sseSend,
    workflowRes, runAutoReview,
  } = deps;
  // ... (existing executeTask body)
}
```

The closure-local `executeTask()` inside dispatch becomes:
```javascript
const executeTask = (t, depth, chain, opts) =>
  reborn_executeTask(deps, t, { depth, chainHistory: chain, ...opts });
```

### Step 2: Extract runAutoReview to module level

Same pattern — extract review logic to a module-level function.

### Step 3: Extract materializeGraphSpawns to module level

Same pattern — extract spawn materialization to a module-level function.

### Step 4: Wire up the resume rebuild path

In `POST /api/workflows/:id/resume`, build the `deps` object from available module-level references and call `reborn_executeTask`, `reborn_runAutoReview`, and `reborn_materializeGraphSpawns`.
