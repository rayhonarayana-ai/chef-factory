-- CHEF FACTORY — Gate 29 — Workforce Selection Foundation: Task Requirements.
--
-- Adds required_capabilities and preferred_role columns to the tasks table.
-- These columns support Agent selection (suitability matching) without
-- creating any new tables. Requirements belong to the Task domain.
--
-- MIGRATION_STATUS = CREATED (NOT APPLIED)
-- REQUIRES: Development Lead authorization before application.
-- ZERO_REGRESSION: columns have safe defaults; existing code unaffected.

-- 1. Add required_capabilities column (JSONB array of capability strings).
--    Default: [] (empty array = no capability requirements).
--    NOT NULL: TaskRecord defines requiredCapabilities as string[], not string[] | null.
--    SELECT capabilities are suitability metadata only; they do NOT grant permissions.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS required_capabilities jsonb DEFAULT '[]'::jsonb;

-- 2. Add preferred_role column (text, nullable).
--    Default: NULL (no role preference).
--    Role preference improves selection ranking but does NOT affect eligibility.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS preferred_role text DEFAULT NULL;

-- 3. Backfill existing rows with explicit defaults.
--    Ensures consistency even if future queries rely on non-null values.
UPDATE public.tasks
  SET required_capabilities = '[]'::jsonb
  WHERE required_capabilities IS NULL;

-- 4. Enforce NOT NULL after backfill.
--    Step 1 adds column with DEFAULT (nullable). Step 3 ensures no NULLs remain.
--    Step 4 locks the invariant: required_capabilities is never NULL.
ALTER TABLE public.tasks
  ALTER COLUMN required_capabilities SET NOT NULL;
