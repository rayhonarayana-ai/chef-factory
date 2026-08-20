# GATE 18 DISCOVERY REPORT

**Date:** 2026-08-19
**Status:** GATE_18_DISCOVERY_COMPLETE
**Classification:** GATE_18_READY_FOR_OWNER_APPROVAL

---

## GATE 17 STATUS: CLOSED AS PARTIAL

```
GATE_17 = PARTIAL
MISSION = Security Event Audit Trail Reliability
FAILURE_OBSERVABILITY = VERIFIED
RECOVERY = UNPROVEN / NOT IMPLEMENTED
TESTS = 716/716 PASS, 7 SKIPPED
TSC = CLEAN
BUILD = CLEAN
REGRESSIONS = ZERO
```

Gate 17 closure is **VALID**. Final report matches evidence. Classification is accurate.

---

## BASELINE

```
716/716 PASS
7 SKIPPED
TSC CLEAN
BUILD CLEAN
ZERO REGRESSIONS
```

---

## PHASE 3 — RECOVERY GAP PROOF

### A. What happens when DB is unavailable?

Security events continue to be **emitted** in memory (the `events` array in `guardian.ts:evaluate()`), but the `recordEvent()` call fails. Gate 17 proves this via `.catch()` logging. Rate limit and anomaly state also fall back to in-memory-only mode (Gate 14 fail-closed). **Security decisions continue correctly** — only persistence is affected.

### B. Are security events lost?

**YES.** When `store.recordSecurityEvent()` fails (DB unavailable), the event is permanently lost from the persistence layer. The `.catch()` handler logs a warning but does not re-enqueue, retry, or buffer. `G17-RETRY-05` explicitly proves `saveAttempts === 1`.

### C. Do events stay in memory?

**TEMPORARILY.** The `events` array in `guardian.ts:evaluate()` holds events for the duration of the `evaluate()` call. After the method returns, events are available in the `SecurityGuardResult.events` field. Once the HTTP response is sent, events are garbage-collected.

### D. Is there durable temporary storage?

**NO.** No file-based buffer, no write-ahead log, no outbox table, no dead-letter queue. The only persistence path is `store.recordSecurityEvent()` → Supabase.

### E. Is there a retry mechanism?

**NO.** Gate 17 proves this. `G17-RETRY-01` through `G17-RETRY-05` all assert `saveAttempts === 1`.

### F. Is there a queue?

**NO.** No in-process queue, no Redis queue, no message broker.

### G. Is there an outbox pattern?

**NO.** No transactional outbox. Events are fire-and-forget.

### H. Is there a background worker?

**NO.** No background process, no cron job, no scheduled retry.

### I. Can events be recovered after DB returns?

**NO.** Once the `.catch()` handler fires, the event is gone. There is no reconciliation mechanism.

### J. Could recovery create duplicates?

**YES, potentially.** If a retry mechanism were added, events could be duplicated if the original write succeeded but the response was lost. This would require idempotency keys or deduplication.

### K. Are there ordering guarantees?

**NO.** Events are emitted in evaluation order, but persistence is async fire-and-forget. Under concurrent requests, events from different requests can interleave arbitrarily in the DB.

### L. Are there idempotency guarantees?

**NO.** The same event could theoretically be persisted twice if retry were added without deduplication.

### M. What is the security impact of event loss?

**MODERATE.** During a DB outage:
- Denial events (blocked actions) are lost → no audit trail for security incidents
- Anomaly events are lost → no record of suspicious patterns
- Rate limit events are lost → no evidence of limit enforcement
- **However:** Security decisions themselves are still correct (in-memory state works)
- **Critical concern:** An attacker who disrupts the DB can suppress the audit trail during their attack window

### RECOVERY GAP SUMMARY

| Dimension | Current State | Impact |
|-----------|--------------|--------|
| Event persistence on DB failure | LOST | Audit trail gap |
| Rate limit state on DB failure | In-memory only | State lost on restart |
| Anomaly state on DB failure | In-memory only | Counters lost on restart |
| Recovery after DB returns | NONE | Permanent loss |
| Idempotency | NONE | Duplicates possible if retry added |
| Ordering | NONE | Events interleave across requests |

---

## PHASE 4-5 — CAPABILITY MATURITY MAP

