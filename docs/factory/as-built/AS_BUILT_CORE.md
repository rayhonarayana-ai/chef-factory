# CHEF FACTORY — As-Built Core Engine Reference

**Status:** IMPLEMENTED | **Evidence:** source inspection  
**Last Verified:** 2026-08-16

---

## 1. Architecture Overview

The core engine is a **deterministic pipeline** that converts natural language owner/agent commands into audited, governed outcomes. Ambiguity is never converted into fabricated certainty — unknown or ambiguous input is surfaced explicitly and blocked.

**Pipeline flow (linear, no branching):**

```
Owner/Agent Command
  → Intent Parse (deterministic NLP)
  → Project Scope Resolution
  → Risk Assessment
  → Authority Evaluation (10-rule matrix)
  → Autonomy Evaluation (bounded escalation)
  → Security Guardian (optional Gate 2, fail-closed)
  → Approval Gate (if required)
  → Task Creation
  → Execution (pluggable runner)
  → Audit + Decision Journal
  → Explanation
  → Outcome
```

**Key design invariants:**
- Every outcome carries a structured `Explanation` (decision, why, evidence, confidence, risk, outcome).
- `"Done."` alone is never a valid explanation (`explanation.ts:27-33`).
- All command text passes through `redactText()` before reaching audit or task records.
- The `Store` interface (`ports.ts`) is the only persistence dependency — core logic is persistence-agnostic.

---

## 2. Command Pipeline (`pipeline.ts`)

**File:** `src/core/pipeline.ts` (606 lines)  
**Status:** IMPLEMENTED | **Evidence:** source inspection

### 2.1 Key Types

```typescript
interface ActorContext {
  ownerId: string;
  actorId: string;
  actorType: 'owner' | 'agent';
  agentId?: string | null;
}

interface ExecutionOutcome {
  ok: boolean;
  output?: unknown;
  error?: unknown;
  modelId?: string | null;
  runtimeId?: string | null;
  cost?: number;
  reason?: string;
}

interface ExecutionRunner {
  execute(task: TaskRecord, ctx: ActorContext, intent: ParsedIntent): Promise<ExecutionOutcome>;
}

type PipelineOutcome =
  | 'executed'
  | 'waiting_approval'
  | 'denied'
  | 'unknown'
  | 'unknown_project'
  | 'retry_pending'
  | 'failed'
  | 'blocked';

interface PipelineResult {
  outcome: PipelineOutcome;
  intent: ParsedIntent;
  project: { id: string; slug: string; name: string } | null;
  environment: EnvironmentName;
  risk: RiskLevel;
  authority: AuthorityDecision | null;
  autonomy: AutonomyDecision | null;
  approvalId: string | null;
  task: TaskRecord | null;
  correlationId: string;
  explanation: Explanation;
}
```

### 2.2 `run()` Method — Step-by-Step Flow

1. **Generate correlationId** — `crypto.randomUUID()`.
2. **Parse intent** — `parseIntent(raw)` returns `ParsedIntent`.
3. **Audit `command.received`** — always recorded, including redacted normalized text.
4. **Gate ambiguity** — if `intent.status !== 'resolved'` → return `outcome: 'unknown'` with explanation citing the missing pieces. No fabrication.
5. **Resolve project scope** — `store.getProjectBySlug(ownerId, intent.project)`. If not found → `outcome: 'unknown_project'`.
6. **Compute action metadata:**
   - `environment` defaults to `'development'`.
   - `actionType` resolved via `actionTypeFor(verb, resource)` — special-cases financial/legal/account_security resources, then verb-based mapping.
   - `permission` from `VERB_PERMISSION` map (verb → permission).
   - `risk` from `riskFromAction(actionType, environment)`.
7. **Authorization check:**
   - Owner: authorized if `projectId !== null` OR `resource === 'project'`.
   - Agent: `store.agentHasPermission(agentId, projectId, resourceType, permission)`.
8. **Explicit DENY check** — reads owner preferences for `policy.explicit_deny` or `policy.deny:{actionType}`.
9. **Authority evaluation** — `evaluateAuthority(...)`.
10. **Autonomy evaluation** — `evaluateAutonomy(...)` using agent stats and owner policy.
11. **Security Guardian (Gate 2, optional)** — if wired, evaluates `SecurityRequest`. Can only be more restrictive (upgrade-only reconciliation):
    - `lockdown`/`deny` → blocked, task created as `cancelled`, audit `security.guardian_denied`.
    - `require_approval` → upgrades autonomy to `require_approval` if lower.
    - `notify` → upgrades `auto` to `notify` if applicable.
