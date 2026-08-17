-- ============================================================
-- CHEF FACTORY — GATE 2 — SECURITY GUARDIAN RLS/DB TESTS
-- File:     supabase/tests/rls_security_tests.sql
-- Runner:   node supabase/tests/run_tests.cjs rls_security_tests.sql
-- Behavior: transactional + self-cleaning (BEGIN ... ROLLBACK)
-- Tests:    critical_actions immutability, security_events owner
--           isolation + append-only, security_lockdowns history +
--           owner release, security_incidents CRUD isolation,
--           security_policies read-only, security_rate_limits scope.
-- ============================================================

begin;

-- ---------- test helpers (rolled back at end) ----------
create or replace function public._tfail2(name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'TEST FAIL: %', name;
end;
$$;

create or replace function public._texpect_error2(sqltext text, name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  execute sqltext;
  perform public._tfail2(name || ' (expected error, got success)');
exception
  when others then
    null; -- expected
end;
$$;

-- ---------- seed: auth users (trigger auto-creates owners) ----------
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('11111111-1111-1111-1111-111111111111','authenticated','authenticated','sec-owner1@factory.test','x', now()),
  ('22222222-2222-2222-2222-222222222222','authenticated','authenticated','sec-owner2@factory.test','x', now());

do $$ declare n integer;
begin
  select count(*) into n from public.owners
    where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
  if n <> 2 then raise exception 'TEST FAIL: owner trigger did not create 2 owners (found %)', n; end if;
end $$;

-- ============================================================
-- TEST S1 — CRITICAL ACTIONS REGISTRY (immutable, readable)
-- ============================================================
set role postgres;

do $$ declare n integer;
begin
  select count(*) into n from public.critical_actions;
  if n <> 17 then raise exception 'TEST FAIL: critical_actions should have exactly 17 core rows (found %)', n; end if;
  select count(*) into n from public.critical_actions where is_core;
  if n <> 17 then raise exception 'TEST FAIL: all core rows must be is_core=true (found %)', n; end if;
  -- deny defaults must include the §7 minimum (TS CRITICAL_ACTIONS parity)
  select count(*) into n from public.critical_actions where default_decision = 'deny';
  if n <> 9 then raise exception 'TEST FAIL: expected 9 deny-by-default critical actions (found %)', n; end if;
  select count(*) into n from public.critical_actions where default_decision = 'require_approval';
  if n <> 8 then raise exception 'TEST FAIL: expected 8 require_approval critical actions (found %)', n; end if;
end $$;

-- registry is immutable: UPDATE and DELETE are hard-blocked by trigger
select public._texpect_error2(
  $sql$update public.critical_actions set description = 'hacked' where action = 'financial_transaction'$sql$,
  'critical_actions UPDATE blocked'
);
select public._texpect_error2(
  $sql$delete from public.critical_actions where action = 'financial_transaction'$sql$,
  'critical_actions DELETE blocked'
);
select public._texpect_error2(
  $sql$insert into public.critical_actions (action, classification, default_decision, environments, description, is_core)
    values ('custom_escape','production','allow','all','fabricated',true)$sql$,
  'critical_actions invalid decision blocked'
);

-- authenticated owner can read the registry
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.agent_id', '', true);

do $$ declare n integer;
begin
  select count(*) into n from public.critical_actions;
  if n <> 17 then raise exception 'TEST FAIL: owner cannot read critical_actions (found %)', n; end if;
end $$;

set role postgres;

-- ============================================================
-- TEST S2 — SECURITY EVENTS: owner isolation + append-only
-- ============================================================
set role postgres;
insert into public.security_events (
  security_event_id, owner_id, event_type, severity, action, reason, occurred_at
) values
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'denied.action', 'high', 'delete', 'owner1 denied', now()),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'lockdown.activated', 'critical', 'lockdown', 'owner2 lockdown', now());

-- owner isolation via RLS
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.agent_id', '', true);

do $$ declare n integer;
begin
  select count(*) into n from public.security_events;
  if n <> 1 then raise exception 'TEST FAIL: owner1 should see exactly 1 security event (found %)', n; end if;
end $$;

-- RLS: no UPDATE/DELETE policies → 0 rows affected
do $$ declare n integer;
begin
  update public.security_events set reason = 'hacked';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TEST FAIL: security_events updated via RLS'; end if;
  delete from public.security_events;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TEST FAIL: security_events deleted via RLS'; end if;
end $$;

set role postgres;

-- trigger-level append-only (bypasses RLS as superuser)
select public._texpect_error2(
  $sql$update public.security_events set reason = 'hacked'$sql$,
  'security_events UPDATE blocked by trigger'
);
select public._texpect_error2(
  $sql$delete from public.security_events$sql$,
  'security_events DELETE blocked by trigger'
);

-- ============================================================
-- TEST S3 — SECURITY LOCKDOWNS: owner scope, history, owner release
-- ============================================================
set role postgres;
insert into public.security_lockdowns (
  lockdown_id, owner_id, scope, reason, status, activated_by
) values
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'all', 'emergency', 'active', '11111111-1111-1111-1111-111111111111'),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'all', 'emergency', 'active', '22222222-2222-2222-2222-222222222222');

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.agent_id', '', true);

