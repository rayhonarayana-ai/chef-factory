# CHEF FACTORY — GATE 2 — EVIDENCE

**Date:** 2026-08-16
**Status:** GATE 2 SECURITY GUARDIAN — IMPLEMENTED + TESTED + LIVE_VERIFIED
(+ FORENSIC REVIEW V1.0 — two defects fixed & live-verified, incl. TRUNCATE hardening)
(+ FORENSIC REMEDIATION V1.0 — guardian wired into live server; Missions 6–9 closed; LIVE HTTP VERIFICATION RUN 2026-08-16 = FAILED 0/9 — critical auth defect → GATE_2_BLOCKED — see §1.10.6)
(+ BLOCKER REMEDIATION V1.1 — 2026-08-16: `auth.ts` setSession bug + `server.ts` double-JSON-encoding fixed; LIVE HTTP VERIFICATION RUN = **PASS 9/9** → LIVE_EXECUTION_BOUNDARY = **VERIFIED** → **GATE_2_PASS** — see §1.10.7)
**Environment:** Windows (PowerShell) · node v24.19.0 (portable, node-dist) · Supabase CHEF FACTORY DB (`dybyidtcyzgliupzzfhl`, eu-west-1)

---

## 1. Verification Log (actual output)

### 1.1 Unit tests — Security Guardian (`src/core/security/securityGuardian.test.ts`)
```
RUN v1.6.1
✓ src/core/security/securityGuardian.test.ts (41 tests) 38ms
Test Files 1 passed (1) · Tests 41 passed (41)
```
41 = 26 deterministic topics (T1–T26) + 10 adversarial scenarios + 4 persistence/parity.

### 1.2 Full suite (unit + live integration)
```
Test Files 20 passed (20) · Tests 166 passed (166)
```
Includes Gate 1 regression (`src/core`/`src/gateways` 149 unit), `live.integration.test.ts`
(8), `security.live.integration.test.ts` (8), `security.api.integration.test.ts` (1).

### 1.3 TypeScript
```
tsc --noEmit                  → (no output)   PASS
tsc -p tsconfig.build.json    → BUILD_EXIT=0  PASS
```

### 1.4 Live DB — RLS/DB suites (transactional, self-cleaning)
```
MIGRATION_APPLIED 20260817000000_security_guardian.sql (498ms)
RLS_SECURITY_TESTS.SQL_PASS (1052ms) — all deterministic tests succeeded
RLS_TESTS.SQL_PASS (620ms) — all deterministic tests succeeded   (Gate 1 regression)
```

### 1.5 Zero residue check (post-run, live query)
```
LEAKED_TEST_USERS=[]          (no sec-*, sec-api-*, it-* rows)
security_events=0 incidents=0 lockdowns=0
critical_actions=17 policies=13 rate_limits=0
```

### 1.6 API smoke → converted to permanent test
```
200 health · 200 events · 200 critical-actions · 200 incidents.create ·
200 incidents.list · 400 incidents.create.emptyTitle · 200 lockdown.activate ·
200 lockdown.active · 200 lockdown.release · 404 lockdown.release.badId ·
400 lockdown.activate.noReason · 404 unknown.route
SMOKE_PASS 12 endpoints
```
Re-run via `src/integration/security.api.integration.test.ts` — PASS.

## 1.7 Forensic review (G2 FORENSIC AUDIT V1.0)

Critical DB finding — **TRUNCATE bypasses RLS** and does not fire `FOR EACH ROW` triggers.
Proven live as `authenticated` before the fix:
```
TRUNCATE public.security_events    → SUCCESS (events wiped)
TRUNCATE public.critical_actions   → SUCCESS (immutable registry bypassed)
```
Fix applied: `supabase/migrations/20260818000000_security_truncate_hardening.sql`
(BEFORE TRUNCATE ... FOR EACH STATEMENT triggers on 7 tables + REVOKE TRUNCATE/TRIGGER
from anon/authenticated):
```
MIGRATION_APPLIED 20260818000000_security_truncate_hardening.sql (247ms)
```
Post-fix (two layers): `authenticated` → permission denied on all 7; `postgres` → blocked by
triggers ("security_events is append-only", "critical_actions registry is immutable", ...).

Secondary fix — `rlsProbe` in `src/db/repo.ts` merged two append-only probes into one
`EXISTS`; split into two independent EXISTS queries.

