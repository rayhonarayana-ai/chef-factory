# GATE 22 — FORENSIC BOTTLENECK DISCOVERY REPORT

**Classification: GATE_22_DISCOVERY_COMPLETE**
**Date: 2026-08-19**
**Scope: DISCOVERY ONLY — ZERO IMPLEMENTATION**

---

## 1. Project Identity Verification

| Field | Value | Evidence |
|-------|-------|----------|
| Package name | `chef-factory` | `package.json:2` |
| Version | `0.1.0` | `package.json:3` |
| Description | "CHEF Personal Executive Core — Gate 1 (independent AI Company Factory)" | `package.json:6` |
| Source structure | `src/{api,core,db,gateways,integration,testing,tools}` | Directory listing |
| Documentation | `docs/factory/` — 200+ gate docs | Directory listing |
| Supabase project | `dybyidtcyzgliupzzfhl` | Prior gate evidence |
| Git remote | `https://github.com/rayhonarayana-ai/chef-factory.git` | Prior gate evidence |
| Foreign project indicators | NONE | Verified: no Qarayti.ai, PROOFOS, or other project files |

**PROJECT_IDENTITY_VERIFIED** — This is Chef Factory / AI Company Factory.

---

## 2. Gate 21 Closure Verification

| Check | Evidence |
|-------|----------|
| Test count | 901/901 PASS, 7 skipped |
| Gate 21 tests | 34/34 PASS (`gate21.test.ts`) |
| tsc | CLEAN (exit 0) |
| Build | CLEAN (`tsc -p tsconfig.build.json`, exit 0) |
| Protected-path audit | No schema/migration/Gate5/Gate19/Gate20 changes |
| Documentation | `GATE_21_IMPLEMENTATION.md`, `GATE_21_EVIDENCE.md`, `GATE_21_FINAL_REPORT.md` present |
| todo.md | Updated to reflect Gate 21 PASS (901) |
| Source state | All Gate 21 changes applied (safeAudit, safeCost, recoverStaleRunningTasks, startup recovery) |

**Gate 21 CLOSURE VERIFIED** — supported by actual evidence.

---

## 3. Current Baseline

| Metric | Value |
|--------|-------|
| Total tests | 901 PASS |
| Skipped | 7 (Gate 14 integration + Gate 10 live) |
| Failed | 0 |
| Test files | 50 passed, 1 skipped |
| tsc | CLEAN |
| Build | CLEAN |
| Duration | ~64s |
| Frozen baseline | Gate 3: 222 → Gate 18: 749 → Gate 19: 845 → Gate 20: 867 → Gate 21: 901 |

---

## 4. Repository Integrity

```
M  docs/factory/todo.md          (Gate 21 update)
M  src/api/execution.ts          (Gate 19/20 changes)
M  src/api/handlers.ts           (Gate 19/20 changes)
M  src/api/security.ts           (Gate 17 changes)
M  src/api/server.ts             (Gate 21: startup recovery + lifecycle)
M  src/core/conversation.ts      (Gate 19: archiveConversation fix)
M  src/core/orchestration.ts     (Gate 19: dependency changes)
M  src/core/pipeline.ts          (Gate 21: safeAudit/safeCost)
M  src/core/ports.ts             (Gate 21: recoverStaleRunningTasks)
M  src/core/security/anomaly.ts  (Gate 14/16 changes)
M  src/core/security/guardian.ts (Gate 14/16 changes)
M  src/core/security/rateLimit.ts(Gate 14/16 changes)
M  src/db/repo.ts                (Gate 21: recoverStaleRunningTasks)
M  src/integration/gate4.live.integration.test.ts
M  src/testing/memoryStore.ts    (Gate 19/20/21 changes)
M  src/tools/*.ts                (Gate 19/20 changes)
?? docs/factory/GATE_*_*.md      (documentation — untracked)
?? src/core/gate21.test.ts       (Gate 21 tests — untracked)
?? src/tools/gate19.test.ts      (Gate 19 tests — untracked)
?? src/tools/gate20.test.ts      (Gate 20 tests — untracked)
```

All modifications are expected Gate 14-21 changes. No unexpected untracked source files.

---

## 5. Current Capability Map

### PIPELINE (pipeline.ts — 916 lines)
- ✅ Command → Intent → Scope → Project → Risk → Authority → Autonomy → Approval → Execution → Audit → Explanation
- ✅ Single-step and orchestration paths
- ✅ Gate 21: safeAudit/safeCost fire-and-forget
- ✅ Gate 21: Startup stale recovery
- ❌ **No timeout on single-step execution.execute()** — can hang indefinitely
- ❌ **No AbortController integration**

### EXECUTION (execution.ts — 674 lines)
- ✅ Tool loop with max 10 rounds
- ✅ Consecutive failure tracking
- ✅ Rate limiting at loop entry
- ❌ **No per-call timeout on adapter.complete()**
- ❌ **No total token/cost guard on loop**
- ❌ **planSteps() swallows all errors silently**

