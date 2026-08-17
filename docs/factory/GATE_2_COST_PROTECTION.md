# CHEF FACTORY — GATE 2 — COST PROTECTION

**Component:** Deterministic cost hard limits
**Status:** IMPLEMENTED / TESTED

## Purpose
When a configured hard limit is reached, execution STOPS — spending never continues
automatically. Integrated with Gate 1 Cost Tracking (`cost_events`, `projectBudget`,
`totalCost`).

## Config (`CostProtectionConfig` / `DEFAULT_COST_PROTECTION`)
| option | default | meaning |
|---|---|---|
| projectMonthlyHardLimit | null (disabled) | hard stop when project month exceeds |
| projectDailyHardLimit | null (disabled) | reserved for daily limit |
| ownerMonthlyHardLimit | null (disabled) | hard stop when owner month exceeds |
| costSpikeMultiplier | 5 | alert when a single event exceeds baseline × multiplier |
| baselineWindowDays | 30 | baseline window |

## Behavior
`CostProtector.check(ownerId, projectId)` → `{ stopped, reason, metrics }` using
`store.totalCost` (owner) and `store.projectBudget` (project month). Any hard limit
exceeded → `stopped: true`. `isSpike(amount, baselineMonthly)` is a deterministic
spike check (baseline × multiplier).

## Guardian integration
`CostProtector` is the `costCheck` dependency of the Guardian. When stopped, the
Guardian denies with `denied.cost` (critical) and emits an anomaly cost signal after the
threshold.

## Tests
- `src/core/security/securityGuardian.test.ts` — hard-limit stop path + spike check.
- Cost numbers always come from the Store rollups — never invented.

---
**END OF GATE 2 COST PROTECTION.**
