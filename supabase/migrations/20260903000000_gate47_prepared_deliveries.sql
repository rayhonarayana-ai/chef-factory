-- Gate 47: immutable prepared delivery records. Do not apply during implementation.
create table public.prepared_deliveries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  agent_id uuid not null references public.agents(id),
  approval_id uuid unique references public.approvals(id) on delete restrict,
  message text not null check (length(message) between 3 and 500),
  message_hash text not null check (message_hash ~ '^[0-9a-f]{64}$'),
  base_commit text not null check (base_commit ~ '^[0-9a-f]{40,64}$'),
  prepared_tree_sha text not null check (prepared_tree_sha ~ '^[0-9a-f]{40,64}$'),
  manifest jsonb not null,
  manifest_fingerprint text not null check (manifest_fingerprint ~ '^[0-9a-f]{64}$'),
  workspace_fingerprint text not null check (workspace_fingerprint ~ '^[0-9a-f]{64}$'),
  verification_session_id uuid,
  verification_workspace_fingerprint text check (verification_workspace_fingerprint is null or verification_workspace_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'prepared' check (status in ('prepared','approved','rejected','committing','committed','failed','stale','ambiguous')),
  version integer not null default 1,
  commit_sha text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{40,64}$'),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index prepared_deliveries_owner_status_idx on public.prepared_deliveries(owner_id, status);
create unique index prepared_deliveries_active_task_idx on public.prepared_deliveries(task_id) where status in ('prepared','approved','committing');
alter table public.prepared_deliveries enable row level security;
create policy prepared_deliveries_select_owner on public.prepared_deliveries for select to authenticated using (owner_id = auth.uid());
create policy prepared_deliveries_no_write on public.prepared_deliveries for all to authenticated using (false) with check (false);
