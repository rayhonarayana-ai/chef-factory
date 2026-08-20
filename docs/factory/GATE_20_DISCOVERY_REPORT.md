# GATE 20 — FORENSIC BOTTLENECK DISCOVERY REPORT

**Status: DISCOVERY_COMPLETE**
**Classification: GATE_20_READY_FOR_OWNER_APPROVAL**
**Date: 2026-08-19**

---

## 1. Project Identity

| Field | Value |
|---|---|
| Repository | `chef-factory` |
| Description | CHEF Personal Executive Core — Gate 1 (independent AI Company Factory) |
| Supabase ref | `dybyidtcyzgliupzzfhl` |
| Independence | COMPLETE — no cross-project contamination |
| Package name | `chef-factory` v0.1.0 |

---

## 2. Gate 19 Closure Verification

| Claim | Verified Against Source | Status |
|---|---|---|
| 846/846 PASS | ACTUAL: 845/846 PASS, 1 FAIL (deadlock) | **CONTRADICTION** |
| 0 FAIL | ACTUAL: 1 FAIL — PostgreSQL deadlock in gate4 | **CONTRADICTION** |
| 7 SKIPPED | Verified | PASS |
| tsc CLEAN | Verified | PASS |
| build CLEAN | Verified | PASS |
| 97 Gate 19 tests | Verified in gate19.test.ts | PASS |

**CONTRADICTION:** Gate 19 report claimed 846/846 PASS. Actual: 845/846, 1 FAIL. The failure is a PostgreSQL deadlock in `gate4.live.integration.test.ts:47` during concurrent test cleanup on `personal_preferences` table. This is a real runtime concurrency issue, not a flaky test.

**Gate 19 scope:** All 5 owner decisions (OD28-OD32) + queryAudit verified implemented and passing.

---

## 3. Current Baseline

| Metric | Value |
|---|---|
| Total tests | 846 |
| Passed | 845 |
| Failed | 1 (deadlock) |
| Skipped | 7 |
| tsc | CLEAN |
| build | CLEAN |
| New since Gate 18 | 97 tests (Gate 19) |

---

## 4. Dead Retry / Approval Forensic Audit

### 4A. What is the Retry Pipeline?

The "retry pipeline" is `handleTaskFailure()` in `src/core/taskEngine.ts:55-79`. On task failure:
- Increments `attempts`
- If `attempts < maxAttempts` (default 3): re-queues task (`status: queued`)
- If `attempts >= maxAttempts`: marks task `failed`, `stopped = true`
- Returns `retry_pending` to the caller

**Critical finding:** After re-queueing, **nothing automatically re-executes the task.** The task sits in `queued` state until the user re-submits the command. There is no worker loop, no polling, no event-driven resume.

### 4B. What is the Approval Pipeline?

The approval pipeline spans multiple components:
1. **Pipeline** (`pipeline.ts:381-438`): When authority resolves `require_approval`, task is created as `needs_approval` and an approval record is created as `pending`
2. **API handler** (`handlers.ts:199-243`): `POST /api/approvals/:id/decision` resolves the approval and re-queues the task
3. **Approval engine** (`approval.ts`): `validateNewApproval()`, `resolveApproval()`, `isExpired()`

### 4C. Which Components Are Wired?

| Component | Wired | Dead Code |
|---|---|---|
| `handleTaskFailure()` (re-queue) | YES — called from pipeline | — |
| `retryCapReached()` | **NO** — only called in tests | **DEAD CODE** |
| `isExpired()` (approval expiry) | **NO** — only called in tests | **DEAD CODE** |
| `validateNewApproval()` | YES — called from pipeline | — |
| `resolveApproval()` | YES — called from API handler | — |
| Approval create + resolve flow | YES — end-to-end wired | — |
| Stuck-task detection | **NOT IMPLEMENTED** | — |
| Dead-letter queue | **NOT IMPLEMENTED** | — |
| Approval timeout/expiry | **NOT ENFORCED** | — |

### 4D. Stuck States

