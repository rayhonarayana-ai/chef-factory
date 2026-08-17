# CHEF FACTORY — As-Built API Reference

**Status:** LIVE_VERIFIED | **Evidence:** live-runner 9/9 PASS, auth.test.ts 8/8
**Last Verified:** 2026-08-16
**Source files:** `src/api/server.ts`, `src/api/handlers.ts`, `src/api/auth.ts`, `src/api/security.ts`, `src/api/execution.ts`, `src/core/pipeline.ts`, `src/core/intent.ts`

---

## 1. Server Architecture

| Property | Value |
|---|---|
| Runtime | Node.js `http.createServer` (raw module — NOT express, NOT fastify) |
| Default host | `127.0.0.1` (env `FACTORY_API_HOST`) |
| Default port | `8787` (env `FACTORY_API_PORT`) |
| Body parser | Custom `readBody()` — manual chunk collection + `JSON.parse` (`server.ts:110-124`) |
| Static UI | Served from `public/` directory with path traversal guard (`normalize + startsWith`) (`server.ts:132-146`) |

### Request/Response Flow

```
Incoming HTTP request
  ├─ /api/health          → send(200, { ok, service, time })     [no auth]
  ├─ /api/config          → send(200, { supabaseUrl, anonKey })  [no auth]
  ├─ /api/* (any)
  │    ├─ matchRoute()        → 404 if no pattern match
  │    ├─ Bearer token check  → 401 if missing
  │    ├─ auth.verifyOwner()  → 401 if null
  │    ├─ readBody()          → parse JSON body (or {} if empty)
  │    ├─ api.handle()        → HandlerResult { status, json }
  │    └─ send()              → JSON.stringify + redact → response
  └─ /* (other)           → serveStatic() from public/
```

### The `send()` Function — Gate 2 Fix

```typescript
// server.ts:126-130
async function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  const payload = contentType.startsWith('application/json')
    ? getRedactor().redact(JSON.stringify(body ?? {}))   // SINGLE stringify + redact
    : (body as string);
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(payload);
}
```

**Gate 2 fix:** The body is `JSON.stringify`-d exactly once, then passed through the redactor. Prior to the fix, double-encoding produced escaped JSON strings. The redactor (`src/api/redact.ts`) scrubs known secret values before the payload hits the wire.

---

## 2. Authentication Middleware

**Source:** `src/api/auth.ts`

### `AuthService.verifyOwner(token: string): Promise<SessionOwner | null>`

Two-step server-side verification, fail-closed:

| Step | Mechanism | Failure |
|---|---|---|
| 1. Validate JWT | `supabase.auth.getUser(token)` — real server-side JWT validation against Supabase Auth | Returns `null` → 401 |
| 2. Resolve owner row | `fetch({supabaseUrl}/rest/v1/owners?select=id,email,status&id=eq.{userId})` with caller's own `Authorization: Bearer {token}` header — RLS evaluates `auth.uid()` | Returns `null` → 401 |

**Critical security properties (proven by auth.test.ts A–H):**

| Test | Property |
|---|---|
| A | Valid token resolves the active owner |
| B | Invalid JWT is DENIED |
| C | Empty/missing token is DENIED |
| D | Token resolves only its own owner (never cross-owner) |
| E | Owner row `id` must match JWT `sub` (anti-spoofing) |
| F | PostgREST query carries ONLY the caller's Bearer token (RLS enforcement) |
| G | `service_role` key is NEVER used on the owner-resolution path |
| H | Inactive owner (`status != 'active'`) is DENIED (fail closed) |

### `SessionOwner` Interface

```typescript
{ id: string; email: string }
```

**Owner scoping:** Every subsequent handler call receives the `owner` object. All store queries are owner-scoped via PostgREST RLS (`owner_id = $1` in raw queries, RLS policies for supabase-js paths).

---

## 3. Complete Endpoint Inventory

All endpoints require `Authorization: Bearer <token>` unless noted. Request bodies are JSON.

### 3.1 Unauthenticated Endpoints

| # | Method | Path | Purpose | Auth | Response |
|---|---|---|---|---|---|
| 1 | `GET` | `/api/health` | Liveness probe | **None** | `{ ok: true, service: "chef-factory", time: "<ISO>" }` |
| 2 | `GET` | `/api/config` | Public client bootstrap (Supabase URL + anon key by design) | **None** | `{ supabaseUrl: string, anonKey: string }` |

