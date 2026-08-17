-- ============================================================
-- CHEF FACTORY — GATE 2 — SECURITY HARDENING: TRUNCATE GUARD
-- Migration: 20260818000000_security_truncate_hardening.sql
-- Fix:       TRUNCATE bypasses RLS and never fires FOR EACH ROW
--            triggers. Supabase default grants give anon/authenticated
--            the TRIGGER privilege (=> TRUNCATE) on every table, so an
--            authenticated client could wipe append-only/history/registry
--            tables (security_events, critical_actions, security_lockdowns,
--            security_incidents, security_rate_limits, security_policies,
--            audit_events).
-- Defense:   1) BEFORE TRUNCATE ... FOR EACH STATEMENT triggers reuse the
--               existing SECURITY DEFINER block functions (raise on any op).
--            2) REVOKE TRUNCATE/TRIGGER from anon + authenticated on the
--               protected tables (defense-in-depth at the privilege layer).
-- ============================================================

-- ---------- 1. generic truncate guard for owner-mutable security tables ----------
create or replace function public.block_security_table_truncate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'security table truncation is blocked';
end;
$$;

-- ---------- 2. BEFORE TRUNCATE statement triggers ----------
create trigger security_events_no_truncate
  before truncate on public.security_events
  for each statement execute function public.block_security_event_mutation();

create trigger critical_actions_no_truncate
  before truncate on public.critical_actions
  for each statement execute function public.block_critical_action_mutation();

create trigger security_lockdowns_no_truncate
  before truncate on public.security_lockdowns
  for each statement execute function public.block_lockdown_deletion();

create trigger security_incidents_no_truncate
  before truncate on public.security_incidents
  for each statement execute function public.block_security_table_truncate();

create trigger security_rate_limits_no_truncate
  before truncate on public.security_rate_limits
  for each statement execute function public.block_security_table_truncate();

create trigger security_policies_no_truncate
  before truncate on public.security_policies
  for each statement execute function public.block_security_table_truncate();

create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function public.block_audit_mutation();

-- ---------- 3. privilege-layer defense-in-depth ----------
revoke truncate, trigger on public.security_events from anon, authenticated;
revoke truncate, trigger on public.critical_actions from anon, authenticated;
revoke truncate, trigger on public.security_lockdowns from anon, authenticated;
revoke truncate, trigger on public.security_incidents from anon, authenticated;
revoke truncate, trigger on public.security_rate_limits from anon, authenticated;
revoke truncate, trigger on public.security_policies from anon, authenticated;
revoke truncate, trigger on public.audit_events from anon, authenticated;

-- ============================================================
-- END OF MIGRATION 20260818000000_security_truncate_hardening.sql
-- ============================================================