| State | Stuck Risk | Auto-Recovery |
|---|---|---|
| `retry_pending` → `queued` | **HIGH** — no worker picks up re-queued tasks | NONE — user must re-submit |
| `needs_approval` | **HIGH** — no timeout, no auto-expiry | NONE — owner must act |
| `paused` | **MEDIUM** — only `update_task` tool can resume | NONE — manual only |
| `cancelled` | LOW — terminal state (correct) | N/A |

### 4E. Security Implications

1. **Approval DoS:** An attacker who can create approval requests (but not resolve them) could create unbounded pending approvals, flooding the owner's approval queue
2. **Retry without authorization:** When a task is re-queued after failure, it re-enters the pipeline from `queued`. The authority/security checks are re-evaluated, so this is safe
3. **Stuck tasks as audit gaps:** Tasks stuck in `queued` or `needs_approval` don't generate audit events, making them invisible to monitoring

---

## 5. Approval Lifecycle Analysis

| Property | Status |
|---|---|
| Create approval | IMPLEMENTED, TESTED, INTEGRATION_VERIFIED |
| Resolve approval | IMPLEMENTED, TESTED, INTEGRATION_VERIFIED |
| Approval idempotency | IMPLEMENTED, TESTED |
| Approval expiry | **IMPLEMENTED BUT NEVER CALLED** (dead code) |
| Approval timeout | **NOT IMPLEMENTED** |
| Approval replay | NOT IMPLEMENTED (terminal state blocks) |
| Concurrent approval | Safe (one-pending-per-task rule) |
| Approval after restart | **UNPROVEN** — pending approvals persist in DB but nothing processes them |

---

## 6. Retry Lifecycle Analysis

| Property | Status |
|---|---|
| Re-queue on failure | IMPLEMENTED, TESTED |
| Bounded retry (maxAttempts) | IMPLEMENTED, TESTED |
| Retry cap check | **DEAD CODE** — `retryCapReached()` never called in prod |
| Retry backoff | NOT IMPLEMENTED for task-level retry |
| Retry authorization | Re-evaluated on re-queue (safe) |
| Retry idempotency | Safe (attempts counter is additive) |
| Retry concurrency | Safe (single re-queue per failure) |
| Retry cancellation | Task can be cancelled while queued |
| Retry timeout | NOT IMPLEMENTED — no per-retry timeout |
| Retry failure | Correctly transitions to `failed` when cap reached |
| Retry observability | `retry_pending` outcome is returned to caller |
| Auto-replay after re-queue | **NOT IMPLEMENTED** — the core gap |

---

## 7. Runtime Evidence

| Property | Status |
|---|---|
| Task retry at runtime | UNPROVEN (no live runtime testing) |
| Approval at runtime | UNPROVEN |
| Deadlock at runtime | **PROVEN** — gate4 test deadlock on personal_preferences |
| Process restart behavior | UNPROVEN |
| Stuck task recovery | NOT IMPLEMENTED |

---

## 8. Security Analysis

| Risk | Finding | Severity |
|---|---|---|
| Approval DoS | No limit on pending approvals per task | MEDIUM |
| Approval timeout | `isExpired()` exists but never called | MEDIUM |
| Retry without auth | Re-evaluated on re-queue (safe) | LOW |
| Stuck tasks | No detection or cleanup | LOW |
| Concurrent approval | One-pending rule prevents duplicates | SAFE |

---

## 9. Post-Gate-19 Architecture Audit

### Critical/High Findings

| # | Finding | Severity | Area |
|---|---|---|---|
| 1 | Tool definition status enums wrong (`pending`/`in_progress` vs `created`/`running`) | **HIGH** | Correctness |
| 2 | `getPool()` bypass in query-data.ts (approved exception, but not in gate19 test file list) | **HIGH** | Architecture |
| 3 | MemoryStore.queryAudit filters by `actorId` instead of project ownership | **HIGH** | Testability |
| 4 | Duplicate `ConversationMessage` type with different shapes | **HIGH** | Architecture |

### Medium Findings

| # | Finding | Severity | Area |
|---|---|---|---|
| 5 | Conversation resolution logic duplicated (handlers.ts + streaming.ts) | MEDIUM | Architecture |
| 6 | PersistentRateLimiter load→check→save race condition | MEDIUM | Reliability |
| 7 | Process-local semaphores in query-data.ts (not cluster-safe) | MEDIUM | Reliability |
| 8 | gate14Persistence.ts anomaly save not transactional | MEDIUM | Data Integrity |
| 9 | 5 unused interfaces (dead code) | MEDIUM | Architecture |

