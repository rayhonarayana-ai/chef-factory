# Gate 20 Forensic Closure
**Date: 2026-08-19**

## Source Forensic Verification

### Tool Status Obsolete Values — RESOLVED
**Search:** `grep -r '"pending"|"in_progress"' src/ --include='*.ts'`
**Result:** 0 matches in production source. Only in test assertions (gate20.test.ts verifying the fix).

### isExpired() Dead Code — RESOLVED
**Search:** `grep -r 'isExpired' src/ --include='*.ts'`
**Result:** 20 matches across:
- `src/core/approval.ts:59` — function definition
- `src/api/handlers.ts:9,209` — **PRODUCTION IMPORT + CALL** (was zero before)
- `src/core/approval.test.ts:2,56-59` — existing unit tests
- `src/tools/gate20.test.ts` — new Gate 20 tests

Before Gate 20: 0 production callers. After Gate 20: 1 production caller.

### MemoryStore queryAudit Filter — RESOLVED
**Verification:** `src/testing/memoryStore.ts` now filters by `projectId` membership in owner's projects.
`src/db/repo.ts:862` SupabaseStore uses `WHERE project_id IN (SELECT id FROM projects WHERE owner_id = $1)`.
Both implementations now use the same semantic: project-ownership-based filtering.

### Gate 4 Deadlock Root Cause — RESOLVED
**Root Cause:** `DELETE FROM auth.users WHERE email LIKE 'it-%@chef.local'` in per-test `ensure()` caused concurrent transactions to cascade-lock `personal_preferences` (FK cascade).
**Fix:** Removed DELETE from `ensure()`. `ON CONFLICT DO NOTHING` handles idempotent inserts.
**Classification:** Test infrastructure bug (not product bug). No production code affected.

### retryCapReached() Dead Code — NOT CHANGED (outside OD scope)
`src/core/taskEngine.ts:81` — called only in tests. Logic duplicated inline. Outside OD33/OD35 scope. Flagged for future gate.

## Evidence Integrity
- Gate 19 evidence corrected: 846/846 → 845/846 (transparent language, no rewriting)
- All Gate 20 changes verified by tests + source search
