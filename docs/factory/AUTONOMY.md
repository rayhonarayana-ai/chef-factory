# CHEF FACTORY — AUTONOMY (Gate 1 Core)

**Component:** Adaptive Autonomy Controller
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED (schema)

## Purpose
Bounded adaptive autonomy with escalation controls. Historical success never grants
unlimited authority (contract §3).

## Rules (`src/core/autonomy.ts`)
- `evaluateAutonomy(input)` returns an `AutonomyDecision` (`auto | notify |
  require_approval | deny`).
- Escalation only after verified success: `ESCALATION_MIN_SUCCESS_RATE = 0.8`,
  `ESCALATION_MIN_HISTORY = 5`.
- The authority decision is clamped so that autonomy can never override an explicit
  `require_approval` or `deny` (`clampAutonomy` in `src/core/authority.ts`).
- Historical success raises autonomy at most one bounded step, never to a level the
  current action's authority rejects.

## Protected actions
`PROTECTED_ACTION_TYPES = { delete, deploy, financial, legal, account_security, credit }`
→ always `require_approval` regardless of history (`authority.ts`).

## Persistence
- `Store.recordAutonomy` — append-only `autonomy_records` (agent, action, selected level,
  approval status, outcome) for auditability.

## Tests
- `src/core/autonomy.test.ts` — escalation thresholds, bounded escalation, no override of
  DENY/approval.
- `src/core/authority.test.ts` — matrix + protected actions.
- `src/core/pipeline.test.ts` — autonomy flows through the pipeline.
