# CHEF FACTORY — Gate 9 Forensic Closure

> Date: 2026-08-17
> Classification: GATE_9_PASS
> Current baseline: 427/427 tests (35 test files)
> tsc --noEmit: CLEAN

---

## Gate 9 Mission

**Wire Orchestration Engine into Production Pipeline** (fix F-G8-01)

The Gate 8 orchestrator was dead code. `runOrchestration()` in pipeline.ts created an orchestration plan but never called `executeOrchestration()`. Instead it called `this.execution.execute()`, which was the single-step execution path. The entire Gate 8 orchestration module (plan validation, step sequencing, ToolBroker boundary, Guardian wiring, authority resolution) was unreachable from the production code path.

## What Was Done

### Core Implementation (2 files modified)

**`src/core/pipeline.ts`**
- Added `PlanStepsResult` interface (lines 65-69)
- Added `planSteps?()` method to `ExecutionRunner` interface (lines 78-83)
- Rewrote `runOrchestration()` (lines 547-724):
  - Calls `this.execution.planSteps()` to get LLM-proposed real tool steps
  - Creates an `OrchestrationPlan` via `createPlan()` with those real steps
  - Calls `executeOrchestration(plan, orchestrationCtx)` — the real orchestrator
  - Records planning cost, orchestrator audit, handles success/failure paths
  - Falls back to `'failed'` if `planSteps` is absent or returns null

**`src/api/execution.ts`**
- Implemented `planSteps()` in `createExecutionRunner()` (lines 164-286):
  - Uses existing ModelGateway + ProviderAdapter to call LLM
  - Defines a `propose_plan` tool that the LLM calls to return structured plan steps
  - System prompt instructs LLM to decompose multi-step commands into ordered tool steps
  - Validates response structure (tool names, args, descriptions, dependsOn)
  - Returns `PlanStepsResult` with cost tracking

### Test Files (2 new files)

**`src/core/gate9.test.ts`** — 18 unit tests
| Test | What it proves |
|------|---------------|
| G9-01 | Multi-step routes to runOrchestration (not executeTask) |
| G9-02 | No bypass: single-step stays on executeTask |
| G9-03 | Steps execute through orchestrator |
| G9-04 | ToolBroker boundary in orchestrator |
| G9-05 | Guardian wired into orchestrator |
| G9-06 | Authority resolution per-step |
| G9-07 | Deny stops orchestration |
| G9-08 | Approval pause |
| G9-09 | Dependency failure stops |
| G9-10 | Single-step backward compat |
| G9-11 | Step limit enforced |
| G9-12 | No duplicate execution |
| G9-13 | Response reflects orchestration |
| G9-14 | Null planSteps → graceful failure |
| G9-15 | Planning cost recorded |
| G9-16 | Backward compat (no planSteps method) |
| G9-17 | Task lifecycle complete |
| G9-18 | Authority resolution evidence in output |

**`src/integration/gate9.live.integration.test.ts`** — 9 live tests
| Test | What it proves |
|------|---------------|
| E1+E2 | Real multi-step enters pipeline → executeOrchestration() |
| E3+E4 | Real plan validation + step execution |
| E5+E6 | Real ToolBroker + Guardian paths used |
| E7 | Real authority evaluation |
| E8 | Tool action exactly once per step |
| E9 | Failure semantics (validation error) |
| E10 | Dependent step execution |
| E11 | Response reflects orchestration |
| E12 | No duplicate DB mutation |

## Forensic Audit (10 checks)

| # | Check | Result |
|---|-------|--------|
| F1 | `executeOrchestration()` reachable from production pipeline | ✅ VERIFIED — called at pipeline.ts:620 |
| F2 | `planSteps()` returns real tool steps (not stub) | ✅ VERIFIED — uses ModelGateway + propose_plan tool |
| F3 | No dead-code-only implementation | ✅ VERIFIED — planSteps + executeOrchestration both called |
| F4 | Single-step path unchanged | ✅ VERIFIED — one call to execution.execute() at line 442 |
| F5 | ToolBroker chain (execute=false + handler exactly once) | ✅ VERIFIED — orchestration.ts:403 + :432 |
| F6 | Authority resolution per-step | ✅ VERIFIED — orchestration.ts:375 |
| F7 | SecurityGuardian wired through orchestrator | ✅ VERIFIED — pipeline.ts:613 → orchestration.ts:201-233 |
| F8 | No bypass paths | ✅ VERIFIED — multi-step always goes through runOrchestration |
| F9 | Rate limiting per-step | ✅ VERIFIED — orchestration.ts:346 |
| F10 | All Gate 5-8 invariants intact | ✅ VERIFIED |

## Gate 5 Invariants Verification

| Invariant | Status |
|-----------|--------|
| G5-01: Single execution (ToolBroker validate-only, handler once) | ✅ PRESERVED |
| G5-02: Security chain (Guardian → ToolBroker) | ✅ PRESERVED |
| G5-03: Authority resolution per-tool-call | ✅ PRESERVED |
| G5-04: Cost protection limits | ✅ PRESERVED |
| G5-05: Prompt injection deny | ✅ PRESERVED |
| G5-06: Anomaly detection | ✅ PRESERVED |
| G5-07: Owner/project isolation | ✅ PRESERVED |
| G5-08: ToolBroker boundary | ✅ PRESERVED |

## Test Summary

| Category | Count | Pass | Fail |
|----------|-------|------|------|
| Gate 9 unit tests | 18 | 18 | 0 |
| Gate 9 live integration | 9 | 9 | 0 |
| Gate 8 baseline (frozen) | 400 | 400 | 0 |
| **Total** | **427** | **427** | **0** |

## Call Graph — Before vs After

### Before (F-G8-01 — DEFECTIVE)
```
pipeline.run()
  → detectMultiStepCommand()
  → runOrchestration()
    → this.execution.execute()          ← SINGLE-STEP PATH, ignores orchestration
    ← Orchestration engine never called
```

### After (Gate 9 — FIXED)
```
pipeline.run()
  → detectMultiStepCommand()
  → runOrchestration()
    → this.execution.planSteps()        ← LLM proposes real tool steps
    → createPlan()                      ← OrchestrationPlan with real steps
    → executeOrchestration()            ← REAL ORCHESTRATOR
      → ToolBroker.validate()
      → Guardian.evaluate()
      → evaluateAuthority()
      → handler() (exactly once)
```

## Files Modified

| File | Lines Added | Change |
|------|-------------|--------|
| `src/core/pipeline.ts` | +180 | PlanStepsResult, planSteps interface, rewrote runOrchestration |
| `src/api/execution.ts` | +130 | planSteps() implementation with propose_plan tool |
| `src/core/gate9.test.ts` | +400 | 18 unit tests (NEW) |
| `src/integration/gate9.live.integration.test.ts` | +300 | 9 live tests (NEW) |

## Freeze Confirmation

- 427/427 tests pass
- tsc --noEmit clean
- No regressions from Gate 8 baseline
- All Gate 5-8 security checks verified
- Orchestration engine reachable from production pipeline
- Forensic closure complete

**CLOSED: 2026-08-17**
