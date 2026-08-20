# Gate 20 — Mission Options

## Mission A: Tool Schema Correctness + Approval Timeout (RECOMMENDED)

**Problem:** LLM-facing tool schemas define invalid status values; approval expiry never enforced

**Root Cause:** Tool definitions at `index.ts:57,92` were written with placeholder statuses that don't match the actual `TaskStatus` type. `isExpired()` was implemented but never wired.

**Evidence:**
- `index.ts:57` — `enum: ['pending', 'in_progress', 'completed', 'failed']`
- `types.ts:8-17` — `TASK_STATUSES = ['created', 'queued', 'running', 'completed', 'failed', 'cancelled', 'paused', 'needs_approval']`
- `approval.ts:59` — `isExpired()` exists, zero production callers

**Files to modify:**
- `src/tools/index.ts` — fix status enums to match `TASK_STATUSES`
- `src/core/approval.ts` — expose expiry check (may already be sufficient)
- `src/api/handlers.ts` — check expiry before resolving approval
- New test file or extend existing tests

**Expected tests:** +8-12

**Security impact:** LOW
**Reliability impact:** MEDIUM
**Architectural impact:** LOW
**Risk:** LOW
**Dependencies:** None
**Success criteria:** All status enums match; expired approvals cannot be resolved; all tests pass
**Known limitations:** Doesn't add auto-expiry scheduler (that's a separate concern)

---

## Mission B: Stuck-Task Detection + Cleanup

**Problem:** Tasks in `queued`, `needs_approval`, or `paused` have no automatic cleanup

**Root Cause:** No watchdog/reaper process exists. Store has no stuck-task query methods.

**Evidence:** `taskEngine.ts` transitions tasks to `queued` on retry, but nothing picks them up.

**Files to modify:**
- `src/core/ports.ts` — add `findStuckTasks()`, `reclaimStuckTasks()`
- `src/db/repo.ts` — implement stuck-task queries
- New API endpoint or scheduled task

**Expected tests:** +10-15

**Security impact:** LOW
**Reliability impact:** HIGH
**Architectural impact:** MEDIUM
**Risk:** MEDIUM

---

## Mission C: Live Test Deadlock Fix + MemoryStore Query Fix

**Problem:** Concurrent test deadlock; MemoryStore audit filter doesn't match SupabaseStore

**Root Cause:** Test cleanup opens transactions that lock conflicting rows. MemoryStore uses actorId filter instead of project ownership.

**Files to modify:**
- `src/integration/gate4.live.integration.test.ts` — fix concurrent cleanup
- `src/testing/memoryStore.ts` — fix queryAudit filter

**Expected tests:** +3-5

**Risk:** LOW

---

## Mission D: Code Quality Cleanup

**Problem:** Dead interfaces, duplicate types, duplicated logic

**Files to modify:**
- `src/core/types.ts` — remove 5 unused interfaces
- `src/core/pipeline.ts` — rename ConversationMessage to LlmMessage
- `src/api/handlers.ts` + `src/api/streaming.ts` — extract shared conversation resolution

**Expected tests:** +3-5

**Risk:** LOW-MEDIUM (type rename has cross-file impact)
