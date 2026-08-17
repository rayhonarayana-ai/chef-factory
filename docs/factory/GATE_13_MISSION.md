# GATE 13 — MISSION

**Date:** 2026-08-17
**Baseline:** 577/577 PASS (frozen Gate 12)
**Recommended Mission:** API Boundary Hardening + Security Remediation

---

## 1. Mission Options Evaluated

| # | Candidate | Impact | Risk | Effort | Verdict |
|---|-----------|--------|------|--------|---------|
| 1 | **API Boundary Hardening** | HIGH | LOW | MEDIUM | **RECOMMENDED** |
| 2 | Streaming Response Delivery | HIGH | MEDIUM | HIGH | DEFERRED |
| 3 | Conversation Persistence | HIGH | MEDIUM | HIGH | DEFERRED |
| 4 | Memory/Vector Backend | MEDIUM | LOW | MEDIUM | DEFERRED |
| 5 | Structured Logging | MEDIUM | LOW | LOW | DEFERRED |
| 6 | Multi-Agent Autonomy | HIGH | HIGH | VERY HIGH | DEFERRED |

### 1.1 Recommendation: API Boundary Hardening (Candidate 1)

**Rationale:**
- Two HIGH-severity security issues in `server.ts` are directly exploitable
- Memory exhaustion DoS via unbounded request body
- Internal error detail leakage to clients
- Low risk — changes confined to `server.ts` only
- No DB changes required
- High confidence of correct implementation

---

## 2. Mission Scope

### 2.1 Primary Deliverables

| # | Task | File | Change |
|---|------|------|--------|
| T1 | Add request body size limit (1MB) | server.ts | Modify `readBody()` |
| T2 | Sanitize error responses | server.ts | Modify catch blocks |
| T3 | Add Content-Type validation | server.ts | Modify route handlers |
| T4 | Add request timeout (30s) | server.ts | Add AbortController/timeout |
| T5 | Unit tests for all boundary controls | gate13.boundary.test.ts | New file |

### 2.2 Out of Scope

- Streaming (deferred to Gate 14+)
- Conversation persistence (deferred to Gate 14+)
- Memory/vector backend (deferred)
- Database changes (FORBIDDEN)
- SecurityGuardian wiring changes (too risky for this gate)

---

## 3. Implementation Plan

### Phase A: Preflight
- Verify 577/577 baseline
- Verify tsc --noEmit clean
- Read current server.ts

### Phase B: Body Size Limit
- Modify `readBody()` to enforce 1MB max
- Return 413 Payload Too Large on overflow
- Test: valid body passes, oversized body rejected

### Phase C: Error Sanitization
- Replace `String(e)` with generic error messages
- Log full error server-side, return sanitized message to client
- Test: client receives generic message, server log has full detail

### Phase D: Content-Type Validation
- Validate Content-Type header on POST/PUT routes
- Return 415 Unsupported Media Type on invalid content
- Test: valid content-type passes, missing/wrong rejected

### Phase E: Request Timeout
- Add 30-second timeout to request processing
- Return 408 Request Timeout on expiry
- Test: fast request passes, slow request times out

### Phase F: Unit Tests
- Test all boundary controls in isolation
- Test edge cases (exact limit, just over, malformed)
- Verify no regression in existing behavior

### Phase G: Regression
- Full 577/577 test run
- tsc --noEmit clean
- Forensic verification (7 checks)

---

## 4. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Breaking existing API consumers | LOW | HIGH | Body limit is generous (1MB); Content-Type validation only on POST/PUT |
| Timeout too aggressive | LOW | MEDIUM | 30s default; configurable |
| Error sanitization too aggressive | LOW | LOW | Generic message + server-side log |
| Test regression | LOW | HIGH | Run full suite after each phase |

---

## 5. Classification

**GATE_13_MISSION_DEFINED**

Recommended: API Boundary Hardening (4 tasks + tests). Low risk, high impact, confined to server.ts.
