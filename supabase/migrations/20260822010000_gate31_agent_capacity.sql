-- CHEF FACTORY — Gate 31: Agent Workload & Capacity Foundation
-- Adds max_concurrent_tasks to agents for capacity-aware placement.

-- Guard: verify agents table exists before altering
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'agents' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) THEN
    RAISE EXCEPTION 'agents table does not exist — Gate 31 migration blocked';
  END IF;
END
$$;

-- Add capacity column: integer, NOT NULL, DEFAULT 1, CHECK >= 0
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS max_concurrent_tasks integer NOT NULL DEFAULT 1
  CHECK (max_concurrent_tasks >= 0);

-- Verify column after application
DO $$
DECLARE
  col_type text;
  col_nullable text;
  col_default text;
  has_check boolean;
BEGIN
  SELECT data_type, is_nullable, column_default
    INTO col_type, col_nullable, col_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'agents' AND column_name = 'max_concurrent_tasks';

  IF col_type IS NULL THEN
    RAISE EXCEPTION 'max_concurrent_tasks column not found after migration';
  END IF;

  IF col_type != 'integer' THEN
    RAISE EXCEPTION 'max_concurrent_tasks type is %, expected integer', col_type;
  END IF;

  IF col_nullable != 'NO' THEN
    RAISE EXCEPTION 'max_concurrent_tasks is nullable, expected NOT NULL';
  END IF;

  IF col_default IS NULL OR col_default NOT LIKE '%1%' THEN
    RAISE EXCEPTION 'max_concurrent_tasks default is %, expected 1', col_default;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'agents'
      AND c.conname LIKE '%max_concurrent_tasks%'
      AND c.contype = 'c'
  ) INTO has_check;

  IF NOT has_check THEN
    RAISE EXCEPTION 'CHECK constraint on max_concurrent_tasks not found';
  END IF;

  RAISE NOTICE 'Gate 31 migration verified: type=% nullable=% default=% check=%', col_type, col_nullable, col_default, has_check;
END
$$;
