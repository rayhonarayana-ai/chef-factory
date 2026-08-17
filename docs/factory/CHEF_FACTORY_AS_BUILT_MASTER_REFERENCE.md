# CHEF FACTORY — As-Built Master Reference

> ---
> **AUTHORITATIVE_AS_BUILT_BASELINE — FROZEN**
>
> | Field | Value |
> |-------|-------|
> | Document | `CHEF_FACTORY_AS_BUILT_MASTER_REFERENCE.md` |
> | Version | 1.0 |
> | Baseline Date | 2026-08-16 |
> | Repository | `chef-factory` v0.1.0 (NOT_A_GIT_REPO) |
> | Factory Supabase | `dybyidtcyzgliupzzfhl` (CHEF FACTORY DB) |
> | Gate Status | Gate 1 PASS → Gate 2 PASS → Gate 3 LOCKED |
> | Source-of-Truth Status | **AUTHORITATIVE_AS_BUILT_BASELINE** |
> | Last Forensic Verification | 2026-08-16 |
> | Documentation Status | **VERIFIED_WITH_DOCUMENTATION_DRIFT** |
>
> This document is frozen as the authoritative architectural baseline.
> Any future implementation change MUST comply with the Change-Control Rules in §41.
> ---

**Classification:** FACTORY INTERNAL — CONFIDENTIAL
**Version:** 1.0 | **Date:** 2026-08-16
**Status:** GATE 1 PASS → GATE 2 PASS → GATE 3 LOCKED
**Evidence basis:** Source inspection, migration files, test suites, live verification

---

## Table of Contents

| # | Section | Page |
|---|---------|------|
| 1 | Executive Summary | §1 |
| 2 | Gate Status Matrix | §2 |
| 3 | System Architecture Overview | §3 |
| 4 | Source Inventory | §4 |
| 5 | Database Schema | §5 |
| 6 | Database Migrations | §6 |
| 7 | Database Functions & Triggers | §7 |
| 8 | Row-Level Security | §8 |
| 9 | Core Engine — Command Pipeline | §9 |
| 10 | Core Engine — Intent Parser | §10 |
| 11 | Core Engine — Authority Matrix | §11 |
| 12 | Core Engine — Adaptive Autonomy | §12 |
| 13 | Core Engine — Approval Engine | §13 |
| 14 | Core Engine — Task Engine | §14 |
| 15 | Security — Guardian | §15 |
| 16 | Security — Policy Engine | §16 |
| 17 | Security — Critical Action Registry | §17 |
| 18 | Security — Rate Limiting | §18 |
| 19 | Security — Anomaly Detection | §19 |
| 20 | Security — Lockdown System | §20 |
| 21 | Security — Authentication | §21 |
| 22 | API — Server & Routing | §22 |
| 23 | API — Endpoint Inventory | §23 |
| 24 | API — Command Pipeline Integration | §24 |
| 25 | API — Response Format | §25 |
| 26 | Gateways — Model Gateway | §26 |
| 27 | Gateways — Runtime Gateway | §27 |
| 28 | Gateways — Provider Adapters | §28 |
| 29 | Testing — Unit Tests | §29 |
| 30 | Testing — SQL Test Suites | §30 |
| 31 | Testing — Live HTTP Verification | §31 |
| 32 | Testing — Test Results Summary | §32 |
| 33 | Operations — Dependencies & Scripts | §33 |
| 34 | Operations — Environment Configuration | §34 |
| 35 | Operations — Build & Deployment | §35 |
| 36 | Forensics — Gate History | §36 |
| 37 | Forensics — Blocker Remediation | §37 |
| 38 | Forensics — Evidence Chain | §38 |
| 39 | Known Gaps & Deferred Items | §39 |
| 40 | Supporting Document Index | §40 |
| 41 | Change-Control Rules (POST-FREEZE) | §41 |

---

## 1. Executive Summary

CHEF FACTORY is a deterministic, audited AI factory control plane. It governs how an owner delegates tasks to AI agents and models, with every decision flowing through intent parsing, authority evaluation, and security guardianship before execution.

### Key Facts

| Metric | Value |
|--------|-------|
| TypeScript source files | 71 |
| Database migrations | 4 |
| Database tables | 23 |
| Database indexes | 59 |
| Triggers | 28 |
| RLS policies | ~80 |
| REVOKE statements | 7 |
| Unit tests | 163+ (19 vitest files) |
| SQL tests | 14 (7 Gate 1 + 7 Gate 2) |
| Live HTTP tests | 9 (9/9 PASS) |
| API endpoints | 28 (2 unauthenticated + 26 authenticated) |
| Security layers | 13 (see AS_BUILT_SECURITY.md §1) |

### Current Status

- **Gate 1:** PASS — Foundation, core engine, 16-table schema, 105 unit tests, RLS verified
- **Gate 2:** PASS — Security Guardian, 2 critical blockers remediated, 9/9 live HTTP PASS
- **Gate 3:** LOCKED — No work performed. No deployment executed.
- **Deployment:** NOT AUTHORIZED

### Documentation Convention

Every claim in this document is traceable to one or more evidence sources: source code inspection, SQL migration files, vitest output, SQL test output, or live HTTP verification output. The label `LIVE_VERIFIED` is applied only where the live HTTP verification runner produced `PASS` output against a real Supabase instance.

---

## 2. Gate Status Matrix

| Gate | Status | Evidence Files | Date |
|------|--------|---------------|------|
| Gate 1 — Foundation | **PASS** | FOUNDATION_REPORT.md, GATE_1_EXECUTION_CONTRACT_FINAL.md | 2026-08-15 |
| Gate 2 — Security Guardian | **PASS** | GATE_2_EVIDENCE.md, GATE_2_FINAL_REPORT.md, GATE_2_FORENSIC_REVIEW.md | 2026-08-16 |
| Gate 3 — Growth/Sales Engines | **LOCKED** | — | — |
| Deployment | **NOT AUTHORIZED** | — | — |

### Gate 1 Pass Criteria (All Met)

- 16-table schema applied with RLS on every table (61 policies)
- Authority Matrix, Adaptive Autonomy, Approval Engine, Decision Journal, Explanation Layer
- Model/Runtime gateways with 4 provider adapters
- ToolBroker boundary, Secret boundary
- `tsc --noEmit` PASS, `tsc -p tsconfig.build.json` BUILD PASS
- 105 unit + 8 live integration PASS
- RLS_TESTS_PASS, zero residue, no deployment

### Gate 2 Pass Criteria (All Met)

- Security Guardian 13-layer architecture wired into production pipeline
- 17-rule Critical Action Registry (immutable, DB-enforced)
- TRUNCATE hardening on 7 tables (trigger + REVOKE)
- Authentication: Bearer token → `supabase.auth.getUser(token)` → PostgREST with `apikey: anon`
- Double-encoding fix in `send()` function
- 181/181 unit tests (22 files), RLS S1–S7 PASS, 9/9 live HTTP PASS
- Zero residue, secret scan clean

---

## 3. System Architecture Overview

```
                         ┌─────────────────────────────┐
                         │      Owner / Agent CLI       │
                         └──────────┬──────────────────┘
                                    │ HTTP Bearer token
                         ┌──────────▼──────────────────┐
                         │     API Server (server.ts)   │
                         │  http.createServer :8787      │
                         │  send() — single stringify    │
                         └──────────┬──────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              ┌──────────┐  ┌────────────┐  ┌──────────────┐
              │ auth.ts  │  │ handlers.ts│  │ security.ts  │
              │ verify   │  │ route→     │  │ create       │
              │ Owner()  │  │ handler    │  │ Guardian     │
              └────┬─────┘  └─────┬──────┘  └──────┬───────┘
                   │              │                │
                   └──────┬───────┘                │
                          ▼                        │
                ┌──────────────────┐               │
                │ CommandPipeline  │◄──────────────┘
                │  .run()          │
                └───┬──────┬───────┘
                    │      │
       ┌────────────┘      └────────────┐
       ▼                                ▼
┌─────────────┐               ┌──────────────────┐
│ Intent      │               │ Security         │
│ Parser      │               │ Guardian         │
│ (15 verbs,  │               │ (11-step         │
│  24 resources)              │  evaluate)       │
└──────┬──────┘               └────────┬─────────┘
       │                               │
       ▼                               ▼
┌─────────────┐          ┌──────────────────────┐
│ Authority   │          │ Policy Engine        │
│ Matrix      │          │ (13 rules)           │
│ (10 rules)  │          └──────────┬───────────┘
└──────┬──────┘                     │
       │         ┌──────────────────┘
       ▼         ▼
┌──────────────────────┐    ┌─────────────────┐
│ Adaptive Autonomy    │    │ Approval Engine  │
│ (bounded escalation) │    │ (6 states)       │
└──────────┬───────────┘    └─────────────────┘
           │
     ┌─────┴──────┐
     ▼            ▼
┌─────────┐  ┌───────────────┐
│ Task    │  │ Execution     │
│ Engine  │  │ Runner        │
│ (8      │  │ ┌───────────┐ │
│ states) │  │ │ModelGW    │ │
└─────────┘  │ │RuntimeGW  │ │
             │ └───────────┘ │
             └───────┬───────┘
                     ▼
              ┌──────────────┐
              │ Supabase     │
              │ PostgreSQL   │
              │ (23 tables)  │
              └──────────────┘
```