12. **Audit `authority.decision`** — recorded.
13. **Record autonomy** — for agent actors only.
14. **DENY gate** — if `autonomy.selected === 'deny'` → task created as `cancelled`, return `outcome: 'denied'`.
15. **Approval gate** — if `autonomy.selected === 'require_approval'`:
    - Requires projectId (blocks if missing).
    - Creates task as `needs_approval`.
    - Validates no duplicate pending approval via `validateNewApproval()`.
    - Creates approval record.
    - Returns `outcome: 'waiting_approval'`.
16. **AUTO / NOTIFY path** — requires projectId, creates task as `queued`, executes immediately.
17. **Execution** — `executeTask()` patches task to `running`, creates a `TaskRun`, calls `this.execution.execute()`.
    - **Success:** completes run, records cost if > 0, patches task to `completed`, records audit `task.completed`, records decision, returns `outcome: 'executed'`.
    - **Failure:** completes run as `failed`, calls `handleTaskFailure()` for bounded retry. If `stopped` (attempts exhausted) → `outcome: 'failed'`. If re-queued → `outcome: 'retry_pending'`.

### 2.3 Verb-to-Permission Mapping

| Verb | Permission | ActionType |
|------|-----------|------------|
| read | read | read |
| write | write | write |
| create | write | write |
| update | write | write |
| delete | write | delete |
| execute | execute | execute |
| deploy | execute | deploy |
| approve | approve | approve |
| reject | approve | approve |
| cancel | execute | cancel |
| plan | read | plan |
| research | read | research |
| ask | read | ask |
| list | read | read |
| status | read | read |

### 2.4 Special ActionType Overrides (`actionTypeFor`)

Resource-based overrides (checked first):
- `credit`, `funding`, `money`, `transfer` → `'financial'`
- `legal`, `contract` → `'legal'`
- `account`, `security`, `access`, `secret`, `keys` → `'account_security'`

Verb-based fallback: `deploy` → `'deploy'`, `delete` → `'delete'`, `execute` → `'execute'`, else from `VERB_ACTION_TYPE`.

---

## 3. Intent Parser (`intent.ts`)

**File:** `src/core/intent.ts` (181 lines)  
**Status:** IMPLEMENTED | **Evidence:** source inspection

### 3.1 `VERBS` — ActionVerb Keyword Map

| ActionVerb | Keywords |
|-----------|----------|
| `read` | read, show, view, open |
| `write` | write, edit, modify, update, change |
| `create` | create, new, add, start, begin |
| `update` | update, edit, change, modify, set |
| `delete` | delete, remove, destroy, drop, archive |
| `execute` | execute, run, launch, do, perform, build |
| `deploy` | deploy, release, publish, ship |
| `approve` | approve, authorize, accept, confirm |
| `reject` | reject, decline, deny, refuse |
| `cancel` | cancel, abort, stop, kill |
| `plan` | plan, design, architect, propose, outline |
| `research` | research, investigate, analyze, explore, find |
| `ask` | ask, what, how, why, which, who, where, when, help, ? |
| `list` | list, ls |
| `status` | status, health, report, state |
| `unknown` | *(empty — fallback)* |

### 3.2 `RESOURCES` — Resource Detection Map

| Token | Canonical Resource |
|-------|-------------------|
| task, tasks | `task` |
| project, projects | `project` |
| agent, agents | `agent` |
| approval, approvals, approve | `approval` |
| model, models | `model` |
| runtime, runtimes | `runtime` |
| passport | `passport` |
| cost, costs | `cost` |
| audit | `audit` |
| preference, preferences | `preference` |
| decision, decisions | `decision` |
| deploy, deployment | `deploy` |
| credit, funding, money, transfer | `credit` |
| contract | `contract` |
| legal | `legal` |
| account | `account` |
| security | `security` |
| access | `access` |
| secret, keys | `secret` |

### 3.3 `ACTION_VERBS` — Verbs Requiring a Concrete Resource

```
write, create, update, delete, execute, deploy, approve, reject, cancel
```

### 3.4 Detection Functions

**`detectVerb(tokens, rawNorm)`** — Iterates `VERBS` entries; first keyword match wins. `?` keyword matched via `rawNorm.includes('?')`. Returns `'unknown'` if no match.

