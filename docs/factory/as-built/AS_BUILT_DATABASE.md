# CHEF FACTORY — As-Built Database Reference

**Status:** IMPLEMENTED | **Evidence:** migration files + repo.ts + SQL test suites
**Last Verified:** 2026-08-16

---

## 1. Migration History

| # | Filename | Timestamp | Lines | Purpose | Status |
|---|----------|-----------|-------|---------|--------|
| 1 | `20260815220000_factory_init.sql` | 2026-08-15 22:00 | 702 | GATE 1 — Database foundation: 16 core tables, helper functions, updated_at triggers, append-only triggers, full RLS policies | IMPLEMENTED |
| 2 | `20260816000000_core_additions.sql` | 2026-08-16 00:00 | 34 | GATE 1 — Adds `memory_lessons` table for validated, secret-free lesson persistence behind the MemoryGateway boundary | IMPLEMENTED |
| 3 | `20260817000000_security_guardian.sql` | 2026-08-17 00:00 | 272 | GATE 2 — Security Guardian: `critical_actions` immutable registry (17 core rows), `security_events` append-only, `security_incidents`, `security_lockdowns`, `security_rate_limits`, `security_policies` read-only registry (13 rules) | IMPLEMENTED |
| 4 | `20260818000000_security_truncate_hardening.sql` | 2026-08-18 00:00 | 69 | GATE 2 — TRUNCATE guard: BEFORE TRUNCATE statement triggers on 7 protected tables, REVOKE TRUNCATE/TRIGGER from anon+authenticated on those tables | IMPLEMENTED |

---

## 2. Complete Table Inventory (23 tables)

### 2.1 Core Domain (13 tables)

#### `owners`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Owner identity, linked 1:1 to `auth.users` via trigger
- **Key Columns:**
  - `id uuid PK` → FK `auth.users(id) ON DELETE CASCADE`
  - `email text NOT NULL UNIQUE`
  - `display_name text`
  - `role text NOT NULL DEFAULT 'owner'` — CHECK `('owner','admin')`
  - `status text NOT NULL DEFAULT 'active'` — CHECK `('active','suspended','deleted')`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `updated_at timestamptz NOT NULL DEFAULT now()`
- **RLS:** `owners_select_self`, `owners_insert_self`, `owners_update_self` (authenticated, `auth.uid() = id`)
- **Truncation Protection:** NO

#### `projects`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Project registry; auto-creates 3 environments on insert
- **Key Columns:**
  - `id uuid PK DEFAULT gen_random_uuid()`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `name text NOT NULL`
  - `slug text NOT NULL`
  - `description text`
  - `status text NOT NULL DEFAULT 'draft'` — CHECK `('draft','active','paused','archived','deleted')`
  - `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `created_at / updated_at timestamptz`
  - UNIQUE `(owner_id, slug)`
- **RLS:** `projects_select_owner`, `projects_insert_owner`, `projects_update_owner`, `projects_delete_owner` (owner + agent read/write via `agent_has_permission`)
- **Truncation Protection:** NO

#### `project_environments`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Per-project environment slots (auto-created: development, staging, production)
- **Key Columns:**
  - `id uuid PK`
  - `project_id uuid NOT NULL` → FK `projects(id) ON DELETE CASCADE`
  - `name text NOT NULL` — CHECK `('development','staging','production')`
  - `is_protected boolean NOT NULL DEFAULT false`
  - `status text NOT NULL DEFAULT 'active'` — CHECK `('active','disabled','archived')`
  - `created_at / updated_at timestamptz`
  - UNIQUE `(project_id, name)`
- **RLS:** `envs_select_owner`, `envs_insert_owner`, `envs_update_owner`, `envs_delete_owner` (owner via project → owner_id; agent read via permission)
- **Truncation Protection:** NO

#### `project_passports`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Immutable project specification (1:1 with project, upserted)
- **Key Columns:**
  - `id uuid PK`
  - `project_id uuid NOT NULL UNIQUE` → FK `projects(id) ON DELETE CASCADE`
  - 16 jsonb fields: `identity`, `description`, `technology`, `repository`, `database_ref`, `environments`, `deployment`, `dependencies`, `models`, `runtimes`, `business_model`, `status`, `risks`, `credentials_references`, `operational_health`, `documentation_state`
  - `updated_at timestamptz NOT NULL DEFAULT now()`
- **RLS:** `passports_select_owner`, `passports_insert_owner`, `passports_update_owner`, `passports_delete_owner` (owner via project; agent read via permission)
- **Truncation Protection:** NO

#### `agents`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Agent registry (workers that receive tasks)
- **Key Columns:**
  - `id uuid PK`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `name text NOT NULL`, `slug text NOT NULL`, `role text NOT NULL`, `description text`
  - `capabilities jsonb NOT NULL DEFAULT '[]'::jsonb`
  - `status text NOT NULL DEFAULT 'active'` — CHECK `('active','paused','retired','suspended')`
  - `created_at / updated_at timestamptz`
  - UNIQUE `(owner_id, slug)`
- **RLS:** `agents_select_owner`, `agents_insert_owner`, `agents_update_owner`, `agents_delete_owner` (owner only)
- **Truncation Protection:** NO

#### `agent_permissions`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Granular per-agent, per-project, per-resource permissions
- **Key Columns:**
  - `id uuid PK`
  - `agent_id uuid NOT NULL` → FK `agents(id) ON DELETE CASCADE`
  - `project_id uuid` → FK `projects(id) ON DELETE CASCADE`
  - `environment_name text` — CHECK `('development','staging','production')`
  - `resource_type text NOT NULL`
  - `permission text NOT NULL` — CHECK `('read','write','execute','approve','admin')`
  - `status text NOT NULL DEFAULT 'active'` — CHECK `('active','revoked')`
  - `granted_by uuid` → FK `owners(id)`
  - `created_at timestamptz`
  - UNIQUE `(agent_id, project_id, environment_name, resource_type, permission)`
- **RLS:** `permissions_select_owner`, `permissions_insert_owner`, `permissions_update_owner`, `permissions_delete_owner` (owner via agent → owner_id)
- **Truncation Protection:** NO

#### `tasks`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Task execution lifecycle
- **Key Columns:**
  - `id uuid PK`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `project_id uuid NOT NULL` → FK `projects(id) ON DELETE CASCADE`
  - `environment_id uuid` → FK `project_environments(id)`
  - `parent_task_id uuid` → FK `tasks(id)`
  - `agent_id uuid` → FK `agents(id)`
  - `title text NOT NULL`, `description text`
  - `status text NOT NULL DEFAULT 'created'` — CHECK `('created','queued','running','completed','failed','cancelled','paused','needs_approval')`
  - `priority text NOT NULL DEFAULT 'medium'` — CHECK `('low','medium','high','critical')`
  - `risk_level text NOT NULL DEFAULT 'low'` — CHECK `('low','medium','high','critical')`
  - `authority_level text` — CHECK `('auto','notify','require_approval','deny')`
  - `autonomy text` — CHECK `('auto','notify','require_approval','deny')`
  - `approval_required boolean NOT NULL DEFAULT false`
  - `inputs jsonb NOT NULL DEFAULT '{}'::jsonb`, `output jsonb`, `error jsonb`
  - `attempts integer NOT NULL DEFAULT 0`, `max_attempts integer NOT NULL DEFAULT 3`
  - `correlation_id uuid`, `created_by uuid`
  - `created_at / started_at / completed_at / updated_at timestamptz`
- **RLS:** `tasks_select_owner`, `tasks_insert_owner`, `tasks_update_owner`, `tasks_delete_owner` (owner + agent read/write via permission)
- **Truncation Protection:** NO

#### `models`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** AI model registry (seeded with 6 default models)
- **Key Columns:**
  - `id uuid PK`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `provider text NOT NULL`, `name text NOT NULL`, `slug text NOT NULL`
  - `capability jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `context_window integer`
  - `cost_per_1k_input numeric(12,6) NOT NULL DEFAULT 0`
  - `cost_per_1k_output numeric(12,6) NOT NULL DEFAULT 0`
  - `status text NOT NULL DEFAULT 'active'` — CHECK `('active','limited','retired')`
  - `created_at / updated_at timestamptz`
  - UNIQUE `(owner_id, provider, name)`
