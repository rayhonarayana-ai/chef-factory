# GATE 19 — MISSION OPTIONS

**Date:** 2026-08-19
**Scope:** Mission candidates for Gate 19 implementation

---

## Mission Option 1: Tool Handler Store Port Refactor (RECOMMENDED)

**Score:** 64/100
**Risk:** LOW
**Scope:** 6 tool handlers + Store port + tests

### What It Fixes
1. 6 tool handlers bypass Store port (getPool → Store)
2. queryAudit bypasses Store (handlers.ts)
3. archiveConversation bug (returns false always)
4. No state transition validation in update-task
5. Tools accept arbitrary status strings
6. Tool results not saved to conversation history

### Implementation Plan
1. Add to Store port (ports.ts): `createTask`, `createProject`, `listTasks`, `listProjects`, `patchTask`, `queryAudit`
2. Implement in SupabaseStore (repo.ts) using existing SQL from tool handlers
3. Implement in MemoryStore (memoryStore.ts)
4. Refactor 6 tool handlers to accept Store via input (remove getPool imports)
5. Refactor ToolBroker to pass Store to tool handlers
6. Fix archiveConversation (use pool.query directly for rowCount)
7. Add state transition validation in update-task (import canTransition)
8. Validate status against TASK_STATUSES in create-task, list-tasks, update-task
9. Wire tool results to conversation history (append tool role messages)
10. Add tests for all new Store methods + tool handler behavior

### Expected Tests: +20-30 (749 → 769-779)
### Files Modified: ~12
### DB Changes: NONE
### API Changes: NONE

---

## Mission Option 2: Dead Retry Pipeline (Task Scheduler)

**Score:** 67/100
**Risk:** MEDIUM-HIGH
**Scope:** New task scheduler + worker + retry logic

### What It Fixes
1. Failed tasks stuck in 'queued' with no re-execution
2. Approved tasks stuck in 'queued' with no re-execution
3. No automatic retry loop

### Why NOT Recommended
- Requires building new infrastructure (task scheduler/worker)
- Significant new capability, not a bottleneck fix
- Should be a dedicated gate (Gate 20+)
- Complexity is MEDIUM-HIGH (new patterns, new failure modes)

---

## Mission Option 3: Security Authority Chain Fix

**Score:** 64/100
**Risk:** LOW
**Scope:** 2 files (orchestration.ts, execution.ts)

### What It Fixes
1. Guardian hook hardcodes authorized:true
2. Authority resolution weakened in tool calls

### Why NOT Standalone
- Contained fix (2 lines) that should bundle with C-TOOLREF
- Low standalone leverage
- Better as part of architecture restoration

---

## Mission Option 4: archiveConversation Bug Fix

**Score:** 60/100
**Risk:** VERY LOW
**Scope:** 1 file (repo.ts)

### What It Fixes
1. DELETE /api/conversations/:id always returns 404
2. archiveConversation always returns false

### Why NOT Standalone
- Trivial one-line fix
- Should bundle with C-TOOLREF
- Low standalone leverage

---

## Recommendation

**Select Mission Option 1: Tool Handler Store Port Refactor**

Rationale:
- Highest leverage (fixes 6+ issues at once)
- Architectural equivalent of Gate 18 (ConversationService → Tool handlers)
- Bounded scope (12 files, no DB changes)
- Low risk (pure refactor)
- Testable (MemoryStore already exists)
- Prevents future problems (each new tool inherits the bypass pattern)

### Bundled Fixes
The following should be bundled into Mission Option 1:
- F-SEC-01: Guardian authorized:true (orchestration.ts + execution.ts)
- F-DATA-01: archiveConversation bug (repo.ts)
- F-ARCH-02: queryAudit bypass (handlers.ts + ports.ts)
- F-DATA-02: State transition validation (update-task.ts)
- F-DATA-03: Tool results to conversation (handlers.ts + streaming.ts)

---

## Knowledge Reuse from Previous Gates

| Gate | Pattern | Reuse |
|------|---------|-------|
| Gate 18 | ConversationService → Store port refactor | IDENTICAL pattern for tool handlers |
| Gate 18 | MemoryStore conversation methods | IDENTICAL pattern for tool CRUD methods |
| Gate 18 | Store interface extension | Same approach (ports.ts) |
| Gate 18 | DRY fix (handlers + streaming) | Same approach (pass store) |
| Gate 7 | Query timeout/byte limit enforcement | Can reference for query-data.ts |
| Gate 12 | Workflow tests | Pattern for tool handler tests |
