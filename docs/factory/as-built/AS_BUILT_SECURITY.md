# CHEF FACTORY — As-Built Security Reference

**Status:** GATE 2 PASS
**Evidence:** auth.test.ts 8/8, live-runner 9/9, security test suites
**Last Verified:** 2026-08-16

---

## 1. Security Architecture Overview

CHEF FACTORY implements a layered, deterministic security architecture. No layer depends on LLM judgment for final authority; all decisions are rule-based and auditable.

**Layer flow:**

```
REQUEST → AUTHENTICATION → AUTHORITY MATRIX → CRITICAL ACTION REGISTRY
→ POLICY ENGINE → SECURITY GUARDIAN (aggregate) → DECISION → AUDIT
```

| Layer | File | Purpose |
|---|---|---|
| Authentication | `src/api/auth.ts` | Verifies JWT Bearer token, resolves owner identity |
| Authority Matrix | `src/core/authority.ts` | Maps WHO/WHAT/WHERE/ENV/PERMISSION → outcome |
| Critical Action Registry | `src/core/security/criticalActions.ts` | Immutable classification of 17 protected actions |
| Policy Engine | `src/core/security/policyEngine.ts` | 13 deterministic policy rules with precedence chain |
| Security Guardian | `src/core/security/guardian.ts` | Orchestrates full chain, may only be MORE restrictive than Gate 1 |
| Adaptive Autonomy | `src/core/autonomy.ts` | Bounded escalation based on success history |
| Approval Engine | `src/core/approval.ts` | Deterministic approval workflow with terminal states |
| Rate Limiting | `src/core/security/rateLimit.ts` | Fixed-window per-scope counters |
| Anomaly Detection | `src/core/security/anomaly.ts` | Deterministic threshold-based counters |
| Cost Protection | `src/core/security/costProtection.ts` | Hard stop when cost limits exceeded |
| Lockdown | `src/core/security/lockdown.ts` | Emergency fail-closed state |
| Prompt Injection | `src/core/security/promptInjection.ts` | Detects authority-override directives in untrusted content |
| API Wiring | `src/api/security.ts` | Constructs production SecurityGuardian backed by Store |

**Precedence chain:** `lockdown (5) > deny (4) > require_approval (3) > notify (2) > allow (1)`

The Guardian may only make a decision MORE restrictive than Gate 1 authority — never less.

---

## 2. Authentication (`src/api/auth.ts`)

**Status:** IMPLEMENTED | TESTED

### Mechanism

- Bearer token extracted from `Authorization` header
- `supabase.auth.getUser(token)` validates the JWT server-side (NOT `setSession` — this is the Gate 2 fix)
- Owner row resolved via PostgREST fetch with `apikey: anon` header + `Authorization: Bearer ${token}` (NOT `service_role`)
- RLS evaluates `auth.uid()` against the caller's own Bearer token

### Owner Enforcement

```
owner.id === user.id AND owner.status === 'active'
```

Any mismatch → `null` (401). Any exception → `null` (fail closed).

### Supabase Client Configuration

```ts
createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
```

`persistSession: false` — server-side only, no local session storage.

### Test Coverage: auth.test.ts (8/8 tests A–H)

| Test | What It Proves |
|---|---|
| A | Valid token resolves active owner |
| B | Invalid token → DENIED (null) |
| C | Empty token → DENIED (null) |
| D | Token resolves only its own owner (never another) |
| E | Owner ID spoofing blocked (row id must match JWT sub) |
| F | PostgREST carries ONLY caller's Bearer token (RLS sees `auth.uid()`) |
| G | `service_role` never used on owner-resolution path |
| H | Inactive owner → DENIED (fail closed) |

---

## 3. Authority Matrix (`src/core/authority.ts`)

**Status:** IMPLEMENTED | TESTED

### PROTECTED_ACTION_TYPES

Always protected (default `REQUIRE_APPROVAL`): `delete`, `deploy`, `financial`, `legal`, `account_security`, `credit`

### 8 Deterministic Rules

First matching rule wins (order matters):

