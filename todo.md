# CHEF FACTORY — TODO

## Current Phase
GATE 3 — **PASS** (2026-08-17): Live provider verification complete. OpenAI tool calling LIVE_VERIFIED. All 222 tests PASS. TYPECHECK PASS. BUILD PASS. Classification: GATE_3_PASS.

## Status
Gate 3 PASS confirmed. OpenAI provider authenticated and tool calling verified live (2026-08-17). gpt-4o-mini model used. Tool schema transmitted, tool call returned, tool resolution verified, conversation continuity verified. 222/222 tests PASS, 17/17 SQL/RLS PASS. All Gate 2 foundations intact. No regressions. No credential exposure. Zero test residue.

## Next Phase
Ready for Gate 4 when architect/owner chooses to proceed. Remaining deferred items: Growth Engine · Sales Engine · Memory/vector backend · Multi-agent autonomy · Deployment · Browser automation · Financial/legal execution · Kubernetes/microservices.

---

## Owner Actions Required
- [ ] OWNER: Plan reactivation of paused project `kwwqqtuggkooqnrwqzsi` (PROOFOS) when needed
- [ ] OWNER: Provide a fresh PAT securely ONLY when Management API access is required again
- [ ] ARCHITECT (deferred): Align registry/pipeline vocabularies · wire anomaly counters + failure rate limits · decide handling of untracked migrations 3–4 in schema_migrations

## Completed — BLOCKER REMEDIATION (2026-08-16, GATE_2_PASS)
- **Fix 1 — `src/api/auth.ts`:** replaced broken `setSession(...)` (supabase-js 2.112.3 `SESSION_ATTACHED=false`) with `supabase.auth.getUser(token)` + direct PostgREST query using the verified Bearer token (`apikey: anon`, NO service_role). Enforces `owner.id === user.id && status='active'`; any error → null (fail-closed). Chain preserved.
- **Fix 2 — `src/api/server.ts:127`:** `send()` applied `JSON.stringify` twice (before+after `redact()`), delivering every JSON response as a string. Removed outer stringify.
- **Live runner corrections (4, minimal/deterministic/security-neutral):** (1) T4 command `transfer 100 in X` → `execute transfer 100 in X` (valid verb+resource); (2) T6 reads `{ lockdown: { status, lockdownId } }` and passes `lockdownId` to release; (3) T6 sends 2nd locked command (2 events for T7); (4) T8 `execute build in X` → `execute task in X` (valid resource). Residue check uses fresh `pg.Pool`.
- **PHASE 4 auth regression tests:** `src/api/auth.test.ts` 8/8 PASS (A–H: valid→resolved, invalid→DENY, empty→DENY, own-owner-only, id-mismatch→DENY, no service_role header, header isolation, inactive→DENY).
- **PHASE 5 live run:** 9/9 PASS · LIVE_EXECUTION_BOUNDARY = VERIFIED · TEST_RESIDUE users=0 owners=0
- **PHASE 7 regression:** vitest **181/181 (22 files)** · `RLS_TESTS.SQL_PASS` · `RLS_SECURITY_TESTS.SQL_PASS` (S1–S7) · `tsc --noEmit` PASS · `npm run build` BUILD_EXIT=0
- **PHASE 8 docs:** GATE_2_EVIDENCE.md (§1.10.5 matrix + §1.10.7), GATE_2_FINAL_REPORT.md (§25.5 + §26), GATE_2_FORENSIC_REVIEW.md (§17), todo.md — all updated to GATE_2_PASS. Historical failure preserved.

## Completed — FORENSIC REMEDIATION V1.0 (Missions 3, 6–9)
- **MISSION 3 — Guardian wired into live HTTP server:** new `src/api/security.ts` (createSecurityGuardian factory) + `server.ts:170` + `src/api/security.test.ts` (4 tests) + `guardian.ts` lockdown now async-capable (`await` in evaluate — fixes silent bypass of DB-backed lockdown). `tsc --noEmit` clean
- **MISSION 6 — Migration timestamp forensics = PASS:** 4 migrations VALID (logical-ordering stamps; FS times 16/08/2026 01:21–03:55; DB clock 03:44Z — no forgery, no env skew). GAP documented: schema_migrations tracks only migrations 1–2; 3–4 applied but untracked (raw SQL) → future `supabase db push` risk
- **MISSION 7 — Full regression = PASS:** `vitest run` **173/173 (21 files)** · RLS S1–S7 PASS · RLS_TESTS PASS · build confirms wiring (`dist/api/server.js:145`) · GUARDIAN_INTEGRATION=VERIFIED
- **MISSION 8 — Cleanup forensics = PASS:** secret scan clean (6 benign hits) · zero residue (auth.users/identities/owners=0, security+task tables=0) · all probe/runner temp files deleted
- **MISSION 9 — Architectural consistency = PASS:** BYPASS_STATUS=NONE_FOUND (single guarded CommandPipeline instantiation · single pipeline.run caller · approval handler never executes · ToolBroker not in API path)
- **LIVE_VERIFICATION = DONE** (key set 2026-08-16; see BLOCKER REMEDIATION section above for 9/9 result)
- **2026-08-16 LIVE RUN 1 = FAILED 0/9 → GATE_2_BLOCKED (historical):** all 9 HTTP cases 401. Root cause: `auth.ts:35` `setSession` not attaching session → verifyOwner=null. Now fixed in BLOCKER REMEDIATION (GATE_2_PASS). Residue=0 · no secrets exposed.

