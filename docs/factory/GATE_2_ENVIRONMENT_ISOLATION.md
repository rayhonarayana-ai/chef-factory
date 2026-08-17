# CHEF FACTORY — GATE 2 — ENVIRONMENT ISOLATION

**Component:** Environment-scope enforcement
**Status:** IMPLEMENTED / TESTED

## Purpose
An agent granted only lower environments that attempts a higher environment is denied
— unless it holds explicit authority. Silent environment escalation is blocked at the
Guardian, on top of Gate 1 project/environment scoping.

## Ranking
`development (0) < staging (1) < production (2)`

`environmentRank(e)` maps an environment to its rank.

## Rule
`detectEnvironmentEscalation(environment, grantedEnvironments, actorType)`:
- Owner → never escalated.
- Agent with **no** grant → escalated for anything above `development`.
- Agent with grants → escalated when the requested environment ranks HIGHER than the
  highest granted environment.

## Guardian integration
Escalation → `denied.environment_escalation` (high) event + `deny` decision
(`rule.environment_escalation`). Repeated escalations emit `anomaly.environment_escalation`
after the threshold.

## Tests
- `src/core/security/securityGuardian.test.ts` — rank logic, owner exemption,
  grant-based escalation, missing-grant behavior.

---
**END OF GATE 2 ENVIRONMENT ISOLATION.**
