# CHEF FACTORY — GATE 2 — POLICY ENGINE

**Component:** Deterministic security decision chain
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED (policy parity)

## Purpose
Resolve every security request to exactly one decision using immutable precedence.
The Security Guardian may only be MORE restrictive than Gate 1.

## Precedence
`LOCKDOWN (5) > DENY (4) > REQUIRE_APPROVAL (3) > NOTIFY (2) > ALLOW (1)`

`moreRestrictive(a, b)` returns the more restrictive decision (not a boolean).
`guardianCombineAuthority(authority, security)` never returns a decision less
restrictive than the Gate 1 authority outcome.

## Decision Chain (`evaluatePolicy`, in order)
1. **Lockdown active** → `lockdown` (fail closed).
2. **Critical action default DENY** → `deny`.
3. **Environment escalation** → `deny`.
4. **Cross-project access** → `deny`.
5. **Rate limit exhausted** → `deny`.
6. **Cost hard limit** → `deny`.
7. **Critical action require_approval** → `require_approval`.
8. **Production write/execute** → `require_approval` (policy floor).
9. **Staging write/execute** → `notify`.
10. **Not authorized** → `deny` (least privilege).
11. **Explicit owner DENY** → `deny`.
12. **Default** → `allow` (Gate 1 authority remains the floor).

## Environment Isolation
`detectEnvironmentEscalation(environment, grantedEnvironments, actorType)` — an agent
holding only lower environments that requests a higher one is DENIED. Owners are not
escalated.

## Cross-Project Isolation
`detectCrossProject(projectId, requestedProjectId, actorType)` — an agent whose scoped
project differs from the requested project is DENIED by default. Owners are not blocked.

## Registry Parity (13 rules)
`security_policies` documents the chain:
`rule.lockdown_active`, `rule.critical.deny`, `rule.environment_escalation`,
`rule.cross_project`, `rule.rate_limit`, `rule.cost_stopped`,
`rule.critical.require_approval`, `rule.production.write_execute`,
`rule.staging.notify`, `rule.not_authorized`, `rule.explicit_deny`,
`rule.default.allow`, `rule.untrusted_directive`.

## Tests
- `src/core/security/securityGuardian.test.ts` — precedence, escalation, cross-project,
  combination (never less restrictive).
- `supabase/tests/rls_security_tests.sql` TEST S5 — all 13 policy rules present + enabled.

---
**END OF GATE 2 POLICY ENGINE.**
