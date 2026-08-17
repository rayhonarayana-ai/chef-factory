# CHEF FACTORY — TASKS (Gate 1 Core)

**Component:** Task Engine (Task Registry + lifecycle)
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED (schema)

## Purpose
Task/mission persistence with a deterministic lifecycle and bounded retries.

## Lifecycle
`CREATED → QUEUED → RUNNING → COMPLETED`
Safe failure/cancel states: `FAILED`, `CANCELLED`. All transitions validated by
`canTransition` / `assertTransition` (`src/core/taskEngine.ts`).

## Failure & Retry
- `DEFAULT_MAX_ATTEMPTS = 3` (contract §6).
- `handleTaskFailure(task, error)`:
  - `attempts + 1 < maxAttempts` → `running → queued` retry path with `attempts` incremented.
  - `attempts >= maxAttempts` → `failed` and `stopped: true`.
- `retryCapReached(task)` exposes the cap check.
- Terminals: `completed | failed | cancelled` (`TERMINAL_TASK_STATUSES`).

## Persistence
- `Store.createTask(ownerId, data)` — accepts an optional initial `status` (used by the
  pipeline to re-queue retried tasks).
- `Store.patchTask` applies `TaskPatch` (status/output/error/attempts/agent/environment/timestamps).
- `Store.createTaskRun` / `Store.completeTaskRun` — run-level records with output snapshots
  and cost.

## Tests
- `src/core/taskEngine.test.ts` — transition matrix, retry path, cap.
- `src/core/pipeline.test.ts` — pipeline drives the engine end-to-end (in-memory store).
- `src/integration/live.integration.test.ts` — full lifecycle + bounded retry cap on live schema.
