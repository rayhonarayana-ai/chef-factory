# GATE 4 READINESS REPORT

> **Date:** 2026-08-17
> **Source:** Forensic audit of Gate 3 implementation
> **Status:** READY_FOR_OWNER_APPROVAL
> **Gate 3 baseline:** FROZEN

---

## 1. Architectural Bottleneck Analysis

The Gate 3 forensic audit revealed that the system has enterprise governance and basic tool calling, but three critical gaps prevent it from being production-ready:

### Bottleneck 1: Conversation History Not Fed to LLM (CRITICAL)

The system persists conversation messages but never loads them into the LLM execution context. This means:
- Multi-turn conversation is architecturally broken
- The LLM cannot reference previous exchanges
- The `conversation_id` mechanism is a dead feature
- The live "continuity test" passed only because the test script manually built messages with history

**Root cause:** `handlers.ts:80` calls `pipeline.run(actorCtx(), command)` without passing conversation history. The execution pipeline's `runToolLoop()` builds messages from scratch each time.

**Fix required:** Load conversation history in handlers.ts and pass it through the pipeline to the execution runner.

### Bottleneck 2: ToolBroker Security Guard Not Wired (HIGH)

The ToolBroker has an optional `securityGuard` hook, but:
- `initializeToolBroker()` does not accept a securityGuard parameter
- `broker.call()` is invoked with `{ decision: 'auto', approved: true }` — always passes authority check
- The Guardian IS called at pipeline level, but NOT per individual tool call

**Impact:** Tool calls inside the execution loop bypass per-tool security evaluation. If a malicious prompt injection causes the LLM to issue a tool call, the Guardian does not evaluate it at the tool-call level.

### Bottleneck 3: ToolBroker Authority Resolution Incomplete (HIGH)

The `broker.call()` context uses `decision: 'auto'` which means:
- The ToolBroker authority check `if (ctx.decision === 'deny')` is always false
- The risk check compares request.risk vs tool.minRisk, which works
- But the authority level is never resolved from the owner's actual authority

**Fix required:** Resolve owner authority before calling broker.call() and pass the resolved decision.

---

## 2. What Gate 4 Should NOT Include

Based on the current system state, the following are explicitly OUT OF SCOPE for Gate 4:

- Growth Engine (not designed)
- Sales Engine (not designed)
- Deployment (requires infrastructure design)
- Full multi-agent autonomy (agents need lifecycle first)
- Browser automation (requires sandboxing)
- Memory/vector backend (requires embedding strategy)
- Kubernetes/microservices (infrastructure change)
- New LLM providers (3 providers already implemented)

---

## 3. What Gate 4 SHOULD Include

Based on the forensic findings, Gate 4 should focus on:

### 3.1 Fix Gate 3 Drift (REQUIRED)

| # | Item | Priority | Effort |
|---|------|----------|--------|
| 1 | Wire conversation history into LLM pipeline | CRITICAL | MEDIUM |
| 2 | Wire ToolBroker securityGuard in execution loop | HIGH | LOW |
| 3 | Fix ToolBroker authority resolution | HIGH | LOW |
| 4 | Verify all fixes with regression + live tests | CRITICAL | MEDIUM |

### 3.2 Activate Deferred Gate 2 Items (RECOMMENDED)

| # | Item | Priority | Effort |
|---|------|----------|--------|
| 5 | Wire 5 anomaly counters | MEDIUM | LOW |
| 6 | Wire 5 rate-limit failure scopes | MEDIUM | LOW |
| 7 | Configure cost limits (OD2) | MEDIUM | LOW |

### 3.3 Expand Tool Registry (OPTIONAL)

| # | Item | Priority | Effort |
|---|------|----------|--------|
| 8 | Add delete_project tool | MEDIUM | LOW |
| 9 | Add archive_task tool | LOW | LOW |
| 10 | Add search tool | LOW | MEDIUM |

---

## 4. Security Status for Gate 4

### Existing Controls (Verified in Gate 3)

| Control | Status |
|---------|--------|
| Owner authentication | VERIFIED |
| RLS on all tables | VERIFIED |
| ToolBroker authority check | EXISTS but bypassed in execution loop |
| ToolBroker risk check | WORKING |
| Guardian at pipeline level | WORKING |
| Guardian at tool-call level | NOT WIRED |
| Critical action classification | WORKING (v2, 25 rules) |
| Loop protection (max 10 rounds) | WORKING |
| Rate limits (100/hr tool, 200/hr model) | DEFINED but not fully enforced |
| Secret redaction | WORKING |
| Conversation append-only | WORKING |

### New Controls Required for Gate 4

| # | Control | Priority |
|---|---------|----------|
| 1 | Per-tool-call Guardian evaluation | CRITICAL |
| 2 | Owner authority resolution before tool execution | HIGH |
| 3 | Conversation history integrity verification | MEDIUM |

---

## 5. Database Changes Required

**NONE.** Gate 4 should not modify the database schema. All three Gate 3 tables are correctly designed. The fixes are in source code only.

---

## 6. API Changes Required

**NONE.** The existing API endpoints are correctly designed. The fixes are in the internal pipeline and execution runner.

---

## 7. Test Requirements

| Suite | Minimum Count | Focus |
|-------|---------------|-------|
| Conversation history loading | 4+ | History loaded, windowed, correct ordering |
| ToolBroker securityGuard wiring | 3+ | Guardian called per tool call |
| Authority resolution | 3+ | Owner authority resolved before broker.call() |
| Regression | All 222 must pass | No regressions |
| Live verification | OpenAI + 1 more | Tool calling + conversation continuity |

---

## 8. Evidence Requirements

| # | Capability | Required Evidence |
|---|-----------|-------------------|
| 1 | Conversation history loaded | Unit test + live multi-turn test |
| 2 | ToolBroker securityGuard wired | Unit test showing Guardian called |
| 3 | Authority resolved | Unit test showing correct decision passed |
| 4 | Regression green | 222+ tests pass |
| 5 | Live verification | At least 1 provider tool calling + conversation continuity |
| 6 | Zero residue | DB query shows no test data |

---

## 9. Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Conversation history loading breaks existing tests | MEDIUM | LOW | Additive change, existing tests don't use history |
| SecurityGuard wiring introduces false denials | MEDIUM | MEDIUM | Test with known-safe tool calls first |
| Authority resolution changes behavior | HIGH | LOW | Only affects tool execution path, not informational |
| Live provider changes break tool calling | HIGH | LOW | OpenAI already verified; changes are internal |

---

## 10. Final Recommendation

```
GATE_4_READINESS = READY_FOR_OWNER_APPROVAL
GATE_4_PROPOSED_MISSION = Fix Gate 3 drift + activate deferred Gate 2 items
GATE_4_SCOPE_SUMMARY = 3 critical fixes + 2 deferred activations + optional tool expansion
```

Gate 4 should focus on making the Gate 3 implementation actually work as designed, not on adding new capabilities. The forensic audit found that the architecture is sound but the implementation has three drift gaps that need closing.