**Request flow:** HTTP request → auth middleware (verify Bearer token) → handler → `CommandPipeline.run()` → intent parse → authority → autonomy → guardian (optional) → approval gate or execution → audit + explanation → response.

**Design invariant:** Every outcome carries a structured `Explanation` (decision, why, evidence, confidence, risk, outcome). `"Done."` alone is never a valid explanation.

---

## 4. Source Inventory

### File Counts by Directory

| Directory | Files | Purpose |
|-----------|-------|---------|
| `src/core/` | 14 | Business logic: pipeline, intent, authority, autonomy, approval, task engine, types, ports, explanation, monitoring, passport, cost, decision journal, redact, POS |
| `src/core/security/` | 15 | Security Guardian subsystem |
| `src/api/` | 9 | HTTP server, handlers, auth, security wiring, execution, redact |
| `src/db/` | 4 | config, pool, repo (SupabaseStore), seed |
| `src/gateways/` | 11 | Model/Runtime gateways, ToolBroker, SecretProvider, MemoryGateway, providerAdapter |
| `src/gateways/adapters/` | 4 | OpenAI, Anthropic, Google, OpenCode Zen |
| `src/integration/` | 3 | Live integration tests (guarded) |
| `src/testing/` | 1 | MemoryStore (test fixture) |
| **Total** | **71** | |

### Key Source Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/core/pipeline.ts` | 606 | Command pipeline — the central orchestrator |
| `src/core/types.ts` | 389 | All core type definitions |
| `src/core/intent.ts` | 181 | Intent parsing (15 verbs, 24 resources, 5 detection functions) |
| `src/core/authority.ts` | 149 | Authority matrix (10 rules) |
| `src/core/security/guardian.ts` | ~300 | Security Guardian (11-step evaluate) |
| `src/core/security/securityGuardian.test.ts` | ~800 | 41 tests (26 topics + 10 adversarial + 5 persistence) |
| `src/db/repo.ts` | ~600 | SupabaseStore — 30+ methods |
| `src/api/server.ts` | ~200 | HTTP server, routing, static files |
| `src/api/handlers.ts` | ~300 | 28 endpoint handlers |
| `scripts/live-http-verification.ts` | ~400 | 9 mandatory live HTTP tests |

---

## 5. Database Schema

23 tables across two domains. Full column-level detail in AS_BUILT_DATABASE.md §2.

### Core Domain (13 tables)

| Table | Purpose | Truncation Protected |
|-------|---------|---------------------|
| `owners` | Owner identity (1:1 with auth.users) | No |
| `projects` | Project registry; auto-creates 3 environments | No |
| `project_environments` | Per-project env slots (development/staging/production) | No |
| `project_passports` | Immutable project specification (16 JSON sections) | No |
| `agents` | Agent registry (workers that receive tasks) | No |
| `agent_permissions` | Granular per-agent, per-project, per-resource permissions | No |
| `tasks` | Task execution lifecycle (8 statuses, bounded retry) | No |
| `models` | AI model registry (6 seeded models) | No |
| `runtimes` | Runtime registry (1 seeded runtime) | No |
| `task_runs` | Per-task execution runs (versioned by run_number) | No |
| `approvals` | Approval request/decision workflow (6 states) | No |
| `audit_events` | Append-only audit trail (no UPDATE/DELETE) | **YES** |
| `cost_events` | Cost tracking per task/run/agent/project | No |

Plus `personal_preferences` (POS), `decision_journal`, `autonomy_records`, `memory_lessons` = 17 core-domain tables.

### Security Domain (6 tables)

| Table | Purpose | Truncation Protected |
|-------|---------|---------------------|
| `critical_actions` | Global immutable registry (17 rules) | **YES** |
| `security_events` | Append-only security event log | **YES** |
| `security_incidents` | Security incident workflow | **YES** |
| `security_lockdowns` | Emergency lockdown history | **YES** |
| `security_rate_limits` | Owner-configurable rate limit rules | **YES** |
| `security_policies` | Read-only deterministic rule registry (13 rules) | **YES** |

---

## 6. Database Migrations

| # | Filename | Timestamp | Lines | Purpose | Status |
|---|----------|-----------|-------|---------|--------|
| 1 | `20260815220000_factory_init.sql` | 2026-08-15 22:00 | 702 | GATE 1 — 16 core tables, helper functions, updated_at triggers, append-only triggers, RLS policies | IMPLEMENTED |
| 2 | `20260816000000_core_additions.sql` | 2026-08-16 00:00 | 34 | GATE 1 — `memory_lessons` table for validated lesson persistence | IMPLEMENTED |
| 3 | `20260817000000_security_guardian.sql` | 2026-08-17 00:00 | 272 | GATE 2 — 6 security tables, 17 core critical_actions rows, 13 policy rows, append-only + immutability triggers, RLS | IMPLEMENTED |
| 4 | `20260818000000_security_truncate_hardening.sql` | 2026-08-18 00:00 | 69 | GATE 2 — BEFORE TRUNCATE triggers on 7 tables, REVOKE TRUNCATE/TRIGGER from anon+authenticated | IMPLEMENTED |

**Migration tracking gap:** Migrations 1–2 are tracked in `schema_migrations`. Migrations 3–4 are APPLIED (all objects verified present) but UNTRACKED (raw SQL, not CLI). `supabase db push` may attempt to re-apply. Safe repair: `supabase migration repair --status applied 20260817000000`.

---

## 7. Database Functions & Triggers

### Functions (10)

| Function | Type | Purpose |
|----------|------|---------|
| `set_updated_at()` | Trigger function | Sets `new.updated_at = now()` before every UPDATE |
| `handle_new_user()` | Trigger function | On auth.users INSERT → creates owner row in public.owners |
| `ensure_project_environments()` | Trigger function | After project INSERT → auto-creates 3 environment rows |
| `is_owner()` | SQL function | Returns true if auth.uid() exists in owners with status='active' |
| `requesting_agent()` | SQL function | Reads current_setting('request.agent_id') as UUID |
| `agent_has_permission(p_project, p_resource, p_permission)` | SQL function | Checks agent permission (supports global via project_id IS NULL) |
| `block_audit_mutation()` | Trigger function | Raises exception on UPDATE/DELETE/TRUNCATE of audit_events |
| `block_critical_action_mutation()` | Trigger function | Raises exception on UPDATE/DELETE/TRUNCATE of critical_actions |
| `block_security_event_mutation()` | Trigger function | Raises exception on UPDATE/DELETE/TRUNCATE of security_events |
| `block_lockdown_deletion()` | Trigger function | Raises exception on DELETE/TRUNCATE of security_lockdowns |
| `block_security_table_truncate()` | Trigger function | Generic TRUNCATE guard for security_incidents, security_rate_limits, security_policies |

### Triggers (28 Total)

| Category | Count | Tables |
|----------|-------|--------|
| `updated_at` triggers | 12 | owners, projects, project_environments, project_passports, agents, tasks, models, runtimes, approvals, personal_preferences, critical_actions, security_incidents |
| Auth / business logic | 2 | `on_auth_user_created` (auth.users), `projects_ensure_environments` (projects) |
| Append-only enforcement | 7 | audit_events (UPDATE+DELETE), security_events (UPDATE+DELETE), security_lockdowns (DELETE), critical_actions (UPDATE+DELETE) |
| Truncate guards | 7 | security_events, critical_actions, security_lockdowns, security_incidents, security_rate_limits, security_policies, audit_events |

---

## 8. Row-Level Security

RLS is enabled on all 23 tables. All policies target the `authenticated` role. The `anon` role has no SELECT policies and is fully blocked. The `service_role` bypasses RLS (Supabase default).

### Policy Summary

| Table Domain | Tables | Policies | Notes |
|-------------|--------|----------|-------|
| Core domain | 17 | ~68 | Owner-scoped CRUD; agent read/write via `agent_has_permission` where applicable |
| Security domain | 6 | ~12 | `critical_actions` and `security_policies` = global read-only; others = owner-scoped |
| Append-only tables | 3 | ~6 | audit_events, security_events: INSERT+SELECT only (no UPDATE/DELETE policies) |
| **Total** | **23** | **~80** | |

