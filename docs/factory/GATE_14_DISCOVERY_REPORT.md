# GATE 14 — DISCOVERY REPORT

**Date:** 2026-08-17
**Baseline:** 599/599 PASS (frozen Gate 13)
**Scope:** Forensic audit, drift audit, capability audit, bottleneck analysis, mission recommendation
**Source/test/DB changes:** NONE — discovery only

---

## 1. Forensic Audit Summary

Three parallel forensic agents read every source file in the codebase (55+ files, 8000+ lines). Key findings:

### 1.1 Architectural Findings

| # | Finding | Severity | Classification |
|---|---------|----------|----------------|
| A1 | RateLimiter: 2+ independent instances, in-memory only, lost on restart | HIGH | ARCHITECTURE |
| A2 | AnomalyDetector: same as RateLimiter — 2+ instances, in-memory, lost on restart | HIGH | ARCHITECTURE |
| A3 | SecurityGuardian is optional in all callers (pipeline, execution, orchestration) | HIGH | SECURITY |
| A4 | No cross-provider failover (per-provider circuit breaker only) | MEDIUM | RELIABILITY |
| A5 | All resilience state (circuit, health) in-memory, lost on restart | MEDIUM | RELIABILITY |
| A6 | `execute=false` in ToolBroker is caller-controlled convention, not architectural guarantee | MEDIUM | SECURITY |
| A7 | Pipeline-level rateLimiter/anomalyDetector never instantiated (dead constructor params) | HIGH | SECURITY |
| A8 | MemoryGateway recall() always returns []; saveLesson writes data that can never be recalled | MEDIUM | CAPABILITY_GAP |

### 1.2 Security Findings

| # | Finding | Severity | Classification |
|---|---------|----------|----------------|
| S1 | SecurityGuardian optional — callers can bypass all tool-level security | HIGH | SECURITY |
| S2 | costCheck optional in Guardian — cost protection silently skipped if omitted | MEDIUM | SECURITY |
| S3 | promptInjection detection is regex-only; sophisticated injections bypass | MEDIUM | SECURITY |
| S4 | Variable resolution mismatch: validation allows any field, resolution only handles .id | MEDIUM | CORRECTNESS |
| S5 | Rate limit off-by-one: effective limit is maxCount+1 per window | LOW | CORRECTNESS |
| S6 | queryAudit() bypasses Store abstraction with raw SQL | MEDIUM | CONSISTENCY |

### 1.3 Data Layer Findings

| # | Finding | Severity | Classification |
|---|---------|----------|----------------|
| D1 | LIMIT/OFFSET/GROUP BY/ORDER BY interpolated not parameterized (catalog-constrained) | MEDIUM | CONSISTENCY |
| D2 | SET LOCAL statement_timeout ineffective outside transaction | LOW | DEFENSE_DEPTH |
| D3 | recall() stub returns []; memory writes are one-way data sinks | LOW | CAPABILITY_GAP |
| D4 | Secret patterns duplicated between redact.ts and secretGuard.ts | LOW | MAINTENANCE |

---

## 2. Drift Audit Summary

| DRIFT_TYPE | Count | Severity Breakdown |
|------------|-------|-------------------|
| DOCUMENTATION_DRIFT | 15 | 2 CRITICAL, 6 HIGH, 5 MEDIUM, 2 LOW |
| DATABASE_DRIFT | 4 | 2 HIGH, 2 MEDIUM |
| TEST_DRIFT | 1 | 1 CRITICAL |
| SOURCE_DRIFT | 1 | 1 HIGH |
| ARCHITECTURE_DRIFT | 1 | 1 HIGH |
| EVIDENCE_DRIFT | 1 | 1 LOW |
| **TOTAL** | **23** | **3 CRITICAL, 10 HIGH, 6 MEDIUM, 4 LOW** |

**Critical Drift:**
- ARCHITECTURE.md says "17 critical actions" — actual is 26
- ARCHITECTURE.md says "166 tests (20 files)" — actual is 599 (41 files)
- Test count off by 433 tests

**High Drift:**
- ARCHITECTURE.md lists only 3 migrations — actual is 5
- DATABASE.md says 22 tables — actual is 26
- SECURITY.md table/policy counts stale
- COMPONENT lists missing 11+ implemented modules
- todo.md header missing Gate 13 status

---

## 3. Capability Audit (27 Capabilities)

