# GATE 19 — DISCOVERY REPORT

**Date:** 2026-08-19
**Gate:** 19 — Post-Gate-18 Forensic System Audit
**Baseline:** 749/749 PASS (Gate 18 frozen)
**Classification:** GATE_19_DISCOVERY_COMPLETE

---

## Executive Summary

Gate 19 conducted a comprehensive forensic system audit across 3 parallel agents (Security+Architecture, Runtime+Reliability, Data+Evidence+Product) covering 65+ source files. The audit identified 47 unique findings across 8 categories and scored 10 bottleneck candidates using a 10-dimension formula.

**Top Bottleneck:** Tool Handler Store Port Refactor (Score 64/100)
**Recommended Mission:** Refactor 6 tool handlers to use Store port instead of raw SQL, fix archiveConversation bug, fix Guardian hardcoded authorization, add state transition validation

---

## Forensic Audit Methodology

### Phase 0: Baseline Verification
- Tests: 749/749 PASS
- tsc --noEmit: CLEAN
- build: CLEAN
- Gate 18 frozen baseline confirmed

### Phase 1-2: Gate Closure Verification
- Gate 18: PASS (749/749, Store boundary restored, 33 tests added)
- Gate 17: PARTIAL (OBSERVABILITY=VERIFIED, RECOVERY=UNPROVEN)

### Phase 3-9: 3 Parallel Forensic Agents

| Agent | Scope | Files Examined | Findings |
|-------|-------|----------------|----------|
| Agent 1: Security + Architecture | Auth boundaries, bypass paths, structural integrity | 45+ files | 17 findings |
| Agent 2: Runtime + Reliability | Retry, timeout, execution lifecycle, state management | 40+ files | 16 findings |
| Agent 3: Data + Evidence + Product | Store bypass, evidence integrity, API correctness | 45+ files | 14 findings |