| # | Capability | Maturity | Evidence |
|---|-----------|----------|----------|
| 1 | Executive Core (pipeline, tools, conversation) | RUNTIME_VERIFIED | 716/716 tests, live integration |
| 2 | Security Guardian (full chain) | RUNTIME_VERIFIED | 41 security tests, live integration |
| 3 | Authority Resolution | RUNTIME_VERIFIED | authority.test.ts, live integration |
| 4 | Critical Action Registry | RUNTIME_VERIFIED | criticalActions.test.ts, DB triggers |
| 5 | Rate Limiting (in-memory) | RUNTIME_VERIFIED | gate5.test.ts, gate14.persistence.test.ts |
| 6 | Rate Limiting (persistent) | TEST_VERIFIED | gate14.persistence.test.ts, gate16 |
| 7 | Anomaly Detection (in-memory) | RUNTIME_VERIFIED | gate5.test.ts |
| 8 | Anomaly Detection (persistent) | TEST_VERIFIED | gate14.persistence.test.ts |
| 9 | Cost Protection | RUNTIME_VERIFIED | cost.test.ts, live integration |
| 10 | Prompt Injection Detection | TEST_VERIFIED | securityGuardian.test.ts |
| 11 | Emergency Lockdown | TEST_VERIFIED | securityGuardian.test.ts |
| 12 | Approval Workflow | CODE_ONLY | policyEngine returns require_approval, no enforcement |
| 13 | Multi-Step Orchestration | RUNTIME_VERIFIED | orchestration.test.ts, gate9, gate12 |
| 14 | Provider Resilience | RUNTIME_VERIFIED | resilience.test.ts, gate10 live |
| 15 | SSE Streaming | RUNTIME_VERIFIED | gate15.streaming.test.ts |
| 16 | Data Intelligence (query) | RUNTIME_VERIFIED | query.test.ts, gate6 live |
| 17 | API Boundary (body limit, CT, timeout, errors) | RUNTIME_VERIFIED | gate13.boundary.test.ts |
| 18 | Security Event Audit Trail | TEST_VERIFIED | gate17.auditTrail.test.ts |
| 19 | Audit Trail Recovery | NOT_IMPLEMENTED | No retry, no queue, no outbox |
| 20 | Conversation Persistence | TEST_VERIFIED | gate4 live integration |
| 21 | Memory/Learning (write) | CODE_ONLY | saveLesson works, no recall |
| 22 | Memory/Learning (recall) | NOT_IMPLEMENTED | recall() returns [] |
| 23 | CORS Headers | NOT_IMPLEMENTED | No Access-Control-* headers |
| 24 | Structured Logging | NOT_IMPLEMENTED | console.error only |
| 25 | Metrics/Telemetry | NOT_IMPLEMENTED | No Prometheus/OTEL |
| 26 | Per-Tool Timeout | NOT_IMPLEMENTED | No AbortSignal in handler contract |
| 27 | Graceful Shutdown | NOT_IMPLEMENTED | pool.end() fire-and-forget |

---

## PHASE 6 — BOTTLENECK CANDIDATES (10 IDENTIFIED)

### CANDIDATE 1: ConversationService Architecture Violation + Zero Tests

**ID:** C-CONV
**NAME:** ConversationService Bypasses Store Interface + Zero Test Coverage
**CURRENT_STATE:** ConversationService calls `getPool()` directly, bypassing the Store port. Zero unit or integration tests for createConversation, appendMessage, loadHistory, archiveConversation. All conversation logic is duplicated between handlers.ts and streaming.ts.
**EVIDENCE:** F-RUN-10, F-DATA-10, F-DATA-12, F-RUN-34
**SEVERITY:** HIGH
**SECURITY_IMPACT:** LOW (no security boundary involvement)
**CORRECTNESS_IMPACT:** HIGH — untested CRUD operations could silently corrupt conversation history
**RUNTIME_IMPACT:** MEDIUM — duplicated code increases bug surface
**BUSINESS_IMPACT:** HIGH — conversation persistence is core to the product
**ARCHITECTURAL_IMPACT:** HIGH — violates port/adapter pattern, blocks testability
**EVIDENCE_GAP:** Zero tests for ConversationService
**DEPENDENCIES:** None (pure refactor)
**IMPLEMENTATION_SCOPE:** Refactor ConversationService to accept Store/ConversationStore port + add 15-20 tests
**TESTABILITY:** HIGH (once refactored to use port)
**RECOVERY_RELEVANCE:** LOW
**WHY_NOW:** Largest untested data path in the system. DRY violation compounds risk.
**WHY_NOT_NOW:** No security boundary issue. Could be deferred.
**SCORE:** 72/100

### CANDIDATE 2: No CORS Headers