| # | Capability | Module(s) | Status | Tests |
|---|-----------|-----------|--------|-------|
| 1 | Owner Identity + Auth | repo.ts, auth.ts | ✅ | 20+ |
| 2 | Project Registry | repo.ts | ✅ | 15+ |
| 3 | Agent Registry + Permissions | repo.ts, toolBroker.ts | ✅ | 12+ |
| 4 | Task Engine + Lifecycle | taskEngine.ts | ✅ | 18+ |
| 5 | Model/Runtime Registry | repo.ts | ✅ | 8+ |
| 6 | Approval Engine | approval.ts | ✅ | 10+ |
| 7 | Audit Trail | repo.ts | ✅ | 8+ |
| 8 | Cost Tracking + Protection | repo.ts, costProtector.ts | ✅ | 10+ |
| 9 | Authority Matrix | authority.ts | ✅ | 15+ |
| 10 | Autonomy Controller | autonomy.ts | ✅ | 8+ |
| 11 | Security Guardian | guardian.ts | ✅ | 41+ |
| 12 | Rate Limiting | rateLimit.ts | ⚠️ IN-MEMORY | 10+ |
| 13 | Anomaly Detection | anomaly.ts | ⚠️ IN-MEMORY | 8+ |
| 14 | Prompt Injection Defense | promptInjection.ts | ✅ | 6+ |
| 15 | Lockdown | lockdown.ts | ✅ | 8+ |
| 16 | Secret Redaction | redact.ts | ✅ | 10+ |
| 17 | ToolBroker Boundary | toolBroker.ts | ✅ | 12+ |
| 18 | Data Intelligence (query) | query-engine.ts | ✅ | 56+ |
| 19 | Multi-Step Orchestration | orchestration.ts, pipeline.ts | ✅ | 43+ |
| 20 | Provider Resilience | resilience.ts | ✅ | 31+ |
| 21 | Conversation Token Budget | execution.ts | ✅ | 16+ |
| 22 | Cancellation | orchestration.ts | ✅ | 8+ |
| 23 | API Body Size Limit | server.ts (Gate 13) | ✅ | 5+ |
| 24 | API Error Sanitization | server.ts (Gate 13) | ✅ | 4+ |
| 25 | API Content-Type Enforcement | server.ts (Gate 13) | ✅ | 7+ |
| 26 | API Request Timeout | server.ts (Gate 13) | ✅ | 2+ |
| 27 | Streaming | N/A | ❌ NOT IMPLEMENTED | 0 |

---

## 4. Bottleneck Ranking (Post-Gate 13)

| Rank | Bottleneck | Impact | Evidence | Gate 14? |
|------|-----------|--------|----------|----------|
| 1 | **Persistent rate/anomaly state** | HIGH — state lost on restart; 2 independent instances | rateLimit.ts, anomaly.ts in-memory only | ✅ RECOMMENDED |
| 2 | **SecurityGuardian optional wiring** | HIGH — callers can bypass all tool security | pipeline.ts, execution.ts accept undefined | DEFERRED |
| 3 | **No streaming** | HIGH — long responses block; no partial output | No SSE/WebSocket anywhere | DEFERRED |
| 4 | **No conversation persistence** | HIGH — state lost on session end | No DB conversation table | DEFERRED |
| 5 | **Documentation drift (23 items)** | MEDIUM — 3 CRITICAL drift items | ARCHITECTURE.md, SECURITY.md, DATABASE.md stale | DEFERRED |
| 6 | **No cross-provider failover** | MEDIUM — single provider outage causes full failure | resilience.ts per-provider only | DEFERRED |
| 7 | **Memory layer inert** | MEDIUM — no cross-session learning | memoryGateway.ts returns empty | DEFERRED |
| 8 | **Pipeline rate limiter dead** | MEDIUM — pipeline-level rate limits never enforced | pipeline.ts constructor params never passed | DEFERRED |
| 9 | **No structured logging** | LOW — debugging difficulty | console.log only | DEFERRED |
| 10 | **Google adapter null usage** | LOW — silent no-op | providerAdapter.ts | DEFERRED |

---

## 5. Security Invariant Verification (16 Items)

| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Guardian | ⚠️ PRESENT but optional | securityGuardian wired in server.ts but optional in pipeline/execution |
| 2 | Authority resolution | ✅ PRESERVED | authority.ts untouched, 10-rule matrix |
| 3 | ToolBroker validation-only execution | ⚠️ PRESENT but convention-based | execute=false flag, not architectural |
| 4 | Single execution invariant | ✅ PRESERVED | handler called exactly once after validate |
| 5 | Cost protection | ✅ PRESERVED | CostProtector wired, production limits active |
| 6 | Rate limiting | ⚠️ PRESENT but dual-instance + in-memory | 2 independent RateLimiter instances |
| 7 | Anomaly detection | ⚠️ PRESENT but dual-instance + in-memory | 2 independent AnomalyDetector instances |
| 8 | Prompt injection defense | ✅ PRESERVED | promptInjection.ts active |
| 9 | Owner isolation | ✅ PRESERVED | owner_id in all WHERE clauses |
| 10 | Project isolation | ✅ PRESERVED | RLS + application layer |
| 11 | Conversation isolation | ✅ PRESERVED | conversation_id scoping |
| 12 | RLS | ✅ PRESERVED | No DB changes |
| 13 | Approval boundaries | ✅ PRESERVED | Critical actions require approval |
| 14 | Cancellation | ✅ PRESERVED | CancellationController in orchestration |
| 15 | Orchestration timeout | ✅ PRESERVED | 5min default, 30s per step |
| 16 | Step timeout | ✅ PRESERVED | 30s default per step |

**Assessment:** 10/16 fully preserved. 6/16 present but with architectural concerns (optional wiring, in-memory state, dual instances). No regressions from Gate 13.

---

## 6. Classification

**GATE_14_DISCOVERY_COMPLETE**

No source/test/DB changes. Documentation-only scope. 599/599 baseline preserved.