### 3.2 Authenticated Endpoints

#### Identity

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 3 | `GET` | `/api/me` | Current authenticated owner | — | `{ id: string, email: string }` | Yes (from token) |

#### Chat / Command Pipeline

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 4 | `POST` | `/api/chat` | Submit natural-language command to CommandPipeline | `{ command: string }` | `PipelineResult` (see §4) | Yes |

**Error:** `{ error: "command is required" }` if `command` is empty or missing (400).

#### Projects

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 5 | `GET` | `/api/projects` | List owner's projects | — | `{ projects: ProjectRecord[] }` | Yes (RLS) |
| 6 | `POST` | `/api/projects` | Create project | `{ name: string, slug: string, description?: string }` | `{ project: ProjectRecord }` | Yes (RLS insert) |

**POST validation:** Both `name` and `slug` are required (400 if missing). Audit event `project.created` is recorded.

#### Passports

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 7 | `GET` | `/api/passports/:projectId` | Get project passport + summary | — | `{ passport: PassportRecord, summary: ... }` | Yes |
| 8 | `PUT` | `/api/passports/:projectId` | Upsert passport fields | `{ patch: Record<string, unknown> }` | `{ passport: PassportRecord }` | Yes |

**GET errors:** 400 if `projectId` param missing; 404 if passport not found.

#### Agents

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 9 | `GET` | `/api/agents` | List owner's agents | — | `{ agents: AgentRecord[] }` | Yes (RLS) |

**Note:** There is NO `POST /api/agents` endpoint in the implemented code. Agent creation is not exposed via the API.

#### Tasks

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 10 | `GET` | `/api/tasks` | List tasks (filterable) | `{ projectId?: string, status?: TaskStatus }` | `{ tasks: TaskRecord[] }` | Yes (RLS) |

#### Approvals

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 11 | `GET` | `/api/approvals` | List approvals (filterable) | `{ projectId?: string, status?: ApprovalStatus }` | `{ approvals: ApprovalRecord[] }` | Yes |
| 12 | `POST` | `/api/approvals/:approvalId/decision` | Approve, reject, or deny an approval | `{ decision: "approved"\|"rejected"\|"denied", reason?: string }` | `{ approval: ApprovalRecord, task: TaskRecord\|null }` | Yes |

**Decision logic (`handlers.ts:111-156`):**
- Validates `approvalId` param (400 if missing)
- Validates `decision` is one of `approved|rejected|denied` (400 if not)
- Calls `resolveApproval()` for state machine transition
- 409 if transition is invalid
- On `approved`: linked task transitions to `queued`
- On `rejected|denied`: linked task transitions to `cancelled`
- Audit event `approval.{status}` recorded

#### Costs

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 13 | `GET` | `/api/costs` | Per-project cost summary + grand total | — | `{ costs: [{ projectId, name, cost, budget }], total: number }` | Yes |

#### Audit

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 14 | `GET` | `/api/audit` | Query audit events (raw SQL, owner-scoped) | `{ limit?: number }` (default 50, max 200) | `{ audit: AuditEvent[] }` | Yes (SQL: `project_id in (select id from projects where owner_id = $1)`) |

**Note:** Audit query uses direct SQL via `pool.query()` rather than the Store abstraction. Results are passed through `redactForLog()`.

#### Daily Status

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 15 | `GET` | `/api/status` | Daily operational status (project health, tasks, costs, alerts) | — | `{ status: DailyStatus }` | Yes |

#### Preferences (POS)

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 16 | `GET` | `/api/prefs` | Get all owner preferences | — | `{ prefs: Record<string, unknown> }` | Yes |
| 17 | `PUT` | `/api/prefs` | Set a preference (category/key/value) | `{ category: string, key: string, value: unknown }` | `{ prefs: Record<string, unknown> }` | Yes |

**Validation:** `validatePreference()` from `src/core/pos.ts` validates before persisting (400 on error).