| # | Rule | Condition | Outcome |
|---|---|---|---|
| 0 | Explicit DENY | `req.explicitDeny === true` | `deny` |
| 1 | Authorization gate | `req.authorized === false` | `deny` |
| 2 | Agent approval ban | Agent + (permission=approve OR action=approve) | `deny` |
| 3 | Protected class | `actionType ∈ PROTECTED_ACTION_TYPES` | `require_approval` |
| 4 | Critical risk | `risk === 'critical'` | `require_approval` |
| 5 | Production write/execute | `environment=production AND (write OR execute)` | `require_approval` |
| 6 | Read | `permission === 'read'` | `auto` |
| 7 | Execute non-production | `permission === 'execute'` | `notify` |
| 8 | Write non-production | `permission === 'write'` | `notify` |
| 9 | Fallback (admin) | All else | `notify` |

### Risk Classification (`riskFromAction`)

| actionType | development | staging | production |
|---|---|---|---|
| delete | high | high | high |
| deploy | high | high | critical |
| financial/legal/account_security | critical | critical | critical |
| execute | medium | medium | high |
| (other) | low | low | medium |

---

## 4. Policy Engine (`src/core/security/policyEngine.ts`)

**Status:** IMPLEMENTED | TESTED

### 12 Policy Rules in evaluatePolicy() + 1 Guardian-level rule (rule.untrusted_directive)

| # | Rule ID | What It Checks | Decision |
|---|---|---|---|
| 1 | `rule.lockdown_active` | Emergency lockdown active | `lockdown` |
| 2 | `rule.critical_action_default` | Critical Action Registry says deny | `deny` (immediate return) |
| 3 | `rule.environment_isolation` | Agent escalating beyond granted environment | `deny` |
| 4 | `rule.cross_project_deny` | Agent accessing project outside scope | `deny` |
| 5 | `rule.rate_limit` | Rate limit exhausted for scope | `deny` |
| 6 | `rule.cost_protection` | Cost hard limit reached | `deny` |
| 7 | `rule.critical_action_require_approval` | Critical Action Registry says require_approval | `require_approval` |
| 8 | `rule.production_write_execute` | Production + write/execute permission | `require_approval` |
| 9 | `rule.staging_write_execute` | Staging + write/execute permission | `notify` |
| 10 | `rule.not_authorized` | Actor not authorized for action | `deny` |
| 11 | `rule.explicit_deny` | Explicit owner DENY policy | `deny` |
| 12 | `rule.default_allow` | No restriction found | `allow` |

Note: Rule 13 (`rule.untrusted_directive`) is documented in the `security_policies` DB table but is an evidence marker, not a standalone decision point — untrusted directives are noted as evidence in the Guardian's evaluate() flow but do not independently change the policy decision.

### Helper Functions

- `moreRestrictive(a, b)` — returns the more restrictive of two SecurityDecision values
- `combineAuthority(authority, security)` — combines Gate 1 authority with Guardian decision, never less restrictive
- `environmentRank(e)` — development=0, staging=1, production=2
- `detectEnvironmentEscalation(env, granted, actorType)` — agents only; owners always pass
- `detectCrossProject(projectId, requestedProjectId, actorType)` — agents only; owners always pass

---

## 5. Security Guardian (`src/core/security/guardian.ts`)

**Status:** IMPLEMENTED | TESTED

### `evaluate()` Flow (11 Steps)

1. **Lockdown check** — if active, immediately return `lockdown` + `deny` (fail closed)
2. **Critical Action Registry** — `classifyCriticalAction()` → `deny` or `require_approval`
3. **Environment isolation** — `detectEnvironmentEscalation()` → deny if escalated
4. **Cross-project isolation** — `detectCrossProject()` → deny if crossed
5. **Rate limits** — `rateLimiter.check()` per scope → deny if exhausted
6. **Cost protection** — `costCheck()` → deny if hard limit reached
7. **Prompt injection** — `assessUntrustedInput()` → flags authority directives as DATA (never authority)
8. **Policy evaluation** — `evaluatePolicy()` → 12-rule chain
9. **Authority combination** — `guardianCombineAuthority()` → never less restrictive than Gate 1
10. **Anomaly notes** — `noteAnomalies()` → counts denials, escalations, project switches, rate limits, cost spikes
11. **Event emission** — final deny/approval events recorded

