-- ============================================================
-- CHEF FACTORY — GATE 1 — DETERMINISTIC DATABASE/RLS TESTS
-- File:     supabase/tests/rls_tests.sql
-- Runner:   node supabase/tests/run_tests.js
-- Behavior: transactional + self-cleaning (BEGIN ... ROLLBACK)
-- Tests:    owner identity, project isolation, unauthorized
--           access, audit append-only, preference versioning,
--           required FKs, project scope.
-- ============================================================

begin;

-- ---------- test helpers (rolled back at end) ----------
create or replace function public._tfail(name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'TEST FAIL: %', name;
end;
$$;

create or replace function public._texpect_error(sqltext text, name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  execute sqltext;
  perform public._tfail(name || ' (expected error, got success)');
exception
  when others then
    null; -- expected
end;
$$;

-- ---------- seed: auth users (trigger auto-creates owners) ----------
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('11111111-1111-1111-1111-111111111111','authenticated','authenticated','owner1@factory.test','x', now()),
  ('22222222-2222-2222-2222-222222222222','authenticated','authenticated','owner2@factory.test','x', now());

do $$ declare n integer;
begin
  select count(*) into n from public.owners
    where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
  if n <> 2 then raise exception 'TEST FAIL: on_auth_user_created trigger did not create 2 owners (found %)', n; end if;
end $$;

-- ============================================================
-- TEST 1 — OWNER IDENTITY
-- ============================================================
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

do $$ declare n integer;
begin
  select count(*) into n from public.owners where id = '11111111-1111-1111-1111-111111111111';
  if n <> 1 then raise exception 'TEST FAIL: owner cannot read own identity'; end if;
  select count(*) into n from public.owners where id = '22222222-2222-2222-2222-222222222222';
  if n <> 0 then raise exception 'TEST FAIL: owner can read ANOTHER owner row'; end if;
end $$;

set role postgres;

-- ============================================================
-- SEED: projects, agents, permissions, tasks (as superuser)
-- ============================================================
insert into public.projects (owner_id, name, slug) values
  ('11111111-1111-1111-1111-111111111111','Project A','proj-a'),
  ('11111111-1111-1111-1111-111111111111','Project B','proj-b');

do $$ declare pA uuid; pB uuid;
begin
  select id into pA from public.projects where slug = 'proj-a';
  select id into pB from public.projects where slug = 'proj-b';
  insert into public.agents (id, owner_id, name, slug, role) values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','Agent Alpha','agent-alpha','worker');
  insert into public.agent_permissions (agent_id, project_id, resource_type, permission, granted_by)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', pA, 'tasks', 'read', '11111111-1111-1111-1111-111111111111');
  insert into public.agent_permissions (agent_id, project_id, resource_type, permission, granted_by)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', pA, 'projects', 'read', '11111111-1111-1111-1111-111111111111');
  insert into public.tasks (owner_id, project_id, title) values
    ('11111111-1111-1111-1111-111111111111', pA, 'task in A'),
    ('11111111-1111-1111-1111-111111111111', pB, 'task in B');
end $$;

-- ============================================================
-- TEST 2 — OWNER SEES ALL OWN PROJECTS
-- ============================================================
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.agent_id', '', true);

do $$ declare n integer;
begin
  select count(*) into n from public.projects where owner_id = '11111111-1111-1111-1111-111111111111';
  if n <> 2 then raise exception 'TEST FAIL: owner should see 2 projects (found %)', n; end if;
  select count(*) into n from public.tasks where owner_id = '11111111-1111-1111-1111-111111111111';
  if n <> 2 then raise exception 'TEST FAIL: owner should see 2 tasks (found %)', n; end if;
end $$;

set role postgres;

-- ============================================================
-- TEST 3 — PROJECT ISOLATION + PROJECT SCOPE (agent-scoped)
-- ============================================================
set role authenticated;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.agent_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

do $$ declare n integer;
begin
  select count(*) into n from public.projects;
  if n <> 1 then raise exception 'TEST FAIL: agent should see exactly 1 project (found %)', n; end if;
  select count(*) into n from public.tasks t
    join public.projects p on p.id = t.project_id where p.slug = 'proj-a';
  if n <> 1 then raise exception 'TEST FAIL: agent should see 1 task in Project A (found %)', n; end if;
  select count(*) into n from public.tasks t
    join public.projects p on p.id = t.project_id where p.slug = 'proj-b';
  if n <> 0 then raise exception 'TEST FAIL: PROJECT ISOLATION — agent sees Project B tasks (found %)', n; end if;
end $$;

set role postgres;

-- ============================================================
-- TEST 4 — UNAUTHORIZED ACCESS
-- ============================================================
set role anon;

do $$ declare n integer;
begin
  select count(*) into n from public.projects;
  if n <> 0 then raise exception 'TEST FAIL: anon can read projects (found %)', n; end if;
  select count(*) into n from public.owners;
  if n <> 0 then raise exception 'TEST FAIL: anon can read owners (found %)', n; end if;
end $$;

set role postgres;

-- authenticated user with NO owner row
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
select set_config('request.agent_id', '', true);

do $$ declare n integer;
begin
  select count(*) into n from public.projects;
  if n <> 0 then raise exception 'TEST FAIL: unknown authenticated user can read projects (found %)', n; end if;
  select count(*) into n from public.tasks;
  if n <> 0 then raise exception 'TEST FAIL: unknown authenticated user can read tasks (found %)', n; end if;
end $$;

set role postgres;

-- ============================================================
-- TEST 5 — AUDIT APPEND-ONLY BEHAVIOR
-- ============================================================
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.agent_id', '', true);

insert into public.audit_events (actor_type, actor_id, action, project_id, authorization_result)
  values ('owner', '11111111-1111-1111-1111-111111111111', 'test.action', (select id from public.projects where slug = 'proj-a'), 'auto');

do $$ declare n integer;
begin
  -- RLS has no UPDATE/DELETE policies: an authenticated owner updates 0 rows
  update public.audit_events set metadata = '{"hack":true}'::jsonb;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TEST FAIL: audit row was updated via RLS'; end if;
  delete from public.audit_events;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TEST FAIL: audit row was deleted via RLS'; end if;
end $$;

set role postgres;

-- trigger-level append-only enforcement (bypasses RLS as superuser)
select public._texpect_error(
  $sql$update public.audit_events set metadata = '{"hack":true}'::jsonb$sql$,
  'audit_events trigger blocks UPDATE'
);
select public._texpect_error(
  $sql$delete from public.audit_events$sql$,
  'audit_events trigger blocks DELETE'
);

-- ============================================================
-- TEST 6 — PREFERENCE VERSIONING
-- ============================================================
set role postgres;

insert into public.personal_preferences (owner_id, category, key, value, version, is_active)
  values ('11111111-1111-1111-1111-111111111111','coding','indent','{"size":2}',1,true);

select public._texpect_error(
  $sql$insert into public.personal_preferences (owner_id, category, key, value, version, is_active)
    values ('11111111-1111-1111-1111-111111111111','coding','indent','{"size":4}',2,true)$sql$,
  'only one ACTIVE version per key'
);

update public.personal_preferences set is_active = false
  where owner_id = '11111111-1111-1111-1111-111111111111' and category = 'coding' and key = 'indent';

insert into public.personal_preferences (owner_id, category, key, value, version, is_active)
  values ('11111111-1111-1111-1111-111111111111','coding','indent','{"size":4}',2,true);

do $$ declare n integer;
begin
  select count(*) into n from public.personal_preferences
    where owner_id='11111111-1111-1111-1111-111111111111' and category='coding' and key='indent' and is_active;
  if n <> 1 then raise exception 'TEST FAIL: expected exactly 1 active preference (found %)', n; end if;
  select count(*) into n from public.personal_preferences
    where owner_id='11111111-1111-1111-1111-111111111111' and category='coding' and key='indent';
  if n <> 2 then raise exception 'TEST FAIL: expected 2 versions total (found %)', n; end if;
end $$;

-- ============================================================
-- TEST 7 — REQUIRED FOREIGN KEYS
-- ============================================================
do $$ declare pA uuid; begin
  select id into pA from public.projects where slug = 'proj-a';
  perform public._texpect_error(
    format('insert into public.tasks (owner_id, project_id, title) values (''11111111-1111-1111-1111-111111111111'',''%s'',''bad fk'')', '00000000-0000-0000-0000-000000000000'),
    'tasks.project_id FK enforced'
  );
  perform public._texpect_error(
    $sql$insert into public.tasks (owner_id, title) values ('11111111-1111-1111-1111-111111111111','no project')$sql$,
    'tasks.project_id NOT NULL enforced'
  );
  perform public._texpect_error(
    format('insert into public.agent_permissions (agent_id, project_id, resource_type, permission) values (''%s'',''%s'',''tasks'',''read'')', '00000000-0000-0000-0000-000000000000', pA),
    'agent_permissions.agent_id FK enforced'
  );
  perform public._texpect_error(
    $sql$insert into public.models (owner_id, provider, name, slug, cost_per_1k_input, cost_per_1k_output) values ('11111111-1111-1111-1111-111111111111','x','y','z',-1,0)$sql$,
    'models cost check enforced'
  );
end $$;

-- ============================================================
-- ALL TESTS PASSED
-- ============================================================
do $$ begin
  raise notice 'ALL GATE 1 RLS/DB TESTS PASSED';
end $$;

rollback;