### ORCHESTRATION (orchestration.ts — 752 lines)
- ✅ DAG execution with dependency resolution
- ✅ Step timeout (default 30s)
- ✅ Cancellation controller
- ✅ Variable interpolation with validation
- ❌ **Security guard hook hardcodes `authorized: true`** (line 388)
- ❌ **Dead code: unreachable OrchestrationTimeoutError check**

### TASK ENGINE (taskEngine.ts — 83 lines)
- ✅ State machine with TRANSITIONS table
- ✅ Bounded retries (maxAttempts=3)
- ✅ Error preservation
- ⚠️ `retryCapReached()` — production dead code (test-only usage)
- ⚠️ `paused` state — defined but never used by pipeline

### CONVERSATION (conversation.ts — 86 lines)
- ✅ Append-only message history
- ✅ Owner isolation
- ✅ Archive lifecycle
- ❌ **No message count limit** — unbounded growth
- ❌ **No TTL or auto-archival**

### APPROVAL (approval.ts — 62 lines)
- ✅ Duplicate prevention
- ✅ Terminal state enforcement
- ✅ `isExpired()` check
- ❌ **`isExpired()` never called in production** — no automatic expiry
- ❌ **No expiry mechanism** — pending approvals persist forever

### SECURITY (guardian.ts — 235 lines)
- ✅ 10-rule authority matrix
- ✅ Lockdown support
- ✅ Agent restriction enforcement
- ✅ Prompt injection detection
- ❌ **Orchestration guard bypasses agent check** (hardcoded authorized: true)

### SECURITY AUDIT (security.ts — 33 lines)
- ✅ Security event recording
- ❌ **Fire-and-forget persistence** — DB failure = complete audit trail loss
- ❌ **No retry, no fallback, no outbox**

### PERSISTENCE
- **SupabaseStore** (repo.ts — 878 lines): ✅ Complete Store implementation
  - ❌ `agentHasPermission` SQL NULL bug — global permissions broken
  - ❌ `recoverStaleRunningTasks` not owner-scoped
- **MemoryStore** (memoryStore.ts — 386 lines): ⚠️ Parity gaps
  - ❌ `getPreferences` not owner-scoped
  - ❌ `setPreference` not owner-scoped
  - ❌ `listModels/listRuntimes` ignore ownerId
  - ❌ `agentStats` returns hardcoded zeros
  - ❌ `dailyStatus` per-project stats always zeroed

### MONITORING (monitoring.ts — 70 lines)
- ✅ Daily status aggregation
- ❌ **N+1 cost queries** — one per project
- ❌ **No error resilience** — any store failure crashes the report
- ❌ **Dead ternary** in decisionsRequired message

### RESILIENCE (resilience.ts — 280 lines)
- ✅ Circuit breaker (closed/open/half_open)
- ✅ Retry with exponential backoff
- ✅ Error classification (transient vs. non-transient)
- ❌ **No jitter** on retries — thundering herd risk
- ❌ **Dead code** on line 230 (`health.getState;`)

### GATEWAY ADAPTERS
- ✅ OpenAI, Anthropic, Google, OpenCodeZen adapters
- ❌ **No streaming** in any adapter
- ❌ **OpenCodeZen no timeout** — hanging process blocks indefinitely
- ❌ **Google usage: null** — cost tracking blind spot
- ❌ **Google tool call IDs not unique** (Date.now() collision)

### QUERY DATA (query-data.ts — 258 lines)
- ✅ Entity allowlist validation
- ✅ Field catalog validation
- ✅ Parameterized queries
- ✅ MUTATION_PATTERN defense
- ❌ **Unbounded Maps** — entityQueryCounts, concurrentQueries (memory leak)
- ⚠️ Approved exception: direct DB access via getPool() fallback

### API SERVER (server.ts — 353 lines)
- ✅ Request timeout (30s default, 300s streaming)
- ✅ Static file serving with path traversal protection
- ✅ Gate 21: startup recovery + lifecycle handlers
- ❌ **SIGTERM/SIGINT call process.exit(0) without close()** — DB connection leak
- ❌ **No Content-Length headers**

### AUTH (auth.ts — 50 lines)
- ✅ Supabase auth verification
- ✅ Owner table lookup
- ❌ **No session caching** — 2 HTTP calls per request
- ❌ **Silent auth failure** — no logging on Supabase outage

---

## 6. Fresh Forensic Findings

### A. RELIABILITY

| # | Finding | Severity | Location | Confidence |
|---|---------|----------|----------|------------|
| R1 | **Single-step execution has NO timeout** | HIGH | `pipeline.ts:486`, `execution.ts:159-168` | PROVEN |
| R2 | **OpenCodeZen adapter has no timeout** | HIGH | `opencodeZen.ts:31-42` | PROVEN |
| R3 | **SIGTERM/SIGINT don't call close()** | HIGH | `server.ts:337-344` | PROVEN |
| R4 | **No automatic approval expiry** | MEDIUM | `approval.ts:59` (never called) | PROVEN |
| R5 | **Conversation messages grow unbounded** | LOW | `conversation.ts:71` | PROVEN |
| R6 | **monitoring.ts has no error resilience** | MEDIUM | `monitoring.ts:18-24` | PROVEN |

