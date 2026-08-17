# CHEF FACTORY — As-Built Testing Reference

**Status:** TESTED | **Evidence:** vitest suites + SQL test scripts + live HTTP verification runner
**Last Verified:** 2026-08-16

---

## 1. Testing Architecture Overview

Three independent testing tiers, each with distinct execution environments and evidence characteristics:

| Tier | Runner | Environment | Execution Model | Evidence Type |
|------|--------|-------------|-----------------|---------------|
| **Tier 1: Unit Tests** | `vitest run` | Node.js, in-memory | Deterministic, mocked dependencies | Test output, pass/fail counts |
| **Tier 2: SQL Tests** | `node supabase/tests/run_tests.cjs` | Live Supabase Postgres | Transactional (`BEGIN`…`ROLLBACK`), self-cleaning | `PASS`/`FAIL` console output |
| **Tier 3: Live HTTP** | `npx tsx scripts/live-http-verification.ts` | Real Supabase + local HTTP server | Disposable user, full HTTP round-trip, cleanup | `TEST_X = PASS` / `FAIL` console output |

**Key design principle:** No test tier depends on another. Each provides independent evidence. No test fabricates success — unknown states return `unknown` / `null` / empty rather than invented values.

---

## 2. Vitest Configuration

**File:** `vitest.config.ts`

```ts
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/integration/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
```

**Settings:**
- **Environment:** `node` (not jsdom — server-side only)
- **Test timeout:** 60 seconds per test
- **Hook timeout:** 60 seconds per beforeAll/afterAll
- **Include patterns:** `src/**/*.test.ts` (unit) + `src/integration/**/*.integration.test.ts` (live integration)
- **Module system:** ESM (`"type": "module"` in package.json), using `vitest@^1.6.0`
- **TypeScript:** `tsx@^4.16.0`, `typescript@^5.5.0`

**Test organization:** All unit tests use `MemoryStore` (in-memory implementation of the `Store` port) — no database required. Integration tests are guarded with `describe.skipIf(!enabled)` and only run when `FACTORY_*` env vars are present.

---

## 3. Unit Test Inventory

### 3.1 Core Security (`src/core/security/`)

#### `securityGuardian.test.ts` — 41 tests

**Section A: 27 Deterministic Topics** (§29 of Gate 2 contract)

| Test ID | Name | What It Tests |
|---------|------|---------------|
| T1 | Precedence order | `LOCKDOWN > DENY > REQUIRE_APPROVAL > NOTIFY > ALLOW` enforced in `SECURITY_PRECEDENCE` and `moreRestrictive()` |
| T2 | DENY always wins | `evaluatePolicy()` returns `deny` when `explicitDeny: true`; `combineAuthority` reflects deny |
| T3 | Never downgrades authority | `combineAuthority()` never downgrades from deny → allow or notify → allow; `guardianCombineAuthority()` same |
| T4 | Financial transaction denied | `classifyCriticalAction('financial_transaction')` returns deny; guardian `evaluate()` returns `deny` with `rule.critical.*` |
| T5 | Production modification requires approval | `evaluate()` for `production_modification` in production → `require_approval` |
| T6 | Database destructive denied | `evaluate()` for `database_destructive` in production → `deny` |
| T7 | Disable audit/RLS denied | Both `disable_audit` and `disable_rls` → `deny` with `rule.critical.*` |
| T8 | Lockdown → fail closed | Active lockdown record → any evaluation returns `lockdown` with `rule.lockdown_active` |
| T9 | Lockdown release authorization | Agents can never release; owners can; empty reason rejected |
| T10 | Environment escalation denied | Agent requesting production when granted only development → `deny` with `environment_escalation` |
| T11 | Cross-project access denied | Agent reading project-2 when scoped to project-1 → `deny` with `cross_project` |
| T12 | Rate limit exhausted → deny | After hitting limit (2/2), third call denied with `rate_limit=` evidence |
| T13 | Rate limit under threshold → allow | Normal calls under limit → `allow` |
| T14 | Cost hard limit → deny | `costStopped: true` → `deny` with `cost_hard_limit` evidence |
| T15 | Prompt-injection authority directive | Authority-override in untrusted input flagged as `untrusted_authority_directive` |
| T16 | Benign content → no directive | External content without authority directives produces empty `authorityDirectives` |
| T17 | Secret scanning detects redacts | `scanForSecrets()` finds `sk-proj-*` and `password=*`, redacts them |
| T18 | Deep scan finds secrets recursively | `deepScanForSecrets()` finds `apiKey`, `jwt` in nested objects |
| T19 | Risk classification deterministic | Secret+financial → `critical`; destructive+production → `critical`; production → `high`; write → `medium`; default → `low` |
| T20 | Event severity deterministic | `lockdown.activated` → `critical`; `denied.action` → `high`; `anomaly.repeated_denial` → `medium` |
| T21 | Incident transitions enforced | `detected → investigating` allowed; `closed → detected` rejected; patch applies correctly |
| T22 | Events never contain raw secrets | `toSecurityEventRecord()` redacts `sk-live-*` and JWTs from reason/metadata |
| T23 | Mandatory event fields populated | `eventId`, `ownerId`, `eventType`, `action`, `reason`, `occurredAt`, `recordedAt` all present |
| T24 | Health status deterministic | Lockdown → `lockdown`; critical check broken → `blocked`; all OK → `healthy` |
| T25 | RLS probe failure → blocked | `rlsHealthFromProbe(null)` → `ok: false, critical: true` |
| T26 | Anomaly threshold boundary | Anomaly signal fires exactly at `DEFAULT_ANOMALY_THRESHOLDS.repeatedDeniedActions` |
| T26b | Guardian anomaly events | After repeated denials, guardian emits `anomaly.repeated_denial` events |

