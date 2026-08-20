# Gate 21 — Implementation
**Mission: Pipeline Crash Resilience**
**Date: 2026-08-19**

## Owner Decisions
| ID | Scope | Decision |
|----|-------|----------|
| OD37 | Pipeline Crash Resilience | APPROVED |
| OD38 | Fire-and-forget on audit/cost DB failure | APPROVED |
| OD39 | Stale RUNNING → FAILED (no auto-retry, no queued) | APPROVED |

## Prohibitions (OD38/OD39)
- No Outbox pattern
- No durable queue / retry queue
- No automatic audit replay
- No automatic task retry scheduler
- No schema / migration changes
- No stale → queued transitions

## Changes

### 1. Store interface — `src/core/ports.ts`
- Added `recoverStaleRunningTasks(staleBefore: Date): Promise<number>` to `Store` interface.

### 2. SupabaseStore — `src/db/repo.ts`
- Implemented `recoverStaleRunningTasks`: `UPDATE tasks SET status='failed', error=$1, completed_at=NOW(), updated_at=NOW() WHERE status='running' AND started_at < $2 AND owner_id = $3`.

### 3. MemoryStore — `src/testing/memoryStore.ts`
- Implemented `recoverStaleRunningTasks`: filters tasks where `status==='running' && startedAt && startedAt < staleBefore`. Sets `status='failed'`, `completedAt`, `updatedAt`, `error={ message: 'Stale RUNNING task transitioned to FAILED on startup (process restarted)' }`.

### 4. Pipeline fire-and-forget — `src/core/pipeline.ts`
- Added `safeAudit(event)` private method: wraps `this.store.recordAudit(event)` in try/catch; logs `[Gate 21] Audit persistence failed for action="${event.action}": ${e.message}` on failure.
- Added `safeCost(event)` private method: wraps `this.store.recordCost(event)` in try/catch; logs `[Gate 21] Cost persistence failed for taskId="${event.taskId}": ${e.message}` on failure.
- Replaced all 16 bare `this.store.recordAudit(...)` calls with `this.safeAudit(...)`.
- Replaced both bare `this.store.recordCost(...)` calls with `this.safeCost(...)`.

### 5. Server startup recovery + lifecycle — `src/api/server.ts`
- After `new SupabaseStore(pool)` is created: calls `store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60_000))`. 10-minute stale threshold. Errors caught and logged as non-fatal.
- `process.on('SIGTERM')`: logs and exits 0.
- `process.on('SIGINT')`: logs and exits 0.
- `process.on('unhandledRejection')`: logs error, does not crash.

### 6. Tests — `src/core/gate21.test.ts`
34 tests across 8 test categories + interface verification.

## Files Modified
- `src/core/ports.ts` — Store interface: +1 method
- `src/db/repo.ts` — SupabaseStore: +1 method
- `src/testing/memoryStore.ts` — MemoryStore: +1 method
- `src/core/pipeline.ts` — 2 helper methods + 16+2 call replacements
- `src/api/server.ts` — startup recovery + 3 process handlers
- `src/core/gate21.test.ts` — new file, 34 tests

## Files NOT Modified (verified)
- `src/core/security/guardian.ts`
- `src/core/security/lockdown.ts`
- `src/core/security/rateLimit.ts`
- `src/core/security/anomaly.ts`
- `src/tools/index.ts`
- `src/api/handlers.ts`
- `src/core/taskEngine.ts` (no new logic, existing dead code `retryCapReached()` unchanged)
- `supabase/migrations/*` (no new migrations)