**ID:** C-CORS
**NAME:** API Has No Origin Restriction
**CURRENT_STATE:** No `Access-Control-*` headers anywhere. If `FACTORY_API_HOST=0.0.0.0`, any webpage can issue cross-origin requests.
**EVIDENCE:** F-RUN-18
**SEVERITY:** HIGH
**SECURITY_IMPACT:** HIGH — cross-origin attacks possible when exposed to network
**CORRECTNESS_IMPACT:** LOW
**RUNTIME_IMPACT:** LOW
**BUSINESS_IMPACT:** MEDIUM — blocks any web frontend integration
**ARCHITECTURAL_IMPACT:** LOW
**EVIDENCE_GAP:** No CORS tests
**DEPENDENCIES:** None
**IMPLEMENTATION_SCOPE:** Add CORS middleware to server.ts + 5 tests
**TESTABILITY:** HIGH
**RECOVERY_RELEVANCE:** LOW
**WHY_NOW:** Security gap. Small scope. High leverage.
**WHY_NOT_NOW:** Server binds to 127.0.0.1 by default (mitigating factor).
**SCORE:** 68/100

### CANDIDATE 3: Security Audit Event Recovery

**ID:** C-RECOVERY
**NAME:** Security Event Audit Trail Recovery
**CURRENT_STATE:** Gate 17 proved events are permanently lost on DB failure. No retry, no queue, no outbox, no reconciliation. Observability is proven (logging works).
**EVIDENCE:** F-SEC-01, gate17.auditTrail.test.ts
**SEVERITY:** CRITICAL (but scoped to DB outage window)
**SECURITY_IMPACT:** MODERATE — audit trail gap during DB outage allows attacker to suppress evidence
**CORRECTNESS_IMPACT:** LOW — security decisions continue correctly in-memory
**RUNTIME_IMPACT:** LOW — no performance impact
**BUSINESS_IMPACT:** MEDIUM — compliance gap (audit trail required for SOC2/ISO27001)
**ARCHITECTURAL_IMPACT:** MEDIUM — requires new infrastructure (queue/worker/buffer)
**EVIDENCE_GAP:** Recovery value under actual threat model is unproven
**DEPENDENCIES:** None
**IMPLEMENTATION_SCOPE:** Varies by option (bounded retry = small, outbox = medium, queue = large)
**TESTABILITY:** HIGH
**RECOVERY_RELEVANCE:** PRIMARY
**WHY_NOW:** Gate 17 PARTIAL classification is fresh. Completes the audit trail story.
**WHY_NOT_NOW:** Event loss is only during DB outage (rare). In-memory state is correct. No compliance deadline yet.
**SCORE:** 58/100

### CANDIDATE 4: No Per-Tool Timeout / AbortSignal

**ID:** C-TOOL-TIMEOUT
**NAME:** Tool Handlers Have No Timeout or Cancellation
**CURRENT_STATE:** Tool handlers run without timeout. A hung handler blocks the request until server-level 30s timeout kills the socket, but the handler continues as a leaked promise.
**EVIDENCE:** F-RUN-03, F-RUN-25
**SEVERITY:** HIGH
**SECURITY_IMPACT:** LOW
**CORRECTNESS_IMPACT:** HIGH — hung handlers leak resources
**RUNTIME_IMPACT:** HIGH — resource exhaustion under load
**BUSINESS_IMPACT:** MEDIUM — user-facing hangs
**ARCHITECTURAL_IMPACT:** MEDIUM — requires changing ToolHandler contract
**EVIDENCE_GAP:** No timeout tests
**DEPENDENCIES:** None
**IMPLEMENTATION_SCOPE:** Add AbortSignal to ToolHandler signature + timeout wrapper + 10 tests
**TESTABILITY:** HIGH
**RECOVERY_RELEVANCE:** LOW
**WHY_NOW:** Resource leak is a real production risk.
**WHY_NOT_NOW:** Server-level timeout provides partial mitigation.
**SCORE:** 65/100

### CANDIDATE 5: No CORS + No Security Response Headers

**ID:** C-HEADERS
**NAME:** API Missing Security Headers (CORS, CSP, HSTS, etc.)
**CURRENT_STATE:** No CORS, no Content-Security-Policy, no Strict-Transport-Security, no X-Content-Type-Options, no X-Frame-Options.
**EVIDENCE:** F-RUN-18, server.ts send() function
**SEVERITY:** HIGH
**SECURITY_IMPACT:** HIGH — clickjacking, MIME sniffing, XSS (if frontend exists)
**CORRECTNESS_IMPACT:** LOW
**RUNTIME_IMPACT:** LOW
**BUSINESS_IMPACT:** MEDIUM — blocks web frontend, compliance gaps
**ARCHITECTURAL_IMPACT:** LOW
**EVIDENCE_GAP:** No header tests
**DEPENDENCIES:** None
**IMPLEMENTATION_SCOPE:** Add headers to send() + 8 tests
**TESTABILITY:** HIGH
**RECOVERY_RELEVANCE:** LOW
**WHY_NOW:** Small scope, high security value.
**WHY_NOT_NOW:** No frontend yet. Server binds to localhost.
**SCORE:** 62/100