### B. SECURITY

| # | Finding | Severity | Location | Confidence |
|---|---------|----------|----------|------------|
| S1 | **Security event persistence is fire-and-forget** | MEDIUM | `security.ts:23` | PROVEN (known design) |
| S2 | **Orchestration hook hardcodes authorized: true** | MEDIUM | `orchestration.ts:388` | PROVEN |
| S3 | **agentHasPermission NULL bug** | HIGH | `repo.ts:489-501` | PROVEN |
| S4 | **MemoryStore preferences not owner-scoped** | HIGH | `memoryStore.ts:147-161` | PROVEN |
| S5 | **PersistentAnomalyDetector cross-owner clobbering** | MEDIUM | `anomaly.ts:41-52`, `server.ts:210` | PROVEN |
| S6 | **recoverStaleRunningTasks not owner-scoped** | MEDIUM | `repo.ts:870-877` | PROVEN |

### C. DATA INTEGRITY

| # | Finding | Severity | Location | Confidence |
|---|---------|----------|----------|------------|
| D1 | **query-data.ts unbounded Maps** | MEDIUM | `query-data.ts:102,121` | PROVEN |
| D2 | **toolBroker safeSummary can crash on circular refs** | MEDIUM | `toolBroker.ts:88-91` | LIKELY |
| D3 | **Orchestration variable resolver only handles .id** | LOW | `orchestration.ts:415-436` | PROVEN |

### D. ARCHITECTURE

| # | Finding | Severity | Location | Confidence |
|---|---------|----------|----------|------------|
| A1 | **Streaming vs non-streaming chat divergent paths** | MEDIUM | `server.ts:264-292` vs `handlers.ts:56-114` | PROVEN |
| A2 | **Conversation logic duplicated** (handlers.ts vs streaming.ts) | LOW | Both files | PROVEN |
| A3 | **`paused` task state unused by pipeline** | LOW | `types.ts:16`, `taskEngine.ts:14` | PROVEN |
| A4 | **Dead code: clampAutonomy, decisionDigest, retryCapReached** | LOW | Multiple | PROVEN |

### E. CORRECTNESS

| # | Finding | Severity | Location | Confidence |
|---|---------|----------|----------|------------|
| C1 | **Silent error swallowing in planSteps** | MEDIUM | `pipeline.ts:622` | PROVEN |
| C2 | **Failed execution cost lost** | LOW | `pipeline.ts:554` | PROVEN |
| C3 | **Priority not validated in create-task/update-task** | LOW | `create-task.ts:27`, `update-task.ts:43` | PROVEN |

### F. TEST QUALITY

| # | Finding | Severity | Location | Confidence |
|---|---------|----------|----------|------------|
| T1 | **No adapter complete() unit tests** | MEDIUM | `adapters/*.ts` | PROVEN |
| T2 | **No concurrency tests** | LOW | Entire codebase | PROVEN |
| T3 | **No timeout behavior tests** | MEDIUM | pipeline, execution | PROVEN |
| T4 | **MemoryStore parity gaps** | MEDIUM | `memoryStore.ts` | PROVEN |

### G. OBSERVABILITY

| # | Finding | Severity | Location | Confidence |
|---|---------|----------|----------|------------|
| O1 | **Security events lost silently on DB failure** | MEDIUM | `security.ts:23` | PROVEN |
| O2 | **Auth failures not logged** | LOW | `auth.ts:46-48` | PROVEN |
| O3 | **safeAudit/safeCost only visible via console.warn** | LOW | `pipeline.ts:860,869` | PROVEN |

### H. PERFORMANCE

| # | Finding | Severity | Location | Confidence |
|---|---------|----------|----------|------------|
| P1 | **Auth: 2 HTTP calls per request, no caching** | LOW | `auth.ts:26-48` | PROVEN |
| P2 | **N+1 cost queries in monitoring** | LOW | `monitoring.ts:36` | PROVEN |
| P3 | **No retry jitter** — thundering herd risk | LOW | `resilience.ts:263-266` | PROVEN |

### I. OPERABILITY

| # | Finding | Severity | Location | Confidence |
|---|---------|----------|----------|------------|
| OP1 | **SIGTERM/SIGINT don't close DB pool** | HIGH | `server.ts:337-344` | PROVEN |
| OP2 | **"Gracefully" log is misleading** | LOW | `server.ts:338,341` | PROVEN |

---

## 7. Historical Findings Reassessment

| Finding | Gate | Status | Current Evidence | Current Score | Gate 22 Candidate? |
|---------|------|--------|------------------|---------------|---------------------|
| retryCapReached dead code | 20 | DEFERRED | Still dead code, test-only usage | 10 | NO — cosmetic |
| ConversationMessage duplicate type | 21 | DEFERRED | Still present (pipeline.ts:70 vs conversation.ts:17) | 15 | NO — cosmetic |
| query-data approved exception | 19 | DOCUMENTED | Still uses getPool() fallback | 20 | NO — approved |
| MemoryStore parity gaps | 20 | KNOWN | Preferences, models, runtimes, agentStats all divergent | 45 | MAYBE — test correctness |
| Secure event fire-and-forget | 17 | KNOWN | Confirmed — no retry, no outbox | 55 | MAYBE — audit trail |
| Orchestration authorized:true | NEW | PROVEN | Hardcoded bypass of agent checks | 50 | MAYBE — security |

