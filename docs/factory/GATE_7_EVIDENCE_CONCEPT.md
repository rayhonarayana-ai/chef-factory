# Gate 7 — Evidence Concept

> Date: 2026-08-17
> Mode: DISCOVERY_ONLY
> Defines evidence requirements for Gate 7 implementation (regardless of candidate)

---

## Evidence Categories

### 1. Byte Limit Evidence

| Evidence | Type | Required |
|----------|------|----------|
| Unit test: single row exceeds50KB → truncated | Unit | YES |
| Unit test: 100 rows under50KB → not truncated | Unit | YES |
| Unit test: UTF-8 multi-byte handled correctly | Unit | YES |
| Unit test: JSONB field counted in bytes | Unit | YES |
| Live test: real Supabase, large text field → truncated | Live | YES |
| Source evidence: `QUERY_MAX_BYTES` referenced in `executeQuery()` | Source | YES |

### 2. Timeout Evidence

| Evidence | Type | Required |
|----------|------|----------|
| Unit test: mock slow query → timeout error | Unit | YES |
| Unit test: fast query → no timeout | Unit | YES |
| Live test: real Supabase, statement_timeout fires | Live | YES |
| Source evidence: `SET LOCAL statement_timeout` in query execution | Source | YES |
| Source evidence: timeout error returns `success: false` | Source | YES |

### 3. Rate Limit Evidence

| Evidence | Type | Required |
|----------|------|----------|
| Unit test: data_query limit registered | Unit | YES |
| Unit test: data_query_agg limit registered | Unit | YES |
| Unit test: exceeding data_query limit → denied | Unit | YES |
| Unit test: exceeding data_query_agg limit → denied | Unit | YES |
| Live test: real rate limiter, exceeding limit → denied | Live | YES |
| Source evidence: limits in `DEFAULT_RATE_LIMITS` array | Source | YES |

### 4. Enumeration Protection Evidence

| Evidence | Type | Required |
|----------|------|----------|
| Unit test: per-entity counter increments | Unit | YES |
| Unit test: exceeding entity limit → denied | Unit | YES |
| Unit test: different entities have separate counters | Unit | YES |
| Source evidence: entity counter in handler or engine | Source | YES |

### 5. Concurrency Protection Evidence

| Evidence | Type | Required |
|----------|------|----------|
| Unit test: concurrent limit enforced | Unit | YES |
| Unit test: release on completion | Unit | YES |
| Source evidence: semaphore or similar in handler | Source | YES |

### 6. Error Sanitization Evidence

| Evidence | Type | Required |
|----------|------|----------|
| Unit test: validation error does not expose field names | Unit | YES |
| Unit test: error message is generic | Unit | YES |
| Source evidence: error messages sanitized in handler | Source | YES |

---

## Gate 7 Pass Criteria

| Criterion | Required |
|-----------|----------|
| All Gate 6 tests still pass (343/343) | YES |
| New Gate 7 tests all pass | YES |
| tsc --noEmit clean | YES |
| No database schema changes | YES |
| No production source regressions | YES |
| All 7 findings addressed (F1-F7) | YES |
| Live verification against real Supabase | YES |
| Forensic closure completed | YES |

---

## Classification Criteria

| Classification | Condition |
|----------------|-----------|
| GATE_7_PASS_FROZEN | All criteria met, all findings resolved |
| GATE_7_PASS_WITH_DRIFT | All criteria met, documentation drift |
| GATE_7_NOT_READY | One or more criteria not met |

---

## Evidence File Structure

```
src/tools/query-engine.ts       — byte limit + timeout enforcement
src/tools/query-types.ts        — rate limit defaults
src/core/security/rateLimit.ts  — new scope registration
src/tools/query.test.ts         — unit tests
src/integration/gate7.live.integration.test.ts — live tests
docs/factory/GATE_7_FORENSIC_CLOSURE.md — closure audit
docs/factory/GATE_7_FINAL_REPORT.md — delivery summary
```
