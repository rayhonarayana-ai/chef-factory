# GATE 17 — MISSION

> Date: 2026-08-19
> Classification: RECOMMENDED

## Mission Options

### Mission 1: Security Event Audit Trail Reliability (RECOMMENDED)

**ID:** G17-M1
**Title:** Security Event Audit Trail Reliability
**Problem:** Security events, rate limit state, and anomaly counters are recorded via fire-and-forget (`void` expressions). If the DB write fails, events are silently lost, creating audit trail gaps and rate limit bypass windows.
**Why It Matters:** Completes the Gate 16 persistence story. Gate 16 fixed the wiring; this ensures the events themselves survive DB failures.
**Evidence:** HIGH-1 (guardian.ts:51 `void this.deps.recordEvent(event)`), HIGH-2 (rateLimit.ts:139 `void this.saveState()`), MEDIUM-9 (rateLimit persistence failure logged once then silent)
**Scope:** 3-4 production files, 1 test file
**Files/Modules:** guardian.ts, security.ts, rateLimit.ts, anomaly.ts
**Risk:** LOW — bounded fix, existing persistence adapters, no schema changes
**Expected Benefit:** Audit trail reliability, rate limit persistence reliability, anomaly persistence reliability
**Expected Test Count:** +8-12
**Dependencies:** None (self-contained)
**Success Criteria:** Security events survive DB failure simulation; rate limit state survives restart; anomaly counters survive restart; all 699+ tests pass

### Mission 2: API Boundary Hardening (CORS, SSE Limits, Error Leakage)

**ID:** G17-M2
**Title:** API Boundary Hardening
**Problem:** No CORS headers, SSE connections not rate-limited, SSE error events leak internal errors, conversation messages stored without secret redaction.
**Why It Matters:** Production readiness — prevents browser security issues and internal error leakage.
**Evidence:** MED-1 (no CORS), HIGH-5 (no SSE rate limit), HIGH-6 (SSE error leakage), HIGH-7 (conversation messages without redaction)
**Scope:** 4-5 production files, 1-2 test files
**Files/Modules:** server.ts, streaming.ts, handlers.ts, conversation.ts, redact.ts
**Risk:** MEDIUM — multi-file changes, HTTP layer hardening
**Expected Benefit:** Production-ready HTTP security headers, SSE connection limits, error sanitization
**Expected Test Count:** +10-15
**Dependencies:** None
**Success Criteria:** CORS headers present; SSE concurrent connection limit enforced; error responses sanitized; conversation messages redacted

### Mission 3: Conversation Security (Input Validation + Secret Redaction)

**ID:** G17-M3
**Title:** Conversation Security
**Problem:** No input validation on conversation messages (prompt injection via history), conversation messages stored without secret redaction.
**Why It Matters:** Security gap in a critical path — prompt injection and secret leakage via conversation history.
**Evidence:** HIGH-2 (no input validation), HIGH-7 (no secret redaction in conversation)
**Scope:** 2-3 production files, 1 test file
**Files/Modules:** handlers.ts, conversation.ts, streaming.ts
**Risk:** MEDIUM — security fix in conversation path
**Expected Benefit:** Prompt injection resistance in conversation, secret redaction in stored messages
**Expected Test Count:** +8-10
**Dependencies:** None
**Success Criteria:** Conversation messages validated for injection patterns; secrets redacted before storage; all tests pass

### Mission 4: db/repo.ts Unit Test Coverage

**ID:** G17-M4
**Title:** db/repo.ts Unit Test Coverage
**Problem:** 800 lines of SupabaseStore implementation with zero unit tests. Only integration tests cover it.
**Why It Matters:** Largest untested production module — regressions may not be caught in CI.
**Evidence:** 800 lines, 0 unit tests, only integration coverage
**Scope:** 1 source file + 1 new test file
**Files/Modules:** db/repo.ts, db/repo.test.ts (new)
**Risk:** MEDIUM — mock-heavy, time-consuming
**Expected Benefit:** Regression prevention for persistence layer
**Expected Test Count:** +15-25
**Dependencies:** None
**Success Criteria:** Unit tests for all Store methods; mock Supabase client; edge cases covered

## Ranking

| Rank | Mission | Score | Rationale |
|------|---------|-------|-----------|
| 1 | M1: Audit Trail Reliability | 55/80 | Highest leverage, completes Gate 16, bounded, testable |
| 2 | M2: API Boundary Hardening | 51/80 | Production readiness, multi-file |
| 3 | M3: Conversation Security | 51/80 | Security gap, bounded |
| 4 | M4: db/repo.ts Tests | 48/80 | Important but time-consuming |

## Recommended Mission

**M1: Security Event Audit Trail Reliability**

**Why this mission:**
1. **Completes Gate 16 story** — Gate 16 fixed persistence wiring, this ensures events survive DB failures
2. **Highest leverage score** — 9/10 implementation leverage (bounded, self-contained)
3. **Bounded scope** — 3-4 files, no schema changes, no API changes
4. **Testable** — clear success criteria with DB failure simulation
5. **Security-critical** — audit trail gaps during DB outages are a real attack vector
6. **No regressions** — additive fix, doesn't change existing behavior
7. **Architecturally coherent** — follows the existing persistence adapter pattern

**Why NOT other missions:**
- M2 (API Boundary): Important but lower leverage; CORS/SSE limits are operational, not security-critical
- M3 (Conversation Security): Important but overlaps with M2; conversation is not yet widely used
- M4 (db/repo.ts Tests): Important but time-consuming; test coverage is a maintenance concern, not a security gap
