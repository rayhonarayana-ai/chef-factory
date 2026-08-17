# CHEF FACTORY — DATABASE (GATE 1 + GATE 2)

**Prompt:** PROMPT 2/5 — ARCHITECTURE + DATABASE FOUNDATION (+ PROMPT 4/5 — SECURITY GUARDIAN)
**Date:** 2026-08-15 / 2026-08-16

---

## 1. Target

Independent Factory Supabase project **CHEF FACTORY DB**
(`dybyidtcyzgliupzzfhl`, region eu-west-1, status ACTIVE_HEALTHY).
Never Qarayti.ai / PROOFOS / Tadbir / FreeSchool.

## 2. Migrations

| Migration | Status |
|---|---|
| `supabase/migrations/20260815220000_factory_init.sql` | APPLIED — LIVE_VERIFIED |
| `supabase/migrations/20260816000000_core_additions.sql` | APPLIED — LIVE_VERIFIED |
| `supabase/migrations/20260817000000_security_guardian.sql` | APPLIED — LIVE_VERIFIED (Gate 2) |

Migration order inside the init file: (A) extensions + tables, (B) helper functions,
(C) triggers, (D) RLS policies.

**Core additions** (`20260816000000_core_additions.sql`): `decision_journal` and
`autonomy_records` tables (owner-scoped, append-oriented, `on delete cascade`),
corresponding RLS policies, and indexes backing the Store's journal/monitoring reads.

## 3. Schema (16 tables)

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `owners` | Owner identity (linked to `auth.users`) | PK id = auth.users.id; unique email; status |
| `projects` | Project registry | PK; FK owner_id; unique (owner_id, slug); status |
| `project_environments` | development/staging/production | FK project_id; unique (project_id, name); production protected flag |
| `project_passports` | Project Passport (structured, UNKNOWN-able) | FK project_id UNIQUE; JSONB passport sections |
| `agents` | Agent registry | FK owner_id; unique (owner_id, slug); capabilities JSONB |
| `agent_permissions` | Least-privilege grants | FK agent_id, project_id (nullable); unique scope (agent, project, env, resource, permission); status |
| `tasks` | Task/mission persistence + lifecycle | FK owner/project/env/agent/parent; status enum; risk/authority/autonomy; attempts/max_attempts (default 3) |
| `task_runs` | Runs per task | FK task_id; unique (task_id, run_number); cost; snapshots |
| `models` | Model registry (agnostic) | FK owner_id; unique (owner, provider, name); cost per 1k in/out; status |
| `runtimes` | Runtime registry (agnostic) | FK owner_id; unique (owner, name, version); cost per hour |
| `approvals` | Approval requests/decisions | FK owner/project/task/agent; status enum; unique partial index: one PENDING per (task, action) |
| `audit_events` | Append-only audit | identity PK; actor/action/project/env/resource/authorization/correlation/task; append-only triggers |
| `cost_events` | Cost persistence | FK owner/project/task/run/agent/model/runtime; cost_type enum; amount >= 0; currency; billed_to |
| `personal_preferences` | Versioned POS | FK owner_id; unique (owner, category, key, version); partial unique: one ACTIVE per key |
| `decision_journal` | Decision records | FK owner/project; options/evidence JSONB; confidence 0–1; authority/risk; approved_by |
| `autonomy_records` | Autonomy decisions | FK owner/agent/project/env; policy_inputs/evidence JSONB; approval_status |

## 3b. Schema — Gate 2 Security (6 additional tables, total 22)

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `critical_actions` | Immutable critical-action registry (17 core rules) | PK action; decision/classification CHECK; UPDATE/DELETE blocked by trigger; read-only RLS |
| `security_events` | Append-only security event log | PK security_event_id; owner FK cascade; env/severity/decision CHECK; UPDATE/DELETE blocked (RLS + trigger) |
| `security_incidents` | Incident workflow | PK incident_id; owner FK cascade; status CHECK; owner-scoped CRUD |
| `security_lockdowns` | Lockdown history | PK lockdown_id; status CHECK (active/released); owner-scoped update (release); DELETE blocked |
| `security_rate_limits` | Documented rate-limit defaults | unique (owner, scope, limit_key, version); scope CHECK |
| `security_policies` | Deterministic policy registry (13 rules) | unique (rule_id, version); decision CHECK; read-only RLS |

## 4. Constraints & Integrity

- Every table has a primary key.
- Project-scoped records carry `project_id` (tasks, task_runs, approvals, audit_events,
  cost_events, decision_journal, autonomy_records, project_environments, project_passports).
- Foreign keys with `ON DELETE` semantics chosen per relationship (cascade for owned
  children; set null for historical references).
- Status/risk/authority/autonomy enum CHECK constraints.
- Non-negative cost/attempt/duration CHECK constraints.
- `updated_at` auto-maintained by trigger on mutable tables.

## 5. Deterministic Behavior Guarantees

- **One active preference version** per key (partial unique index).
- **One pending approval** per (task, action) (partial unique index).
- **Append-only audit** (triggers block UPDATE/DELETE).
- **Append-only security events** (triggers block UPDATE/DELETE).
- **Immutable critical-action registry** (triggers block UPDATE/DELETE; superuser-proof).
- **Lockdown history** (DELETE hard-blocked; owner-scoped release).
- **Default environments auto-created** per project (trigger).
- **Owner auto-created** on new auth user (trigger on `auth.users`).

## 6. Verification

- Schema applied live (22 tables, RLS on all 22).
- `supabase/tests/run_tests.cjs rls_tests.sql` → `RLS_TESTS.PASS` (Gate 1).
- `supabase/tests/run_tests.cjs rls_security_tests.sql` → `RLS_SECURITY_TESTS.SQL_PASS`
  (Gate 2 S1–S6). Both deterministic, repeatable, transactional ROLLBACK self-clean.
- `node supabase/tests/apply_migration.cjs 20260817000000_security_guardian.sql` →
  `MIGRATION_APPLIED`.

---

**END OF DATABASE (GATE 1 + GATE 2).**
