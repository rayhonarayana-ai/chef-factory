# CHEF FACTORY — ARCHITECTURE (GATE 1 + GATE 2)

**Prompt:** PROMPT 3/5 — CHEF PERSONAL EXECUTIVE CORE IMPLEMENTATION + PROMPT 4/5 — SECURITY GUARDIAN
**Date:** 2026-08-16
**Status:** GATE 1 CORE + GATE 2 SECURITY GUARDIAN — IMPLEMENTED + TESTED + LIVE_VERIFIED
**Governing documents:** CHEF_FACTORY_MASTER_REFERENCE_FINAL.md · GATE_1_EXECUTION_CONTRACT_FINAL.md

---

## 1. Scope Delivered

The CHEF Personal Executive Core — the deterministic foundation for Owner Identity,
Project management, Agents, Tasks, Models, Runtimes, Approvals, Audit, Cost, the
Personal Operating System, the Decision Journal, and Autonomy Records — restricted to
**Gate 1** boundaries. **Gate 2** added the deterministic Security Guardian (policy
engine, risk engine, critical-action registry, lockdown, rate limiting, cost
protection, anomaly signals, secret/injection protection, security events, incidents,
health, RLS-backed storage, API endpoints). No future-Gate capability was implemented
(no Growth Engine, no deployment).

## 2. Components

### Foundation (database) — all IMPLEMENTED + TESTED + LIVE_VERIFIED
| Layer | Status |
|---|---|
| Owner Identity (Supabase Auth + `owners`) | IMPLEMENTED + LIVE_VERIFIED |
| Project Registry + Project Passport | IMPLEMENTED + LIVE_VERIFIED |
| Agent Registry + Agent Permissions (least privilege) | IMPLEMENTED + LIVE_VERIFIED |
| Task Engine + Task Runs (lifecycle, retry limits) | IMPLEMENTED + LIVE_VERIFIED |
| Model Registry + Runtime Registry (model/runtime agnostic) | IMPLEMENTED + LIVE_VERIFIED |
| Approval Engine | IMPLEMENTED + LIVE_VERIFIED |
| Audit Service (append-only, secret-free) | IMPLEMENTED + LIVE_VERIFIED |
| Cost Tracking (+ basic limits) | IMPLEMENTED + LIVE_VERIFIED |
| Personal Operating System (versioned preferences) | IMPLEMENTED + LIVE_VERIFIED |
| Decision Journal + Autonomy Records | IMPLEMENTED + LIVE_VERIFIED |
| RLS authorization (database-enforced) | IMPLEMENTED + TESTED + LIVE_VERIFIED |
| Security Guardian (Gate 2) | IMPLEMENTED + TESTED + LIVE_VERIFIED |
| Critical Action Registry (17 immutable rules) | IMPLEMENTED + TESTED + LIVE_VERIFIED |
| Lockdown + Rate Limits + Cost Protection + Anomaly | IMPLEMENTED + TESTED + LIVE_VERIFIED |
| Secret Guard + Prompt Injection defense | IMPLEMENTED + TESTED |
| Security Events + Incidents + Health | IMPLEMENTED + TESTED + LIVE_VERIFIED |
| Security RLS (6 tables) + append-only triggers | IMPLEMENTED + TESTED + LIVE_VERIFIED |

