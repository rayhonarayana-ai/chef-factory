-- CHEF FACTORY — Gate 27 — Tenant-Assignment Integrity Migration.
--
-- Adds composite foreign key (owner_id, agent_id) → agents(owner_id, id)
-- to enforce that a Task may reference an Agent ONLY when both belong
-- to the same owner. Prevents cross-tenant assignment at the DB level.
--
-- Pre-migration: EXISTING_INVALID_ASSIGNMENT_COUNT = 0 (verified)
-- PostgreSQL 15+ required for ON DELETE SET NULL (column_list).
-- Actual DB version: PostgreSQL 17.6 (compatible).

-- 1. Add UNIQUE constraint on agents(owner_id, id) — required FK target.
--    This is a covering unique constraint (id is already PK, so this is
--    logically redundant but structurally required for composite FK).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'agents_owner_id_uniq' AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.agents
      ADD CONSTRAINT agents_owner_id_uniq
      UNIQUE (owner_id, id);
  END IF;
END $$;

-- 2. Drop the old ID-only FK constraint.
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_agent_id_fkey;

-- 3. Add composite FK: tasks(owner_id, agent_id) → agents(owner_id, id).
--    ON DELETE SET NULL (agent_id): deleting an agent nullifies task.agent_id
--    only — task.owner_id is preserved (NOT NULL).
--    ON UPDATE NO ACTION: agent owner_id changes are not expected.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_tenant_agent_fk' AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_tenant_agent_fk
      FOREIGN KEY (owner_id, agent_id)
      REFERENCES public.agents(owner_id, id)
      ON DELETE SET NULL (agent_id)
      ON UPDATE NO ACTION;
  END IF;
END $$;

-- 4. Add composite index for FK performance and tenant-aware query patterns.
--    NOTE: tasks_agent_id_idx is KEPT (not dropped) because
--    SupabaseStore.agentStats() queries tasks WHERE agent_id = $1
--    without owner_id (production hot path via pipeline.ts).
CREATE INDEX IF NOT EXISTS tasks_owner_agent_idx
  ON public.tasks(owner_id, agent_id);