- **RLS:** `models_select_owner`, `models_insert_owner`, `models_update_owner`, `models_delete_owner` (owner only)
- **Truncation Protection:** NO

#### `runtimes`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Runtime environment registry (seeded with 1 default)
- **Key Columns:**
  - `id uuid PK`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `name text NOT NULL`, `version text`, `slug text NOT NULL`
  - `capability jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `cost_per_hour numeric(12,6) NOT NULL DEFAULT 0`
  - `status text NOT NULL DEFAULT 'active'` — CHECK `('active','limited','retired')`
  - `created_at / updated_at timestamptz`
  - UNIQUE `(owner_id, name, version)`
- **RLS:** `runtimes_select_owner`, `runtimes_insert_owner`, `runtimes_update_owner`, `runtimes_delete_owner` (owner only)
- **Truncation Protection:** NO

#### `task_runs`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Per-task execution runs (versioned by run_number)
- **Key Columns:**
  - `id uuid PK`
  - `task_id uuid NOT NULL` → FK `tasks(id) ON DELETE CASCADE`
  - `run_number integer NOT NULL`
  - `status text NOT NULL DEFAULT 'running'` — CHECK `('running','completed','failed','cancelled','timeout')`
  - `model_id uuid` → FK `models(id)`
  - `runtime_id uuid` → FK `runtimes(id)`
  - `input_snapshot jsonb`, `output_snapshot jsonb`, `error jsonb`
  - `duration_ms integer`, `cost numeric(12,6) NOT NULL DEFAULT 0`
  - `started_at timestamptz NOT NULL DEFAULT now()`, `completed_at timestamptz`
  - UNIQUE `(task_id, run_number)`
- **RLS:** `task_runs_select_owner`, `task_runs_insert_owner`, `task_runs_update_owner`, `task_runs_delete_owner` (owner via task; agent read/write via task → permission)
- **Truncation Protection:** NO

#### `approvals`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Approval request/decision workflow (one pending per task+action)
- **Key Columns:**
  - `id uuid PK`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `project_id uuid` → FK `projects(id) ON DELETE SET NULL`
  - `task_id uuid` → FK `tasks(id) ON DELETE SET NULL`
  - `agent_id uuid` → FK `agents(id)`
  - `action text NOT NULL`, `description text`
  - `risk_level text`, `authority_level text`
  - `status text NOT NULL DEFAULT 'pending'` — CHECK `('pending','approved','rejected','denied','expired','cancelled')`
  - `decision text`, `decision_reason text`
  - `requested_by uuid`, `decided_by uuid` → FK `owners(id)`
  - `expires_at timestamptz`, `decided_at timestamptz`
  - `created_at / updated_at timestamptz`
  - UNIQUE partial index: `(task_id, action) WHERE status = 'pending'`
- **RLS:** `approvals_select_owner`, `approvals_insert_owner`, `approvals_update_owner`, `approvals_delete_owner` (owner + agent read/write via permission)
- **Truncation Protection:** NO

#### `audit_events`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Append-only audit trail (no UPDATE, no DELETE)
- **Key Columns:**
  - `id bigint GENERATED ALWAYS AS IDENTITY PK`
  - `actor_type text NOT NULL` — CHECK `('owner','agent','system')`
  - `actor_id uuid`
  - `action text NOT NULL`
  - `project_id uuid` → FK `projects(id) ON DELETE SET NULL`
  - `environment_id uuid` → FK `project_environments(id) ON DELETE SET NULL`
  - `resource_type text`, `resource_id text`
  - `authorization_result text` — CHECK `('auto','notify','require_approval','deny')`
  - `correlation_id uuid`
  - `task_id uuid` → FK `tasks(id) ON DELETE SET NULL`
  - `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `created_at timestamptz NOT NULL DEFAULT now()`
- **RLS:** `audit_insert_allowed`, `audit_select_allowed` (owner or agent with permission; **no UPDATE/DELETE policies**)
- **Triggers:** `audit_events_no_update`, `audit_events_no_delete` (raise on UPDATE/DELETE), `audit_events_no_truncate` (raise on TRUNCATE)
- **Truncation Protection:** **YES** — trigger + REVOKE from anon/authenticated

