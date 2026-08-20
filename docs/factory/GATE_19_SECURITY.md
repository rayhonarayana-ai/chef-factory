# GATE 19 — SECURITY ASSESSMENT

**Date:** 2026-08-19
**Scope:** Security impact of Gate 19 findings and recommended mission

---

## Security Findings

### S-01: Guardian Hardcodes authorized:true (HIGH)

**Locations:**
- `orchestration.ts:388`
- `execution.ts:439`

**Impact:** The Guardian receives `authorized: true` in the `SecurityRequest`. While the Guardian may still deny based on its own policies (lockdown, critical action registry, rate limits), any future Guardian logic checking `req.authorized` will always see `true`. This weakens the two-gate architecture.

**Mitigation in recommended mission:** Fix both locations to pass the actual authorization state from Gate 1.

---

### S-02: Tool Handler Authorization Surface (HIGH)

**Impact:** 6 tool handlers execute raw SQL outside the Store port. Each handler is an authorization surface area because:
1. They construct SQL directly (potential for injection if input validation is incomplete)
2. They bypass any Store-level auditing or access control
3. They duplicate business logic that may diverge from Store behavior

**Mitigation in recommended mission:** Route all tool handlers through Store port. Store port enforces consistent access patterns.

---

### S-03: No State Transition Validation (MEDIUM)

**File:** `update-task.ts:20-22`

**Impact:** Any status string can be set on any task. This bypasses the state machine defined in `taskEngine.ts`. A `completed` task can be moved back to `queued`, potentially re-triggering execution.

**Mitigation in recommended mission:** Add `canTransition()` validation before SQL UPDATE.

---

### S-04: SSL Cert Verification Disabled (HIGH)

**File:** `pool.ts:23`

**Impact:** `rejectUnauthorized: false` disables MITM protection on DB connection.

**Mitigation:** NOT in recommended mission scope. Requires CA cert configuration. Deferred to Gate 20+.

---

### S-05: queryAudit Bypasses Store (MEDIUM)

**File:** `handlers.ts:370-381`

**Impact:** Dynamic `import()` of `getPool()`, raw SQL, no Store-port counterpart. Cannot be mocked or overridden through the Store interface.

**Mitigation in recommended mission:** Add `queryAudit` to Store port, implement in SupabaseStore/MemoryStore.

---

## Security Invariants Verification

| Invariant | Status | Evidence |
|-----------|--------|----------|
| Owner isolation (RLS) | PRESERVED — SQL queries use owner_id WHERE clause |
| No new execution paths | PRESERVED — refactor changes dependency injection only |
| No schema changes | PRESERVED — no DB changes in mission |
| No API changes | PRESERVED — same endpoints, same behavior |
| No security boundary changes | PRESERVED — Store port is a refactor |
| Guardian evaluation | ENHANCED — authorized:true hardcoding fixed |
| Rate limiting | PRESERVED — rateLimit.ts unchanged |
| Anomaly detection | PRESERVED — anomaly.ts unchanged |
| Cost protection | PRESERVED — costProtector unchanged |
| Prompt injection deny | PRESERVED — promptGuard unchanged |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Refactor introduces regression | LOW | MEDIUM | Existing live integration tests + new tests |
| Store port contract incomplete | LOW | LOW | MemoryStore implements full interface |
| DRY fix misses edge case | LOW | LOW | Behavioral equivalence verified by tests |
| State transition validation too strict | LOW | LOW | Use existing canTransition from taskEngine.ts |
| Tool results wiring breaks conversation | LOW | LOW | appendMessage API already supports tool role |

---

## Alternative Mission Security Assessment

### Mission Option 2: Dead Retry Pipeline
- Security impact: LOW (positive — adds retry infrastructure)
- No new attack surface
- Retry logic should be owner-scoped

### Mission Option 3: Security Authority Chain Fix
- Security impact: HIGH (positive — fixes authorized:true)
- Contained scope (2 lines)
- Should bundle with Mission Option 1

### Mission Option 4: archiveConversation Bug Fix
- Security impact: LOW (positive — fixes API correctness)
- No new attack surface
- Trivial fix
