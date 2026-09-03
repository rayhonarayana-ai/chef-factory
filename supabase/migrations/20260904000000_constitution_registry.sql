-- ============================================================
-- CHEF FACTORY — CONSTITUTION — REGISTRY FOUNDATION (S1)
-- Migration: 20260904000000_constitution_registry.sql
--
-- Accepted S1 Architecture Preclosure decisions (frozen):
--   PAYLOAD_AND_GOVERNANCE_SEPARATED                = YES
--   IMMUTABLE_GOVERNANCE_HISTORY                    = YES
--   CURRENT_STATE_IS_PROJECTION_ONLY                = YES
--   REVOCATION_EPOCH_LOCATION                       = RUNTIME_STATE
--   ENFORCEMENT_READY_AS_IMMUTABLE_EVENT            = YES
--   ACTIVATION_BINDS_RUNTIME_ARTIFACT_IDENTITY      = YES
--   GENERIC_AUDIT_IS_CONSTITUTIONAL_SOURCE_OF_TRUTH = NO
--   LIVE_GIT_DIRECTORY_REQUIRED_AT_RUNTIME          = NO
--   SECOND_IN_SYSTEM_OWNER_CONFIRMATION             = YES
--   DEDICATED_CONSTITUTIONAL_ACTIVATION_CEREMONY    = YES
--   LEGACY_MISSIONS_REQUIRE_EXPLICIT_HANDLING_AT_FIRST_ACTIVATION = YES
--
-- Four protected tables:
--   constitution_versions               (immutable payload identity/provenance)
--   constitution_governance_events      (authoritative immutable governance history)
--   constitution_enforcement_evidence   (immutable enforcement evidence)
--   constitution_runtime_state          (exactly-one-row mutable projection)
--
-- S1 is storage substrate ONLY. This file is NOT applied to live databases in
-- S1 (LIVE_SCHEMA_APPLIED = NO) unless explicit live-migration authorization.
--
-- Frozen event vocabulary (no fabricated historical bootstrap event):
--   SYSTEM_RATIFICATION_CONFIRMED, ENFORCEMENT_READY_RECORDED, ACTIVATED,
--   SUPERSEDED, SECURITY_REVOKED, ROLLED_BACK_TO_VERSION
--
-- Agents/models/workers are NOT valid governance actors: actor_type is schema
-- restricted to ('owner','system'). Factory-level ONLY: no project_id column
-- exists on any constitutional table (I11 structurally impossible).
--
-- Advisory transaction lock: the application serializes ALL constitutional
-- transitions on pg_advisory_xact_lock(74740, 1). Neighboring in-use domains:
-- 74738 (task dependency edges), 74739 (mission engine). 74740 is the first
-- dedicated constitutional lock key; it cannot collide with existing domains.
-- ============================================================

-- ---------- 1. constitution_versions: immutable payload identity ----------
create table public.constitution_versions (
  constitution_hash text primary key check (constitution_hash ~ '^[0-9a-f]{64}$'),
  constitution_id   uuid not null check (constitution_id = '00000000-0000-0000-0000-000000000001'::uuid),
  version           integer not null check (version >= 1),
  payload_path      text not null check (length(payload_path) between 1 and 1024),
  source_commit_sha text check (source_commit_sha is null or source_commit_sha ~ '^[0-9a-f]{40,64}$'),
  git_blob_id       text check (git_blob_id is null or git_blob_id ~ '^[0-9a-f]{40,64}$'),
  created_at        timestamptz not null default now()
);
create unique index constitution_versions_lineage_version_idx on public.constitution_versions(constitution_id, version);

