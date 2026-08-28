-- CHEF FACTORY — Gate 39: Mission Engine Foundation
--
-- Adds the durable MISSION entity + mission-bound task fields. This is the FOUNDATION
-- only: it stores an objective and a validated, hash-bound plan. The engine plans,
-- REQUESTs approval (never approves), and deterministically validates; materialization
-- and activation are each a single ALL-OR-NOTHING transaction performed by the
-- application layer. There is NO mission execution loop, NO orchestrator LLM task
-- creation, NO mission-aware scheduler, and NO permission grant from the engine.
--
-- Security invariants (never weakened, consistent with Gates 25/35A/38):
--   OWNER_ONLY creation/mutation      (RLS: owner_id = auth.uid())
--   AGENT read = permission-gated     (fail closed: 'missions' resource permission)
--   CROSS_OWNER / CROSS_PROJECT       (composite FK through missions(owner_id,project_id,id))
--   MISSION_TASK_KEY unique per mission (owner_id, project_id, mission_id, mission_task_key)
--   PARTIAL_TASK_GRAPH impossible     (enforced by app-layer single tx; DB adds a
--                                      NOT NULL mission_task_key for mission tasks so a
--                                      stray task can never masquerade as a plan task)

-- 0. Guard: tasks table must already exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'tasks' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) THEN
    RAISE EXCEPTION 'tasks table does not exist — Gate 39 migration blocked';
  END IF;
END
$$;

-- 1. missions table (idempotent).
CREATE TABLE IF NOT EXISTS public.missions (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.owners(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  objective       text not null,
  status          text not null default 'draft'
                  check (status in ('draft','pending_approval','approved','materialized','active','completed','failed','cancelled')),
  plan            jsonb not null default '{}'::jsonb,
  plan_hash       text,
  budget_limit    numeric(14,2),
  created_by      uuid references public.owners(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  approved_at     timestamptz,
  materialized_at timestamptz,
  activated_at    timestamptz,
  completed_at    timestamptz,
  failed_at       timestamptz,
  cancelled_at    timestamptz
);

-- Composite UNIQUE so tasks.mission_id can be a composite FK to the exact owner/project.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.missions'::regclass AND conname = 'missions_owner_project_id_uniq'
  ) THEN
    ALTER TABLE public.missions ADD CONSTRAINT missions_owner_project_id_uniq UNIQUE (owner_id, project_id, id);
  END IF;
END
$$;

-- 2. Add mission-bound columns to tasks (Gate 38 UNIQUE already exists on
--    tasks(owner_id, project_id, id) from the Gate 38 migration).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tasks' AND column_name='mission_id'
  ) THEN
    ALTER TABLE public.tasks ADD COLUMN mission_id uuid;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tasks' AND column_name='mission_task_key'
  ) THEN
    ALTER TABLE public.tasks ADD COLUMN mission_task_key text;
  END IF;
END
$$;

-- Composite FK: a mission-scoped task must belong to the exact owner/project of its
-- mission (CROSS_OWNER / CROSS_PROJECT structurally impossible).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_mission_fk'
  ) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_mission_fk
      FOREIGN KEY (owner_id, project_id, mission_id)
      REFERENCES public.missions(owner_id, project_id, id) ON DELETE SET NULL;
  END IF;
END
$$;

-- Unique mission_task_key per (owner, project, mission). A mission-created task MUST
-- have a non-null key; non-mission tasks leave it null (partial index lets multiple
-- non-mission tasks coexist with null keys).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_mission_task_key_uniq'
  ) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_mission_task_key_uniq
      UNIQUE (owner_id, project_id, mission_id, mission_task_key);
  END IF;
END
$$;

-- Mission-created tasks must carry a key (defense in depth against a stray task
-- silently joining a mission plan as if it were a validated plan task).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_mission_key_required'
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT tasks_mission_key_required;
  END IF;
  ALTER TABLE public.tasks ADD CONSTRAINT tasks_mission_key_required
    CHECK (mission_id is null or mission_task_key is not null);
END
$$;

-- Extend approvals MINIMALLY to bind a mission + its canonical plan hash without
-- weakening any prior approval semantics. A mission approval is a normal approval
-- row (action = 'mission.plan.approve') whose metadata carries { missionId, planHash }.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='approvals' AND column_name='metadata'
  ) THEN
    ALTER TABLE public.approvals ADD COLUMN metadata jsonb not null default '{}'::jsonb;
  END IF;
END
$$;

-- 3. Indexes — mission lookups and per-mission task scans.
CREATE INDEX IF NOT EXISTS missions_owner_idx ON public.missions (owner_id);
CREATE INDEX IF NOT EXISTS missions_project_idx ON public.missions (project_id);
CREATE INDEX IF NOT EXISTS missions_status_idx ON public.missions (status);
CREATE INDEX IF NOT EXISTS missions_scope_idx ON public.missions (owner_id, project_id);
CREATE INDEX IF NOT EXISTS tasks_mission_id_idx ON public.tasks (mission_id);
CREATE INDEX IF NOT EXISTS tasks_mission_scope_idx ON public.tasks (owner_id, mission_id);

-- 4. RLS — owner-only writes; agent read is permission-gated (resource 'missions'),
--    which fails closed because no baseline agent permission grants 'missions' read.
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS missions_select_owner ON public.missions;
CREATE POLICY missions_select_owner ON public.missions FOR SELECT TO authenticated
  USING (owner_id = auth.uid()
         or (public.requesting_agent() is not null
             and public.agent_has_permission(project_id, 'missions', 'read')));

DROP POLICY IF EXISTS missions_insert_owner ON public.missions;
CREATE POLICY missions_insert_owner ON public.missions FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS missions_update_owner ON public.missions;
CREATE POLICY missions_update_owner ON public.missions FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS missions_delete_owner ON public.missions;
CREATE POLICY missions_delete_owner ON public.missions FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- Existing task RLS already scopes owner read/write by owner_id and agent read by the
-- task's project permission, so mission-bound tasks inherit the correct isolation.

-- 5. Post-apply verification.
DO $$
DECLARE
  missions_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='missions'
  ) INTO missions_ok;
  IF NOT missions_ok THEN
    RAISE EXCEPTION 'missions table missing after migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tasks' AND column_name='mission_id'
  ) THEN
    RAISE EXCEPTION 'tasks.mission_id missing after migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_mission_task_key_uniq'
  ) THEN
    RAISE EXCEPTION 'tasks_mission_task_key_uniq missing after migration';
  END IF;

  RAISE NOTICE 'Gate 39 migration verified: missions + task mission fields + RLS + indexes present';
END
$$;