**`detectResource(tokens)`** — Scans tokens against `RESOURCES` map. Returns `{ resource, count }` where `count` tracks distinct resources found (used to detect ambiguity).

**`detectProject(rawNorm)`** — Three regex patterns in priority order:
1. `@([a-z0-9][a-z0-9-_]*)` — @project shorthand
2. `(?:^|\s)(?:in|for|on|under)\s+([a-z0-9][a-z0-9-_]*)` — preposition pattern
3. `project\s+([a-z0-9][a-z0-9-_]*)` — explicit "project X"

**`detectEnvironment(tokens)`** — Checks for production/prod, staging/stage, development/dev keywords.

**`detectTarget(rawNorm, tokens, project, environment)`** — Extracts the object of the action. Prioritizes quoted strings, then meaningful tokens not in STOP words, verb keywords, resources, project slug, or environment.

### 3.5 `parseIntent()` — Status Resolution

```
status = 'unknown'     if verb === 'unknown' OR missing.length > 0
status = 'ambiguous'   if resourceCount > 1
status = 'resolved'    otherwise
```

**Missing pieces tracked** (never fabricated):
- `'command text'` — empty input
- `'action verb'` — unknown verb
- `'resource'` — action verb without resource
- `'project (task is project-scoped)'` — task resource without project
- `'environment (deployment requires explicit environment)'` — deploy without env

### 3.6 `ParsedIntent` Output Shape

```typescript
interface ParsedIntent {
  status: 'resolved' | 'ambiguous' | 'unknown';
  verb: ActionVerb;
  resource: string | null;
  project: string | null;
  environment: EnvironmentName | null;
  target: string | null;
  confidence: 'high' | 'medium' | 'low';  // high only when resolved
  missing: string[];
  normalized: string;
}
```

---

## 4. Authority Matrix (`authority.ts`)

**File:** `src/core/authority.ts` (149 lines)  
**Status:** IMPLEMENTED | **Evidence:** source inspection

### 4.1 `PROTECTED_ACTION_TYPES`

```typescript
new Set(['delete', 'deploy', 'financial', 'legal', 'account_security', 'credit'])
```

These action types **always default to `REQUIRE_APPROVAL`** regardless of environment or history. They cannot be downgraded by autonomy escalation.

### 4.2 `riskFromAction(actionType, environment)` — Risk Escalation

| actionType | development | staging | production |
|-----------|-------------|---------|------------|
| `delete` | high | high | high |
| `deploy` | high | high | **critical** |
| `financial` | critical | critical | critical |
| `legal` | critical | critical | critical |
| `account_security` | critical | critical | critical |
| `execute` | medium | medium | **high** |
| *(any other, production)* | — | — | **medium** |
| *(any other, non-prod)* | low | low | — |

### 4.3 `evaluateAuthority(req)` — 10 Rules (First Match Wins)

| Rule | Condition | Outcome |
|------|-----------|---------|
| **0** | `req.explicitDeny === true` | `deny` — "Explicit owner DENY policy — DENY always wins." |
| **1** | `req.authorized === false` | `deny` — "{actorType} is not authorized for {permission}:{resourceType}." |
| **2** | Agent + approve permission | `deny` — "Approval authority is owner-only." |
| **3** | `PROTECTED_ACTION_TYPES.has(actionType)` | `require_approval` — "Protected action class defaults to REQUIRE_APPROVAL." |
| **4** | `risk === 'critical'` | `require_approval` — "Critical risk requires approval." |
| **5** | Production + (write OR execute) | `require_approval` — "Production write/execute requires approval." |
| **6** | `permission === 'read'` | `auto` — "Read access is auto-approved for authorized actor." |
| **7** | `permission === 'execute'` | `notify` — "Execute in non-production runs with NOTIFY." |
| **8** | `permission === 'write'` | `notify` — "Write in non-production runs with NOTIFY." |
| **9** | *(fallback)* | `notify` — "Admin-level action in non-protected context runs with NOTIFY." |

### 4.4 `AuthorityRequest` Input

```typescript
interface AuthorityRequest {
  actorId: string;
  actorType: 'owner' | 'agent';
  projectId: string | null;
  environment: EnvironmentName;
  resourceType: string;
  permission: Permission;
  risk: RiskLevel;
  actionType: string;
  authorized: boolean;
  explicitDeny: boolean;
}
```

