# CHEF FACTORY — COSTS (Gate 1 Core)

**Component:** Cost Tracking
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED (schema + live)

## Purpose
Cost persistence with basic limits. Tracks model/runtime/tool/mission/project cost.

## Rules
- `Store.recordCost(event)` — append-only `cost_events` (owner, project, task, run, agent,
  cost_type, amount, currency, provider, model, runtime, billed_to).
- `Store.projectBudget(ownerId, projectId)` — rolls actual cost per `day`/`month` into a
  `BudgetReport { period, amount, maxAmount, exceeded }`; never invents numbers.
- `Store.totalCost(ownerId, projectId?)` — deterministic sum.
- Negative costs are clamped to 0 (`costForTokens` in `src/gateways/modelGateway.ts`).
- Cost-first bias: cheapest capable model selected unless a higher tier is justified
  (contract §11).

## Tests
- `src/core/cost.test.ts` — rollups, clamping, no fabrication.
- `src/gateways/modelGateway.test.ts` — cost stats from usage.
- `src/integration/live.integration.test.ts` — live budget rollup equals the recorded
  amount; `exceeded` is false when under limit.
