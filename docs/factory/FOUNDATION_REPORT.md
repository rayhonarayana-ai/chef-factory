# CHEF FACTORY — FOUNDATION REPORT (GATE 1)

**Prompt:** PROMPT 2/5 — ARCHITECTURE + DATABASE FOUNDATION
**Date:** 2026-08-15
**Status:** GATE 1 (DATABASE FOUNDATION) — COMPLETE · LIVE_VERIFIED

---

## 1. Summary

The Gate 1 database foundation for the CHEF Personal Executive Core is fully implemented,
applied to the independent Factory Supabase project, and verified against live schema and
deterministic tests. No future-Gate logic was implemented (Executive Core explicitly
excluded per Gate 1 contract).

## 2. Files Changed / Created

| File | Change |
|---|---|
| `supabase/migrations/20260815220000_factory_init.sql` | NEW — schema + functions + triggers + RLS (applied live) |
| `supabase/tests/rls_tests.sql` | NEW — deterministic DB/RLS tests (transactional, self-cleaning) |
| `supabase/tests/run_tests.js` | NEW — Node runner for the tests |
| `docs/factory/ARCHITECTURE.md` | NEW — Gate 1 architecture + decisions |
| `docs/factory/DATABASE.md` | NEW — schema, constraints, guarantees |
| `docs/factory/SECURITY.md` | NEW — RLS/audit/secret model |
| `docs/factory/FOUNDATION_REPORT.md` | THIS — Gate 1 closeout report |
| `todo.md` | UPDATED — Gate 1 complete |

## 3. Migrations Applied

- `20260815220000_factory_init.sql` → **applied successfully** via
  `supabase db push --db-url <pooler connection>`.

## 4. Schema Delivered (16 tables)

owners · projects · project_environments · project_passports · agents ·
agent_permissions · tasks · task_runs · models · runtimes · approvals ·
audit_events · cost_events · personal_preferences · decision_journal · autonomy_records

Plus helper functions, lifecycle triggers (owner auto-create, default environments,
updated_at), anti-infinite-loop defaults, and 61 RLS policies across all tables.

## 5. RLS / Security

- RLS enabled on all 16 tables; 61 policies.
- Owner scope: `auth.uid()`; agent scope: `request.agent_id` + `agent_permissions`.
- Anon and unknown users: zero rows.

## 6. Tests

| # | Test | Result |
|---|---|---|
| 1 | Owner identity (self vs other) | PASS |
| 2 | Owner sees all own projects/tasks | PASS |
| 3 | Agent project scope + PROJECT ISOLATION | PASS |
| 4 | Unauthorized access (anon, unknown user) | PASS |
| 5 | Audit append-only (RLS + trigger) | PASS |
| 6 | Preference versioning (one ACTIVE per key) | PASS |
| 7 | Required FKs / NOT NULL / CHECK | PASS |

Runner: `RLS_TESTS_PASS (357–485ms) — all deterministic tests succeeded`
(repeatable, ROLLBACK self-clean; no residue in live DB).

## 7. Failures & Fixes (this session)

- **First push failed** (functions defined before tables) → reordered migration to
  A) tables, B) functions, C) triggers, D) RLS.
- **Test 3 false-negative** (agent granted `tasks` only, asserted project visibility)
  → granted `projects` permission; test then passed.
- **Test 3 agent-id resolution** (RLS hid the agent row during setup) → fixed agent UUID
  used explicitly for determinism.

## 8. Risks / Known Notes

- Direct DB host is IPv6-only on this machine → pooler host `aws-1-eu-west-1.pooler.supabase.com`
  is the working path for CLI/tests.
- Owner PAT revoked → Management API via CLI requires a fresh token when needed later
  (db push/tests work via `--db-url`).
- PROOFOS (`kwwqqtuggkooqnrwqzsi`) remains **paused** to hold a free-tier slot; owner to
  plan reactivation.

## 9. Blockers

- None. Gate 1 is complete.

## 10. Evidence Classification

- Schema/RLS/policies: **LIVE_VERIFIED** (queried live: 16 tables, 16 RLS, 61 policies).
- Tests: **LIVE_VERIFIED** (executed against live DB, deterministic, repeated PASS).
- Docs: written from actual applied artifacts.

## 11. Next Steps (not implemented — future Gates)

- GATE 2+: Executive Core, control plane UI, SecretProvider, Model/Runtime gateways,
  ToolBroker, memory backend, authority matrix application.

---

**END OF FOUNDATION REPORT (GATE 1).**
