# Gate 5 — Evidence Concept

> **Date:** 2026-08-17
> **Status:** GATE_5_DISCOVERY_COMPLETE

---

## Mandatory Evidence Items

| ID | Capability | Test Method | Expected Result | Classification |
|----|-----------|------------|----------------|---------------|
| E1 | Single execution guarantee | Unit test: mock handler invocation count | count === 1 per tool call | UNIT_TESTED |
| E2 | Single execution guarantee | Live integration: create_project | SELECT count(*) FROM projects WHERE name = X returns 1 | LIVE_VERIFIED |
| E3 | Text-only path security | Unit test: text-only fallback with authority deny | Execution blocked or guarded | UNIT_TESTED |
| E4 | Cost protection active | Unit test: CostProtector with daily limit set | stopped = true when exceeded | UNIT_TESTED |
| E5 | Cost protection live | Live integration: CostProtector with real store | Correct stop/allow based on actual costs | LIVE_VERIFIED |
| E6 | Prompt injection deny | Unit test: untrustedAuthorityDirective present | policyEngine returns deny | UNIT_TESTED |
| E7 | Anomaly decay | Unit test: counter after time window | counter resets to 0 | UNIT_TESTED |
| E8 | Vocabulary alias | Unit test: 'financial' maps to critical action | classifyCriticalAction returns match | UNIT_TESTED |
| E9 | Baseline regression | Run all 243 existing tests | 243/243 PASS | UNIT_TESTED |
| E10 | CostProtector unit | Unit test: CostProtector.check() with mock store | Correct decisions for various limit scenarios | UNIT_TESTED |

---

## Evidence Classification Definitions

| Classification | Meaning |
|---------------|---------|
| UNIT_TESTED | Verified by unit test with mocked dependencies |
| SQL_VERIFIED | Verified by direct SQL query against database |
| INTEGRATION_TESTED | Verified by integration test with real components |
| LIVE_VERIFIED | Verified against live Supabase Postgres with real data |

---

## Gate 5 Pass Criteria

Gate 5 SHALL NOT be classified PASS unless:

1. All 10 evidence items exist and PASS
2. All 243 baseline tests continue to pass
3. No new CRITICAL or HIGH findings introduced
4. TYPECHECK = PASS
5. Double execution bug is fixed (E1, E2)
6. Cost protection is enabled (E4, E5)
7. Prompt injection deny rule exists (E6)

---

## Evidence Collection Plan

### Phase 1: Fix + Unit Test (E1, E3, E4, E6, E7, E8, E10)
- Fix double execution in execution.ts
- Wire security into text-only fallback
- Enable cost protection limits
- Add prompt injection deny rule
- Add anomaly decay
- Add vocabulary alias map
- Write CostProtector unit tests
- Run all unit tests

### Phase 2: Live Integration (E2, E5)
- Create project → verify exactly 1 record
- CostProtector check against real store → verify correct result

### Phase 3: Regression (E9)
- Run full test suite
- Verify 243/243 pass
- Typecheck clean