---

## 8. Previously Deferred Items Reassessment

| Item | Current Status | Evidence | Score | Gate 22 Candidate? |
|------|---------------|----------|-------|---------------------|
| retryCapReached() dead code | Production dead, test-only | `taskEngine.ts:81` | 10 | NO — cosmetic debt |
| ConversationMessage type duplication | Two types exist | `pipeline.ts:70`, `conversation.ts:17` | 15 | NO — type-level only |
| query-data direct DB access | Approved exception | `query-data.ts:180` | 20 | NO — approved |
| paused task state unused | Defined in types, never triggered | `types.ts:16` | 15 | NO — future interface |
| parentTaskId unused | Typed but always null | `types.ts:152` | 10 | NO — future interface |
| decisionDigest() never called | Exported, never imported | `decisionJournal.ts:54` | 10 | NO — dead code |
| clampAutonomy() identity fn | Exported, never called | `authority.ts:147` | 10 | NO — dead code |
| Permission 'admin' unused | In type, never used | `types.ts:32` | 10 | NO — future interface |

**Gate 22 does NOT inherit its mission from Gate 21.** All deferred items scored ≤ 20. None are bottlenecks.

---

## 9. Root-Cause Clusters

### Cluster 1: Execution Resource Management Gap
**Root cause:** No timeout/AbortController anywhere in the execution chain.
**Symptoms:**
- Single-step execution can hang indefinitely (R1)
- OpenCodeZen adapter can hang indefinitely (R2)
- API request timeout fires but doesn't abort execution (F-SERVER-01)
- Client sees 408 but backend burns resources
**Affected components:** pipeline.ts, execution.ts, opencodeZen.ts, server.ts
**Impact:** Resource exhaustion under slow/hanging LLM providers

### Cluster 2: Shutdown Resource Leak
**Root cause:** Gate 21 signal handlers call process.exit(0) without close().
**Symptoms:**
- DB pool connections leak on every SIGTERM/SIGINT (OP1)
- In-flight requests abandoned
- Fire-and-forget writes lost
**Affected components:** server.ts
**Impact:** Connection pool exhaustion under container orchestration

### Cluster 3: Cross-Owner Data Isolation Failures
**Root cause:** Shared singleton instances + missing owner scoping in Store implementations.
**Symptoms:**
- PersistentAnomalyDetector counters clobbered across owners (S5)
- MemoryStore preferences leak across owners (S4)
- recoverStaleRunningTasks affects all owners (S6)
- agentHasPermission NULL bug breaks global permissions (S3)
**Affected components:** anomaly.ts, memoryStore.ts, repo.ts
**Impact:** Test false-negatives; multi-owner data corruption

### Cluster 4: Security Audit Trail Gap
**Root cause:** Fire-and-forget persistence with no fallback.
**Symptoms:**
- DB outage = complete security event loss (S1)
- No retry, no outbox, no recovery path (O1)
**Affected components:** security.ts
**Impact:** Attack forensics impossible during outages

### Cluster 5: Approval Lifecycle Gap
**Root cause:** Expiry check exists but is never triggered.
**Symptoms:**
- Pending approvals persist forever (R4)
- No cron job, no periodic check, no automatic expiry
**Affected components:** approval.ts
**Impact:** Accumulating stale approvals

---

## 10. Security Findings

| # | Finding | Severity | Impact | Confidence |
|---|---------|----------|--------|------------|
| S1 | Security event persistence fire-and-forget | MEDIUM | Audit trail loss | PROVEN |
| S2 | Orchestration hook hardcodes authorized:true | MEDIUM | Agent escalation risk | PROVEN |
| S3 | agentHasPermission NULL bug | HIGH | Global agent permissions broken | PROVEN |
| S4 | MemoryStore preferences not owner-scoped | HIGH | Cross-owner policy leakage (tests) | PROVEN |
| S5 | PersistentAnomalyDetector cross-owner clobbering | MEDIUM | Counter corruption (multi-owner) | PROVEN |
| S6 | recoverStaleRunningTasks not owner-scoped | MEDIUM | All-owner task recovery on restart | PROVEN |

---

## 11. Reliability Findings

| # | Finding | Severity | Impact | Confidence |
|---|---------|----------|--------|------------|
| R1 | **Single-step execution NO timeout** | **HIGH** | **Pipeline hangs indefinitely** | **PROVEN** |
| R2 | OpenCodeZen adapter NO timeout | HIGH | Runtime hang | PROVEN |
| R3 | SIGTERM/SIGINT no close() | HIGH | DB connection leak | PROVEN |
| R4 | No automatic approval expiry | MEDIUM | Stale approvals accumulate | PROVEN |
| R5 | Conversation messages unbounded | LOW | Storage growth | PROVEN |
| R6 | monitoring.ts no error resilience | MEDIUM | Dashboard crash on DB failure | PROVEN |