**Section B: 10 Adversarial Scenarios** (§30)

| Test ID | Name | What It Tests |
|---------|------|---------------|
| A1 | Prompt-injection from model output | "ignore all previous instructions" → `deny`, `untrusted_authority_directive` evidence |
| A2 | Self-granted permission escalation | `permission_escalation` by agent → `deny`, `rule.critical.*` |
| A3 | Disable audit attempt | `disable_audit` by agent → `deny` |
| A4 | Agent-initiated lockdown release | Agent tries release during active lockdown → `lockdown` (fail closed) |
| A5 | Financial transfer denied regardless of authority | `authorityOutcome: 'auto'` doesn't prevent financial deny |
| A6 | Exfiltrated secret never persisted raw | Guardian events never contain `sk-abc123456789` |
| A7 | Cross-project read denied | Agent reads project-2 data → `deny` |
| A8 | Production deletion denied | `production_deletion` in production → `deny` |
| A9 | Preference-based policy weakening blocked | `legal_commitment` with `explicitDeny: false` still → `deny` (registry wins) |
| A10 | Authority deny never downgraded | `authorityOutcome: 'deny'` stays `deny` through guardian |

**Section C: Persistence / Registry Parity** (4 tests)

| Name | What It Tests |
|------|---------------|
| Registry version | `CRITICAL_ACTIONS_REGISTRY_VERSION === 1`, all `isCore`, ≥17 rules |
| MemoryStore parity | `listCriticalActions()` matches TS `CRITICAL_ACTIONS` array |
| MemoryStore events/incidents | Record/list security events, create/patch incidents, owner isolation |
| MemoryStore lockdown release | Owner-only release enforced at store level |

### 3.2 Core Pipeline

#### `pipeline.test.ts` — 18 tests

