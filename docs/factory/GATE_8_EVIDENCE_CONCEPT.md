# Gate 8 — Evidence Concept

> Date: 2026-08-17
> Purpose: Define evidence requirements for Gate 8 PASS classification
> Scope: Multi-Step Task Orchestration (recommended mission)

---

## Evidence Categories

### STATIC EVIDENCE

| E-ID | Description | Type | Source | Pass Condition | Fail Condition |
|------|-------------|------|--------|----------------|----------------|
| S-1 | `task_sequences` table exists with correct schema | Schema | Migration SQL | Table has `id`, `owner_id`, `project_id`, `title`, `status`, `total_steps`, `completed_steps`, `created_at`, `updated_at` columns | Table missing or wrong schema |
| S-2 | `tasks` table has `sequence_id` and `step_index` columns | Schema | Migration SQL | Both columns exist with correct types | Columns missing |
| S-3 | RLS policies on `task_sequences` | Schema | Migration SQL | owner-scoped select/insert/update policies exist | No RLS or wrong scoping |
| S-4 | `PlannerModule` exists | Source | `src/core/planner.ts` | File exists with exported functions | File missing |
| S-5 | Sequence types defined | Source | `src/core/types.ts` | `SequenceRecord`, `SequenceStep`, `SequenceStatus` types exported | Types missing |
| S-6 | Sequence Store methods defined | Source | `src/core/ports.ts` | `createSequence`, `getSequence`, `listSequences`, `patchSequence` methods on Store interface | Methods missing |
| S-7 | Planner wired into pipeline | Source | `src/core/pipeline.ts` | Multi-step intent detection delegates to planner | No delegation path |

### UNIT TEST EVIDENCE

| E-ID | Description | Type | Source | Pass Condition | Fail Condition |
|------|-------------|------|--------|----------------|----------------|
| U-1 | Planner decomposes intent into steps | Unit | `planner.test.ts` | 3+ test cases for decomposition | No tests or all fail |
| U-2 | Planner creates tasks in sequence | Unit | `planner.test.ts` | Tasks created with correct `sequence_id` and `step_index` | Tasks not created or wrong fields |
| U-3 | Planner handles empty/invalid input | Unit | `planner.test.ts` | Returns error, no tasks created | Throws or creates partial tasks |
| U-4 | Sequence progress tracking | Unit | `planner.test.ts` | `completedSteps` increments correctly | Counter wrong |
| U-5 | Sequence failure handling | Unit | `planner.test.ts` | Failed step stops sequence; status set to `failed` | Sequence continues after failure |
| U-6 | Sequence completion | Unit | `planner.test.ts` | All steps completed → sequence status `completed` | Status not updated |
| U-7 | Pipeline detects multi-step intent | Unit | `pipeline.test.ts` | Intent with multiple resources triggers planner | Falls through to single-task path |
| U-8 | Single-step intent still works | Unit | `pipeline.test.ts` | No regression in single-command mode | Regression |
| U-9 | Sequence Store methods | Unit | `repo.test.ts` | CRUD operations work correctly | Methods fail |
| U-10 | Sequence validation | Unit | `planner.test.ts` | Invalid sequence inputs rejected | Invalid inputs accepted |

### DATABASE EVIDENCE

| E-ID | Description | Type | Source | Pass Condition | Fail Condition |
|------|-------------|------|--------|----------------|----------------|
| D-1 | `task_sequences` table queryable | DB | Live SQL | `SELECT * FROM task_sequences` succeeds | Table not found |
| D-2 | RLS enforced on `task_sequences` | DB | Live SQL | Owner A cannot read Owner B's sequences | Cross-owner access succeeds |
| D-3 | `tasks.sequence_id` FK valid | DB | Live SQL | Sequence deletion cascades or sets null correctly | FK constraint violated |
| D-4 | Zero schema regressions | DB | Live SQL | All 26 existing tables unchanged | Any existing table modified |

### LIVE RUNTIME EVIDENCE

| E-ID | Description | Type | Source | Pass Condition | Fail Condition |
|------|-------------|------|--------|----------------|----------------|
| L-1 | Create multi-step sequence via API | Live | `gate8.live.integration.test.ts` | POST /api/chat with multi-step command → sequence created | No sequence created |
| L-2 | Tasks created for each step | Live | `gate8.live.integration.test.ts` | Each step has a corresponding task in `tasks` table | Missing tasks |
| L-3 | Progress tracking updates | Live | `gate8.live.integration.test.ts` | GET /api/sequences/:id shows correct progress | Progress wrong |
| L-4 | Sequence completion | Live | `gate8.live.integration.test.ts` | All steps completed → sequence status `completed` | Status wrong |
| L-5 | Zero test data residue | Live | `gate8.live.integration.test.ts` | After rollback, no sequence/task data remains | Residue found |

### SECURITY EVIDENCE

| E-ID | Description | Type | Source | Pass Condition | Fail Condition |
|------|-------------|------|--------|----------------|----------------|
| SEC-1 | Sequence owner isolation | Security | Live test | Owner A cannot see Owner B's sequences | Cross-owner leak |
| SEC-2 | Sequence inherits authority model | Security | Unit test | Each step goes through authority resolution | Steps bypass authority |
| SEC-3 | Sequence inherits cost protection | Security | Unit test | Cost limits apply per-step | Cost limits bypassed |
| SEC-4 | Sequence inherits rate limits | Security | Unit test | Rate limits apply per-step | Rate limits bypassed |
| SEC-5 | Zero security regressions | Security | Full regression | 370/370 existing tests pass | Any test fails |

### REGRESSION EVIDENCE

| E-ID | Description | Type | Source | Pass Condition | Fail Condition |
|------|-------------|------|--------|----------------|----------------|
| R-1 | Full unit test regression | Regression | `vitest run` | 370+ tests pass (370 existing + new) | Any test fails |
| R-2 | Full integration test regression | Regression | `vitest run` (live) | All live integration tests pass | Any test fails |
| R-3 | tsc --noEmit clean | Regression | TypeScript compiler | Zero errors | Any error |
| R-4 | Single-command mode preserved | Regression | `pipeline.test.ts` | Single-step intents still work | Regression in single-step |

---

## Evidence Collection Plan

### Phase 1: Static Evidence
- Write migration SQL
- Verify schema via `information_schema` queries
- Verify RLS policies via `\dp` equivalent

### Phase 2: Unit Tests
- Write planner module tests (U-1 through U-10)
- Write pipeline integration tests (U-7, U-8)
- Write Store method tests (U-9)

### Phase 3: Integration Tests
- Write live integration tests (L-1 through L-5)
- Verify against real Supabase
- Verify zero residue after rollback

### Phase 4: Security Verification
- Write security tests (SEC-1 through SEC-4)
- Run full regression (SEC-5)

### Phase 5: Regression
- Run full test suite (R-1)
- Run tsc --noEmit (R-3)
- Verify single-command mode (R-4)

---

## Minimum Evidence for PASS

| Category | Minimum Items | Required |
|----------|---------------|----------|
| Static | 5 of 7 | YES |
| Unit | 8 of 10 | YES |
| Database | 3 of 4 | YES |
| Live Runtime | 4 of 5 | YES |
| Security | 4 of 5 | YES |
| Regression | 4 of 4 | YES (all mandatory) |

**Total: 28+ evidence items required for PASS**