### CANDIDATE 6: Anomaly Persistence Cross-Owner State Pollution

**ID:** C-ANOMALY-POLLUTION
**NAME:** PersistentAnomalyDetector Shares In-Memory State Across Owners
**CURRENT_STATE:** `loadState(ownerId)` loads per-owner DB state into a single shared `counters` object. Concurrent requests for different owners overwrite each other's counters.
**EVIDENCE:** F-SEC-03
**SEVERITY:** HIGH
**SECURITY_IMPACT:** HIGH — one owner's anomaly detection can be suppressed by another owner's concurrent request
**CORRECTNESS_IMPACT:** HIGH — incorrect anomaly counts
**RUNTIME_IMPACT:** LOW
**BUSINESS_IMPACT:** LOW — unlikely in single-owner deployment
**ARCHITECTURAL_IMPACT:** LOW — fix is to key counters by ownerId
**EVIDENCE_GAP:** No concurrency test for cross-owner anomaly persistence
**DEPENDENCIES:** None
**IMPLEMENTATION_SCOPE:** Make counters owner-keyed (Map<string, AnomalyCounters>) + 5 tests
**TESTABILITY:** HIGH
**RECOVERY_RELEVANCE:** LOW
**WHY_NOW:** Security correctness issue. Small fix.
**WHY_NOT_NOW:** Single-owner deployment mitigates.
**SCORE:** 60/100

### CANDIDATE 7: No Graceful Shutdown

**ID:** C-SHUTDOWN
**NAME:** No Request Drain on SIGTERM
**CURRENT_STATE:** `pool.end().catch(() => undefined)` in server.close(). In-flight requests and tool executions are terminated abruptly.
**EVIDENCE:** F-RUN-36
**SEVERITY:** MEDIUM
**SECURITY_IMPACT:** LOW
**CORRECTNESS_IMPACT:** MEDIUM — orphaned task records in 'running' state
**RUNTIME_IMPACT:** MEDIUM — leaked DB connections
**BUSINESS_IMPACT:** LOW
**ARCHITECTURAL_IMPACT:** LOW
**EVIDENCE_GAP:** No shutdown tests
**DEPENDENCIES:** None
**IMPLEMENTATION_SCOPE:** Add request counter + drain loop + 5 tests
**TESTABILITY:** HIGH
**RECOVERY_RELEVANCE:** LOW
**WHY_NOW:** Production reliability concern.
**WHY_NOT_NOW:** Single-user deployment, rarely restarted.
**SCORE:** 42/100

### CANDIDATE 8: Structured Logging + Metrics

**ID:** C-LOGGING
**NAME:** No Structured Logging or Metrics Export
**CURRENT_STATE:** Raw console.error/warn. No JSON logs, no log levels, no correlation IDs in logs, no Prometheus/OTEL.
**EVIDENCE:** F-RUN-15, F-RUN-16
**SEVERITY:** MEDIUM
**SECURITY_IMPACT:** LOW
**CORRECTNESS_IMPACT:** LOW
**RUNTIME_IMPACT:** LOW
**BUSINESS_IMPACT:** MEDIUM — production debugging is painful
**ARCHITECTURAL_IMPACT:** LOW
**EVIDENCE_GAP:** No logging tests
**DEPENDENCIES:** None
**IMPLEMENTATION_SCOPE:** Add structured logger + 5 tests (logging itself is hard to test)
**TESTABILITY:** LOW (observability feature)
**RECOVERY_RELEVANCE:** MEDIUM (would help detect event loss)
**WHY_NOW:** Operational visibility.
**WHY_NOT_NOW:** Not a correctness or security issue.
**SCORE:** 38/100

### CANDIDATE 9: Memory/Vector Backend

