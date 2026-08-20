# Gate 20 Evidence
**Date: 2026-08-19**

## OD33: Tool Schema Correctness

### Before (broken)
```typescript
// src/tools/index.ts:57 (list_tasks)
status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'] }
// src/tools/index.ts:92 (update_task)
status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'] }
```
`pending` and `in_progress` are not in `TASK_STATUSES`. LLM generates invalid values.

### After (correct)
```typescript
// list_tasks — all canonical statuses
enum: ['created', 'queued', 'running', 'completed', 'failed', 'cancelled', 'paused', 'needs_approval']
// update_task — user-settable statuses (running is engine-set)
enum: ['created', 'queued', 'completed', 'failed', 'cancelled', 'paused', 'needs_approval']
```

### Test Evidence (gate20.test.ts)
- `'list_tasks status enum includes all canonical TASK_STATUSES'` — PASS
- `'update_task status enum includes all user-settable statuses'` — PASS
- `'tool schema has no obsolete status values (pending, in_progress)'` — PASS
- `'all tool definitions have required fields'` — PASS
- `'tool schema statuses are a subset of TASK_STATUSES'` — PASS

## OD33: Approval Timeout

### Before (broken)
```typescript
// src/api/handlers.ts — approval resolution
const approval = await this.store.getApproval(owner.id, approvalId);
// Directly resolves — no expiry check
const { approval: resolved, error } = resolveApproval({...});
```

### After (correct)
```typescript
const approval = await this.store.getApproval(owner.id, approvalId);
if (!approval) return { status: 404, json: { error: 'approval not found' } };
if (isExpired(approval)) {
  await this.store.patchApproval(owner.id, approvalId, {
    status: 'expired', decidedAt: new Date().toISOString(),
  });
  return { status: 409, json: { error: 'approval has expired' } };
}
const { approval: resolved, error } = resolveApproval({...});
```

### Test Evidence (gate20.test.ts)
- `'isExpired returns true when current time is after expiresAt'` — PASS
- `'isExpired returns false when no expiresAt is set'` — PASS
- `'approval timeout: handler rejects expired approval'` — PASS
- `'approval active: handler allows resolution of non-expired approval'` — PASS

## OD35: MemoryStore queryAudit

### Before (broken)
```typescript
// src/testing/memoryStore.ts:363
return this.audit.filter((e) => e.actorId === ownerId)...
```
SupabaseStore filters by project ownership. MemoryStore filtered by actorId.

### After (correct)
```typescript
const ownerProjectIds = new Set(
  this.projects.filter((p) => p.ownerId === ownerId).map((p) => p.id),
);
return this.audit
  .filter((e) => e.projectId != null && ownerProjectIds.has(e.projectId))...
```

### Test Evidence (gate20.test.ts + gate19.test.ts)
- `'filters audit events by project ownership, not actorId'` — PASS
- `'returns empty for owner with no projects'` — PASS
- `'returns empty when audit has no matching project'` — PASS
- `'respects limit parameter'` — PASS
- `'returns events in reverse chronological order'` — PASS
- `'handles multiple projects per owner'` — PASS
- All 4 updated Gate 19 queryAudit tests — PASS

## OD35: Gate 4 Deadlock Fix

### Before (broken)
```typescript
// src/integration/gate4.live.integration.test.ts:47
await client.query(`delete from auth.users where email like 'it-%@chef.local'`);
```
Blanket DELETE in per-test transaction. Concurrent transactions cascade-lock `personal_preferences`.

### After (correct)
```typescript
// Removed blanket DELETE. ON CONFLICT DO NOTHING handles idempotent inserts.
for (const id of [owner, other]) {
  await client.query(
    `insert into auth.users (...) values ($1, ...) on conflict (id) do nothing`, [id, ...]);
}
```

### Test Evidence
- Gate 4 live integration: 5/5 PASS (16582ms)
- No deadlock detected in full suite run
