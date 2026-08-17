# CHEF FACTORY — GATE 1 EXECUTION CONTRACT (FINAL)

**STATUS:** ARCHITECTURALLY APPROVED — IMPLEMENTATION CONTROL DOCUMENT
**VERSION:** FINAL
**DATE:** 2026-08-15
**GATE:** GATE 1 — CHEF PERSONAL EXECUTIVE CORE
**GOVERNING DOCUMENT:** CHEF_FACTORY_MASTER_REFERENCE_FINAL.md

> This contract is the executable definition of Gate 1. It defines WHAT Gate 1 must
> deliver, the boundaries it must respect, and the evidence required for closure.
> Gate 1 implementation begins only after owner approval of the specification documents
> and configuration of the independent Factory Supabase.

---

## 1. Scope

Implement the **CHEF PERSONAL EXECUTIVE CORE** — the deterministic foundation for Owner
Identity, Project management, Agents, Tasks, Models, Runtimes, Approvals, Audit, Cost,
the Personal Operating System, the Decision Journal, and Autonomy Records.

## 2. Core Registries

- **Owner Identity** — via Factory Supabase Auth. Separation of Authentication from
  Authorization. No agent may impersonate the owner.
- **Project Registry** — registered projects, each an independent logical scope.
- **Project Passport** — structured per-project record; unknown fields remain UNKNOWN.
- **Agent Registry** — registered agent identities with scope and capabilities.
- **Agent Permissions** — least-privilege permission grants per agent.
- **Task Engine** — task/mission persistence with lifecycle:
  `CREATED → QUEUED → RUNNING → COMPLETED` plus safe failure/cancel states.
- **Model Registry** — registered models with capability/cost metadata.
- **Runtime Registry** — registered runtimes with capability/cost metadata.
- **Approval Engine** — approval requests, decisions, and persistence.
- **Audit Service** — append-oriented, secret-free audit trail.
- **Cost Tracking** — model/runtime/tool/mission/project cost persistence with basic limits.

## 3. Executive Layers

- **Command / Intent Layer** — parses owner commands into structured intent; ambiguity
  must NOT be converted into fabricated certainty.
- **Authority Matrix** — maps WHO/WHAT/WHERE/PROJECT/ENVIRONMENT/PERMISSION → outcome
  (`AUTO` | `NOTIFY` | `REQUIRE_APPROVAL` | `DENY`). Explicit DENY always wins.
  Production-sensitive, destructive, financial, legal, and account-security actions
  default to `REQUIRE_APPROVAL`.
- **Adaptive Autonomy Controller** — adaptive autonomy with bounded escalation;
  historical success never grants unlimited authority.
- **Personal Operating System (basic)** — versioned owner preferences; must never
  override security, isolation, authority, or explicit DENY.
- **Decision Journal** — persistence of decision records (see structure in Master
  Reference §18).
- **Explanation Layer** — significant actions expose Decision, Why, Evidence, Confidence,
  Risk. "Done." alone is never a complete explanation.
- **Basic Proactive Monitoring** — project health, active/blocked tasks, failures,
  pending approvals, cost, alerts, owner decisions required.
- **Basic Daily Status** — derived from monitoring.

## 4. Gateways

- **ModelGateway + ProviderAdapter + ModelRegistry** — model-agnostic; adapters may
  include OpenAI, Anthropic, Google as available. No provider is the architectural core.
  Selection considers capability, reasoning, latency, cost, context, reliability, task
  type, security policy, availability.
- **RuntimeGateway + RuntimeAdapter** — runtime-agnostic; OpenCode/OpenCode Zen allowed as
  an initial adapter, NOT the architectural core. Future runtimes addable without redesign.
- **ToolBroker (boundary)** — every external action passes: Authority → Project →
  Environment → Risk → Approval → ToolBroker → Audit. No raw unrestricted tools exposed
  to agents. No full browser automation.
