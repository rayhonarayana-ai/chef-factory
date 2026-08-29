-- CHEF FACTORY — Gate 45: Trusted Software Task Completion (verification contract + evidence)
--
-- Objects:
--   1. tasks.verification_required  boolean (NOT NULL, default false)
--      tasks.required_verifications jsonb   (NOT NULL, default '[]' — closed op set)
--      → the machine-readable verification contract, persisted through
--        MissionPlan → TaskRecord (not prompt-only). The closed operation set is
--        checked at the application layer (validateMissionPlan) and re-enforced here.
--   2. task_verifications — MINIMAL trusted acceptance evidence, OWNER-scoped.
--
-- Semantics / boundaries (frozen):
--   - owner-scoped, RLS-tenant-isolated; FK-cascade cleanup on owner delete.
--   - MINIMAL fields only (taskId, ownerId, projectId, runId, attempt, operation,
--     outcome, exitCode, durationMs, observedAt). NO stdout/stderr/raw output, NO
--     secrets, NO manifest/integrity claims (the runner returns manifestHash=null).
--   - WRITE is a SYSTEM-OBSERVED trust fact. Owner/agent (authenticated) clients may
--     READ only their own rows (observability). INSERT/UPDATE/DELETE are BLOCKED for
--     authenticated actors — writes go through the Factory Core (service-role pool)
--     from the trusted acceptance gate only.
--   - AGENT_CAN_WRITE_VERIFICATION_EVIDENCE = NO
--     MODEL_CAN_WRITE_VERIFICATION_EVIDENCE = NO
--   - This migration is NOT applied live (LIVE_DB_MUTATION = NONE); it ships for
--     review and applies under the standard migrate path.

-- 1. tasks contract columns (idempotent).
alter table public.tasks
  add column if not exists verification_required boolean not null default false;
alter table public.tasks
  add column if not exists required_verifications jsonb not null default '[]'::jsonb;
alter table public.tasks
  alter column required_verifications set default '[]'::jsonb;

-- 2. evidence table (idempotent).
create table if not exists public.task_verifications (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.owners(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete set null,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  run_id      uuid,
  attempt     int  not null check (attempt >= 1),
  operation   text not null check (operation in ('test','typecheck','build')),
  outcome     text not null check (outcome in (
                'passed','failed','timeout','output_limit_exceeded',
                'dependency_missing','tool_not_available','invalid_operation',
                'workspace_changed','internal_error','execution_denied'
              )),
  exit_code   int,
  duration_ms int,
  observed_at timestamptz not null default now()
);

-- 3. indexes (owner/task scoped reads).
create index if not exists task_verifications_owner_task_idx
  on public.task_verifications(owner_id, task_id, observed_at asc);

-- 4. RLS — system-write, owner-read. Blocked client mutations prevent forgery.
alter table public.task_verifications enable row level security;

drop policy if exists tv_select_owner on public.task_verifications;
create policy tv_select_owner on public.task_verifications
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists tv_no_insert on public.task_verifications;
create policy tv_no_insert on public.task_verifications
  for insert to authenticated with check (false);

drop policy if exists tv_no_update on public.task_verifications;
create policy tv_no_update on public.task_verifications
  for update to authenticated using (false) with check (false);

drop policy if exists tv_no_delete on public.task_verifications;
create policy tv_no_delete on public.task_verifications
  for delete to authenticated using (false);

-- 5. post-apply verification.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'verification_required'
  ) then
    raise exception 'tasks.verification_required missing after migration';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'required_verifications'
  ) then
    raise exception 'tasks.required_verifications missing after migration';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'task_verifications'
  ) then
    raise exception 'task_verifications table missing after migration';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'task_verifications'
  ) then
    raise exception 'task_verifications RLS policies missing after migration';
  end if;
  raise notice 'Gate 45 migration verified: tasks contract columns + task_verifications + RLS present';
end
$$;
