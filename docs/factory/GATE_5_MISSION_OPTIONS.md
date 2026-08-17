# Gate 5 — Mission Options

> **Date:** 2026-08-17
> **Status:** GATE_5_DISCOVERY_COMPLETE

---

## Candidate 1: Execution Integrity Hardening

**Priority:** 1 (CRITICAL)
**Complexity:** LOW-MEDIUM
**Risk:** LOW
**Dependencies:** None

### Problems Solved
1. Double execution bug — tool handlers fire twice per call (data corruption)
2. Text-only fallback bypasses security chain entirely
3. No idempotency protection for write operations

### Required Work
- Remove redundant `toolDef.handler()` call in `execution.ts:372`
- OR restructure ToolBroker to separate check vs execute phase
- Wire authority + guardian checks into text-only fallback path
- Add idempotency keys for write tools (optional)

### Files Affected
- `src/api/execution.ts` — primary changes
- `src/gateways/toolBroker.ts` — possible restructure
- New test file or additions to existing tests

### Evidence Requirements
- Handler called exactly once per tool call (unit test)
- Single record created per write operation (live test)
- Text-only path invokes security checks (unit test)
- All 243 baseline tests pass (regression)

---

## Candidate 2: Production Security Hardening

**Priority:** 2 (HIGH)
**Complexity:** MEDIUM
**Risk:** MEDIUM
**Dependencies:** OD4 (cost limits configuration)

### Problems Solved
1. Cost protection disabled (all hard limits null)
2. Prompt injection directives recorded but not denied
3. Anomaly counters never decay (false positives in long sessions)
4. Critical action vocabulary alias map missing (dormant defense)
5. No dedicated CostProtector unit tests

### Required Work
- Enable cost protection limits in `costProtection.ts`
- Add deny rule for `untrustedAuthorityDirective` in `policyEngine.ts`
- Add time-decay to anomaly counters in `anomaly.ts`
- Implement vocabulary alias map in `authority.ts` or `criticalActions.ts`
- Write CostProtector unit tests

### Files Affected
- `src/core/security/costProtection.ts` — enable limits
- `src/core/security/policyEngine.ts` — add deny rule
- `src/core/security/anomaly.ts` — add decay
- `src/core/authority.ts` or `src/tools/index.ts` — alias map
- New test file or additions to existing tests

### Evidence Requirements
- Cost limit blocks spending above threshold (unit + live)
- Prompt injection directive triggers deny (unit test)
- Anomaly counter resets after window (unit test)
- Vocabulary alias maps correctly (unit test)
- All 243 baseline tests pass (regression)

---

## Candidate 3: Data Intelligence Layer

**Priority:** 3 (MEDIUM)
**Complexity:** MEDIUM
**Risk:** LOW
**Dependencies:** None

### Problems Solved
1. CHEF cannot query stored data intelligently
2. No filtering, sorting, or aggregation across projects/tasks
3. No natural language → structured query translation

### Required Work
- Create `query-data` tool handler
- Register in tool registry with appropriate risk level
- Classify action type in authority matrix
- Add tests + live verification

### Files Affected
- New: `src/tools/query-data.ts`
- `src/tools/index.ts` — register tool
- `src/core/authority.ts` — new action type
- New test file

### Evidence Requirements
- Query tool returns filtered results (unit + live)
- Authority matrix correctly classifies query actions
- All 243 baseline tests pass (regression)

---

## Decision Matrix

| Candidate | Business | Security | Architecture | Complexity | Risk | Total Priority |
|-----------|----------|----------|-------------|------------|------|---------------|
| C1: Execution Integrity | 10 | 8 | 9 | 3 (low-med) | 2 (low) | **32** |
| C2: Security Hardening | 7 | 10 | 6 | 5 (medium) | 5 (medium) | **33** |
| C3: Data Intelligence | 8 | 2 | 5 | 5 (medium) | 2 (low) | **22** |

**Scoring:** Higher = more urgent/valuable. Business/Security/Architecture weighted 3x. Complexity/Risk inverted (lower = better).

**RECOMMENDED:** Combine C1 + C2 as Gate 5 mission. C3 deferred to Gate 6.
