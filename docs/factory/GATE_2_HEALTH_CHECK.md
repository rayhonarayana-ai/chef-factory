# CHEF FACTORY — GATE 2 — SECURITY HEALTH

**Component:** Deterministic health aggregation
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED

## Purpose
Never reports HEALTHY when a critical control is unavailable.

## Statuses
`healthy` · `degraded` · `lockdown` · `blocked`
- `lockdown` — an active lockdown exists (top precedence).
- `blocked` — a critical check failed.
- `degraded` — a non-critical check failed.
- `healthy` — all checks ok.

## Checks (`DEFAULT_HEALTH_CHECKS`)
| id | label | critical |
|---|---|---|
| policy_engine | Security Policy Engine | yes |
| critical_actions | Critical Action Registry | yes |
| risk_engine | Risk Classification Engine | yes |
| audit | Audit Service | yes |
| secret_provider | Secret Provider | yes |
| anomaly_detector | Anomaly Detector | no |
| rate_limit | Rate Limiter | no |
| cost_protection | Cost Protection | no |
| database.rls | Database / RLS (from live probe) | yes |

`rlsHealthFromProbe(probe, error)` marks the DB check failed when the probe errors, is
missing, has uncovered tables, or the append-only triggers are absent.

## Live probe (`Store.rlsProbe`)
Queries `pg_catalog` for: public table count, tables with RLS enabled, presence of
append-only triggers on `audit_events` and `security_events`. `ok` = all public tables
have RLS and both append-only triggers exist.

## Tests
- `src/core/security/securityGuardian.test.ts` — status derivation.
- `src/integration/security.live.integration.test.ts` — `rlsProbe` on live schema
  reports full coverage (`rlsEnabledTables === publicTables`, both append-only true).

---
**END OF GATE 2 SECURITY HEALTH.**
