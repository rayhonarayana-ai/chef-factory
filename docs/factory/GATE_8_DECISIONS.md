# Gate 8 — Owner Decisions

> Date: 2026-08-17
> Purpose: List all decisions requiring owner approval before Gate 8 implementation

---

## OD9: Multi-Step Orchestration Approach

**QUESTION:** How should multi-step task sequences be modeled?

**OPTIONS:**
1. **Separate `task_sequences` table** — New table with sequence metadata; `tasks` gets `sequence_id` FK column
2. **Use existing `parent_task_id`** — Chain tasks via the existing self-referential FK; store sequence metadata in JSONB
3. **Hybrid** — `task_sequences` table for tracking, `parent_task_id` for task linkage

**RECOMMENDATION:** Option 1 (separate table). Clean separation of concerns, proper progress tracking, independent lifecycle.

**IMPACT IF REJECTED:** Option 2 is simpler but limits progress tracking. Option 3 adds complexity without clear benefit.

---

## OD10: Sequence Failure Behavior

**QUESTION:** When a step in a sequence fails, what should happen?

**OPTIONS:**
1. **Stop sequence** — Mark sequence as `failed`, leave remaining steps as `pending`
2. **Skip failed step** — Mark step as `skipped`, continue with next step
3. **Retry failed step** — Attempt the failed step up to 3 times before stopping
4. **Owner-configurable** — Let the owner choose per-sequence behavior

**RECOMMENDATION:** Option 1 (stop sequence) for Gate 8. Simplest, safest, prevents cascading failures. Options 2-4 can be added in later gates.

**IMPACT IF REJECTED:** Option 4 is more flexible but significantly increases complexity.

---

## OD11: Maximum Steps Per Sequence

**QUESTION:** What should the maximum number of steps per sequence be?

**OPTIONS:**
1. **5 steps** — Conservative, low cost impact
2. **10 steps** — Moderate, allows complex workflows
3. **20 steps** — Generous, supports full project setup
4. **Unlimited** — No cap (bounded only by cost protection)

**RECOMMENDATION:** Option 2 (10 steps). Balances capability with cost control. A 10-step sequence costs approximately $0.05-0.15 depending on model.

**IMPACT IF REJECTED:** Option 3 risks high cost per command. Option 1 limits utility.

---

## OD12: Sequence Title Auto-Generation

**QUESTION:** How should sequence titles be determined?

**OPTIONS:**
1. **Auto-generate from intent** — Extract the primary action as the title (e.g., "Setup mobile app project")
2. **Require explicit title** — Owner must provide a title in the command
3. **Optional title** — Auto-generate if not provided; owner can override

**RECOMMENDATION:** Option 3 (optional title). Best UX — auto-generate when not provided, allow override when desired.

**IMPACT IF REJECTED:** Option 1 is simpler but less flexible. Option 2 adds friction.

---

## OD13: Progress Tracking Endpoint

**QUESTION:** Should Gate 8 expose a sequence progress API endpoint?

**OPTIONS:**
1. **Yes** — `GET /api/sequences/:id` returns sequence status + step progress
2. **No** — Progress only visible via task list (no dedicated endpoint)

**RECOMMENDATION:** Option 1 (yes). Progress tracking is essential for multi-step workflows. Without it, the owner cannot monitor sequence execution.

**IMPACT IF REJECTED:** Option 2 makes sequences less useful; owner must manually check individual tasks.

---

## Summary

| OD# | Decision | Options | Recommendation |
|-----|----------|---------|----------------|
| OD9 | Sequence modeling | 3 | Option 1 (separate table) |
| OD10 | Failure behavior | 4 | Option 1 (stop sequence) |
| OD11 | Max steps | 4 | Option 2 (10 steps) |
| OD12 | Title generation | 3 | Option 3 (optional) |
| OD13 | Progress endpoint | 2 | Option 1 (yes) |

**Total: 5 owner decisions required**