### 4.5 `AuthorityDecision` Output

```typescript
interface AuthorityDecision {
  outcome: AutonomyLevel;  // 'auto' | 'notify' | 'require_approval' | 'deny'
  risk: RiskLevel;
  reason: string;
  evidence: string[];
  denied: boolean;
  actionType?: string;     // mutated after creation by pipeline
}
```

### 4.6 `clampAutonomy(level)`

Passthrough — returns the input level unchanged. Placeholder for future clamping logic.

---

## 5. Adaptive Autonomy (`autonomy.ts`)

**File:** `src/core/autonomy.ts` (83 lines)  
**Status:** IMPLEMENTED | **Evidence:** source inspection

### 5.1 Thresholds

```typescript
ESCALATION_MIN_SUCCESS_RATE = 0.8   // 80%+ success required
ESCALATION_MIN_HISTORY = 5          // 5+ historical actions required
```

### 5.2 `evaluateAutonomy(input)` — Decision Flow

1. **DENY wins** — if `authority.outcome === 'deny'` → selected: `'deny'`. Cannot be overridden.
2. **Owner policy** — if explicit owner policy exists and is not `'deny'` → applied directly.
3. **Protected classes** — if `actionType` in `PROTECTED_ACTION_TYPES` → selected: `'require_approval'`. Cannot be escalated by success.
4. **REQUIRE_APPROVAL** — stays `'require_approval'`. Autonomy never downgrades protection.
5. **AUTO** — stays `'auto'`. Authority confirmed.
6. **NOTIFY** — bounded one-step escalation:
   - If `successRate >= 0.8` AND `historyCount >= 5` → escalates to `'auto'`.
   - Otherwise stays `'notify'`.
7. **Unknown outcome** — fallback to `'require_approval'`.

### 5.3 `AutonomyDecision` Output

```typescript
interface AutonomyDecision {
  selected: 'auto' | 'notify' | 'require_approval' | 'deny';
  evidence: string[];
  reason: string;
}
```

### 5.4 `AutonomyInput`

```typescript
interface AutonomyInput {
  authority: AuthorityDecision;
  successRate: number;      // 0..1
  historyCount: number;
  ownerPolicy: AutonomyLevel | null;
}
```

---

## 6. Approval Engine (`approval.ts`)

**File:** `src/core/approval.ts` (62 lines)  
**Status:** IMPLEMENTED | **Evidence:** source inspection

### 6.1 Approval States

```typescript
APPROVAL_TERMINAL = new Set(['approved', 'rejected', 'denied', 'expired', 'cancelled'])
```

Full status set: `pending | approved | rejected | denied | expired | cancelled`

### 6.2 `validateNewApproval(existingPending, input)`

- Returns `'approval action is required'` if action is blank.
- Returns `'one pending approval already exists for task {taskId} action {action}'` if duplicate pending found.
- Returns `null` if valid.

### 6.3 `resolveApproval(input)` — State Machine

- If approval is already in a terminal state → returns error `"approval already in terminal state {status}"`.
- Otherwise transitions to requested status (`approved` | `rejected` | `denied`), recording `decision`, `decidedBy`, `decidedAt`.

### 6.4 `isExpired(approval, now?)`

- Returns `false` if no `expiresAt`.
- Otherwise compares `now` against `expiresAt` timestamp.

### 6.5 How Approval Requests Are Created

The pipeline creates approvals when `autonomy.selected === 'require_approval'`:
1. Task is created with status `'needs_approval'`.
2. Existing pending approvals are checked for duplicates via `store.listApprovals()`.
3. `validateNewApproval()` enforces uniqueness.
4. Approval is created via `store.createApproval()` with `projectId`, `taskId`, `action`, `riskLevel`, `authorityLevel`, `requestedBy`.

---

## 7. Task Engine (`taskEngine.ts`)

**File:** `src/core/taskEngine.ts` (83 lines)  
**Status:** IMPLEMENTED | **Evidence:** source inspection

### 7.1 Constants

```typescript
DEFAULT_MAX_ATTEMPTS = 3
TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled'])
```

### 7.2 Task Statuses

```typescript
'created' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'needs_approval'
```

### 7.3 Allowed Transitions