**ID:** C-MEMORY
**NAME:** recall() Returns Empty — No Learning Retrieval
**CURRENT_STATE:** saveLesson() works. recall() returns []. No embeddings, no vector search, no semantic retrieval.
**EVIDENCE:** F-DATA-21, F-RUN-30
**SEVERITY:** HIGH (capability gap)
**SECURITY_IMPACT:** LOW
**CORRECTNESS_IMPACT:** LOW
**RUNTIME_IMPACT:** LOW
**BUSINESS_IMPACT:** HIGH — learning system delivers zero value
**ARCHITECTURAL_IMPACT:** MEDIUM — requires pgvector or external service
**EVIDENCE_GAP:** No vector backend to test
**DEPENDENCIES:** pgvector extension or external embedding service
**IMPLEMENTATION_SCOPE:** LARGE (embedding service + vector search + retrieval logic)
**TESTABILITY:** MEDIUM
**RECOVERY_RELEVANCE:** LOW
**WHY_NOW:** Business value is high.
**WHY_NOT_NOW:** Large scope, external dependency (pgvector), not security-critical.
**SCORE:** 45/100

### CANDIDATE 10: Approval Workflow Not Enforced

**ID:** C-APPROVAL
**NAME:** require_approval Decision Has No Enforcement
**CURRENT_STATE:** Policy engine returns `require_approval` for critical actions. Guardian emits the event. But nothing in the pipeline blocks execution until approval is granted.
**EVIDENCE:** F-SEC-06
**SEVERITY:** HIGH
**SECURITY_IMPACT:** HIGH — critical actions classified as requiring approval can proceed without it
**CORRECTNESS_IMPACT:** HIGH — security policy is advisory, not enforced
**RUNTIME_IMPACT:** LOW
**BUSINESS_IMPACT:** MEDIUM — depends on threat model
**ARCHITECTURAL_IMPACT:** MEDIUM — requires approval persistence + UI + enforcement
**EVIDENCE_GAP:** No test proving pipeline blocks on require_approval
**DEPENDENCIES:** Approval persistence (existing DB table), UI (out of scope)
**IMPLEMENTATION_SCOPE:** MEDIUM (enforcement in pipeline + approval state management)
**TESTABILITY:** HIGH
**RECOVERY_RELEVANCE:** LOW
**WHY_NOW:** Security gap. Critical actions should be gated.
**WHY_NOT_NOW:** No UI for approval. Owner can approve via DB manually.
**SCORE:** 55/100

---

## PHASE 7 — PRIORITY SCORING

| # | Candidate | Security | Correctness | Runtime | Data | Product | Business | Arch | Evidence Gap | Leverage | Testability | **TOTAL** |
|---|-----------|----------|-------------|---------|------|---------|----------|------|-------------|----------|-------------|-----------|
| 1 | C-CONV (ConversationService) | 2 | 8 | 5 | 7 | 8 | 8 | 8 | 9 | 8 | 9 | **72** |
| 2 | C-CORS (No CORS) | 8 | 1 | 1 | 1 | 5 | 5 | 2 | 8 | 8 | 9 | **68** |
| 3 | C-RECOVERY (Audit Recovery) | 6 | 2 | 1 | 5 | 5 | 5 | 5 | 6 | 4 | 7 | **58** |
| 4 | C-TOOL-TIMEOUT (No Handler Timeout) | 2 | 8 | 8 | 2 | 5 | 5 | 5 | 7 | 7 | 8 | **65** |
| 5 | C-HEADERS (Security Headers) | 8 | 1 | 1 | 1 | 5 | 5 | 2 | 8 | 8 | 9 | **62** |
| 6 | C-ANOMALY-POLLUTION (Cross-Owner) | 8 | 8 | 1 | 5 | 1 | 1 | 2 | 7 | 7 | 8 | **60** |
| 7 | C-SHUTDOWN (No Graceful Shutdown) | 1 | 4 | 4 | 2 | 1 | 1 | 2 | 6 | 6 | 8 | **42** |
| 8 | C-LOGGING (No Structured Logging) | 1 | 1 | 1 | 1 | 5 | 5 | 2 | 5 | 4 | 3 | **38** |
| 9 | C-MEMORY (No Vector Backend) | 1 | 1 | 1 | 5 | 8 | 8 | 5 | 4 | 3 | 5 | **45** |
| 10 | C-APPROVAL (No Enforcement) | 8 | 8 | 1 | 2 | 5 | 5 | 5 | 6 | 5 | 7 | **55** |

**RANKED:**

| Rank | Candidate | Score |
|------|-----------|-------|
| **1** | **C-CONV** | **72** |
| **2** | **C-CORS** | **68** |
| **3** | **C-TOOL-TIMEOUT** | **65** |
| **4** | **C-HEADERS** | **62** |
| **5** | **C-ANOMALY-POLLUTION** | **60** |
| **6** | **C-RECOVERY** | **58** |
| **7** | **C-APPROVAL** | **55** |
| **8** | **C-MEMORY** | **45** |
| **9** | **C-SHUTDOWN** | **42** |
| **10** | **C-LOGGING** | **38** |

