# CHEF FACTORY — GATE 2 — SECURITY EVENTS

**Component:** Append-only, owner-scoped event log
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED

## Purpose
Security events are append-only, owner-scoped, and must never contain secrets. No agent
may delete or modify historical security events (RLS + trigger hard-block).

## Event types (`SECURITY_EVENT_TYPES`)
`lockdown.activated` · `lockdown.released` · `lockdown.release_denied` ·
`denied.action` · `denied.cross_project` · `denied.environment_escalation` ·
`denied.rate_limit` · `denied.cost` · `denied.tool` · `denied.runtime` ·
`denied.lockdown_release` · `require_approval.critical` · `secret.access_attempt` ·
`secret.potential_leak` · `policy.violation` · `anomaly.repeated_denial` ·
`anomaly.auth_failures` · `anomaly.cost_spike` · `anomaly.retry_burst` ·
`anomaly.tool_anomaly` · `anomaly.policy_violations` · `incident.opened` ·
`incident.updated` · `health.lockdown` · `info.default_deny`.

## Severity inference (`severityFor`)
- `info.*` → info
- `*lockdown*` → critical
- `denied.critical*` / `secret.potential_leak` → critical
- `anomaly.*` → medium
- `denied.*` / `secret.access_attempt` / `policy.violation` → high
- `require_approval.critical` → high
- otherwise fallback (default medium); explicit severity always wins.

## Schema (`public.security_events`)
`security_event_id` PK · `owner_id` FK cascade · optional `project_id` / `agent_id` /
`task_id` / `correlation_id` · `environment` · `event_type` · `severity` · `action` ·
`resource` · `decision` · `reason` · `evidence_references` · `metadata` · `occurred_at` ·
`recorded_at`. Indexed on owner, project, type, severity, occurred_at, correlation_id.

## Integrity
- RLS: owner-select + owner-insert only; no update/delete policies.
- Triggers `security_events_no_update` / `security_events_no_delete` hard-block even
  for superuser.
- `toSecurityEventRecord` redacts `reason` and metadata before persistence.

## Store API
`recordSecurityEvent(ownerId, event)` · `listSecurityEvents(ownerId, { eventType,
severity, limit })` — owner-scoped, ordered `occurred_at desc`.

## Tests
- `src/core/security/securityGuardian.test.ts` — event emission + severity + redaction.
- `src/integration/security.live.integration.test.ts` — round-trip, owner isolation,
  redaction at write time.
- `supabase/tests/rls_security_tests.sql` TEST S2 — owner isolation + RLS/trigger
  append-only.

---
**END OF GATE 2 SECURITY EVENTS.**