#### `cost_events`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Cost tracking per task/run/agent/project
- **Key Columns:**
  - `id uuid PK`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `project_id uuid` → FK `projects(id) ON DELETE SET NULL`
  - `task_id uuid` → FK `tasks(id) ON DELETE SET NULL`
  - `run_id uuid` → FK `task_runs(id) ON DELETE SET NULL`
  - `agent_id uuid` → FK `agents(id)`
  - `cost_type text NOT NULL` — CHECK `('model','runtime','tool','mission','project')`
  - `amount numeric(12,6) NOT NULL`
  - `currency text NOT NULL DEFAULT 'USD'`
  - `provider text`, `model_id uuid`, `runtime_id uuid`
  - `billed_to text NOT NULL DEFAULT 'project'` — CHECK `('project','mission','owner')`
  - `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `created_at timestamptz NOT NULL DEFAULT now()`
- **RLS:** `cost_select_owner`, `cost_insert_owner`, `cost_update_owner`, `cost_delete_owner` (owner; agent insert via permission)
- **Truncation Protection:** NO

#### `personal_preferences`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Owner Personal Operating Specifications (POS) — versioned key-value store
- **Key Columns:**
  - `id uuid PK`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `category text NOT NULL`, `key text NOT NULL`, `value jsonb NOT NULL`
  - `version integer NOT NULL`
  - `is_active boolean NOT NULL DEFAULT true`
  - `created_at / updated_at timestamptz`
  - UNIQUE `(owner_id, category, key, version)`
  - UNIQUE partial index: `(owner_id, category, key) WHERE is_active`
- **RLS:** `prefs_select_owner`, `prefs_insert_owner`, `prefs_update_owner`, `prefs_delete_owner` (owner only)
- **Truncation Protection:** NO

#### `decision_journal`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Decision audit log (context, options, reasoning, outcome)
- **Key Columns:**
  - `decision_id uuid PK`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `project_id uuid` → FK `projects(id) ON DELETE SET NULL`
  - `context text NOT NULL`
  - `options jsonb NOT NULL DEFAULT '[]'::jsonb`
  - `selected_option text`, `reason text`
  - `evidence jsonb NOT NULL DEFAULT '[]'::jsonb`
  - `confidence numeric(3,2)` — CHECK `(between 0 and 1)`
  - `risk_level text`, `authority_level text`
  - `approved_by uuid` → FK `owners(id)`
  - `outcome text`
  - `created_at timestamptz NOT NULL DEFAULT now()`
- **RLS:** `decisions_select_owner`, `decisions_insert_owner`, `decisions_update_owner`, `decisions_delete_owner` (owner only)
- **Truncation Protection:** NO

#### `autonomy_records`
- **Migration:** `20260815220000_factory_init.sql`
- **Purpose:** Agent autonomy decision audit trail
- **Key Columns:**
  - `id uuid PK`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `agent_id uuid NOT NULL` → FK `agents(id)`
  - `project_id uuid` → FK `projects(id) ON DELETE SET NULL`
  - `environment_id uuid` → FK `project_environments(id) ON DELETE SET NULL`
  - `action text NOT NULL`
  - `risk_level text`
  - `selected_autonomy text` — CHECK `('auto','notify','require_approval','deny')`
  - `policy_inputs jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `evidence jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `decision text`
  - `approval_status text` — CHECK `('pending','approved','rejected','denied','not_required')`
  - `outcome text`
  - `created_at timestamptz NOT NULL DEFAULT now()`
- **RLS:** `autonomy_select_owner`, `autonomy_insert_owner`, `autonomy_update_owner`, `autonomy_delete_owner` (owner only)
- **Truncation Protection:** NO

#### `memory_lessons`
- **Migration:** `20260816000000_core_additions.sql`
- **Purpose:** Validated lesson persistence behind MemoryGateway boundary
- **Key Columns:**
  - `id uuid PK DEFAULT gen_random_uuid()`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `title text NOT NULL`, `summary text NOT NULL`, `category text NOT NULL`
  - `project_id uuid` → FK `projects(id) ON DELETE SET NULL`
  - `confidence numeric(3,2)` — CHECK `(between 0 and 1)`
  - `created_at timestamptz NOT NULL DEFAULT now()`
- **RLS:** `memory_lessons_select_owner`, `memory_lessons_insert_owner`, `memory_lessons_update_owner`, `memory_lessons_delete_owner` (owner only)
- **Truncation Protection:** NO

---

### 2.2 Security Domain (6 tables)

#### `critical_actions`
- **Migration:** `20260817000000_security_guardian.sql`
- **Purpose:** Global immutable registry of critical action classifications (17 core rows). Read-only for all roles.
- **Key Columns:**
  - `action text PK`
  - `classification text NOT NULL` — CHECK 12 classification types
  - `default_decision text NOT NULL` — CHECK `('deny','require_approval')`
  - `environments text NOT NULL DEFAULT 'all'`
  - `description text NOT NULL`
  - `is_core boolean NOT NULL DEFAULT true`
  - `version integer NOT NULL DEFAULT 1`
  - `created_at / updated_at timestamptz`
- **RLS:** `critical_actions_select_all` (authenticated: `USING (true)`, no INSERT/UPDATE/DELETE policies)
- **Triggers:** `critical_actions_no_update`, `critical_actions_no_delete` (raise on UPDATE/DELETE), `critical_actions_set_updated_at`, `critical_actions_no_truncate` (raise on TRUNCATE)
- **Truncation Protection:** **YES** — trigger + REVOKE from anon/authenticated
- **Seeded rows:** 17 (see §2.2.1 below)

##### 2.2.1 Critical Actions Registry (17 rows)

| action | classification | default_decision |
|--------|---------------|-----------------|
| `production_modification` | production | require_approval |
| `production_deletion` | production | deny |
| `database_destructive` | destructive | deny |
| `secret_access` | secret | require_approval |
| `secret_rotation` | secret | require_approval |
| `permission_escalation` | permission | deny |
| `security_policy_modification` | policy | require_approval |
| `disable_audit` | audit | deny |
| `disable_rls` | audit | deny |
| `owner_identity_change` | identity | require_approval |
| `authority_rule_change` | authority | require_approval |
| `autonomy_rule_change` | authority | require_approval |
| `financial_transaction` | financial | deny |
| `legal_commitment` | contractual | deny |
| `external_irreversible` | external_irreversible | require_approval |
| `factory_shutdown` | factory | deny |
| `lockdown_release` | factory | deny |

**Summary:** 9 deny-by-default, 8 require_approval. All `is_core = true`.

#### `security_events`
- **Migration:** `20260817000000_security_guardian.sql`
- **Purpose:** Append-only security event log (owner-scoped)
- **Key Columns:**
  - `security_event_id uuid PK`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `project_id uuid` → FK `projects(id) ON DELETE SET NULL`
  - `agent_id uuid` → FK `agents(id) ON DELETE SET NULL`
  - `task_id uuid` → FK `tasks(id) ON DELETE SET NULL`
  - `correlation_id uuid`
  - `environment text NOT NULL DEFAULT 'development'` — CHECK `('development','staging','production')`
  - `event_type text NOT NULL`, `severity text NOT NULL` — CHECK `('info','low','medium','high','critical')`
  - `action text NOT NULL`, `resource text`
  - `decision text` — CHECK `('allow','notify','require_approval','deny','lockdown')`
  - `reason text NOT NULL`
  - `evidence_references jsonb NOT NULL DEFAULT '[]'::jsonb`
  - `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `occurred_at / recorded_at timestamptz NOT NULL DEFAULT now()`
- **RLS:** `security_events_select_owner`, `security_events_insert_owner` (owner only; **no UPDATE/DELETE policies**)
- **Triggers:** `security_events_no_update`, `security_events_no_delete` (raise on UPDATE/DELETE), `security_events_no_truncate` (raise on TRUNCATE)
- **Truncation Protection:** **YES** — trigger + REVOKE from anon/authenticated

#### `security_incidents`
- **Migration:** `20260817000000_security_guardian.sql`
- **Purpose:** Security incident workflow (foundational)
- **Key Columns:**
  - `incident_id uuid PK`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `title text NOT NULL`
  - `status text NOT NULL DEFAULT 'detected'` — CHECK `('detected','investigating','contained','resolved','closed')`
  - `description text`
  - `event_ids jsonb NOT NULL DEFAULT '[]'::jsonb`
  - `opened_by uuid` → FK `owners(id)`
  - `closed_by uuid` → FK `owners(id)`
  - `created_at / updated_at timestamptz`
- **RLS:** `security_incidents_select_owner`, `security_incidents_insert_owner`, `security_incidents_update_owner`, `security_incidents_delete_owner` (owner only)
- **Triggers:** `security_incidents_set_updated_at`, `security_incidents_no_truncate` (raise on TRUNCATE)
- **Truncation Protection:** **YES** — trigger + REVOKE from anon/authenticated

#### `security_lockdowns`
- **Migration:** `20260817000000_security_guardian.sql`
- **Purpose:** Emergency lockdown history (append-only for deletions; owner can release)
- **Key Columns:**
  - `lockdown_id uuid PK`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `scope text NOT NULL DEFAULT 'all'`
  - `reason text NOT NULL`
  - `status text NOT NULL DEFAULT 'active'` — CHECK `('active','released')`
  - `activated_by uuid NOT NULL` → FK `owners(id)`
  - `released_by uuid` → FK `owners(id)`
  - `released_at timestamptz`
  - `created_at timestamptz NOT NULL DEFAULT now()`
- **RLS:** `security_lockdowns_select_owner`, `security_lockdowns_insert_owner`, `security_lockdowns_update_owner` (owner only; **no DELETE policy**)
- **Triggers:** `security_lockdowns_no_delete` (raise on DELETE), `security_lockdowns_no_truncate` (raise on TRUNCATE)
- **Truncation Protection:** **YES** — trigger + REVOKE from anon/authenticated

#### `security_rate_limits`
- **Migration:** `20260817000000_security_guardian.sql`
- **Purpose:** Owner-configurable rate limit rules
- **Key Columns:**
  - `id uuid PK DEFAULT gen_random_uuid()`
  - `owner_id uuid NOT NULL` → FK `owners(id) ON DELETE CASCADE`
  - `scope text NOT NULL` — CHECK `('task','tool','runtime','model','auth','approval','failure')`
  - `limit_key text NOT NULL`
  - `max_count integer NOT NULL`
  - `window_seconds integer NOT NULL`
  - `enabled boolean NOT NULL DEFAULT true`
  - `version integer NOT NULL DEFAULT 1`
  - `created_at / updated_at timestamptz`
  - UNIQUE `(owner_id, scope, limit_key, version)`
- **RLS:** `security_rate_limits_select_owner`, `security_rate_limits_insert_owner`, `security_rate_limits_update_owner`, `security_rate_limits_delete_owner` (owner only)
- **Triggers:** `security_rate_limits_no_truncate` (raise on TRUNCATE)
- **Truncation Protection:** **YES** — trigger + REVOKE from anon/authenticated