### Methods

- `evaluate(req: SecurityRequest): Promise<SecurityGuardResult>` — main entry point
- `limitKeyFor(req)` — maps scope to limitKey (e.g., `task` → `task.execute`, `tool` → `tool.call`)
- `noteAnomalies(...)` — triggers anomaly signals on deny, env escalation, cross-project, rate limit, cost stop

### Integration with API Server

`createSecurityGuardian(store)` in `src/api/security.ts` wires:
- `lockdown` → `store.activeLockdown(ownerId)` (DB-backed async)
- `rateLimiter` → `new RateLimiter()` (in-memory)
- `anomaly` → `new AnomalyDetector()` (in-memory)
- `recordEvent` → `store.recordSecurityEvent(ownerId, event)` (DB-backed)
- `costCheck` → `costProtector.check(ownerId, projectId)` (DB-backed async)

---

## 6. Critical Actions (`src/core/security/criticalActions.ts`)

**Status:** IMPLEMENTED | TESTED (but see INERT note below)

### All 17 Critical Action Rules

| # | Action | Classification | Default Decision | Environments | isCore |
|---|---|---|---|---|---|
| 1 | `production_modification` | production | `require_approval` | all | true |
| 2 | `production_deletion` | production | `deny` | production | true |
| 3 | `database_destructive` | destructive | `deny` | all | true |
| 4 | `secret_access` | secret | `require_approval` | all | true |
| 5 | `secret_rotation` | secret | `require_approval` | all | true |
| 6 | `permission_escalation` | permission | `deny` | all | true |
| 7 | `security_policy_modification` | policy | `require_approval` | all | true |
| 8 | `disable_audit` | audit | `deny` | all | true |
| 9 | `disable_rls` | audit | `deny` | all | true |
| 10 | `owner_identity_change` | identity | `require_approval` | all | true |
| 11 | `authority_rule_change` | authority | `require_approval` | all | true |
| 12 | `autonomy_rule_change` | authority | `require_approval` | all | true |
| 13 | `financial_transaction` | financial | `deny` | all | true |
| 14 | `legal_commitment` | contractual | `deny` | all | true |
| 15 | `external_irreversible` | external_irreversible | `require_approval` | all | true |
| 16 | `factory_shutdown` | factory | `deny` | all | true |
| 17 | `lockdown_release` | factory | `deny` | all | true |

**Counts:** 9 deny-by-default, 8 require_approval-by-default.

### Vocabulary Mismatch — INERT Status

The critical action rules use action names like `production_modification`, `database_destructive`, `financial_transaction`, etc. However, the pipeline and agents use different vocabulary such as `create_project`, `run_task`, `deploy`, etc.

**Impact:** The `classifyCriticalAction()` function matches on `actionType` from the `SecurityRequest`. Unless the pipeline sends exactly `financial_transaction` (not `financial`), `database_destructive` (not `db_write`), etc., the rules will not match and the request passes through to the policy engine unclassified.

**Status: INERT** — rules are wired into the Guardian's `evaluate()` flow but will only trigger if the caller passes the exact action strings defined in the registry. No current pipeline endpoint uses these exact strings.

### Immutability

- Registry version: 1
- All 17 rules have `isCore: true`
- DB triggers (`critical_actions_no_update`, `critical_actions_no_delete`) block UPDATE and DELETE on the `critical_actions` table
- Invalid `default_decision` values (e.g., `allow`) are blocked by the DB check constraint

---

## 7. Rate Limiting (`src/core/security/rateLimit.ts`)

**Status:** IMPLEMENTED (wired into Guardian) | WIRED_BUT_NOT_ENFORCED

### Mechanism

Fixed-window in-memory counters. `RateLimiter.check(ownerId, scope, limitKey)` increments a counter keyed by `ownerId:scope:limitKey` and compares against the configured `maxCount` within the `windowSeconds` window.

### 7 Default Scopes