| Name | What It Tests |
|------|---------------|
| Informational command deterministic | `status in chef-hq` → `executed`, confidence 1 |
| Scoped task command | `create task "write report"` → `executed`, cost recorded, audit trail |
| Unknown command | `zzz the qux` → `unknown`, no fabricated certainty |
| Unknown project | `create task "x" in nonexistent-project` → `unknown_project` |
| Ambiguous command | `list tasks and projects` → `unknown` with "ambiguous" reason |
| Production deploy | → `waiting_approval`, pending approval created |
| Delete requires approval | → `waiting_approval` regardless of environment |
| Explicit DENY policy | `explicit_deny: true` → `denied`, task `cancelled` |
| deny:actionType policy | `deny:execute` → `denied` for execute commands |
| Autonomy force auto | Owner policy `auto` for deploy → `executed` without approval |
| Bounded retries | First failure → `retry_pending`, attempts recorded, no auto-loop |
| Agent scoped permission | Agent with write permission on project → `executed` |
| Agent denied without permission | Agent tries cross-project → `denied`, task `cancelled` |
| Audit trail no secrets | `sbp_abc123` not in serialized audit |
| Decision journal invariants | Options ≥ 2, confidence ∈ [0, 1] |
| Lockdown through pipeline | Active lockdown → `denied`, `security.guardian_denied` audited |
| Guardian no false-positive | No lockdown → normal command executes |
| Financial through wired guardian | Financial command → `waiting_approval` or `denied` |

### 3.3 Core Modules

#### `monitoring.test.ts` — 4 tests

| Name | What It Tests |
|------|---------------|
| Failed tasks critical | Failed task → project health `critical` |
| Blocked+failures threshold | 3 paused tasks → health `attention`, `blockedTasks: 3` |
| Healthy project | No issues → health `healthy` |
| Pending approvals | Pending deploy approval → `pendingApprovals: 1` |

#### `intent.test.ts` — 10 tests

| Name | What It Tests |
|------|---------------|
| Scoped create-task | `create task "write the report" in chef-hq` → resolved, verb `create`, project `chef-hq` |
| Informational status | `status` → resolved, resource `null` |
| List projects | `list projects` → resolved, resource `project` |
| Empty command | `""` → `unknown`, missing "command text" |
| Gibberish verb | `blorpt the quarkfizzle` → `unknown`, missing "action verb" |
| Missing project | `create task "do something"` → `unknown`, missing project |
| Deployment without env | `deploy the app in chef-hq` → `unknown`, missing environment |
| Ambiguous multi-resource | `list tasks and projects` → `ambiguous` |
| Explicit environment | `execute migration in chef-hq production` → environment `production` |
| @project shorthand | `status in @chef-hq` → project `chef-hq` |
| Target not slug | `create task in chef-hq` → target `null` |

#### `explanation.test.ts` — 4 tests

| Name | What It Tests |
|------|---------------|
| All fields exposed | `buildExplanation()` returns decision, why, evidence, confidence, risk, outcome |
| Defaults optional fields | Empty → evidence `[]`, confidence `null`, outcome `pending` |
| "Done." never complete | `isCompleteExplanation({decision: "Done."})` → `false` |
| Non-empty required | Empty decision/why → `false` |

#### `decisionJournal.test.ts` — 5 tests

| Name | What It Tests |
|------|---------------|
| Requires context and options | Empty context → error; empty options → error |
| Two options minimum | One option without selection → error; one with selection → ok |
| Confidence bounds | `1.5` → error; `0.7` → ok |
| selected_option in options | `selectedOption: 'z'` not in `['a','b']` → error |
| Record structure | `toDecisionRecord()` produces correct shape |

#### `cost.test.ts` — 5 tests

| Name | What It Tests |
|------|---------------|
| Token cost deterministic | `costForTokens(0.15, 0.6, 1000, 1000) === 0.75` |
| Token estimation fallback | Empty → 0; "abcd" → 1 |
| Never negative | Negative input → ≥ 0 |
| Cost rollup | Model + mission costs sum to 1.75 |
| Owner isolation | Other owner's costs not included |

#### `autonomy.test.ts` — 8 tests

| Name | What It Tests |
|------|---------------|
| Never overrides DENY | Perfect history, authority=deny → stays `deny` |
| Never downgrades protected classes | Deploy with perfect history → stays `require_approval` |
| Never escalates REQUIRE_APPROVAL | → stays `require_approval` |
| Keeps AUTO | → stays `auto` |
| Stays NOTIFY without track record | historyCount 3 → `notify` |
| One-step escalation | successRate 0.95, historyCount 20 → `auto` |
| Owner policy override | ownerPolicy `auto` with poor history → `auto` |
| Unknown falls back | Unknown outcome → `require_approval` |