#### `security_policies`
- **Migration:** `20260817000000_security_guardian.sql`
- **Purpose:** Read-only deterministic rule documentation registry (13 rules)
- **Key Columns:**
  - `policy_id uuid PK DEFAULT gen_random_uuid()`
  - `rule_id text NOT NULL`
  - `version integer NOT NULL DEFAULT 1`
  - `precedence integer NOT NULL`
  - `decision text NOT NULL` — CHECK `('allow','notify','require_approval','deny','lockdown')`
  - `description text NOT NULL`
  - `enabled boolean NOT NULL DEFAULT true`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - UNIQUE `(rule_id, version)`
- **RLS:** `security_policies_select_all` (authenticated: `USING (true)`, no INSERT/UPDATE/DELETE policies)
- **Triggers:** `security_policies_no_truncate` (raise on TRUNCATE)
- **Truncation Protection:** **YES** — trigger + REVOKE from anon/authenticated
- **Seeded rows:** 13

##### 2.2.2 Security Policies Registry (13 rules)

| rule_id | precedence | decision |
|---------|-----------|----------|
| `rule.lockdown_active` | 100 | lockdown |
| `rule.critical.deny` | 90 | deny |
| `rule.environment_escalation` | 80 | deny |
| `rule.cross_project` | 80 | deny |
| `rule.rate_limit` | 80 | deny |
| `rule.cost_stopped` | 80 | deny |
| `rule.critical.require_approval` | 60 | require_approval |
| `rule.production.write_execute` | 50 | require_approval |
| `rule.staging.notify` | 40 | notify |
| `rule.not_authorized` | 30 | deny |
| `rule.explicit_deny` | 30 | deny |
| `rule.default.allow` | 10 | allow |
| `rule.untrusted_directive` | 50 | notify |

---

## 3. Indexes

### Migration 1 (`20260815220000_factory_init.sql`)

| Table | Index Name | Column(s) |
|-------|-----------|-----------|
| `owners` | `owners_status_idx` | `status` |
| `projects` | `projects_owner_id_idx` | `owner_id` |
| `projects` | `projects_status_idx` | `status` |
| `project_environments` | `project_environments_project_id_idx` | `project_id` |
| `agents` | `agents_owner_id_idx` | `owner_id` |
| `agents` | `agents_status_idx` | `status` |
| `agent_permissions` | `agent_permissions_agent_id_idx` | `agent_id` |
| `agent_permissions` | `agent_permissions_project_id_idx` | `project_id` |
| `agent_permissions` | `agent_permissions_resource_idx` | `resource_type` |
| `tasks` | `tasks_project_id_idx` | `project_id` |
| `tasks` | `tasks_agent_id_idx` | `agent_id` |
| `tasks` | `tasks_status_idx` | `status` |
| `tasks` | `tasks_parent_task_id_idx` | `parent_task_id` |
| `tasks` | `tasks_correlation_id_idx` | `correlation_id` |
| `models` | `models_owner_id_idx` | `owner_id` |
| `models` | `models_status_idx` | `status` |
| `runtimes` | `runtimes_owner_id_idx` | `owner_id` |
| `runtimes` | `runtimes_status_idx` | `status` |
| `task_runs` | `task_runs_task_id_idx` | `task_id` |
| `task_runs` | `task_runs_model_id_idx` | `model_id` |
| `task_runs` | `task_runs_runtime_id_idx` | `runtime_id` |
| `task_runs` | `task_runs_status_idx` | `status` |
| `approvals` | `approvals_owner_id_idx` | `owner_id` |
| `approvals` | `approvals_project_id_idx` | `project_id` |
| `approvals` | `approvals_task_id_idx` | `task_id` |
| `approvals` | `approvals_status_idx` | `status` |
| `approvals` | `approvals_one_pending_idx` | `(task_id, action) WHERE status = 'pending'` |
| `audit_events` | `audit_events_project_id_idx` | `project_id` |
| `audit_events` | `audit_events_actor_idx` | `(actor_type, actor_id)` |
| `audit_events` | `audit_events_created_at_idx` | `created_at` |
| `audit_events` | `audit_events_correlation_id_idx` | `correlation_id` |
| `audit_events` | `audit_events_task_id_idx` | `task_id` |
| `cost_events` | `cost_events_owner_id_idx` | `owner_id` |
| `cost_events` | `cost_events_project_id_idx` | `project_id` |
| `cost_events` | `cost_events_cost_type_idx` | `cost_type` |
| `cost_events` | `cost_events_created_at_idx` | `created_at` |
| `personal_preferences` | `personal_preferences_owner_id_idx` | `owner_id` |
| `personal_preferences` | `personal_preferences_active_uniq` | `(owner_id, category, key) WHERE is_active` |
| `decision_journal` | `decision_journal_owner_id_idx` | `owner_id` |
| `decision_journal` | `decision_journal_project_id_idx` | `project_id` |
| `decision_journal` | `decision_journal_created_at_idx` | `created_at` |
| `autonomy_records` | `autonomy_records_owner_id_idx` | `owner_id` |
| `autonomy_records` | `autonomy_records_agent_id_idx` | `agent_id` |
| `autonomy_records` | `autonomy_records_project_id_idx` | `project_id` |
| `autonomy_records` | `autonomy_records_created_at_idx` | `created_at` |

### Migration 2 (`20260816000000_core_additions.sql`)

| Table | Index Name | Column(s) |
|-------|-----------|-----------|
| `memory_lessons` | `memory_lessons_owner_id_idx` | `owner_id` |
| `memory_lessons` | `memory_lessons_category_idx` | `category` |

### Migration 3 (`20260817000000_security_guardian.sql`)

| Table | Index Name | Column(s) |
|-------|-----------|-----------|
| `security_events` | `security_events_owner_id_idx` | `owner_id` |
| `security_events` | `security_events_project_id_idx` | `project_id` |
| `security_events` | `security_events_type_idx` | `event_type` |
| `security_events` | `security_events_severity_idx` | `severity` |
| `security_events` | `security_events_occurred_at_idx` | `occurred_at` |
| `security_events` | `security_events_correlation_id_idx` | `correlation_id` |
| `security_incidents` | `security_incidents_owner_id_idx` | `owner_id` |
| `security_incidents` | `security_incidents_status_idx` | `status` |
| `security_incidents` | `security_incidents_created_at_idx` | `created_at` |
| `security_lockdowns` | `security_lockdowns_owner_id_idx` | `owner_id` |
| `security_lockdowns` | `security_lockdowns_status_idx` | `status` |
| `security_rate_limits` | `security_rate_limits_owner_id_idx` | `owner_id` |

**Total indexes: 59**

---

## 4. Database Functions

### `set_updated_at()`
- **Migration:** `20260815220000_factory_init.sql`
- **Type:** Trigger function (`RETURNS trigger`)
- **Security:** `SECURITY DEFINER`, `set search_path = public`
- **Behavior:** Sets `new.updated_at = now()` before every UPDATE

### `handle_new_user()`
- **Migration:** `20260815220000_factory_init.sql`
- **Type:** Trigger function (`RETURNS trigger`)
- **Security:** `SECURITY DEFINER`, `set search_path = public`
- **Behavior:** On `auth.users` INSERT, creates a row in `public.owners` with the user's ID, email, and display_name (from raw_user_meta_data); `ON CONFLICT (id) DO NOTHING`

### `ensure_project_environments()`
- **Migration:** `20260815220000_factory_init.sql`
- **Type:** Trigger function (`RETURNS trigger`)
- **Security:** `SECURITY DEFINER`, `set search_path = public`
- **Behavior:** After project INSERT, auto-creates 3 environment rows: `development` (not protected), `staging` (not protected), `production` (protected)

### `is_owner()`
- **Migration:** `20260815220000_factory_init.sql`
- **Type:** SQL function (`RETURNS boolean`)
- **Security:** `SECURITY DEFINER`, `set search_path = public`, `STABLE`
- **Behavior:** Returns `true` if `auth.uid()` exists in `owners` with `status = 'active'`

