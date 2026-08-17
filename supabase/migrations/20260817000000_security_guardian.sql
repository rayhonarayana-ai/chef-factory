-- ============================================================
-- CHEF FACTORY — GATE 2 — SECURITY GUARDIAN
-- Migration: 20260817000000_security_guardian.sql
-- Adds: critical_actions (immutable core registry), security_events
--       (append-only), security_incidents, security_lockdowns,
--       security_rate_limits, security_policies (documentation registry).
-- Security: Strict RLS. Append-only triggers. Core critical actions are
--           immutable even for superuser-configured sessions.
-- ============================================================

-- ============================================================
-- A. TABLES
-- ============================================================

-- ---------- 1. critical_actions (global immutable registry) ----------
create table public.critical_actions (
  action            text primary key,
  classification    text not null check (classification in ('production','destructive','secret','permission','policy','audit','identity','authority','financial','contractual','external_irreversible','factory')),
  default_decision  text not null check (default_decision in ('deny','require_approval')),
  environments      text not null default 'all',
  description       text not null,
  is_core           boolean not null default true,
  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

insert into public.critical_actions (action, classification, default_decision, environments, description, is_core) values
  ('production_modification',  'production',            'require_approval', 'all',          'Any modification of production configuration or resources.', true),
  ('production_deletion',      'production',            'deny',             'production',   'Deletion of production resources — deny by default.', true),
  ('database_destructive',     'destructive',           'deny',             'all',          'Destructive database operations (DROP/TRUNCATE/ALTER destroying data).', true),
  ('secret_access',            'secret',                'require_approval', 'all',          'Access to stored secrets/credentials.', true),
  ('secret_rotation',          'secret',                'require_approval', 'all',          'Rotation of secrets/credentials.', true),
  ('permission_escalation',    'permission',            'deny',             'all',          'Granting or escalating permissions.', true),
  ('security_policy_modification', 'policy',            'require_approval', 'all',          'Changing security policy rules.', true),
  ('disable_audit',            'audit',                 'deny',             'all',          'Disabling or weakening audit recording.', true),
  ('disable_rls',              'audit',                 'deny',             'all',          'Disabling row-level security.', true),
  ('owner_identity_change',    'identity',              'require_approval', 'all',          'Changing owner identity or authentication.', true),
  ('authority_rule_change',    'authority',             'require_approval', 'all',          'Changing authority matrix rules.', true),
  ('autonomy_rule_change',     'authority',             'require_approval', 'all',          'Changing autonomy/escalation rules.', true),
  ('financial_transaction',    'financial',             'deny',             'all',          'Any financial transfer or money movement.', true),
  ('legal_commitment',         'contractual',           'deny',             'all',          'External contractual or legally binding commitments.', true),
  ('external_irreversible',    'external_irreversible', 'require_approval', 'all',          'Irreversible actions on external systems.', true),
  ('factory_shutdown',         'factory',               'deny',             'all',          'Shutting down the Factory.', true),
  ('lockdown_release',         'factory',               'deny',             'all',          'Releasing an emergency lockdown — owner-only, explicit, audited.', true);

create or replace function public.block_critical_action_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'critical_actions registry is immutable: core rows can never be modified';
  end if;
  raise exception 'critical_actions registry is immutable';
end;
$$;

create trigger critical_actions_no_update
  before update on public.critical_actions
  for each row execute function public.block_critical_action_mutation();

create trigger critical_actions_no_delete
  before delete on public.critical_actions
  for each row execute function public.block_critical_action_mutation();

create trigger critical_actions_set_updated_at
  before update on public.critical_actions
  for each row execute function public.set_updated_at();

-- ---------- 2. security_events (append-only, owner-scoped) ----------
create table public.security_events (
  security_event_id   uuid primary key,
  owner_id            uuid not null references public.owners(id) on delete cascade,
  project_id          uuid references public.projects(id) on delete set null,
  agent_id            uuid references public.agents(id) on delete set null,
  task_id             uuid references public.tasks(id) on delete set null,
  correlation_id      uuid,
  environment         text not null default 'development' check (environment in ('development','staging','production')),
  event_type          text not null,
  severity            text not null check (severity in ('info','low','medium','high','critical')),
  action              text not null,
  resource            text,
  decision            text check (decision in ('allow','notify','require_approval','deny','lockdown')),
  reason              text not null,
  evidence_references jsonb not null default '[]'::jsonb,
  metadata            jsonb not null default '{}'::jsonb,
  occurred_at         timestamptz not null default now(),
  recorded_at         timestamptz not null default now()
);
create index security_events_owner_id_idx on public.security_events(owner_id);
create index security_events_project_id_idx on public.security_events(project_id);
create index security_events_type_idx on public.security_events(event_type);
create index security_events_severity_idx on public.security_events(severity);
create index security_events_occurred_at_idx on public.security_events(occurred_at);
create index security_events_correlation_id_idx on public.security_events(correlation_id);

create or replace function public.block_security_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'security_events is append-only';
end;
$$;

create trigger security_events_no_update
  before update on public.security_events
  for each row execute function public.block_security_event_mutation();

create trigger security_events_no_delete
  before delete on public.security_events
  for each row execute function public.block_security_event_mutation();

-- ---------- 3. security_incidents (foundational workflow) ----------
create table public.security_incidents (
  incident_id uuid primary key,
  owner_id    uuid not null references public.owners(id) on delete cascade,
  title       text not null,
  status      text not null default 'detected'
              check (status in ('detected','investigating','contained','resolved','closed')),
  description text,
  event_ids   jsonb not null default '[]'::jsonb,
  opened_by   uuid references public.owners(id),
  closed_by   uuid references public.owners(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index security_incidents_owner_id_idx on public.security_incidents(owner_id);
create index security_incidents_status_idx on public.security_incidents(status);
create index security_incidents_created_at_idx on public.security_incidents(created_at);

create trigger security_incidents_set_updated_at
  before update on public.security_incidents
  for each row execute function public.set_updated_at();

-- ---------- 4. security_lockdowns (append-only history, owner-release) ----------
create table public.security_lockdowns (
  lockdown_id uuid primary key,
  owner_id    uuid not null references public.owners(id) on delete cascade,
  scope       text not null default 'all',
  reason      text not null,
  status      text not null default 'active' check (status in ('active','released')),
  activated_by uuid not null references public.owners(id),
  released_by uuid references public.owners(id),
  released_at timestamptz,
  created_at  timestamptz not null default now()
);
create index security_lockdowns_owner_id_idx on public.security_lockdowns(owner_id);
create index security_lockdowns_status_idx on public.security_lockdowns(status);

-- Lockdowns are history: owners may transition status (release) but never delete.
create or replace function public.block_lockdown_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'security_lockdowns is history; rows cannot be deleted';
end;
$$;

create trigger security_lockdowns_no_delete
  before delete on public.security_lockdowns
  for each row execute function public.block_lockdown_deletion();

-- ---------- 5. security_rate_limits (documented defaults, owner-overridable) ----------
create table public.security_rate_limits (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.owners(id) on delete cascade,
  scope         text not null check (scope in ('task','tool','runtime','model','auth','approval','failure')),
  limit_key     text not null,
  max_count     integer not null check (max_count >= 1),
  window_seconds integer not null check (window_seconds >= 1),
  enabled       boolean not null default true,
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint security_rate_limits_scope_key_uniq unique (owner_id, scope, limit_key, version)
);
create index security_rate_limits_owner_id_idx on public.security_rate_limits(owner_id);

-- ---------- 6. security_policies (deterministic rule documentation registry) ----------
create table public.security_policies (
  policy_id      uuid primary key default gen_random_uuid(),
  rule_id        text not null,
  version        integer not null default 1,
  precedence     integer not null,
  decision       text not null check (decision in ('allow','notify','require_approval','deny','lockdown')),
  description    text not null,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint security_policies_rule_version_uniq unique (rule_id, version)
);

insert into public.security_policies (rule_id, version, precedence, decision, description) values
  ('rule.lockdown_active',           1, 100, 'lockdown',          'Emergency lockdown active — fail closed, top precedence.'),
  ('rule.critical.deny',             1,  90, 'deny',              'Critical Action Registry says deny — deny.'),
  ('rule.environment_escalation',    1,  80, 'deny',              'Environment escalation beyond granted scope — deny.'),
  ('rule.cross_project',             1,  80, 'deny',              'Cross-project access outside scope — deny.'),
  ('rule.rate_limit',                1,  80, 'deny',              'Rate limit exhausted — deny.'),
  ('rule.cost_stopped',              1,  80, 'deny',              'Cost hard limit reached — stop.'),
  ('rule.critical.require_approval', 1,  60, 'require_approval',  'Critical action requires owner approval.'),
  ('rule.production.write_execute',  1,  50, 'require_approval',  'Production write/execute always requires approval.'),
  ('rule.staging.notify',            1,  40, 'notify',            'Staging actions require notification.'),
  ('rule.not_authorized',            1,  30, 'deny',              'Actor not authorized for the action — deny.'),
  ('rule.explicit_deny',             1,  30, 'deny',              'Explicit deny from POS policy — deny.'),
  ('rule.default.allow',             1,  10, 'allow',             'Default allow for permitted, low-risk, in-scope actions.'),
  ('rule.untrusted_directive',       1,  50, 'notify',            'Untrusted content contains authority-override directives — never honored; notify.');

-- ============================================================
-- B. RLS
-- ============================================================

-- ---------- critical_actions (read-only registry) ----------
alter table public.critical_actions enable row level security;
create policy critical_actions_select_all on public.critical_actions for select to authenticated
  using (true);

-- ---------- security_events ----------
alter table public.security_events enable row level security;
create policy security_events_select_owner on public.security_events for select to authenticated
  using (owner_id = auth.uid());
create policy security_events_insert_owner on public.security_events for insert to authenticated
  with check (owner_id = auth.uid());
-- no update/delete policies (append-only) + DB trigger blocks them regardless.

-- ---------- security_incidents ----------
alter table public.security_incidents enable row level security;
create policy security_incidents_select_owner on public.security_incidents for select to authenticated
  using (owner_id = auth.uid());
create policy security_incidents_insert_owner on public.security_incidents for insert to authenticated
  with check (owner_id = auth.uid());
create policy security_incidents_update_owner on public.security_incidents for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy security_incidents_delete_owner on public.security_incidents for delete to authenticated
  using (owner_id = auth.uid());

-- ---------- security_lockdowns ----------
alter table public.security_lockdowns enable row level security;
create policy security_lockdowns_select_owner on public.security_lockdowns for select to authenticated
  using (owner_id = auth.uid());
create policy security_lockdowns_insert_owner on public.security_lockdowns for insert to authenticated
  with check (owner_id = auth.uid());
create policy security_lockdowns_update_owner on public.security_lockdowns for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- no delete policy (history) + DB trigger blocks deletion.

-- ---------- security_rate_limits ----------
alter table public.security_rate_limits enable row level security;
create policy security_rate_limits_select_owner on public.security_rate_limits for select to authenticated
  using (owner_id = auth.uid());
create policy security_rate_limits_insert_owner on public.security_rate_limits for insert to authenticated
  with check (owner_id = auth.uid());
create policy security_rate_limits_update_owner on public.security_rate_limits for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy security_rate_limits_delete_owner on public.security_rate_limits for delete to authenticated
  using (owner_id = auth.uid());

-- ---------- security_policies (read-only registry) ----------
alter table public.security_policies enable row level security;
create policy security_policies_select_all on public.security_policies for select to authenticated
  using (true);

-- ============================================================
-- END OF MIGRATION 20260817000000_security_guardian.sql
-- ============================================================