#### `authority.test.ts` — 12 tests

| Name | What It Tests |
|------|---------------|
| AUTO for authorized read | → `auto` |
| NOTIFY for write in dev | → `notify` |
| Production write requires approval | → `require_approval` |
| Delete requires approval | → `require_approval` regardless of environment |
| Deploy requires approval | → `require_approval` |
| Financial/legal/account_security require approval | All three → `require_approval` |
| Explicit DENY wins | → `deny` |
| Unauthorized actor denied | → `deny` |
| Agents cannot approve | → `deny` |
| Execute in non-production | → `notify` |
| Risk escalation deterministic | `delete` dev → `high`; `deploy` prod → `critical` |
| Protected action types | `delete`, `deploy`, `financial` in `PROTECTED_ACTION_TYPES` |

#### `approval.test.ts` — 6 tests

| Name | What It Tests |
|------|---------------|
| One pending per task+action | Duplicate → "one pending approval already exists" |
| Different pending action allowed | Different action on same task → ok |
| Pending → approved | Records `decidedBy`, `decision`, `decidedAt` |
| Reject terminal approval | Already approved → "terminal" error |
| Expiry detection | Past → expired; future → not; null → not |
| Terminal set correct | `approved`, `rejected`, `denied` terminal; `pending` not |

#### `taskEngine.test.ts` — 8 tests

| Name | What It Tests |
|------|---------------|
| Happy path lifecycle | `created → queued → running → completed` |
| Invalid transitions | `created → completed` rejected; `completed → queued` rejected |
| Timestamps recorded | `startedAt` on running; `completedAt` on completed |
| Failure and cancel states | `running → failed`, `running → cancelled`, `queued → cancelled`, `needs_approval → cancelled` |
| Bounded retries re-queue | Failure with attempts remaining → `queued`, attempts incremented |
| Max attempt limit | At max → `failed`, `stopped: true` |
| Never auto-retries past cap | `retryCapReached()` → true; `handleTaskFailure()` → `failed` |
| Error state preserved | Final failure stores error message and class |

### 3.4 API Layer

#### `auth.test.ts` — 8 tests (A–H)

| Test ID | Name | What It Tests |
|---------|------|---------------|
| A | Valid token resolves owner | Mocked Supabase: valid JWT → `{id, email}` for active owner |
| B | Invalid token denied | 401 from Supabase → `null` |
| C | Missing/empty token denied | Empty string → `null` |
| D | Token resolves own owner only | Token for B resolves only B, never A |
| E | Owner ID spoofing blocked | JWT sub=owner-a, owners row=owner-b → `null` |
| F | Bearer token forwarded (RLS) | owners query carries caller's Bearer token (not service_role) |
| G | service_role never used | All fetch calls use `anon` key, never `service_role` |
| H | Inactive owner denied | `status: 'pending'` → `null` (fail closed) |

#### `security.test.ts` (API) — 4 tests

| Name | What It Tests |
|------|---------------|
| Lockdown reads from Store | `activateLockdown()` → `evaluate()` returns `lockdown` |
| No false-positive | No lockdown → `allow` |
| Security events recorded | Financial transaction → events in `listSecurityEvents()` |
| Cost check default safe | No limits configured → not denied |

#### `execution.test.ts` — 3 tests

| Name | What It Tests |
|------|---------------|
| Informational from store | Status command → `daily_status` output |
| No-executor honest | No runtimes/models → `no-executor`, not fake success |
| No model fabrication | Models present but no provider adapter → still `no-executor` |

### 3.5 Gateways

#### `toolBroker.test.ts` — 6 tests

| Name | What It Tests |
|------|---------------|
| Low-risk under AUTO | Executes, `outcome: 'executed'` |
| DENY authority wins | `outcome: 'denied_by_authority'` |
| Requires approval gated | Unapproved → `requires_approval`; approved → `executed` |
| Risk ceiling enforced | Critical risk → `tool_risk_exceeded` |
| Unknown tool | `outcome: 'tool_not_found'` |
| Audit truncation | Large output secret not in JSON, length < 3000 |

#### `secretProvider.test.ts` — 4 tests