### `requesting_agent()`
- **Migration:** `20260815220000_factory_init.sql`
- **Type:** SQL function (`RETURNS uuid`)
- **Security:** default, `STABLE`
- **Behavior:** Reads `current_setting('request.agent_id', true)` and returns as UUID (or NULL if empty)

### `agent_has_permission(p_project, p_resource, p_permission)`
- **Migration:** `20260815220000_factory_init.sql`
- **Type:** SQL function (`RETURNS boolean`)
- **Security:** `SECURITY DEFINER`, `set search_path = public`, `STABLE`
- **Behavior:** Checks if the requesting agent (from `request.agent_id`) has an active permission matching the given project, resource_type, and permission; supports global permissions via `project_id IS NULL`

### `block_audit_mutation()`
- **Migration:** `20260815220000_factory_init.sql`
- **Type:** Trigger function (`RETURNS trigger`)
- **Security:** `SECURITY DEFINER`, `set search_path = public`
- **Behavior:** `RAISE EXCEPTION 'audit_events is append-only'` — blocks UPDATE and DELETE on `audit_events`, TRUNCATE on `audit_events`

### `block_critical_action_mutation()`
- **Migration:** `20260817000000_security_guardian.sql`
- **Type:** Trigger function (`RETURNS trigger`)
- **Security:** `SECURITY DEFINER`, `set search_path = public`
- **Behavior:** On UPDATE: raises `'critical_actions registry is immutable: core rows can never be modified'`; on DELETE/other: raises `'critical_actions registry is immutable'`. Also fires for TRUNCATE on `critical_actions`.

### `block_security_event_mutation()`
- **Migration:** `20260817000000_security_guardian.sql`
- **Type:** Trigger function (`RETURNS trigger`)
- **Security:** `SECURITY DEFINER`, `set search_path = public`
- **Behavior:** `RAISE EXCEPTION 'security_events is append-only'` — blocks UPDATE, DELETE, and TRUNCATE on `security_events`

### `block_lockdown_deletion()`
- **Migration:** `20260817000000_security_guardian.sql`
- **Type:** Trigger function (`RETURNS trigger`)
- **Security:** `SECURITY DEFINER`, `set search_path = public`
- **Behavior:** `RAISE EXCEPTION 'security_lockdowns is history; rows cannot be deleted'` — blocks DELETE and TRUNCATE on `security_lockdowns`

### `block_security_table_truncate()`
- **Migration:** `20260818000000_security_truncate_hardening.sql`
- **Type:** Trigger function (`RETURNS trigger`)
- **Security:** `SECURITY DEFINER`, `set search_path = public`
- **Behavior:** `RAISE EXCEPTION 'security table truncation is blocked'` — generic TRUNCATE guard for `security_incidents`, `security_rate_limits`, `security_policies`

---

## 5. Triggers

### updated_at Triggers (12)

All use `set_updated_at()` (`BEFORE UPDATE ... FOR EACH ROW`):

| Table | Trigger Name |
|-------|-------------|
| `owners` | `owners_set_updated_at` |
| `projects` | `projects_set_updated_at` |
| `project_environments` | `project_environments_set_updated_at` |
| `project_passports` | `project_passports_set_updated_at` |
| `agents` | `agents_set_updated_at` |
| `tasks` | `tasks_set_updated_at` |
| `models` | `models_set_updated_at` |
| `runtimes` | `runtimes_set_updated_at` |
| `approvals` | `approvals_set_updated_at` |
| `personal_preferences` | `personal_preferences_set_updated_at` |
| `critical_actions` | `critical_actions_set_updated_at` |
| `security_incidents` | `security_incidents_set_updated_at` |

### Auth / Business Logic Triggers (2)

| Table | Trigger Name | Event | Function |
|-------|-------------|-------|----------|
| `auth.users` | `on_auth_user_created` | `AFTER INSERT` | `handle_new_user()` — auto-creates owner row |
| `projects` | `projects_ensure_environments` | `AFTER INSERT` | `ensure_project_environments()` — auto-creates 3 env rows |

### Append-Only Enforcement Triggers (6)

| Table | Trigger Name | Event | Function |
|-------|-------------|-------|----------|
| `audit_events` | `audit_events_no_update` | `BEFORE UPDATE` | `block_audit_mutation()` |
| `audit_events` | `audit_events_no_delete` | `BEFORE DELETE` | `block_audit_mutation()` |
| `security_events` | `security_events_no_update` | `BEFORE UPDATE` | `block_security_event_mutation()` |
| `security_events` | `security_events_no_delete` | `BEFORE DELETE` | `block_security_event_mutation()` |
| `security_lockdowns` | `security_lockdowns_no_delete` | `BEFORE DELETE` | `block_lockdown_deletion()` |
| `critical_actions` | `critical_actions_no_update` | `BEFORE UPDATE` | `block_critical_action_mutation()` |
| `critical_actions` | `critical_actions_no_delete` | `BEFORE DELETE` | `block_critical_action_mutation()` |

### Truncate Guard Triggers (7) — Migration 4

All `BEFORE TRUNCATE ... FOR EACH STATEMENT`:

| Table | Trigger Name | Function |
|-------|-------------|----------|
| `security_events` | `security_events_no_truncate` | `block_security_event_mutation()` |
| `critical_actions` | `critical_actions_no_truncate` | `block_critical_action_mutation()` |
| `security_lockdowns` | `security_lockdowns_no_truncate` | `block_lockdown_deletion()` |
| `security_incidents` | `security_incidents_no_truncate` | `block_security_table_truncate()` |
| `security_rate_limits` | `security_rate_limits_no_truncate` | `block_security_table_truncate()` |
| `security_policies` | `security_policies_no_truncate` | `block_security_table_truncate()` |
| `audit_events` | `audit_events_no_truncate` | `block_audit_mutation()` |

**Total triggers: 28**

---

## 6. Row-Level Security (RLS)

RLS is enabled on all 23 tables. All policies target the `authenticated` role. The `anon` role has no SELECT policies on any table and is fully blocked. The `service_role` bypasses RLS entirely (Supabase default).

### 6.1 Core Domain RLS

#### `owners` (3 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `owners_select_self` | SELECT | Can only read own row (`auth.uid() = id`) |
| `owners_insert_self` | INSERT | Can only insert own row |
| `owners_update_self` | UPDATE | Can only update own row |

#### `projects` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `projects_select_owner` | SELECT | Owner reads own; agent reads via `agent_has_permission(id, 'projects', 'read')` |
| `projects_insert_owner` | INSERT | Owner inserts own project |
| `projects_update_owner` | UPDATE | Owner updates own project |
| `projects_delete_owner` | DELETE | Owner deletes own project |

#### `project_environments` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `envs_select_owner` | SELECT | Owner reads via project owner_id; agent reads via permission |
| `envs_insert_owner` | INSERT | Owner inserts via project ownership |
| `envs_update_owner` | UPDATE | Owner updates via project ownership |
| `envs_delete_owner` | DELETE | Owner deletes via project ownership |

#### `project_passports` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `passports_select_owner` | SELECT | Owner reads via project owner_id; agent reads via permission |
| `passports_insert_owner` | INSERT | Owner inserts via project ownership |
| `passports_update_owner` | UPDATE | Owner updates via project ownership |
| `passports_delete_owner` | DELETE | Owner deletes via project ownership |

#### `agents` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `agents_select_owner` | SELECT | Owner reads own agents |
| `agents_insert_owner` | INSERT | Owner inserts own agents |
| `agents_update_owner` | UPDATE | Owner updates own agents |
| `agents_delete_owner` | DELETE | Owner deletes own agents |