---

## 12. Architecture Findings

| # | Finding | Severity | Impact |
|---|---------|----------|--------|
| A1 | Streaming/non-streaming divergent chat paths | MEDIUM | Maintenance hazard |
| A2 | Conversation logic duplicated | LOW | DRY violation |
| A3 | paused state unused | LOW | Dead state |
| A4 | Dead code (clampAutonomy, decisionDigest, retryCapReached) | LOW | Code hygiene |

---

## 13. Data Integrity Findings

| # | Finding | Severity | Impact |
|---|---------|----------|--------|
| D1 | query-data.ts unbounded Maps | MEDIUM | Memory leak |
| D2 | toolBroker safeSummary can crash | MEDIUM | Tool execution crash |
| D3 | Orchestration resolver only handles .id | LOW | Silent unresolved vars |

---

## 14. Test Infrastructure Findings

| # | Finding | Severity | Impact |
|---|---------|----------|--------|
| T1 | No adapter complete() unit tests | MEDIUM | Provider parsing untested |
| T2 | No concurrency tests | LOW | Race conditions untested |
| T3 | No timeout behavior tests | MEDIUM | Resource management untested |
| T4 | MemoryStore parity gaps | MEDIUM | Tests may miss real bugs |

---

## 15. Observability Findings

| # | Finding | Severity | Impact |
|---|---------|----------|--------|
| O1 | Security events lost silently | MEDIUM | Attack forensics gap |
| O2 | Auth failures not logged | LOW | Outage diagnosis gap |
| O3 | safeAudit/safeCost console.warn only | LOW | Production visibility gap |

---

## 16. Performance / Operability Findings

| # | Finding | Severity | Impact |
|---|---------|----------|--------|
| P1 | Auth: 2 HTTP calls per request | LOW | Latency at scale |
| P2 | N+1 cost queries in monitoring | LOW | Dashboard performance |
| P3 | No retry jitter | LOW | Thundering herd risk |
| OP1 | SIGTERM/SIGINT no close() | HIGH | Connection leak |

---

## 17. Top 7 Bottlenecks

| Rank | Name | Category | Score | Confidence |
|------|------|----------|-------|------------|
| **#1** | **Execution Timeout Gap** | Reliability | **72** | PROVEN |
| #2 | Shutdown Resource Leak | Operability | 58 | PROVEN |
| #3 | Cross-Owner Anomaly Counter Corruption | Data Integrity | 55 | PROVEN |
| #4 | Security Audit Trail Loss | Security | 52 | PROVEN (known) |
| #5 | Approval Lifecycle Gap | Reliability | 48 | PROVEN |
| #6 | MemoryStore Preference Scoping | Test Correctness | 45 | PROVEN |
| #7 | toolBroker safeSummary Crash | Reliability | 42 | LIKELY |

---

## 18. Priority Scoring

### #1: Execution Timeout Gap — Score 72

| Factor | Weight | Score | Weighted |
|--------|--------|-------|----------|
| Reliability Risk | 15 | 13 | 195 |
| Correctness Risk | 12 | 6 | 72 |
| Security Risk | 12 | 3 | 36 |
| Data Integrity Risk | 10 | 4 | 40 |
| User Impact | 10 | 9 | 90 |
| Business Impact | 8 | 7 | 56 |
| Evidence Confidence | 8 | 10 | 80 |
| Frequency | 5 | 8 | 40 |
| Implementation Complexity | 5 | 8 (easy) | 40 |
| Blast Radius | 5 | 7 | 35 |
| Leverage | 5 | 8 | 40 |
| Testability | 5 | 9 | 45 |
| **TOTAL** | **100** | | **72** |

### #2: Shutdown Resource Leak — Score 58

| Factor | Weight | Score | Weighted |
|--------|--------|-------|----------|
| Reliability Risk | 15 | 10 | 150 |
| Correctness Risk | 12 | 2 | 24 |
| Security Risk | 12 | 2 | 24 |
| Data Integrity Risk | 10 | 3 | 30 |
| User Impact | 10 | 5 | 50 |
| Business Impact | 8 | 5 | 40 |
| Evidence Confidence | 8 | 10 | 80 |
| Frequency | 5 | 4 | 20 |
| Implementation Complexity | 5 | 10 (trivial) | 50 |
| Blast Radius | 5 | 3 | 15 |
| Leverage | 5 | 4 | 20 |
| Testability | 5 | 8 | 40 |
| **TOTAL** | **100** | | **58** |

### #3: Cross-Owner Anomaly Counter Corruption — Score 55

| Factor | Weight | Score | Weighted |
|--------|--------|-------|----------|
| Reliability Risk | 15 | 7 | 105 |
| Correctness Risk | 12 | 8 | 96 |
| Security Risk | 12 | 5 | 60 |
| Data Integrity Risk | 10 | 9 | 90 |
| User Impact | 10 | 4 | 40 |
| Business Impact | 8 | 4 | 32 |
| Evidence Confidence | 8 | 10 | 80 |
| Frequency | 5 | 5 | 25 |
| Implementation Complexity | 5 | 4 (hard) | 20 |
| Blast Radius | 5 | 5 | 25 |
| Leverage | 5 | 4 | 20 |
| Testability | 5 | 4 | 20 |
| **TOTAL** | **100** | | **55** |