| From | Allowed To |
|------|-----------|
| `created` | queued, needs_approval, cancelled |
| `queued` | running, paused, cancelled |
| `running` | completed, failed, paused, cancelled |
| `needs_approval` | queued, paused, cancelled |
| `paused` | queued, cancelled |
| `failed` | queued, cancelled |
| `completed` | *(none — terminal)* |
| `cancelled` | *(none — terminal)* |

### 7.4 Key Functions

**`canTransition(from, to)`** — checks `TRANSITIONS` map.  
**`assertTransition(from, to)`** — returns error string or `null`.  
**`transitionTask(task, to, extra?)`** — applies transition, sets `startedAt` on `running`, `completedAt` on terminal statuses. Returns `{ task, transitioned, error, stopped }`.

### 7.5 `handleTaskFailure(task, error)` — Bounded Retry

```
attempts = task.attempts + 1
exhausted = attempts >= (task.maxAttempts || DEFAULT_MAX_ATTEMPTS)
```

- **Not exhausted:** status → `'queued'`, attempts incremented, `stopped: false`. Task is re-queued for bounded retry (no automatic retry loop).
- **Exhausted:** status → `'failed'`, `completedAt` set, `stopped: true`. State preserved for owner intervention.

### 7.6 `retryCapReached(task)`

Returns `true` when `task.attempts >= (task.maxAttempts || DEFAULT_MAX_ATTEMPTS)`.

---

## 8. Types System (`types.ts`)

**File:** `src/core/types.ts` (389 lines)  
**Status:** IMPLEMENTED | **Evidence:** source inspection

### 8.1 Core Enums

| Type | Values |
|------|--------|
| `AutonomyLevel` | `'auto'`, `'notify'`, `'require_approval'`, `'deny'` |
| `TaskStatus` | `'created'`, `'queued'`, `'running'`, `'completed'`, `'failed'`, `'cancelled'`, `'paused'`, `'needs_approval'` |
| `TaskRunStatus` | `'running'`, `'completed'`, `'failed'`, `'cancelled'`, `'timeout'` |
| `ApprovalStatus` | `'pending'`, `'approved'`, `'rejected'`, `'denied'`, `'expired'`, `'cancelled'` |
| `RiskLevel` | `'low'`, `'medium'`, `'high'`, `'critical'` |
| `EnvironmentName` | `'development'`, `'staging'`, `'production'` |
| `Permission` | `'read'`, `'write'`, `'execute'`, `'approve'`, `'admin'` |
| `CostType` | `'model'`, `'runtime'`, `'tool'`, `'mission'`, `'project'` |
| `BilledTo` | `'project'`, `'mission'`, `'owner'` |
| `IntentStatus` | `'resolved'`, `'ambiguous'`, `'unknown'` |

### 8.2 `ActionVerb`

```
'read' | 'write' | 'create' | 'update' | 'delete' | 'execute' | 'deploy'
| 'approve' | 'reject' | 'cancel' | 'plan' | 'research' | 'ask'
| 'list' | 'status' | 'unknown'
```

### 8.3 Key Data Types

**`ParsedIntent`** — see §3.6.  
**`AuthorityRequest` / `AuthorityDecision`** — see §4.4 / §4.5.  
**`AutonomyInput` / `AutonomyDecision`** — see §5.3 / §5.4.

**`ProjectRecord`:**
```typescript
{ id, ownerId, name, slug, description, status: 'draft'|'active'|'paused'|'archived'|'deleted', metadata, createdAt, updatedAt }
```

**`PassportRecord`:** 15 JSON sections (identity, technology, repository, databaseRef, environments, deployment, dependencies, models, runtimes, businessModel, status, risks, credentialsReferences, operationalHealth, documentationState).

**`TaskRecord`:**
```typescript
{ id, ownerId, projectId, environmentId, parentTaskId, agentId, title, description, status, priority: 'low'|'medium'|'high'|'critical', riskLevel, authorityLevel, autonomy, approvalRequired, inputs, output, error, attempts, maxAttempts, correlationId, createdBy, createdAt, startedAt, completedAt, updatedAt }
```

**`TaskRunRecord`:**
```typescript
{ id, taskId, runNumber, status, modelId, runtimeId, inputSnapshot, outputSnapshot, error, durationMs, cost, startedAt, completedAt }
```

**`ApprovalRecord`:**
```typescript
{ id, ownerId, projectId, taskId, agentId, action, description, riskLevel, authorityLevel, status, decision, decisionReason, requestedBy, decidedBy, expiresAt, decidedAt, createdAt }
```

