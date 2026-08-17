# CHEF FACTORY — GATE 2 — ANOMALY DETECTION

**Component:** Deterministic threshold signals
**Status:** IMPLEMENTED / TESTED

## Purpose
Deterministic thresholds ONLY — no fabricated "AI intelligence". Advanced ML anomaly
detection belongs to a future Gate. Signals drive Security Events.

## Thresholds (`DEFAULT_ANOMALY_THRESHOLDS`)
| counter | threshold |
|---|---|
| deniedActions | 5 |
| authFailures | 5 |
| privilegeRequests | 3 |
| projectSwitches | 5 |
| environmentEscalations | 3 |
| costSpikes | 3 |
| retryBursts | 5 |
| toolAnomalies | 3 |
| secretAccessAttempts | 3 |
| policyViolations | 5 |

## Behavior
`AnomalyDetector.note(kind)` increments a counter and returns an `AnomalySignal`
(`triggered`, `indicator`, `metric`, `threshold`, `reason`) when the threshold is
reached. Counters are in-memory; `reset()` clears them.

## Guardian integration
After policy evaluation the Guardian notes:
- deny/lockdown → `deniedActions` → `anomaly.repeated_denial`
- env escalation → `environmentEscalations` → `anomaly.environment_escalation`
- cross-project → `projectSwitches` → `anomaly.project_switching`
- rate limited → `policyViolations` → `anomaly.policy_violations`
- cost stopped → `costSpikes` → `anomaly.cost_spike`

All signals emit medium-severity append-only events.

## Tests
- `src/core/security/securityGuardian.test.ts` — threshold crossing + reset.

---
**END OF GATE 2 ANOMALY DETECTION.**