#### Registries

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 18 | `GET` | `/api/models` | List registered AI model providers | — | `{ models: ModelInfo[] }` | Yes |
| 19 | `GET` | `/api/runtimes` | List registered runtime adapters | — | `{ runtimes: RuntimeInfo[] }` | Yes |

#### Decision Journal

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 20 | `GET` | `/api/decisions` | List all recorded decisions | — | `{ decisions: DecisionRecord[] }` | Yes |

#### Security — Guardian

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 21 | `GET` | `/api/security/health` | Security health check (RLS probe + lockdown status) | — | `{ health: SecurityHealth, lockdown: LockdownRecord\|null }` | Yes |
| 22 | `GET` | `/api/security/events` | Query security events | `{ eventType?: string, severity?: string, limit?: number }` (default 100, max 500) | `{ events: SecurityEvent[] }` | Yes |
| 23 | `GET` | `/api/security/incidents` | List security incidents | `{ status?: string, limit?: number }` (default 100, max 500) | `{ incidents: IncidentRecord[] }` | Yes |
| 24 | `POST` | `/api/security/incidents` | Create a security incident | `{ title: string, description?: string, eventIds?: string[] }` | `{ incident: IncidentRecord }` | Yes |

**POST validation:** `validateIncidentInput()` from `src/core/security/incidents.ts` (400 on empty title).

| 25 | `GET` | `/api/security/critical-actions` | List critical actions log | — | `{ version: 1, criticalActions: CriticalAction[] }` | Yes |

#### Security — Lockdown

| # | Method | Path | Purpose | Request Body | Response | Owner-Scoped |
|---|---|---|---|---|---|---|
| 26 | `GET` | `/api/security/lockdown` | Get active lockdown status | — | `{ lockdown: LockdownRecord\|null }` | Yes |
| 27 | `POST` | `/api/security/lockdown` | Activate lockdown | `{ reason: string, scope?: string }` (default scope: `"all"`) | `{ lockdown: LockdownRecord }` | Yes |

**Validation:** `reason` is required (400 if empty). Audit event `security.lockdown_activated` recorded.

| 28 | `POST` | `/api/security/lockdown/release` | Release an active lockdown | `{ lockdownId: string, reason: string }` | `{ lockdown: LockdownRecord }` | Yes |

**Validation:** Both `lockdownId` and `reason` are required (400 if missing). 404 if lockdown not found. Audit event `security.lockdown_released` recorded.

### 3.3 Endpoints NOT Implemented

The following endpoints were **speculated** in planning but do NOT exist in the as-built code:

| Method | Path | Status |
|---|---|---|
| `POST` | `/api/agents` | **NOT_APPLICABLE** — No route defined; agent creation not exposed |
| `DELETE` | `/api/projects` | **NOT_APPLICABLE** — No route defined |
| `DELETE` | `/api/agents` | **NOT_APPLICABLE** — No route defined |
| `GET` | `/api/security/rate-limits` | **NOT_APPLICABLE** — No route defined; rate limiting is internal to SecurityGuardian |
| `GET` | `/api/security/test` | **NOT_APPLICABLE** — No route defined |

---

## 4. Command Pipeline (`POST /api/chat`)

**Source:** `src/core/pipeline.ts`, `src/core/intest.ts`

### 4.1 Intent Parsing

`parseIntent(raw: string)` produces a `ParsedIntent`:

```typescript
{
  status: 'resolved' | 'ambiguous' | 'unknown',
  verb: ActionVerb,
  resource: string | null,
  project: string | null,         // slug extracted from @slug / "in slug" / "project slug"
  environment: EnvironmentName | null,  // only if explicitly stated
  target: string | null,
  confidence: 'high' | 'medium' | 'low',
  missing: string[],              // what is UNKNOWN — never fabricated
  normalized: string,             // lowercased, punctuation-stripped
}
```

#### VERBS (16 ActionVerbs)

