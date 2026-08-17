# Gate 8 — Readiness Report

> Date: 2026-08-17
> Mode: DISCOVERY_ONLY (no implementation)
> Classification: GATE_8_READY_FOR_OWNER_APPROVAL

---

## Pre-Implementation Readiness Checklist

| Item | Status | Evidence |
|------|--------|----------|
| Gate 7 baseline preserved | YES | 370/370 tests pass, 0 source changes, 0 DB changes |
| Discovery report complete | YES | `GATE_8_DISCOVERY_REPORT.md` |
| Forensic review complete | YES | `GATE_8_FORENSIC_REVIEW.md` |
| Mission options documented | YES | `GATE_8_MISSION_OPTIONS.md` (4 candidates) |
| Evidence concept defined | YES | `GATE_8_EVIDENCE_CONCEPT.md` (28+ evidence items) |
| Owner decisions listed | YES | `GATE_8_DECISIONS.md` (5 decisions) |
| No source files modified | YES | 0 files changed during discovery |
| No database changes | YES | 0 migrations created during discovery |
| No test files modified | YES | 0 test files changed during discovery |
| Security regression clean | YES | All security boundaries preserved |

---

## Recommended Mission

**Multi-Step Task Orchestration (Planner + Sequencer + Progress Tracker)**

### Why This Is the Highest-Value Bottleneck

1. **CHEF can only do one thing at a time.** Every owner command creates exactly ONE task and executes it. To set up a project with 5 tasks, the owner must issue 7 separate commands.

2. **The entire architecture is designed for autonomous execution.** Security, authority, cost protection, audit — all support multi-step workflows. But the execution surface is limited to atomic commands.

3. **This unlocks the core value proposition.** An Executive AI that can only execute single commands is a glorified CLI. An Executive AI that plans and executes multi-step workflows is a genuinely useful assistant.

### Why It Should Come Before Other Candidates

| Candidate | Why Not Gate 8 |
|-----------|----------------|
| Provider Resilience | Important but doesn't unlock new capability; CHEF already executes commands, they just fail sometimes |
| Context Summarization | Useful for long conversations but CHEF's core limitation is single-command execution, not context loss |
| Streaming | Improves UX but doesn't unlock new capability; CHEF already responds to commands |

### What Owner Capability It Unlocks

- "Create a project for the mobile app, add 5 tasks for the team, set priorities" → executes as one coordinated workflow
- "Update all tasks in project X to status 'in_progress'" → batch operation
- "Set up the new client project" → project + tasks + passport + configuration in one command

### What Existing Architecture It Activates

- `TaskRecord.parent_task_id` — exists but unused
- `taskEngine.ts` state machine — supports lifecycle but no sequencing
- `pipeline.ts` — 12-stage pipeline per step
- `ToolBroker` — each step goes through full security chain
- `CostProtector` — cost limits apply per-step
- `RateLimiter` — rate limits apply per-step

### Why It Does Not Violate Gate 7

Gate 7 hardened query data security (byte limits, timeouts, rate limits, enumeration, concurrency, error sanitization). Multi-step orchestration is purely additive — it adds a new capability layer on top of the existing execution infrastructure. No existing security, authority, cost, or audit behavior is modified.

### Minimum Implementation Boundary

1. **Planner module** (`src/core/planner.ts`) — ~200 lines
2. **Sequence types** (`src/core/types.ts`) — ~30 lines added
3. **Sequence Store methods** (`src/core/ports.ts` + `src/db/repo.ts`) — ~100 lines
4. **Pipeline integration** (`src/core/pipeline.ts`) — ~50 lines modified
5. **Migration** — ~80 lines (new table + columns)
6. **API endpoint** (`src/api/handlers.ts`) — ~40 lines
7. **Unit tests** — ~400 lines
8. **Integration tests** — ~200 lines

**Total: ~1,100 lines across 8 files**

---

## Owner Approval Status

| Decision | Status | Waiting |
|----------|--------|---------|
| OD9: Sequence modeling approach | PENDING | Owner approval |
| OD10: Failure behavior | PENDING | Owner approval |
| OD11: Maximum steps per sequence | PENDING | Owner approval |
| OD12: Title auto-generation | PENDING | Owner approval |
| OD13: Progress tracking endpoint | PENDING | Owner approval |

---

## Gate 8 Readiness

```
GATE_8_READINESS = GATE_8_READY_FOR_OWNER_APPROVAL
DISCOVERY_COMPLETE = YES
RECOMMENDED_MISSION = Multi-Step Task Orchestration
OWNER_DECISIONS_REQUIRED = 5
EVIDENCE_ITEMS_DEFINED = 28+
SOURCE_FILES_MODIFIED_DURING_DISCOVERY = 0
DATABASE_MODIFIED_DURING_DISCOVERY = 0
TEST_FILES_MODIFIED_DURING_DISCOVERY = 0

NEXT_STEP = Await owner approval of OD9-OD13, then proceed to implementation
```

---

## Baseline Integrity

```
GATE_7_BASELINE_PRESERVED = YES
SOURCE_FILES_MODIFIED = 0
DATABASE_MODIFIED = 0
TEST_FILES_MODIFIED = 0
DEPLOYMENT = NONE
DOCUMENTATION_DRIFT = 2 (minor: ARCHITECTURE.md critical action count, SECURITY.md Gate 7 coverage)
SOURCE_DRIFT = 0
DATABASE_DRIFT = 0
SECURITY_FINDINGS = 0
CRITICAL_FINDINGS = 0
HIGH_FINDINGS = 0 (during discovery)
MEDIUM_FINDINGS = 0 (during discovery)
LOW_FINDINGS = 0 (during discovery)
```
