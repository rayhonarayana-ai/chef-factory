-- ============================================================
-- CHEF FACTORY — GATE 14 — PERSISTENT SECURITY STATE
-- Migration: 20260820000000_gate14_security_state.sql
-- Adds: rate_limit_state, anomaly_state tables.
-- Security: Strict RLS. Owner-scoped. Atomic updates via
--           INSERT ... ON CONFLICT DO UPDATE to prevent
--           read-increment-write race conditions.
-- ============================================================

-- ============================================================
-- A. TABLES
-- ============================================================

-- ---------- 1. rate_limit_state (per-owner rate limit counters) ----------
create table public.rate_limit_state (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.owners(id) on delete cascade,
  scope               text not null,
  limit_key           text not null,
  count               integer not null default 0,
  window_started_at   bigint not null default 0,
  updated_at          timestamptz not null default now(),
  unique(owner_id, scope, limit_key)
);

-- Index for fast lookup by owner+scope+limitKey
create index idx_rate_limit_state_owner_scope
  on public.rate_limit_state (owner_id, scope, limit_key);

-- ---------- 2. anomaly_state (per-owner anomaly counters) ----------
create table public.anomaly_state (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.owners(id) on delete cascade,
  counter_kind        text not null,
  count               integer not null default 0,
  last_decay_at       bigint not null default 0,
  updated_at          timestamptz not null default now(),
  unique(owner_id, counter_kind)
);

-- Index for fast lookup by owner+counterKind
create index idx_anomaly_state_owner_kind
  on public.anomaly_state (owner_id, counter_kind);

-- ============================================================
-- B. RLS POLICIES
-- ============================================================

-- Enable RLS on both tables
alter table public.rate_limit_state enable row level security;
alter table public.anomaly_state enable row level security;

-- rate_limit_state: owner can only see/modify own rows
create policy rate_limit_state_owner_isolation
  on public.rate_limit_state
  for all
  using (owner_id = auth.uid()::uuid)
  with check (owner_id = auth.uid()::uuid);

-- anomaly_state: owner can only see/modify own rows
create policy anomaly_state_owner_isolation
  on public.anomaly_state
  for all
  using (owner_id = auth.uid()::uuid)
  with check (owner_id = auth.uid()::uuid);

-- ============================================================
-- C. UPDATED_AT TRIGGERS
-- ============================================================

create trigger rate_limit_state_set_updated_at
  before update on public.rate_limit_state
  for each row execute function public.set_updated_at();

create trigger anomaly_state_set_updated_at
  before update on public.anomaly_state
  for each row execute function public.set_updated_at();