- **SecretProvider (boundary)** — secrets isolated from prompts, logs, audit, decision
  journal, memory, UI. Never printed. Future secure backends supported.
- **Memory Gateway (boundary)** — persistent memory behind an abstraction. Gate 1 supports
  the boundary; concrete vector store only if `agent_memory.py`/ChromaDB present (currently
  NOT present — verified). Memory must not override authority, security, project scope, or
  explicit owner decisions. Recall before significant work; save validated lessons after
  verified reusable success; never save secrets.

## 5. Database — Independent Factory Supabase

Target: an **independent Factory Supabase project** (never Qarayti.ai / PROOFOS / Tadbir).
Proper migrations with primary keys, foreign keys, timestamps, constraints, indexes,
uniqueness, status constraints, and project scope where applicable.

Minimum conceptual tables:

```
owners                    users / owners identity
projects
project_environments
agents
agent_permissions
tasks
task_runs
models
runtimes
approvals
audit_events
cost_events
personal_preferences
decision_journal
autonomy_records
```

> Naming note: the source uses "users / owners". Canonical Gate 1 table name: `owners`
> (conservative resolution, recorded in the Consistency Audit; owner confirmation trivial).

## 6. Security (Mandatory)

- Supabase Auth (Authentication)
- RLS (Authorization, database-enforced — never rely solely on frontend checks)
- Project isolation (Project A cannot access Project B)
- Least privilege
- Audit (append-oriented, secret-free)
- No secret logging
- Authorization before execution
- Approval for production-sensitive and destructive actions
- Retry limits (default max 3 consecutive attempts per failure class unless explicitly
  authorized)
- Basic cost limits

## 7. Model Support

Gate 1 remains model agnostic. Provider adapters may include OpenAI, Anthropic, Google
as available. No provider is mandatory as the architectural core. Provider choice must
not be part of business logic.

## 8. Runtime Support

Runtime architecture remains runtime agnostic. OpenCode Zen may be the initial runtime
adapter. It must not be hard-coded into core governance.

## 9. Memory

Gate 1 supports a basic memory boundary. If `agent_memory.py` / ChromaDB is used, it must
be behind an abstraction. Memory must not override authority.

## 10. Control Plane UI (basic, mobile-friendly)

Usable basic screens — do not over-design:

```
CHEF Chat | Projects | Project Passport | Agents | Tasks
Approvals | Costs | Audit | Daily Status
```

## 11. Quality Requirements

- Deterministic logic preferred
- Typed contracts
- Clean boundaries
- Modular, reusable components
- Minimal dependencies
- Low operational cost
- **No microservices**
- Cost-first: cheapest capable model; frontier only when justified

## 12. Testing & Verification

Tests required (where applicable): Command parsing, Authority, Autonomy, Approval, Task
lifecycle, Model abstraction, Runtime abstraction, Memory boundary, Secret boundary, Cost
controls, Audit, Decision Journal, Project isolation.

Run: typecheck, build, unit tests, integration tests where available.

## 13. Explicit Gate 1 Non-Goals

See Master Reference §32. Additionally: do not implement Security Guardian, Growth
Engine, full multi-agent autonomy, real browser automation, autonomous production
deployment, financial transfers, or binding legal execution. Do not deploy.

## 14. Exception / Stop Conditions

- If the independent Factory Supabase is unavailable → STOP; return `FACTORY_SUPABASE_REQUIRED`.
- If a verified architecture conflict with the Master Reference exists → STOP; do not
  silently resolve; surface for review.
- Repeated failure > 3 → STOP, preserve state, notify owner.

## 15. Closure Evidence

Gate 1 closes only under the Forensic Verification Protocol (Master Reference §31) with
classification per component: IMPLEMENTED / TESTED / LIVE_VERIFIED / UNVERIFIED / BLOCKED /
NOT_APPLICABLE. Closure authority belongs to the architecture/review process, not the
implementer.

---

**END OF GATE 1 EXECUTION CONTRACT — FINAL.**