| Name | What It Tests |
|------|---------------|
| Never exposes values via list/ref | `list()` and `ref()` don't contain raw secrets |
| Values to trusted code only | `get()` returns raw value |
| Unknown keys → null | `get('NOPE')` → `null` |
| Redact from logs | `redact()` replaces secrets with `[REDACTED]` |

#### `runtimeGateway.test.ts` — 4 tests

| Name | What It Tests |
|------|---------------|
| Cheapest capable active | Selects `free` over `paid` |
| Excludes retired | `retired` not in candidates |
| No runtime when none active | All retired → `null` with reason |
| Adapter availability | No adapters registered → empty array |

#### `modelGateway.test.ts` — 8 tests

| Name | What It Tests |
|------|---------------|
| Cheapest capable simple work | Selects `cheap` (openai gpt-4o-mini) |
| Excludes retired | `retired` not in candidates |
| Tool capability filter | `no-tools` model excluded when tools needed |
| Frontier reasoning only when required | High reasoning → `frontier` (anthropic sonnet) |
| No model when nothing fits | minContextWindow 9M → `null` |
| Context window honored | 8K model rejected when 64K needed |
| Provider not hardcoded | `providers()` returns configured (empty) |
| Cost drives ordering | Cheapest wins, not provider brand |

#### `memoryGateway.test.ts` — 5 tests

| Name | What It Tests |
|------|---------------|
| Not configured without backend | `configured: false` |
| Recall empty without backend | Returns `[]`, never invented |
| Rejects lessons with secrets | Password, api key, token patterns → error |
| Accepts valid lesson | Clean reusable lesson → `null` |
| Validates lesson shape | Empty title, out-of-bounds confidence → errors |

### 3.6 Integration Tests (guarded — require `FACTORY_*` env)

#### `live.integration.test.ts` — 7 tests

| Name | What It Tests |
|------|---------------|
| Full task lifecycle | Project → task → queued → run → completed (real Supabase) |
| Approval pending → decided | Create → pending → approved |
| Audit append-only | Insert-only, survives round-trip |
| Bounded retry cap | Failed task at max attempts |
| Project isolation | Other owner sees 0 projects |
| Memory lessons persist | Lesson saved, recall empty (no vector backend) |
| Preference versioning | Set → override → read latest |
| Budget report | Cost recorded → budget ≥ amount, `exceeded: false` |

#### `security.live.integration.test.ts` — 8 tests

| Name | What It Tests |
|------|---------------|
| Critical action registry | 17 rules, 9 deny + 8 require_approval, parity with TS |
| Security events append-only + isolated | Record → visible to owner, not to other |
| Events never store secrets | `sk-live-*` redacted at write time |
| Incident workflow | Create → transitioning → closed, owner isolation |
| Lockdown lifecycle | Activate → active → release → no active |
| Agent cannot release lockdown | Agent release rejected, lockdown stays active |
| RLS probe full coverage | `ok: true`, all tables RLS-enabled, append-only |
| Agent-scoped event isolation | Events for owner not visible to other |

#### `security.api.integration.test.ts` — 1 compound test

| Name | What It Tests |
|------|---------------|
| Security endpoints end-to-end | `GET /health` → 200/healthy; `GET /critical-actions` → 17; `GET /events` → 200; `POST /incidents` → created + listed; `POST /lockdown` → active → release → gone; validation (400/404); unknown route → 404 |

---

## 4. SQL Test Suites

Both suites run against the **live Supabase Postgres** database using `node supabase/tests/run_tests.cjs [file]`. They execute inside a single transaction and `ROLLBACK` at the end, leaving zero residue.

### 4.1 `rls_tests.sql` (Gate 1 — Database/RLS)

**Runner:** `node supabase/tests/run_tests.cjs rls_tests.sql`

**Pattern:** `SET ROLE` + `set_config('request.jwt.claim.sub', ...)` to simulate authenticated users. Helper functions `_tfail()` and `_texpect_error()` raise exceptions on assertion failure. All wrapped in `BEGIN…ROLLBACK`.

