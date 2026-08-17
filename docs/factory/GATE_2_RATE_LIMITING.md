# CHEF FACTORY — GATE 2 — RATE LIMITING

**Component:** Deterministic abuse protection
**Status:** IMPLEMENTED / TESTED

## Purpose
Prevent runaway execution with deterministic fixed-window counters. Once a window limit
is exhausted the request is DENIED with a retry-after window.

## Defaults (`DEFAULT_RATE_LIMITS`)

| scope | limitKey | maxCount | window |
|---|---|---|---|
| task | task.execute | 50 | 3600s |
| tool | tool.call | 100 | 3600s |
| runtime | runtime.execute | 20 | 3600s |
| model | model.call | 200 | 3600s |
| auth | auth.failure | 5 | 900s |
| approval | approval.request | 20 | 3600s |
| failure | task.failure | 10 | 3600s |

All documented in `public.security_rate_limits` (owner-overridable rows, versioned,
unique per `(owner_id, scope, limit_key, version)`).

## Behavior
`RateLimiter.check(ownerId, scope, limitKey)`:
- Missing/disabled config → always allowed.
- Fixed window per `(ownerId, scope, limitKey)`; counter resets after `windowSeconds`.
- `count > maxCount` → `{ allowed: false, retryAfterMs }`.
- `check` consumes the counter on EVERY call (deny counts too).

## Guardian integration
When a request carries a `scope`, the Guardian derives `limitKey` (`task.execute`,
`tool.call`, …) and denies with `denied.rate_limit` once exhausted.

## Tests
- `src/core/security/securityGuardian.test.ts` — window reset, limit exhaust, disabled
  config, retry-after math.
- `supabase/tests/rls_security_tests.sql` TEST S6 — owner-scoped rate-limit rows.

---
**END OF GATE 2 RATE LIMITING.**