| Verb | Keyword Triggers | Permission | Action Type |
|---|---|---|---|
| `read` | read, show, view, open | read | read |
| `write` | write, edit, modify, update, change | write | write |
| `create` | create, new, add, start, begin | write | write |
| `update` | update, edit, change, modify, set | write | write |
| `delete` | delete, remove, destroy, drop, archive | write | delete |
| `execute` | execute, run, launch, do, perform, build | execute | execute |
| `deploy` | deploy, release, publish, ship | execute | deploy |
| `approve` | approve, authorize, accept, confirm | approve | approve |
| `reject` | reject, decline, deny, refuse | approve | approve |
| `cancel` | cancel, abort, stop, kill | execute | cancel |
| `plan` | plan, design, architect, propose, outline | read | plan |
| `research` | research, investigate, analyze, explore, find | read | research |
| `ask` | ask, what, how, why, which, who, where, when, help, ? | read | ask |
| `list` | list, ls | read | read |
| `status` | status, health, report, state | read | read |
| `unknown` | (no matches) | read | read |

#### RESOURCES (34 resource tokens, mapped to canonical names)

| Input Tokens | Canonical Resource |
|---|---|
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
| credit, funding, money, transfer | `credit` (triggers `financial` action type) |
| contract | `contract` |
| legal | `legal` |
| account | `account` (triggers `account_security` action type) |
| security | `security` |
| access | `access` (triggers `account_security` action type) |
| secret, keys | `secret` (triggers `account_security` action type) |

#### Project Detection Patterns

1. `@slug` — `rawNorm.match(/@([a-z0-9][a-z0-9-_]*)/)`
2. `in|for|on|under + slug` — `(?:^|\s)(?:in|for|on|under)\s+([a-z0-9][a-z0-9-_]*)`
3. `project + slug` — `project\s+([a-z0-9][a-z0-9-_]*)`

#### Environment Detection

| Token(s) | Environment |
|---|---|
| `production`, `prod` | `production` |
| `staging`, `stage` | `staging` |
| `development`, `dev` | `development` |

**Default:** `development` (applied when no environment detected and pipeline proceeds).

#### Ambiguity Rules

- `status = 'unknown'` when: verb is `unknown` OR required fields missing (action verb without resource, task without project, deploy without environment)
- `status = 'ambiguous'` when: multiple distinct resources detected in one command
- `status = 'resolved'` when: all required fields present, single resource detected

### 4.2 Pipeline Flow

```
CommandPipeline.run(actorCtx, rawCommand)
  │
  ├─ 1. parseIntent(raw) → ParsedIntent
  ├─ 2. Audit: command.received
  ├─ 3. Ambiguity check → 'unknown' → blocked (never fabricated)
  ├─ 4. Project scope resolution (getProjectBySlug) → 'unknown_project' if not found
  ├─ 5. Environment (default: 'development')
  ├─ 6. Action type derivation (financial/legal/account_security/deploy/delete/execute/etc.)
  ├─ 7. Risk assessment (riskFromAction)
  ├─ 8. Authority evaluation (evaluateAuthority)
  │     └─ Owner: always authorized for own projects
  │     └─ Agent: agentHasPermission() check
  ├─ 9. POS explicit deny check (policy preferences)
  ├─ 10. Autonomy evaluation (evaluateAutonomy)
  ├─ 11. Security Guardian evaluation (Gate 2, optional)
  │       ├─ lockdown/deny → DENIED
  │       ├─ require_approval → upgrade-only (never downgrade)
  │       └─ notify → upgrade-only (never downgrade)
  ├─ 12. DENY path → task (cancelled) + audit + return
  ├─ 13. Approval gate (require_approval)
  │       ├─ Create task (needs_approval)
  │       ├─ Create approval record
  │       └─ Return waiting_approval
  └─ 14. AUTO/NOTIFY path
          ├─ Create task (queued)
          ├─ Execute task (ExecutionRunner)
          ├─ Record task run
          ├─ On success: complete task, record cost, audit
          └─ On failure: handleTaskFailure (bounded retries, maxAttempts ≤ 3)
```

### 4.3 PipelineResult Envelope

```typescript
{
  outcome: PipelineOutcome,     // 'executed' | 'waiting_approval' | 'denied' | 'unknown' | 'unknown_project' | 'retry_pending' | 'failed' | 'blocked'
  intent: ParsedIntent,         // full parsed intent (see §4.1)
  project: { id, slug, name } | null,
  environment: EnvironmentName,
  risk: RiskLevel,              // 'low' | 'medium' | 'high' | 'critical'
  authority: AuthorityDecision | null,
  autonomy: AutonomyDecision | null,
  approvalId: string | null,
  task: TaskRecord | null,
  correlationId: string,        // crypto.randomUUID()
  explanation: Explanation      // { decision, why, evidence[], confidence, risk, outcome }
}
```