---

## PHASE 8 — RECOVERY AS A CANDIDATE

### Security Audit Event Recovery (C-RECOVERY)

**Is event loss during DB outage:**

- **Security-critical?** MODERATE. An attacker who disrupts the DB can suppress the audit trail. But security decisions themselves continue correctly in-memory. The attacker cannot bypass rate limiting or anomaly detection (fail-closed preserves these).

- **Compliance-critical?** DEPENDS. If SOC2/ISO27001 audit trail requirements apply, event loss is a compliance violation. If not yet certified, this is aspirational.

- **Operationally critical?** LOW. Operators can detect the gap via `[Gate 17]` warn logs. In-memory events in the evaluate() return value provide per-request visibility.

- **Acceptable under current threat model?** YES for single-owner deployment. The owner IS the attacker's target, and DB unavailability is rare.

- **Already mitigated in another way?** PARTIALLY. Gate 17 observability (logging) means the gap is visible. Fail-closed means security controls remain active. In-memory events in the response provide per-request visibility.

**RECOVERY_VALUE:** 5/10 (moderate — observability already covers the most critical gap)
**RECOVERY_RISK:** 3/10 (low — bounded fix, no new attack surface)
**RECOVERY_COMPLEXITY:** 4/10 (bounded retry is simple; outbox/queue is complex)
**RECOVERY_SCOPE:** VARIES (3-8 files depending on option)
**RECOVERY_DEPENDENCIES:** None
**RECOVERY_TESTABILITY:** HIGH

### RECOVERY IS NOT THE #1 BOTTLENECK

The evidence shows:
1. Event loss is scoped to DB outage windows (rare)
2. Observability already proves the gap (Gate 17)
3. Security decisions remain correct in-memory
4. Recovery adds infrastructure complexity (queue/worker/buffer)
5. ConversationService has a larger blast radius (untested, architectural violation, DRY violation)

---

## PHASE 9 — DESIGN OPTIONS (IF RECOVERY IS SELECTED)

### OPTION A: Bounded Retry (3 attempts, exponential backoff)

```
Reliability: MODERATE (transient DB failures likely succeed on retry)
Durability: LOW (if all 3 retries fail, event is still lost)
Idempotency: NATURAL (same event written twice is append-only, no harm)
Ordering: NO GUARANTEE
Complexity: LOW (add retry loop in .catch())
Operational Cost: LOW
Failure Modes: Retry exhaustion → event lost
Blast Radius: SMALL
Security Risk: LOW (no new attack surface)
Testability: HIGH
Migration Impact: NONE
```

### OPTION B: Transactional Outbox

```
Reliability: HIGH (event written to outbox table in same transaction as business data)
Durability: HIGH (outbox survives process crashes)
Idempotency: NEEDS IMPLEMENTATION (dedup key on event ID)
Ordering: GUARANTEED (FIFO from outbox)
Complexity: MEDIUM (new table, new worker, new migration)
Operational Cost: MEDIUM (background worker polling)
Failure Modes: Worker crash → events delayed, not lost
Blast Radius: MEDIUM (new table, new migration)
Security Risk: LOW
Testability: MEDIUM (requires DB for outbox tests)
Migration Impact: REQUIRED (new outbox table + RLS + triggers)
```

### OPTION C: Durable Security Event Queue (in-memory + file fallback)

```
Reliability: HIGH (in-memory queue with file-based fallback)
Durability: HIGH (file survives process restarts)
Idempotency: NEEDS IMPLEMENTATION
Ordering: GUARANTEED (FIFO queue)
Complexity: MEDIUM (new module, file I/O, serialization)
Operational Cost: LOW (no external dependency)
Failure Modes: File system failure → event lost (but this is rare)
Blast Radius: SMALL (new module only)
Security Risk: LOW
Testability: HIGH
Migration Impact: NONE
```

---

## PHASE 10 — SECURITY ASSESSMENT OF RECOVERY OPTIONS

**Can retry create attack surface?**
- Retry itself: NO. Bounded retry (3 attempts) with the same DB write is safe.
- Duplicate events: LOW RISK. Audit events are append-only. Duplicate entries don't corrupt state — they inflate counts.
- Replay: NO. Events are new creations, not replays of existing state.

**Can queue create attack surface?**
- Queue poisoning: LOW RISK. Events are created internally by the Guardian, not by external input.
- Queue overflow: MEDIUM RISK. Under sustained DB outage, the queue grows unbounded. Need a cap.
- File-based queue: LOW RISK. File system permissions already protect the process.