| Test | Name | What It Tests |
|------|------|---------------|
| **TEST 1** | Owner Identity | Owner 1 can read own row; cannot read Owner 2's row (RLS SELECT policy) |
| **TEST 2** | Owner sees all own projects/tasks | Owner 1 sees 2 projects + 2 tasks; Owner 2 sees nothing of Owner 1 |
| **TEST 3** | Project isolation (agent-scoped) | Agent with permissions on Project A only: sees 1 project, 1 task in A, 0 in B |
| **TEST 4** | Unauthorized access | `anon` role sees 0 rows in projects/owners; unknown authenticated user sees 0 projects/tasks |
| **TEST 5** | Audit append-only | RLS: UPDATE/DELETE affect 0 rows. Trigger layer: UPDATE/DELETE raise exceptions (superuser bypass attempt) |
| **TEST 6** | Preference versioning | Duplicate active version rejected; deactivation + re-insert works; exactly 1 active per key |
| **TEST 7** | Required foreign keys | Invalid project_id FK → rejected; NULL project_id → rejected; invalid agent_id FK → rejected; negative cost → rejected |

**Trigger verification (superuser bypass):** Tests verify that even `postgres` role (full privileges) cannot UPDATE/DELETE `audit_events` due to trigger-level enforcement.

### 4.2 `rls_security_tests.sql` (Gate 2 — Security Guardian RLS/DB)

**Runner:** `node supabase/tests/run_tests.cjs rls_security_tests.sql`

| Test | Name | What It Tests |
|------|------|---------------|
| **S1** | Critical actions registry | Exactly 17 rows, all `is_core=true`, 9 deny + 8 require_approval. UPDATE/DELETE blocked by trigger. Invalid decision blocked. Authenticated owner can read. |
| **S2** | Security events isolation + append-only | Owner sees only own events (1 vs 1 seeded). RLS UPDATE/DELETE affect 0 rows. Trigger blocks UPDATE/DELETE even as superuser. |
| **S3** | Security lockdowns history + owner release | Owner sees own lockdown. Owner can release own lockdown (status → `released`). Deletion hard-blocked by trigger. |
| **S4** | Security incidents CRUD isolation | Owner sees 1 incident. Owner can transition own incident. Owner cannot see/update other owner's incident. |
| **S5** | Security policies read-only registry | 13 deterministic rules, all enabled. Authenticated can read. UPDATE affects 0 rows (no RLS policy). |
| **S6** | Security rate limits scope | Owner sees only own rate limit configs (1 seeded). |
| **S7** | TRUNCATE guard (defense-in-depth) | Trigger layer: TRUNCATE blocked for `security_events`, `critical_actions`, `security_lockdowns`, `security_incidents`, `security_rate_limits`, `security_policies`, `audit_events` (even as `postgres`). Privilege layer: authenticated role has no TRUNCATE privilege on these tables. |

**Protected tables in S7:** 7 tables verified against TRUNCATE at both trigger level and privilege level.

---

## 5. Live HTTP Verification

**Runner:** `npx tsx scripts/live-http-verification.ts`
**Prerequisite:** `FACTORY_SERVICE_ROLE_KEY` must be present in environment (self-blocks otherwise)
**Mechanism:** Creates disposable user via Supabase admin API → password grant → boots local HTTP server → executes 9 tests → cleans up user + residue

### Test Inventory (9 tests)

