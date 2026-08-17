# CHEF FACTORY — GATE 2 — DATABASE & RLS

**Migration:** `supabase/migrations/20260817000000_security_guardian.sql`
**Status:** APPLIED — LIVE_VERIFIED

## Tables added (6)

| Table | Purpose | Integrity |
|---|---|---|
| `critical_actions` | Immutable core registry (17 rows) | CHECK decisions; triggers block UPDATE/DELETE; read-only RLS |
| `security_events` | Append-only security event log | owner FK cascade; no update/delete (RLS + triggers); 6 indexes |
| `security_incidents` | Incident workflow | owner FK cascade; status CHECK; owner-scoped CRUD |
| `security_lockdowns` | Lockdown history | status CHECK; owner-scoped update (release); DELETE hard-blocked |
| `security_rate_limits` | Documented rate-limit defaults | unique (owner, scope, limit_key, version); scope CHECK |
| `security_policies` | 13-rule deterministic policy registry | read-only RLS; unique (rule_id, version) |

## RLS summary (all 6 tables ENABLED)
- `critical_actions`, `security_policies` — SELECT for `authenticated` on `true`
  (public-read registries; no write policies).
- `security_events` — owner SELECT + INSERT only (append-only).
- `security_incidents` — owner SELECT/INSERT/UPDATE/DELETE.
- `security_lockdowns` — owner SELECT/INSERT/UPDATE (release); no DELETE.
- `security_rate_limits` — owner SELECT/INSERT/UPDATE/DELETE.

## Triggers (superuser-proof)
- `block_critical_action_mutation` — UPDATE/DELETE on core registry → exception.
- `block_security_event_mutation` — UPDATE/DELETE on events → exception.
- `block_lockdown_deletion` — DELETE on lockdowns → exception.
- `security_incidents_set_updated_at` / `critical_actions_set_updated_at` —
  `public.set_updated_at()`.

## Seed parity
- `critical_actions` 17 rows ⇔ `CRITICAL_ACTIONS` in `src/core/security/criticalActions.ts`
  (same actions/classifications/decisions; 9 deny + 8 require_approval).
- `security_policies` 13 rows ⇔ `evaluatePolicy` chain in `policyEngine.ts`.

## Verification (live)
- `node supabase/tests/run_tests.cjs rls_security_tests.sql` → PASS (S1–S6).
- `node supabase/tests/run_tests.cjs rls_tests.sql` → PASS (Gate 1 regression).
- `node supabase/tests/apply_migration.cjs 20260817000000_security_guardian.sql` →
  APPLIED.
- Live counts: critical_actions=17, security_policies=13, events/incidents/lockdowns=0
  (zero residue).

---
**END OF GATE 2 DATABASE & RLS.**