Pipeline–Guardian integration now proven by 3 new deterministic tests
(`src/core/pipeline.test.ts`): lockdown fail-closed (denied + `security.guardian_denied`
audit + cancelled), no false-positive without lockdown, financial command never downgraded
below `require_approval`.

### 1.8 Post-forensic full re-verification
```
tsc --noEmit                  → (no output)                PASS
tsc -p tsconfig.build.json    → BUILD_EXIT=0               PASS
vitest run                    → 20 files · 169/169 PASS    PASS
RLS_TESTS.SQL_PASS (333ms)                                 PASS
RLS_SECURITY_TESTS.SQL_PASS (351ms) — S1..S7               PASS (S7 = truncate protection)
```
Zero residue re-confirmed: `LEAKED_TEST_USERS=[]` · events/incidents/lockdowns=0 ·
critical_actions=17 · policies=13.

See `GATE_2_FORENSIC_REVIEW.md` for the full audit trail. **Historical note (as of FORENSIC
V1.0):** `src/api/server.ts:169` constructed the pipeline without the guardian (UNVERIFIED at
the live-server level) — **this was resolved in FORENSIC REMEDIATION V1.1, see §1.9 below**.

### 1.9 FORENSIC REMEDIATION V1.0 — final security integration closure

```
MISSION_3 (guardian wiring): PASS
  - src/api/security.ts        NEW  createSecurityGuardian(store): lockdown→store.activeLockdown,
                                       RateLimiter, AnomalyDetector,
                                       recordEvent→store.recordSecurityEvent, CostProtector
  - src/api/server.ts:170      wired  new CommandPipeline(store, execution, createSecurityGuardian(store))
  - src/core/security/guardian.ts  lockdown dep is now async-capable; evaluate() awaits it
                                       (was sync-only → DB-backed lockdown would fail silently = bypass)
  - src/api/security.test.ts   NEW  4 factory tests PASS (MemoryStore)
  - tsc --noEmit → PASS
MISSION_6 (migration timestamp forensics): PASS
  - 4 migrations valid logical-ordering stamps; FS create times 16/08/2026 01:21→03:55,
    DB clock 2026-08-16T03:44Z → no wall-clock forgery, no env clock skew
  - GAP: supabase_migrations.schema_migrations tracks only 20260815220000 + 20260816000000;
    20260817000000 + 20260818000000 are APPLIED but UNTRACKED (raw SQL, not CLI) →
    future `supabase db push` risk; documented, not modified
MISSION_7 (full regression): PASS
  - tsc --noEmit PASS · tsc -p tsconfig.build.json PASS (dist/api/server.js:145 = guardian wired)
  - vitest run → 21 files · 173/173 PASS (169 prior + 4 new factory tests)
  - RLS_TESTS.SQL_PASS · RLS_SECURITY_TESTS.SQL_PASS (S1–S7)  (run via temp tsx runner;
    supabase/tests/run_tests.js referenced in the header DOES NOT EXIST)
MISSION_8 (cleanup forensics): PASS
  - SECRET_SCAN_CLEAN (6 hits, all benign prose/comments + redaction-test fake token)
  - TEST_RESIDUE=NONE (auth.users=0 identities=0 owners=0 events/incidents/lockdowns/tasks/audit=0;
    all _probe_*.ts, _run_rls.ts, _forensic_truncate*.ts, _identity_check.mjs deleted)
MISSION_9 (architectural consistency): PASS
  - BYPASS_STATUS = NONE_FOUND: single production `new CommandPipeline(` (server.ts:170, guarded);
    single `.run(` caller (handlers.ts:51); ToolBroker not wired into API path; Model/Runtime
    gateways reachable only via execution.ts after guardian evaluation; approval decision
    handler (handlers.ts:111–131) only patches the approval record, never executes
LIVE_VERIFICATION = BLOCKED — FACTORY_SERVICE_ROLE_KEY_MISSING (no credential requested;
  owner may set it later; exact live-test plan recorded in GATE_2_FINAL_REPORT.md §22)

### 1.10 ARCHITECT REVIEW (FORENSIC CLOSURE PACK) — live probes + final matrix

**1.10.1 Migration tracking forensics (live probe, 2026-08-16):**
```
SCHEMAS=supabase_migrations
MIG_TABLE_COLUMNS=version,statements,name
MIGRATION_ROWS=factory_init|20260815220000;core_additions|20260816000000
DB_OBJECTS: trigger=0(block_%)  function=5(block_%)  policy_count=80
TRUNCATE triggers present on all 7 tables (tgtype 34 = BEFORE TRUNCATE FOR EACH STATEMENT):
  audit_events_no_truncate · critical_actions_no_truncate · security_events_no_truncate ·
  security_incidents_no_truncate · security_lockdowns_no_truncate · security_policies_no_truncate ·
  security_rate_limits_no_truncate   (correction to earlier report: trigger names are <table>_no_truncate,
  not block_*; the 5 block_* functions are the ones they call)
GRANTS: anon/authenticated hold DELETE/INSERT/REFERENCES/SELECT/UPDATE on the 7 tables (RLS + append-only
  triggers are the enforcement); TRUNCATE/TRIGGER privileges REVOKED (absent from role_table_grants).
```
`supabase_migrations.schema_migrations` is authoritative for the Supabase CLI's applied-state bookkeeping.
Migrations 3–4 (`20260817000000_security_guardian`, `20260818000000_security_truncate_hardening`) are
**applied** (all objects present and verified above) but **untracked** → classification **B) migration
integrity issue** (tracking table out of sync with actual history), NOT real schema drift (catalog matches
the migration SQL). **Proposed safe + deterministic correction (not executed — pending owner/architect
approval):** `supabase migration repair --status applied 20260817000000` then `--status applied
20260818000000` (records applied state without executing SQL → alters no application state). Until then:
**accepted forensic limitation**, and a future `supabase db push` may attempt to re-apply them and fail.

**1.10.2 Vocabulary alignment (analysis only — no refactor):**
Key mismatches identified: (1) pipeline `actionTypeFor` vocabulary (`financial`, `legal`, `account_security`,
`deploy`, `delete`, ...) has **zero overlap** with the Critical Action Registry keys (`financial_transaction`,
`legal_commitment`, `production_modification`, ...) → `classifyCriticalAction` never matches in the live
pipeline; the immutable registry (17 DB rows + parity) is currently defense-in-depth only. Protection for
those classes is carried by Gate 1 (`PROTECTED_ACTION_TYPES` + `riskFromAction`). (2) Security policy rule-id
naming diverges between code (`rule.critical_action_require_approval`, `rule.environment_isolation`,
`rule.production_write_execute`, `rule.default_allow`) and the DB documentation registry
(`rule.critical.require_approval`, `rule.environment_escalation`, `rule.production.write_execute`,
`rule.default.allow`) — 12 DB rows vs 12 code rules, functionally harmless (DB registry is descriptive).
(3) snake_case DB columns vs camelCase TS types — handled by `repo.ts` aliases (live-proven). (4) Event types
`anomaly.retry_burst` / `anomaly.tool_anomaly` / `anomaly.auth_failures` / `secret.access_attempt` defined but
never emitted (unwired counters). Full per-item table in GATE_2_FINAL_REPORT.md §26.

**1.10.3 Anomaly / failure-rate wiring (code audit):**
`AnomalyDetector` (10 counters) — `note()` called only in `guardian.ts noteAnomalies` for 5:
`deniedActions`, `environmentEscalations`, `projectSwitches`, `policyViolations`, `costSpikes` (→ events only;
never influence decisions). **DEFINED_ONLY (no production caller):** `authFailures`, `retryBursts`,
`toolAnomalies`, `secretAccessAttempts`, and also `privilegeRequests`. Rate limits: only `task.execute` and
`tool.call` are exercised in the live path (pipeline sets `scope='task'|'tool'`). `auth.failure`,
`task.failure`, `approval.request`, `runtime.execute`, `model.call` configs exist with a working check path
in the guardian but **no caller feeds those scopes** → WIRED_BUT_NOT_ENFORCED. Not part of the mandatory
Gate 2 closure contract; recommendations deferred to a future Gate.

**1.10.4 Live HTTP readiness:** `FACTORY_SERVICE_ROLE_KEY_PRESENT = NO`. Runner prepared at
`scripts/live-http-verification.ts` (typecheck PASS, verified to self-block without the key; runs the exact
authorized plan when the key is present: admin-create one disposable `probe-live-<uuid>@example.invalid` →
password grant → REAL HTTP /api/chat tests → cleanup via admin delete + replica-role DB purge → residue check).
Never prints any credential.

**1.10.5 FINAL EVIDENCE MATRIX** (one final status per capability):

| CAPABILITY | IMPLEMENTATION | TESTED | LIVE_VERIFIED | UNVERIFIED | BLOCKED | EVIDENCE_REFERENCE | OPEN_RISK |
|---|---|---|---|---|---|---|---|
| Identity/auth (JWT verifyOwner) | YES | YES | YES | — | — | live.integration.test.ts · auth.ts | — |
| Owner resolution + RLS scoping | YES | YES | YES | — | — | rls_tests.sql · live.integration "project isolation" | — |
| Critical Action Registry (17) | YES | YES | YES | — | — | criticalActions.ts + DB 17 rows · S1 | **vocab gap: registry inert for pipeline actionTypes (defense-in-depth only)** |
| Emergency lockdown | YES | YES | YES | — | — | lockdown.ts · live agent-release-rejected · S3 | HTTP traversal blocked |
| Rate limiting | YES | YES | — | — | — | rateLimit.ts · guardian scope task/tool | auth.failure/task.failure/approval/model/runtime = WIRED_BUT_NOT_ENFORCED |
| Cost protection | YES | YES | — | — | — | costProtection.ts · T-tests | — |
| Anomaly detection | YES | YES | — | — | — | anomaly.ts · T-tests | 4 counters + privilegeRequests = DEFINED_ONLY |
| Secret guard + redaction | YES | YES | YES | — | — | secretGuard.ts · live redaction test | — |
| Prompt injection defense | YES | YES | — | — | — | promptInjection.ts · 10 adversarial | — |
| Security events (append-only) | YES | YES | YES | — | — | events.ts + DB · S2 · triggers | — |
| Incident workflow | YES | YES | YES | — | — | incidents.ts + DB · S4 | — |
| Security health / rlsProbe | YES | YES | YES | — | — | health.ts · live rlsProbe | — |
| RLS + TRUNCATE hardening | YES | YES | YES | — | — | 7 no_truncate triggers (tgtype 34) · S7 · revoke verified | **migrations 3–4 untracked in schema_migrations** |
| Guardian → production pipeline | YES | YES | — | — | — | server.ts:170 · security.ts · security.test.ts | HTTP traversal blocked |
| Security API endpoints | YES | YES | YES | — | — | 12-endpoint smoke + security.api.integration | — |
| Autonomy / approval gating | YES | YES | YES | — | — | financial→waiting_approval · approvals DB | HTTP traversal blocked |
| Regression suite | YES | YES | — | — | — | 173/173 · RLS S1–S7 | — |
| Residue / secret hygiene | YES | YES | YES | — | — | probes users=0 owners=0 events=0 · scan clean | — |
| **LIVE AUTHENTICATED HTTP TRAVERSAL** | YES (server path) | — | **YES — PASS 9/9** | — | — | LIVE RUN 2026-08-16 (×2) → §1.10.6 + §1.10.7 | **fixes applied: `auth.ts` Bearer-propagation + `server.ts` single-encode → GATE_2_PASS** |
```

**1.10.6 LIVE HTTP VERIFICATION RESULT (2026-08-16, FACTORY_SERVICE_ROLE_KEY_PRESENT=YES):**

- Runner executed unmodified: `npx tsx scripts/live-http-verification.ts`.
- `AUTHENTICATION_TEST = PASS` (admin-create + password grant + real session); server booted on 127.0.0.1:18789.
- All 9 HTTP cases **FAILED** with `status=401` → `HTTP_TESTS_PASSED=0/9` → `LIVE_EXECUTION_BOUNDARY = UNVERIFIED`.
- **Root cause (isolated by raw probes, no secret exposure):**
  1. `SERVER_GETUSER = PASS` — JWT valid, verified by Supabase Auth (`getUser`).
  2. `src/api/auth.ts:35` — `await scoped.auth.setSession({ access_token: token, refresh_token: '' })` → **`SESSION_ATTACHED=false`** (supabase-js 2.112.3 does not attach the session with empty refresh_token under `persistSession:false`).
  3. The `owners` select then runs **without the user's token** → RLS → 0 rows → `PGRST116` (`The result contains 0 rows`) → `verifyOwner` returns null → 401.
  4. Same query over **raw HTTP with `Authorization: Bearer <token>`** returns exactly 1 row `status=active` (PASS) — and a `PostgrestClient` with the token as a direct Bearer header also returns `status=active` (PASS). RLS, token, and policy are all correct; only the `setSession` client-path is broken.
- **Security impact:** the live Control Plane HTTP boundary cannot authenticate ANY owner (all owner-authenticated endpoints 401). Deterministic/test layer unaffected (tests exercise code directly, not this client path). Not exploitable — fail-closed (deny by default), but the boundary is unusable until fixed.
- **Minimal deterministic fix (proposed, NOT applied):** in `src/api/auth.ts` replace the `setSession` scoped-client query with the PostgREST client using the verified Bearer token directly (proven PASS), or a parameterized pool query scoped to the verified owner id.
- **Cleanup:** probe users=0, owners=0; all diagnostic files deleted; no credentials printed/exposed.

**1.10.7 BLOCKER REMEDIATION RESULT (2026-08-16, FACTORY_SERVICE_ROLE_KEY_PRESENT=YES):**

- **Fix 1 — auth propagation (`src/api/auth.ts`):** replaced the broken `scoped.auth.setSession({...})` (which did not attach the session in supabase-js 2.112.3 → every authenticated request 401) with `supabase.auth.getUser(token)` validation + a direct PostgREST query to `owners` using the verified token as `Authorization: Bearer <token>` (`apikey: anon` — NO service_role). Enforces `owner.id === user.id && status === 'active'`; any error → null (fail-closed). Chain preserved: JWT → verified owner → owner-scoped Store → RLS → Guardian → Policy → Autonomy → Approval → Execution.
- **Fix 2 — double JSON encoding (`src/api/server.ts:127`):** `send()` applied `JSON.stringify` twice (once before, once after `redact()`), so every JSON response body was delivered as a JSON-encoded string (`"{\"id\":\"…\"}"`) — clients parsing with `.json()` received a STRING, so field reads returned `undefined`. Removed the outer `JSON.stringify` (redact takes a string and returns a string). This second defect was uncovered by the live runner (statuses were 200 but payload fields were missing).
- **Live runner corrections (minimal, deterministic, security-neutral — no weakening):**
  - T4 command `transfer 100 in X` → `execute transfer 100 in X` (`transfer` is a supported resource, not a verb; `execute` is a supported verb) → exercises the real `financial` → `require_approval` path.
  - T6 reads the lockdown response envelope `{ lockdown: { status, lockdownId } }` and passes `lockdownId` to the release endpoint (which requires it).
  - T6 additionally asserts a second locked command is denied (2 `health.lockdown` events → T7 persistence ≥2).
  - T8 command `execute build in X` → `execute task in X` (`build` is a verb keyword, not a resource; `task` is the supported project-scoped resource).
  - Residue check now uses a fresh `pg.Pool` (the server pool is ended before the check — previously always `UNKNOWN`).
- **Final live run (runner unmodified after the above corrections):**
  ```
  TEST AUTH_OWNER_RESOLUTION      = PASS
  TEST RLS_WRITE_PROJECT          = PASS
  TEST AUTHORIZED_SAFE_EXECUTION  = PASS (outcome=executed)
  TEST CRITICAL_REQUIRES_APPROVAL = PASS (waiting_approval)
  TEST DENY_FAIL_CLOSED           = PASS (unknown_project)
  TEST LOCKDOWN_FAIL_CLOSED       = PASS (locked → denied → released)
  TEST SECURITY_EVENT_PERSISTENCE = PASS (2 events)
  TEST RETRY_BOUNDED              = PASS (attempts=1/3)
  TEST PROJECT_ISOLATION          = PASS (1 project, owner-scoped)
  HTTP_TESTS_PASSED=9/9   LIVE_EXECUTION_BOUNDARY = VERIFIED
  TEST_RESIDUE users=0 owners=0
  ```
- **Regression after fixes (PHASE 7):** vitest **181/181 (22 files)** PASS · `RLS_TESTS.SQL_PASS` · `RLS_SECURITY_TESTS.SQL_PASS` (S1–S7) · `tsc --noEmit` PASS · `npm run build` (tsc -p tsconfig.build.json) BUILD_EXIT=0 · new `src/api/auth.test.ts` 8/8 (A–H).
- **Classification: `GATE_2_PASS`.** Historical failure preserved in §1.10.6 (not erased).

---

## 2. Deliverables (Gate 2 contract)

| # | Deliverable | Evidence |
|---|---|---|
| 1 | Security policy engine (deterministic, precedence) | `src/core/security/policyEngine.ts` · T-tests · RLS TEST S5 |
| 2 | Risk classification engine | `src/core/security/riskEngine.ts` · T-tests |
| 3 | Critical Action Registry (immutable, 17 rules) | `src/core/security/criticalActions.ts` + DB 17 rows · S1 |
| 4 | Emergency lockdown (fail closed, owner-only release) | `lockdown.ts` · live test (agent release rejected) · S3 |
| 5 | Rate limiting | `rateLimit.ts` · 7 scopes · S6 |
| 6 | Cost protection | `costProtection.ts` · T-tests |
| 7 | Anomaly detection (deterministic thresholds) | `anomaly.ts` · T-tests |
| 8 | Secret guard (scan + deep scan + redaction) | `secretGuard.ts` · live redaction test |
| 9 | Prompt injection defense (DATA, never authority) | `promptInjection.ts` · 10 adversarial tests |
| 10 | Security events (append-only, owner-scoped) | `events.ts` + DB · S2 · live isolation |
| 11 | Incident workflow | `incidents.ts` + DB · S4 · live workflow |
| 12 | Security health (never false healthy) | `health.ts` · live `rlsProbe` |
| 13 | Security RLS + migration | `20260817000000_security_guardian.sql` APPLIED |
| 14 | Store ports + repo + fixture | `ports.ts` · `repo.ts` · `memoryStore.ts` |
| 15 | Fail-closed hooks (optional) | `toolBroker.ts` · `runtimeGateway.ts` · `pipeline.ts` |
| 16 | Security API endpoints | `server.ts` + `handlers.ts` · live API test |
| 17 | 26 + 10 unit tests | `securityGuardian.test.ts` (41 PASS) |
| 18 | RLS + live integration tests | `rls_security_tests.sql` PASS · 9 live integration PASS |
| 19 | 18 Gate 2 docs + 6 doc updates + this evidence | `docs/factory/` |

---

## 3. Code references (file:line)

- `src/core/security/guardian.ts:33` — `SecurityGuardian.evaluate` full chain.
- `src/core/security/policyEngine.ts:20` — `moreRestrictive`; `:26` `combineAuthority`;
  `:51` `evaluatePolicy`.
- `src/core/security/criticalActions.ts:13` — 17 core rules (parity with DB seed).
- `src/core/security/events.ts:39` — `severityFor` (incl. `info.` prefix).
- `src/core/security/secretGuard.ts:16` — labeled secret patterns.
- `src/db/repo.ts:540` — Gate 2 Store methods (snake→camel aliasing verified live).
- `src/core/pipeline.ts:224` — optional Guardian integration (deny → cancelled +
  `security.guardian_denied` audit; upgrade-only reconciliation at `:271`).
- `supabase/tests/run_tests.cjs` — runner supporting both RLS suites.

## 4. Defects found & fixed during verification

1. `moreRestrictive` returns the restrictive decision (string), not boolean → test
   corrected to assert `'deny'`/`'lockdown'`.
2. JWT test fixture third segment < 8 chars → real JWT fixture used.
3. `severityFor('info.*')` lacked the `info.` rule → rule added in `events.ts:40`.
4. `closed → detected` is the truly invalid transition (not detected→closed) → test
   corrected.
5. **Live bug:** `select *` on security tables returned snake_case columns while the
   store type expects camelCase → explicit column aliases added in `repo.ts`
   (events/incidents/lockdowns), proven by the live round-trip test that first failed.
6. **[FORENSIC G2-1] Critical:** TRUNCATE bypassed RLS and `FOR EACH ROW` triggers on all
   7 security tables (proven live, data wiped) → `20260818000000_security_truncate_hardening.sql`
   adds BEFORE TRUNCATE triggers + REVOKE TRUNCATE/TRIGGER → live-verified both layers.
7. **[FORENSIC G2-2]** `rlsProbe` derived both append-only probes from one merged EXISTS
   → split into two independent EXISTS queries in `repo.ts`.

## 5. Boundary compliance

- Gate 1 suite: 105 unit + 8 live integration still PASS (no regression).
- No deployment performed; no Gate 3 work. Migration applied to the sanctioned Factory
  DB as verification, identical to Gate 1 practice.
- All security data owner-scoped; zero residue; secrets never persisted.
