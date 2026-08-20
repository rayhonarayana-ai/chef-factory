# Gate 20 — Security Analysis

## Security Findings

### 1. Approval Queue DoS (MEDIUM)

**Finding:** No limit on number of pending approvals per task or per owner. `isExpired()` exists but is never called.

**Attack vector:** An agent (or compromised tool) could create approval requests for destructive actions without resolving them, flooding the owner's approval queue.

**Mitigation in Gate 20 Mission A:** Wire `isExpired()` into the approval resolution path. Add configurable expiry duration.

**Residual risk:** Without a scheduler to auto-expire, old pending approvals still accumulate. But at least they can't be resolved after expiry.

### 2. Retry Without Re-Authorization (SAFE)

**Finding:** When a task is re-queued after failure, it re-enters the pipeline from `queued`. The authority/security checks are re-evaluated at pipeline entry.

**Assessment:** SAFE. No authorization bypass.

### 3. Tool Schema Injection (MITIGATED)

**Finding:** Tool definition status enums are wrong, but this is a correctness issue, not a security issue. The LLM generates invalid values that are rejected by the handler. No injection path exists.

**Assessment:** NOT a security vulnerability.

### 4. Live Test Deadlock (LOW SECURITY IMPACT)

**Finding:** PostgreSQL deadlock during test cleanup. This is a test infrastructure issue, not a production security concern.

**Assessment:** LOW security impact. No data corruption or unauthorized access.

### 5. MemoryStore.queryAudit Filter Mismatch (LOW)

**Finding:** MemoryStore filters by actorId, SupabaseStore by project ownership. Tests see different audit scope than production.

**Assessment:** LOW security impact. Audit events are still recorded; the query scope is just different in tests.

## Guardian/RBAC/Store Alignment

| Check | Status |
|---|---|
| Guardian evaluates before execution | PASS |
| RBAC enforced per tool call | PASS |
| Store isolation per owner | PASS |
| Rate limiting active | PASS |
| Anomaly detection active | PASS |
| Cost recording active | PASS |
| Budget enforcement pre-execution | **GAP** (costs recorded post-hoc) |

## Blast Radius Assessment

| Mission | Blast Radius |
|---|---|
| A (Enum + Timeout) | LOW — 3-4 files, schema + validation only |
| B (Stuck Tasks) | MEDIUM — new Store methods + queries |
| C (Deadlock + MemoryStore) | LOW — 2 files |
| D (Code Quality) | LOW-MEDIUM — cross-file rename |