**`ModelInfo`:**
```typescript
{ id, provider, name, slug, capability, contextWindow, costPer1kInput, costPer1kOutput, status: 'active'|'limited'|'retired' }
```

**`RuntimeInfo`:**
```typescript
{ id, name, version, slug, capability, costPerHour, status: 'active'|'limited'|'retired' }
```

**`CostEvent`:**
```typescript
{ ownerId, projectId, taskId, runId, agentId, costType, amount, currency, provider, modelId, runtimeId, billedTo, metadata }
```

**`BudgetLimit`:**
```typescript
{ projectId, period: 'day'|'month', maxAmount }
```

**`DecisionRecord`:**
```typescript
{ decisionId, ownerId, projectId, context, options, selectedOption, reason, evidence, confidence, riskLevel, authorityLevel, approvedBy, outcome, createdAt }
```

**`Explanation`:**
```typescript
{ decision, why, evidence: string[], confidence: number|null, risk: RiskLevel, outcome: string }
```

**`ProjectHealth`:**
```typescript
{ projectId, projectName, activeTasks, blockedTasks, failures, pendingApprovals, cost, health: 'healthy'|'attention'|'critical' }
```

**`DailyStatus`:**
```typescript
{ generatedAt, projects: ProjectHealth[], activeTasks, blockedTasks, failures, pendingApprovals, cost, alerts: string[], decisionsRequired: string[] }
```

**`RecallItem`:**
```typescript
{ id, category, title, summary, projectId, confidence, createdAt }
```

**`LessonInput`:**
```typescript
{ title, summary, category, projectId, confidence }
```

**`SecretRef`:**
```typescript
{ key, present, source }
```

**`ToolCallRequest` / `ToolCallResult`:**
```typescript
Request: { tool, args, actorId, actorType, projectId, environment, risk }
Result: { ok, tool, action, outcome, metadata }
```

**`AuditEvent`:**
```typescript
{ actorType: 'owner'|'agent'|'system', actorId, action, projectId, environmentId, resourceType, resourceId, authorizationResult, correlationId, taskId, metadata }
```

---

## 9. Supporting Modules

### 9.1 `explanation.ts` — **IMPLEMENTED** | source inspection

**Exports:** `buildExplanation(input)`, `isCompleteExplanation(e)`, `autonomyLabel(a)`.

- `buildExplanation` constructs an `Explanation` from `ExplanationInput`, defaulting evidence to `[]`, confidence to `null`, outcome to `'pending'`.
- `isCompleteExplanation` returns `false` if decision or why is empty/whitespace, or if decision is literally `"Done."`.
- `autonomyLabel` maps `AutonomyLevel` to human-readable label.

**Tests:** `explanation.test.ts` — 4 tests covering field defaults, `"Done."` rejection, and empty field rejection.

### 9.2 `redact.ts` — **IMPLEMENTED** | source inspection

**Exports:** `redactText(text)`, `redactDeep(value)`.

**Patterns scrubbed:**
1. JWT tokens (`eyJ...`)
2. Supabase tokens (`sbp_...`)
3. OpenAI-style keys (`sk-...`)
4. Key=value pairs for common secret names (password, secret, token, api_key, access_key, bearer, etc.)

Applied to all command text before audit/task storage.

### 9.3 `ports.ts` — **IMPLEMENTED** | source inspection

**Export:** `Store` interface (persistence contract), `TaskPatch`, `ApprovalPatch`, `BudgetReport`, `AgentStats`.

The `Store` interface defines 30+ methods covering:
- Agents / permissions (`listAgents`, `agentHasPermission`, `agentStats`)
- Projects / passports (`getProjectBySlug`, `createProject`, `getPassport`, `upsertPassport`)
- Tasks (`createTask`, `getTask`, `listTasks`, `patchTask`, `createTaskRun`, `completeTaskRun`)
- Approvals (`createApproval`, `getApproval`, `listApprovals`, `patchApproval`)
- Audit (`recordAudit`)
- Costs (`recordCost`, `projectBudget`, `totalCost`)
- Preferences (`getPreferences`, `setPreference`)
- Decisions (`recordDecision`, `listDecisions`)
- Autonomy (`recordAutonomy`)
- Models / Runtimes (`listModels`, `listRuntimes`)
- Monitoring (`dailyStatus`)
- Memory (`recall`, `saveLesson`)
- Security Guardian (Gate 2): critical actions, security events, incidents, lockdown, RLS probe