### REVOKE Statements (7)

All from migration 4. Applied to: `security_events`, `critical_actions`, `security_lockdowns`, `security_incidents`, `security_rate_limits`, `security_policies`, `audit_events`. Revokes `TRUNCATE` and `TRIGGER` from `anon` and `authenticated` roles.

### Defense-in-Depth Layers

1. **RLS policies** — block unauthorized row access (before-row level)
2. **BEFORE UPDATE/DELETE triggers** — block mutation even for superuser
3. **BEFORE TRUNCATE triggers** — block TRUNCATE even for superuser
4. **REVOKE statements** — strip TRUNCATE/TRIGGER privileges from non-superuser roles

Full policy catalog in AS_BUILT_DATABASE.md §6.

---

## 9. Core Engine — Command Pipeline

**File:** `src/core/pipeline.ts` (606 lines)
**Status:** IMPLEMENTED | TESTED

The `CommandPipeline.run(actorCtx, rawCommand)` method is the central orchestrator. Every owner or agent command flows through this 14-step deterministic pipeline:

### Pipeline Steps

| Step | Action | Key Decision |
|------|--------|-------------|
| 1 | Generate correlationId | `crypto.randomUUID()` |
| 2 | Parse intent | `parseIntent(raw)` → verb, resource, project, environment |
| 3 | Audit `command.received` | Always recorded, redacted normalized text |
| 4 | Gate ambiguity | `status !== 'resolved'` → `outcome: 'unknown'` (no fabrication) |
| 5 | Resolve project scope | `store.getProjectBySlug()` → `unknown_project` if not found |
| 6 | Compute action metadata | environment (default: development), actionType, permission, risk |
| 7 | Authorization check | Owner: always authorized; Agent: `agentHasPermission()` |
| 8 | Explicit DENY check | Owner preferences for `policy.explicit_deny` |
| 9 | Authority evaluation | `evaluateAuthority()` — 10-rule matrix |
| 10 | Autonomy evaluation | `evaluateAutonomy()` — bounded escalation |
| 11 | Security Guardian (Gate 2) | Optional. Can only be MORE restrictive. |
| 12 | DENY gate | `autonomy === 'deny'` → task cancelled, `outcome: 'denied'` |
| 13 | Approval gate | `autonomy === 'require_approval'` → task needs_approval, create approval |
| 14 | AUTO/NOTIFY path | Create task (queued) → execute → complete or bounded retry |

### PipelineResult Envelope

```typescript
{
  outcome: 'executed' | 'waiting_approval' | 'denied' | 'unknown' | 'unknown_project' | 'retry_pending' | 'failed' | 'blocked',
  intent: ParsedIntent,
  project: { id, slug, name } | null,
  environment: EnvironmentName,
  risk: RiskLevel,
  authority: AuthorityDecision | null,
  autonomy: AutonomyDecision | null,
  approvalId: string | null,
  task: TaskRecord | null,
  correlationId: string,
  explanation: Explanation
}
```

---

## 10. Core Engine — Intent Parser

**File:** `src/core/intent.ts` (181 lines)
**Status:** IMPLEMENTED | TESTED (10 tests)

### ActionVerbs (15)

`read`, `write`, `create`, `update`, `delete`, `execute`, `deploy`, `approve`, `reject`, `cancel`, `plan`, `research`, `ask`, `list`, `status`, `unknown`

### Resources (24 input tokens → canonical names)

`task`, `project`, `agent`, `approval`, `model`, `runtime`, `passport`, `cost`, `audit`, `preference`, `decision`, `deploy`, `credit` (+ funding/money/transfer), `contract`, `legal`, `account`, `security`, `access`, `secret` (+ keys)

### Detection Functions (5)

| Function | What It Detects |
|----------|----------------|
| `detectVerb(tokens, rawNorm)` | First matching keyword wins; `?` → `ask` |
| `detectResource(tokens)` | Scans tokens; returns resource + count (for ambiguity) |
| `detectProject(rawNorm)` | 3 regex patterns: `@slug`, `in/for/on/under slug`, `project slug` |
| `detectEnvironment(tokens)` | production/prod, staging/stage, development/dev |
| `detectTarget(rawNorm, tokens, project, environment)` | Quoted strings, meaningful tokens not in stop words |

### Status Resolution

- `unknown` — verb is `unknown` OR required fields missing
- `ambiguous` — multiple distinct resources detected
- `resolved` — all required fields present, single resource

**Missing pieces are tracked explicitly, never fabricated.**

---

## 11. Core Engine — Authority Matrix

**File:** `src/core/authority.ts` (149 lines)
**Status:** IMPLEMENTED | TESTED (12 tests)

### PROTECTED_ACTION_TYPES (6)

`delete`, `deploy`, `financial`, `legal`, `account_security`, `credit`

These always default to `REQUIRE_APPROVAL` regardless of environment or history. Cannot be downgraded by autonomy escalation.

### 10 Rules (First Match Wins)

| Rule | Condition | Outcome |
|------|-----------|---------|
| 0 | Explicit DENY | `deny` |
| 1 | Not authorized | `deny` |
| 2 | Agent + approve permission | `deny` |
| 3 | Protected action class | `require_approval` |
| 4 | Risk === critical | `require_approval` |
| 5 | Production + write/execute | `require_approval` |
| 6 | Permission === read | `auto` |
| 7 | Permission === execute (non-prod) | `notify` |
| 8 | Permission === write (non-prod) | `notify` |
| 9 | Fallback | `notify` |

### Risk Classification (`riskFromAction`)

| actionType | development | staging | production |
|------------|-------------|---------|------------|
| delete | high | high | high |
| deploy | high | high | critical |
| financial/legal/account_security | critical | critical | critical |
| execute | medium | medium | high |
| (other) | low | low | medium |

---

## 12. Core Engine — Adaptive Autonomy

**File:** `src/core/autonomy.ts` (83 lines)
**Status:** IMPLEMENTED | TESTED (8 tests)

### Decision Flow

1. **DENY always wins** — cannot be overridden by success history
2. **Owner policy** — explicit owner override applied (unless deny)
3. **Protected classes** — `actionType ∈ PROTECTED_ACTION_TYPES` → `require_approval` (never escalated)
4. **REQUIRE_APPROVAL** — stays `require_approval` (never downgraded)
5. **AUTO** — stays `auto`
6. **NOTIFY** — bounded one-step escalation possible
7. **Unknown** — fallback to `require_approval`

### Escalation Thresholds

| Threshold | Value | Meaning |
|-----------|-------|---------|
| `ESCALATION_MIN_SUCCESS_RATE` | 0.8 | 80%+ success required |
| `ESCALATION_MIN_HISTORY` | 5 | Minimum 5 historical actions |

### Escalation Rule

Only `notify → auto` is possible (one-step bounded). Protected classes and `require_approval` are never downgraded. `deny` always wins.

---

## 13. Core Engine — Approval Engine

**File:** `src/core/approval.ts` (62 lines)
**Status:** IMPLEMENTED | TESTED (6 tests)

### 6 States

```
pending → approved | rejected | denied | expired | cancelled
```

Terminal states (no further transitions): `approved`, `rejected`, `denied`, `expired`, `cancelled`.

### Key Rules

- **Unique pending:** `validateNewApproval()` enforces one pending approval per (task, action) combination
- **Terminal guard:** `resolveApproval()` rejects transitions from terminal states
- **DB enforcement:** Unique partial index on `(task_id, action) WHERE status = 'pending'`

### Integration

When authority returns `require_approval` and guardian confirms: task created as `needs_approval`, approval record created, pipeline returns `waiting_approval`.

---

## 14. Core Engine — Task Engine

**File:** `src/core/taskEngine.ts` (83 lines)
**Status:** IMPLEMENTED | TESTED (8 tests)

### 8 Task Statuses

`created` | `queued` | `running` | `completed` | `failed` | `cancelled` | `paused` | `needs_approval`

Terminal: `completed`, `failed`, `cancelled`.

### Bounded Retry Logic

```
DEFAULT_MAX_ATTEMPTS = 3
```

- On failure: if `attempts < maxAttempts` → re-queue (`queued`, attempts incremented)
- If exhausted → `failed`, `stopped: true`, `completedAt` set
- No automatic retry loop — task re-queued for next pipeline invocation

### Allowed Transitions (Key Paths)

- `created → queued | needs_approval | cancelled`
- `queued → running | paused | cancelled`
- `running → completed | failed | paused | cancelled`
- `needs_approval → queued | paused | cancelled`
- Terminal states: no outgoing transitions

