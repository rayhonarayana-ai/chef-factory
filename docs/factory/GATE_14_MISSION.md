# GATE 14 — MISSION

**Date:** 2026-08-17
**Baseline:** 599/599 PASS (frozen Gate 13)
**Recommended Mission:** Persistent Rate/Anomaly State

---

## 1. Mission Options Evaluated

| # | Candidate | Impact | Risk | Effort | Verdict |
|---|-----------|--------|------|--------|---------|
| 1 | **Persistent Rate/Anomaly State** | HIGH | LOW | MEDIUM | **RECOMMENDED** |
| 2 | Mandatory Guardian Wiring | HIGH | MEDIUM | LOW | DEFERRED |
| 3 | Streaming Response Delivery | HIGH | MEDIUM | HIGH | DEFERRED |
| 4 | Conversation Persistence | HIGH | MEDIUM | HIGH | DEFERRED |
| 5 | Documentation Drift Repair | MEDIUM | LOW | LOW | DEFERRED |

### 1.1 Recommendation: Persistent Rate/Anomaly State (Candidate 1)

**Rationale:**
- Two HIGH-severity architectural findings: rate limits and anomaly counters are in-memory, lost on restart
- Two independent instances of each (dual-counting problem)
- Directly impacts security: attacker can exhaust limits, trigger restart, get fresh quota
- No DB changes required (add persistence layer to existing in-memory stores)
- Low risk — changes confined to rateLimit.ts and anomaly.ts
- High confidence of correct implementation
- Unblocks production readiness (rate limits are currently unreliable)

---

## 2. Mission Scope

### 2.1 Primary Deliverables

| # | Task | File | Change |
|---|------|------|--------|
| T1 | Unify RateLimiter instances | security.ts, server.ts | Share single instance across Guardian + Execution |
| T2 | Unify AnomalyDetector instances | security.ts, server.ts | Share single instance across Guardian + Execution |
| T3 | Pass shared instances to Pipeline | server.ts | Pass rateLimiter + anomalyDetector to CommandPipeline |
| T4 | Add DB-backed rate limit persistence | rateLimit.ts, repo.ts | Persist counters to Supabase with TTL |
| T5 | Add DB-backed anomaly persistence | anomaly.ts, repo.ts | Persist counters to Supabase with TTL |
| T6 | Unit tests for unified wiring | gate14.unified.test.ts | New file |
| T7 | Unit tests for DB persistence | gate14.persistence.test.ts | New file |

### 2.2 Out of Scope

- Streaming (deferred to Gate 15+)
- Conversation persistence (deferred to Gate 15+)
- Documentation drift repair (deferred)
- SecurityGuardian mandatory wiring (deferred)
- Cross-provider failover (deferred)
- Memory/vector backend (deferred)
- Database schema changes (FORBIDDEN — persistence via existing tables or new tables if authorized)

---

## 3. Implementation Plan

### Phase A: Preflight
- Verify 599/599 baseline
- Verify tsc --noEmit clean

### Phase B: Unify Instances
- Create single RateLimiter + AnomalyDetector in server.ts
- Pass same instances to SecurityGuardian and ExecutionRunner
- Pass same instances to CommandPipeline
- Remove duplicate instantiation from security.ts

### Phase C: DB Persistence (Rate Limiter)
- Add `rate_limit_state` table (owner_id, scope, limit_key, count, window_start, TTL)
- Modify RateLimiter to read/write state via Store
- Fallback to in-memory if DB unavailable (fail-open on persistence)

### Phase D: DB Persistence (Anomaly Detector)
- Add `anomaly_state` table (owner_id, counter_kind, count, last_decay, TTL)
- Modify AnomalyDetector to read/write state via Store
- Fallback to in-memory if DB unavailable

### Phase E: Unit Tests
- Test unified wiring: single instance shared
- Test DB persistence: write → read → verify
- Test failover: DB down → in-memory fallback
- Test TTL expiry: old state cleaned up

### Phase F: Regression
- Full 599+ test run
- tsc --noEmit clean
- Forensic verification

---

## 4. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| DB unavailability breaks rate limiting | LOW | HIGH | Fail-open to in-memory; log warning |
| Migration introduces schema issues | LOW | MEDIUM | Test migration up/down |
| Shared instance causes cross-contamination | LOW | LOW | Owner-scoped keys already in place |
| Performance impact of DB reads per request | LOW | MEDIUM | Cache with short TTL; batch writes |

---

## 5. Classification

**GATE_14_MISSION_DEFINED**

Recommended: Persistent Rate/Anomaly State (7 tasks). Low risk, high impact, addresses 2 HIGH architectural findings.