### Live Test Finding

| # | Finding | Severity | Area |
|---|---|---|---|
| 10 | PostgreSQL deadlock in gate4 test — concurrent personal_preferences cleanup | **HIGH** | Reliability |

---

## 10. Capability Maturity Map

| Capability | CODE_ONLY | TEST_VERIFIED | INTEGRATION_VERIFIED | RUNTIME_VERIFIED | PRODUCTION_VERIFIED |
|---|---|---|---|---|---|
| Task creation | | | ✓ | | |
| Task execution | | | ✓ | | |
| Task retry (re-queue) | | | ✓ | | |
| Task retry (auto-replay) | **✗ NOT IMPLEMENTED** | | | | |
| Approval create | | | ✓ | | |
| Approval resolve | | | ✓ | | |
| Approval expiry | ✓ (dead code) | ✓ | | | |
| Approval timeout | **✗ NOT IMPLEMENTED** | | | | |
| Stuck-task detection | **✗ NOT IMPLEMENTED** | | | | |
| Dead-letter queue | **✗ NOT IMPLEMENTED** | | | | |
| Provider retry | | ✓ | ✓ (live) | | |
| Provider circuit breaker | | ✓ | ✓ (live) | | |
| Security guardian | | ✓ | ✓ (live) | | |
| Rate limiting | | ✓ | ✓ (live) | | |
| Memory/recall | ✓ (stub) | ✓ (empty) | | | |

---

## 11. Bottleneck Candidates

| # | Candidate | Area | Root Cause |
|---|---|---|---|
| 1 | Tool definition status enum mismatch | Correctness | LLM generates invalid status values |
| 2 | Approval timeout not enforced | Reliability | `isExpired()` exists but never called |
| 3 | No stuck-task detection | Reliability | No watchdog/reaper process |
| 4 | Live test deadlock (personal_preferences) | Reliability | Concurrent test isolation |
| 5 | MemoryStore.queryAudit wrong filter | Testability | Actor-based vs project-based query |
| 6 | Duplicate ConversationMessage types | Architecture | Name collision, different shapes |
| 7 | Conversation resolution duplication | Architecture | Same logic in two handlers |
| 8 | Anomaly save not transactional | Data Integrity | Per-counter INSERT without tx |
| 9 | Rate limiter race condition | Reliability | Non-atomic load/check/save |
| 10 | 5 unused interfaces | Architecture | Dead code |

---

## 12. Priority Scoring

**Formula:** Score = Security(15) + Correctness(20) + Reliability(15) + DataIntegrity(10) + RuntimeImpact(10) + ArchitecturalImpact(10) + BusinessImpact(5) + UserImpact(5) + EvidenceGap(5) + Leverage(5)

| # | Candidate | Sec | Corr | Rel | Data | RT | Arch | Biz | User | EG | Lev | **Total** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Tool status enum mismatch | 0 | 18 | 10 | 5 | 8 | 5 | 5 | 5 | 2 | 4 | **62** |
| 2 | Approval timeout dead code | 5 | 10 | 12 | 5 | 8 | 5 | 3 | 3 | 3 | 3 | **57** |
| 3 | No stuck-task detection | 3 | 5 | 12 | 5 | 8 | 5 | 3 | 3 | 3 | 3 | **50** |
| 4 | Live test deadlock | 0 | 5 | 12 | 8 | 8 | 3 | 2 | 2 | 4 | 3 | **47** |
| 5 | MemoryStore.queryAudit wrong filter | 0 | 10 | 0 | 3 | 0 | 5 | 0 | 0 | 5 | 4 | **27** |
| 6 | Duplicate ConversationMessage | 0 | 5 | 0 | 0 | 0 | 10 | 0 | 0 | 3 | 2 | **20** |
| 7 | Conversation resolution dup | 0 | 3 | 0 | 0 | 0 | 8 | 0 | 0 | 2 | 2 | **15** |
| 8 | Anomaly save non-transactional | 0 | 3 | 5 | 8 | 0 | 3 | 0 | 0 | 2 | 2 | **23** |
| 9 | Rate limiter race | 3 | 3 | 8 | 3 | 0 | 3 | 0 | 0 | 2 | 2 | **24** |
| 10 | 5 unused interfaces | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 1 | 1 | **7** |