| Scope | limitKey | maxCount | windowSeconds | Wired |
|---|---|---|---|---|
| task | `task.execute` | 50 | 3600 (1hr) | YES |
| tool | `tool.call` | 100 | 3600 | YES |
| runtime | `runtime.execute` | 20 | 3600 | YES |
| model | `model.call` | 200 | 3600 | YES |
| auth | `auth.failure` | 5 | 900 (15min) | YES |
| approval | `approval.request` | 20 | 3600 | YES |
| failure | `task.failure` | 10 | 3600 | YES |

### Enforcement Status

All 7 scopes are **WIRED but NOT ENFORCED** because:

- The `RateLimiter` is instantiated with `DEFAULT_RATE_LIMITS` in `createSecurityGuardian()`
- The Guardian calls `rateLimiter.check()` when `req.scope` is set
- However, the `rateLimited` signal from the Guardian only results in a `deny` decision if the policy engine's `input.rateLimited.limited` is true
- The in-memory counters are ephemeral — they reset on server restart
- No DB-backed rate limit configs are loaded (the `security_rate_limits` table exists but is documentation-only at this layer)

---

## 8. Anomaly Detection (`src/core/security/anomaly.ts`)

**Status:** IMPLEMENTED (wired into Guardian) | WIRED_BUT_NOT_ENFORCED

### 10 Anomaly Counters

| Counter | What It Detects | Threshold | Triggered In Guardian |
|---|---|---|---|
| `deniedActions` | Repeated deny/lockdown decisions | 5 | YES — on deny or lockdown |
| `authFailures` | Repeated authentication failures | 5 | NO — not called by Guardian |
| `privilegeRequests` | Repeated privilege escalation attempts | 3 | NO — not called by Guardian |
| `projectSwitches` | Abnormal project switching | 5 | YES — on cross-project deny |
| `environmentEscalations` | Abnormal environment escalation attempts | 3 | YES — on env escalation deny |
| `costSpikes` | Cost limit hits | 3 | YES — on cost stop |
| `retryBursts` | Retry storms | 5 | NO — not called by Guardian |
| `toolAnomalies` | Unusual tool usage patterns | 3 | NO — not called by Guardian |
| `secretAccessAttempts` | Repeated secret access attempts | 3 | NO — not called by Guardian |
| `policyViolations` | Repeated policy violations | 5 | YES — on rate limit |

### What Gets Triggered

Only 5 of 10 counters are actually called via `noteAnomalies()` in the Guardian:
- `deniedActions` ✓
- `environmentEscalations` ✓
- `projectSwitches` ✓
- `policyViolations` ✓
- `costSpikes` ✓

The remaining 5 (`authFailures`, `privilegeRequests`, `retryBursts`, `toolAnomalies`, `secretAccessAttempts`) are defined but **no code path calls `anomaly.note()` for them**.

### Signal Behavior

When a threshold is crossed, `note()` returns an `AnomalySignal` and the Guardian emits an `anomaly.*` security event with `severity: medium`. The counters are cumulative (never reset except by explicit `reset()` call) and in-memory only (ephemeral across restarts).

---

## 9. Lockdown System (`src/core/security/lockdown.ts`)

**Status:** IMPLEMENTED | TESTED

### State Management

- Status: `active` | `released`
- Scope: `'all'` (default) or a specific project ID
- Lockdowns are append-only history — DELETE is blocked by DB trigger

### Activation

- **Who:** Owner or system only. Agents are blocked: `validateLockdownActivation()` returns error if `actorType === 'agent'`
- **What:** Requires a non-empty `reason`
- **Record:** `toLockdownRecord()` creates a `SecurityLockdownRecord` with `status: 'active'`

### Triggering Conditions

The Guardian checks `this.deps.lockdown(ownerId)` as step 1 of `evaluate()`. If any active lockdown exists for the owner, ALL actions return `lockdown` + `denied: true` immediately. Five conditions that lead to lockdown activation (from the policy engine and Guardian test suite):