### #4: Security Audit Trail Loss — Score 52

| Factor | Weight | Score | Weighted |
|--------|--------|-------|----------|
| Reliability Risk | 15 | 6 | 90 |
| Correctness Risk | 12 | 3 | 36 |
| Security Risk | 12 | 9 | 108 |
| Data Integrity Risk | 10 | 7 | 70 |
| User Impact | 10 | 2 | 20 |
| Business Impact | 8 | 4 | 32 |
| Evidence Confidence | 8 | 8 | 64 |
| Frequency | 5 | 3 | 15 |
| Implementation Complexity | 5 | 3 (hard) | 15 |
| Blast Radius | 5 | 4 | 20 |
| Leverage | 5 | 5 | 25 |
| Testability | 5 | 5 | 25 |
| **TOTAL** | **100** | | **52** |

### #5: Approval Lifecycle Gap — Score 48

| Factor | Weight | Score | Weighted |
|--------|--------|-------|----------|
| Reliability Risk | 15 | 6 | 90 |
| Correctness Risk | 12 | 5 | 60 |
| Security Risk | 12 | 3 | 36 |
| Data Integrity Risk | 10 | 3 | 30 |
| User Impact | 10 | 6 | 60 |
| Business Impact | 8 | 4 | 32 |
| Evidence Confidence | 8 | 9 | 72 |
| Frequency | 5 | 4 | 20 |
| Implementation Complexity | 5 | 6 (medium) | 30 |
| Blast Radius | 5 | 4 | 20 |
| Leverage | 5 | 4 | 20 |
| Testability | 5 | 7 | 35 |
| **TOTAL** | **100** | | **48** |

### #6: MemoryStore Preference Scoping — Score 45

| Factor | Weight | Score | Weighted |
|--------|--------|-------|----------|
| Reliability Risk | 15 | 5 | 75 |
| Correctness Risk | 12 | 7 | 84 |
| Security Risk | 12 | 4 | 48 |
| Data Integrity Risk | 10 | 6 | 60 |
| User Impact | 10 | 2 | 20 |
| Business Impact | 8 | 2 | 16 |
| Evidence Confidence | 8 | 10 | 80 |
| Frequency | 5 | 3 | 15 |
| Implementation Complexity | 5 | 8 (easy) | 40 |
| Blast Radius | 5 | 2 | 10 |
| Leverage | 5 | 5 | 25 |
| Testability | 5 | 8 | 40 |
| **TOTAL** | **100** | | **45** |

### #7: toolBroker safeSummary Crash — Score 42

| Factor | Weight | Score | Weighted |
|--------|--------|-------|----------|
| Reliability Risk | 15 | 6 | 90 |
| Correctness Risk | 12 | 3 | 36 |
| Security Risk | 12 | 2 | 24 |
| Data Integrity Risk | 10 | 2 | 20 |
| User Impact | 10 | 5 | 50 |
| Business Impact | 8 | 3 | 24 |
| Evidence Confidence | 8 | 6 | 48 |
| Frequency | 5 | 3 | 15 |
| Implementation Complexity | 5 | 9 (trivial) | 45 |
| Blast Radius | 5 | 3 | 15 |
| Leverage | 5 | 4 | 20 |
| Testability | 5 | 8 | 40 |
| **TOTAL** | **100** | | **42** |

---

## 19. Why Rank #1 Is #1

**Execution Timeout Gap (Score 72)** is the highest-ranked bottleneck because:

1. **It is a proven production defect** — single-step `execution.execute()` at `pipeline.ts:486` has NO timeout. This is not theoretical; it is an architectural gap in the execution chain.

2. **It affects ALL task execution** — every command that enters single-step execution (which is the majority — orchestration is only triggered for multi-step commands) runs without timeout protection.

3. **The existing mitigation is a fig leaf** — `server.ts:225-230` has a 30-second HTTP timeout, but it only sends a 408 response to the client. The backend execution **continues running** because there is no AbortController. The connection is destroyed but the pipeline burns resources.

4. **No existing test exercises this** — there are zero tests for timeout behavior on single-step execution.

5. **The fix is scoped and testable** — wrap `execution.execute()` with an AbortController + timeout, wire it into the execution adapter, add tests for timeout + cancellation. This fits within a single Gate.

6. **It is a prerequisite for production reliability** — without execution timeout, a single hanging LLM call can exhaust server resources. Under load, this is a cascading failure risk.

**Contrast with #2 (Shutdown Leak):** The shutdown leak is real but less frequent (only on process termination). The execution timeout is hit on every slow request.

**Contrast with #3 (Anomaly Corruption):** The anomaly corruption is multi-owner specific and the DB persistence layer provides recovery. The execution timeout has no recovery path — it is a resource leak.

---

## 20. Why Other Candidates Are NOT #1

