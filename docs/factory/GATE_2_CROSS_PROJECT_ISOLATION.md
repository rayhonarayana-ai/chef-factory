# CHEF FACTORY — GATE 2 — CROSS-PROJECT ISOLATION

**Component:** Project-scope enforcement
**Status:** IMPLEMENTED / TESTED

## Purpose
An agent scoped to one project accessing another project is cross-project access —
DENIED by default. This mirrors and strengthens the Gate 1 database-level isolation at
the application boundary.

## Rule
`detectCrossProject(projectId, requestedProjectId, actorType)`:
- Owner → never crossed.
- Agent → crossed when `requestedProjectId` differs from the scoped `projectId`.
  `undefined`/`null`/same → not crossed.

## Guardian integration
Cross-project → `denied.cross_project` (high) event + `deny` decision
(`rule.cross_project`). Repeated switches emit `anomaly.project_switching` after the
threshold.

## Layer-2 confirmation (database)
Even if the application layer were bypassed, `public.agent_permissions` + RLS grant an
agent visibility only for its granted project scope — Project B rows are invisible to a
Project A agent (`rls_tests.sql` TEST 3).

## Tests
- `src/core/security/securityGuardian.test.ts` — cross-project detection + owner
  exemption.
- `supabase/tests/rls_tests.sql` TEST 3 — database-level project isolation.

---
**END OF GATE 2 CROSS-PROJECT ISOLATION.**
