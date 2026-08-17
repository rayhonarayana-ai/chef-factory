-- ============================================================
-- CHEF FACTORY — GATE 1 — DATABASE FOUNDATION
-- Migration: 20260815220000_factory_init.sql
-- Target:   Independent Factory Supabase (CHEF FACTORY DB)
-- Contract: GATE_1_EXECUTION_CONTRACT_FINAL.md §5-6
-- Security: Strict RLS. Owner = Supabase Auth. Agents = least privilege.
-- Order:    (A) extensions+tables, (B) helper functions,
--           (C) triggers, (D) RLS policies.
-- ============================================================

-- ============================================================
-- A. EXTENSIONS + TABLES
-- ============================================================
create extension if not exists pgcrypto;

-- ---------- 1. owners ----------
create table public.owners (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  role         text not null default 'owner' check (role in ('owner','admin')),
  status       text not null default 'active' check (status in ('active','suspended','deleted')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint owners_email_uniq unique (email)
);
create index owners_status_idx on public.owners(status);

-- ---------- 2. projects ----------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.owners(id) on delete cascade,
  name        text not null,
  slug        text not null,
  description text,
  status      text not null default 'draft' check (status in ('draft','active','paused','archived','deleted')),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint projects_owner_slug_uniq unique (owner_id, slug)
);
create index projects_owner_id_idx on public.projects(owner_id);
create index projects_status_idx on public.projects(status);

