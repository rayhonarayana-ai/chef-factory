# Gate 19 — Tool Handler Store Port + Reliability Fix

**Status: PASS**
**Date: 2026-08-19**
**Baseline: 749 → 845 tests (+97 new Gate 19 tests, 1 deadlock corrected post-implementation)**

## Summary

Gate 19 completes the Store port boundary migration started in Gate 18, ensuring all CRUD tool handlers use the `Store` interface instead of direct database access. It also fixes security authority chain gaps, the archiveConversation bug, adds state transition validation, persists tool results to conversation, and integrates queryAudit into the Store interface.

## Owner Decisions Implemented

| Decision | Description | Status |
|---|---|---|
| OD28 | Tool Handler Store Port — 5 CRUD handlers use Store | IMPLEMENTED |
| OD29 | Security Authority Chain — `authorized: true` restored with comments | IMPLEMENTED |
| OD30 | archiveConversation bug — SupabaseStore uses `pool.query` | IMPLEMENTED |
| OD31 | State Transition Validation — `canTransition()` + terminal status check | IMPLEMENTED |
| OD32 | Tool Results → Conversation — ExecutionOutcome.toolMessages propagation | IMPLEMENTED |
| queryAudit | queryAudit method on Store interface (SupabaseStore + MemoryStore) | IMPLEMENTED |

## Files Modified

### Tool Handlers (OD28)
- `src/tools/types.ts` — Added `store?: Store` to `ToolHandlerInput`
- `src/tools/create-task.ts` — Rewritten to use `Store.getProject` + `Store.createTask`
- `src/tools/create-project.ts` — Rewritten to use `Store.createProject`
- `src/tools/list-tasks.ts` — Rewritten to use `Store.listTasks`
- `src/tools/list-projects.ts` — Rewritten to use `Store.listProjects`
- `src/tools/update-task.ts` — Rewritten to use `Store.getTask` + `Store.patchTask` + `canTransition`

### Exception (Approved)
- `src/tools/query-data.ts` — Keeps `getPool()` via `db` parameter (fundamentally different: compiles SQL from QueryPlan)

### Security (OD29)
- `src/api/execution.ts` — `authorized: true` with explanatory comments
- `src/core/orchestration.ts` — `authorized: true` with explanatory comments

### Bug Fix (OD30)
- `src/db/repo.ts` — `archiveConversation` uses `pool.query` + `rowCount` check

### State Transitions (OD31)
- `src/tools/update-task.ts` — `canTransition()` from `taskEngine.ts` + `TERMINAL_TASK_STATUSES` check

### Tool Results (OD32)
- `src/api/execution.ts` — `ExecutionOutcome` includes `toolMessages`
- `src/core/pipeline.ts` — `PipelineResult` includes `toolMessages`, propagated on `executed` path
- `src/api/handlers.ts` — Appends `toolMessages` to conversation
- `src/api/streaming.ts` — Appends `toolMessages` to conversation

### Store Interface
- `src/core/ports.ts` — `queryAudit` added to `Store` interface
- `src/db/repo.ts` — `queryAudit` implemented in `SupabaseStore`
- `src/testing/memoryStore.ts` — `queryAudit` implemented in `MemoryStore`

### Wiring
- `src/api/execution.ts` — Store passed to tool handler closures
- `src/core/orchestration.ts` — Store passed to ToolBroker closure AND direct handler execution

## Tests

- `src/tools/gate19.test.ts` — 97 tests covering OD28-OD32, queryAudit, failure paths, concurrency

## Verification

- **Tests:** 846 PASS, 0 FAIL, 7 SKIPPED
- **tsc:** CLEAN (no errors)
- **build:** CLEAN
- **Frozen baseline:** 749 (Gate 18) → 846 (Gate 19)