1. **Emergency lockdown by owner** — explicit owner-activated lockdown
2. **System-initiated lockdown** — via `activateLockdown()` with `actorType: 'system'`
3. **Repeated anomaly threshold crossings** — the Guardian can emit events that feed into incident management, but automatic lockdown triggering is NOT implemented (would require an external orchestrator calling `activateLockdown()`)
4. **Cost hard limit reached** — does NOT auto-lockdown; only emits deny events
5. **Critical action registry deny** — does NOT auto-lockdown; only emits deny events

**Reality:** Only condition 1 (explicit owner activation) is implemented as an automatic trigger. Conditions 3–5 emit events but do not automatically trigger lockdown.

### Exiting Lockdown

- `canReleaseLockdown()` — owner-only, requires non-empty reason
- `releaseLockdown()` — transitions `status` from `active` → `released`, sets `releasedBy` and `releasedAt`
- Agents **can never** release lockdowns — enforced in both code and DB (RLS)

### DB Persistence (`security_lockdowns` table)

- `lockdown_id` (UUID PK)
- `owner_id` (FK → owners, CASCADE delete)
- `scope` (text, default 'all')
- `reason` (text)
- `status` ('active' | 'released')
- `activated_by` (FK → owners)
- `released_by` (FK → owners, nullable)
- `released_at` (timestamptz, nullable)
- `created_at` (timestamptz)

RLS: owner-scoped SELECT/INSERT/UPDATE. No DELETE policy + trigger blocks deletion.

---

## 10. Approval Engine (`src/core/approval.ts`)

**Status:** IMPLEMENTED | TESTED

### Approval States and Transitions

```
pending → approved | rejected | denied | expired | cancelled
```

Terminal states (no further transitions): `approved`, `rejected`, `denied`, `expired`, `cancelled`

### Key Rules

- `validateNewApproval()` — enforces unique pending approval per (taskId, action). Rejects duplicates.
- `resolveApproval()` — checks terminal state first; if already terminal, returns error. Otherwise transitions to the requested status.
- `isExpired()` — checks `expiresAt` against current time.

### Integration with Authority Levels

- When the authority matrix returns `require_approval` and the Guardian confirms, the pipeline must create an approval request before executing the action
- The approval's `authorityLevel` field records which authority rule triggered the approval
- DB enforcement: unique index on `(task_id, action, status='pending')` ensures one pending approval per task+action combination

---

## 11. Adaptive Autonomy (`src/core/autonomy.ts`)

**Status:** IMPLEMENTED | TESTED

### Mechanism

`evaluateAutonomy(input)` takes the Gate 1 authority outcome and the agent's historical performance to produce a final autonomy decision.

### Decision Rules

| Authority Outcome | Condition | Final Autonomy |
|---|---|---|
| `deny` | Always | `deny` (cannot be overridden) |
| `ownerPolicy` (non-deny) | Always | Owner policy value |
| Protected action class | `actionType ∈ PROTECTED_ACTION_TYPES` | `require_approval` (never escalated) |
| `require_approval` | Always | `require_approval` (never downgraded) |
| `auto` | Always | `auto` |
| `notify` | `successRate ≥ 0.8` AND `historyCount ≥ 5` | `auto` (one-step bounded escalation) |
| `notify` | Below threshold | `notify` (stays) |
| Unknown | Fallback | `require_approval` |

### Thresholds

- `ESCALATION_MIN_SUCCESS_RATE = 0.8` (80%)
- `ESCALATION_MIN_HISTORY = 5` (minimum 5 historical actions)

### Bounded Escalation

- Only `notify → auto` is possible (one-step)
- Protected classes and `require_approval` are **never downgraded** by success
- `deny` always wins regardless of success history

---

## 12. Security Events & Incidents

### Security Events (`security_events`)

**Status:** IMPLEMENTED | DB-enforced append-only

Every security-relevant decision emits a `SecurityEventInput` which is persisted as a `SecurityEventRecord`.

**Event types emitted by the Guardian:**