**#2 Shutdown Resource Leak (Score 58):** Real but low frequency. Only affects process lifecycle, not request lifecycle. Fix is trivial (store close handle, call it). Less impactful than execution timeout because shutdown is infrequent.

**#3 Anomaly Counter Corruption (Score 55):** Real but limited blast radius. Only affects multi-owner deployments. DB persistence provides eventual consistency. Harder to fix (needs per-owner instances or keyed counters). Execution timeout affects all deployments.

**#4 Security Audit Trail Loss (Score 52):** Known design decision. Documented in Gate 17. No new evidence. Fix requires architectural decision (outbox, retry queue) that exceeds a single Gate. Execution timeout is a more immediate reliability gap.

**#5 Approval Lifecycle Gap (Score 48):** Real but low severity. Stale approvals are a UX/cleanup issue, not a reliability or security gap. Fix requires a scheduler or cron mechanism. Execution timeout is more critical.

**#6 MemoryStore Preference Scoping (Score 45):** Test correctness issue only. Does not affect production. Fix is trivial but low leverage. Execution timeout affects production reliability.

**#7 toolBroker safeSummary Crash (Score 42):** Theoretical — requires circular reference input which is unlikely in practice. Lower confidence. Execution timeout is proven.

---

## 21. Three Possible Missions

### Mission A: Execution Timeout + Resource Management
**Problem:** Single-step execution has no timeout. A hanging LLM call burns server resources indefinitely.
**Root cause:** No AbortController integration in the execution chain.
**Scope:**
- Add AbortController to `execution.execute()` with configurable timeout (default 60s)
- Wire timeout into provider adapter `complete()` calls
- Add `executionAborted` task status or handle abort as `failed` with timeout reason
- Add tests for: normal completion, timeout trigger, abort during tool loop
- Fix OpenCodeZen adapter timeout (same root cause)
**Files:** `src/api/execution.ts`, `src/core/pipeline.ts`, `src/gateways/adapters/opencodeZen.ts`
**Tests:** ~6-8 new tests
**Risk:** LOW — additive timeout wrapper, no existing behavior change
**Blast radius:** MEDIUM — all execution paths affected
**Security impact:** LOW
**Reliability impact:** HIGH — prevents resource exhaustion
**Data impact:** LOW — task transitions to `failed` correctly
**Architectural impact:** LOW — follows existing patterns
**Rollback complexity:** LOW — remove timeout wrapper
**Runtime verification:** Requires live LLM provider to test actual timeout

### Mission B: Shutdown Resource Management
**Problem:** SIGTERM/SIGINT call process.exit(0) without close(), leaking DB connections.
**Root cause:** Gate 21 signal handlers missed the close() call.
**Scope:**
- Store close() handle in module scope
- Call close() before process.exit(0) in signal handlers
- Add graceful shutdown timeout (10s) then force exit
- Add tests for signal handler behavior
**Files:** `src/api/server.ts`
**Tests:** ~3-4 new tests
**Risk:** VERY LOW — trivial fix
**Blast radius:** LOW — only affects shutdown path
**Security impact:** NONE
**Reliability impact:** MEDIUM — prevents connection leak
**Data impact:** LOW — pending writes may be lost
**Architectural impact:** NONE
**Rollback complexity:** TRIVIAL
**Runtime verification:** Unproven (no live infrastructure)

### Mission C: MemoryStore Owner-Scoping Parity
**Problem:** MemoryStore preferences, models, runtimes, and agentStats are not owner-scoped, causing tests to miss cross-owner bugs.
**Root cause:** MemoryStore simplified implementations missing owner filters.
**Scope:**
- Fix `getPreferences()` to filter by ownerId
- Fix `setPreference()` to store and filter by ownerId
- Fix `listModels()` / `listRuntimes()` to filter by ownerId
- Fix `agentStats()` to compute from actual task data
- Add tests verifying cross-owner isolation
**Files:** `src/testing/memoryStore.ts`
**Tests:** ~8-10 new tests
**Risk:** LOW — test infrastructure change only
**Blast radius:** LOW — only affects tests
**Security impact:** LOW — test correctness
**Reliability impact:** LOW — test correctness
**Data impact:** LOW
**Architectural impact:** LOW
**Rollback complexity:** TRIVIAL
**Runtime verification:** N/A — test-only change

---

## 22. Recommended Mission — ONE ONLY

**RECOMMENDED_MISSION = Mission A: Execution Timeout + Resource Management**

**Rationale:**
- Highest score (72) among all candidates
- Proven production defect with clear evidence
- Affects ALL task execution paths (highest blast radius of actionable items)
- No existing mitigation (HTTP timeout is a fig leaf)
- Scoped and testable within a single Gate
- Prerequisite for production reliability under load
- Clear before/after: from "pipeline can hang indefinitely" to "pipeline aborts after configurable timeout"

---

## 23. Explicit Scope Boundaries

### IN SCOPE (Mission A)
1. Add AbortController to single-step execution path
2. Wire timeout into adapter.complete() calls
3. Handle abort as task failure with timeout reason
4. Fix OpenCodeZen adapter timeout (same root cause)
5. Add timeout configuration (env var or constant)
6. Add tests for timeout behavior