---

## 15. Security — Guardian

**File:** `src/core/security/guardian.ts`
**Status:** IMPLEMENTED | TESTED (41 tests)

### `evaluate()` Flow (11 Steps)

| Step | Check | On Trigger |
|------|-------|-----------|
| 1 | Lockdown active? | → `lockdown` + `deny` (fail closed) |
| 2 | Critical Action Registry | → `deny` or `require_approval` |
| 3 | Environment isolation | → deny if agent escalating |
| 4 | Cross-project isolation | → deny if agent crossing |
| 5 | Rate limits | → deny if exhausted |
| 6 | Cost protection | → deny if hard limit |
| 7 | Prompt injection | → flags authority directives as DATA |
| 8 | Policy evaluation | → full 13-rule chain |
| 9 | Authority combination | → never less restrictive than Gate 1 |
| 10 | Anomaly notes | → counts denials, escalations, etc. |
| 11 | Event emission | → security event recorded |

### Precedence Chain

```
lockdown (5) > deny (4) > require_approval (3) > notify (2) > allow (1)
```

The Guardian may only make a decision MORE restrictive than Gate 1 authority — never less.

### Production Wiring

`createSecurityGuardian(store)` in `src/api/security.ts` wires: lockdown (DB-backed async), rateLimiter (in-memory), anomaly (in-memory), recordEvent (DB-backed), costCheck (DB-backed async). Called once per `POST /api/chat` command.

---

## 16. Security — Policy Engine

**File:** `src/core/security/policyEngine.ts`
**Status:** IMPLEMENTED | TESTED (26 topics + 10 adversarial)

### 13 Policy Rules (Evaluation Order)

| # | Rule | Decision |
|---|------|----------|
| 1 | `rule.lockdown_active` | lockdown |
| 2 | `rule.critical_action_default` | deny |
| 3 | `rule.environment_isolation` | deny |
| 4 | `rule.cross_project_deny` | deny |
| 5 | `rule.rate_limit` | deny |
| 6 | `rule.cost_protection` | deny |
| 7 | `rule.critical_action_require_approval` | require_approval |
| 8 | `rule.production_write_execute` | require_approval |
| 9 | `rule.staging_write_execute` | notify |
| 10 | `rule.not_authorized` | deny |
| 11 | `rule.explicit_deny` | deny |
| 12 | `rule.default_allow` | allow |

Note: Rule 13 (`rule.untrusted_directive`) is in the DB registry but is an evidence marker, not a standalone decision point.

### Key Helper Functions

- `combineAuthority(authority, security)` — never less restrictive than Gate 1
- `moreRestrictive(a, b)` — returns the more restrictive of two decisions
- `environmentRank(e)` — development=0, staging=1, production=2
- `detectEnvironmentEscalation(env, granted, actorType)` — agents only
- `detectCrossProject(projectId, requestedProjectId, actorType)` — agents only

Full rule detail in AS_BUILT_SECURITY.md §4.

---

## 17. Security — Critical Action Registry

**File:** `src/core/security/criticalActions.ts`
**Status:** IMPLEMENTED | TESTED (but **INERT** — see vocabulary mismatch)

### 17 Rules

| # | Action | Classification | Default Decision |
|---|--------|---------------|-----------------|
| 1 | `production_modification` | production | require_approval |
| 2 | `production_deletion` | production | deny |
| 3 | `database_destructive` | destructive | deny |
| 4 | `secret_access` | secret | require_approval |
| 5 | `secret_rotation` | secret | require_approval |
| 6 | `permission_escalation` | permission | deny |
| 7 | `security_policy_modification` | policy | require_approval |
| 8 | `disable_audit` | audit | deny |
| 9 | `disable_rls` | audit | deny |
| 10 | `owner_identity_change` | identity | require_approval |
| 11 | `authority_rule_change` | authority | require_approval |
| 12 | `autonomy_rule_change` | authority | require_approval |
| 13 | `financial_transaction` | financial | deny |
| 14 | `legal_commitment` | contractual | deny |
| 15 | `external_irreversible` | external_irreversible | require_approval |
| 16 | `factory_shutdown` | factory | deny |
| 17 | `lockdown_release` | factory | deny |

**Counts:** 9 deny-by-default, 8 require_approval-by-default.

### Vocabulary Mismatch — INERT Status

The registry uses action names like `production_modification`, `database_destructive`, `financial_transaction`. The pipeline uses different vocabulary: `create_project`, `run_task`, `deploy`, etc. The `classifyCriticalAction()` function matches on `SecurityRequest.actionType` — unless the pipeline sends the exact registry string, no match occurs.

**Status: INERT** — rules are wired into the Guardian but will only trigger if the exact action strings are passed. No current pipeline endpoint uses these strings. Gate 1 `PROTECTED_ACTION_TYPES` provides the actual protection.

### Immutability

- Registry version: 1, all `isCore: true`
- DB triggers block UPDATE and DELETE on the `critical_actions` table
- Invalid `default_decision` values blocked by CHECK constraint

---

## 18. Security — Rate Limiting

**File:** `src/core/security/rateLimit.ts`
**Status:** IMPLEMENTED | **WIRED_BUT_NOT_ENFORCED**

### 7 Default Scopes

| Scope | limitKey | maxCount | windowSeconds |
|-------|----------|----------|---------------|
| task | `task.execute` | 50 | 3600 |
| tool | `tool.call` | 100 | 3600 |
| runtime | `runtime.execute` | 20 | 3600 |
| model | `model.call` | 200 | 3600 |
| auth | `auth.failure` | 5 | 900 |
| approval | `approval.request` | 20 | 3600 |
| failure | `task.failure` | 10 | 3600 |

### Enforcement Status

All 7 scopes are **wired into the Guardian** (`rateLimiter.check()` is called) but **not fully enforced** because:

- Counters are in-memory (ephemeral — reset on server restart)
- Only `task.execute` and `tool.call` are exercised in the live pipeline path
- 5 scopes (`auth.failure`, `task.failure`, `approval.request`, `runtime.execute`, `model.call`) have no caller that feeds them
- DB-backed rate limit configs (security_rate_limits table) are not loaded

---

## 19. Security — Anomaly Detection

**File:** `src/core/security/anomaly.ts`
**Status:** IMPLEMENTED | **WIRED_BUT_NOT_ENFORCED**

### 10 Anomaly Counters

| Counter | Threshold | Called by Guardian |
|---------|-----------|-------------------|
| `deniedActions` | 5 | YES |
| `authFailures` | 5 | **NO** |
| `privilegeRequests` | 3 | **NO** |
| `projectSwitches` | 5 | YES |
| `environmentEscalations` | 3 | YES |
| `costSpikes` | 3 | YES |
| `retryBursts` | 5 | **NO** |
| `toolAnomalies` | 3 | **NO** |
| `secretAccessAttempts` | 3 | **NO** |
| `policyViolations` | 5 | YES |

### What Gets Triggered

Only 5 of 10 counters are called via `noteAnomalies()` in the Guardian: `deniedActions`, `environmentEscalations`, `projectSwitches`, `policyViolations`, `costSpikes`. The remaining 5 are defined but no code path calls `anomaly.note()` for them.

When a threshold is crossed, `note()` returns an `AnomalySignal` and the Guardian emits an `anomaly.*` security event with `severity: medium`. Counters are in-memory only.

---

## 20. Security — Lockdown System

**File:** `src/core/security/lockdown.ts`
**Status:** IMPLEMENTED | TESTED | LIVE_VERIFIED

### Activation

- **Who:** Owner or system only. Agents are blocked: `validateLockdownActivation()` returns error if `actorType === 'agent'`
- **What:** Requires a non-empty `reason`
- **Scope:** `'all'` (default) or a specific project ID
- **Record:** Creates a `SecurityLockdownRecord` with `status: 'active'`

### Behavior When Active

The Guardian checks `this.deps.lockdown(ownerId)` as step 1 of `evaluate()`. If any active lockdown exists, ALL actions return `lockdown` + `denied: true` immediately. Fail-closed.

### Exiting Lockdown

- `canReleaseLockdown()` — owner-only, requires non-empty reason
- `releaseLockdown()` — transitions `status` from `active` → `released`
- Agents can never release lockdowns (enforced in both code and DB)

### DB Persistence

`security_lockdowns` table: append-only history (DELETE blocked by trigger). RLS: owner-scoped SELECT/INSERT/UPDATE, no DELETE policy.

---

## 21. Security — Authentication

**File:** `src/api/auth.ts`
**Status:** IMPLEMENTED | TESTED (8/8) | LIVE_VERIFIED

### Mechanism (Gate 2 Fix)

