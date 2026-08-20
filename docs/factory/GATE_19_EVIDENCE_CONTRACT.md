# GATE 19 — EVIDENCE CONTRACT

**Date:** 2026-08-19
**Scope:** Evidence items for Gate 19 implementation verification

---

## Evidence Items

### E-ARCH-01: Store Port Extended
**What:** Store interface (ports.ts) has CRUD methods for tasks and projects
**How:** Read ports.ts, verify createTask/createProject/listTasks/listProjects/patchTask/queryAudit methods exist
**Expected:** 6 new methods on Store interface

### E-ARCH-02: SupabaseStore Implements Tool CRUD
**What:** SupabaseStore (repo.ts) implements all new Store methods
**How:** Read repo.ts, verify implementations match tool handler SQL
**Expected:** 6 new methods in SupabaseStore

### E-ARCH-03: MemoryStore Implements Tool CRUD
**What:** MemoryStore (memoryStore.ts) implements all new Store methods
**How:** Read memoryStore.ts, verify in-memory implementations
**Expected:** 6 new methods in MemoryStore

### E-ARCH-04: Tool Handlers Use Store Port
**What:** 6 tool handlers accept Store via input (no getPool import)
**How:** Grep for getPool in src/tools/ — should be zero matches
**Expected:** 0 getPool imports in tool handlers

### E-ARCH-05: ToolBroker Passes Store to Handlers
**What:** ToolBroker injects Store into tool handler input
**How:** Read toolBroker.ts, verify store is passed to handler calls
**Expected:** store property in tool handler input

### E-BUG-01: archiveConversation Returns Correct Value
**What:** archiveConversation returns true when row is updated
**How:** Test: create conversation, archive it, verify return is true
**Expected:** return value matches row update status

### E-BUG-02: DELETE Endpoint Returns 200
**What:** DELETE /api/conversations/:id returns 200 for valid conversation
**How:** Test: create conversation via API, delete it, verify 200
**Expected:** HTTP 200, not 404

### E-SEC-01: Guardian Receives Actual Authorization State
**What:** securityGuardHook passes actual authorized state (not hardcoded true)
**How:** Read orchestration.ts:388 and execution.ts:439, verify authorized is not hardcoded
**Expected:** authorized reflects actual Gate 1 authorization result

### E-SEC-02: State Transition Validated
**What:** update-task validates status against TASK_STATUSES and canTransition
**How:** Test: attempt invalid transition (completed → queued), verify rejection
**Expected:** Invalid transitions rejected with error message

### E-SEC-03: Status Values Validated
**What:** Tools validate status against TASK_STATUSES
**How:** Test: attempt to create/update task with invalid status, verify rejection
**Expected:** Invalid status values rejected

### E-DATA-01: queryAudit Uses Store Port
**What:** queryAudit method exists on Store port and is used by handlers
**How:** Read handlers.ts, verify queryAudit calls this.store.queryAudit (not getPool)
**Expected:** No dynamic import of getPool in queryAudit

### E-DATA-02: Tool Results Saved to Conversation
**What:** Tool call results appended to conversation history as 'tool' role
**How:** Test: run pipeline with tool call, verify tool messages in conversation
**Expected:** tool role messages present in conversation history

### E-TEST-01: Store Method Tests Pass
**What:** Unit tests for all new Store methods
**How:** Run test suite, verify new tests pass
**Expected:** All new tests PASS

### E-TEST-02: Tool Handler Tests Pass
**What:** Unit tests for tool handler behavior with Store injection
**How:** Run test suite, verify tool handler tests pass
**Expected:** All tool handler tests PASS

### E-TEST-03: Full Regression Passes
**What:** All existing tests continue to pass
**How:** Run full test suite (npm test)
**Expected:** 749+ tests PASS, zero regressions

### E-TEST-04: tsc Clean
**What:** TypeScript compilation clean
**How:** Run tsc --noEmit
**Expected:** No errors

### E-TEST-05: Build Clean
**What:** Build succeeds
**How:** Run tsc -p tsconfig.build.json
**Expected:** No errors

---

## Evidence Matrix

| ID | Category | Priority | Verified By |
|----|----------|----------|-------------|
| E-ARCH-01 | Architecture | HIGH | Unit test + code review |
| E-ARCH-02 | Architecture | HIGH | Unit test + code review |
| E-ARCH-03 | Architecture | HIGH | Unit test + code review |
| E-ARCH-04 | Architecture | HIGH | Grep verification |
| E-ARCH-05 | Architecture | HIGH | Code review |
| E-BUG-01 | Data | HIGH | Unit test |
| E-BUG-02 | Product | HIGH | Integration test |
| E-SEC-01 | Security | HIGH | Code review + test |
| E-SEC-02 | Security | HIGH | Unit test |
| E-SEC-03 | Security | HIGH | Unit test |
| E-DATA-01 | Data | MEDIUM | Code review |
| E-DATA-02 | Product | MEDIUM | Integration test |
| E-TEST-01 | Testing | HIGH | Test run |
| E-TEST-02 | Testing | HIGH | Test run |
| E-TEST-03 | Testing | CRITICAL | Test run |
| E-TEST-04 | Testing | CRITICAL | tsc --noEmit |
| E-TEST-05 | Testing | CRITICAL | Build |
