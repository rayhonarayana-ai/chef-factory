# CHEF FACTORY — GATE 2 — RISK ENGINE

**Component:** Deterministic risk classification
**Status:** IMPLEMENTED / TESTED

## Purpose
Classify every action as LOW / MEDIUM / HIGH / CRITICAL with explicit evidence.
CRITICAL is terminal. Risk is never fabricated.

## Inputs (`RiskContext`)
`actionType`, `environment`, `requestedPermission`, `affectedResources`,
`reversibility`, `dataSensitivity`, `productionImpact`, `financialImpact`,
`externalCommunication`, `destructivePotential`, `privilegeEscalation`,
`secretExposure`, `scope`, `agentSuccessRate`, `agentHistoryCount`,
`anomalyIndicators`.

## Escalation Factors
- **CRITICAL (terminal):** secret exposure, privilege escalation, financial impact,
  legal/contractual action, destructive operation in production.
- **HIGH:** destructive potential (non-prod), production impact, security-control
  change (policy modification / disable audit / disable RLS), secret access/rotation,
  permission or authority change, high data sensitivity, production write/execute.
- **MEDIUM:** external communication, multi/global scope, staging write/execute,
  execute permission, write permission, irreversible, medium data sensitivity, any
  anomaly indicator.

`classifyRisk` returns `{ risk, evidence }` where evidence lists every factor applied.

## Guarantees
- Monotonic escalation only (a factor can raise risk, never lower it).
- Deterministic: identical input → identical output.
- Risk feeds Gate 1 authority AND the Guardian; the Guardian may override to a more
  restrictive outcome only.

## Tests
- `src/core/security/securityGuardian.test.ts` — risk evidence + terminal CRITICAL
  factors + monotonicity.

---
**END OF GATE 2 RISK ENGINE.**