-- ---------- 2. constitution_enforcement_evidence: immutable evidence ----------
create table public.constitution_enforcement_evidence (
  evidence_id               uuid primary key default gen_random_uuid(),
  constitution_hash         text not null references public.constitution_versions(constitution_hash),
  runtime_artifact_identity text not null,
  runtime_code_commit_sha   text check (runtime_code_commit_sha is null or runtime_code_commit_sha ~ '^[0-9a-f]{40,64}$'),
  build_provenance          jsonb not null default '{}'::jsonb,
  verification_suite        text not null,
  verification_suite_version text not null,
  evidence_digest           text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  recorded_at               timestamptz not null default now()
);
create index constitution_evidence_hash_idx on public.constitution_enforcement_evidence(constitution_hash);

-- ---------- 3. constitution_governance_events: authoritative history ----------
create table public.constitution_governance_events (
  event_id               bigint generated always as identity primary key,
  constitution_hash      text not null references public.constitution_versions(constitution_hash),
  event_type             text not null check (event_type in ('SYSTEM_RATIFICATION_CONFIRMED','ENFORCEMENT_READY_RECORDED','ACTIVATED','SUPERSEDED','SECURITY_REVOKED','ROLLED_BACK_TO_VERSION')),
  actor_type             text not null check (actor_type in ('owner','system')),
  actor_id               uuid not null,
  occurred_at            timestamptz not null default now(),
  previous_active_hash   text references public.constitution_versions(constitution_hash),
  new_active_hash        text references public.constitution_versions(constitution_hash),
  evidence_id            uuid references public.constitution_enforcement_evidence(evidence_id),
  revocation_epoch_before bigint not null default 0 check (revocation_epoch_before >= 0),
  revocation_epoch_after bigint not null default 0 check (revocation_epoch_after >= 0),
  metadata               jsonb not null default '{}'::jsonb,
  constraint ct_event_epoch_consistency check (
    event_type = 'SECURITY_REVOKED' or revocation_epoch_after = revocation_epoch_before
  ),
  constraint ct_event_shape check (
       (event_type = 'SYSTEM_RATIFICATION_CONFIRMED' and previous_active_hash is null and new_active_hash is null and evidence_id is null)
    or (event_type = 'ENFORCEMENT_READY_RECORDED' and new_active_hash is null and evidence_id is not null)
    or (event_type in ('ACTIVATED','ROLLED_BACK_TO_VERSION') and new_active_hash = constitution_hash and evidence_id is not null)
    or (event_type = 'SUPERSEDED' and previous_active_hash is not null and new_active_hash = constitution_hash and new_active_hash <> previous_active_hash and evidence_id is null)
    or (event_type = 'SECURITY_REVOKED' and previous_active_hash = constitution_hash and new_active_hash is null and evidence_id is null and revocation_epoch_after = revocation_epoch_before + 1)
  )
);
create index constitution_events_hash_idx on public.constitution_governance_events(constitution_hash, event_id);
create index constitution_events_type_idx on public.constitution_governance_events(event_type);

