# CHEF FACTORY — SECURITY (GATE 1 + GATE 2)

**Prompt:** PROMPT 2/5 — ARCHITECTURE + DATABASE FOUNDATION (+ PROMPT 4/5 — SECURITY GUARDIAN)
**Date:** 2026-08-15 / 2026-08-16

---

## 1. Principles Enforced

- Authentication (Supabase Auth) separated from Authorization (RLS + registries).
- Least privilege: agents access ONLY what `agent_permissions` grants.
- Project isolation at the database layer: Project A cannot reach Project B.
- Explicit DENY by default: unpermitted requests return empty/denied, never data.
- Audit is append-oriented and secret-free.
- No frontend-only authorization: every gate is database-enforced via RLS.
- **Gate 2:** DENY ALWAYS WINS; precedence LOCKDOWN > DENY > REQUIRE_APPROVAL > NOTIFY >
  ALLOW. The Security Guardian may only be MORE restrictive than Gate 1.
- **Gate 2:** LLM/untrusted output = DATA, never AUTHORITY. Fail closed. Owner-only
  lockdown release. Core registries immutable even for superuser.

## 2. RLS Model

- All 16 tables have Row Level Security ENABLED (61 policies).
- Owner access: `owner_id = auth.uid()` (project-scoped tables resolve through the
  projects owner). Owner can never read another owner's rows.
- Agent access: `request.agent_id` (session setting) must resolve to an ACTIVE agent
  with an ACTIVE permission grant matching resource + permission + project scope
  (`public.agent_has_permission`).
- Anon role: zero rows visible anywhere.
- Unknown/unauthorized authenticated users: zero rows visible.

## 3. Audit (append-only)

- `audit_events` has only INSERT and SELECT policies.
- Database triggers block UPDATE and DELETE even for superusers.
- Audit captures: actor_type/actor_id, action, project, environment, resource,
  authorization_result, correlation_id, task_id, metadata, created_at.

## 4. Secret Handling

- Secrets never stored in tables, audit, journal, memory, or logs.
- `SecretProvider` boundary implemented (`src/gateways/secretProvider.ts`); secrets are
  resolved at the boundary and never injected into prompts, logs, audit, decision
  journal, memory, or UI.
- Deterministic redaction `src/core/redact.ts` scrubs credential shapes (JWTs, Supabase
  `sbp_`/`sb_` tokens, OpenAI `sk-…` keys, `key=value` secret pairs) from commands, task
  metadata, decision context, and tool summaries.
- Local secrets live ONLY in `chef-factory/.env` (git-ignored).
- Service-role key was never stored; owner's PAT for CLI was revoked after use.

## 5. Access Control Layer (app-facing)

- `.env` holds `FACTORY_SUPABASE_URL` + `FACTORY_SUPABASE_ANON_KEY` for the client.
- Clients must use the anon key + real user/agent JWTs; RLS is the enforcement point.

## 6. Tests Proving Security

`supabase/tests/rls_tests.sql` (deterministic, PASS):

1. Owner reads own identity, cannot read another owner.
2. Owner sees all own projects; agent sees ONLY its granted project scope.
3. PROJECT ISOLATION: agent with Project A scope sees 0 rows of Project B.
4. Unauthorized access: anon and unknown authenticated users see 0 rows.
5. Audit append-only: UPDATE/DELETE blocked at RLS and trigger levels.
6. Preference versioning: only one ACTIVE version per key.
7. Required foreign keys / NOT NULL / CHECK constraints enforced.

## 7. Gate 2 — Security Guardian Tests

`src/core/security/securityGuardian.test.ts` — **41 tests PASS** (26 deterministic
topics + 10 adversarial scenarios + 4 persistence/parity): precedence, critical-action
deny defaults, risk classification, lockdown fail-closed, environment/cross-project
isolation, rate limits, cost stop, secret scanning + redaction, prompt-injection
directives (never authority), incident transitions, owner-only lockdown release.

`supabase/tests/rls_security_tests.sql` (deterministic, PASS, S1–S6):

1. Critical-action registry: 17 rows, 9 deny / 8 approval, UPDATE/DELETE/insert blocked.
2. Security events: owner isolation + append-only (RLS + trigger).
3. Lockdowns: owner scope, owner release, DELETE hard-blocked.
4. Incidents: owner-scoped CRUD + isolation.
5. Security policies: 13 rules present + enabled + read-only.
6. Rate limits: owner-scoped rows.

Live integration: `src/integration/security.live.integration.test.ts` (8 PASS) +
`src/integration/security.api.integration.test.ts` (1 PASS) — transactional, zero
residue. API surface: `/api/security/health|events|incidents|critical-actions|lockdown|
lockdown/release` (owner-authenticated, validated, audited).

---

**END OF SECURITY (GATE 1 + GATE 2).**
