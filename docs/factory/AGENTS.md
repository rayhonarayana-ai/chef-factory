# CHEF FACTORY — AGENTS (Gate 1 Core)

**Component:** Agent Registry + Permissions + Stats
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED (schema)

## Purpose
Registered agent identities with least-privilege permission grants. Agents are
scoped by project and resource type; no agent may impersonate the owner.

## Contracts
- `Store.listAgents(ownerId)` — own agents only.
- `Store.agentHasPermission(agentId, projectId, resourceType, permission)` — true only
  when an explicit grant exists in `agent_permissions`.
- `Store.agentStats(agentId)` — `{ successRate, historyCount }` derived from task runs
  (used by the Autonomy Controller; never fabricated).

## Boundaries (Gate 1 rules)
- Permission check happens **before** any tool/task execution (authorization before
  execution).
- Project isolation is enforced in SQL (RLS) and mirrored at the application layer
  (`live.integration.test.ts` "project isolation" case).
- No agent-scoped reads of another owner's rows (RLS TEST 3).

## Gate 2 security additions
- The Security Guardian evaluates agent requests BEFORE execution (optional hook in
  `pipeline.ts` + `toolBroker.ts`); deny/lockdown cancels the task and writes
  `security.guardian_denied` audit.
- Environment escalation beyond the agent's granted environments → DENY
  (`rule.environment_escalation`).
- Cross-project access outside the agent's scoped project → DENY
  (`rule.cross_project`).
- Agents can never activate or release a lockdown (`canReleaseLockdown` requires
  `actorType === 'owner'`).
- Agents cannot modify their own critical-action classification (immutable registry).

## Schema (Supabase)
- `public.agents` (owner-scoped, `on delete cascade`)
- `public.agent_permissions` (agent_id + project_id FKs, `granted_by` owner)
- Policies: owner-scoped select; agent-scoped select via `request.agent_id`.

## Tests
- `src/gateways/toolBroker.test.ts` — ToolBroker enforces permission before execution.
- `src/integration/live.integration.test.ts` — "project isolation" case: another owner
  sees nothing.
- `supabase/tests/rls_tests.sql` TEST 3 — agent sees exactly its granted project.
- `src/core/security/securityGuardian.test.ts` — environment escalation + cross-project
  deny for agents; owner exemptions.
