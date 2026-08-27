-- CHEF FACTORY — Gate 37: Deterministic Workforce Orchestration
-- Adds ONE discovery index for the schedulable-task scan used by runWorkforce.
-- DISCOVERY ONLY — no new tables, no new columns, no new permission model.
-- No workforce/mission/delegation/queue tables are created.

-- Guard: verify tasks table exists before creating the index.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'tasks' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) THEN
    RAISE EXCEPTION 'tasks table does not exist — Gate 37 migration blocked';
  END IF;
END
$$;

-- Schedulable-task discovery index. Predicate:
--   owner_id = $1 [AND project_id = $2] AND agent_id IS NULL AND status = 'queued'
--   AND attempts < coalesce(max_attempts, 3) ORDER BY created_at ASC, id ASC
-- Composite covers the multi-column equality filter and the deterministic
-- created_at/id ordering. Only created when absent (idempotent).
CREATE INDEX IF NOT EXISTS tasks_schedulable_discovery_idx
  ON public.tasks (owner_id, project_id, agent_id, status, created_at);

-- Verify the index exists after application.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'tasks' AND indexname = 'tasks_schedulable_discovery_idx'
  ) THEN
    RAISE EXCEPTION 'tasks_schedulable_discovery_idx not found after migration';
  END IF;
  RAISE NOTICE 'Gate 37 migration verified: tasks_schedulable_discovery_idx present';
END
$$;
