# Gate 7 — Mission Options

> Date: 2026-08-17
> Mode: DISCOVERY_ONLY — no implementation
> Prerequisite: Owner decision on candidate

---

## Candidate 1: Query Security Hardening

**Mission:** Wire the 3 deferred Gate 6 security items + add per-entity enumeration protection.

### Scope

1. **Byte limit enforcement** — Calculate byte size of result rows; truncate when exceeding `QUERY_MAX_BYTES` (50KB); set `truncated: true`
2. **Timeout enforcement** — Apply `SET LOCAL statement_timeout` before query execution; wrap in transaction; fail-closed on timeout
3. **Rate limit registration** — Register `data_query` and `data_query_agg` in `DEFAULT_RATE_LIMITS` with appropriate limits
4. **Per-entity enumeration counter** — Track queries per entity per owner; deny after threshold

### Files Likely Affected

| File | Change |
|------|--------|
| `src/tools/query-engine.ts` | Byte limit + timeout enforcement in `executeQuery()` |
| `src/tools/query-types.ts` | New rate limit defaults, enumeration limits |
| `src/core/security/rateLimit.ts` | Register `data_query` and `data_query_agg` scopes |
| `src/tools/query.test.ts` | ~15 new unit tests |
| `src/integration/gate7.live.integration.test.ts` | ~10 new live tests |

### Database Impact

NONE — all changes are application-level.

### API Impact

NONE — `QueryResultEnvelope` shape unchanged. New fields only in `metadata` (byte size, timeout status).

### Security Impact

HIGH — closes all 3 deferred Gate 6 findings + enumeration protection.

### Test Impact

~25 new tests across unit + live.

### Live Verification Requirements

- Byte limit: verify truncation with large text fields
- Timeout: verify slow query cancellation
- Rate limit: verify dedicated scope enforcement
- Enumeration: verify per-entity counter

### Risks

- Timeout implementation must be fail-closed (error response, not silent)
- Byte counting must handle UTF-8 correctly
- Rate limit registration must not conflict with existing scopes

### What Remains Deferred

- Concurrent-query limit
- Error message sanitization
- New entities
- Export capability

---

## Candidate 2: Query Performance & Resource Protection

**Mission:** Hardening against resource exhaustion and slow queries.

### Scope

1. **Statement timeout** — `SET LOCAL statement_timeout = '5s'` before query
2. **Connection pool review** — Verify pool limits are appropriate
3. **Query plan caching** — Cache compiled SQL for repeated identical plans
4. **Response size hardening** — Byte limit as part of resource protection

### Files Likely Affected

| File | Change |
|------|--------|
| `src/tools/query-engine.ts` | Statement timeout, plan caching |
| `src/db/pool.ts` | Pool configuration review |
| `src/tools/query.test.ts` | ~10 new tests |

### Database Impact

NONE — statement_timeout is per-transaction, not persistent.

### API Impact

NONE.

### Security Impact

MEDIUM — prevents resource exhaustion.

### Test Impact

~10-15 new tests.

### Live Verification Requirements

- Timeout: verify statement_timeout fires
- Pool: verify connection limits

### Risks

- Plan caching must invalidate on catalog changes (unlikely in production)
- Statement timeout must be per-transaction, not global

### What Remains Deferred

- Dedicated rate limits
- Enumeration protection
- Concurrent-query limit
- New entities
- Export

---

## Candidate 3: Combined Production Query Hardening

**Mission:** Merge C1 + C2 into a single comprehensive hardening gate.

### Scope

Everything in C1 + C2, plus:

5. **Pagination abuse mitigation** — Per-entity total row limit across paginated queries
6. **Concurrent-query limit** — Max concurrent query_data executions per owner
7. **Error message sanitization** — Don't expose field names to LLM in validation errors

### Files Likely Affected

| File | Change |
|------|--------|
| `src/tools/query-engine.ts` | Byte limit, timeout, plan caching |
| `src/tools/query-types.ts` | Rate limits, enumeration limits, concurrency limits |
| `src/tools/query-data.ts` | Error sanitization |
| `src/core/security/rateLimit.ts` | Register new scopes |
| `src/tools/query.test.ts` | ~25-35 new tests |
| `src/integration/gate7.live.integration.test.ts` | ~15-20 new live tests |

### Database Impact

NONE.

### API Impact

NONE — `QueryResultEnvelope` shape unchanged.

### Security Impact

HIGH — closes all deferred items + new protections.

### Test Impact

~40-55 new tests.

### Live Verification Requirements

Comprehensive: byte limit, timeout, rate limits, enumeration, concurrency.

### Risks

- Larger scope means more testing required
- Concurrency limit needs careful design (semaphore vs queue)
- Error sanitization must not lose diagnostic value

### What Remains Deferred

- New entities (security_events, task_runs, etc.)
- New operators (regex, contains)
- Export capability
- Cross-entity joins

---

## Candidate 4: Data Intelligence Expansion

**Mission:** Expand the Data Intelligence Layer with new capabilities.

### Scope

1. **New entities** — security_events, security_incidents, task_runs, conversation_messages
2. **New operators** — `contains` (array), `regex` (text)
3. **Export capability** — CSV/JSON download of query results
4. **Cross-entity joins** — Tasks with their approvals, costs with projects

### Files Likely Affected

| File | Change |
|------|--------|
| `src/tools/query-types.ts` | New entities, operators |
| `src/tools/query-catalog.ts` | New field specs for new entities |
| `src/tools/query-engine.ts` | New compilation paths |
| `src/tools/query-data.ts` | Export handler |
| `src/tools/query.test.ts` | ~40-60 new tests |

### Database Impact

NONE — reads only, no schema changes.

### API Impact

NEW capabilities — expanded QueryPlan, new response fields.

### Security Impact

MEDIUM — larger attack surface, new entities with different sensitivity profiles.

### Test Impact

~40-60 new tests.

### Live Verification Requirements

- New entities: verify field catalogs, sensitivity, owner isolation
- New operators: verify compilation, injection resistance
- Export: verify format correctness, byte limits

### Risks

- New entities expand attack surface
- Cross-entity joins increase SQL complexity
- Export must respect byte limits and rate limits

### What Remains Deferred

- All C3 scope items (byte limit, timeout, rate limits, enumeration)

---

## Comparison Matrix

| Criterion | C1 | C2 | C3 | C4 |
|-----------|----|----|----|----|
| Closes Gate 6 findings | 3/3 | 1/3 | 3/3 | 0/3 |
| Resource protection | PARTIAL | FULL | FULL | NONE |
| Enumeration protection | YES | NO | YES | NO |
| Concurrency protection | NO | NO | YES | NO |
| New capabilities | NO | NO | NO | YES |
| Scope | SMALL | SMALL | MEDIUM | LARGE |
| Risk | LOW | LOW | MEDIUM | MEDIUM |
| Test count | ~25 | ~15 | ~50 | ~50 |

## Recommendation

**C3: Combined Production Query Hardening** — addresses all deferred items, adds new protections, and has manageable scope. Should be implemented before any multi-user or agent-facing deployment.

C4 should be deferred to Gate 8 to keep Gate 7 focused on security hardening.
