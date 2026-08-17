# GATE 14 — EVIDENCE CONTRACT

**Date:** 2026-08-17
**Baseline:** 599/599 PASS (frozen Gate 13)
**Mission:** Persistent Rate/Anomaly State

---

## 1. Unit Evidence

| # | Evidence | Type | PASS Condition |
|---|---------|------|----------------|
| U1 | Single RateLimiter instance shared | Test | `guardian.rateLimiter === execution.rateLimiter` |
| U2 | Single AnomalyDetector instance shared | Test | `guardian.anomalyDetector === execution.anomalyDetector` |
| U3 | Pipeline receives shared instances | Test | `pipeline.rateLimiter !== undefined` |
| U4 | Rate limit persists across calls | Test | Write counter → read counter → verify count |
| U5 | Anomaly counter persists across calls | Test | Write counter → read counter → verify count |
| U6 | Rate limit TTL expires | Test | Write counter → advance time → read → verify expired |
| U7 | Anomaly counter TTL expires | Test | Write counter → advance time → read → verify expired |
| U8 | DB failure falls back to in-memory | Test | Mock DB error → verify rate limit still works |
| U9 | Owner-scoped isolation | Test | Owner A's limits don't affect Owner B |

## 2. Integration Evidence

| # | Evidence | Type | PASS Condition |
|---|---------|------|----------------|
| I1 | Guardian uses shared rate limiter | Integration | Guardian rate limit hit → execution rate limit also hit |
| I2 | Guardian uses shared anomaly detector | Integration | Guardian anomaly triggered → execution sees it |
| I3 | Pipeline uses shared instances | Integration | Pipeline rate limit check → same counter as execution |

## 3. Live Evidence

| # | Evidence | Type | PASS Condition |
|---|---------|------|----------------|
| L1 | DB tables created | Migration | `rate_limit_state` and `anomaly_state` tables exist |
| L2 | RLS enforced on new tables | Migration | Owner can only see own rows |
| L3 | Write/read cycle works | Live test | Insert → query → verify |

## 4. Security Evidence

| # | Evidence | Type | PASS Condition |
|---|---------|------|----------------|
| SE1 | Guardian preserved | Test | All 41 securityGuardian.test.ts tests pass |
| SE2 | Authority preserved | Test | All 12 authority.test.ts tests pass |
| SE3 | ToolBroker preserved | Test | All 6 toolBroker.test.ts tests pass |
| SE4 | Rate limiting enforced | Test | Rate limit tests pass with unified instance |
| SE5 | Anomaly detection enforced | Test | Anomaly tests pass with unified instance |
| SE6 | No secret leakage | Test | Error responses contain no internal details |

## 5. Forensic Evidence

| # | Evidence | Type | PASS Condition |
|---|---------|------|----------------|
| F1 | 599+ tests pass | Regression | Full test suite green |
| F2 | tsc --noEmit clean | Type check | Zero errors |
| F3 | No DB schema regressions | Migration | Existing tables unchanged |
| F4 | No bypass paths | Code review | Single instance verified in wiring |

---

## 2. Classification

**GATE_14_EVIDENCE_CONTRACT_DEFINED**

18 evidence items across 5 categories. All verifiable via unit/integration tests + live verification.