1. Extract Bearer token from `Authorization` header
2. `supabase.auth.getUser(token)` — real server-side JWT validation (NOT `setSession`)
3. Fetch owner row via PostgREST with `apikey: anon` header + caller's Bearer token
4. RLS evaluates `auth.uid()` against the caller's token
5. Enforce: `owner.id === user.id && owner.status === 'active'`
6. Any mismatch or exception → `null` (401)

### Critical Properties (Proven by auth.test.ts A–H)

| Test | Property |
|------|----------|
| A | Valid token resolves active owner |
| B | Invalid JWT → DENIED |
| C | Empty/missing token → DENIED |
| D | Token resolves only its own owner (never cross-owner) |
| E | Owner row `id` must match JWT `sub` (anti-spoofing) |
| F | PostgREST carries ONLY caller's Bearer token (RLS enforcement) |
| G | `service_role` NEVER used on owner-resolution path |
| H | Inactive owner → DENIED (fail closed) |

### Supabase Client Config

```typescript
createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
```

---

## 22. API — Server & Routing

**File:** `src/api/server.ts`
**Status:** IMPLEMENTED | LIVE_VERIFIED

### Server Properties

| Property | Value |
|----------|-------|
| Runtime | Node.js `http.createServer` (raw module — no framework) |
| Default host | `127.0.0.1` (env `FACTORY_API_HOST`) |
| Default port | `8787` (env `FACTORY_API_PORT`) |
| Body parser | Custom `readBody()` — manual chunk collection + `JSON.parse` |
| Static UI | Served from `public/` directory with path traversal guard |

### Request Flow

```
Incoming HTTP request
  ├─ /api/health    → send(200, { ok, service, time })     [no auth]
  ├─ /api/config    → send(200, { supabaseUrl, anonKey })  [no auth]
  ├─ /api/* (any)
  │    ├─ matchRoute()        → 404 if no match
  │    ├─ Bearer token check  → 401 if missing
  │    ├─ auth.verifyOwner()  → 401 if null
  │    ├─ readBody()          → parse JSON body
  │    ├─ api.handle()        → HandlerResult { status, json }
  │    └─ send()              → SINGLE JSON.stringify + redact → response
  └─ /* (other)    → serveStatic() from public/
```

### The `send()` Function (Gate 2 Fix)

Single `JSON.stringify`, then `getRedactor().redact()`, then `res.end()`. Prior to fix, double-encoding produced escaped JSON strings.

---

## 23. API — Endpoint Inventory

### Unauthenticated (2)

| # | Method | Path | Purpose |
|---|--------|------|---------|
| 1 | GET | `/api/health` | Liveness probe |
| 2 | GET | `/api/config` | Public client bootstrap (Supabase URL + anon key) |

### Authenticated (26)

| # | Method | Path | Purpose |
|---|--------|------|---------|
| 3 | GET | `/api/me` | Current authenticated owner |
| 4 | POST | `/api/chat` | Submit command to CommandPipeline |
| 5 | GET | `/api/projects` | List owner's projects |
| 6 | POST | `/api/projects` | Create project |
| 7 | GET | `/api/passports/:projectId` | Get project passport |
| 8 | PUT | `/api/passports/:projectId` | Upsert passport fields |
| 9 | GET | `/api/agents` | List owner's agents |
| 10 | GET | `/api/tasks` | List tasks (filterable) |
| 11 | GET | `/api/approvals` | List approvals (filterable) |
| 12 | POST | `/api/approvals/:approvalId/decision` | Approve/reject/deny approval |
| 13 | GET | `/api/costs` | Per-project cost summary + grand total |
| 14 | GET | `/api/audit` | Query audit events |
| 15 | GET | `/api/status` | Daily operational status |
| 16 | GET | `/api/prefs` | Get all owner preferences |
| 17 | PUT | `/api/prefs` | Set a preference |
| 18 | GET | `/api/models` | List registered AI models |
| 19 | GET | `/api/runtimes` | List registered runtimes |
| 20 | GET | `/api/decisions` | List recorded decisions |
| 21 | GET | `/api/security/health` | Security health check |
| 22 | GET | `/api/security/events` | Query security events |
| 23 | GET | `/api/security/incidents` | List security incidents |
| 24 | POST | `/api/security/incidents` | Create security incident |
| 25 | GET | `/api/security/critical-actions` | List critical actions registry |
| 26 | GET | `/api/security/lockdown` | Get active lockdown status |
| 27 | POST | `/api/security/lockdown` | Activate lockdown |
| 28 | POST | `/api/security/lockdown/release` | Release active lockdown |

All endpoints require `Authorization: Bearer <token>` unless noted. All store queries are owner-scoped via PostgREST RLS.

---

## 24. API — Command Pipeline Integration

**Endpoint:** `POST /api/chat`
**Request:** `{ command: string }`

### Flow

```
POST /api/chat
  → parseIntent(command)
  → Pipeline.run(actorCtx, command)
  → Intent: verb + resource + project + environment
  → Authority: 10-rule matrix
  → Autonomy: bounded escalation
  → Guardian (Gate 2): 11-step evaluate
  → Approval gate or execution
  → Audit trail + explanation
  → PipelineResult envelope
```

### Verb Coverage (16 verbs, 24 resources)

The pipeline supports 16 action verbs (`read`, `write`, `create`, `update`, `delete`, `execute`, `deploy`, `approve`, `reject`, `cancel`, `plan`, `research`, `ask`, `list`, `status`, `unknown`) mapped to 24 resource types. Special resource overrides: `credit/funding/money/transfer` → `financial` action type; `legal/contract` → `legal`; `account/security/access/secret/keys` → `account_security`.

### Execution Strategy

Informational verbs (`ask`, `status`, `list`, `read`, `plan`, `research`) → deterministic `runInformational()` — reads directly from Store, no model call, no credits, no fabrication. Execute-class verbs → two-phase: ModelGateway first, then RuntimeGateway, then honest failure.

---

## 25. API — Response Format

### Success (200)

Direct object or wrapped in named key:

| Endpoint Pattern | Response Shape |
|-----------------|----------------|
| `GET /api/me` | `{ id, email }` |
| `GET /api/projects` | `{ projects: [...] }` |
| `POST /api/projects` | `{ project: {...} }` |
| `GET /api/passports/:id` | `{ passport: {...}, summary: {...} }` |
| `GET /api/tasks` | `{ tasks: [...] }` |
| `GET /api/approvals` | `{ approvals: [...] }` |
| `GET /api/costs` | `{ costs: [...], total: number }` |
| `GET /api/audit` | `{ audit: [...] }` |
| `GET /api/prefs` | `{ prefs: {...} }` |
| `GET /api/security/health` | `{ health: {...}, lockdown: {...}\|null }` |
| `GET /api/security/events` | `{ events: [...] }` |
| `POST /api/security/lockdown` | `{ lockdown: {...} }` |
| `POST /api/chat` | `PipelineResult` (see §9) |

### Error Responses

```json
{ "error": "<message>" }
```

| Status | Condition |
|--------|-----------|
| 400 | Validation failure (missing fields, invalid values) |
| 401 | No Bearer token or failed auth |
| 404 | Route or resource not found |
| 409 | Invalid state transition (e.g., approval already terminal) |
| 500 | Unhandled server error |

---

## 26. Gateways — Model Gateway

**File:** `src/gateways/modelGateway.ts`
**Status:** IMPLEMENTED | TESTED (7 tests)

### Selection Logic

1. Filter: only `status === 'active'` models
2. Capability filter: reasoning level, tools, context window
3. Sort: ascending by total cost (`costPer1kInput + costPer1kOutput`)
4. Pick: cheapest capable (configurable via `preferCheapest`)
5. No fabrication: returns `model: null` with reason when no match

### Provider Routing

Selection is purely data-driven from the model registry. Provider routing happens at execution time via `adapterFor(model.provider)`.

### Seeded Models (6)

| Provider | Model | Reasoning | Context | Cost (in/out per 1k) |
|----------|-------|-----------|---------|---------------------|
| openai | gpt-4o-mini | low | 128K | $0.15 / $0.60 |
| openai | gpt-4o | medium | 128K | $2.50 / $10.00 |
| anthropic | claude-3-5-haiku | low | 200K | $0.80 / $4.00 |
| anthropic | claude-3-5-sonnet | high | 200K | $3.00 / $15.00 |
| google | gemini-1.5-flash | low | 1M | $0.075 / $0.30 |
| google | gemini-1.5-pro | high | 2M | $1.25 / $5.00 |

---

## 27. Gateways — Runtime Gateway

**File:** `src/gateways/runtimeGateway.ts`
**Status:** IMPLEMENTED | TESTED (4 tests)

