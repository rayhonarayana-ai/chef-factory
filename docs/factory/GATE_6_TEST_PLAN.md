# GATE 6 — TEST PLAN

> Date: 2026-08-17
> Mission: Data Intelligence Layer — Testing Strategy

## Test Categories

### 1. Unit Tests — Query Compiler (15-20 tests)

**File:** `src/tools/query-compiler.test.ts`

| Test | What It Proves |
|------|----------------|
| compile simple select | Basic SELECT with WHERE |
| compile with eq filter | Equality filter compiles correctly |
| compile with in filter | IN filter compiles correctly |
| compile with like filter | LIKE filter compiles correctly |
| compile with between filter | BETWEEN filter compiles correctly |
| compile with sort | ORDER BY compiles correctly |
| compile with pagination | LIMIT/OFFSET compiles correctly |
| compile with field selection | SELECT specific fields |
| compile with group by | GROUP BY compiles correctly |
| compile with aggregation | COUNT/SUM/AVG compile correctly |
| owner_id injection | owner_id always injected as first WHERE |
| reject mutation keywords | INSERT/UPDATE/DELETE/DDL rejected |
| reject invalid entity | Unknown entity rejected |
| reject invalid field | Unknown field rejected |
| reject invalid operator | Unknown operator rejected |
| reject out-of-range pagination | Offset > 10000 rejected |
| reject excessive filters | > 10 filters rejected |
| parameterized values | Values never interpolated |

### 2. Unit Tests — Query Validation (10-12 tests)

**File:** `src/tools/query-validate.test.ts`

| Test | What It Proves |
|------|----------------|
| validate valid query plan | Valid plan passes |
| validate missing entity | Missing entity fails |
| validate unknown entity | Unknown entity fails |
| validate unknown filter field | Unknown field fails |
| validate type mismatch | String filter on number field fails |
| validate sort field | Invalid sort field fails |
| validate pagination bounds | Negative offset fails |
| validate fields selection | Unknown field in fields fails |
| validate aggregation | Aggregation on non-numeric field fails |
| validate filter operators | Invalid operator fails |

### 3. Unit Tests — Query Catalog (5-8 tests)

**File:** `src/tools/query-catalog.test.ts`

| Test | What It Proves |
|------|----------------|
| entity exists | All 9 entities in catalog |
| fields match entity | Fields are correct per entity |
| sensitive fields hidden | Hidden fields never in selection |
| sortable fields correct | Only sortable fields in sort |
| filterable fields correct | Only filterable fields in filter |
| relationship graph correct | Entity relationships accurate |

### 4. Unit Tests — query_data Tool (8-10 tests)

**File:** `src/tools/query-data.test.ts`

| Test | What It Proves |
|------|----------------|
| tool definition valid | Name, risk, action type correct |
| handler returns success | Valid query returns rows |
| handler returns empty | No matches returns empty array |
| handler respects limits | Max 100 rows enforced |
| handler truncates | Truncation flag set correctly |
| handler records audit | Query logged with metadata |
| handler respects rate limit | Rate limit check enforced |
| handler rejects invalid plan | Invalid plan returns error |
| handler with aggregation | Aggregation query returns grouped results |

### 5. Integration Tests — ToolBroker (3-5 tests)

**File:** `src/gateways/toolBroker.query.test.ts`

| Test | What It Proves |
|------|----------------|
| query_data passes ToolBroker | Authority check passes for read |
| query_data denied by authority | Deny blocks query |
| query_data security guard | SecurityGuardian evaluates query |
| query_data risk check | Low risk passes ToolBroker |

### 6. Integration Tests — Security (5-8 tests)

**File:** `src/core/security/queryData.test.ts`

| Test | What It Proves |
|------|----------------|
| query in development | Read allowed in dev |
| query in production | Read allowed in production |
| query with injection attempt | Prompt injection blocked |
| query with cross-project | Cross-project blocked |
| query with environment escalation | Escalation blocked |
| query during lockdown | Lockdown blocks query |
| query with cost limit | Cost limit blocks query |
| query with rate limit | Rate limit blocks query |

### 7. E2E Tests — Natural Language (5-8 tests)

**File:** `src/api/queryData.e2e.test.ts`

| Test | What It Proves |
|------|----------------|
| "show all projects" | NL → query → result → response |
| "failed tasks this week" | Time-range filter works |
| "total cost by project" | Aggregation works |
| "denied security actions" | Audit event query works |
| "which model is cheapest" | Model comparison works |
| complex multi-filter | Multiple filters work |

## Test Infrastructure

### Mock Store
Extend `MemoryStore` to support:
- `listAuditEvents(ownerId, filter?)` — For audit event queries
- `listCostEvents(ownerId, filter?)` — For cost event queries

### Test Data
Create seed data for:
- 3 projects (active, paused, archived)
- 10 tasks (various statuses, priorities, dates)
- 5 approvals (various statuses)
- 20 audit events (various actions)
- 10 cost events (various types, amounts)
- 5 decisions (various outcomes)
- 3 agents (various statuses)
- 3 models (various providers, costs)
- 2 runtimes

### Expected Test Count

| Category | Count |
|----------|-------|
| Query compiler unit | 15-20 |
| Query validation unit | 10-12 |
| Query catalog unit | 5-8 |
| query_data tool unit | 8-10 |
| ToolBroker integration | 3-5 |
| Security integration | 5-8 |
| E2E natural language | 5-8 |
| **Total** | **51-71** |

## Regression Testing

- All 257 existing tests MUST PASS unchanged
- No modifications to existing test files
- New tests are additive only
- Gate 5 frozen baseline preserved

## Live Integration Testing

- Query data against real Supabase (ref: dybyidtcyzgliupzzfhl)
- Verify RLS enforcement on all 9 entities
- Verify owner isolation
- Verify project isolation
- Verify result limits
- Verify truncation behavior
