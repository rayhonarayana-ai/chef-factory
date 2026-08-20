# Gate 20 — Forensic Review

**Scope:** Deep source analysis of all confirmed Gate 20 findings

## Finding 1: Tool Definition Status Enum Mismatch (HIGH)

**Files:**
- `src/tools/index.ts:57` — `list_tasks` tool: `enum: ['pending', 'in_progress', 'completed', 'failed']`
- `src/tools/index.ts:92` — `update_task` tool: `enum: ['pending', 'in_progress', 'completed', 'failed']`
- `src/core/types.ts:8-17` — `TASK_STATUSES = ['created', 'queued', 'running', 'completed', 'failed', 'cancelled', 'paused', 'needs_approval']`

**Analysis:** The LLM-facing schemas use values that don't exist in the `TaskStatus` type. When the LLM generates `'pending'` or `'in_progress'`, the `update-task.ts` handler (which validates against `TaskStatus`) will reject them. The `list-tasks.ts` handler passes the status to `Store.listTasks()`, which filters — an invalid status simply returns no results (silent failure).

**Impact:** Every task listing and update operation through the LLM uses wrong status values. This is a pre-existing bug present since Gate 3.

## Finding 2: Approval Expiry Dead Code (HIGH)

**Files:**
- `src/core/approval.ts:59` — `isExpired()` function defined
- `src/core/approval.test.ts:54` — Test calls `isExpired()`
- No production code calls `isExpired()`

**Analysis:** The approval engine includes expiry detection, but no scheduler, API handler, or pipeline step ever invokes it. Pending approvals remain pending indefinitely.

**Security implication:** An attacker creating approval requests (but not resolving them) can flood the owner's approval queue — a DoS vector.

## Finding 3: No Stuck-Task Detection (MEDIUM)

**Analysis:** Tasks in `queued` (from retry), `needs_approval`, or `paused` states have no automatic cleanup. No `findStuckTasks()` method exists on Store. No scheduler or reaper process exists.

**Impact:** Zombie tasks accumulate in the database. They don't affect correctness (the task is not executing) but they waste resources and are invisible to monitoring.

## Finding 4: Live Test Deadlock (HIGH)

**Files:**
- `src/integration/gate4.live.integration.test.ts:47`
- PostgreSQL error: `deadlock detected` on `personal_preferences` table

**Analysis:** Two concurrent test processes both try to delete from `personal_preferences` and create projects simultaneously, causing a circular lock dependency on the FK relationship between `personal_preferences` and `projects`.

**Root cause:** Test cleanup in the `ensure()` helper function opens a transaction and deletes auth users, but the cascade to `personal_preferences` locks rows that the other test process also needs.

## Finding 5: MemoryStore.queryAudit Wrong Filter (HIGH)

**Files:**
- `src/testing/memoryStore.ts:363` — `filter((e) => e.actorId === ownerId)`
- `src/db/repo.ts:862` — `WHERE project_id IN (SELECT id FROM public.projects WHERE owner_id = $1)`

**Analysis:** MemoryStore filters audit events by who performed the action (actorId), while SupabaseStore filters by which projects the owner owns. Tests using MemoryStore see different audit results than production.

## Finding 6: Duplicate ConversationMessage Type (HIGH)

**Files:**
- `src/core/pipeline.ts:70-75` — LLM message format (role + content + optional tool fields)
- `src/core/conversation.ts:17-28` — DB record format (id, timestamps, owner, etc.)

**Analysis:** Two interfaces named `ConversationMessage` with different shapes. Import without checking source module risks type confusion.

## Finding 7: Conversation Resolution Duplication (MEDIUM)

**Files:**
- `src/api/handlers.ts:60-71` — resolve-or-create conversation
- `src/api/streaming.ts:69-79` — identical logic

**Analysis:** Same conversation resolution logic duplicated. Changes to one won't propagate to the other.

## Finding 8: Anomaly Save Non-Transactional (MEDIUM)

**Files:**
- `src/db/gate14Persistence.ts:49-59` — Per-counter INSERT without transaction

**Analysis:** If process crashes mid-save, some anomaly counters persist while others don't. After restart, detection thresholds could be inconsistent.
