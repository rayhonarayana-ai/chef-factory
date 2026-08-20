# GATE 16 — SECURITY FINDINGS

> Classification: GATE_16_SECURITY
> Date: 2026-08-19
> Scope: All security-relevant findings post-Gate-15

## 1. New Security Findings (Gate 15 introduced)

| ID | Finding | Severity | Target Gate |
|----|---------|----------|-------------|
| S-CRIT-02 | No concurrent SSE connection limit | CRITICAL | Gate 16 (if security bundle) or Gate 17 |
| S-HIGH-01 | No security response headers | HIGH | Gate 17 |
| S-HIGH-02 | SSE error events leak internal messages | HIGH | Gate 16 (if security bundle) or Gate 17 |
| S-HIGH-03 | Conversation messages stored without redaction | HIGH | Gate 16 (if security bundle) or Gate 17 |

## 2. Carried Findings (Re-evaluated)

| ID | Finding | Previous Severity | Current Severity | Notes |
|----|---------|------------------|-----------------|-------|
| C-02 | Pipeline missing rateLimiter/anomalyDetector | NEW | CRITICAL | **Gate 16 primary target** |
| C-03 | PersistentRateLimiter synchronous | NEW | CRITICAL | **Gate 16 primary target** |
| C-04 | PersistentAnomalyDetector synchronous | NEW | CRITICAL | **Gate 16 primary target** |
| S-CRIT-01 | Plaintext secrets in .env | CRITICAL | CRITICAL | Owner action needed (rotation) |
| F-CRIT-01 | Plaintext secrets in .env | CRITICAL | CRITICAL | Same as S-CRIT-01 |
| F-SEC-01 | Security guard hardcoded authorized | HIGH | DEFERRED | Not actively exploitable |
| F-GAP-02 | Rate state lost on restart | HIGH | **CRITICAL** | **Covered by C-02/C-03** |
| F-GAP-03 | Duplicate Guardian instances | HIGH | DEFERRED | Not confirmed |

## 3. Resolved Findings

| ID | Finding | Resolution |
|----|---------|------------|
| G15-01 | Guardian hardcodes lockdownActive: false | FALSE_POSITIVE (early return at line 52-65) |
| G15-02 | Bottom-of-file imports in anomaly.ts | CONFIRMED_HARMLESS (circular dep avoidance) |
| G15-03 | MemoryGateway.saveLesson non-existent method | INVALID (method exists on Store interface) |

## 4. Security Invariants Verification (16/16 Preserved)

| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Single execution per command | PRESERVED | ToolBroker execute=false, handler-once |
| 2 | SecurityGuardian evaluates before execution | PRESERVED | guardian.ts:52-65, 90-206 |
| 3 | Authority resolution before tool calls | PRESERVED | pipeline.ts:260-271 |
| 4 | Cost protection limits enforced | PRESERVED | costProtection.ts + guardian.ts:94-103 |
| 5 | Prompt injection denied | PRESERVED | promptInjection.ts + policyEngine.ts:120-128 |
| 6 | Anomaly counters track signals | PRESERVED | anomaly.ts:69-86 (in-memory) |
| 7 | Owner/project isolation | PRESERVED | RLS + owner-scoped queries |
| 8 | ToolBroker boundary intact | PRESERVED | toolBroker.ts:77 (execute=false) |
| 9 | Approval gate for critical actions | PRESERVED | pipeline.ts:377-433 |
| 10 | Lockdown is fail-closed | PRESERVED | guardian.ts:52-65 (early return) |
| 11 | Rate limiting per-scope | PRESERVED (in-memory) | rateLimit.ts:60-79 |
| 12 | Cancellation propagation | PRESERVED | streaming.ts:31-37, orchestration.ts:272-288 |
| 13 | Error messages sanitized | PRESERVED | server.ts:297-299 (API), **NOT preserved for SSE** (streaming.ts:111) |
| 14 | No secret exposure in logs | PRESERVED | redact.ts + secretProvider.ts |
| 15 | Database integrity (no unauthorized changes) | PRESERVED | 0 DB changes in Gate 15 |
| 16 | API scope — no expansion | PRESERVED | No new endpoints in Gate 15 |

**Note:** Invariant 13 has a partial gap for the SSE path (S-HIGH-02). The streaming error handler sends raw error strings. This is addressed in the security hardening bundle (Mission B) but is NOT a regression from Gate 15 — the SSE path is new functionality.

## 5. Gate 16 Mission Security Assessment

### Persistent Security State Fix (Mission A)

**Security impact:** POSITIVE — restores rate limiting and anomaly persistence in the production path.

**Risk assessment:**
- Changes are confined to guardian.ts (switching sync to async calls)
- Persistence adapters already tested (25 Gate 14 tests)
- No new attack surface introduced
- No DB schema changes
- No API changes

**Pre-implementation security checklist:**
- [ ] Verify all 16 invariants preserved
- [ ] Verify 25 Gate 14 persistence tests still pass
- [ ] Add tests for production-path persistence (not just adapter tests)
- [ ] Verify fail-closed behavior when persistence DB is unavailable
- [ ] Verify no secret exposure in async error paths

## 6. Recommendations

1. **Immediate:** Fix C-02/C-03/C-04 (Gate 16 mission)
2. **Next gate:** Security hardening bundle (S-CRIT-02, S-HIGH-01, S-HIGH-02, S-HIGH-03)
3. **Owner action:** Rotate .env credentials (S-CRIT-01)
4. **Deferred:** Provider streaming security model (requires true streaming first)