#### `agent_permissions` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `permissions_select_owner` | SELECT | Owner reads via agent → owner_id |
| `permissions_insert_owner` | INSERT | Owner inserts via agent → owner_id |
| `permissions_update_owner` | UPDATE | Owner updates via agent → owner_id |
| `permissions_delete_owner` | DELETE | Owner deletes via agent → owner_id |

#### `tasks` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `tasks_select_owner` | SELECT | Owner reads own; agent reads via `agent_has_permission(project_id, 'tasks', 'read')` |
| `tasks_insert_owner` | INSERT | Owner inserts own; agent inserts via `agent_has_permission(project_id, 'tasks', 'write')` |
| `tasks_update_owner` | UPDATE | Owner updates own only |
| `tasks_delete_owner` | DELETE | Owner deletes own only |

#### `task_runs` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `task_runs_select_owner` | SELECT | Owner reads via task owner_id; agent reads via task → permission |
| `task_runs_insert_owner` | INSERT | Owner inserts via task owner_id; agent inserts via task → permission |
| `task_runs_update_owner` | UPDATE | Owner updates via task owner_id |
| `task_runs_delete_owner` | DELETE | Owner deletes via task owner_id |

#### `models` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `models_select_owner` | SELECT | Owner reads own |
| `models_insert_owner` | INSERT | Owner inserts own |
| `models_update_owner` | UPDATE | Owner updates own |
| `models_delete_owner` | DELETE | Owner deletes own |

#### `runtimes` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `runtimes_select_owner` | SELECT | Owner reads own |
| `runtimes_insert_owner` | INSERT | Owner inserts own |
| `runtimes_update_owner` | UPDATE | Owner updates own |
| `runtimes_delete_owner` | DELETE | Owner deletes own |

#### `approvals` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `approvals_select_owner` | SELECT | Owner reads own; agent reads via permission |
| `approvals_insert_owner` | INSERT | Owner inserts own; agent inserts via permission |
| `approvals_update_owner` | UPDATE | Owner updates own |
| `approvals_delete_owner` | DELETE | Owner deletes own |

#### `audit_events` (2 policies — append-only)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `audit_insert_allowed` | INSERT | Owner (`is_owner()`) or agent with permission can insert |
| `audit_select_allowed` | SELECT | Owner or agent with permission can read |
| — | UPDATE | No policy (0 rows affected via RLS) + trigger blocks |
| — | DELETE | No policy (0 rows affected via RLS) + trigger blocks |

#### `cost_events` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `cost_select_owner` | SELECT | Owner reads own |
| `cost_insert_owner` | INSERT | Owner inserts; agent inserts via permission |
| `cost_update_owner` | UPDATE | Owner updates own |
| `cost_delete_owner` | DELETE | Owner deletes own |

#### `personal_preferences` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `prefs_select_owner` | SELECT | Owner reads own |
| `prefs_insert_owner` | INSERT | Owner inserts own |
| `prefs_update_owner` | UPDATE | Owner updates own |
| `prefs_delete_owner` | DELETE | Owner deletes own |

#### `decision_journal` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `decisions_select_owner` | SELECT | Owner reads own |
| `decisions_insert_owner` | INSERT | Owner inserts own |
| `decisions_update_owner` | UPDATE | Owner updates own |
| `decisions_delete_owner` | DELETE | Owner deletes own |

#### `autonomy_records` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `autonomy_select_owner` | SELECT | Owner reads own |
| `autonomy_insert_owner` | INSERT | Owner inserts own |
| `autonomy_update_owner` | UPDATE | Owner updates own |
| `autonomy_delete_owner` | DELETE | Owner deletes own |

#### `memory_lessons` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `memory_lessons_select_owner` | SELECT | Owner reads own |
| `memory_lessons_insert_owner` | INSERT | Owner inserts own |
| `memory_lessons_update_owner` | UPDATE | Owner updates own |
| `memory_lessons_delete_owner` | DELETE | Owner deletes own |

### 6.2 Security Domain RLS

#### `critical_actions` (1 policy — global read-only)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `critical_actions_select_all` | SELECT | All authenticated users can read (USING `true`) |
| — | INSERT | No policy |
| — | UPDATE | No policy + trigger blocks |
| — | DELETE | No policy + trigger blocks |

#### `security_events` (2 policies — append-only)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `security_events_select_owner` | SELECT | Owner reads own |
| `security_events_insert_owner` | INSERT | Owner inserts own |
| — | UPDATE | No policy + trigger blocks |
| — | DELETE | No policy + trigger blocks |

#### `security_incidents` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `security_incidents_select_owner` | SELECT | Owner reads own |
| `security_incidents_insert_owner` | INSERT | Owner inserts own |
| `security_incidents_update_owner` | UPDATE | Owner updates own |
| `security_incidents_delete_owner` | DELETE | Owner deletes own |

#### `security_lockdowns` (3 policies — no DELETE)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `security_lockdowns_select_owner` | SELECT | Owner reads own |
| `security_lockdowns_insert_owner` | INSERT | Owner inserts own |
| `security_lockdowns_update_owner` | UPDATE | Owner updates own (status transitions) |
| — | DELETE | No policy + trigger blocks |

#### `security_rate_limits` (4 policies)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `security_rate_limits_select_owner` | SELECT | Owner reads own |
| `security_rate_limits_insert_owner` | INSERT | Owner inserts own |
| `security_rate_limits_update_owner` | UPDATE | Owner updates own |
| `security_rate_limits_delete_owner` | DELETE | Owner deletes own |

#### `security_policies` (1 policy — global read-only)
| Policy | Operation | Effect |
|--------|-----------|--------|
| `security_policies_select_all` | SELECT | All authenticated users can read (USING `true`) |
| — | INSERT | No policy |
| — | UPDATE | No policy |
| — | DELETE | No policy |

---

## 7. REVOKE Statements

All from migration `20260818000000_security_truncate_hardening.sql`:

| Table | Revoke | From Roles |
|-------|--------|-----------|
| `security_events` | TRUNCATE, TRIGGER | anon, authenticated |
| `critical_actions` | TRUNCATE, TRIGGER | anon, authenticated |
| `security_lockdowns` | TRUNCATE, TRIGGER | anon, authenticated |
| `security_incidents` | TRUNCATE, TRIGGER | anon, authenticated |
| `security_rate_limits` | TRUNCATE, TRIGGER | anon, authenticated |
| `security_policies` | TRUNCATE, TRIGGER | anon, authenticated |
| `audit_events` | TRUNCATE, TRIGGER | anon, authenticated |

**Note:** No other REVOKE statements exist in any migration. No REVOKE on INSERT/UPDATE/DELETE for any table. No REVOKE on `SELECT` for any table.

---

## 8. SQL Test Suites

### 8.1 `rls_tests.sql` (Gate 1 — 249 lines)

Transactional (BEGIN/ROLLBACK), self-cleaning. Uses two test owners: `owner1@factory.test` (1111…1111) and `owner2@factory.test` (2222…2222).

| Test | Name | What It Tests |
|------|------|--------------|
| Seed | `on_auth_user_created` trigger | Inserts 2 auth.users, verifies 2 owners created |
| 1 | OWNER IDENTITY | Owner1 can read own row; owner1 cannot read owner2's row (RLS isolation) |
| 2 | OWNER SEES ALL OWN PROJECTS | Owner1 sees all 2 projects and 2 tasks (not filtered by project) |
| 3 | PROJECT ISOLATION + PROJECT SCOPE | Agent with permission on Project A only: sees 1 project, 1 task in A, 0 tasks in B |
| 4 | UNAUTHORIZED ACCESS | `anon` role sees 0 projects, 0 owners; unknown authenticated user (no owner row) sees 0 projects, 0 tasks |
| 5 | AUDIT APPEND-ONLY BEHAVIOR | Owner cannot UPDATE/DELETE audit_events via RLS (0 rows); superuser cannot UPDATE/DELETE audit_events via triggers |
| 6 | PREFERENCE VERSIONING | Only 1 active version per key; deactivating old version allows new; total versions = 2 |
| 7 | REQUIRED FOREIGN KEYS | FK enforced: bad project_id, missing project_id, bad agent_id, negative cost |