### Phase 10: Scoring
- 10 bottleneck candidates scored (0-100 scale)
- Gate 17 Recovery re-evaluated as one candidate (ranked #10, Score 42/100)

---

## Findings Summary

### Category Breakdown

| Category | Count | CRITICAL | HIGH | MEDIUM | LOW |
|----------|-------|----------|------|--------|-----|
| Architecture (Store bypass) | 8 | 0 | 6 | 2 | 0 |
| Security (auth, SSL, injection) | 10 | 1 | 4 | 3 | 2 |
| Runtime (retry, timeout, lifecycle) | 12 | 2 | 6 | 3 | 1 |
| Data (integrity, consistency) | 7 | 1 | 3 | 2 | 1 |
| Evidence (quality, completeness) | 5 | 0 | 0 | 4 | 1 |
| Product (API, UX, workflow) | 5 | 1 | 2 | 2 | 0 |
| **Total** | **47** | **5** | **21** | **16** | **5** |

### Top 10 Bottleneck Candidates

| Rank | ID | Title | Score | Category |
|------|-----|-------|-------|----------|
| 1 | C-RETRY | Dead Retry/Approval Pipeline | 67 | Runtime |
| 2 | **C-TOOLREF** | **Tool Handler Store Port Refactor** | **64** | **Architecture** |
| 3 | C-GUARD | Guardian Hardcodes authorized:true | 64 | Security |
| 4 | C-ARCHIVE | archiveConversation Always Returns False | 60 | Data+Product |
| 5 | C-TIMEOUT | Unbounded LLM Execution Time | 55 | Runtime |
| 6 | C-CANCEL | Pipeline Cancellation Gap | 54 | Runtime |
| 7 | C-STATUS | Task Status Enum Mismatch | 52 | Product |
| 8 | C-RACE | Rate Limit Persistence Race | 50 | Security |
| 9 | C-CONTEXT | Conversation Context Degradation | 44 | Product |
| 10 | C-RECOVERY | Security Audit Event Recovery (Gate 17) | 42 | Security |

### Gate 17 Recovery Re-evaluation

| Dimension | Assessment |
|-----------|------------|
| Event loss still scoped to DB outage? | YES |
| Observability sufficient? | YES (Gate 17 PASS) |
| Security decisions depend on DB? | PARTIALLY (in-memory is primary) |
| Compliance requirement? | NO explicit deadline |
| Operational requirement? | LOW (DB uptime is high) |
| Reusable durable mechanism? | NO (would need new infrastructure) |
| Complexity? | MEDIUM-HIGH |
| Attack surface? | LOW |
| Risk of duplicate events? | MEDIUM |
| Value vs complexity? | LOW-MEDIUM |
| **Rank** | **#10 (Score 42/100)** |

---

## Scoring Formula

Each candidate scored 0-10 in 10 dimensions:

1. **Security Risk** — Does this create or leave attack surface?
2. **Correctness Risk** — Does this produce wrong results?
3. **Data Integrity Risk** — Does this corrupt or lose data?
4. **Runtime Risk** — Does this cause failures/hangs in production?
5. **Architecture Risk** — Does this violate structural principles?
6. **Business Impact** — Does this affect core business logic?
7. **User Impact** — Does this affect end-user experience?
8. **Evidence Gap** — How well-proven is this finding?
9. **Implementation Leverage** — How many issues does fixing this resolve?
10. **Testability** — How easily can this be verified with tests?

**Total = sum / 100**

---

## Candidate Details

### C-RETRY: Dead Retry/Approval Pipeline (Score 67/100)

**Finding:** When a task fails, `handleTaskFailure()` sets status to `'queued'` but no scheduler or worker re-executes it. When the owner approves a `needs_approval` task, it moves to `'queued'` with no automatic re-execution. Both paths are documented dead ends.

**Evidence:**
- `pipeline.ts:578` — Comment literally states "No automatic retry loop is running"
- No `setInterval`, `cron`, `schedule`, or worker pattern found in `src/`
- `taskEngine.ts:55-70` — `handleTaskFailure()` re-queues to `'queued'` with no trigger

**Why #1 in score:** Runtime Risk=10, User Impact=9, Business Impact=8, Correctness=9
**Why NOT recommended:** Requires building new infrastructure (task scheduler/worker). This is a feature addition, not a bottleneck fix. The task scheduler is a significant new capability that should be a dedicated gate.

---

### C-TOOLREF: Tool Handler Store Port Refactor (Score 64/100) — RECOMMENDED

**Finding:** 6 tool handlers import `getPool()` directly and execute raw SQL, bypassing the Store port. This duplicates business logic, creates authorization surface area, and prevents consistent data access patterns.

**Evidence (all confirmed):**
| File | Line | Bypass |
|------|------|--------|
| `create-task.ts` | 18 | `input.db ?? getPool()` |
| `create-project.ts` | 26 | `input.db ?? getPool()` |
| `list-tasks.ts` | 15 | `input.db ?? getPool()` |
| `list-projects.ts` | 10 | `input.db ?? getPool()` |
| `update-task.ts` | 38 | `input.db ?? getPool()` |
| `query-data.ts` | 180 | `input.db ?? getPool()` |

**Additional verified issues fixed by this refactor:**
- `queryAudit` in `handlers.ts:370-381` bypasses Store via dynamic `import()` of `getPool()`
- `update-task.ts` has NO state transition validation (any status can be set on any task)
- Tools accept arbitrary status strings (not validated against `TASK_STATUSES`)
- Tool results not saved to conversation history (degrades multi-turn context)

**Why recommended:**
1. Architectural equivalent of Gate 18 (ConversationService bypass → Tool handler bypass)
2. Fixes 6+ issues at once (highest leverage)
3. Prevents future problems (each new tool inherits the bypass pattern)
4. Bounded scope (6 files + tests)
5. No new infrastructure required
6. No DB changes
7. Testable with MemoryStore

---

### C-GUARD: Guardian Hardcodes authorized:true (Score 64/100)

**Finding:** Both security guard hook closures hardcode `authorized: true` in the `SecurityRequest` passed to `SecurityGuardian.evaluate()`.

**Evidence (confirmed in 2 locations):**
- `orchestration.ts:388` — `authorized: true`
- `execution.ts:439` — `authorized: true`

**Impact:** The Guardian may still deny based on its own policies (lockdown, critical action registry, rate limits), but any future Guardian logic checking `req.authorized` will always see `true`.

**Why not recommended as standalone:** This is a contained fix (2 lines) that should be bundled with C-TOOLREF as part of the authority chain restoration.

---

### C-ARCHIVE: archiveConversation Always Returns False (Score 60/100)

**Finding:** `archiveConversation()` uses `this.q()` which returns `res.rows` (empty for UPDATE without RETURNING). The DB row IS updated, but the method always returns `false`. This causes `DELETE /api/conversations/:id` to always return 404.

**Evidence:**
- `repo.ts:794-801` — `this.q()` returns `[]` for UPDATE, so `(res[0]?.rowCount ?? 0) > 0` is always `false`
- `handlers.ts:121-127` — `if (!archived) return { status: 404 }` always triggers

**Why not recommended as standalone:** Trivial one-line fix that should be bundled with C-TOOLREF.

---

## Recommended Mission: Tool Handler Store Port Refactor

### Scope
1. Add CRUD methods to Store port (ports.ts): `createTask`, `createProject`, `listTasks`, `listProjects`, `patchTask`
2. Implement in SupabaseStore (repo.ts) using existing SQL from tool handlers
3. Implement in MemoryStore (memoryStore.ts) using in-memory arrays
4. Refactor 6 tool handlers to accept Store via input (remove `getPool()` imports)
5. Refactor tool broker to pass Store to tool handlers
6. Fix `archiveConversation` bug (use `pool.query()` directly for `rowCount`)
7. Add `queryAudit` to Store port
8. Add state transition validation in `update-task.ts`
9. Validate status against `TASK_STATUSES` in tools
10. Add tests for all new Store methods + tool handler behavior

### Risk: LOW
- Pure refactor (same behavior, different dependency injection)
- No DB schema changes
- No API contract changes
- No new execution paths
- Existing tests serve as regression baseline

### Expected Impact
- 6 authorization surface areas closed
- Duplicate business logic eliminated
- State machine enforced in tools
- Status validation added
- Store boundary restored for all data access

---

## Gate 19 Documentation Files

| File | Purpose |
|------|---------|
| GATE_19_DISCOVERY_REPORT.md | This file — full forensic audit + scoring |
| GATE_19_FORENSIC_REVIEW.md | Deep source analysis + findings validation |
| GATE_19_MISSION.md | Mission options + recommendation + ranking |
| GATE_19_SECURITY.md | Security findings + invariants verification |
| GATE_19_EVIDENCE_CONTRACT.md | Evidence items for implementation |
| GATE_19_DECISIONS.md | Owner decisions + technical decisions |
| GATE_19_FORENSIC_CLOSURE.md | Forensic closure verification |
