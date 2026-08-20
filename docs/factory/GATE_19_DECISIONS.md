# GATE 19 — DECISIONS

**Date:** 2026-08-19
**Scope:** Owner decisions and technical decisions for Gate 19

---

## Owner Decisions

### OD28: Approve Tool Handler Store Port Refactor as Gate 19 Mission?

**Question:** Should Gate 19 implement the Tool Handler Store Port Refactor (Score 64/100)?

**Recommendation:** YES

**Rationale:**
1. Architectural equivalent of Gate 18 (ConversationService → Tool handlers)
2. Fixes 6+ issues at once (highest leverage)
3. Bounded scope (12 files, no DB changes)
4. Low risk (pure refactor)
5. Prevents future problems (each new tool inherits the bypass pattern)

**Alternative considered:** Dead Retry Pipeline (Score 67/100) — rejected because it requires building new infrastructure (task scheduler/worker), which is a feature addition, not a bottleneck fix.

---

### OD29: Bundle Security Authority Chain Fix?

**Question:** Should the Guardian `authorized:true` hardcoding fix (orchestration.ts:388, execution.ts:439) be bundled into Gate 19?

**Recommendation:** YES

**Rationale:**
- Contained fix (2 lines)
- Part of authority chain restoration
- Low standalone leverage, high bundled leverage
- Should be fixed as part of architecture restoration

---

### OD30: Bundle archiveConversation Bug Fix?

**Question:** Should the archiveConversation bug fix (repo.ts:794-801) be bundled into Gate 19?

**Recommendation:** YES

**Rationale:**
- Trivial one-line fix
- High user impact (DELETE endpoint always 404)
- Should be fixed as part of Store port restoration

---

### OD31: Bundle State Transition Validation?

**Question:** Should update-task.ts get state transition validation (import canTransition from taskEngine.ts)?

**Recommendation:** YES

**Rationale:**
- Security concern (any status can be set on any task)
- Part of architecture restoration
- Low complexity (import + validate)

---

### OD32: Bundle Tool Results to Conversation?

**Question:** Should tool call results be saved to conversation history (append tool role messages)?

**Recommendation:** YES

**Rationale:**
- Product improvement (multi-turn context degraded without tool results)
- API already supports it (appendMessage accepts tool role)
- Low complexity (wire pipeline to append tool messages)
- Evidence of capability (conversation.test.ts can verify)

---

## Technical Decisions

### TD-01: Store Port Methods

**Decision:** Add 6 methods to Store port: `createTask`, `createProject`, `listTasks`, `listProjects`, `patchTask`, `queryAudit`

**Rationale:** These match the raw SQL operations in the 6 tool handlers + queryAudit.

---

### TD-02: Tool Handler Input Contract

**Decision:** Tool handlers accept `Store` via `input.store` property (not `input.db`)

**Rationale:** Consistent with Gate 18 pattern (ConversationService accepts Store via constructor). The `input.db` property is deprecated.

---

### TD-03: archiveConversation Fix

**Decision:** Use `this.pool.query()` directly (not `this.q()`) and inspect `res.rowCount`

**Rationale:** `this.q()` returns `res.rows` which is empty for UPDATE. `pool.query()` returns `res.rowCount` which is correct.

---

### TD-04: State Transition Validation

**Decision:** Import `canTransition` from `taskEngine.ts` and validate before SQL UPDATE

**Rationale:** Reuses existing state machine logic. No new patterns.

---

### TD-05: Tool Results Wiring

**Decision:** In handlers.ts and streaming.ts, after pipeline execution, append tool call results as 'tool' role messages

**Rationale:** The `appendMessage` API already supports `tool` role. Just need to extract tool results from pipeline output and append them.

---

## Decisions Not Requiring Owner Approval

| Decision | Rationale |
|----------|-----------|
| Use existing canTransition from taskEngine.ts | Technical implementation detail |
| Use pool.query for archiveConversation fix | Technical implementation detail |
| Validate status against TASK_STATUSES | Security requirement |
| Wire tool results to conversation | Product improvement within scope |
