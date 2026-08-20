# GATE 19 — FORENSIC REVIEW

**Date:** 2026-08-19
**Scope:** Deep source analysis of all confirmed Gate 19 findings

---

## Verified Findings (All CONFIRMED by independent code review)

### F-ARCH-01: Tool Handler Store Bypass (6 locations)

All 6 tool handlers import `getPool` directly from `../db/pool.js` and use the fallback pattern `input.db ?? getPool()`:

| File | Import Line | Usage Line | SQL Pattern |
|------|-------------|------------|-------------|
| `create-task.ts` | 4 | 18 | INSERT with hardcoded columns |
| `create-project.ts` | 4 | 26 | INSERT with hardcoded columns |
| `list-tasks.ts` | 4 | 15 | SELECT with inline WHERE |
| `list-projects.ts` | 4 | 10 | SELECT with inline WHERE |
| `update-task.ts` | 4 | 38 | UPDATE with inline SET |
| `query-data.ts` | 9 | 180 | Complex SELECT with aggregation |

**Impact:** Each handler duplicates query logic that exists in `SupabaseStore`. Store-level changes (column additions, RLS adjustments, query auditing) will not apply to these paths.

---

### F-ARCH-02: queryAudit Bypasses Store

**File:** `handlers.ts:370-381`
```typescript
private async queryAudit(ownerId: string, json: Record<string, unknown>) {
    void ownerId;
    const limit = typeof json.limit === 'number' ? Math.min(200, Math.max(1, json.limit)) : 50;
    const conn = await import('../db/pool.js').then((m) => m.getPool());
    const res = await conn.query(
      `select * from public.audit_events where project_id in (select id from public.projects where owner_id = $1)
       order by id desc limit $2`,
      [ownerId, limit],
    );
    return res.rows.map((r) => redactForLog(JSON.parse(JSON.stringify(r))));
  }
```

**Impact:** Dynamic `import()` of `getPool()`, raw SQL, no Store-port counterpart. Cannot be mocked or overridden through the Store interface.

---

### F-DATA-01: archiveConversation Always Returns False

**File:** `repo.ts:794-801`
```typescript
async archiveConversation(ownerId: string, conversationId: string): Promise<boolean> {
    const res = await this.q<{ rowCount: number }>(
      `UPDATE public.conversations SET status = 'archived'
       WHERE id = $1 AND owner_id = $2`,
      [conversationId, ownerId],
    );
    return (res[0]?.rowCount ?? 0) > 0;
  }
```

**Root cause:** `this.q()` wraps `pool.query()` and returns `res.rows`. For UPDATE without RETURNING, `res.rows` is empty. Therefore `res[0]` is `undefined`, and the method always returns `false`.

**Downstream:** `handlers.ts:121-127` — DELETE endpoint always returns 404.

**Fix:** Use `this.pool.query()` directly and inspect `res.rowCount`.

---

### F-SEC-01: Guardian Hardcodes authorized:true (2 locations)

**Location A:** `orchestration.ts:388`
```typescript
authorized: true,
explicitDeny: false,
authorityOutcome: 'auto',
```

**Location B:** `execution.ts:439`
```typescript
authorized: true,
explicitDeny: false,
authorityOutcome: 'auto',
```

**Impact:** Guardian's `evaluate()` receives `authorized: true` from both orchestration paths. Future Guardian logic checking `req.authorized` will always see `true`.

---

### F-SEC-02: SSL Cert Verification Disabled

**File:** `pool.ts:23`
```typescript
ssl: { rejectUnauthorized: false },
```

**Impact:** MITM risk on DB connection. Accepts any TLS certificate without CA verification.

---

### F-DATA-02: No State Transition Validation in update-task

**File:** `update-task.ts:20-22`
```typescript
if (typeof args.status === 'string') {
    updates.push(`status = $${paramIdx++}`);
    params.push(args.status);
}
```

**Impact:** Any status string can be set on any task. No validation against `TASK_STATUSES` or `TRANSITIONS` map. A `completed` task can be moved back to `queued`.

---

### F-DATA-03: Tool Results Not Saved to Conversation

**File:** `handlers.ts:95-100`
```typescript
await this.conversations.appendMessage({
  conversationId: convId,
  ownerId: owner.id,
  role: 'assistant',
  content: responseText,
});
```

**Impact:** Only `user` and `assistant` messages persisted. Tool call results (`tool` role) are not saved. Multi-turn context degraded — LLM cannot see previous tool outputs.

**Note:** The `appendMessage` API already supports `tool` role and `toolCallId`. It simply is not wired.

---

### F-RUNTIME-01: Dead Retry Pipeline

**File:** `pipeline.ts:578`
```typescript
why: handled.stopped
  ? `Reached ${handled.task.attempts}/${handled.task.maxAttempts} attempts. State preserved; owner intervention required.`
  : `Attempt ${handled.task.attempts}/${handled.task.maxAttempts} failed. No automatic retry loop is running.`,
```

**Impact:** Task re-queued to `'queued'` but nothing re-executes it. The developer's own comment documents the dead end.

---

### F-RUNTIME-02: No Task Scheduler/Worker

**Verified:** Grep for `setInterval`, `cron`, `schedule`, `enqueue`, `dequeue`, `processQueue`, `pollTasks`, `worker.start` across `src/` returned zero matches for any task scheduler pattern.

---

## Findings NOT Confirmed

| Reported Finding | Actual Status |
|------------------|---------------|
| Non-streaming 30s timeout in handlers.ts | WRONG LOCATION — timeout is in `server.ts:38,213-218` |
| Tool status enum mismatch (specific values) | PARTIALLY — tools accept arbitrary strings, but the mismatch is about missing validation, not wrong enum values |

---

## Forensic Review Conclusion

All major findings are CONFIRMED. The tool handler Store bypass pattern is the most architectural issue, affecting 6 files and duplicating business logic. The archiveConversation bug is a trivial fix with high user impact. The Guardian hardcoding is a security concern that should be addressed as part of the authority chain restoration.
