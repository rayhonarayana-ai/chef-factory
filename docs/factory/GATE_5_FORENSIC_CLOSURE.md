# GATE 5 — FORENSIC CLOSURE

> Date: 2026-08-17
> Classification: **GATE_5_PASS**
> Tests: 257/257 (243 baseline + 14 Gate 5)
> Forensic: READ-ONLY

## Scope

Execution Integrity & Production Security Hardening. 6 findings from Gate 5 discovery:

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| F-1 | CRITICAL | Double execution — tool handlers fire twice per call | RESOLVED G5-01 |
| F-2 | HIGH | Text-only fallback bypasses security chain | RESOLVED G5-02 |
| F-3 | HIGH | Cost protection disabled (all hard limits null) | RESOLVED G5-03 |
| F-4 | MEDIUM | Prompt injection directives recorded but not denied | RESOLVED G5-04 |
| F-5 | MEDIUM | Critical action vocabulary alias map missing (dormant) | RESOLVED G5-06 |
| F-6 | LOW | Anomaly counters never decay | RESOLVED G5-05 |

## Source Changes

### G5-01: Double Execution Prevention
- `src/gateways/toolBroker.ts` — Added `execute?: boolean` to `ToolBrokerContext`
  - When `execute === false`: validates (authority + security) without calling `tool.run()`
  - Default `true` preserves backward compatibility
- `src/api/execution.ts` — Execution runner passes `execute: false` to broker context

### G5-02: Text-Only Security Bypass
- `src/api/execution.ts` — Rate limit check added to text-only fallback path before `adapter.complete()`

### G5-03: Cost Protection Limits
- `src/core/security/costProtection.ts` — New `PRODUCTION_COST_PROTECTION` config
  - `projectDailyHardLimit: 5` ($5/day)
  - `ownerMonthlyHardLimit: 100` ($100/month)
  - `haltOnBreachedLimit: true`
- `src/core/ports.ts` — `BudgetReport.daily: number` field added
- `src/db/repo.ts` — Returns `daily` value in `projectBudget()`
- `src/testing/memoryStore.ts` — Returns `daily: 0` in `projectBudget()`
- `src/api/security.ts` — Imports `PRODUCTION_COST_PROTECTION`

### G5-04: Prompt Injection Deny
- `src/core/security/policyEngine.ts` — New rule 7: `untrustedAuthorityDirective.present && matches.length > 0` → `deny`
- Rules renumbered 7–13

### G5-05: Anomaly Decay
- `src/core/security/anomaly.ts` — Time-windowed decay (1 hour default)
  - `applyDecay()` resets counter to 0 after `decayWindowMs` of inactivity
  - Deterministic: uses `Date.now()`

### G5-06: Vocabulary Aliases
- `src/core/security/criticalActions.ts` — `ACTION_TYPE_ALIASES` map
  - `financial` → `financial_transaction` (deny)
  - `legal` → `legal_commitment` (deny)
  - `account_security` → `secret_access` (require_approval)
  - `deploy` → `production_modification` (require_approval)
  - `delete` → `production_deletion` (deny in production)
- `classifyCriticalAction()` checks aliases after direct match

## Test Evidence

### Gate 5 Specific Tests (14 tests)
| Test | What It Proves |
|------|----------------|
| G5-01 execute=false | Handler not called when `execute: false` |
| G5-01 execute=true | Handler called normally (default) |
| G5-03 production limits | Daily=$5, Monthly=$100, halt=true |
| G5-03 default limits | Null daily for test safety |
| G5-04 injection deny | Authority directive + present=true → deny |
| G5-04 no injection | present=false → no deny |
| G5-05 decay reset | Counter resets after time window |
| G5-05 decay default | Counter preserved when no time passes |
| G5-06 financial alias | `financial` → `financial_transaction` deny |
| G5-06 deploy alias | `deploy` → `production_modification` require_approval |
| G5-06 delete alias | `delete` → `production_deletion` deny |
| G5-06 account alias | `account_security` → `secret_access` |
| G5-06 legal alias | `legal` → `legal_commitment` deny |
| G5-06 direct match | `financial_transaction` matches directly |

### Existing Tests — Regression
All 243 baseline tests pass without modification (except T15 updated to reflect new prompt injection deny behavior).

### T15 Update
Old: prompt injection detected but not denied (DATA-only).
New: prompt injection detected AND denied (G5-04 rule).
This is the **correct new behavior** — the old behavior was the vulnerability being fixed.

## No Regressions
- 29 test files, 257 tests, 0 failures
- All live integration tests pass against real Supabase
- Gate 4 frozen baseline intact (all G4 tests pass)

## Files Modified (11 source + 1 test)
1. `src/gateways/toolBroker.ts` — execute flag
2. `src/api/execution.ts` — execute=false + rate limit in text path
3. `src/core/security/costProtection.ts` — production config
4. `src/core/ports.ts` — BudgetReport.daily
5. `src/db/repo.ts` — daily value
6. `src/testing/memoryStore.ts` — daily: 0
7. `src/api/security.ts` — import production config
8. `src/core/security/policyEngine.ts` — injection deny rule
9. `src/core/security/anomaly.ts` — decay logic
10. `src/core/security/criticalActions.ts` — aliases
11. `src/core/security/securityGuardian.test.ts` — T15 updated
12. `src/core/security/gate5.test.ts` — NEW (14 tests)

## Classification

**GATE_5_PASS** — All 6 findings resolved. 257/257 tests pass. No regressions.