**Status:** IMPLEMENTED | **Evidence:** source inspection — interface fully defined; implementations live in `repo.ts` (Supabase) and `memoryStore.ts` (tests).

### 9.4 `passport.ts` — **IMPLEMENTED** | source inspection

**Exports:** `PASSPORT_FIELDS` (15 fields), `emptyPassport(projectId)`, `mergePassport(base, patch)`, `passportSummary(p)`.

- 15 structured sections per project passport.
- `mergePassport` replaces JSON sections wholesale.
- `passportSummary` marks empty sections as `{ state: 'UNKNOWN' }` — never fabricated.

### 9.5 `monitoring.ts` — **IMPLEMENTED** | source inspection

**Export:** `Monitor` class with `dailyStatus(ownerId)`.

- Aggregates project health across all projects.
- Health thresholds: `failures > 0` → `'critical'`; `blockedTasks + failures >= threshold` (default 3) → `'attention'`; else `'healthy'`.
- Surfaces alerts (failed tasks, blocked tasks, pending approvals) and decisions required.

**Tests:** `monitoring.test.ts` — 4 tests covering critical health, attention threshold, healthy state, and pending approval surfacing.

### 9.6 `decisionJournal.ts` — **IMPLEMENTED** | source inspection

**Exports:** `validateDecision(input)`, `toDecisionRecord(input)`, `decisionDigest(d)`.

- Validates context, options (≥ 2 unless one is selected), confidence bounds (0–1), selected_option membership.
- `toDecisionRecord` builds a `DecisionRecord` with current timestamp.
- `decisionDigest` produces a deterministic JSON digest for audit correlation.

**Tests:** `decisionJournal.test.ts` — 5 tests covering validation rules and record construction.

### 9.7 `pos.ts` — **IMPLEMENTED** | source inspection

**Exports:** `NON_OVERRIDABLE_KEYS`, `validatePreference(patch)`, `resolveActivePreferences(prefs)`, `nextVersion(prefs, category, key)`.

- `NON_OVERRIDABLE_KEYS`: `security`, `isolation`, `authority`, `deny`, `explicit_deny`, `max_retries` — system policy always wins.
- `validatePreference` blocks writes to protected keys.
- `resolveActivePreferences` resolves active versioned preferences by (category, key).
- `nextVersion` computes next version number.

---

## 10. Test Coverage

| Test File | Module Tested | Tests | Key Assertions |
|-----------|--------------|-------|----------------|
| `securityGuardian.test.ts` | Security Guardian (26 topics + 10 adversarial + 5 persistence) | 41 | Precedence, deny wins, guardian never less restrictive, critical actions, lockdown, env escalation, cross-project, rate limit, cost, prompt injection, secrets, risk, events, incidents, health, anomaly thresholds, adversarial A1–A10, persistence |
| `pipeline.test.ts` | CommandPipeline.run (18 scenarios including 3 Guardian integration) | 18 | Informational command, scoped task, unknown command, unknown project, ambiguous, prod deploy approval, delete approval, explicit DENY, deny:actionType policy, owner autonomy policy, bounded retries, agent permissions, agent scope isolation, audit redaction, decision journal invariants, security guardian lockdown, guardian no-false-positive, guardian financial denial |
| `authority.test.ts` | `evaluateAuthority`, `riskFromAction` | 12 | AUTO for read, NOTIFY for dev write, REQUIRE_APPROVAL for prod write, protected classes, explicit DENY, least privilege, agent approval denial, risk escalation |
| `intent.test.ts` | `parseIntent` | 11 | Scoping, environment detection, @shorthand, ambiguity, unknown/gibberish, missing pieces, target detection |
| `taskEngine.test.ts` | `canTransition`, `handleTaskFailure`, `retryCapReached`, `transitionTask` | 8 | Happy path, invalid transitions, timestamps, failure/cancel states, bounded retries, max attempt cap, error preservation |
| `autonomy.test.ts` | `evaluateAutonomy` | 8 | DENY never overridden, protected classes not downgraded, REQUIRE_APPROVAL not downgraded, AUTO stays, NOTIFY escalation with sufficient history, owner policy, unresolved fallback |
| `modelGateway.test.ts` | ModelGateway selection logic | 8 | Cheapest capable, capability filter, status filter, no fabrication |
| `auth.test.ts` | AuthService.verifyOwner (A–H) | 8 | Valid token resolves, invalid DENIED, empty DENIED, own-owner-only, id-mismatch DENIED, no service_role, header isolation, inactive DENIED |
| `approval.test.ts` | `validateNewApproval`, `resolveApproval`, `isExpired` | 6 | Duplicate prevention, terminal state rejection, decision metadata, expiry detection, terminal set correctness |
| `toolBroker.test.ts` | Authority → execution boundary | 6 | Permission before execution, boundary enforcement |
| `decisionJournal.test.ts` | `validateDecision`, `toDecisionRecord` | 5 | Context/options requirement, 2-option minimum, confidence bounds, selected_option membership, record structure |
| `cost.test.ts` | `costForTokens`, `estimateTokens`, Monitor cost rollup | 5 | Provider-agnostic cost, token estimation, no negative charges, daily cost rollup, owner isolation |
| `memoryGateway.test.ts` | MemoryGateway (no-backend stub) | 5 | No-backend stub behavior |
| `security.test.ts` (API) | Guardian wiring to real Store | 4 | Lockdown from real Store, no false-positive, security events recorded, cost check safe defaults |
| `explanation.test.ts` | `buildExplanation`, `isCompleteExplanation` | 4 | Field presence, defaults, "Done." rejection, empty field rejection |
| `monitoring.test.ts` | `Monitor.dailyStatus` | 4 | Critical health, attention threshold, healthy state, pending approvals |
| `runtimeGateway.test.ts` | RuntimeGateway selection | 4 | Selection logic |
| `secretProvider.test.ts` | Secret boundary isolation | 4 | Boundary enforcement |
| `execution.test.ts` | ExecutionRunner (informational, no-executor) | 3 | Informational routing, no-executor fallback |

