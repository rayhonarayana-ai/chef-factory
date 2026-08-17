# CHEF FACTORY — GATE 2 — EMERGENCY LOCKDOWN

**Component:** Fail-closed emergency control
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED

## Purpose
While a lockdown is active, EVERY security evaluation returns `lockdown` (fail closed) —
no execution continues, no matter the authority level.

## Lifecycle
`active → released`. `security_lockdowns` is history: rows are never deleted (DB trigger
`security_lockdowns_no_delete` + no DELETE policy).

## Rules
- **Activation:** owner or system only. `validateLockdownActivation` rejects agents.
  A reason is mandatory. Activation is audited (`security.lockdown_activated`).
- **Release:** explicit owner authorization only. `canReleaseLockdown` rejects any
  `actorType !== 'owner'` — an agent can NEVER release its own (or any) lockdown.
  A recorded reason is mandatory. Release is audited (`security.lockdown_released`).
- Releasing an already-released lockdown fails (`lockdown is not active`).

## Guardian integration
`SecurityGuardian.evaluate` checks `deps.lockdown(ownerId)` first. If an active lockdown
exists the result is `{ decision: 'lockdown', finalAutonomy: 'deny' }` and a
`health.lockdown` critical event is emitted.

## API
- `GET /api/security/lockdown` — current active lockdown (or null).
- `POST /api/security/lockdown` — activate (body: `reason`, optional `scope`).
- `POST /api/security/lockdown/release` — release (body: `lockdownId`, `reason`).
  Unknown id → 404; missing reason/lockdownId → 400.

## Tests
- `src/core/security/securityGuardian.test.ts` — lockdown precedence + fail-closed.
- `src/integration/security.live.integration.test.ts` — activate → active → release
  round-trip; re-release rejected; **agent release rejected**.
- `src/integration/security.api.integration.test.ts` — full API lifecycle + validation.
- `supabase/tests/rls_security_tests.sql` TEST S3 — owner-scoped rows, owner release,
  DELETE hard-blocked.

---
**END OF GATE 2 EMERGENCY LOCKDOWN.**