-- ---------- 4. constitution_runtime_state: exactly-one-row projection ----------
create table public.constitution_runtime_state (
  singleton_id              smallint primary key check (singleton_id = 1),
  active_constitution_hash  text references public.constitution_versions(constitution_hash),
  active_activation_event_id bigint references public.constitution_governance_events(event_id),
  revocation_epoch          bigint not null default 0 check (revocation_epoch >= 0),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
insert into public.constitution_runtime_state (singleton_id) values (1) on conflict do nothing;

-- ---------- 5. append-only / singleton protection (block UPDATE/DELETE/TRUNCATE) ----------
create or replace function public.ct_block_constitution_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'constitution table mutation is blocked';
end;
$$;

create or replace function public.ct_block_runtime_state_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'constitution_runtime_state is a protected singleton';
end;
$$;

create trigger ct_versions_no_update before update on public.constitution_versions
  for each row execute function public.ct_block_constitution_mutation();
create trigger ct_versions_no_delete before delete on public.constitution_versions
  for each row execute function public.ct_block_constitution_mutation();
create trigger ct_versions_no_truncate before truncate on public.constitution_versions
  for each statement execute function public.ct_block_constitution_mutation();

create trigger ct_events_no_update before update on public.constitution_governance_events
  for each row execute function public.ct_block_constitution_mutation();
create trigger ct_events_no_delete before delete on public.constitution_governance_events
  for each row execute function public.ct_block_constitution_mutation();
create trigger ct_events_no_truncate before truncate on public.constitution_governance_events
  for each statement execute function public.ct_block_constitution_mutation();

create trigger ct_evidence_no_update before update on public.constitution_enforcement_evidence
  for each row execute function public.ct_block_constitution_mutation();
create trigger ct_evidence_no_delete before delete on public.constitution_enforcement_evidence
  for each row execute function public.ct_block_constitution_mutation();
create trigger ct_evidence_no_truncate before truncate on public.constitution_enforcement_evidence
  for each statement execute function public.ct_block_constitution_mutation();

create trigger ct_state_no_delete before delete on public.constitution_runtime_state
  for each row execute function public.ct_block_runtime_state_delete();
create trigger ct_state_no_truncate before truncate on public.constitution_runtime_state
  for each statement execute function public.ct_block_runtime_state_delete();

-- ---------- 6. truth-enforcing guard triggers ----------
-- Note on visibility/ordering (S1 close-out): PostgreSQL makes rows inserted by
-- earlier statements in the SAME transaction visible to later statements and to
-- the triggers they fire. The application therefore always orders writes as
-- [precondition checks] -> [governance event insert(s)] -> [runtime_state
-- pointer/epoch update] inside one transaction. The guards below validate the
-- already-inserted event/evidence/confirmation; this ordering is reliable, not
-- fragile. Guards perform ONLY indexed SELECTs; no dynamic SQL.

-- 6a. Enforcement evidence may only be recorded for a SYSTEM-RATIFICATION-
--     CONFIRMED payload (I2/I3 chain at the evidence layer).
create or replace function public.ct_ensure_evidence_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.constitution_governance_events g
    where g.constitution_hash = new.constitution_hash
      and g.event_type = 'SYSTEM_RATIFICATION_CONFIRMED'
  ) then
    raise exception 'enforcement evidence requires a system-confirmed ratification';
  end if;
  return new;
end;
$$;

create trigger ct_evidence_require_confirmed before insert on public.constitution_enforcement_evidence
  for each row execute function public.ct_ensure_evidence_confirmed();

-- 6b. Governance events must bind evidence to the SAME constitution whenever an
--     activation-family or enforcement-ready event is recorded (I14).
create or replace function public.ct_validate_governance_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_type in ('ACTIVATED','ROLLED_BACK_TO_VERSION','ENFORCEMENT_READY_RECORDED') then
    if not exists (
      select 1 from public.constitution_enforcement_evidence e
      where e.evidence_id = new.evidence_id
        and e.constitution_hash = new.constitution_hash
    ) then
      raise exception 'governance event evidence must bind the same constitution';
    end if;
  end if;
  return new;
end;
$$;

create trigger ct_events_validate before insert on public.constitution_governance_events
  for each row execute function public.ct_validate_governance_event();

