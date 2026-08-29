-- CHEF FACTORY — Gate 43: Durable Model/Provider Health & Adaptive Routing Telemetry
--
-- Object: model_health_observations — bounded, provider-neutral, SYSTEM-OBSERVED
-- execution facts that feed a shared durable health snapshot for the Gate 42 router.
--
-- Semantics:
--   - Owner-scoped (owner_id FK cascade). Tenant isolation at the DB + RLS layer.
--   - "ONE observation" == ONE completed logical model call at the trusted execution
--     boundary (a single adapter.complete() invocation). Transport retries within one
--     logical call collapse into ONE terminal observation (see WHAT_COUNTS_AS_ONE_OBSERVATION).
--   - Provider-neutral: no provider/model name in the schema, no secrets, no prompts,
--     no raw provider payloads.
--   - Bounded: no unbounded raw telemetry lake; the application prunes to a small
--     multiple of the RECENT_WINDOW per key; the schema enforces check constraints.
--   - provider-wide circuit state remains in the live resilient breaker (Gate 10),
--     TRUTHFULLY provider-scoped; NOT faked per-model here.
--
-- Authorization boundary (RLS + application):
--   * telemetry WRITE is a SYSTEM-OBSERVED fact. Owner/agent (authenticated) clients
--     may READ only their own rows (observability). INSERT/UPDATE/DELETE are BLOCKED
--     for authenticated actors — writes go through the Factory Core (service-role pool)
--     from the trusted execution collector only.
--   * AGENT_CAN_WRITE_HEALTH_TELEMETRY = NO
--     MODEL_CAN_WRITE_HEALTH_TELEMETRY = NO
--     ROUTER_CAN_WRITE_HEALTH_TELEMETRY = NO
--     normal application actors cannot arbitrarily forge health observations.

-- 1. table (idempotent).
create table if not exists public.model_health_observations (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.owners(id) on delete cascade,
  provider       text not null,
  model_id       text not null,
  outcome        text not null check (outcome in ('success','failure','timeout')),
  latency_ms     int  not null check (latency_ms >= 0),
  usage_observed boolean not null default false,
  fallback_index int  not null default 0 check (fallback_index >= 0),
  observed_at    timestamptz not null default now()
);

-- 2. indexes for routing lookup + pruning (routing reads owner's keys; pruning
--    partitions by owner,provider,model).
create index if not exists model_health_owner_provider_model_idx
  on public.model_health_observations(owner_id, provider, model_id, observed_at desc);
create index if not exists model_health_observed_at_idx
  on public.model_health_observations(observed_at);

-- 3. RLS — system-write, owner-read. Blocked client mutations prevent forgery.
alter table public.model_health_observations enable row level security;

drop policy if exists mho_select_owner on public.model_health_observations;
create policy mho_select_owner on public.model_health_observations
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists mho_no_insert on public.model_health_observations;
create policy mho_no_insert on public.model_health_observations
  for insert to authenticated with check (false);

drop policy if exists mho_no_update on public.model_health_observations;
create policy mho_no_update on public.model_health_observations
  for update to authenticated using (false) with check (false);

drop policy if exists mho_no_delete on public.model_health_observations;
create policy mho_no_delete on public.model_health_observations
  for delete to authenticated using (false);

-- 4. post-apply verification.
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'model_health_observations'
  ) then
    raise exception 'model_health_observations table missing after migration';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'model_health_owner_provider_model_idx') then
    raise exception 'routing index missing after migration';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'model_health_observations'
  ) then
    raise exception 'model_health_observations RLS policies missing after migration';
  end if;
  raise notice 'Gate 43 migration verified: model_health_observations + RLS + indexes present';
end
$$;