## Completed — GATE 2 FORENSIC REVIEW (MASTER FORENSIC AUDIT PROMPT V1.0)
- **G2-1 (CRITICAL, live-proven):** TRUNCATE bypassed RLS + FOR EACH ROW triggers → wiped security_events and critical_actions as `authenticated`. Fixed: `supabase/migrations/20260818000000_security_truncate_hardening.sql` (BEFORE TRUNCATE triggers on 7 tables + REVOKE TRUNCATE/TRIGGER from anon/authenticated). **APPLIED + LIVE_VERIFIED** (permission layer + trigger layer, all 7 tables)
- **G2-2:** rlsProbe merged two append-only probes into one EXISTS → split into independent queries (`src/db/repo.ts`)
- **S7** truncate-hardening tests added to `supabase/tests/rls_security_tests.sql` — **RLS_SECURITY_TESTS.SQL_PASS (S1–S7)**
- **3 pipeline–Guardian integration tests** added (`src/core/pipeline.test.ts`): lockdown fail-closed (denied + security.guardian_denied audit + cancelled), no false-positive, financial never downgraded below require_approval
- **Full re-verification:** tsc --noEmit PASS · build PASS · **169/169 (20 files)** · RLS_TESTS PASS · zero residue
- **Documented (Architect decisions, NOT fixed):** server.ts:169 no guardian in live HTTP pipeline (runtime enforcement = UNVERIFIED) · registry vs pipeline vocabulary mismatch · 4 unwired anomaly counters + failure-rate limits
- Docs: **GATE_2_FORENSIC_REVIEW.md** (new) · GATE_2_EVIDENCE.md updated (forensic §1.7/§1.8 + defects 6-7) · GATE_2_FINAL_REPORT.md rewritten (21 sections, PASS) · todo.md

## Completed — GATE 2 (SECURITY GUARDIAN)
- Core security modules (`src/core/security/*`): types, criticalActions (17 core rules), riskEngine, policyEngine (13 rules + precedence + combineAuthority), events, incidents, lockdown, rateLimit (7 scopes), costProtection, anomaly, promptInjection, secretGuard, health, guardian
- Store extension: ports.ts + repo.ts (listCriticalActions/recordSecurityEvent/listSecurityEvents/createIncident/patchIncident/listIncidents/activeLockdown/activateLockdown/releaseLockdown/rlsProbe) + memoryStore fixture
- Fail-closed optional hooks: toolBroker.securityGuard, runtimeGateway.environmentGuard/guardExecution, pipeline securityGuardian (deny→cancelled + security.guardian_denied audit; upgrade-only reconciliation)
- Migration `20260817000000_security_guardian.sql` APPLIED live (6 tables: critical_actions/security_events/security_incidents/security_lockdowns/security_rate_limits/security_policies; RLS on all; append-only + immutability triggers)
- Security API endpoints (static paths): GET/POST /api/security/health|events|incidents|critical-actions|lockdown|lockdown/release — LIVE_VERIFIED
- **Verification: `tsc --noEmit` PASS · build PASS · 41/41 security unit tests · full suite 166 passed (20 files) · RLS_SECURITY_TESTS PASS (S1–S6) · RLS_TESTS PASS (regression) · zero residue (LEAKED_TEST_USERS=[])**
- Fixes during verification: moreRestrictive assertion, JWT fixture, `info.` severity rule, closed→detected transition, snake→camel aliasing in repo.ts (live-discovered)
- Docs: 18 × GATE_2_*.md + GATE_2_EVIDENCE.md + GATE_2_FINAL_REPORT.md (AR) + updated ARCHITECTURE/DATABASE/SECURITY/AGENTS/RUNTIMES/MODELS