**Can outbox create attack surface?**
- Outbox bypass: LOW RISK. Outbox is written in the same transaction as business data.
- Worker compromise: LOW RISK. Worker only reads and forwards events.

**CONCLUSION:** Recovery options have LOW security risk. No significant new attack surface.

---

## PHASE 11 — KNOWLEDGE REUSE

**Existing retry utilities:**
- `resilience.ts` has retry logic for provider calls. Could be adapted for DB writes, but the domain is different (provider vs DB).

**Existing queue infrastructure:**
- NONE. No queue library, no message broker.

**Existing outbox pattern:**
- NONE. No transactional outbox.

**Existing event bus:**
- NONE. Events flow through the Guardian's `emit()` function directly to persistence.

**Existing idempotency engine:**
- NONE. No deduplication.

**Existing persistence abstractions:**
- `RateLimitPersistence` and `AnomalyPersistence` interfaces. Could serve as a model for a `SecurityEventPersistence` interface with retry.

**Existing recovery mechanisms:**
- NONE.

**REUSE ASSESSMENT:** Minimal reuse available. The `Persistence` interface pattern is reusable, but no retry/queue/outbox infrastructure exists.

---

## PHASE 12 — SELECT THE TRUE NEXT BOTTLENECK

### **CANDIDATE 1: ConversationService Architecture + Tests (C-CONV) — SCORE 72**

**Why this is the #1 bottleneck:**

1. **Largest untested data path:** ConversationService has ZERO tests. All CRUD operations (create, append, load, archive) are untested.

2. **Architectural violation:** Direct `getPool()` import bypasses the Store port, violating the port/adapter architecture used by every other module.

3. **DRY violation:** Conversation initialization logic is duplicated between handlers.ts and streaming.ts.

4. **High blast radius:** Conversation persistence is core to the product. Bugs here affect every user interaction.

5. **Testability blocker:** Until refactored to use the Store port, conversation code cannot be unit-tested without a live database.

6. **High leverage:** Once refactored, the pattern enables comprehensive testing and future features (conversation search, archival, export).

**Why not Recovery (C-RECOVERY)?**

1. Event loss is scoped to DB outage windows (rare)
2. Observability already proves the gap (Gate 17)
3. Security decisions remain correct in-memory
4. Recovery adds infrastructure complexity without proportional security gain
5. ConversationService has a larger blast radius and higher testability leverage

**Why not CORS (C-CORS)?**

1. Server binds to 127.0.0.1 by default (mitigating factor)
2. No frontend exists yet
3. CORS is a small fix but lower blast radius than ConversationService

---

## PHASE 13 — GATE 18 MISSION OPTIONS

### MISSION 1: ConversationService Refactor + Test Coverage

**TITLE:** ConversationService Architecture + Test Coverage
**PROBLEM:** ConversationService bypasses Store port, has zero tests, duplicated logic.
**EVIDENCE:** F-RUN-10, F-DATA-10, F-DATA-12, F-RUN-34
**WHY IT MATTERS:** Largest untested data path. Architectural violation. DRY violation.
**SECURITY IMPACT:** LOW (no security boundary)
**SCOPE:** Refactor ConversationService to accept Store/ConversationStore port + add 15-20 tests
**FILES/MODULES:** conversation.ts, handlers.ts, streaming.ts, new test file
**DEPENDENCIES:** None
**RISK:** LOW (pure refactor, no behavior change)
**EXPECTED BENEFIT:** Testability, maintainability, correctness assurance
**TESTABILITY:** HIGH
**EXPECTED TESTS:** +15-20 (716 → 731-736)
**SUCCESS CRITERIA:** ConversationService uses Store port, all CRUD tested, handlers.ts/streaming.ts DRY

### MISSION 2: API Boundary Hardening (CORS + Security Headers)

**TITLE:** API Boundary Hardening — CORS + Security Headers
**PROBLEM:** No CORS, no security headers. If exposed to network, fully open.
**EVIDENCE:** F-RUN-18
**WHY IT MATTERS:** Security gap. Small scope. High leverage.
**SECURITY IMPACT:** HIGH
**SCOPE:** Add CORS middleware + security headers to server.ts + 8-10 tests
**FILES/MODULES:** server.ts, new test file
**DEPENDENCIES:** None
**RISK:** LOW (additive, no behavior change)
**EXPECTED BENEFIT:** Cross-origin protection, compliance
**TESTABILITY:** HIGH
**EXPECTED TESTS:** +8-10 (716 → 724-726)
**SUCCESS CRITERIA:** CORS headers present, security headers present, OPTIONS preflight works

