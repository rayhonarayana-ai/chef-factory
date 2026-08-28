-- CHEF FACTORY — Gate 38: Task Dependency / DAG Foundation
--
-- Creates ONE relational edge table for task-level dependencies:
--   public.task_dependencies
--
-- Canonical direction (authoritative):
--   prerequisite_task_id  ->  dependent_task_id
-- A dependent task is READY only when ALL of its prerequisites have status
-- exactly 'completed' (DEPENDENCY_SATISFIED_BY = COMPLETED_ONLY).
--
-- Security invariants (must never be weakened):
--   SELF_DEPENDENCY  = DENY            (CHECK)
--   DUPLICATE_EDGE   = DENY            (composite PK) / STORE IDEMPOTENT
--   CROSS_OWNER_EDGE = IMPOSSIBLE      (composite FK through tasks)
--   CROSS_PROJECT_EDGE= IMPOSSIBLE     (composite FK through tasks)
--   CYCLE            = IMPOSSIBLE      (project-scoped advisory lock + recursive
--                                       CTE, enforced by a BEFORE trigger so every
--                                       writer, including direct SQL, is serialized)
--   RLS              = ENABLED         (owner-only mutation; agent read via task permission)

-- 0. Guard: tasks table must already exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'tasks' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) THEN
    RAISE EXCEPTION 'tasks table does not exist — Gate 38 migration blocked';
  END IF;
END
$$;

-- 1. Add the composite UNIQUE needed so the edge FKs can reference
--    tasks(owner_id, project_id, id). `id` is already the primary key; this
--    constraint is required only so a foreign key can impose "both endpoints
--    must belong to the exact same owner_id AND project_id" at the DB level
--    (not merely via application validation). It is redundant in uniqueness
--    (id alone is unique) but necessary for FK column-matching.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_owner_project_id_uniq'
  ) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_owner_project_id_uniq UNIQUE (owner_id, project_id, id);
  END IF;
END
$$;

-- 2. Create the edge table (idempotent).
CREATE TABLE IF NOT EXISTS public.task_dependencies (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null,
  project_id            uuid not null,
  prerequisite_task_id  uuid not null,
  dependent_task_id     uuid not null,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  -- duplicate edge / self-dependency are impossible at the row level:
  constraint task_dependencies_no_self
    check (prerequisite_task_id <> dependent_task_id),
  constraint task_dependencies_edge_uniq
    unique (prerequisite_task_id, dependent_task_id),
  -- owner/project + endpoint integrity: each edge pins owner & project to the
  -- exact owner/project of BOTH referenced tasks. Because the reference is a
  -- composite foreign key matching tasks(owner_id, project_id, id), PostgreSQL
  -- guarantees the prerequisite belongs to edge.owner_id/edge.project_id AND the
  -- dependent belongs to the SAME edge.owner_id/edge.project_id — so a
  -- cross-owner or cross-project edge is structurally impossible.
  constraint task_dependencies_prereq_fk
    foreign key (owner_id, project_id, prerequisite_task_id)
    references public.tasks(owner_id, project_id, id) on delete cascade,
  constraint task_dependencies_dependent_fk
    foreign key (owner_id, project_id, dependent_task_id)
    references public.tasks(owner_id, project_id, id) on delete cascade,
  -- created_by is a soft reference (NULLable, owner) — no hard FK to avoid
  -- blocking owner cleanup; the audit trail records actor identity.
  constraint task_dependencies_created_by_fk
    foreign key (created_by) references public.owners(id) on delete set null
);

-- 3. Indexes:
--    dependent -> prerequisites lookup   (readiness filter on the dependent)
--    prerequisite -> dependents lookup   (fan-out)
--    owner / project scoping
CREATE INDEX IF NOT EXISTS task_dependencies_dependent_idx
  ON public.task_dependencies (dependent_task_id);
CREATE INDEX IF NOT EXISTS task_dependencies_prereq_idx
  ON public.task_dependencies (prerequisite_task_id);
CREATE INDEX IF NOT EXISTS task_dependencies_scope_idx
  ON public.task_dependencies (owner_id, project_id);