**Total:** 163+ tests across 19 test files.  
**Status:** TESTED | **Evidence:** source inspection of test files

---

## 11. Known Gaps

### 11.1 Critical Action Vocabulary Mismatch

The intent parser produces `verb` + `resource` (e.g., `create` + `task`), but the authority matrix consumes `actionType` (e.g., `write`, `delete`, `deploy`). The pipeline bridges this via `VERB_ACTION_TYPE` and `actionTypeFor()`, but the two vocabularies are not formally unified.

**Specific mismatch:**
- Intent: `project.create` (verb=create, resource=project)
- Authority: `write` (from `VERB_ACTION_TYPE['create']`)
- The authority matrix does not have a `create` actionType — it maps to `write`.

This means `create project` and `write project` are treated identically by the authority matrix. The distinction between "create" and "update" is lost after intent parsing. **UNVERIFIED** whether this causes any semantic issues in practice.

### 11.2 No `memory.ts` Module

The `Store` interface defines `recall()` and `saveLesson()` methods, but there is no `src/core/memory.ts` file. Memory/lessons functionality exists only as persistence port definitions. The actual implementation lives in the Store (Supabase or in-memory), with no core-level business logic.

**Status:** DEFERRED — no core logic module exists; functionality delegated to persistence layer.

### 11.3 No `model.ts`, `llm.ts`, `recommendation.ts`, `execution.ts`, `validation.ts`, `projectFactory.ts`, `audit.ts` in Core

These files do not exist under `src/core/`:
- **model/llm/recommendation:** Model and runtime selection types are defined in `types.ts` but selection logic lives in `src/gateways/`.
- **execution:** `ExecutionRunner` is an interface in `pipeline.ts`; implementations live outside `src/core/`.
- **validation:** No standalone validation module; validation is inline in `approval.ts`, `decisionJournal.ts`, `pos.ts`.
- **projectFactory:** No dedicated factory; project creation is via `store.createProject()`.
- **audit:** Audit recording is via `store.recordAudit()`; no standalone audit module.

**Status:** NOT_APPLICABLE — these are either interfaces (delegated to implementations) or do not require standalone core modules.

### 11.4 Security Guardian — Gate 2 Not Fully Documented Here

The Security Guardian (`src/core/security/`) is a substantial subsystem (15 files) that runs as Gate 2. It is wired into the pipeline as an optional constructor parameter. This document covers only its integration point (§2.2, step 11). Full security guardian documentation belongs in a separate as-built document.

**Status:** BLOCKED on dedicated security as-built document.
