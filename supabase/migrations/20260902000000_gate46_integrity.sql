-- CHEF FACTORY — Gate 46: Workspace Integrity / Verification-to-State Binding.
--
-- Minimal schema extension to bind verification evidence to a trusted verification
-- session and a trusted workspace fingerprint:
--   task_verifications.verification_session_id  uuid (nullable)
--   task_verifications.workspace_fingerprint    text (nullable, bounded 64 hex chars)
--
-- Semantics / boundaries (Gate 46, frozen Gate45 semantics preserved):
--   - Owner/project/task integrity and RLS are preserved exactly as Gate45.
--   - WRITE remains SYSTEM-OBSERVED (service-role pool, trusted gate only);
--     authenticated clients (owner/agent) may READ only their own rows and still
--     cannot INSERT/UPDATE/DELETE (policies unchanged, see below).
--   - workspace_fingerprint is the hex SHA-256 (exactly 64 chars) of the trusted
--     source manifest. It is NOT raw output and NOT a secret.
--   - verification_session_id is a trusted infra-generated UUID.
--   - AUDIT-ONLY: historical evidence NEVER authorizes future completion.
--   - This migration is NOT applied live during implementation/pre-closure
--     (MIGRATION_APPLIED_LIVE = NO); it ships for review and applies under the
--     standard migrate path.

-- 1. Add the binding columns (idempotent).
alter table public.task_verifications
  add column if not exists verification_session_id uuid;
alter table public.task_verifications
  add column if not exists workspace_fingerprint text
    check (workspace_fingerprint is null or workspace_fingerprint ~ '^[0-9a-f]{64}$');

-- 2. Index for session-scoped reads of evidence binding (small; owner/task scoped).
create index if not exists task_verifications_session_idx
  on public.task_verifications(verification_session_id)
  where verification_session_id is not null;

-- 3. RLS is preserved — ensure the read-only owner policy still exists and the
--    client write policies remain denied (forgery prevention).
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

-- 4. post-apply verification.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_verifications' and column_name = 'verification_session_id'
  ) then
    raise exception 'task_verifications.verification_session_id missing after migration';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_verifications' and column_name = 'workspace_fingerprint'
  ) then
    raise exception 'task_verifications.workspace_fingerprint missing after migration';
  end if;
  raise notice 'Gate 46 migration verified: task_verifications session + fingerprint binding present';
end
$$;