---

## 13. Gate 17 Recovery Reassessment

| Property | Assessment |
|---|---|
| Current impact | LOW — audit event loss is scoped to DB outage (rare) |
| Current frequency | Very low (Supabase is managed, rarely goes down) |
| Current observability | In-memory events are logged on failure |
| Security implications | Security decisions are correct in-memory; only the audit trail is affected |
| Implementation complexity | HIGH — requires outbox pattern or event bus |
| Infrastructure cost | Medium — requires persistent queue or outbox table |
| Recovery value | LOW — the gap is observability, not correctness |
| Risk | Medium — adding new infrastructure has blast radius |
| **Overall rank** | **#8 out of 10** — outscored by tool enum mismatch, approval timeout, stuck tasks, deadlock |

---

## 14. Dead Retry / Approval Ranking

The "Dead Retry / Approval Pipeline" from Gate 19 Discovery scored 67/100.

**Re-evaluation against current evidence:**

The core finding is valid:
- `retry_pending` is a dead-end (no auto-replay)
- `isExpired()` is dead code
- `retryCapReached()` is dead code
- No stuck-task detection

**However**, after Gate 19, the highest-leverage immediate improvements are:
1. Tool status enum mismatch (Score 62) — affects every LLM interaction
2. Approval timeout (Score 57) — security + correctness gap
3. Stuck-task detection (Score 50) — reliability gap

The retry/approval pipeline issues are real but lower priority than the tool enum mismatch because:
- The enum mismatch affects **every task creation/update** via the LLM
- The approval timeout is a **security gap** (DoS vector)
- The stuck-task detection prevents **silent failures**

---

## 15. Top Bottleneck

**SELECTED: Tool Definition Status Enum Mismatch (Score 62)**

### WHY #1

The LLM-facing tool schemas at `src/tools/index.ts:57,92` define status values as `['pending', 'in_progress', 'completed', 'failed']`, but the actual `TaskStatus` type at `src/core/types.ts:8-17` uses `['created', 'queued', 'running', 'completed', 'failed', 'cancelled', 'paused', 'needs_approval']`.

- `'pending'` doesn't exist → should be `'created'` or `'queued'`
- `'in_progress'` doesn't exist → should be `'running'`
- Missing: `'cancelled'`, `'paused'`, `'needs_approval'`, `'created'`, `'queued'`

**Impact:** Every time the LLM tries to filter tasks by status or update a task status, it will generate invalid values that get rejected by the handler or silently ignored. This degrades the tool-calling experience for every user interaction.

### WHY NOW

- This is a pre-existing bug, not introduced by Gate 19
- It affects the core tool-critical path (every task operation)
- It's trivial to fix (change enum arrays in index.ts)
- It has zero risk (schema-only change, no behavioral change)
- It unblocks correct LLM task filtering and updates

### WHY NOT #2 (Approval Timeout)

The approval timeout is a security gap, but it requires:
- Adding a scheduler or cron process
- Deciding timeout duration
- Defining behavior on expiry (cancel task? notify owner?)

This is more complex than the enum fix and has higher blast radius.

### WHY NOT RETRY/APPROVAL

The retry pipeline's "dead-end" behavior is by design — the system relies on user re-submission. Adding auto-replay would be a significant architectural change (worker process, polling, or event bus). It should be a separate, carefully designed gate.

### WHY NOT RECOVERY

Gate 17 Recovery (audit event persistence) scores lower because the impact is observability-only, not correctness. The audit trail gap is real but doesn't affect task execution or security decisions.

---

## 16. Alternative Candidates

| Rank | Candidate | Score | Why Not #1 |
|---|---|---|---|
| 2 | Approval timeout enforcement | 57 | More complex, higher blast radius |
| 3 | Stuck-task detection | 50 | Requires new infrastructure |
| 4 | Live test deadlock | 47 | Test isolation issue, not production code |
| 5 | MemoryStore.queryAudit filter | 27 | Test-only correctness, no production impact |
| 6 | Rate limiter race | 24 | Edge case under high concurrency |
| 7 | Anomaly save non-transactional | 23 | Low frequency, crash-recovery scenario |
| 8 | Duplicate ConversationMessage | 20 | Naming issue, no runtime impact |
| 9 | Conversation resolution dup | 15 | Maintenance burden only |
| 10 | 5 unused interfaces | 7 | Dead code, zero runtime impact |

