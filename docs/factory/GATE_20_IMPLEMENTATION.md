# Gate 20 Implementation Report
**Classification: PASS (pending final verification)**
**Date: 2026-08-19**

## Scope
Implemented OD33 (Tool Schema Correctness + Approval Timeout) and OD35 (MemoryStore queryAudit Correctness + Deadlock Fix). OD34 (stuck-task detection) and OD36 (code quality) were EXPLICITLY REJECTED by owner.

## Changes Made

### 1. Tool Schema Status Enums — OD33 (src/tools/index.ts:57, 92)
**Problem:** `list_tasks` and `update_task` tool definitions used obsolete status values `pending` and `in_progress` that do not match `TASK_STATUSES` from `src/core/types.ts:8-17`. LLM would generate invalid status values.
**Fix:** Replaced with canonical values from `TASK_STATUSES`:
- `list_tasks`: `['created', 'queued', 'running', 'completed', 'failed', 'cancelled', 'paused', 'needs_approval']`
- `update_task`: `['created', 'queued', 'completed', 'failed', 'cancelled', 'paused', 'needs_approval']` (excludes `running` which is engine-set only)

### 2. Approval Timeout — OD33 (src/api/handlers.ts:9, 209)
**Problem:** `isExpired()` in `src/core/approval.ts:59` was dead code with zero production callers. Expired approvals could be resolved indefinitely (DoS vector).
**Fix:** Added `isExpired()` check in `POST /api/approvals/:id/decision` handler before `resolveApproval()`. Returns 409 if expired. Also patches status to `expired` in store.

### 3. MemoryStore queryAudit Correctness — OD35 (src/testing/memoryStore.ts:363)
**Problem:** Filtered by `actorId === ownerId`, but `SupabaseStore.queryAudit` in `src/db/repo.ts:862` filters by project ownership: `WHERE project_id IN (SELECT id FROM projects WHERE owner_id = $1)`.
**Fix:** Changed filter to find owner's projects, then filter audit events by `projectId` membership. Matches SupabaseStore behavior.

### 4. Gate 4 Deadlock Fix — OD35 (src/integration/gate4.live.integration.test.ts:47)
**Problem:** `ensure()` executed `DELETE FROM auth.users WHERE email LIKE 'it-%@chef.local'` before inserting test users. Concurrent test transactions cascading to `personal_preferences` caused PostgreSQL deadlock.
**Fix:** Removed blanket DELETE from `ensure()`. Uses `ON CONFLICT DO NOTHING` for inserts. `afterAll` cleanup remains best-effort.

## Files Modified
| File | Change |
|------|--------|
| `src/tools/index.ts:57` | list_tasks status enum corrected |
| `src/tools/index.ts:92` | update_task status enum corrected |
| `src/api/handlers.ts:9` | Added `isExpired` import |
| `src/api/handlers.ts:209` | Added expiry check before approval resolution |
| `src/testing/memoryStore.ts:363` | queryAudit filter changed to project ownership |
| `src/integration/gate4.live.integration.test.ts:47` | Removed blanket DELETE from transaction scope |

## New Files
| File | Description |
|------|-------------|
| `src/tools/gate20.test.ts` | 21 tests covering OD33 + OD35 |

## Tests Updated
| File | Description |
|------|-------------|
| `src/tools/gate19.test.ts` | 4 queryAudit tests updated to use project ownership (was actorId) |

## Test Results
- **Gate 20 new tests:** 21/21 PASS
- **Gate 19 tests (updated):** 97/97 PASS
- **Full suite:** 867/867 PASS, 7 skipped (pre-existing Gate 14/10)
- **tsc:** CLEAN