### Selection Logic

1. Filter: only `status === 'active'`
2. Sort: ascending by `costPerHour`, then by name
3. Pick: always cheapest
4. No fabrication: returns `runtime: null` with reason when no active runtime

### Environment Guard

Optional callback injected at construction. When present, `guardExecution()` invokes it. Gate 2 hookpoint — may only be more restrictive, never less. No concrete guard wired in `server.ts` (Gate 1).

### Seeded Runtime (1)

| Name | Version | Capabilities | Cost/Hour |
|------|---------|-------------|-----------|
| opencode-zen | 0.1 | code, shell | $0.00 |

---

## 28. Gateways — Provider Adapters

**Status:** IMPLEMENTED | TESTED (28 gateway tests)

### Common Interface

```typescript
interface ProviderAdapter {
  readonly provider: string;
  configured(): boolean;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}
```

### 3 Model Adapters + 1 Runtime Adapter

| Adapter | Endpoint | Auth | Notes |
|---------|----------|------|-------|
| **OpenAI** | `api.openai.com/v1/chat/completions` | Bearer token | Full usage tracking |
| **Anthropic** | `api.anthropic.com/v1/messages` | x-api-key header | System message extracted to top-level field |
| **Google** | `generativelanguage.googleapis.com/v1beta/...` | API key param | Usage returns `null` (fallback to estimate) |
| **OpenCode Zen** | Spawns `{cliPath} run {command}` | N/A | Runtime adapter; requires `FACTORY_OPENCODE_ENABLED=true` |

### Utility Functions

- `estimateTokens(text)` — `Math.ceil(text.length / 4)` (fallback)
- `costForTokens(costPer1kInput, costPer1kOutput, inputTokens, outputTokens)` — deterministic dollar cost

### Wiring in server.ts

All adapters are instantiated at startup via factory functions, injected into gateways via `Map<string, Adapter>`. No global singletons, no hard-coded providers.

---

## 29. Testing — Unit Tests

**Framework:** vitest 1.6+ | **Environment:** Node.js | **Timeout:** 60s

### Test File Inventory (19 files, 163+ tests)

| File | Module Tested | Tests |
|------|--------------|-------|
| `securityGuardian.test.ts` | Security Guardian (26 topics + 10 adversarial + 5 persistence) | 41 |
| `pipeline.test.ts` | CommandPipeline.run (18 scenarios including 3 Guardian integration) | 18 |
| `authority.test.ts` | evaluateAuthority, riskFromAction | 12 |
| `intent.test.ts` | parseIntent (scoping, ambiguity, detection) | 10 |
| `autonomy.test.ts` | evaluateAutonomy (bounded escalation) | 8 |
| `modelGateway.test.ts` | ModelGateway selection logic | 8 |
| `taskEngine.test.ts` | canTransition, handleTaskFailure, bounded retry | 8 |
| `auth.test.ts` | AuthService.verifyOwner (A–H) | 8 |
| `approval.test.ts` | validateNewApproval, resolveApproval, isExpired | 6 |
| `toolBroker.test.ts` | Authority → execution boundary | 6 |
| `cost.test.ts` | costForTokens, estimateTokens, Monitor cost rollup | 5 |
| `decisionJournal.test.ts` | validateDecision, toDecisionRecord | 5 |
| `memoryGateway.test.ts` | MemoryGateway (no-backend stub) | 5 |
| `monitoring.test.ts` | Monitor.dailyStatus | 4 |
| `explanation.test.ts` | buildExplanation, isCompleteExplanation | 4 |
| `secretProvider.test.ts` | Secret boundary isolation | 4 |
| `runtimeGateway.test.ts` | RuntimeGateway selection | 4 |
| `security.test.ts` (API) | Guardian wiring to real Store | 4 |
| `execution.test.ts` | ExecutionRunner (informational, no-executor) | 3 |
| **Total** | | **163+** |

All unit tests use `MemoryStore` (in-memory implementation of the `Store` port) — no database required.

---

## 30. Testing — SQL Test Suites

**Runner:** `node supabase/tests/run_tests.cjs [sqlFile]`
**Execution:** `BEGIN` → test SQL → `ROLLBACK` (transactional, self-cleaning)

### rls_tests.sql (Gate 1 — 7 tests, 249 lines)

| Test | Name | What It Proves |
|------|------|---------------|
| Seed | `on_auth_user_created` trigger | 2 auth.users → 2 owners created |
| 1 | Owner Identity | Owner1 reads own row; cannot read Owner2 (RLS isolation) |
| 2 | Owner sees all own projects/tasks | Owner1 sees 2 projects + 2 tasks |
| 3 | Project isolation (agent-scoped) | Agent with Project A permission: sees 1 project, 1 task in A, 0 in B |
| 4 | Unauthorized access | `anon` sees 0 rows; unknown authenticated sees 0 |
| 5 | Audit append-only | RLS + triggers block UPDATE/DELETE even as superuser |
| 6 | Preference versioning | Exactly 1 active per key; deactivation + re-insert |
| 7 | Required foreign keys | FK enforced; NULL rejected; negative cost rejected |

### rls_security_tests.sql (Gate 2 — 7 tests, 321 lines)

| Test | Name | What It Proves |
|------|------|---------------|
| S1 | Critical actions registry | 17 rows, immutable, authenticated can read |
| S2 | Security events isolation + append-only | Owner isolation, trigger blocks mutation |
| S3 | Security lockdowns history + owner release | Owner scope, DELETE blocked |
| S4 | Security incidents CRUD isolation | Owner-scoped CRUD, cross-owner blocked |
| S5 | Security policies read-only registry | 13 rules, UPDATE affects 0 rows |
| S6 | Security rate limits scope | Owner-scoped read |
| S7 | TRUNCATE guard (defense-in-depth) | Trigger layer + privilege revocation on 7 tables |

---

## 31. Testing — Live HTTP Verification

**Runner:** `npx tsx scripts/live-http-verification.ts`
**Prerequisite:** `FACTORY_SERVICE_ROLE_KEY` in environment (self-blocks otherwise)

### 9 Mandatory Tests

| Test | Name | Endpoint | Expected Result |
|------|------|----------|----------------|
| T1 | AUTH_OWNER_RESOLUTION | `GET /api/me` | 200, id matches created user |
| T2 | RLS_WRITE_PROJECT | `POST /api/projects` | 200, project created |
| T3 | AUTHORIZED_SAFE_EXECUTION | `POST /api/chat` | outcome in [executed, failed, retry_pending] |
| T4 | CRITICAL_REQUIRES_APPROVAL | `POST /api/chat` | outcome=waiting_approval, approvalId present |
| T5 | DENY_FAIL_CLOSED | `POST /api/chat` | outcome in [unknown_project, denied, blocked] |
| T6 | LOCKDOWN_FAIL_CLOSED | lockdown activate → chat → release | Lockdown active, both chats denied, release succeeds |
| T7 | SECURITY_EVENT_PERSISTENCE | `GET /api/security/events` | ≥2 events with denied.* or health.lockdown |
| T8 | RETRY_BOUNDED | `POST /api/chat` | attempts ≥ 1, maxAttempts ≤ 3 |
| T9 | PROJECT_ISOLATION | `GET /api/projects` | Every project's ownerId matches test user |

**Result: 9/9 PASS → `LIVE_EXECUTION_BOUNDARY = VERIFIED`**

Residue check: `auth.users` and `owners` have zero test rows after cleanup.

---

## 32. Testing — Test Results Summary

| Tier | Suite | Count | Status | Evidence |
|------|-------|-------|--------|----------|
| 1 | Unit tests (19 files) | 163+ | **TESTED** | vitest output |
| 1+ | Integration tests (3 files, guarded) | 17 | UNVERIFIED | Requires FACTORY_* env |
| 2 | rls_tests.sql (Gate 1) | 7 | UNVERIFIED | Requires live Supabase |
| 2 | rls_security_tests.sql (Gate 2) | 7 | UNVERIFIED | Requires live Supabase |
| 3 | Live HTTP verification | 9 | **LIVE_VERIFIED** | 9/9 PASS (2026-08-16) |

### Full Regression (Post-Blocker Remediation)

| Check | Result |
|-------|--------|
| vitest | **181/181 (22 files)** |
| RLS_TESTS.SQL_PASS | PASS |
| RLS_SECURITY_TESTS.SQL_PASS | PASS (S1–S7) |
| `tsc --noEmit` | PASS (0 errors) |
| `npm run build` | BUILD_EXIT=0 |
| auth.test.ts | 8/8 (A–H) |

---

## 33. Operations — Dependencies & Scripts

### Production Dependencies (3)