---

## 17. Mission Options

### Mission A: Tool Schema Correctness + Approval Timeout

**Scope:** Fix tool definition status enums + add approval expiry enforcement

**Problem:** LLM generates invalid status values; approvals never expire

**Files:**
- `src/tools/index.ts` — fix status enums
- `src/core/approval.ts` — expose expiry check
- `src/api/handlers.ts` or new endpoint — call `isExpired()` before resolving
- `src/core/types.ts` — no changes needed (already correct)

**Expected tests:** +8-12 (enum validation, expiry enforcement, edge cases)

**Security impact:** LOW — schema-only + approval validation
**Reliability impact:** MEDIUM — approvals get timeout behavior
**Architectural impact:** LOW — no new infrastructure
**Risk:** LOW

### Mission B: Stuck-Task Detection + Cleanup

**Scope:** Add watchdog/reaper for stuck tasks

**Problem:** Tasks in `queued` or `needs_approval` can remain indefinitely

**Files:**
- `src/core/ports.ts` — add `findStuckTasks()`, `reclaimStuckTasks()` to Store
- `src/db/repo.ts` — implement stuck-task queries
- New file or API endpoint — periodic check

**Expected tests:** +10-15

**Security impact:** LOW
**Reliability impact:** HIGH — prevents silent task loss
**Architectural impact:** MEDIUM — new Store methods + scheduled process
**Risk:** MEDIUM

### Mission C: Live Test Deadlock Fix + MemoryStore Query Fix

**Scope:** Fix concurrent test isolation + MemoryStore.queryAudit filter

**Problem:** gate4 tests deadlock on personal_preferences; MemoryStore audit filter is wrong

**Files:**
- `src/integration/gate4.live.integration.test.ts` — fix concurrent cleanup
- `src/testing/memoryStore.ts` — fix queryAudit filter to match SupabaseStore

**Expected tests:** +3-5

**Security impact:** LOW
**Reliability impact:** MEDIUM — prevents test deadlocks
**Architectural impact:** LOW
**Risk:** LOW

### Mission D: Code Quality Cleanup

**Scope:** Remove dead code, fix duplicate types, extract shared logic

**Problem:** Dead interfaces, duplicate ConversationMessage, duplicated conversation resolution

**Files:**
- `src/core/types.ts` — remove unused interfaces
- `src/core/pipeline.ts` — rename ConversationMessage to LlmMessage
- `src/api/handlers.ts` + `src/api/streaming.ts` — extract shared conversation resolution

**Expected tests:** +3-5

**Security impact:** NONE
**Reliability impact:** NONE
**Architectural impact:** LOW-MEDIUM — type rename has cross-file impact
**Risk:** LOW-MEDIUM

---

## 18. Recommended Gate 20 Mission

**MISSION A: Tool Schema Correctness + Approval Timeout**

**Rationale:**
- Highest user-facing impact (every LLM interaction)
- Lowest risk (schema change + approval validation)
- Trivial to test
- Unblocks correct task filtering and updates
- Adds approval timeout as security hardening
- Bounded scope

---

## 19. Security / Blast Radius

| Mission | Blast Radius | Security Risk | Data Risk | Rollback |
|---|---|---|---|---|
| A (Enum + Timeout) | LOW — 3-4 files | LOW — schema + validation | NONE — no data change | Trivial |
| B (Stuck Tasks) | MEDIUM — 3+ files + new Store methods | LOW — read-only queries | LOW — adds new queries | Easy |
| C (Deadlock + MemoryStore) | LOW — 2 files | NONE | NONE | Trivial |
| D (Code Quality) | LOW-MEDIUM — cross-file rename | NONE | NONE | Easy |

---

## 20. Evidence Gaps