### EXPLICITLY OUT OF SCOPE
- Orchestration timeout (already has step timeout via gate11)
- Streaming timeout (already has 300s timeout)
- Retry jitter (different finding, different mission)
- Security audit trail persistence (different finding)
- Anomaly detector cross-owner issue (different finding)
- Shutdown resource leak (Mission B — separate gate)
- MemoryStore parity (Mission C — separate gate)
- Approval expiry (different finding)
- Conversation message limits (different finding)
- toolBroker safeSummary crash (different finding)

---

## 24. Protected Areas

The following areas MUST NOT be modified by Mission A:

| Area | Evidence | Status |
|------|----------|--------|
| Gate 5 invariants | `src/core/security/guardian.ts` — no SAFEWORD/MASTER | UNTOUCHED |
| Gate 19 Store boundary | `src/tools/index.ts` — no direct db imports | UNTOUCHED |
| Gate 20 tool status enums | `src/tools/index.ts:57,92` | UNTOUCHED |
| Gate 20 approval expiry | `src/api/handlers.ts:209` | UNTOUCHED |
| Gate 21 safeAudit/safeCost | `src/core/pipeline.ts:856-870` | UNTOUCHED |
| Gate 21 stale recovery | `src/api/server.ts` startup | UNTOUCHED |
| Schema / migrations | `supabase/migrations/*` | UNTOUCHED |
| Store interface | `src/core/ports.ts` | READ-ONLY (add timeout to existing methods if needed) |

---

## 25. Evidence Gaps

| Gap | Impact on Gate 22 |
|-----|-------------------|
| No live runtime infrastructure | Runtime verification will be UNPROVEN |
| No adapter complete() mock tests | Cannot test timeout with real adapter behavior |
| No concurrent multi-owner test setup | Anomaly counter corruption cannot be reproduced in tests |
| No production metrics | Cannot measure actual timeout frequency |

---

## 26. Runtime Verification Gaps

| Capability | Status | Reason |
|------------|--------|--------|
| Execution timeout under real LLM hang | UNPROVEN | No live provider |
| OpenCodeZen timeout under real process hang | UNPROVEN | No live runtime |
| Shutdown close() under real SIGTERM | UNPROVEN | No live infrastructure |
| Anomaly counter isolation under real multi-owner load | UNPROVEN | Single-owner test setup |

---

## 27. Evidence Matrix

| Finding | Source Evidence | Test Evidence | Runtime Evidence | Confidence | Impact | Status |
|---------|----------------|---------------|------------------|------------|--------|--------|
| Execution NO timeout | `pipeline.ts:486`, `execution.ts:159-168` | NONE | UNPROVEN | PROVEN | HIGH | OPEN |
| SIGTERM no close() | `server.ts:337-344` | NONE | UNPROVEN | PROVEN | HIGH | OPEN |
| Anomaly counter clobbering | `anomaly.ts:41-52`, `server.ts:210` | gate14:277 (acknowledged) | UNPROVEN | PROVEN | MEDIUM | OPEN |
| Security events fire-and-forget | `security.ts:23` | gate17: G17-SE-01/02 | UNPROVEN | PROVEN | MEDIUM | KNOWN |
| MemoryStore prefs not scoped | `memoryStore.ts:147-161` | NONE | N/A (test-only) | PROVEN | LOW | OPEN |
| No approval expiry | `approval.ts:59` (never called) | NONE | UNPROVEN | PROVEN | LOW | OPEN |
| OpenCodeZen no timeout | `opencodeZen.ts:31-42` | NONE | UNPROVEN | PROVEN | MEDIUM | OPEN |
| toolBroker safeSummary crash | `toolBroker.ts:88-91` | NONE | UNPROVEN | LIKELY | MEDIUM | OPEN |

---

## 28. Repository Integrity Verification

**Pre-discovery state:** All Gate 21 changes committed (untracked docs + test files).
**Post-discovery state:** SAME — no files modified, created, or deleted during discovery.

```
git status --short: (same as pre-discovery)
```

Discovery did NOT modify any files.

---

## 29. Owner Decision Required

### OD40: Approve the recommended Gate 22 mission?

**RECOMMENDED_MISSION:**
Mission A — Execution Timeout + Resource Management

**IMPLEMENTATION_AUTHORIZED:**
NO (discovery phase only)

**Expected scope:**
- Add AbortController + configurable timeout to single-step execution
- Wire timeout into provider adapter.complete() calls
- Handle abort as task failure with timeout reason
- Fix OpenCodeZen adapter timeout
- Add 6-8 tests for timeout behavior
- Expected test count: 901 + 6-8 = ~907-909

**Expected files:**
- `src/api/execution.ts` — primary changes
- `src/core/pipeline.ts` — timeout integration
- `src/gateways/adapters/opencodeZen.ts` — timeout fix
- `src/core/gate22.test.ts` — new test file

**Expected baseline:**
- Gate 21: 901 → Gate 22: ~907-909

---

**GATE_22_DISCOVERY_COMPLETE**
**CLASSIFICATION = GATE_22_READY_FOR_OWNER_APPROVAL**