### Executive Core (TypeScript) — all IMPLEMENTED + TESTED
| Layer | Module | Status |
|---|---|---|
| Command / Intent parsing (never fabricates certainty) | `src/core/intent.ts` | TESTED |
| Authority Matrix (AUTO/NOTIFY/REQUIRE_APPROVAL/DENY; DENY wins) | `src/core/authority.ts` | TESTED |
| Adaptive Autonomy Controller (bounded escalation) | `src/core/autonomy.ts` | TESTED |
| Approval engine | `src/core/approval.ts` | TESTED |
| Task engine (transitions + retry cap) | `src/core/taskEngine.ts` | TESTED |
| Personal Operating System (versioned, non-overridable) | `src/core/pos.ts` | TESTED |
| Decision Journal | `src/core/decisionJournal.ts` | TESTED |
| Explanation Layer (Decision/Why/Evidence/Confidence/Risk) | `src/core/explanation.ts` | TESTED |
| Proactive Monitoring + Daily Status | `src/core/monitoring.ts` | TESTED |
| CommandPipeline (orchestrates the whole flow) | `src/core/pipeline.ts` | TESTED |
| ModelGateway + ProviderAdapters (model-agnostic) | `src/gateways/modelGateway.ts` | TESTED |
| RuntimeGateway + RuntimeAdapters (runtime-agnostic) | `src/gateways/runtimeGateway.ts` | TESTED |
| ToolBroker (boundary: authority→project→env→risk→approval→audit) | `src/gateways/toolBroker.ts` | TESTED |
| SecretProvider (secrets never reach prompts/logs/audit/UI) | `src/gateways/secretProvider.ts` | TESTED |
| Memory Gateway (boundary; vector backend absent → deterministic empty recall) | `src/gateways/memoryGateway.ts` | TESTED |
| Secret redaction (JWT/Supabase/OpenAI/key=value patterns) | `src/core/redact.ts` | TESTED |
| Security Guardian (deterministic boundary; lockdown/critical/risk/policy/rate/cost/injection) | `src/core/security/*` | TESTED |
| Secret Guard (shape scanning + deep value scan) | `src/core/security/secretGuard.ts` | TESTED |
| Prompt Injection defense (untrusted input = DATA, never authority) | `src/core/security/promptInjection.ts` | TESTED |
| Fail-closed hooks (toolBroker.securityGuard, runtimeGateway.environmentGuard, pipeline securityGuardian) | `src/gateways/toolBroker.ts` · `runtimeGateway.ts` · `src/core/pipeline.ts` | TESTED |
| Control Plane HTTP API (chat, projects, passports, agents, tasks, approvals, costs, audit, status, prefs, models, runtimes, decisions, security/health/events/incidents/lockdown/critical-actions) | `src/api/server.ts` | IMPLEMENTED |

## 3. Architecture Decisions Applied

1. **Authentication vs Authorization separated.** Auth = Supabase Auth (`auth.users`).
   Authorization = RLS + `owners` + `agent_permissions`. No agent can impersonate the
   owner.
2. **Project isolation enforced at the database** and mirrored at the application layer.
3. **Least privilege for agents** via `agent_permissions`.
4. **Append-only audit** (RLS + trigger hard-block).
5. **Versioned preferences** (partial unique index, one ACTIVE version per key).
6. **Retry limits** — `tasks.max_attempts` default 3; retry path runs through
   `handleTaskFailure` (`running → queued`), never exceeding the cap.
7. **Cost first** — cheapest capable model selected; `costForTokens` clamps negatives;
   rollups never invent numbers.
8. **Model/runtime agnostic** — providers/runtimes are adapters behind gateways, never
   the architectural core.
9. **Explicit DENY always wins**; `PROTECTED_ACTION_TYPES` (delete, deploy, financial,
   legal, account_security, credit) always require approval.
10. **Never fabricate certainty** — ambiguity resolves to `UNKNOWN`, not invention.
11. **Secrets never leak** — `SecretProvider` + deterministic `redactText` applied to
    commands, task metadata, decision context, and tool summaries.
12. **Gate 2 — DENY ALWAYS WINS; LOCKDOWN > DENY > REQUIRE_APPROVAL > NOTIFY > ALLOW.**
    The Guardian may only be MORE restrictive than Gate 1.
13. **LLM output = DATA, never AUTHORITY** — untrusted directives are recorded, never
    executed.
14. **Fail closed** — active lockdown halts everything; health never reports healthy
    when a critical control is down.
15. **Immutability** — critical-action registry, security events, and lockdown history
    are hard-blocked from mutation in the database even for superuser.
16. **Owner-only lockdown release** — agents can never activate or release a lockdown.

## 4. Lifecycle Mapping

```
OWNER → (Auth) → owners row → project → environment →
Intent parsing → Authority Matrix → Autonomy Controller →
Security Guardian (Gate 2: lockdown/critical/risk/policy/rate/cost/injection) →
approval (if required) → ToolBroker → Model/Runtime Gateway → execution →
task_runs → audit_events → cost_events → decision_journal / autonomy_records
         ↘ security_events → security_incidents (append-only, owner-scoped)
```

## 5. Current Implementation Notes

- Factory DB: **CHEF FACTORY DB** (`dybyidtcyzgliupzzfhl`, eu-west-1) — independent.
- Migrations: `20260815220000_factory_init.sql` + `20260816000000_core_additions.sql`
  + `20260817000000_security_guardian.sql` (Gate 2).
- RLS tests: `supabase/tests/rls_tests.sql` + `supabase/tests/rls_security_tests.sql` +
  `supabase/tests/run_tests.cjs` — PASS (both suites).
- Unit + live integration: **166 tests pass (20 files)**; zero DB residue.
- Gate 2 docs: `docs/factory/GATE_2_*.md` (18 docs) + `GATE_2_EVIDENCE.md`.
- Control Plane UI endpoints implemented; UI screens remain a Gate-1 optional follow-up
  (API contract is complete).

---

**END OF ARCHITECTURE (GATE 1 + GATE 2).**