**Constraint:** The pipeline throws if the explanation is incomplete (`isCompleteExplanation` check in `result()` at `pipeline.ts:601`).

---

## 5. Response Format

### Success (status 200)

All success responses use the `ok()` helper, which wraps the data in a `HandlerResult`:

```json
{ "status": 200, "json": { ... } }
```

Response body patterns by endpoint:

| Endpoint Pattern | Response Shape |
|---|---|
| `GET /api/me` | `{ id, email }` |
| `GET /api/projects` | `{ projects: [...] }` |
| `POST /api/projects` | `{ project: {...} }` |
| `GET /api/passports/:id` | `{ passport: {...}, summary: {...} }` |
| `PUT /api/passports/:id` | `{ passport: {...} }` |
| `GET /api/agents` | `{ agents: [...] }` |
| `GET /api/tasks` | `{ tasks: [...] }` |
| `GET /api/approvals` | `{ approvals: [...] }` |
| `POST /api/approvals/:id/decision` | `{ approval: {...}, task: {...} }` |
| `GET /api/costs` | `{ costs: [...], total: number }` |
| `GET /api/audit` | `{ audit: [...] }` |
| `GET /api/status` | `{ status: {...} }` |
| `GET /api/prefs` | `{ prefs: {...} }` |
| `PUT /api/prefs` | `{ prefs: {...} }` |
| `GET /api/models` | `{ models: [...] }` |
| `GET /api/runtimes` | `{ runtimes: [...] }` |
| `GET /api/decisions` | `{ decisions: [...] }` |
| `GET /api/security/health` | `{ health: {...}, lockdown: {...}|null }` |
| `GET /api/security/events` | `{ events: [...] }` |
| `GET /api/security/incidents` | `{ incidents: [...] }` |
| `POST /api/security/incidents` | `{ incident: {...} }` |
| `GET /api/security/critical-actions` | `{ version: 1, criticalActions: [...] }` |
| `GET /api/security/lockdown` | `{ lockdown: {...}|null }` |
| `POST /api/security/lockdown` | `{ lockdown: {...} }` |
| `POST /api/security/lockdown/release` | `{ lockdown: {...} }` |
| `POST /api/chat` | `PipelineResult` (see §4.3) |
| `GET /api/health` | `{ ok: true, service: "chef-factory", time: "..." }` |
| `GET /api/config` | `{ supabaseUrl: "...", anonKey: "..." }` |

### Error Responses

All errors follow a consistent shape:

```json
{ "error": "<message>" }
```

| Status | Condition | Example |
|---|---|---|
| 400 | Bad request / validation failure | `{ "error": "command is required" }`, `{ "error": "name and slug are required" }`, `{ "error": "decision must be approved\|rejected\|denied" }` |
| 401 | No Bearer token or failed auth | `{ "error": "unauthorized" }` |
| 404 | Route not found / resource not found | `{ "error": "route not found" }`, `{ "error": "passport not found" }`, `{ "error": "approval not found" }` |
| 409 | Invalid state transition | `{ "error": "<conflict message>" }` (from `resolveApproval`) |
| 500 | Unhandled exception | `{ "error": "internal_error", "detail": "..." }` |

### Status Code Summary

| Code | Usage |
|---|---|
| 200 | All successful responses |
| 400 | Validation errors (missing fields, invalid values) |
| 401 | Authentication failure (missing token, invalid token, inactive owner) |
| 404 | Route not found, resource not found |
| 409 | State conflict (e.g., invalid approval transition) |
| 500 | Unhandled server errors |

---

## 6. Security Integration

**Source:** `src/api/security.ts`

### `createSecurityGuardian(store): SecurityGuardian`

Factory function that wires the production `SecurityGuardian` (from `src/core/security/guardian.ts`) to the real store:

```typescript
new SecurityGuardian({
  lockdown:     (ownerId) => store.activeLockdown(ownerId),
  rateLimiter:  new RateLimiter(),
  anomaly:      new AnomalyDetector(),
  recordEvent:  (event) => { void store.recordSecurityEvent(event.ownerId, event); },
  costCheck:    (ownerId, projectId) => costProtector.check(ownerId, projectId),
})
```

