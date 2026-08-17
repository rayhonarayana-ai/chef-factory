# GATE 13 — EVIDENCE CONTRACT

**Date:** 2026-08-17
**Baseline:** 577/577 PASS (frozen Gate 12)
**Mission:** API Boundary Hardening

---

## 1. Required Evidence Items

### 1.1 Body Size Limit

| # | Evidence | Type | Verification |
|---|---------|------|-------------|
| E1-1 | 1MB body accepted | Unit test | POST with 999KB body → 200 |
| E1-2 | 1MB+ body rejected | Unit test | POST with 1.1MB body → 413 |
| E1-3 | Empty body accepted | Unit test | POST with empty body → 200 |
| E1-4 | Malformed body rejected | Unit test | POST with invalid JSON → 400 |

### 1.2 Error Sanitization

| # | Evidence | Type | Verification |
|---|---------|------|-------------|
| E2-1 | Client receives generic message | Unit test | Internal error → "Internal server error" |
| E2-2 | Server log has full detail | Code review | console.error called with full error |
| E2-3 | No stack trace in response | Unit test | Response body has no stack trace |
| E2-4 | No file paths in response | Unit test | Response body has no file paths |

### 1.3 Content-Type Validation

| # | Evidence | Type | Verification |
|---|---------|------|-------------|
| E3-1 | application/json accepted | Unit test | POST with Content-Type: application/json → 200 |
| E3-2 | Missing Content-Type rejected | Unit test | POST without Content-Type → 415 |
| E3-3 | text/plain rejected | Unit test | POST with Content-Type: text/plain → 415 |

### 1.4 Request Timeout

| # | Evidence | Type | Verification |
|---|---------|------|-------------|
| E4-1 | Fast request completes | Unit test | Request completes in <1s |
| E4-2 | Slow request times out | Unit test | Request takes >30s → 408 |

### 1.5 Regression

| # | Evidence | Type | Verification |
|---|---------|------|-------------|
| E5-1 | 577/577 tests pass | Test run | Full regression |
| E5-2 | tsc --noEmit clean | Type check | Zero errors |
| E5-3 | No DB changes | Code review | Zero migration files |
| E5-4 | No secret leakage | Code review | No String(e) in responses |

---

## 2. Evidence Collection Method

- All unit tests in `gate13.boundary.test.ts`
- No live integration tests (API boundary is testable in isolation)
- No DB tests (no schema changes)
- No provider tests (no provider changes)

---

## 3. Classification

**GATE_13_EVIDENCE_CONTRACT_DEFINED**

14 evidence items across 5 categories. All verifiable via unit tests.