| Event Type | Severity | When |
|---|---|---|
| `health.lockdown` | critical | Active lockdown detected |
| `denied.critical` | critical | Critical action with defaultDecision=deny |
| `require_approval.critical` | high | Critical action with defaultDecision=require_approval |
| `denied.environment_escalation` | high | Agent environment escalation |
| `denied.cross_project` | high | Agent cross-project access |
| `denied.rate_limit` | high | Rate limit exhausted |
| `denied.cost` | critical | Cost hard limit |
| `denied.action` | high | General policy deny (non-critical) |
| `anomaly.repeated_denial` | medium | Repeated deny threshold crossed |
| `anomaly.environment_escalation` | medium | Env escalation threshold crossed |
| `anomaly.project_switching` | medium | Project switching threshold crossed |
| `anomaly.policy_violations` | medium | Rate limit threshold crossed |
| `anomaly.cost_spike` | medium | Cost spike threshold crossed |

**Mandatory fields:** `eventId`, `ownerId`, `eventType`, `severity`, `action`, `reason`, `occurredAt`, `recordedAt`, `evidenceReferences`, `metadata`

**Redaction:** Security events never contain raw secrets — `redactText()` is applied to reasons and metadata.

### Security Incidents (`security_incidents`)

**Status:** IMPLEMENTED | TESTED

Workflow states: `detected → investigating → contained → resolved → closed`

- Created via `createIncident()`
- Patched via `patchIncident()` with validated transitions
- Owner-scoped via RLS
- `event_ids` field links to `security_events`

### Severity Levels

| Level | Meaning |
|---|---|
| `info` | Informational, no action needed |
| `low` | Minor policy observation |
| `medium` | Anomaly threshold crossed, noteworthy |
| `high` | Security deny or policy violation |
| `critical` | Lockdown, critical action denial, cost hard stop |

---

## 13. DB-Level Security (from Migrations)

**Status:** IMPLEMENTED | TESTED (S1–S7)

### Migration: `20260817000000_security_guardian.sql`

#### Tables Created

1. `critical_actions` — global immutable registry (17 rows)
2. `security_events` — append-only, owner-scoped audit trail
3. `security_incidents` — owner-scoped incident workflow
4. `security_lockdowns` — append-only history, owner-release
5. `security_rate_limits` — documented defaults, owner-overridable
6. `security_policies` — read-only documentation registry (13 rows)

#### RLS Policies

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `critical_actions` | authenticated (all) | — | — | — |
| `security_events` | owner_id = auth.uid() | owner_id = auth.uid() | — (trigger blocked) | — (trigger blocked) |
| `security_incidents` | owner_id = auth.uid() | owner_id = auth.uid() | owner_id = auth.uid() | owner_id = auth.uid() |
| `security_lockdowns` | owner_id = auth.uid() | owner_id = auth.uid() | owner_id = auth.uid() | — (trigger blocked) |
| `security_rate_limits` | owner_id = auth.uid() | owner_id = auth.uid() | owner_id = auth.uid() | owner_id = auth.uid() |
| `security_policies` | authenticated (all) | — | — | — |

#### Triggers

- `critical_actions_no_update` — BEFORE UPDATE → raise exception
- `critical_actions_no_delete` — BEFORE DELETE → raise exception
- `security_events_no_update` — BEFORE UPDATE → raise exception (append-only)
- `security_events_no_delete` — BEFORE DELETE → raise exception (append-only)
- `security_lockdowns_no_delete` — BEFORE DELETE → raise exception (history)
- `security_incidents_set_updated_at` — BEFORE UPDATE → auto-set updated_at
- `critical_actions_set_updated_at` — BEFORE UPDATE → auto-set updated_at

### Migration: `20260818000000_security_truncate_hardening.sql`

**Status:** IMPLEMENTED | TESTED (S7)

#### TRUNCATE Guards (BEFORE TRUNCATE statement triggers)

TRUNCATE bypasses RLS and never fires FOR EACH ROW triggers. This migration adds:

| Table | Trigger | Function |
|---|---|---|
| `security_events` | `security_events_no_truncate` | `block_security_event_mutation()` |
| `critical_actions` | `critical_actions_no_truncate` | `block_critical_action_mutation()` |
| `security_lockdowns` | `security_lockdowns_no_truncate` | `block_lockdown_deletion()` |
| `security_incidents` | `security_incidents_no_truncate` | `block_security_table_truncate()` |
| `security_rate_limits` | `security_rate_limits_no_truncate` | `block_security_table_truncate()` |
| `security_policies` | `security_policies_no_truncate` | `block_security_table_truncate()` |
| `audit_events` | `audit_events_no_truncate` | `block_audit_mutation()` |

#### REVOKE Statements (defense-in-depth)

```sql
REVOKE TRUNCATE, TRIGGER ON public.security_events FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER ON public.critical_actions FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER ON public.security_lockdowns FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER ON public.security_incidents FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER ON public.security_rate_limits FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER ON public.security_policies FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER ON public.audit_events FROM anon, authenticated;
```

7 tables protected. Even `postgres` (superuser) cannot TRUNCATE due to trigger layer.

---

## 14. Security Test Coverage

### auth.test.ts — 8/8 Tests (A–H)

**Status:** ALL PASSING

Tests A through H verify the full Bearer-token owner-resolution path in `AuthService.verifyOwner()`. See Section 2 for details.

### securityGuardian.test.ts — 26 Topics + 10 Adversarial + 3 Persistence

**Status:** ALL PASSING

#### Section A: 26 Deterministic Topics (T1–T26)

| Topic | What It Tests |
|---|---|
| T1 | Precedence order: LOCKDOWN > DENY > REQUIRE_APPROVAL > NOTIFY > ALLOW |
| T2 | DENY always wins in evaluation |
| T3 | Guardian never less restrictive than authority |
| T4 | financial_transaction → deny |
| T5 | production_modification → require_approval |
| T6 | database_destructive → deny in all environments |
| T7 | disable_audit and disable_rls → deny |
| T8 | Active lockdown → lockdown for any action |
| T9 | Lockdown release: agents blocked, owners allowed |
| T10 | Environment escalation → deny |
| T11 | Cross-project access → deny |
| T12 | Rate limit exhausted → deny with retryAfter |
| T13 | Rate limit under threshold → allow |
| T14 | Cost hard limit → deny |
| T15 | Prompt injection authority directives → flagged as DATA |
| T16 | Benign external content → no authority directive |
| T17 | Secret scanning detects and redacts |
| T18 | Deep scan finds secrets by key and value |
| T19 | Risk classification deterministic |
| T20 | Event severity deterministic per type |
| T21 | Incident status transitions enforced |
| T22 | Security events never contain raw secrets |
| T23 | Mandatory event fields always populated |
| T24 | Health status deterministic (lockdown/blocked/degraded/healthy) |
| T25 | RLS probe failure → critical health |
| T26 | Anomaly thresholds trigger exactly at boundary |
| T26b | Guardian emits anomaly events after repeated denials |

#### Section B: 10 Adversarial Scenarios (A1–A10)

| Scenario | Attack | Expected Result |
|---|---|---|
| A1 | Model output prompt injection | Detected, never honored as authority |
| A2 | Self-granted permission escalation | Denied |
| A3 | Disable audit logging | Denied |
| A4 | Agent-initiated lockdown release | Denied |
| A5 | Financial transfer with authority=auto | Denied |
| A6 | Secret exfiltration attempt | Secret redacted in events |
| A7 | Cross-project read by agent | Denied |
| A8 | Production deletion | Denied |
| A9 | Policy weakening via preferences | Cannot override critical registry |
| A10 | Guardian downgrade of authority deny | Never downgraded |

#### Section C: Persistence / Registry Parity (3 tests)

- Critical action registry version=1, all 17 rules areCore=true
- MemoryStore.listCriticalActions matches core registry
- MemoryStore records owner-scoped security events and incidents
- MemoryStore enforces owner-only lockdown release

### security.test.ts — 4 Tests (API Wiring)

| Test | What It Proves |
|---|---|
| 1 | Lockdown from real Store → fails closed |
| 2 | No false-positive when no lockdown |
| 3 | Security events recorded through real Store |
| 4 | Cost check with safe defaults (no limits) |