**Helper functions:** `_tfail(name)`, `_texpect_error(sqltext, name)`

### 8.2 `rls_security_tests.sql` (Gate 2 — 321 lines)

Transactional (BEGIN/ROLLBACK), self-cleaning. Uses two test owners: `sec-owner1@factory.test` and `sec-owner2@factory.test`.

| Test | Name | What It Tests |
|------|------|--------------|
| S1 | CRITICAL ACTIONS REGISTRY | 17 core rows, all `is_core=true`, 9 deny-by-default, 8 require_approval; UPDATE/DELETE blocked by trigger; invalid decision blocked by CHECK; authenticated owner can read |
| S2 | SECURITY EVENTS: owner isolation + append-only | Owner1 sees 1 event (not owner2's); RLS UPDATE/DELETE affect 0 rows; trigger blocks UPDATE/DELETE as superuser |
| S3 | SECURITY LOCKDOWNS: owner scope, history, owner release | Owner1 sees 1 lockdown; owner can release own lockdown (status transition); DELETE blocked by trigger |
| S4 | SECURITY INCIDENTS: owner-scoped CRUD | Owner1 sees 1 incident; owner can update own incident status; owner cannot see/update owner2's incident |
| S5 | SECURITY POLICIES: read-only registry | 13 rules, all enabled; owner can read all; RLS UPDATE affects 0 rows |
| S6 | SECURITY RATE LIMITS: owner scope | Owner1 sees own rate limit config only |
| S7 | TRUNCATE GUARD (defense-in-depth) | Trigger layer: TRUNCATE blocked for all 7 protected tables (even as superuser); Privilege layer: TRUNCATE denied to `authenticated` role for security_events, critical_actions, security_lockdowns |

**Helper functions:** `_tfail2(name)`, `_texpect_error2(sqltext, name)`

### 8.3 Runner Script: `run_tests.cjs`

- **File:** `supabase/tests/run_tests.cjs` (48 lines)
- **Usage:** `node supabase/tests/run_tests.cjs [sqlFile]`
- **Default:** `rls_tests.sql` (Gate 1); can pass `rls_security_tests.sql` for Gate 2
- **Execution:** Connects to Postgres via `pg.Client` (hardcoded host `aws-1-eu-west-1.pooler.supabase.com`, reads password from `.env`); wraps SQL in `BEGIN` → `ROLLBACK` transaction; reports PASS/FAIL with timing
- **Note:** `run-rls-tests.mjs` and `run-rls-security-tests.mjs` do not exist as separate files; both test suites are executed via the single `run_tests.cjs` runner

---

## 9. Repository Pattern (repo.ts)

### 9.1 Architecture

- **Class:** `SupabaseStore implements Store`
- **Pool:** Injected via constructor, defaults to `getPool()`
- **Query helper:** `private async q<T>(sql, params)` — runs `pool.query`, converts snake_case keys to camelCase via `toCamel()`
- **Connection:** Uses `pg.Pool` with up to 5 connections
- **All queries are parameterized** — no string interpolation
- **All queries are scoped by `owner_id`** at the application layer (on top of RLS)

### 9.2 Store Interface Methods → SQL

| Method | Table(s) | Query Pattern |
|--------|---------|---------------|
| `getProjectBySlug(ownerId, slug)` | `projects` | SELECT with owner_id + slug + `status <> 'deleted'` |
| `getProject(ownerId, projectId)` | `projects` | SELECT with owner_id + id |
| `listProjects(ownerId)` | `projects` | SELECT with owner_id + `status <> 'deleted'` ORDER BY created_at ASC |
| `createProject(ownerId, data)` | `projects`, `project_passports` | INSERT projects, then ensure passport exists via getPassport/upsertPassport |
| `getPassport(ownerId, projectId)` | `project_passports` → `projects` | SELECT via JOIN on projects owner_id |
| `upsertPassport(ownerId, projectId, patch)` | `project_passports` | INSERT ... ON CONFLICT (project_id) DO UPDATE (16 cols) |
| `createTask(ownerId, data)` | `tasks` | INSERT with 15 columns |
| `getTask(ownerId, taskId)` | `tasks` | SELECT with owner_id + id |
| `listTasks(ownerId, filter?)` | `tasks` | SELECT with owner_id + optional project_id + status filter, ORDER BY created_at DESC |
| `patchTask(ownerId, taskId, patch)` | `tasks` | Dynamic UPDATE (status, output, error, attempts, started_at, completed_at, agent_id, environment_id) |
| `createTaskRun(ownerId, data)` | `task_runs` → `tasks` | INSERT via subquery verifying task ownership |
| `completeTaskRun(ownerId, runId, patch)` | `task_runs` → `tasks` | UPDATE via JOIN on tasks to verify ownership |
| `createApproval(ownerId, data)` | `approvals` | INSERT with 10 columns |
| `getApproval(ownerId, approvalId)` | `approvals` | SELECT with owner_id + id |
| `listApprovals(ownerId, filter?)` | `approvals` | SELECT with owner_id + optional project_id, task_id, status filter |
| `patchApproval(ownerId, approvalId, patch)` | `approvals` | Dynamic UPDATE (status, decision, decision_reason, decided_by, decided_at) |
| `recordAudit(event)` | `audit_events` | INSERT (11 columns) — no owner_id filter (append-only) |
| `recordCost(event)` | `cost_events` | INSERT (13 columns) |
| `totalCost(ownerId, projectId?)` | `cost_events` | SELECT SUM(amount) with optional project filter |
| `projectBudget(ownerId, projectId)` | `cost_events`, `personal_preferences` | SELECT with FILTER for month/day sums; reads budget from preferences |
| `getPreferences(ownerId)` | `personal_preferences` | SELECT ordered by version, builds nested JsonObject by category/key |
| `setPreference(ownerId, category, key, value)` | `personal_preferences` | Transaction: deactivate current active version → find max version + 1 → INSERT new version |
| `recordDecision(ownerId, d)` | `decision_journal` | INSERT (12 columns) |
| `listDecisions(ownerId)` | `decision_journal` | SELECT ORDER BY created_at DESC |
| `recordAutonomy(ownerId, record)` | `autonomy_records` | INSERT (12 columns) |
| `listModels(ownerId)` | `models` | SELECT ORDER BY cost, name |
| `listRuntimes(ownerId)` | `runtimes` | SELECT ORDER BY cost, name |
| `listAgents(ownerId)` | `agents` | SELECT (id, name, slug, role, status) ORDER BY name |
| `agentHasPermission(agentId, projectId, resourceType, permission)` | `agent_permissions` → `agents` | SELECT EXISTS with active checks |
| `agentStats(agentId)` | `tasks` | SELECT COUNT with FILTER for completed/failed |
| `dailyStatus(ownerId)` | — | Delegates to `Monitor` class |
| `recall(ownerId, query)` | — | Stub: returns `[]` |
| `saveLesson(ownerId, lesson)` | `memory_lessons` | INSERT (6 columns) |
| `listCriticalActions(ownerId)` | `critical_actions` | SELECT all (read-only registry) |
| `recordSecurityEvent(ownerId, event)` | `security_events` | INSERT (16 columns) |
| `listSecurityEvents(ownerId, filter?)` | `security_events` | SELECT with owner_id + optional event_type, severity, limit |
| `createIncident(ownerId, input)` | `security_incidents` | INSERT (7 columns) |
| `patchIncident(ownerId, incidentId, patch)` | `security_incidents` | SELECT existing → applyIncidentPatch → UPDATE |
| `listIncidents(ownerId, filter?)` | `security_incidents` | SELECT with owner_id + optional status, limit |
| `activeLockdown(ownerId)` | `security_lockdowns` | SELECT WHERE status = 'active' ORDER BY created_at DESC LIMIT 1 |
| `activateLockdown(ownerId, data)` | `security_lockdowns` | INSERT (6 columns) |
| `releaseLockdown(ownerId, lockdownId, data)` | `security_lockdowns` | SELECT → verify active → canReleaseLockdown check → UPDATE status |
| `rlsProbe(ownerId)` | `pg_catalog.pg_class`, `pg_trigger` | SELECT count/rls from pg_class; SELECT exists from pg_trigger for audit_events and security_events |

---

## 10. Connection Configuration (pool.ts, config.ts)

### 10.1 Pool Settings (`pool.ts`)

| Setting | Value |
|---------|-------|
| Library | `pg` (node-postgres) |
| Connection mode | Singleton pool (created once via `getPool()`) |
| Max connections | 5 |
| Connection timeout | 30000 ms (30s) |
| SSL | `{ rejectUnauthorized: false }` |
| Cleanup | `closePool()` exported for graceful shutdown |

### 10.2 Environment Variables (`config.ts`)

| Variable | Default | Required | Purpose |
|----------|---------|----------|---------|
| `FACTORY_SUPABASE_URL` | — | **Yes** | Supabase project URL |
| `FACTORY_SUPABASE_ANON_KEY` | — | **Yes** | Supabase anonymous key |
| `FACTORY_DB_PASSWORD` | — | **Yes** | Postgres password (pooler) |
| `FACTORY_DB_HOST` | `aws-1-eu-west-1.pooler.supabase.com` | No | Postgres host |
| `FACTORY_DB_PORT` | `5432` | No | Postgres port |
| `FACTORY_DB_USER` | `postgres.<ref>` (from URL) | No | Postgres role |
| `FACTORY_DB_NAME` | `postgres` | No | Database name |
| `FACTORY_OWNER_EMAIL` | `null` | No | Seed script: owner email |
| `FACTORY_OWNER_PASSWORD` | `null` | No | Seed script: owner password |
| `FACTORY_ENV_FILE` | `<cwd>/.env` | No | Override .env file path |

Config is loaded from `.env` file first, then `process.env` overrides. Assertions check that the three required variables are set.

---

## 11. Seed Data (seed.ts)

Script: `src/db/seed.ts` — run via `npm run seed`

### 11.1 Owner Auth User
- Creates `auth.users` row with bcrypt-hashed password (only if `FACTORY_OWNER_EMAIL` + `FACTORY_OWNER_PASSWORD` are set)
- The `on_auth_user_created` trigger auto-creates the `owners` row

### 11.2 Default Model Registry (6 models, cheapest first)

| Provider | Name | Slug | Reasoning | Context Window | Cost/1k Input | Cost/1k Output |
|----------|------|------|-----------|---------------|---------------|----------------|
| openai | gpt-4o-mini | gpt-4o-mini | low | 128,000 | $0.15 | $0.60 |
| openai | gpt-4o | gpt-4o | medium | 128,000 | $2.50 | $10.00 |
| anthropic | claude-3-5-haiku | claude-3-5-haiku | low | 200,000 | $0.80 | $4.00 |
| anthropic | claude-3-5-sonnet | claude-3-5-sonnet | high | 200,000 | $3.00 | $15.00 |
| google | gemini-1.5-flash | gemini-1.5-flash | low | 1,048,576 | $0.075 | $0.30 |
| google | gemini-1.5-pro | gemini-1.5-pro | high | 2,097,152 | $1.25 | $5.00 |

All seeded with `ON CONFLICT (owner_id, provider, name) DO UPDATE` (idempotent).

### 11.3 Default Runtime Registry (1 runtime)

| Name | Version | Slug | Capabilities | Cost/Hour |
|------|---------|------|-------------|-----------|
| opencode-zen | 0.1 | opencode-zen | `{ code: true, shell: true }` | $0.00 |

### 11.4 Default Project

| Name | Slug | Description | Status |
|------|------|-------------|--------|
| CHEF HQ | chef-hq | Factory control project | active |

Created with `ON CONFLICT (owner_id, slug) DO NOTHING` (idempotent). The `projects_ensure_environments` trigger auto-creates 3 environments.

---

## 12. Schema Gaps / Known Issues

### 12.1 Migration Tracking Gap
- **Issue:** Migrations are timestamped (`20260815…`, `20260816…`, `20260817…`, `20260818…`) rather than sequentially numbered (001, 002, etc.). This is standard Supabase convention but makes ordering harder to read at a glance.

### 12.2 Tables Without Truncation Protection
The 7 tables with TRUNCATE guards are: `security_events`, `critical_actions`, `security_lockdowns`, `security_incidents`, `security_rate_limits`, `security_policies`, `audit_events`.

**The following 15 tables have NO truncation protection** (no TRUNCATE trigger, no REVOKE of TRUNCATE/TRIGGER from anon/authenticated):

| # | Table | Risk Assessment |
|---|-------|----------------|
| 1 | `owners` | Low — DELETE cascade from auth.users is the real protection; RLS prevents anonymous access |
| 2 | `projects` | Low — RLS prevents access; cascade delete from owners |
| 3 | `project_environments` | Low — RLS; cascade from projects |
| 4 | `project_passports` | Low — RLS; cascade from projects |
| 5 | `agents` | Low — RLS; cascade from owners |
| 6 | `agent_permissions` | Low — RLS; cascade from agents |
| 7 | `tasks` | Low — RLS; cascade from owners |
| 8 | `models` | Low — RLS; cascade from owners |
| 9 | `runtimes` | Low — RLS; cascade from owners |
| 10 | `task_runs` | Low — RLS; cascade from tasks |
| 11 | `approvals` | Low — RLS; cascade from owners |
| 12 | `cost_events` | Low — RLS; cascade from owners |
| 13 | `personal_preferences` | Low — RLS; cascade from owners |
| 14 | `decision_journal` | Low — RLS; cascade from owners |
| 15 | `autonomy_records` | Low — RLS; cascade from owners |
| 16 | `memory_lessons` | Low — RLS; cascade from owners |

**Note:** `project_environments`, `project_passports`, `task_runs`, `approvals`, `cost_events`, `personal_preferences`, `decision_journal`, `autonomy_records`, and `memory_lessons` have no `updated_at` trigger either (only `project_environments`, `project_passports`, `approvals`, `personal_preferences` have them in the 12-table list; the rest lack it entirely).

### 12.3 Tables Without updated_at
These tables have no `updated_at` column and no `set_updated_at` trigger:
- `task_runs`
- `audit_events`
- `cost_events`
- `decision_journal`
- `autonomy_records`
- `memory_lessons`
- `security_events`
- `security_lockdowns`
- `security_policies`

### 12.4 RLS on `anon` Role
- All 23 tables have RLS enabled with policies targeting `authenticated`
- No policies exist for `anon` — the `anon` role is **fully blocked from all tables**
- No explicit REVOKE on SELECT/INSERT/UPDATE/DELETE for `anon` (RLS alone provides the block)

### 12.5 `recall()` is a Stub
- `SupabaseStore.recall()` returns `[]` — memory recall is not yet implemented in the repository layer

### 12.6 `security_policies` Has No INSERT/UPDATE/DELETE Policies or Triggers
- While it is a read-only registry, there is no DB-level enforcement preventing INSERTs (unlike `critical_actions` which at least blocks UPDATE/DELETE). An authenticated user with an INSERT policy on other tables could potentially INSERT into `security_policies` if RLS were misconfigured. In practice, RLS blocks this because there is no INSERT policy for `authenticated`.

### 12.7 No `ON DELETE` Behavior Documented for Security Tables
- `security_events` → `tasks(id)` uses `ON DELETE SET NULL`
- `security_events` → `agents(id)` uses `ON DELETE SET NULL`
- These are the only security-domain tables with cross-domain FKs that use SET NULL rather than CASCADE