-- 6c. Runtime state guard. The projection may only point at a version that is
--     system-confirmed, has enforcement evidence, and is set by an ACTIVATED or
--     ROLLED_BACK_TO_VERSION event whose new_active_hash equals the pointer.
--     The pointer may never be cleared, the epoch may never decrease, and any
--     epoch increase must be justified by a SECURITY_REVOKED event that names
--     the active constitution and the new epoch (I5/I6/I7/I8 at the projection).
create or replace function public.ct_ensure_valid_runtime_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  act public.constitution_governance_events;
begin
  if tg_op = 'DELETE' then
    raise exception 'constitution_runtime_state is a protected singleton';
  end if;
  if new.singleton_id is distinct from 1 then
    raise exception 'constitution_runtime_state singleton_id must be 1';
  end if;
  if old.active_constitution_hash is not null and new.active_constitution_hash is null then
    raise exception 'active constitution pointer cannot be cleared';
  end if;
  if new.revocation_epoch < old.revocation_epoch then
    raise exception 'revocation_epoch cannot decrease';
  end if;
  if new.active_constitution_hash is null then
    if new.active_activation_event_id is not null then
      raise exception 'null active pointer must carry a null activation event reference';
    end if;
    return new;
  end if;

  if not exists (
    select 1 from public.constitution_governance_events g
    where g.constitution_hash = new.active_constitution_hash
      and g.event_type = 'SYSTEM_RATIFICATION_CONFIRMED'
  ) then
    raise exception 'active constitution lacks a system-confirmed ratification';
  end if;
  if not exists (
    select 1 from public.constitution_enforcement_evidence e
    where e.constitution_hash = new.active_constitution_hash
  ) then
    raise exception 'active constitution lacks enforcement evidence';
  end if;
  if new.active_activation_event_id is null then
    raise exception 'active constitution requires an activation event reference';
  end if;
  select * into act from public.constitution_governance_events g
  where g.event_id = new.active_activation_event_id;
  if act is null then
    raise exception 'active_activation_event_id must reference a governance event';
  end if;
  if act.constitution_hash is distinct from new.active_constitution_hash
     or act.new_active_hash is distinct from new.active_constitution_hash
     or act.event_type not in ('ACTIVATED','ROLLED_BACK_TO_VERSION') then
    raise exception 'active activation event must be an activation-type event for the active constitution';
  end if;

  if new.revocation_epoch > old.revocation_epoch then
    if not exists (
      select 1 from public.constitution_governance_events g
      where g.event_type = 'SECURITY_REVOKED'
        and g.previous_active_hash = new.active_constitution_hash
        and g.revocation_epoch_after = new.revocation_epoch
    ) then
      raise exception 'revocation_epoch increase requires a matching SECURITY_REVOKED event';
    end if;
  end if;
  return new;
end;
$$;

create trigger ct_state_validate before insert or update or delete on public.constitution_runtime_state
  for each row execute function public.ct_ensure_valid_runtime_state();

-- ---------- 7. RLS (factory-level; owner read-only; service-role actor only) ----------
alter table public.constitution_versions enable row level security;
alter table public.constitution_enforcement_evidence enable row level security;
alter table public.constitution_governance_events enable row level security;
alter table public.constitution_runtime_state enable row level security;

create policy ct_versions_select_owner on public.constitution_versions
  for select to authenticated using (public.is_owner());
create policy ct_versions_no_write on public.constitution_versions
  for all to authenticated using (false) with check (false);

create policy ct_evidence_select_owner on public.constitution_enforcement_evidence
  for select to authenticated using (public.is_owner());
create policy ct_evidence_no_write on public.constitution_enforcement_evidence
  for all to authenticated using (false) with check (false);

create policy ct_events_select_owner on public.constitution_governance_events
  for select to authenticated using (public.is_owner());
create policy ct_events_no_write on public.constitution_governance_events
  for all to authenticated using (false) with check (false);

create policy ct_state_select_owner on public.constitution_runtime_state
  for select to authenticated using (public.is_owner());
create policy ct_state_no_write on public.constitution_runtime_state
  for all to authenticated using (false) with check (false);

-- ---------- 8. privilege-layer defense-in-depth (mirrors audit hardening) ----------
revoke truncate, trigger on public.constitution_versions from anon, authenticated;
revoke truncate, trigger on public.constitution_enforcement_evidence from anon, authenticated;
revoke truncate, trigger on public.constitution_governance_events from anon, authenticated;
revoke truncate, trigger on public.constitution_runtime_state from anon, authenticated;

-- ============================================================
-- END OF MIGRATION 20260904000000_constitution_registry.sql
-- ============================================================