| Test ID | Name | HTTP Method + Endpoint | What It Tests | Expected Result |
|---------|------|----------------------|---------------|-----------------|
| **T1** | `AUTH_OWNER_RESOLUTION` | `GET /api/me` | HTTP auth → Bearer token → owner resolution through `AuthService.verifyOwner()` | `status=200`, response `id` matches created user |
| **T2** | `RLS_WRITE_PROJECT` | `POST /api/projects` | Owner creates a project via HTTP (RLS INSERT path, real Postgres) | `status=200`, `projectId` non-empty |
| **T3** | `AUTHORIZED_SAFE_EXECUTION` | `POST /api/chat` (`list tasks in {slug}`) | Safe command passes through guardian → reaches execution decision | `outcome` in `[executed, failed, retry_pending]`, not `denied`/`blocked` |
| **T4** | `CRITICAL_REQUIRES_APPROVAL` | `POST /api/chat` (`execute transfer 100 in {slug}`) | Financial command held at approval gate | `outcome=waiting_approval`, `approvalId` present |
| **T5** | `DENY_FAIL_CLOSED` | `POST /api/chat` (`delete task in nonexistent-project-xyz`) | Unknown scope → deny-by-default, nothing executed | `outcome` in `[unknown_project, denied, blocked]` |
| **T6** | `LOCKDOWN_FAIL_CLOSED` | `POST /api/security/lockdown` → `POST /api/chat` → `POST /api/security/lockdown/release` | Lockdown activates → safe command denied → financial command denied → lockdown released | Lockdown `status=active`, both chats `outcome=denied`, release succeeds |
| **T7** | `SECURITY_EVENT_PERSISTENCE` | `GET /api/security/events` | Guardian deny/lockdown events persisted and owner-scoped | `status=200`, ≥2 events with `denied.*` or `health.lockdown` type |
| **T8** | `RETRY_BOUNDED` | `POST /api/chat` (`execute task in {slug}`) | Bounded retry: `attempts ≥ 1`, `attempts ≤ maxAttempts`, `maxAttempts ≤ 3` | Task present, attempts within bounds |
| **T9** | `PROJECT_ISOLATION` | `GET /api/projects` | All returned projects belong to the authenticated owner (RLS enforcement) | Every project's `ownerId` matches created user |

**Residue check (post-cleanup):** After test cleanup, a fresh `pg.Pool` verifies `auth.users` and `public.owners` have zero rows matching `probe-live-%@example.invalid`.

**Cleanup:** Owner-scoped rows deleted via `session_replication_role = 'replica'` (bypasses append-only triggers). Auth user deleted via Supabase admin API.

---

## 6. Test Scripts (`package.json`)

| Script | Command | What It Does |
|--------|---------|--------------|
| `test` | `vitest run` | Runs ALL vitest tests (unit + integration) |
| `test:unit` | `vitest run src/core src/gateways` | Runs unit tests only (core + gateways, excludes API + integration) |
| `test:integration` | `vitest run src/integration` | Runs integration tests only (guarded by env vars) |
| `typecheck` | `tsc --noEmit` | Type-checks without emitting |
| `build` | `tsc -p tsconfig.build.json` | Compiles to `dist/` |
| `start` | `node dist/api/server.js` | Starts production server |
| `dev` | `tsx src/api/server.ts` | Starts dev server |
| `seed` | `tsx src/db/seed.ts` | Seeds database |

**SQL test runners (not npm scripts — run manually):**
| Runner | Command |
|--------|---------|
| Gate 1 RLS tests | `node supabase/tests/run_tests.cjs rls_tests.sql` |
| Gate 2 Security tests | `node supabase/tests/run_tests.cjs rls_security_tests.sql` |
| Live HTTP verification | `npx tsx scripts/live-http-verification.ts` |
| Apply migration | `node supabase/tests/apply_migration.cjs <migrationFile>` |

---

## 7. Test Results Summary

