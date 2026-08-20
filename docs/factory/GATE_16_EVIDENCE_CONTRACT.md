# GATE 16 — EVIDENCE CONTRACT

> Classification: GATE_16_EVIDENCE_CONTRACT
> Date: 2026-08-19
> Mission: Persistent Security State Fix

## 1. Evidence Items (12)

### E16-01: Pipeline Constructor Wiring

**Claim:** `server.ts:209` passes `rateLimiter` and `anomalyDetector` to `CommandPipeline`.

**Verification:** Source inspection. Check constructor call includes all 5 params.

**Type:** Source diff

### E16-02: PersistentRateLimiter Async Check

**Claim:** `PersistentRateLimiter.check()` internally loads from DB before returning.

**Verification:** Unit test: mock DB, verify `loadState()` called, verify result reflects DB state.

**Type:** Unit test

### E16-03: PersistentAnomalyDetector Async Note

**Claim:** `PersistentAnomalyDetector.note()` internally loads/saves from DB.

**Verification:** Unit test: mock DB, verify `loadState()` called, verify counter reflects DB state.

**Type:** Unit test

### E16-04: Production Path Persistence

**Claim:** The production code path (guardian → rateLimiter/anomalyDetector) exercises DB persistence.

**Verification:** Integration test: verify rate limit counters persist across pipeline.run() calls.

**Type:** Integration test

### E16-05: Fail-Closed on DB Failure

**Claim:** If persistence DB is unavailable, rate limiting and anomaly detection continue in-memory.

**Verification:** Unit test: mock DB to throw, verify in-memory fallback activates.

**Type:** Unit test

### E16-06: Gate 14 Tests Unchanged

**Claim:** All 25 Gate 14 persistence tests still pass without modification.

**Verification:** Run `vitest run gate14.persistence.test.ts`.

**Type:** Regression test

### E16-07: Full Regression

**Claim:** 687/687 tests pass, 7 skipped, zero regressions.

**Verification:** Run `vitest run`.

**Type:** Regression test

### E16-08: Typecheck Clean

**Claim:** `tsc --noEmit` produces zero errors.

**Verification:** Run `tsc --noEmit`.

**Type:** Build verification

### E16-09: Build Clean

**Claim:** `tsc -p tsconfig.build.json` produces zero errors.

**Verification:** Run build.

**Type:** Build verification

### E16-10: Security Invariants

**Claim:** All 16 security invariants preserved.

**Verification:** Manual inspection + test evidence.

**Type:** Security audit

### E16-11: No DB Changes

**Claim:** Zero database schema changes.

**Verification:** No new migration files. No ALTER TABLE statements.

**Type:** Source diff

### E16-12: Rate Limit Persistence End-to-End

**Claim:** A rate limit hit persists across server restarts (simulated by destroying/recreating the limiter).

**Verification:** Unit test: hit rate limit, destroy limiter, create new one with same DB, verify limit still active.

**Type:** Unit test

## 2. Evidence Collection Protocol

1. Run `npx vitest run` — capture full output
2. Run `nsc --noEmit` — capture output
3. Run `npx tsc -p tsconfig.build.json` — capture output
4. Capture source diff (git diff if available, or file comparison)
5. Run Gate 14 persistence tests specifically
6. Run new Gate 16 tests specifically
7. Security invariants inspection (manual)
8. Write GATE_16_EVIDENCE.md with all results

## 3. Pass Criteria

| Item | Requirement |
|------|-------------|
| E16-01 | Source shows 5-param constructor call |
| E16-02 | Test passes: loadState called, DB result used |
| E16-03 | Test passes: loadState called, DB result used |
| E16-04 | Test passes: production path exercises persistence |
| E16-05 | Test passes: in-memory fallback on DB failure |
| E16-06 | 25/25 Gate 14 tests pass |
| E16-07 | 687+ tests pass, 0 regressions |
| E16-08 | tsc clean |
| E16-09 | Build clean |
| E16-10 | 16/16 invariants preserved |
| E16-11 | 0 DB changes |
| E16-12 | Test passes: limit persists across limiter recreation |
