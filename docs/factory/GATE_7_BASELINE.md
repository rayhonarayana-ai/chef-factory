# Gate 7 — Baseline

> Date: 2026-08-17
> Status: **FROZEN** (370/370)
> Predecessor baseline: GATE_6_PASS_FROZEN (343/343)

---

## Test Baseline

| Metric | Gate 6 | Gate 7 | Delta |
|--------|--------|--------|-------|
| Total tests | 343 | 370 | +27 |
| Unit tests (query.test.ts) | 38 | 56 | +18 |
| Live tests (gate6.live.integration.test.ts) | 47 | 56 | +9 |
| Other unit tests | 258 | 258 | 0 |
| Test files | 29 | 31 | +0 (tests added to existing files) |

## Gate 7 New Tests

### Unit Tests (query.test.ts) — 18 new

| ID | Test | Verifies |
|----|------|----------|
| G7-01a | enforces 50KB byte limit on row payload | byte truncation in executeQuery() |
| G7-01b | truncates rows from the end when byte limit exceeded | row removal order |
| G7-01c | returns partial rows when truncation occurs | partial result flagging |
| G7-01d | does NOT truncate when payload is under the limit | no false truncation |
| G7-02a | detects statement_timeout errors and returns timedOut flag | timeout detection |
| G7-02b | returns generic timeout error message | no field name leakage on timeout |
| G7-02c | statement_timeout is set to 5 seconds | constant value correct |
| G7-03a | data_query scope exists in DEFAULT_RATE_LIMITS | rate limit registration |
| G7-03b | data_query_agg scope exists in DEFAULT_RATE_LIMITS | aggregation rate limit |
| G7-03c | data_query_agg has stricter limit than data_query | 50 < 200 |
| G7-04a | per-entity counter tracks requests | enumeration counter |
| G7-04b | counter resets after TTL window | TTL expiry |
| G7-05a | blocks concurrent queries exceeding max | semaphore enforcement |
| G7-06a | sanitizes database error messages | no field names in DB errors |
| G7-06b | sanitizes validation error messages | no field names in validation errors |
| baseline | compileQuery produces valid SQL | Gate 6 baseline preserved |
| baseline | validateQueryPlan accepts valid plans | Gate 6 baseline preserved |
| baseline | QUERY_DATA_TOOL has correct structure | Gate 6 baseline preserved |

### Live Tests (gate6.live.integration.test.ts) — 9 new

| ID | Test | Verifies |
|----|------|----------|
| G7-L1 | result includes byteSize metadata | byteSize in envelope |
| G7-L2 | byteSize matches actual serialized row size | byteSize accuracy |
| G7-L3 | data_query rate limit exists and is configured | 200/hr limit |
| G7-L4 | data_query_agg rate limit exists and is configured | 50/hr limit |
| G7-L5 | validation error does not leak field names to LLM | error sanitization |
| G7-L6 | invalid entity error does not leak entity names | entity error sanitization |
| G7-L7 | basic query still works against live Supabase | baseline preservation |
| G7-L8 | aggregation still works against live Supabase | baseline preservation |
| G7-L9 | owner isolation still enforced against live Supabase | baseline preservation |

---

## Source File Baseline

### Modified Files (6)

| File | Lines | Gate 7 Changes |
|------|-------|----------------|
| `src/tools/query-types.ts` | 105 | `byteSize`, `timedOut` in `QueryResultMetadata`; `QUERY_MAX_BYTES=50_000`, `QUERY_TIMEOUT_MS=5_000`, `QUERY_MAX_ENTROPY_PER_ENTITY=50`, `QUERY_MAX_CONCURRENT=3`, `QUERY_ENTROPY_WINDOW_MS=3_600_000` constants |
| `src/tools/query-engine.ts` | 456 | `SET LOCAL statement_timeout`; `Buffer.byteLength` byte check; row-level truncation; timeout error detection |
| `src/tools/query-data.ts` | 193 | `entropyCounters` Map; `acquireSemaphore`/`releaseSemaphore`; error sanitization strings; `checkEntityEntropy()` |
| `src/core/security/rateLimit.ts` | 125 | `data_query.count=200`, `data_query_agg.count=50` in `DEFAULT_RATE_LIMITS` |
| `src/core/security/types.ts` | 36 | `data_query` added to `SECURITY_SCOPE_KEYS` |
| `src/core/security/guardian.ts` | 218 | `data_query: 'data_query.count'` in `limitKeyFor()` map |

### Test Files Modified (2)

| File | Gate 7 Additions |
|------|------------------|
| `src/tools/query.test.ts` | 18 new tests in `describe('Gate 7 — Combined Production Query Hardening')` |
| `src/integration/gate6.live.integration.test.ts` | 9 new tests in `describe('Gate 7 — Live Hardening Verification')` |

### Files NOT Modified

All other source and test files remain unchanged from Gate 6 baseline.

---

## Security Baseline

| Control | Gate 6 Status | Gate 7 Status | Evidence |
|---------|---------------|---------------|----------|
| Byte limit (50KB) | Defined, not enforced | **ENFORCED** | `executeQuery()` row-level truncation |
| Timeout (5s) | Defined, not enforced | **ENFORCED** | `SET LOCAL statement_timeout` |
| Rate limit (data_query) | Not registered | **REGISTERED** | `DEFAULT_RATE_LIMITS` (200/hr) |
| Rate limit (aggregation) | Not registered | **REGISTERED** | `DEFAULT_RATE_LIMITS` (50/hr) |
| Enumeration limit | Not implemented | **IMPLEMENTED** | Per-entity counter (50/hr) |
| Concurrency limit | Not implemented | **IMPLEMENTED** | Semaphore (3 per owner) |
| Error sanitization | Not implemented | **IMPLEMENTED** | Generic messages |
| ToolBroker boundary | Active | **Active** | `execution.ts` unchanged |
| SecurityGuardian chain | Active | **Active** | `guardian.ts` extended |
| Authority resolution | Active | **Active** | unchanged |
| RLS enforcement | Active | **Active** | unchanged |
| Owner injection | Active | **Active** | unchanged |

---

## Database Baseline

| Metric | Value | Changed |
|--------|-------|---------|
| Public tables | 26 | No |
| RLS policies | 86 | No |
| Triggers | 24 | No |
| Functions | 16 | No |
| Indexes | 105 | No |
| Migrations | 0 (Gate 7) | No |

---

## FROZEN Baseline Declaration

```
GATE_7_BASELINE = FROZEN
TOTAL_TESTS = 370/370
TEST_FILES = 31
SOURCE_FILES_MODIFIED = 6
TEST_FILES_MODIFIED = 2
DATABASE_MODIFIED = 0
TSC_NOEMIT = CLEAN
ACTIVE_CRITICAL_FINDINGS = 0
ACTIVE_HIGH_FINDINGS = 0
ACTIVE_MEDIUM_FINDINGS = 0
ACTIVE_LOW_FINDINGS = 1 (F6: compileQuery latent risk, accepted)

THIS_BASELINE_IS_IMMUTABLE_UNTIL_GATE_8
```
