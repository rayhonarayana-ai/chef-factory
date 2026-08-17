-- ============================================================
-- CHEF FACTORY — GATE 1 — CORE ADDITIONS (memory boundary persistence)
-- Migration: 20260816000000_core_additions.sql
-- Adds: memory_lessons (validated, secret-free lesson persistence behind
--        the MemoryGateway boundary)
-- ============================================================

create table public.memory_lessons (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.owners(id) on delete cascade,
  title       text not null,
  summary     text not null,
  category    text not null,
  project_id  uuid references public.projects(id) on delete set null,
  confidence  numeric(3,2) check (confidence between 0 and 1),
  created_at  timestamptz not null default now()
);
create index memory_lessons_owner_id_idx on public.memory_lessons(owner_id);
create index memory_lessons_category_idx on public.memory_lessons(category);

alter table public.memory_lessons enable row level security;

create policy memory_lessons_select_owner on public.memory_lessons
  for select to authenticated using (owner_id = auth.uid());
create policy memory_lessons_insert_owner on public.memory_lessons
  for insert to authenticated with check (owner_id = auth.uid());
create policy memory_lessons_update_owner on public.memory_lessons
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy memory_lessons_delete_owner on public.memory_lessons
  for delete to authenticated using (owner_id = auth.uid());

-- ============================================================
-- END OF MIGRATION 20260816000000_core_additions.sql
-- ============================================================