## Completed — GATE 1 (EXECUTIVE CORE)
- Executive Core implemented (TypeScript): Intent, Authority Matrix, Adaptive Autonomy, Approval, Task engine, POS, Decision Journal, Explanation, Monitoring, CommandPipeline
- Gateways implemented: ModelGateway (+ OpenAI/Anthropic/Google/OpenCodeZen adapters), RuntimeGateway (+ OpenCodeZen adapter), ToolBroker, SecretProvider, Memory Gateway
- Persistence: `src/db/repo.ts` (SupabaseStore) + ports in `src/core/ports.ts`; migration `20260816000000_core_additions.sql` applied
- Secret redaction `src/core/redact.ts` applied to commands/tasks/decisions/tool summaries
- Control Plane HTTP API (`src/api/server.ts`) — chat, projects, passports, agents, tasks, approvals, costs, audit, status, prefs, models, runtimes, decisions, me
- **Verification: typecheck PASS · build PASS · 105 unit + 8 live integration PASS · RLS_TESTS_PASS · zero residue**
- Docs: AGENTS.md · TASKS.md · MODELS.md · RUNTIMES.md · AUTONOMY.md · DECISION_JOURNAL.md · AUDIT.md · COSTS.md · ARCHITECTURE.md (updated) · CORE_IMPLEMENTATION_REPORT.md

## Completed — GATE 1 (DATABASE FOUNDATION)
- Migration `20260815220000_factory_init.sql` written (16 tables + functions + triggers + RLS) and **APPLIED live**
- Deterministic tests `supabase/tests/rls_tests.sql` + `run_tests.cjs` — **RLS_TESTS_PASS** (repeatable, self-cleaning)
- Live verification: 16 tables, RLS enabled on all 16, 61 policies
- Docs: DATABASE.md · SECURITY.md · FOUNDATION_REPORT.md

## Completed — Prior
- CLI installed (supabase v2.114.0) + authenticated via owner-provided PAT (User env var)
- Org **CHEF FACTORY** created: `hrvqbsttfoqxhlnibrxa`
- Project **CHEF FACTORY DB** created: `dybyidtcyzgliupzzfhl` (eu-west-1, ACTIVE_HEALTHY)
- PROOFOS paused (owner decision) to free free-tier slot
- `.env` (git-ignored) written: FACTORY_DB_PASSWORD, FACTORY_SUPABASE_URL, FACTORY_SUPABASE_ANON_KEY
- Connectivity VERIFIED read-only: Auth API 200, REST JWT accepted

## Explicitly NOT done (Gate 1 + Gate 2 non-goals)
- No deployment · No Growth Engine · No financial/legal execution · No real browser automation · No full multi-agent autonomy · No Gate 3 work

## Blocked
- (none)

## Record
- 2026-08-15: PROMPT 2A-OPEN-01 resolved → FACTORY_SUPABASE_ACTIVATED. No schema/RLS/tables created (out of scope). Read-only verification only.
- 2026-08-15: PROMPT 2/5 — GATE 1 DATABASE FOUNDATION COMPLETE. Migration applied, tests PASS, docs written, LIVE_VERIFIED.
- 2026-08-16: PROMPT 3/5 — GATE 1 CORE COMPLETE. 116 tests pass, RLS tests pass, typecheck/build clean, live integration verified, zero residue, no deployment.
- 2026-08-16: PROMPT 4/5 — GATE 2 SECURITY GUARDIAN COMPLETE. 166 tests pass (20 files), security RLS tests pass, typecheck/build clean, live integration verified, zero residue, no deployment.
- 2026-08-16: PROMPT 4/5 — GATE 2 FORENSIC REVIEW DONE. 169 tests pass (20 files), G2-1 TRUNCATE hardening + G2-2 rlsProbe fixed & live-verified, 3 pipeline–Guardian integration tests, zero residue.
- 2026-08-16: FORENSIC REMEDIATION V1.0 CLOSED (Missions 3, 6–9). Guardian wired into server.ts:170, 173/173 tests (21 files), migration forensics VALID (tracking gap 3–4 documented), secret scan clean, zero residue, BYPASS_STATUS=NONE_FOUND. LIVE_VERIFICATION = BLOCKED — FACTORY_SERVICE_ROLE_KEY_MISSING. STOP — awaiting FORENSIC ARCHITECT REVIEW.
- 2026-08-16: ARCHITECT REVIEW DONE → **GATE_2_NOT_READY**. Matrix (GATE_2_EVIDENCE.md §1.10.5): 18 capabilities LIVE_VERIFIED/TESTED, live HTTP traversal BLOCKED. Runner `scripts/live-http-verification.ts` prepared (not executed). Migration gap = B (repair proposed via `supabase migration repair --status applied`). Vocabulary: critical-registry/actionType mismatch (HIGH, defense-in-depth). Anomaly: 5 wired / 5 DEFINED_ONLY / 5 rate scopes WIRED_BUT_NOT_ENFORCED.
- 2026-08-17: GATE 3 LIVE VERIFICATION COMPLETE. OpenAI API key configured. Authentication LIVE_VERIFIED (200 OK, 124 models). Tool schema transmission LIVE_VERIFIED (gpt-4o-mini function calling). Tool call returned LIVE_VERIFIED (list_projects via function calling). Conversation continuity LIVE_VERIFIED (model recalled context). 222/222 tests PASS. 17/17 SQL/RLS PASS. TYPECHECK PASS. BUILD PASS. Classification: **GATE_3_PASS**.
