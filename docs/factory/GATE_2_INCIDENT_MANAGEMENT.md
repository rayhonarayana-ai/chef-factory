# CHEF FACTORY — GATE 2 — INCIDENT MANAGEMENT

**Component:** Foundational incident workflow
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED

## Purpose
Foundational workflow only — not a SOC platform. Tracks security incidents from
detection to closure with enforced transitions.

## Lifecycle
`detected → investigating → contained → resolved → closed`

Allowed transitions (`INCIDENT_TRANSITIONS`):
- detected → investigating / contained / resolved / closed
- investigating → contained / resolved / closed / detected
- contained → investigating / resolved / closed
- resolved → investigating / closed
- closed → (terminal — nothing)

`canTransitionIncident(from, to)` returns false for invalid transitions; `closed` is
terminal and cannot be reopened.

## Behavior
- `validateIncidentInput` requires a non-empty title.
- `toIncidentRecord` opens with `status: 'detected'`.
- `applyIncidentPatch` enforces transitions; `closedBy` recorded on close.
- `Store.createIncident` / `patchIncident` / `listIncidents` are owner-scoped.

## Schema (`public.security_incidents`)
`incident_id` PK · `owner_id` FK cascade · `title` · `status` (CHECK enum) ·
`description` · `event_ids` JSONB · `opened_by` / `closed_by` FK owners · `created_at` /
`updated_at`. RLS owner-scoped select/insert/update/delete.

## API
- `POST /api/security/incidents` — open (title required; 400 otherwise).
- `GET /api/security/incidents` — list (optional `status`, `limit`).

## Tests
- `src/core/security/securityGuardian.test.ts` — transition validity (closed → detected
  rejected).
- `src/integration/security.live.integration.test.ts` — open → investigating → closed;
  owner isolation; invalid reopen rejected.
- `src/integration/security.api.integration.test.ts` — create/list/validation.
- `supabase/tests/rls_security_tests.sql` TEST S4 — owner-scoped CRUD + isolation.

---
**END OF GATE 2 INCIDENT MANAGEMENT.**