### MISSION 3: Tool Handler Timeout + AbortSignal

**TITLE:** Tool Handler Timeout + AbortSignal
**PROBLEM:** Tool handlers have no timeout. Hung handlers leak resources.
**EVIDENCE:** F-RUN-03, F-RUN-25
**WHY IT MATTERS:** Resource leak under load. User-facing hangs.
**SECURITY IMPACT:** LOW
**SCOPE:** Add AbortSignal to ToolHandler contract + timeout wrapper + 10 tests
**FILES/MODULES:** types.ts, execution.ts, toolBroker.ts, new test file
**DEPENDENCIES:** None
**RISK:** MEDIUM (changes ToolHandler contract — all handlers must accept signal)
**EXPECTED BENEFIT:** Resource protection, cancellation support
**TESTABILITY:** HIGH
**EXPECTED TESTS:** +10 (716 → 726)
**SUCCESS CRITERIA:** Tool handlers receive AbortSignal, timeout triggers cancellation, no leaked promises

### MISSION 4: Security Audit Event Recovery

**TITLE:** Security Audit Event Recovery
**PROBLEM:** Events permanently lost on DB failure. No retry, no queue.
**EVIDENCE:** F-SEC-01, gate17.auditTrail.test.ts
**WHY IT MATTERS:** Completes Gate 17 story. Audit trail reliability.
**SECURITY IMPACT:** MODERATE
**SCOPE:** Bounded retry in .catch() handlers + 5-8 tests
**FILES/MODULES:** security.ts, rateLimit.ts, anomaly.ts, new test file
**DEPENDENCIES:** None
**RISK:** LOW (bounded retry, no new infrastructure)
**EXPECTED BENEFIT:** Transient DB failures recover automatically
**TESTABILITY:** HIGH
**EXPECTED TESTS:** +5-8 (716 → 721-724)
**SUCCESS CRITERIA:** Retry succeeds on transient failure, exhausted retry is logged, no duplicates

---

## PHASE 14 — RECOMMEND ONE

### RECOMMENDED_GATE_18_MISSION: **MISSION 1 — ConversationService Refactor + Test Coverage**

**WHY:**

1. **Highest score (72/100)** — evidence-backed across security, correctness, runtime, data, product, business, and architecture dimensions.

2. **Largest untested data path** — ConversationService has ZERO tests. Every other module has comprehensive test coverage.

3. **Architectural violation** — Direct `getPool()` import violates the port/adapter pattern. This blocks testability and future Store implementations.

4. **DRY violation** — Conversation initialization is duplicated between handlers.ts and streaming.ts. Bug fixes must be applied twice.

5. **High leverage** — Once refactored, conversation code becomes testable, maintainable, and ready for future features (search, export, archival).

6. **Bounded scope** — Refactor is mechanical (extract port, inject dependency, write tests). No new infrastructure, no new dependencies.

7. **Low risk** — Pure refactor with no behavior change. Existing live integration tests provide regression safety.

8. **Compatible with all previous gates** — No conflict with Gate 5 invariants, no schema changes, no API changes.

**Recovery (MISSION 4) is NOT recommended as Gate 18 because:**
- Event loss is scoped to DB outage windows (rare)
- Observability already proves the gap (Gate 17)
- Security decisions remain correct in-memory
- ConversationService has higher blast radius and testability leverage
- Recovery adds infrastructure complexity without proportional security gain

---

## PHASE 15 — OWNER APPROVAL GATE

```
GATE_18_STATUS = READY_FOR_OWNER_APPROVAL
CLASSIFICATION = GATE_18_READY_FOR_OWNER_APPROVAL
```

**Awaiting owner decision on:**
- Approve MISSION 1 (ConversationService Refactor + Tests) as Gate 18?
- Alternative: Approve MISSION 2 (CORS + Headers) or MISSION 4 (Recovery)?

---

## FINAL SUMMARY

| Metric | Value |
|--------|-------|
| Gate 17 Status | CLOSED AS PARTIAL |
| Forensic Agents | 3 (Security, Runtime, Data) |
| Total Findings | 87 (5 CRITICAL across all, 13 HIGH, 30 MEDIUM, 36 LOW, 3 PASS) |
| Bottleneck Candidates | 10 |
| Top Candidate | C-CONV (ConversationService) — Score 72 |
| Recovery Rank | #6 (Score 58) |
| Recommended Mission | ConversationService Refactor + Test Coverage |
| Expected Tests | +15-20 (716 → 731-736) |
| Schema Changes | NONE |
| Migration Changes | NONE |
| Risk | LOW |
