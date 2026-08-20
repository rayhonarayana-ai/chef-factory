# GATE 17 — FORENSIC REVIEW

> Date: 2026-08-19
> Scope: Post-Gate-16 full codebase audit

## Methodology

Three parallel forensic agents conducted independent deep audits:
1. **Architecture & Core Audit** — 66 source files, dependency graph, test coverage
2. **Security & Persistence Audit** — hidden failure modes, race conditions, data consistency
3. **Product Intelligence & Gaps** — documentation vs implementation, evidence gaps

## Architecture Audit Summary

### Strengths
- **Deterministic core:** All domain logic (intent, authority, autonomy, approval, taskEngine) is pure functions with no I/O
- **Fail-closed security:** Guardian is upstream of everything; lockdown denies all; DENY always wins
- **Defense in depth:** authority → autonomy → guardian → toolBroker (4 independent layers)
- **No fabricated certainty:** Unknown returns `unknown`; missing info flagged; "Done." rejected
- **Clean port/adapter:** Store interface cleanly separates domain from persistence
- **Zero circular dependencies**

### Concerns
- `db/repo.ts` (800 lines) has NO unit tests — largest untested module
- `api/handlers.ts` (384 lines) has NO unit tests
- Provider adapters (openai/anthropic/google) only test `configured()`/`supportsTools()`, not `complete()`
- Integration tests require live Supabase — may not run in CI

## Security Audit Summary

### CRITICAL
1. **CRIT-1:** `.env` contains plaintext secrets (DB password, OpenAI key, owner password)
2. **CRIT-2:** `ssl: { rejectUnauthorized: false }` in pool.ts — MITM vulnerability

### HIGH
3. **HIGH-1:** Security events recorded via `void` (fire-and-forget) — lost on DB failure
4. **HIGH-2:** Rate limit/anomaly save via `void` (fire-and-forget) — state lost on DB failure
5. **HIGH-4:** Rate limiter TOCTOU — load/check/save not atomic under concurrency
6. **HIGH-6:** `auth.verifyOwner()` swallows ALL exceptions — returns null for network errors
7. **HIGH-8:** Gate 5 test uses stale type definitions

### MEDIUM
8. Empty catch blocks silently swallowing errors (25 instances)
9. `console.log`/`console.error` instead of structured logging
10. Owners bypass environment isolation and cross-project isolation
11. N+1 query pattern in anomaly state save
12. DB connection pool max=5 (small)
13. Rate limit persistence failure logged only once then silent
14. Anomaly detector shared singleton (not owner-scoped in memory)
15. In-memory rate limit state grows unboundedly (memory leak)
16. Task creation has no idempotency key
17. Module-level mutable state in query-data.ts

### Observations (Positive)
- No `eval()` or `Function()` usage
- No hardcoded secrets in source code
- No SQL injection vulnerabilities (all parameterized)
- Path traversal defense is correct
- Comprehensive redaction system (4 layers)
- TRUNCATE hardening is thorough

## Persistence Audit Summary

- 27 tables with RLS enabled
- Append-only triggers on audit_events, security_events, conversation_messages
- Immutable critical_actions registry (UPDATE/DELETE blocked by trigger)
- Lockdown history cannot be deleted
- TRUNCATE protection via statement-level triggers + REVOKE

### Issues
- `security_events` RLS lacks update/delete policy (by design — append-only)
- Anomaly state save is N+1 query pattern
- `setPreference()` transaction may have race condition without FOR UPDATE

## Product Intelligence Summary

- **ALL intelligence is deterministic rules + hardcoded thresholds** — no AI/ML
- Intent classification: regex + keyword dictionary (not AI)
- Anomaly detection: counters with time-based decay (not ML)
- Model selection: cost-based sorting (not ML)
- Prompt injection: 12 hardcoded regex patterns (English-only, bypassable)
- Memory gateway: stub (`configured: false`, `recall()` returns `[]`)

## Documentation Drift

- ARCHITECTURE.md says "166 tests, 20 files" — actual: 699 tests, 45 files
- ARCHITECTURE.md says "17 immutable rules" — actual: 26 rules
- ARCHITECTURE.md says "3 migrations" — actual: 6+ migrations
- DATABASE.md says "22 tables" — actual: 27 tables
- SECURITY.md says "61 policies" — actual: 80+ policies
- todo.md stopped at Gate 3 — actual: Gate 16 closed

## Evidence Classification

| Capability | Classification |
|------------|---------------|
| Pipeline | TEST_VERIFIED (18 unit + 62 integration) |
| Security Guardian | TEST_VERIFIED (41 unit tests) |
| Rate Limiting | TEST_VERIFIED (25 persistence + guardian tests) |
| Anomaly Detection | TEST_VERIFIED (25 persistence + guardian tests) |
| Query Engine | TEST_VERIFIED (56 unit tests) |
| Provider Resilience | RUNTIME_VERIFIED (31 unit + live tests) |
| SSE Streaming | TEST_VERIFIED (37 + 26 tests) |
| API Boundary | TEST_VERIFIED (22 boundary tests) |
| db/repo.ts | INTEGRATION_VERIFIED only (no unit tests) |
| api/handlers.ts | CODE_ONLY (no direct tests) |
| Conversation | CODE_ONLY (no tests) |
| Memory Gateway | CODE_ONLY (stub) |
| Provider Adapters | CODE_ONLY (only configured() tested) |

## Key Finding

The Gate 16 persistence fix (wiring PersistentRateLimiter/PersistentAnomalyDetector into Guardian) is VERIFIED. However, the persistence is fire-and-forget (`void` expressions), meaning:
- If DB write fails, the event is silently lost
- Rate limit counters can reset to zero on restart
- Anomaly counters can reset on restart
- Audit trail gaps during DB outages

This is the next bottleneck: **completing the persistence reliability story**.
