# CHEF FACTORY — GATE 2 — CRITICAL ACTION REGISTRY

**Component:** Immutable core registry of protected actions
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED (17 rows live)

## Purpose
Centralized, versioned classification of protected actions. Agents can never modify
their own critical-action classification. Core rules are immutable in the database —
even for superuser sessions (DB trigger hard-blocks UPDATE and DELETE).

## Registry (version 1 — 17 core rules)

| action | classification | default decision |
|---|---|---|
| production_modification | production | require_approval |
| production_deletion | production | deny |
| database_destructive | destructive | deny |
| secret_access | secret | require_approval |
| secret_rotation | secret | require_approval |
| permission_escalation | permission | deny |
| security_policy_modification | policy | require_approval |
| disable_audit | audit | deny |
| disable_rls | audit | deny |
| owner_identity_change | identity | require_approval |
| authority_rule_change | authority | require_approval |
| autonomy_rule_change | authority | require_approval |
| financial_transaction | financial | deny |
| legal_commitment | contractual | deny |
| external_irreversible | external_irreversible | require_approval |
| factory_shutdown | factory | deny |
| lockdown_release | factory | deny |

9 deny-by-default · 8 require_approval-by-default. Covers the contract §7 minimum
(delete, deploy, financial, legal, secret, permission changes, audit/Rls controls,
shutdown, lockdown release).

## API
- `classifyCriticalAction(action, environment)` → first matching rule or null.
- `isProtectedCriticalAction(action)` → true if the action is in the registry.

## Database
- `public.critical_actions` — `default_decision` CHECK (`deny` | `require_approval`);
  classification CHECK (12 allowed values); `is_core` true for all seeds.
- Triggers `critical_actions_no_update` / `critical_actions_no_delete` block mutation.
- RLS: readable by all authenticated (registry is public-read, never write).

## Tests
- `src/core/security/securityGuardian.test.ts` — registry contents + deny defaults.
- `supabase/tests/rls_security_tests.sql` TEST S1 — 17 rows, 9 deny / 8 approval,
  UPDATE/DELETE/insert-with-invalid-decision all blocked; owner can read.

---
**END OF GATE 2 CRITICAL ACTION REGISTRY.**