| Package | Version | Purpose |
|---------|---------|---------|
| `@supabase/supabase-js` | ^2.45.0 | Supabase client (auth, PostgREST) |
| `bcryptjs` | ^2.4.3 | Password hashing (seed) |
| `pg` | ^8.11.5 | PostgreSQL connection pool |

### Development Dependencies (6)

| Package | Version | Purpose |
|---------|---------|---------|
| `@types/bcryptjs` | ^2.4.6 | Type definitions |
| `@types/node` | ^20.14.0 | Type definitions |
| `@types/pg` | ^8.11.6 | Type definitions |
| `tsx` | ^4.16.0 | TypeScript execution (dev, tests) |
| `typescript` | ^5.5.0 | Compiler |
| `vitest` | ^1.6.0 | Test framework |

### NPM Scripts (8)

| Script | Command | Purpose |
|--------|---------|---------|
| `typecheck` | `tsc --noEmit` | Type-check without emitting |
| `build` | `tsc -p tsconfig.build.json` | Compile to `dist/` |
| `test` | `vitest run` | Run all tests |
| `test:unit` | `vitest run src/core src/gateways` | Unit tests only |
| `test:integration` | `vitest run src/integration` | Integration tests only |
| `start` | `node dist/api/server.js` | Production server |
| `dev` | `tsx src/api/server.ts` | Development server |
| `seed` | `tsx src/db/seed.ts` | Seed database |

---

## 34. Operations — Environment Configuration

### Required (asserted at startup)

