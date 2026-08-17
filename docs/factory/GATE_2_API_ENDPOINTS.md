# CHEF FACTORY — GATE 2 — SECURITY API ENDPOINTS

**Component:** Control Plane JSON surface (owner-authenticated)
**Status:** IMPLEMENTED + TESTED (live, transactional) + LIVE_VERIFIED

## Endpoints (static paths — no path params)

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/security/health` | security health + active lockdown |
| GET | `/api/security/events` | list security events (query: `eventType`, `severity`, `limit`) |
| GET | `/api/security/incidents` | list incidents (query: `status`, `limit`) |
| POST | `/api/security/incidents` | open incident (body: `title`; 400 if empty) |
| GET | `/api/security/critical-actions` | registry (17 rules, version 1) |
| GET | `/api/security/lockdown` | current active lockdown or null |
| POST | `/api/security/lockdown` | activate (body: `reason` required, `scope` optional; audit written) |
| POST | `/api/security/lockdown/release` | release (body: `lockdownId`, `reason`; 400 missing, 404 unknown; audit written) |

Static paths are intentional: the Gate 1 router passes `pathname` raw to handlers, so
parameter-based routes do not match reliably. Lockdown ids travel in the body.

## Security properties
- Every route is owner-authenticated (`Authorization: Bearer <owner JWT>` →
  `AuthService.verifyOwner`).
- All store calls are owner-scoped (RLS is the enforcement point).
- Lockdown activation/release write `recordAudit` entries
  (`security.lockdown_activated` / `security.lockdown_released`).
- Health includes a live `rlsProbe` — never reports healthy when the DB probe fails.
- All responses pass through the response redactor.

## Files
- `src/api/server.ts` — route table.
- `src/api/handlers.ts` — handler cases.

## Tests
- `src/integration/security.api.integration.test.ts` — live end-to-end: health,
  critical-actions, events, incident create/list/validation, lockdown
  activate/active/release + validation/404 cases. Transactional with purge.

---
**END OF GATE 2 SECURITY API ENDPOINTS.**