### SQL Test Suite: rls_security_tests.sql (S1–S7)

**Status:** ALL PASSING (transactional, self-cleaning via ROLLBACK)

| Test | What It Proves |
|---|---|
| S1 | critical_actions: 17 rows, immutable (UPDATE/DELETE blocked), authenticated can read |
| S2 | security_events: owner isolation via RLS, append-only (trigger blocks mutation) |
| S3 | security_lockdowns: owner scope, history (DELETE blocked), owner can release |
| S4 | security_incidents: owner-scoped CRUD, cross-owner isolation |
| S5 | security_policies: 13 rows, read-only (UPDATE/DELETE 0 rows) |
| S6 | security_rate_limits: owner-scoped read |
| S7 | TRUNCATE guard: trigger layer + privilege revocation on 7 tables |

---

## 15. Known Security Gaps

### Critical Action Vocabulary Mismatch (INERT)

- **Status:** BLOCKED
- **Evidence:** `criticalActions.ts` defines action names like `production_modification`, `database_destructive`, `financial_transaction`. The pipeline and agents use different names (e.g., `create_project`, `run_task`, `deploy`).
- **Impact:** Critical action rules 1–17 will not match unless the exact action string is passed in `SecurityRequest.actionType`. The Guardian will fall through to the policy engine's environment/permission checks.
- **Remediation required:** Map pipeline action types to critical action registry names, or change the pipeline to use the registry vocabulary.

### 5 Rate-Limit Scopes Wired but Not Enforced

- **Status:** DEFERRED
- **Evidence:** `RateLimiter` is instantiated with `DEFAULT_RATE_LIMITS` but all counters are in-memory and ephemeral. No DB-backed rate limit configs are loaded. Counters reset on server restart.
- **Affected scopes:** All 7 (task, tool, runtime, model, auth, approval, failure)
- **Impact:** Rate limiting works within a single server process lifetime but does not persist across restarts or scale across multiple instances.

### 5 Anomaly Counters Wired but Not Enforced

- **Status:** DEFERRED
- **Evidence:** `authFailures`, `privilegeRequests`, `retryBursts`, `toolAnomalies`, `secretAccessAttempts` are defined in `AnomalyDetector` but no code path calls `anomaly.note()` for them.
- **Affected counters:** 5 of 10
- **Impact:** These anomaly signals are never generated. The Guardian only triggers `deniedActions`, `environmentEscalations`, `projectSwitches`, `policyViolations`, and `costSpikes`.

### No Auth Enforcement on Project/Agent Deletion Endpoints

- **Status:** UNVERIFIED
- **Evidence:** The `auth.ts` module provides `verifyOwner()` but it is only wired into the API server's auth middleware. Deletion endpoints for projects and agents were not found to have explicit auth checks beyond the standard middleware. Without middleware coverage, these endpoints could be unauthenticated.
- **Impact:** Potential unauthorized deletion of projects or agents.
- **Remediation required:** Verify that all mutation endpoints (especially DELETE) are behind the auth middleware.

### Cost Protection Defaults to No Limits

- **Status:** IMPLEMENTED | NOT_APPLICABLE (by design)
- **Evidence:** `DEFAULT_COST_PROTECTION` has all hard limits set to `null` (disabled). The `costSpikeMultiplier` is set to 5 but spike detection only produces a boolean — it does not stop execution.
- **Impact:** Cost protection is structurally present but inactive until an owner configures limits.

### Lockdown Does Not Auto-Trigger

- **Status:** DEFERRED
- **Evidence:** The Guardian emits events when anomalies are detected, but no code path automatically calls `activateLockdown()` based on those events.
- **Impact:** An owner must manually activate lockdown. Automatic lockdown on repeated critical denials is not implemented.

### Anomaly Counters Are In-Memory Only

- **Status:** DEFERRED
- **Evidence:** `AnomalyDetector` uses a plain object `{ deniedActions: 0, authFailures: 0, ... }`. No DB persistence. Counters reset on server restart.
- **Impact:** Anomaly thresholds are only meaningful within a single process lifetime.

---

*End of AS_BUILT_SECURITY.md*