### Per-Request Evaluation

The SecurityGuardian is invoked **once per `POST /api/chat` command**, inside `CommandPipeline.run()` at `pipeline.ts:224-276`. It receives a `SecurityRequest` containing the full context (owner, actor, project, environment, action type, risk, authority outcome, untrusted input, etc.).

| Guardian Decision | Pipeline Action |
|---|---|
| `lockdown` or `deny` | Task created (cancelled), audit recorded as `security.guardian_denied`, outcome: `denied` |
| `require_approval` | Autonomy upgraded to `require_approval` (upgrade-only, never downgrade from `deny`) |
| `notify` | Autonomy upgraded from `auto` to `notify` (upgrade-only) |
| `allow` | No override; Gate 1 authority/autonomy decision stands |

### Lockdown Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/security/lockdown` | Check if lockdown is active |
| `POST /api/security/lockdown` | Activate lockdown (scope: `"all"` default) |
| `POST /api/security/lockdown/release` | Release lockdown by `lockdownId` |

When lockdown is active, ALL pipeline commands are denied by the SecurityGuardian (fail-closed). This was proven by live test T6.

---

## 7. Execution Runner (`execution.ts`)

**Source:** `src/api/execution.ts`

### `createExecutionRunner(opts): ExecutionRunner`

Wires the pipeline to `ModelGateway` + `RuntimeGateway` via provider adapters.

### Execution Strategy

```
ExecutionRunner.execute(task, ctx, intent)
  │
  ├─ INFO_VERBS (ask, status, list, read, plan, research)?
  │   └─ Yes → runInformational() — deterministic, NO model call, NO credits
  │       └─ Switch on intent.resource → store.listProjects/listTasks/etc.
  │
  └─ Execute-class verb
      ├─ 1. ModelGateway.select(models, { requirement, neededReasoning, ... })
      │     └─ computeNeededReasoning(): plan/deploy=high, research/execute=medium, else=none
      ├─ 2. If model found + adapter configured:
      │     ├─ adapter.complete({ model, system, messages, maxTokens: 1024, temperature: 0 })
      │     ├─ Compute cost via costForTokens()
      │     └─ Return { ok: true, output: { text, model, usage }, modelId, cost }
      │     └─ On error: { ok: false, error: "...", reason: "model-call-failed" }
      │
      ├─ 3. RuntimeGateway.select(runtimes, resource)
      │     └─ If runtime found + adapter available:
      │         ├─ adapter.execute({ runtime, command, projectPath, environment })
      │         └─ Return { ok, output, runtimeId, cost }
      │
      └─ 4. Fallback: { ok: false, error: "No configured model provider or runtime adapter...", reason: "no-executor" }
```

### Provider Adapters (registered in `server.ts`)

| Gateway | Adapter | Source |
|---|---|---|
| ModelGateway | OpenAI | `src/gateways/adapters/openai.ts` |
| ModelGateway | Anthropic | `src/gateways/adapters/anthropic.ts` |
| ModelGateway | Google | `src/gateways/adapters/google.ts` |
| RuntimeGateway | OpenCode Zen | `src/gateways/adapters/opencodeZen.ts` |

### System Prompt (for model calls)

```
You are CHEF, the owner's personal executive deputy.
Acting for owner {ownerId}.
Follow the architecture: never fabricate evidence; surface ambiguity;
defer authority and security decisions; explain decisions with why/evidence.
```

### Informational Query Routing (`runInformational`)

| Resource | Store Method | Response `kind` |
|---|---|---|
| `project/projects` | `listProjects()` | `projects` |
| `task/tasks` | `listTasks()` | `tasks` |
| `approval/approvals` | `listApprovals()` | `approvals` |
| `cost/costs` | `listProjects()` + `totalCost()` per project | `costs` |
| `audit/decision/decisions` | `listDecisions()` | `decisions` |
| `model/models` | `listModels()` | `models` |
| `runtime/runtimes` | `listRuntimes()` | `runtimes` |
| (any other / default) | `dailyStatus()` | `daily_status` |

