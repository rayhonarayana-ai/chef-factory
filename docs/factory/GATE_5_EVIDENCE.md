# GATE 5 — EVIDENCE

> Date: 2026-08-17
> Classification: GATE_5_PASS

## E1: Double Execution Fix (G5-01)
- `src/gateways/toolBroker.ts:20-21` — `execute?: boolean` in `ToolBrokerContext`
- `src/gateways/toolBroker.ts:72-75` — Early return when `execute === false`
- `src/core/security/gate5.test.ts` — Two tests prove handler called once vs. not at all

## E2: Text-Only Security (G5-02)
- `src/api/execution.ts` — Rate limit check before `adapter.complete()` in text-only path
- Existing execution tests pass

## E3: Cost Protection (G5-03)
- `src/core/security/costProtection.ts:24-30` — `PRODUCTION_COST_PROTECTION` config
  - `projectDailyHardLimit: 5`
  - `ownerMonthlyHardLimit: 100`
- `src/core/ports.ts` — `BudgetReport.daily: number`
- `src/db/repo.ts` — Returns `daily` in `projectBudget()`
- `src/testing/memoryStore.ts` — Returns `daily: 0`
- `src/api/security.ts` — Imports production config
- `src/core/security/gate5.test.ts` — Config value assertions

## E4: Prompt Injection Deny (G5-04)
- `src/core/security/policyEngine.ts:118-128` — Rule 7: untrusted authority directive → deny
- `src/core/security/securityGuardian.test.ts:280-291` — T15 updated to expect deny
- `src/core/security/gate5.test.ts` — Two tests prove deny/no-deny behavior

## E5: Anomaly Decay (G5-05)
- `src/core/security/anomaly.ts:47-57` — `decayWindowMs` (default 3,600,000ms = 1hr)
- `src/core/security/anomaly.ts:91-100` — `applyDecay()` resets counter after window
- `src/core/security/gate5.test.ts` — Two tests with fake timers prove decay

## E6: Vocabulary Aliases (G5-06)
- `src/core/security/criticalActions.ts:55-61` — `ACTION_TYPE_ALIASES` map (5 entries)
- `src/core/security/criticalActions.ts:75-86` — Alias lookup in `classifyCriticalAction()`
- `src/core/security/gate5.test.ts` — 7 tests prove each alias + direct match

## E7: Full Regression
- 29 test files, 257 tests, 0 failures
- Command: `npx vitest run`
- All live integration tests pass against real Supabase (ref: dybyidtcyzgliupzzfhl)

## E8: No Regressions in Existing Tests
- Gate 3 baseline (222 tests): UNCHANGED
- Gate 4 tests (16 tests): UNCHANGED
- Security Guardian (41 tests): T15 updated to reflect correct deny behavior
- All other test files: UNCHANGED