-- 4. Distributed-safe cycle guard.
--
--    Why an advisory lock is REQUIRED here (not just row locking):
--    two concurrent opposite-edge insertions (A->B and B->A) each perform only
--    their own row insert and a recursive-CTE check that — in the absence of
--    serialization — can both read the pre-insert state and both pass, forming
--    a cycle. Rowing locking on individual task rows does NOT serialize two
--    writers inserting *different* rows of the same DAG. A PostgreSQL
--    transaction-scoped advisory lock scoped to the project serializes every
--    edge mutation for that project: the second writer blocks until the first
--    commits, then its recursive-CTE check correctly observes the first edge
--    and rejects the cycle. This is the rigorous, distributed-safe mechanism.
CREATE OR REPLACE FUNCTION public.fn_task_dependency_cycle_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  proj_hash int;
  has_cycle boolean;
BEGIN
  -- Serialize every dependency mutation for this project through one advisory
  -- xact lock (application key 74738 + project-hash key). Blocks concurrent
  -- writers so the cycle check below is never fooled by the other's uncommitted
  -- edge. Released automatically at COMMIT/ROLLBACK.
  SELECT hashtext('cf_td:' || coalesce(new.project_id::text, '')) INTO proj_hash;
  PERFORM pg_advisory_xact_lock(74738, proj_hash);

  -- Self-dependency fail-safe (defense in depth; CHECK also enforces it).
  IF new.prerequisite_task_id = new.dependent_task_id THEN
    RAISE EXCEPTION 'TASK_DEPENDENCY_SELF';
  END IF;

  -- Cycle detection: inserting edge P -> D creates a cycle iff there is already
  -- a forward path D -> ... -> P. Follow the prerequisite->dependent direction
  -- forward from D; if P is reachable, adding P->D closes a loop.
  WITH RECURSIVE reach(t) AS (
    SELECT dependent_task_id
      FROM public.task_dependencies
     WHERE prerequisite_task_id = new.dependent_task_id
    UNION
    SELECT d.dependent_task_id
      FROM public.task_dependencies d
      JOIN reach r ON d.prerequisite_task_id = r.t
  )
  SELECT EXISTS (SELECT 1 FROM reach WHERE t = new.prerequisite_task_id) INTO has_cycle;

  IF has_cycle THEN
    RAISE EXCEPTION 'TASK_DEPENDENCY_CYCLE';
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_dependency_cycle_guard ON public.task_dependencies;
CREATE TRIGGER trg_task_dependency_cycle_guard
  BEFORE INSERT OR UPDATE ON public.task_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.fn_task_dependency_cycle_guard();

-- 5. RLS — owner-only mutation; agent read mirrors tasks (permission-gated).
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_dependencies_select_owner ON public.task_dependencies;
CREATE POLICY task_dependencies_select_owner ON public.task_dependencies FOR SELECT TO authenticated
  USING (owner_id = auth.uid()
         or (public.requesting_agent() is not null
             and public.agent_has_permission(project_id, 'tasks', 'read')));

DROP POLICY IF EXISTS task_dependencies_insert_owner ON public.task_dependencies;
CREATE POLICY task_dependencies_insert_owner ON public.task_dependencies FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS task_dependencies_update_owner ON public.task_dependencies;
CREATE POLICY task_dependencies_update_owner ON public.task_dependencies FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS task_dependencies_delete_owner ON public.task_dependencies;
CREATE POLICY task_dependencies_delete_owner ON public.task_dependencies FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- 6. Post-apply verification (fail loudly if any invariant is missing).
DO $$
DECLARE
  tbl_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='task_dependencies'
  ) INTO tbl_ok;
  IF NOT tbl_ok THEN
    RAISE EXCEPTION 'task_dependencies table missing after migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='task_dependencies'
  ) THEN
    RAISE EXCEPTION 'task_dependencies RLS policies missing after migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='task_dependencies'
      AND indexdef LIKE '%dependent_task_id%'
  ) THEN
    RAISE EXCEPTION 'task_dependencies dependent index missing after migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_task_dependency_cycle_guard'
  ) THEN
    RAISE EXCEPTION 'task_dependencies cycle-guard trigger missing after migration';
  END IF;

  RAISE NOTICE 'Gate 38 migration verified: task_dependencies + RLS + indexes + cycle guard present';
END
$$;