do $$ declare n integer;
begin
  select count(*) into n from public.security_lockdowns;
  if n <> 1 then raise exception 'TEST FAIL: owner1 should see exactly 1 lockdown (found %)', n; end if;
  -- owner can release own lockdown (status transition) — update policy owner-scoped
  update public.security_lockdowns set status = 'released', released_by = '11111111-1111-1111-1111-111111111111', released_at = now()
    where owner_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'TEST FAIL: owner could not release own lockdown'; end if;
end $$;

set role postgres;

-- lockdowns are history: deletion hard-blocked by trigger
select public._texpect_error2(
  $sql$delete from public.security_lockdowns$sql$,
  'security_lockdowns DELETE blocked'
);

-- ============================================================
-- TEST S4 — SECURITY INCIDENTS: owner-scoped CRUD
-- ============================================================
set role postgres;
insert into public.security_incidents (
  incident_id, owner_id, title, status, opened_by
) values
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'incident 1', 'detected', '11111111-1111-1111-1111-111111111111'),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'incident 2', 'detected', '22222222-2222-2222-2222-222222222222');

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.agent_id', '', true);

do $$ declare n integer;
begin
  select count(*) into n from public.security_incidents;
  if n <> 1 then raise exception 'TEST FAIL: owner1 should see exactly 1 incident (found %)', n; end if;
  -- owner can transition own incident
  update public.security_incidents set status = 'investigating'
    where owner_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'TEST FAIL: owner could not update own incident'; end if;
  -- owner cannot see/alter owner2's incident
  update public.security_incidents set status = 'contained'
    where owner_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TEST FAIL: owner1 could update owner2 incident (isolation broken)'; end if;
  select count(*) into n from public.security_incidents where status = 'contained';
  if n <> 0 then raise exception 'TEST FAIL: owner1 could see owner2 incident (isolation broken)'; end if;
end $$;

set role postgres;

-- ============================================================
-- TEST S5 — SECURITY POLICIES: read-only registry
-- ============================================================
do $$ declare n integer;
begin
  select count(*) into n from public.security_policies;
  if n <> 13 then raise exception 'TEST FAIL: security_policies should have 13 deterministic rules (found %)', n; end if;
  select count(*) into n from public.security_policies where enabled;
  if n <> 13 then raise exception 'TEST FAIL: all policy rules must be enabled (found %)', n; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.agent_id', '', true);

do $$ declare n integer;
begin
  select count(*) into n from public.security_policies;
  if n <> 13 then raise exception 'TEST FAIL: owner cannot read security_policies (found %)', n; end if;
  -- read-only: no update/delete policies
  update public.security_policies set enabled = false;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TEST FAIL: security_policies updated via RLS'; end if;
end $$;

set role postgres;

-- ============================================================
-- TEST S6 — SECURITY RATE LIMITS: owner scope
-- ============================================================
insert into public.security_rate_limits (owner_id, scope, limit_key, max_count, window_seconds, version)
  values ('11111111-1111-1111-1111-111111111111', 'task', 'task.execute', 50, 3600, 1);

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.agent_id', '', true);

do $$ declare n integer;
begin
  select count(*) into n from public.security_rate_limits;
  if n <> 1 then raise exception 'TEST FAIL: owner should see exactly 1 rate limit config (found %)', n; end if;
end $$;

set role postgres;

-- ============================================================
-- TEST S7 — TRUNCATE GUARD (defense-in-depth)
-- TRUNCATE bypasses RLS and FOR EACH ROW triggers. Hardened by
-- migration 20260818000000 (BEFORE TRUNCATE statement triggers +
-- privilege revocation). Protected: security_events,
-- critical_actions, security_lockdowns, security_incidents,
-- security_rate_limits, security_policies, audit_events.
-- ============================================================

-- trigger layer: even postgres (full privileges) cannot truncate
select public._texpect_error2(
  $sql$truncate table public.security_events$sql$,
  'security_events TRUNCATE blocked (trigger)'
);
select public._texpect_error2(
  $sql$truncate table public.critical_actions$sql$,
  'critical_actions TRUNCATE blocked (trigger)'
);
select public._texpect_error2(
  $sql$truncate table public.security_lockdowns$sql$,
  'security_lockdowns TRUNCATE blocked (trigger)'
);
select public._texpect_error2(
  $sql$truncate table public.security_incidents$sql$,
  'security_incidents TRUNCATE blocked (trigger)'
);
select public._texpect_error2(
  $sql$truncate table public.security_rate_limits$sql$,
  'security_rate_limits TRUNCATE blocked (trigger)'
);
select public._texpect_error2(
  $sql$truncate table public.security_policies$sql$,
  'security_policies TRUNCATE blocked (trigger)'
);
select public._texpect_error2(
  $sql$truncate table public.audit_events$sql$,
  'audit_events TRUNCATE blocked (trigger)'
);

-- privilege layer: authenticated has no TRUNCATE privilege anymore
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.agent_id', '', true);

select public._texpect_error2(
  $sql$truncate table public.security_events$sql$,
  'security_events TRUNCATE denied to authenticated (privilege)'
);
select public._texpect_error2(
  $sql$truncate table public.critical_actions$sql$,
  'critical_actions TRUNCATE denied to authenticated (privilege)'
);
select public._texpect_error2(
  $sql$truncate table public.security_lockdowns$sql$,
  'security_lockdowns TRUNCATE denied to authenticated (privilege)'
);

set role postgres;

-- ============================================================
-- ALL TESTS PASSED
-- ============================================================
do $$ begin
  raise notice 'ALL GATE 2 SECURITY RLS/DB TESTS PASSED';
end $$;

rollback;