---

## 8. Live Verification Results

**Source:** `scripts/live-http-verification.ts`

The live HTTP verification runner executes **9 mandatory test cases** against a real server with a disposable Supabase identity. It self-blocks if `FACTORY_SERVICE_ROLE_KEY` is absent from the environment.

| Test | Name | What It Does | Expected Result | Status |
|---|---|---|---|---|
| **T1** | `AUTH_OWNER_RESOLUTION` | `GET /api/me` with real Bearer token | 200, `id` matches created user | **PASS** |
| **T2** | `RLS_WRITE_PROJECT` | `POST /api/projects` (create project as owner) | 200, project created with valid `id` | **PASS** |
| **T3** | `AUTHORIZED_SAFE_EXECUTION` | `POST /api/chat` → `"list tasks in {slug}"` | 200, outcome is `executed`/`failed`/`retry_pending` (not `denied`/`blocked`) | **PASS** |
| **T4** | `CRITICAL_REQUIRES_APPROVAL` | `POST /api/chat` → `"execute transfer 100 in {slug}"` | 200, outcome is `waiting_approval`, `approvalId` present | **PASS** |
| **T5** | `DENY_FAIL_CLOSED` | `POST /api/chat` → `"delete task in nonexistent-project-xyz"` | 200, outcome is `unknown_project`/`denied`/`blocked` (nothing executed) | **PASS** |
| **T6** | `LOCKDOWN_FAIL_CLOSED` | Activate lockdown → verify all commands denied → release lockdown | Lockdown active, `list tasks` denied, `execute transfer` denied, release succeeds | **PASS** |
| **T7** | `SECURITY_EVENT_PERSISTENCE` | `GET /api/security/events` after T3-T6 | 200, ≥2 events with `denied.*` or `health.lockdown` eventType | **PASS** |
| **T8** | `RETRY_BOUNDED` | `POST /api/chat` → `"execute task in {slug}"` | Task created with `attempts ≥ 1`, `maxAttempts ≤ 3` | **PASS** |
| **T9** | `PROJECT_ISOLATION` | `GET /api/projects` after T2 | 200, every project's `ownerId` matches the test user | **PASS** |

**Overall: 9/9 PASS → `LIVE_EXECUTION_BOUNDARY = VERIFIED`**

### Additional Verification Note

`ENVIRONMENT_ISOLATION = COVERED_ELSEWHERE` — Owner chat path cannot trigger agent env-escalation; deterministic coverage is in `securityGuardian.test.ts` and RLS tests.

---

## 9. Known API Gaps

| Gap | Details | Severity |
|---|---|---|
| **No `POST /api/agents`** | Agent creation is not exposed via the API. Agents can only be created directly in the database. | Medium — operator workflow only |
| **No `DELETE` endpoints** | `DELETE /api/projects` and `DELETE /api/agents` do not exist. There is no soft-delete or hard-delete API surface for projects or agents. | Low — archival via `status` field in `projects` table (`archived`/`deleted`) |
| **No `GET /api/security/rate-limits`** | Rate limiter state is internal to `SecurityGuardian` (`RateLimiter` class). No API surface to query rate-limit counters or reset them. | Low — operational observability gap |
| **No `GET /api/security/test`** | No dedicated test/debug endpoint for security subsystem. Testing is done via unit tests and the live-http-verification runner. | Low — by design |
| **No `DELETE /api/security/lockdown`** | Lockdown release uses `POST /api/security/lockdown/release` (not `DELETE`). The method is POST with a `lockdownId` in the body. | Informational — API design choice |
| **Audit query uses raw SQL** | `GET /api/audit` bypasses the Store abstraction with a direct `pool.query()` call (`handlers.ts:296-307`). While owner-scoped via SQL `WHERE`, this bypasses any future Store-level concerns (e.g., soft-delete filtering). | Low — security is maintained via SQL `owner_id` scoping |
| **`GET /api/tasks` reads filter from JSON body** | The `GET /api/tasks` and `GET /api/approvals` endpoints read `projectId` and `status` from the request JSON body (`json.projectId`), not from query parameters. This is non-standard for GET requests and may not work with all HTTP clients that strip body from GET. | Low — works with `fetch()` and the built-in UI |