| Tier | Test Suite | Count | Status | Evidence |
|------|-----------|-------|--------|----------|
| **1** | `securityGuardian.test.ts` | 41 | TESTED | vitest output |
| **1** | `pipeline.test.ts` | 18 | TESTED | vitest output |
| **1** | `monitoring.test.ts` | 4 | TESTED | vitest output |
| **1** | `intent.test.ts` | 10 | TESTED | vitest output |
| **1** | `explanation.test.ts` | 4 | TESTED | vitest output |
| **1** | `decisionJournal.test.ts` | 5 | TESTED | vitest output |
| **1** | `cost.test.ts` | 5 | TESTED | vitest output |
| **1** | `autonomy.test.ts` | 8 | TESTED | vitest output |
| **1** | `authority.test.ts` | 12 | TESTED | vitest output |
| **1** | `approval.test.ts` | 6 | TESTED | vitest output |
| **1** | `taskEngine.test.ts` | 8 | TESTED | vitest output |
| **1** | `auth.test.ts` | 8 | TESTED | vitest output |
| **1** | `security.test.ts` (API) | 4 | TESTED | vitest output |
| **1** | `execution.test.ts` | 3 | TESTED | vitest output |
| **1** | `toolBroker.test.ts` | 6 | TESTED | vitest output |
| **1** | `secretProvider.test.ts` | 4 | TESTED | vitest output |
| **1** | `runtimeGateway.test.ts` | 4 | TESTED | vitest output |
| **1** | `modelGateway.test.ts` | 8 | TESTED | vitest output |
| **1** | `memoryGateway.test.ts` | 5 | TESTED | vitest output |
| | **Unit total** | **163** | | |
| **1+** | `live.integration.test.ts` | 8 | UNVERIFIED | Requires `FACTORY_*` env (not present in CI) |
| **1+** | `security.live.integration.test.ts` | 8 | UNVERIFIED | Requires `FACTORY_*` env |
| **1+** | `security.api.integration.test.ts` | 1 | UNVERIFIED | Requires `FACTORY_*` env |
| **2** | `rls_tests.sql` (Gate 1) | 7 | UNVERIFIED | Requires live Supabase connection |
| **2** | `rls_security_tests.sql` (Gate 2) | 7 | UNVERIFIED | Requires live Supabase connection |
| **3** | Live HTTP verification | 9 | UNVERIFIED | Requires `FACTORY_SERVICE_ROLE_KEY` |

**Last verified:** Unit tests (Tier 1) pass in local development. Integration and SQL tests require live database credentials.

---

## 8. Test Gaps

### Not Tested

| Area | Reason | Risk |
|------|--------|------|
| `src/db/*.test.ts` | No unit test files exist for database layer | `SupabaseStore` methods only tested via integration tests (which require live DB) |
| `src/api/handlers.ts` (direct) | API handler routing tested only through integration tests | Handler dispatch logic untested in isolation |
| `src/api/server.ts` (direct) | Server startup/shutdown not unit-tested | Startup failures only caught at runtime |
| `src/db/pool.ts` | Connection pool creation/failure not tested | Pool exhaustion untested |
| `src/db/config.ts` | Config loading/validation not tested | Invalid config only caught at runtime |
| Error recovery paths | Most error paths tested for `deny`/`fail` outcomes, but network failures, connection drops, and partial write scenarios are not unit-tested | Production resilience relies on integration/live testing |
| Concurrent access | No concurrent test scenarios (multiple owners, race conditions) | Isolation relies on RLS, not application-level locking |
| Performance/load | No load tests | Not required for Gate 1/2 contract |

### Conditional/Flaky Tests

| Suite | Condition | Behavior |
|-------|-----------|----------|
| `live.integration.test.ts` | Skipped unless `FACTORY_*` env vars present | **Always skipped in CI without credentials** |
| `security.live.integration.test.ts` | Skipped unless `FACTORY_*` env vars present | **Always skipped in CI without credentials** |
| `security.api.integration.test.ts` | Skipped unless `FACTORY_*` env vars present | **Always skipped in CI without credentials** |
| `rls_tests.sql` | Requires live Supabase Postgres connection | Manual execution only |
| `rls_security_tests.sql` | Requires live Supabase Postgres connection | Manual execution only |
| Live HTTP verification | Requires `FACTORY_SERVICE_ROLE_KEY` + live Supabase | Self-blocks; manual execution only |
| Transactional integration tests | Supabase pooler may leak transaction-scoped DML | `afterAll` purges test-namespaced users as mitigation |

### Design Observations

- **No `service_role` usage in normal paths:** Test `G` in `auth.test.ts` explicitly verifies this. SQL tests use `SET ROLE` to simulate `authenticated`.
- **Append-only enforcement at two layers:** RLS (no UPDATE/DELETE policies) + database triggers (block even superuser). Both tested.
- **TRUNCATE defense-in-depth:** Migration-hardened with BEFORE TRUNCATE statement triggers + privilege revocation. Tested in `S7`.
- **Zero-residue guarantee:** All integration tests use transactional rollback + `afterAll` cleanup of test-namespaced users.