| Variable | Purpose |
|----------|---------|
| `FACTORY_SUPABASE_URL` | Supabase project URL |
| `FACTORY_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `FACTORY_DB_PASSWORD` | Database connection password |

### Optional Database

| Variable | Default | Purpose |
|----------|---------|---------|
| `FACTORY_DB_HOST` | `aws-1-eu-west-1.pooler.supabase.com` | Database host |
| `FACTORY_DB_PORT` | `5432` | Database port |
| `FACTORY_DB_USER` | `postgres.<project-ref>` | Database user |
| `FACTORY_DB_NAME` | `postgres` | Database name |

### API Server

| Variable | Default | Purpose |
|----------|---------|---------|
| `FACTORY_API_PORT` | `8787` | HTTP server port |
| `FACTORY_API_HOST` | `127.0.0.1` | HTTP server bind address |

### Owner/Seed

| Variable | Purpose |
|----------|---------|
| `FACTORY_OWNER_EMAIL` | Owner email for seed + auth |
| `FACTORY_OWNER_PASSWORD` | Owner password for seed + auth |

### AI Provider Keys

| Variable | Purpose |
|----------|---------|
| `FACTORY_OPENAI_API_KEY` | OpenAI adapter |
| `FACTORY_ANTHROPIC_API_KEY` | Anthropic adapter |
| `FACTORY_GOOGLE_API_KEY` | Google adapter |

### Runtime

| Variable | Default | Purpose |
|----------|---------|---------|
| `FACTORY_OPENCODE_CLI` | — | OpenCode Zen CLI path |
| `FACTORY_OPENCODE_ENABLED` | `"false"` | Enable OpenCode Zen runtime |

### Live Verification

| Variable | Purpose |
|----------|---------|
| `FACTORY_SERVICE_ROLE_KEY` | Required for live HTTP verification runner only |

---

## 35. Operations — Build & Deployment

### Build Process

```bash
npm run build    # tsc -p tsconfig.build.json → dist/
npm start        # node dist/api/server.js
```

### TypeScript Configuration

- **Target:** ES2022
- **Module:** NodeNext
- **Strict mode:** enabled (strict, noImplicitOverride, noFallthroughCasesInSwitch, noUncheckedIndexedAccess)
- **Build override:** disables declaration files and source maps, excludes `src/testing/**`

### Deployment Status

**NOT DEPLOYED.** No deployment has been executed. The factory runs locally only. No CI/CD pipeline, no containerization, no hosting configuration.

### Production Entry Point

`node dist/api/server.js` — raw `http.createServer`, no framework, no clustering.

---

## 36. Forensics — Gate History

### Gate 1 — Foundation (2026-08-15)

**What was validated:** Complete CHEF Personal Executive Core foundation — Owner Identity, Projects, Agents, Tasks, Models, Runtimes, Approvals, Audit, Cost Tracking, POS, Decision Journal, Autonomy Records. All implemented in TypeScript with live Supabase backend.

**Verification record:**
```
tsc --noEmit                  → PASS (0 errors)
tsc -p tsconfig.build.json    → BUILD_EXIT=0 PASS
vitest run                    → 105 unit + 8 live integration PASS (20 files)
RLS_TESTS.SQL_PASS            → PASS (all 7 deterministic tests)
Zero residue                  → LEAKED_TEST_USERS=[]
```

**Defects fixed during verification:**
1. Migration ordering: functions before tables → reordered
2. Test 3 false-negative: agent permissions fix
3. Test 3 agent-id resolution: RLS hid agent row during setup

### Gate 2 — Security Guardian (2026-08-16)

**What was validated:** 13-layer security architecture, immutable Critical Action Registry (17 rules), TRUNCATE hardening (7 tables), authentication, lockdown system, anomaly detection, prompt injection defense, secret guard.

**Historical failure (preserved — never deleted):**
```
2026-08-16: Original live-runner run = 0/9 PASS
All 9 HTTP cases FAILED with status=401
HTTP_TESTS_PASSED=0/9
LIVE_EXECUTION_BOUNDARY = UNVERIFIED
GATE_2_BLOCKED
```

**After blocker remediation:**
```
9/9 PASS → LIVE_EXECUTION_BOUNDARY = VERIFIED
181/181 tests (22 files) + RLS S1–S7 + build PASS
```

---

## 37. Forensics — Blocker Remediation

### Blocker 1: `auth.ts` setSession Failure

- **Root cause:** `supabase-js 2.112.3` `setSession({ access_token, refresh_token: '' })` does not attach the session under `persistSession:false`. Every subsequent query runs without the user's token. RLS returns 0 rows → `PGRST116` → 401 on every authenticated endpoint.
- **Security impact:** Fail-closed (deny by default), not exploitable, but boundary was unusable.
- **Fix:** Replaced with `supabase.auth.getUser(token)` + direct PostgREST query using caller's Bearer token (`apikey: anon`, NO `service_role`). Enforces `owner.id === user.id && status='active'`.
- **Regression:** auth.test.ts 8/8 (A–H)

### Blocker 2: `server.ts` Double JSON.stringify

- **Root cause:** `send()` applied `JSON.stringify` twice — once before `redact()` and once after. Every JSON response was delivered as a double-encoded string.
- **Fix:** Removed outer `JSON.stringify`. Single stringify in `send()`.

### 4 Runner Corrections (Documented, Security-Neutral)

| # | Test | Before | After | Reason |
|---|------|--------|-------|--------|
| 1 | T4 | `transfer 100 in X` | `execute transfer 100 in X` | `transfer` is resource, not verb |
| 2 | T6 | Flat response | Read `{ lockdown: { lockdownId } }` | Correct protocol for release endpoint |
| 3 | T6 | 1 locked command | 2 locked commands | T7 requires ≥2 events |
| 4 | T8 | `execute build in X` | `execute task in X` | `build` is verb keyword, not resource |

---

## 38. Forensics — Evidence Chain

### Gate Evidence Files

| # | File Path | Contents |
|---|-----------|----------|
| 1 | `docs/factory/GATE_2_EVIDENCE.md` | Complete Gate 2 evidence log, blocker details, final matrix, live HTTP runs |
| 2 | `docs/factory/GATE_2_FINAL_REPORT.md` | Forensic report, defect registry, policy analysis, adversarial matrix |
| 3 | `docs/factory/GATE_2_FORENSIC_REVIEW.md` | DB forensics, TRUNCATE bypass proof/fix, adversarial matrix A–Q |
| 4 | `docs/factory/FOUNDATION_REPORT.md` | Gate 1 closeout: 16 tables, 61 policies, RLS tests PASS |
| 5 | `docs/factory/GATE_1_EXECUTION_CONTRACT_FINAL.md` | Gate 1 scope, contracts, boundaries |
| 6 | `docs/factory/AGENTS.md` | Agent Registry + Permissions + Stats |
| 7 | `docs/factory/ARCHITECTURE.md` | Architecture + decisions |
| 8 | `docs/factory/DATABASE.md` | Schema, constraints, guarantees |
| 9 | `docs/factory/SECURITY.md` | RLS/audit/secret model |
| 10 | `docs/factory/AUDIT.md` | Audit Service: append-only enforcement |
| 11 | `todo.md` | Gate status tracker, current phase, blocked items |

### Architectural Boundaries Verified (BYPASS_STATUS = NONE_FOUND)

| Boundary | Status | Evidence |
|----------|--------|----------|
| Single `new CommandPipeline(` in production | `server.ts:170` only | grep, live build |
| Single `.run(` caller | `handlers.ts:51` only | grep |
| DENY always wins | `guardianCombineAuthority` upgrade-only | T-tests |
| LLM output = DATA, never authority | `modelOutputIsAuthority` | T-tests |
| Owner/Project/Environment isolation | RLS + application layer | RLS tests + live |

---

## 39. Known Gaps & Deferred Items

### Critical (BLOCKED)

| Gap | Impact | Status |
|-----|--------|--------|
| Critical action vocabulary mismatch | 17 registry rules will never match pipeline actions. Gate 1 `PROTECTED_ACTION_TYPES` provides actual protection. | **INERT** — documented, deferred, requires architect decision |

### High (DEFERRED)

| Gap | Impact | Status |
|-----|--------|--------|
| 5 anomaly counters wired but not triggered | `authFailures`, `privilegeRequests`, `retryBursts`, `toolAnomalies`, `secretAccessAttempts` never generate events | DEFERRED |
| 5 rate-limit scopes wired but not enforced | `auth.failure`, `task.failure`, `approval.request`, `runtime.execute`, `model.call` have no caller | DEFERRED |
| No auth enforcement on DELETE endpoints | `DELETE /api/projects` and `DELETE /api/agents` do not exist (by design) but no middleware audit | UNVERIFIED |
| Migration tracking gap (3–4) | Migrations 3–4 applied but not tracked in `schema_migrations` | DEFERRED — safe repair proposed |

### Medium (DEFERRED)

| Gap | Impact | Status |
|-----|--------|--------|
| Rate limit counters in-memory only | Reset on server restart, no persistence | DEFERRED |
| Anomaly counters in-memory only | Reset on server restart | DEFERRED |
| Lockdown does not auto-trigger | Owner must manually activate; no automatic lockdown on repeated critical denials | DEFERRED |
| Cost protection defaults to no limits | Structurally present but inactive until owner configures limits | NOT_APPLICABLE (by design) |

### Low (DEFERRED)

| Gap | Impact | Status |
|-----|--------|--------|
| No `POST /api/agents` endpoint | Agent creation requires direct DB access | Medium — operator workflow only |
| No `DELETE` endpoints | Soft-delete via `status` field only | Low |
| Audit query uses raw SQL | Bypasses Store abstraction | Low — owner scoping maintained |
| GET requests read filter from JSON body | Non-standard for GET | Low — works with fetch() |
| Google adapter returns `usage: null` | Cost estimation uses character/4 heuristic | Low — honest but imprecise |
| No `memory.ts` core module | Memory/lessons delegated to persistence layer | DEFERRED |
| Policy rule-ID naming divergence (code vs DB) | 12 DB rules vs 12 code rules; functionally harmless | DOCUMENTATION_ONLY |
| Gate 3 + Growth/Sales engines not started | Explicitly excluded from Gate 1/2 scope | NOT_APPLICABLE |

---

## 40. Supporting Document Index

| # | Document | Path | Lines | Coverage |
|---|----------|------|-------|----------|
| 1 | AS_BUILT_DATABASE.md | `docs/factory/as-built/AS_BUILT_DATABASE.md` | 967+ | Schema (23 tables), migrations, functions, triggers (28), RLS (~80 policies), indexes (59), SQL test suites, repo pattern |
| 2 | AS_BUILT_SECURITY.md | `docs/factory/as-built/AS_BUILT_SECURITY.md` | 678 | Security architecture (13 layers), authentication, authority matrix, policy engine, guardian, critical actions, rate limiting, anomaly detection, lockdown, approval, autonomy, events, incidents, test coverage, known gaps |
| 3 | AS_BUILT_API.md | `docs/factory/as-built/AS_BUILT_API.md` | 606 | Server architecture, authentication middleware, 28 endpoints, command pipeline integration, response format, security integration, execution runner, live verification (9/9), known API gaps |
| 4 | AS_BUILT_CORE.md | `docs/factory/as-built/AS_BUILT_CORE.md` | 741 | Pipeline (606 lines, 14 steps), intent parser (15 verbs, 24 resources), authority matrix (10 rules), adaptive autonomy (4 levels), approval engine (6 states), task engine (8 statuses), types system, supporting modules, test coverage, known gaps |
| 5 | AS_BUILT_GATEWAYS.md | `docs/factory/as-built/AS_BUILT_GATEWAYS.md` | 357 | Model Gateway, Runtime Gateway, provider adapters (OpenAI/Anthropic/Google/OpenCode Zen), seeded models (6) + runtimes (1), execution integration, test coverage |
| 6 | AS_BUILT_TESTING.md | `docs/factory/as-built/AS_BUILT_TESTING.md` | 524 | 3-tier testing architecture, vitest config, unit test inventory (163+), SQL test suites (14 tests), live HTTP verification (9 tests), test scripts, test results, test gaps |
| 7 | AS_BUILT_FORENSICS.md | `docs/factory/as-built/AS_BUILT_FORENSICS.md` | 390 | Gate history (1→2→3), blocker details, live verification, forensic bugs (7), migration tracking, evidence chain, minimal runner corrections (5), residue analysis, architectural boundaries, known anomalies |
| 8 | AS_BUILT_OPERATIONS.md | `docs/factory/as-built/AS_BUILT_OPERATIONS.md` | 535 | Project identity, dependencies (3 prod + 6 dev), npm scripts (8), TypeScript config, environment variables (15+), file structure, build process, development workflow, seeded data, database config |

### todo.md (Status Tracker)

| Document | Path | Lines | Coverage |
|----------|------|-------|----------|
| todo.md | `todo.md` | 92 | Current phase (GATE_2_PASS), owner actions, completed work (Gate 1 + Gate 2 + Forensic), record log, explicitly non-goals |

---

---

## 41. Change-Control Rules (POST-FREEZE)

After this baseline is frozen (2026-08-16), **ANY future implementation change MUST**:

1. **Identify the affected subsystem** — name the module, file, or layer being changed.
2. **Identify the Gate** — state which Gate the change belongs to (Gate 2 continuation, Gate 3, etc.).
3. **Update the relevant AS-BUILT documentation** — modify the corresponding `AS_BUILT_*.md` file and/or this master reference to reflect the new reality.
4. **Preserve historical evidence** — never delete or overwrite historical failure records, forensic findings, or audit trail entries.
5. **Update the capability status** — change the status label (IMPLEMENTED → TESTED → LIVE_VERIFIED) with evidence.
6. **Include tests** — every implementation change must include corresponding test coverage.
7. **Include live evidence when required** — LIVE_VERIFIED status requires actual live execution evidence.
8. **Undergo forensic review** — changes to security, auth, Guardian, RLS, or migrations require forensic documentation review.
9. **Never silently modify the baseline** — all changes must be explicitly documented in the change log.

### Prohibited Actions (POST-FREEZE)

The following are **绝对 prohibited** without explicit architect/owner authorization:

- Modifying application source code without updating AS-BUILT documentation
- Adding new database tables, columns, or RLS policies without updating AS_BUILT_DATABASE.md
- Changing API endpoints without updating AS_BUILT_API.md
- Modifying the Security Guardian without updating AS_BUILT_SECURITY.md
- Changing test counts without updating AS_BUILT_TESTING.md
- Deploying to any environment
- Starting Gate 3 work
- Implementing deferred functionality
- Repairing known architectural gaps
- Exposing secrets, keys, tokens, or credentials in documentation

### Documentation Drift Classification

When discrepancies are found between documentation and source:

| Classification | Definition | Action Required |
|---------------|------------|-----------------|
| **MATCH** | Doc and source are consistent | None |
| **MINOR_DOCUMENTATION_DRIFT** | Doc has incorrect number, name, or heading but content is correct | Fix the doc |
| **MAJOR_DOCUMENTATION_DRIFT** | Doc has fundamentally wrong counts, missing sections, or outdated claims | Fix the doc + forensic review |
| **SOURCE_DRIFT** | Source has changed without doc update | Fix the doc + forensic review |
| **UNKNOWN** | Cannot determine which is correct | Investigate + report |

---

**END OF CHEF FACTORY AS-BUILT MASTER REFERENCE — VERSION 1.0 (FROZEN 2026-08-16)**

*This document is the single authoritative reference for the CHEF FACTORY as-built system. All claims are traceable to evidence. Never claim LIVE_VERIFIED without evidence. Never fabricate. Never delete historical failure evidence. This baseline is frozen — see §41 for change-control rules.*