-- ---------- 3. project_environments ----------
create table public.project_environments (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null check (name in ('development','staging','production')),
  is_protected boolean not null default false,
  status       text not null default 'active' check (status in ('active','disabled','archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint project_environments_project_name_uniq unique (project_id, name)
);
create index project_environments_project_id_idx on public.project_environments(project_id);

-- ---------- 4. project_passports ----------
create table public.project_passports (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null unique references public.projects(id) on delete cascade,
  identity               jsonb not null default '{}'::jsonb,
  description            text,
  technology             jsonb not null default '{}'::jsonb,
  repository             jsonb not null default '{}'::jsonb,
  database_ref           jsonb not null default '{}'::jsonb,
  environments           jsonb not null default '{}'::jsonb,
  deployment             jsonb not null default '{}'::jsonb,
  dependencies           jsonb not null default '{}'::jsonb,
  models                 jsonb not null default '{}'::jsonb,
  runtimes               jsonb not null default '{}'::jsonb,
  business_model         jsonb not null default '{}'::jsonb,
  status                 jsonb not null default '{}'::jsonb,
  risks                  jsonb not null default '{}'::jsonb,
  credentials_references jsonb not null default '{}'::jsonb,
  operational_health     jsonb not null default '{}'::jsonb,
  documentation_state    jsonb not null default '{}'::jsonb,
  updated_at             timestamptz not null default now()
);

-- ---------- 5. agents ----------
create table public.agents (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.owners(id) on delete cascade,
  name         text not null,
  slug         text not null,
  role         text not null,
  description  text,
  capabilities jsonb not null default '[]'::jsonb,
  status       text not null default 'active' check (status in ('active','paused','retired','suspended')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint agents_owner_slug_uniq unique (owner_id, slug)
);
create index agents_owner_id_idx on public.agents(owner_id);
create index agents_status_idx on public.agents(status);

-- ---------- 6. agent_permissions ----------
create table public.agent_permissions (
  id               uuid primary key default gen_random_uuid(),
  agent_id         uuid not null references public.agents(id) on delete cascade,
  project_id       uuid references public.projects(id) on delete cascade,
  environment_name text check (environment_name in ('development','staging','production')),
  resource_type    text not null,
  permission       text not null check (permission in ('read','write','execute','approve','admin')),
  status           text not null default 'active' check (status in ('active','revoked')),
  granted_by       uuid references public.owners(id),
  created_at       timestamptz not null default now(),
  constraint agent_permissions_scope_uniq
    unique (agent_id, project_id, environment_name, resource_type, permission)
);
create index agent_permissions_agent_id_idx on public.agent_permissions(agent_id);
create index agent_permissions_project_id_idx on public.agent_permissions(project_id);
create index agent_permissions_resource_idx on public.agent_permissions(resource_type);

-- ---------- 7. tasks ----------
create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.owners(id) on delete cascade,
  project_id        uuid not null references public.projects(id) on delete cascade,
  environment_id    uuid references public.project_environments(id),
  parent_task_id    uuid references public.tasks(id),
  agent_id          uuid references public.agents(id),
  title             text not null,
  description       text,
  status            text not null default 'created'
                    check (status in ('created','queued','running','completed','failed','cancelled','paused','needs_approval')),
  priority          text not null default 'medium' check (priority in ('low','medium','high','critical')),
  risk_level        text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  authority_level   text check (authority_level in ('auto','notify','require_approval','deny')),
  autonomy          text check (autonomy in ('auto','notify','require_approval','deny')),
  approval_required boolean not null default false,
  inputs            jsonb not null default '{}'::jsonb,
  output            jsonb,
  error             jsonb,
  attempts          integer not null default 0 check (attempts >= 0),
  max_attempts      integer not null default 3 check (max_attempts >= 1),
  correlation_id    uuid,
  created_by        uuid references public.owners(id),
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  completed_at      timestamptz,
  updated_at        timestamptz not null default now()
);
create index tasks_project_id_idx on public.tasks(project_id);
create index tasks_agent_id_idx on public.tasks(agent_id);
create index tasks_status_idx on public.tasks(status);
create index tasks_parent_task_id_idx on public.tasks(parent_task_id);
create index tasks_correlation_id_idx on public.tasks(correlation_id);

-- ---------- 8. models ----------
create table public.models (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.owners(id) on delete cascade,
  provider           text not null,
  name               text not null,
  slug               text not null,
  capability         jsonb not null default '{}'::jsonb,
  context_window     integer check (context_window > 0),
  cost_per_1k_input  numeric(12,6) not null default 0 check (cost_per_1k_input >= 0),
  cost_per_1k_output numeric(12,6) not null default 0 check (cost_per_1k_output >= 0),
  status             text not null default 'active' check (status in ('active','limited','retired')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint models_owner_provider_name_uniq unique (owner_id, provider, name)
);
create index models_owner_id_idx on public.models(owner_id);
create index models_status_idx on public.models(status);

-- ---------- 9. runtimes ----------
create table public.runtimes (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.owners(id) on delete cascade,
  name          text not null,
  version       text,
  slug          text not null,
  capability    jsonb not null default '{}'::jsonb,
  cost_per_hour numeric(12,6) not null default 0 check (cost_per_hour >= 0),
  status        text not null default 'active' check (status in ('active','limited','retired')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint runtimes_owner_name_version_uniq unique (owner_id, name, version)
);
create index runtimes_owner_id_idx on public.runtimes(owner_id);
create index runtimes_status_idx on public.runtimes(status);

-- ---------- 10. task_runs ----------
create table public.task_runs (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks(id) on delete cascade,
  run_number      integer not null check (run_number >= 1),
  status          text not null default 'running' check (status in ('running','completed','failed','cancelled','timeout')),
  model_id        uuid references public.models(id),
  runtime_id      uuid references public.runtimes(id),
  input_snapshot  jsonb,
  output_snapshot jsonb,
  error           jsonb,
  duration_ms     integer check (duration_ms >= 0),
  cost            numeric(12,6) not null default 0 check (cost >= 0),
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  constraint task_runs_task_run_uniq unique (task_id, run_number)
);
create index task_runs_task_id_idx on public.task_runs(task_id);
create index task_runs_model_id_idx on public.task_runs(model_id);
create index task_runs_runtime_id_idx on public.task_runs(runtime_id);
create index task_runs_status_idx on public.task_runs(status);

-- ---------- 11. approvals ----------
create table public.approvals (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.owners(id) on delete cascade,
  project_id       uuid references public.projects(id) on delete set null,
  task_id          uuid references public.tasks(id) on delete set null,
  agent_id         uuid references public.agents(id),
  action           text not null,
  description      text,
  risk_level       text check (risk_level in ('low','medium','high','critical')),
  authority_level  text check (authority_level in ('auto','notify','require_approval','deny')),
  status           text not null default 'pending'
                   check (status in ('pending','approved','rejected','denied','expired','cancelled')),
  decision         text,
  decision_reason  text,
  requested_by     uuid references public.owners(id),
  decided_by       uuid references public.owners(id),
  expires_at       timestamptz,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index approvals_owner_id_idx on public.approvals(owner_id);
create index approvals_project_id_idx on public.approvals(project_id);
create index approvals_task_id_idx on public.approvals(task_id);
create index approvals_status_idx on public.approvals(status);
create unique index approvals_one_pending_idx
  on public.approvals(task_id, action)
  where status = 'pending';

-- ---------- 12. audit_events (append-only) ----------
create table public.audit_events (
  id                   bigint generated always as identity primary key,
  actor_type           text not null check (actor_type in ('owner','agent','system')),
  actor_id             uuid,
  action               text not null,
  project_id           uuid references public.projects(id) on delete set null,
  environment_id       uuid references public.project_environments(id) on delete set null,
  resource_type        text,
  resource_id          text,
  authorization_result text check (authorization_result in ('auto','notify','require_approval','deny')),
  correlation_id       uuid,
  task_id              uuid references public.tasks(id) on delete set null,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);
create index audit_events_project_id_idx on public.audit_events(project_id);
create index audit_events_actor_idx on public.audit_events(actor_type, actor_id);
create index audit_events_created_at_idx on public.audit_events(created_at);
create index audit_events_correlation_id_idx on public.audit_events(correlation_id);
create index audit_events_task_id_idx on public.audit_events(task_id);

-- ---------- 13. cost_events ----------
create table public.cost_events (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.owners(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete set null,
  task_id     uuid references public.tasks(id) on delete set null,
  run_id      uuid references public.task_runs(id) on delete set null,
  agent_id    uuid references public.agents(id),
  cost_type   text not null check (cost_type in ('model','runtime','tool','mission','project')),
  amount      numeric(12,6) not null check (amount >= 0),
  currency    text not null default 'USD',
  provider    text,
  model_id    uuid references public.models(id),
  runtime_id  uuid references public.runtimes(id),
  billed_to   text not null default 'project' check (billed_to in ('project','mission','owner')),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index cost_events_owner_id_idx on public.cost_events(owner_id);
create index cost_events_project_id_idx on public.cost_events(project_id);
create index cost_events_cost_type_idx on public.cost_events(cost_type);
create index cost_events_created_at_idx on public.cost_events(created_at);

-- ---------- 14. personal_preferences (versioned) ----------
create table public.personal_preferences (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.owners(id) on delete cascade,
  category   text not null,
  key        text not null,
  value      jsonb not null,
  version    integer not null check (version >= 1),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_preferences_version_uniq unique (owner_id, category, key, version)
);
create index personal_preferences_owner_id_idx on public.personal_preferences(owner_id);
create unique index personal_preferences_active_uniq
  on public.personal_preferences(owner_id, category, key)
  where is_active;

-- ---------- 15. decision_journal ----------
create table public.decision_journal (
  decision_id     uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.owners(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  context         text not null,
  options         jsonb not null default '[]'::jsonb,
  selected_option text,
  reason          text,
  evidence        jsonb not null default '[]'::jsonb,
  confidence      numeric(3,2) check (confidence between 0 and 1),
  risk_level      text check (risk_level in ('low','medium','high','critical')),
  authority_level text check (authority_level in ('auto','notify','require_approval','deny')),
  approved_by     uuid references public.owners(id),
  outcome         text,
  created_at      timestamptz not null default now()
);
create index decision_journal_owner_id_idx on public.decision_journal(owner_id);
create index decision_journal_project_id_idx on public.decision_journal(project_id);
create index decision_journal_created_at_idx on public.decision_journal(created_at);

-- ---------- 16. autonomy_records ----------
create table public.autonomy_records (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.owners(id) on delete cascade,
  agent_id          uuid not null references public.agents(id),
  project_id        uuid references public.projects(id) on delete set null,
  environment_id    uuid references public.project_environments(id) on delete set null,
  action            text not null,
  risk_level        text check (risk_level in ('low','medium','high','critical')),
  selected_autonomy text check (selected_autonomy in ('auto','notify','require_approval','deny')),
  policy_inputs     jsonb not null default '{}'::jsonb,
  evidence          jsonb not null default '{}'::jsonb,
  decision          text,
  approval_status   text check (approval_status in ('pending','approved','rejected','denied','not_required')),
  outcome           text,
  created_at        timestamptz not null default now()
);
create index autonomy_records_owner_id_idx on public.autonomy_records(owner_id);
create index autonomy_records_agent_id_idx on public.autonomy_records(agent_id);
create index autonomy_records_project_id_idx on public.autonomy_records(project_id);
create index autonomy_records_created_at_idx on public.autonomy_records(created_at);

-- ============================================================
-- B. HELPER FUNCTIONS
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.owners (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.ensure_project_environments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_environments (project_id, name, is_protected) values
    (new.id, 'development', false),
    (new.id, 'staging',     false),
    (new.id, 'production',  true);
  return new;
end;
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.owners
    where id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.requesting_agent()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.agent_id', true), '')::uuid;
$$;

create or replace function public.agent_has_permission(
  p_project uuid,
  p_resource text,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.agent_permissions ap
    join public.agents a on a.id = ap.agent_id
    where a.id = public.requesting_agent()
      and a.status = 'active'
      and ap.status = 'active'
      and (ap.project_id = p_project or (ap.project_id is null and p_project is not null))
      and ap.resource_type = p_resource
      and ap.permission = p_permission
  );
$$;

-- ============================================================
-- C. TRIGGERS
-- ============================================================
create trigger owners_set_updated_at
  before update on public.owners
  for each row execute function public.set_updated_at();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create trigger projects_ensure_environments
  after insert on public.projects
  for each row execute function public.ensure_project_environments();

create trigger project_environments_set_updated_at
  before update on public.project_environments
  for each row execute function public.set_updated_at();

create trigger project_passports_set_updated_at
  before update on public.project_passports
  for each row execute function public.set_updated_at();

create trigger agents_set_updated_at
  before update on public.agents
  for each row execute function public.set_updated_at();

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create trigger models_set_updated_at
  before update on public.models
  for each row execute function public.set_updated_at();

create trigger runtimes_set_updated_at
  before update on public.runtimes
  for each row execute function public.set_updated_at();

create trigger approvals_set_updated_at
  before update on public.approvals
  for each row execute function public.set_updated_at();

create trigger personal_preferences_set_updated_at
  before update on public.personal_preferences
  for each row execute function public.set_updated_at();

-- append-only enforcement
create or replace function public.block_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;

create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function public.block_audit_mutation();

create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function public.block_audit_mutation();

-- ============================================================
-- D. RLS
-- ============================================================

-- ---------- owners ----------
alter table public.owners enable row level security;
create policy owners_select_self on public.owners for select to authenticated
  using (auth.uid() = id);
create policy owners_insert_self on public.owners for insert to authenticated
  with check (auth.uid() = id);
create policy owners_update_self on public.owners for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- ---------- projects ----------
alter table public.projects enable row level security;
create policy projects_select_owner on public.projects for select to authenticated
  using (owner_id = auth.uid() or (public.requesting_agent() is not null and public.agent_has_permission(id, 'projects', 'read')));
create policy projects_insert_owner on public.projects for insert to authenticated
  with check (owner_id = auth.uid());
create policy projects_update_owner on public.projects for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy projects_delete_owner on public.projects for delete to authenticated
  using (owner_id = auth.uid());

-- ---------- project_environments ----------
alter table public.project_environments enable row level security;
create policy envs_select_owner on public.project_environments for select to authenticated
  using (project_id in (select id from public.projects where owner_id = auth.uid())
         or (public.requesting_agent() is not null and public.agent_has_permission(project_id, 'project_environments', 'read')));
create policy envs_insert_owner on public.project_environments for insert to authenticated
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));
create policy envs_update_owner on public.project_environments for update to authenticated
  using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));
create policy envs_delete_owner on public.project_environments for delete to authenticated
  using (project_id in (select id from public.projects where owner_id = auth.uid()));

-- ---------- project_passports ----------
alter table public.project_passports enable row level security;
create policy passports_select_owner on public.project_passports for select to authenticated
  using (project_id in (select id from public.projects where owner_id = auth.uid())
         or (public.requesting_agent() is not null and public.agent_has_permission(project_id, 'project_passports', 'read')));
create policy passports_insert_owner on public.project_passports for insert to authenticated
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));
create policy passports_update_owner on public.project_passports for update to authenticated
  using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));
create policy passports_delete_owner on public.project_passports for delete to authenticated
  using (project_id in (select id from public.projects where owner_id = auth.uid()));

-- ---------- agents ----------
alter table public.agents enable row level security;
create policy agents_select_owner on public.agents for select to authenticated
  using (owner_id = auth.uid());
create policy agents_insert_owner on public.agents for insert to authenticated
  with check (owner_id = auth.uid());
create policy agents_update_owner on public.agents for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy agents_delete_owner on public.agents for delete to authenticated
  using (owner_id = auth.uid());

-- ---------- agent_permissions ----------
alter table public.agent_permissions enable row level security;
create policy permissions_select_owner on public.agent_permissions for select to authenticated
  using (agent_id in (select id from public.agents where owner_id = auth.uid()));
create policy permissions_insert_owner on public.agent_permissions for insert to authenticated
  with check (agent_id in (select id from public.agents where owner_id = auth.uid()));
create policy permissions_update_owner on public.agent_permissions for update to authenticated
  using (agent_id in (select id from public.agents where owner_id = auth.uid()))
  with check (agent_id in (select id from public.agents where owner_id = auth.uid()));
create policy permissions_delete_owner on public.agent_permissions for delete to authenticated
  using (agent_id in (select id from public.agents where owner_id = auth.uid()));

-- ---------- tasks ----------
alter table public.tasks enable row level security;
create policy tasks_select_owner on public.tasks for select to authenticated
  using (owner_id = auth.uid()
         or (public.requesting_agent() is not null and public.agent_has_permission(project_id, 'tasks', 'read')));
create policy tasks_insert_owner on public.tasks for insert to authenticated
  with check (owner_id = auth.uid()
         or (public.requesting_agent() is not null and public.agent_has_permission(project_id, 'tasks', 'write')));
create policy tasks_update_owner on public.tasks for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy tasks_delete_owner on public.tasks for delete to authenticated
  using (owner_id = auth.uid());

-- ---------- task_runs ----------
alter table public.task_runs enable row level security;
create policy task_runs_select_owner on public.task_runs for select to authenticated
  using (task_id in (select id from public.tasks where owner_id = auth.uid())
         or (public.requesting_agent() is not null
             and task_id in (select id from public.tasks t where public.agent_has_permission(t.project_id, 'tasks', 'read'))));
create policy task_runs_insert_owner on public.task_runs for insert to authenticated
  with check (task_id in (select id from public.tasks where owner_id = auth.uid())
         or (public.requesting_agent() is not null
             and task_id in (select id from public.tasks t where public.agent_has_permission(t.project_id, 'tasks', 'write'))));
create policy task_runs_update_owner on public.task_runs for update to authenticated
  using (task_id in (select id from public.tasks where owner_id = auth.uid()))
  with check (task_id in (select id from public.tasks where owner_id = auth.uid()));
create policy task_runs_delete_owner on public.task_runs for delete to authenticated
  using (task_id in (select id from public.tasks where owner_id = auth.uid()));

-- ---------- models ----------
alter table public.models enable row level security;
create policy models_select_owner on public.models for select to authenticated
  using (owner_id = auth.uid());
create policy models_insert_owner on public.models for insert to authenticated
  with check (owner_id = auth.uid());
create policy models_update_owner on public.models for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy models_delete_owner on public.models for delete to authenticated
  using (owner_id = auth.uid());

-- ---------- runtimes ----------
alter table public.runtimes enable row level security;
create policy runtimes_select_owner on public.runtimes for select to authenticated
  using (owner_id = auth.uid());
create policy runtimes_insert_owner on public.runtimes for insert to authenticated
  with check (owner_id = auth.uid());
create policy runtimes_update_owner on public.runtimes for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy runtimes_delete_owner on public.runtimes for delete to authenticated
  using (owner_id = auth.uid());

-- ---------- approvals ----------
alter table public.approvals enable row level security;
create policy approvals_select_owner on public.approvals for select to authenticated
  using (owner_id = auth.uid()
         or (public.requesting_agent() is not null and public.agent_has_permission(project_id, 'approvals', 'read')));
create policy approvals_insert_owner on public.approvals for insert to authenticated
  with check (owner_id = auth.uid()
         or (public.requesting_agent() is not null and public.agent_has_permission(project_id, 'approvals', 'write')));
create policy approvals_update_owner on public.approvals for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy approvals_delete_owner on public.approvals for delete to authenticated
  using (owner_id = auth.uid());

-- ---------- audit_events (append-only) ----------
alter table public.audit_events enable row level security;
create policy audit_insert_allowed on public.audit_events for insert to authenticated
  with check (
    public.is_owner()
    or (public.requesting_agent() is not null and public.agent_has_permission(project_id, 'audit_events', 'write'))
  );
create policy audit_select_allowed on public.audit_events for select to authenticated
  using (
    public.is_owner()
    or (public.requesting_agent() is not null and public.agent_has_permission(project_id, 'audit_events', 'read'))
  );

-- ---------- cost_events ----------
alter table public.cost_events enable row level security;
create policy cost_select_owner on public.cost_events for select to authenticated
  using (owner_id = auth.uid());
create policy cost_insert_owner on public.cost_events for insert to authenticated
  with check (owner_id = auth.uid()
         or (public.requesting_agent() is not null and public.agent_has_permission(project_id, 'cost_events', 'write')));
create policy cost_update_owner on public.cost_events for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy cost_delete_owner on public.cost_events for delete to authenticated
  using (owner_id = auth.uid());

-- ---------- personal_preferences ----------
alter table public.personal_preferences enable row level security;
create policy prefs_select_owner on public.personal_preferences for select to authenticated
  using (owner_id = auth.uid());
create policy prefs_insert_owner on public.personal_preferences for insert to authenticated
  with check (owner_id = auth.uid());
create policy prefs_update_owner on public.personal_preferences for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy prefs_delete_owner on public.personal_preferences for delete to authenticated
  using (owner_id = auth.uid());

-- ---------- decision_journal ----------
alter table public.decision_journal enable row level security;
create policy decisions_select_owner on public.decision_journal for select to authenticated
  using (owner_id = auth.uid());
create policy decisions_insert_owner on public.decision_journal for insert to authenticated
  with check (owner_id = auth.uid());
create policy decisions_update_owner on public.decision_journal for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy decisions_delete_owner on public.decision_journal for delete to authenticated
  using (owner_id = auth.uid());

-- ---------- autonomy_records ----------
alter table public.autonomy_records enable row level security;
create policy autonomy_select_owner on public.autonomy_records for select to authenticated
  using (owner_id = auth.uid());
create policy autonomy_insert_owner on public.autonomy_records for insert to authenticated
  with check (owner_id = auth.uid());
create policy autonomy_update_owner on public.autonomy_records for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy autonomy_delete_owner on public.autonomy_records for delete to authenticated
  using (owner_id = auth.uid());

-- ============================================================
-- END OF MIGRATION 20260815220000_factory_init.sql
-- ============================================================
