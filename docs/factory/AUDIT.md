# CHEF FACTORY — AUDIT (Gate 1 Core)

**Component:** Audit Service
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED (schema + live)

## Purpose
Append-oriented, secret-free audit trail of every significant action.

## Rules
- `Store.recordAudit(event)` — insert-only. The Store contract exposes **no update/delete**
  for audit events.
- Append-only is enforced twice:
  1. RLS: no UPDATE/DELETE policies for `audit_events`.
  2. Trigger-level enforcement (`audit_events` BEFORE UPDATE/DELETE trigger) so even
     superuser bypass attempts fail (RLS TEST 5).
- Secrets never reach audit: every audit payload is passed through redaction
  (`src/core/redact.ts` patterns: JWTs `eyJ…`, Supabase `sbp_`/`sb_` tokens, `sk-…` keys,
  `key=value` secret pairs). `actorId` is a reference, not a credential.
- Fields: actor_type, actor_id, action, project_id, environment_id, resource_type,
  resource_id, authorization_result, correlation_id, task_id, metadata.

## Tests
- `supabase/tests/rls_tests.sql` TEST 5 — RLS blocks UPDATE/DELETE; trigger blocks
  superuser UPDATE/DELETE.
- `src/integration/live.integration.test.ts` — insert-only round-trip with
  `metadata: { secret_guard: 'none' }`.
- `src/core/monitoring.test.ts` — audit-driven alerts (pipeline emits audit on commands).
