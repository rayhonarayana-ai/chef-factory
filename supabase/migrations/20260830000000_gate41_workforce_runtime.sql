-- CHEF FACTORY — Gate 41: 24/7 Autonomous Workforce Runtime
--
-- Object 1: workforce_control — the durable GLOBAL EMERGENCY STOP primitive.
--
-- The Development Lead REJECTED the sentinel-owner workaround (representing the
-- system/factory as a fake owner in security_lockdowns). Gate 41 therefore adds a
-- tiny explicit singleton system control row that means "is the global Workforce
-- permitted to schedule NEW work?", with an explicit system/workforce meaning.
--
-- Semantics:
--   singleton_key   = 'global' (fixed, ONE singleton row).
--   globally_enabled= true  -> workforce MAY schedule new work.
--                     false -> GLOBAL EMERGENCY STOP: no NEW work across ALL owners.
--   reason          = why the stop was raised (auditable, required when disabling).
--   updated_by      = the authorized system/administrative identity that changed it.
--   updated_at      = last change time.
--
-- Authorization boundary (enforced at the application layer):
--   * ONLY authorized human/system administrative control may set globally_enabled
--     to false or back to true.
--   * AGENTS cannot change it (no agent permission grants this resource).
--   * The WORKFORCE SERVICE cannot disable it — the worker runtime reads it
--     (isGlobalStopActive) but NEVER calls the write path. This is proven by tests.
--   * Mission Engine / Specialist roles cannot change it.
--
-- FAIL-CLOSED behavior (application + this migration):
--   * Worker treats a MISSING row as STOPPED (fail closed).
--   * Worker treats a read/DB failure as STOPPED (fail closed).
--   * The singleton row is seeded TRUE so the first migration apply enables the
--     workforce; any deletion is blocked by the no-delete trigger below.
--
-- Object 2: mission spend is derived through the EXISTING cost_events + tasks join
-- by mission_id; NO new cost columns are added (see Gate 41 mission-budget notes).
--
-- No workforce/queue/delegation tables, no LISTEN/NOTIFY, no new permission model.

-- 0. Guard: tasks table must already exist (precondition for the whole runtime).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'tasks' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) THEN
    RAISE EXCEPTION 'tasks table does not exist — Gate 41 migration blocked';
  END IF;
END
$$;

-- 1. workforce_control (idempotent).
CREATE TABLE IF NOT EXISTS public.workforce_control (
  singleton_key    text primary key check (singleton_key = 'global'),
  globally_enabled boolean not null default true,
  reason           text not null default '',
  updated_by       text not null default 'system',
  updated_at       timestamptz not null default now(),
  constraint workforce_control_globally_enabled_check check (globally_enabled in (true, false))
);

-- 2. Seed the singleton row as ENABLED (idempotent). A removed row means STOPPED
--    (fail closed), so restoring it is an explicit re-enable by an administrator.
INSERT INTO public.workforce_control (singleton_key, globally_enabled, reason, updated_by, updated_at)
VALUES ('global', true, 'initial state — global workforce enabled', 'system', now())
ON CONFLICT (singleton_key) DO NOTHING;

-- 3. The singleton row is history/anchor: it may be UPDATED by authorized control
--    but never DELETED (removal must not silently flip state or allow accidental loss).
CREATE OR REPLACE FUNCTION public.block_workforce_control_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'workforce_control singleton row cannot be deleted';
END;
$$;

DROP TRIGGER IF EXISTS workforce_control_no_delete ON public.workforce_control;
CREATE TRIGGER workforce_control_no_delete
  BEFORE DELETE ON public.workforce_control
  FOR EACH ROW EXECUTE FUNCTION public.block_workforce_control_deletion();

-- 4. RLS — this is a SYSTEM control, not an owner resource.
--    Owner/agent (authenticated) clients may READ it (to observe global state) but
--    never WRITE it. Writes go through the Factory Core (service-role/postgres pool)
--    only from the explicit authorized administrative path. This keeps agents from
--    ever toggling the stop via the client surface.
ALTER TABLE public.workforce_control ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workforce_control_select ON public.workforce_control;
CREATE POLICY workforce_control_select ON public.workforce_control
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS workforce_control_no_write ON public.workforce_control;
CREATE POLICY workforce_control_no_write ON public.workforce_control
  FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS workforce_control_no_update ON public.workforce_control;
CREATE POLICY workforce_control_no_update ON public.workforce_control
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS workforce_control_no_delete ON public.workforce_control;
CREATE POLICY workforce_control_no_delete ON public.workforce_control
  FOR DELETE TO authenticated USING (false);

-- 5. Post-apply verification.
DO $$
DECLARE
  row_count int;
  seeded_ok boolean;
BEGIN
  SELECT count(*) INTO row_count FROM public.workforce_control WHERE singleton_key = 'global';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'workforce_control singleton row missing after migration';
  END IF;

  SELECT globally_enabled INTO seeded_ok FROM public.workforce_control WHERE singleton_key = 'global';
  IF seeded_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'workforce_control singleton must seed as globally_enabled = true';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'workforce_control_no_delete'
  ) THEN
    RAISE EXCEPTION 'workforce_control_no_delete trigger missing after migration';
  END IF;

  RAISE NOTICE 'Gate 41 migration verified: workforce_control singleton + RLS + no-delete trigger present';
END
$$;
