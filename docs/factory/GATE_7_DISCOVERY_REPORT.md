# Gate 7 — Discovery Report

> Date: 2026-08-17
> Mode: DISCOVERY_ONLY
> Predecessor: GATE_6_PASS_FROZEN

---

## Executive Summary

Gate 7 discovery audited the entire query_data Data Intelligence Layer from source code, not documentation. The audit covered 10 phases: baseline integrity, query security, byte limits, timeouts, rate limits, threat modeling, architectural review, production readiness, mission options, and owner decisions.

### Key Findings

1. **Gate 6 baseline is FROZEN and intact.** 343/343 tests pass across 31 files. Source matches closure exactly.

2. **The security architecture is sound.** No bypass paths exist between any layers (LLM → ToolBroker → query_data → validation → compilation → execution → RLS → results).

3. **3 deferred Gate 6 items are confirmed as real:**
   - Byte limit: WIRED_BUT_NOT_ENFORCED
   - Timeout: UNVERIFIED
   - Rate limit: WIRED_BUT_NOT_ENFORCED

4. **4 additional findings discovered:**
   - Per-entity enumeration limit: UNCONTROLLED (MEDIUM)
   - Concurrent-query limit: UNCONTROLLED (LOW)
   - compileQuery() trusts caller: LATENT_RISK (LOW)
   - Error messages expose field names: INFORMATIONAL (LOW)

5. **Production readiness: ~78%** (14/18 capabilities fully ready)

### Recommendation

Gate 7 should implement **C3: Combined Production Query Hardening** — merging byte limit enforcement, timeout enforcement, dedicated rate limits, and enumeration protection into a single comprehensive gate.

---

## Baseline Verification

| Metric | Claimed | Actual | Verified |
|--------|---------|--------|----------|
| Total tests | 343/343 | 343/343 | YES — vitest run |
| Total files | 31 | 31 | YES — vitest run |
| Gate 6 unit tests | 38 | 38 | YES — query.test.ts |
| Gate 6 live tests | 47 | 47 | YES — gate6.live.integration.test.ts |
| tsc --noEmit | CLEAN | CLEAN | YES |
| Production source changes | 0 | 0 | YES — file inventory |

---

## Security Posture

### Fully Enforced (14 capabilities)

| # | Capability | Control | Evidence |
|---|-----------|---------|----------|
| 1 | Entity allowlist | QUERY_ENTITIES whitelist | query-engine.ts:48 |
| 2 | Field allowlist | ENTITY_CATALOG per-entity | query-engine.ts:59-106 |
| 3 | Operator allowlist | FILTER_OPERATORS whitelist | query-engine.ts:62 |
| 4 | Owner injection | owner_id=$1 always | query-engine.ts:148,190 |
| 5 | Project isolation | project_id filter + audit JOIN | query-engine.ts:172-175 |
| 6 | Sensitive field exclusion | isFieldSensitive defaults true | query-catalog.ts:171-174 |
| 7 | Row limit validated | max 100, checked | query-engine.ts:93 |
| 8 | Row limit enforced | Slicing after execution | query-engine.ts:364 |
| 9 | Mutation block | MUTATION_PATTERN regex | query-engine.ts:143,239 |
| 10 | ToolBroker boundary | broker.call() per tool | execution.ts:340-356 |
| 11 | SecurityGuardian | Full 11-step chain | guardian.ts:33-161 |
| 12 | Authority resolution | evaluateAuthority per call | execution.ts:326-337 |
| 13 | Audit trail | Execution layer records | execution.ts:407-477 |
| 14 | Cost protection | $5/day, $100/month | costProtection.ts:24-30 |

### Partially Enforced (2 capabilities)

| # | Capability | Gap | Risk |
|---|-----------|-----|------|
| 15 | Query rate limit | Generic tool.call (100/hr) only | LOW |
| 16 | Aggregation rate limit | Not wired | LOW |

### Not Enforced (2 capabilities)

| # | Capability | Gap | Risk |
|---|-----------|-----|------|
| 17 | Byte limit | Constant defined, never used | MEDIUM |
| 18 | Query timeout | Constant defined, never used | LOW |

---

## Threat Model Summary

| Severity | Controlled | Partially | Uncontrolled |
|----------|-----------|-----------|--------------|
| CRITICAL | 0 | 0 | 0 |
| HIGH | 5 (T1-T5) | 0 | 0 |
| MEDIUM | 0 | 3 (T6-T8) | 1 (T9) |
| LOW | 2 (T12,T13) | 0 | 3 (T10,T14,T15) |
| INFORMATIONAL | 0 | 0 | 1 (T16) |

**No CRITICAL or HIGH uncontrolled threats.**

---

## Architecture Assessment

The Gate 6 architecture is **clean and layered**. Each component has a single responsibility:

1. **query-types.ts** — Type contracts and limits
2. **query-catalog.ts** — Entity/field catalog (the "schema")
3. **query-engine.ts** — Validation + compilation + execution
4. **query-data.ts** — Tool definition + handler
5. **ToolBroker** — Authorization boundary
6. **SecurityGuardian** — Security chain
7. **RLS** — Database-level enforcement

No component bypasses another. The LLM never reaches SQL. The architecture is sound for production use with the deferred items addressed.

---

## Gate 7 Readiness

| Criterion | Status |
|-----------|--------|
| Baseline frozen | YES |
| Security architecture sound | YES |
| Deferred items identified | YES |
| Mission candidates proposed | YES (4 candidates) |
| Owner decisions identified | YES (5 decisions) |
| Discovery complete | YES |

**GATE_7_READINESS = READY_FOR_OWNER_DECISION**

---

## Final Metrics

```
GATE_6_BASELINE = FROZEN (343/343)
GATE_7_MODE = DISCOVERY_ONLY
SOURCE_FILES_MODIFIED = 0
DATABASE_MODIFIED = 0
TEST_FILES_MODIFIED = 0
DEPLOYMENT = NONE

BYTE_LIMIT_STATUS = WIRED_BUT_NOT_ENFORCED
TIMEOUT_STATUS = UNVERIFIED
QUERY_RATE_LIMIT_STATUS = WIRED_BUT_NOT_ENFORCED

ACTIVE_CRITICAL_FINDINGS = 0
ACTIVE_HIGH_FINDINGS = 0
ACTIVE_MEDIUM_FINDINGS = 2 (F1, F4)
ACTIVE_LOW_FINDINGS = 5 (F2, F3, F5, F6, F7)

QUERY_SECURITY_STATUS = SOUND (all bypass paths blocked)
PRODUCTION_READINESS = 78% (14/18 fully ready)

GATE_7_READINESS = READY_FOR_OWNER_DECISION
GATE_7_RECOMMENDED_MISSION = C3 (Combined Production Query Hardening)

OWNER_DECISIONS = 5 pending (mission, byte strategy, timeout strategy, new entities, export)
```