| Gap | Impact | How to Close |
|---|---|---|
| No runtime verification of retry behavior | Can't confirm re-queue works in production | Runtime testing with real Supabase |
| No runtime verification of approval flow | Can't confirm approval → resume works | Runtime testing |
| Deadlock root cause not fully traced | May recur under load | Add transaction isolation to test cleanup |
| `isExpired()` never tested at integration level | Expiry behavior unproven | Integration test with time mock |

---

## 21. Expected Tests

| Mission | New Tests | Regression |
|---|---|---|
| A (Enum + Timeout) | +8-12 | Full suite must pass |
| B (Stuck Tasks) | +10-15 | Full suite must pass |
| C (Deadlock + MemoryStore) | +3-5 | Full suite must pass |
| D (Code Quality) | +3-5 | Full suite must pass |

---

## 22. Success Criteria

For the recommended Mission A:

1. Tool definition status enums match `TASK_STATUSES` exactly
2. LLM can filter tasks by all valid statuses
3. LLM can update tasks to all valid statuses
4. Pending approvals auto-expire after configurable timeout
5. Expired approvals cannot be resolved
6. All 846+ tests pass (no regressions)
7. tsc CLEAN
8. build CLEAN

---

## 23. Scope Boundaries

**IN SCOPE:**
- Fix tool definition status enums in `src/tools/index.ts`
- Add approval expiry enforcement
- Add tests for enum correctness and expiry behavior

**OUT OF SCOPE:**
- Retry auto-replay (Gate 21+)
- Stuck-task detection (Gate 21+)
- Dead-letter queue (Gate 21+)
- Process-local semaphore fix (Gate 21+)
- Rate limiter atomicity (Gate 21+)
- ConversationMessage rename (Gate 21+)
- Gate 17 Recovery (not next)

---

## 24. Evidence Matrix

| Finding | Evidence | Verification | Actual Result | Confidence | Impact |
|---|---|---|---|---|---|
| Tool status enums wrong | `index.ts:57,92` vs `types.ts:8-17` | Source code | `pending`/`in_progress` vs `created`/`running` | HIGH | Every LLM task interaction |
| `isExpired()` dead code | `approval.ts:59` — no callers outside tests | Source grep | Zero production callers | HIGH | Approvals never expire |
| `retryCapReached()` dead code | `taskEngine.ts:81` — no callers outside tests | Source grep | Zero production callers | HIGH | Logic duplicated inline |
| `retry_pending` no auto-replay | `pipeline.ts:591` — returns outcome, no worker | Architecture review | No worker/poller exists | HIGH | Tasks stay queued forever |
| Live test deadlock | `gate4.live.integration.test.ts:47` | Test run | `deadlock detected` on personal_preferences | HIGH | Test reliability |
| MemoryStore.queryAudit wrong filter | `memoryStore.ts:363` vs `repo.ts:862` | Source comparison | actorId vs project ownership | HIGH | Test correctness |
| Duplicate ConversationMessage | `pipeline.ts:70` vs `conversation.ts:17` | Source comparison | Different shapes, same name | MEDIUM | Type confusion risk |
| Anomaly save non-transactional | `gate14Persistence.ts:49-59` | Source review | Per-counter INSERT without tx | MEDIUM | Crash inconsistency |
| Rate limiter race | `rateLimit.ts:129-133` | Source review | Non-atomic load/check/save | MEDIUM | Limit bypass under concurrency |
| 5 unused interfaces | `types.ts` various | Source grep | Never imported outside definitions | LOW | Dead code |

---

## 25. Final Recommendation

**GATE_20_DISCOVERY_COMPLETE**
**CLASSIFICATION = GATE_20_READY_FOR_OWNER_APPROVAL**

**Recommended Mission:** A — Tool Schema Correctness + Approval Timeout

**Key Evidence:**
- Tool status enums are wrong — affects every LLM interaction
- Approval expiry is dead code — security gap
- Both are low-risk, high-value fixes
- No new infrastructure required
- Bounded scope, easily testable

**Owner decisions needed:**
1. Approve Mission A as Gate 20?
2. Approve Mission B (stuck tasks) as Gate 20 scope expansion?
3. Approve Mission C (deadlock) as Gate 20 bundle?
4. Approve Mission D (code quality) as Gate 20 bundle?

**STOP. WAITING FOR OWNER APPROVAL.**
