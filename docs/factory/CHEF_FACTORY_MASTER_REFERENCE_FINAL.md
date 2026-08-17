# CHEF FACTORY — MASTER REFERENCE (FINAL)

**STATUS:** ARCHITECTURALLY APPROVED — IMPLEMENTATION CONTROL DOCUMENT
**VERSION:** FINAL
**DATE:** 2026-08-15
**GOVERNING PROMPT:** CHEF FACTORY — MASTER PROMPT V3.0 (Architectural Freeze & Specification Bootstrap)

> This document is the source of truth for the CHEF Factory architecture.
> Implementation begins only after the owner approves the resulting documents
> and the independent Factory Supabase is configured.

---

## 1. Executive Vision

CHEF is a personal executive AI deputy and the control-plane intelligence of an AI
Company Factory. The Factory is designed to eventually research, design, build, test,
deploy, operate, market, sell, lease, and maintain AI applications and enterprise
platforms.

**VISION ≠ CURRENT IMPLEMENTATION.** Future capabilities are explicitly separated from
Gate 1. This document governs the architecture; Gates deliver it progressively.

## 2. Mission

CHEF's long-term mission is to become the owner's personal executive technology deputy,
coordinating specialized AI agents able to: RESEARCH, PLAN, ARCHITECT, DESIGN, BUILD,
TEST, DEPLOY, OPERATE, MONITOR, MARKET, SELL, LEASE, MAINTAIN, LEARN.

The Factory should eventually support many product categories: AI applications, SaaS
platforms, enterprise systems, educational platforms, business automation systems, AI
agents, AI tools, internal tools, APIs, mobile applications, web applications, and data
products — implemented progressively through future Gates.

## 3. Architecture Principles

1. **Evidence Before Claims**
2. **CHEF NEVER ASSUMES AUTHORITY**
3. **Human ownership remains ultimate authority**
4. **Project Isolation**
5. **Model Agnostic architecture**
6. **Runtime Agnostic architecture**
7. **Cost First**
8. **Security by architecture**
9. **Audit Everything**
10. **Deterministic logic wherever possible**
11. **Least Privilege**
12. **Human-in-the-Loop for critical actions**
13. **No fabricated evidence**
14. **No hidden autonomous behavior**
15. **No uncontrolled retry loops**
16. **No vendor lock-in**
17. **Gate-by-Gate development**
18. **Every Gate requires forensic verification before closure**

## 4. CHEF Executive Model

CHEF is NOT simply a chatbot. It consists conceptually of: Identity, Authority, Context,
Memory, Planning, Decision, Execution, Verification, Audit, Learning.

The fundamental lifecycle:

```
OWNER → COMMAND → INTENT → CONTEXT → PROJECT → ENVIRONMENT → AUTHORITY → RISK
→ AUTONOMY → APPROVAL IF REQUIRED → TASK → EXECUTION → VERIFICATION → AUDIT
→ EXPLANATION → OUTCOME → LEARNING
```

Ambiguity MUST NOT be converted into fabricated certainty. Unknown remains UNKNOWN.

## 5. Personal Operating System (POS)

CHEF maintains a POS representing the owner's durable working preferences: coding
preferences, architecture preferences, quality standards, documentation standards,
communication preferences, risk tolerance, budget policies, preferred tools, preferred
models, preferred runtimes, and decision patterns.

- Preferences MUST be versioned.
- Agents receive only the minimum context required.
- POS MUST NEVER override: security policy, project isolation, authority policy,
  explicit DENY, or system constraints.

## 6. Authority Model

CHEF NEVER ASSUMES AUTHORITY. Every meaningful action must pass:

```
WHO? WHAT? WHERE? WHICH PROJECT? WHICH ENVIRONMENT? WHICH PERMISSION?
WHAT RISK? WHAT AUTONOMY? WHAT APPROVAL?
```

Outcomes: `AUTO` | `NOTIFY` | `REQUIRE_APPROVAL` | `DENY`.

**Explicit DENY always wins.**

Defaults to `REQUIRE_APPROVAL` for:
- Production-sensitive actions
- Destructive operations
- Financially binding actions
- Legal commitments
- Account ownership / security changes

## 7. Adaptive Autonomy

Autonomy must be adaptive. Inputs may include: agent history, success rate, risk,
project, scope, environment, action type, owner policy, previous decisions.

**Historical success MUST NOT automatically grant unlimited authority.** Production and
destructive operations remain protected. Decision outcomes are recorded in `autonomy_records`.

## 8. Project Isolation

Every Factory-managed project is an independent logical scope. CHEF must never mix
Project A with Project B. Every relevant operation carries project context. Isolation
exists at: Application layer, Authorization layer, Database layer, Memory layer, Agent
layer, Task layer, Audit layer.

## 9. Project Passport

Every managed project has a structured Project Passport. Unknown information is UNKNOWN —
never fabricated. Passport may contain: identity, description, technology, repository,
database, environment, deployment, dependencies, models, runtimes, business model,
status, risks, owners, credentials references, operational health, documentation state.

## 10. Agent Architecture

CHEF is the executive coordinator. Future specialized agents may include: CEO/Strategy,
Architect, Full-Stack, Frontend, Backend, Database, AI, QA, Security, DevOps, SRE,
Research, Growth Marketing, Sales, Documentation, Finance/Business Analysis.

**Dynamic multi-agent teams are NOT part of Gate 1.** Gate 1 establishes the foundations
they require.

## 11. Model Gateway

CHEF MUST NOT depend architecturally on one AI provider. Introduce `ModelGateway`,
`ModelRegistry`, `ProviderAdapter`. Architecture must support: OpenAI, Anthropic,
Google, open-source/local models, and future providers.

Model selection may consider: capability, reasoning requirement, latency, cost, context
requirements, reliability, task type, security policy, availability.
**No provider is the permanent architectural core.**

## 12. Runtime Gateway

Introduce `RuntimeGateway`, `RuntimeRegistry`, `RuntimeAdapter`. OpenCode / OpenCode Zen
may be supported as a runtime adapter but MUST NOT become the architectural core. Future
runtimes must be addable without redesigning CHEF. Selection may consider: capability,
cost, execution environment, latency, security, task type, availability.

## 13. Memory Architecture

Persistent memory, conceptually separated into: Operational Memory, Personal Memory,
Development Experience, Marketing Experience, Project Knowledge, Decision History.

Use a **Memory Gateway** abstraction. Current implementation may use `agent_memory.py`,
ChromaDB, or local embeddings **if available** — these are implementation choices, NOT
permanent architectural dependencies.

**Memory MUST NOT override:** authority, security, project scope, explicit owner decisions.

> Verified repository state: `agent_memory.py` is NOT PRESENT. No vector store is
> configured. This remains UNKNOWN/UNCONFIGURED until a later Gate introduces one behind
> the abstraction.

## 14. Recall Loop

Before significant work: RECALL — search existing knowledge and experience for reusable
architecture, boilerplate, prior bugs, previous solutions, project lessons, marketing
lessons, implementation patterns. Do not rebuild known solutions unnecessarily.

## 15. Learning Loop

After a verified successful reusable outcome: LEARN — record the lesson with enough
context to be useful later. NEVER save passwords, API keys, tokens, private secrets, or
sensitive credentials.

## 16. ToolBroker

All meaningful external tool operations pass through a security boundary: `ToolBroker`.
It must support: identity, authorization, project scope, environment scope, risk,
approval, audit. Never expose raw unrestricted tools directly to agents.

## 17. SecretProvider

Secrets MUST be isolated from: LLM prompts, memory, audit logs, decision journals, UI,
normal application data. Use a `SecretProvider` boundary. Architecture must allow future
secure secret backends. Never print secrets.

## 18. Decision Journal

Important decisions recorded with minimum conceptual structure:

```
decision_id, owner_id, project_id, context, options_considered, selected_option,
reason, evidence_references, confidence, risk_level, authority_level, approved_by,
outcome, timestamp
```

CHEF must eventually answer: WHY WAS THIS DECISION MADE?

## 19. Decision Precedent

CHEF should eventually learn from previous decisions. Gate 1 establishes only: interface,
basic persistence, basic retrieval boundary. A complete precedent engine belongs to a
future Gate.

## 20. Explanation Layer

For significant actions CHEF explains: Decision, Why, Evidence, Confidence, Risk, Outcome.
**CHEF must never use "Done." as the complete explanation of a significant operation.**

## 21. Audit

Important operations are auditable. Audit captures lineage: who, what, when, where,
project, environment, authorization, decision, outcome. **Audit must not contain secrets.**
Audit is append-oriented.

## 22. Cost Governance

Cost is a first-class architectural concern. Track: model cost, runtime cost, tool cost,
task cost, project cost, campaign cost. Controls support: budget limits, task limits,
retry limits, provider selection, cost-aware model routing. **Use the cheapest capable
model; use frontier reasoning only when justified; never make provider choice part of
business logic.**

## 23. Anti-Infinite-Loop

Repeated failure of the same operation: **maximum default retries = 3.** After 3
consecutive failures: STOP, RECORD FAILURE, PRESERVE STATE, NOTIFY OWNER, REQUEST HUMAN
INTERVENTION. Never burn unlimited model/runtime credits.

## 24. Human-in-the-Loop

CHEF may prepare plans, code, deployment plans, marketing plans, sales materials,
financial projections, legal drafts. CHEF may NOT independently finalize: binding legal
agreements, financial transfers, movement of real capital, ownership transfers, or
irreversible high-risk actions — without explicit owner authorization.

## 25. Reporting

CHEF eventually provides: Daily, Weekly, Project, Agent, Cost, Risk, Decision, Execution
reports. Gate 1 establishes the basic reporting foundation. Advanced analytics belong to
future Gates.

## 26. Marketing / Sales Vision

Long-term Factory may include: Market Research, Competitive Research, Website Marketing,
Content Generation, SEO, Launch Campaigns, App Marketplace Sales, SaaS Leasing, Direct
Sales, Lead Generation, Customer Management. **Future capabilities — NOT part of Gate 1.**

## 27. Deployment Vision

Long-term support: Vercel, Cloudflare, AWS, other clouds, mobile distribution, SaaS
infrastructure. Deployment governed by environment, risk, authority, approval, audit.
**Autonomous production deployment is NOT a Gate 1 capability.**

## 28. Multi-Tenancy

Architecture must be future-ready for multi-tenancy. **Gate 1 is NOT a complete SaaS
multi-tenant platform. Do not over-engineer multi-tenancy now.**

## 29. Factory Database

The Factory MUST have an **independent Supabase project**. It must never use Qarayti.ai
Supabase, PROOFOS Supabase, or Tadbir Supabase. The Factory database is operational
infrastructure for CHEF — not a product database.

## 30. Gate Roadmap

- GATE 1 — CHEF PERSONAL EXECUTIVE CORE
- GATE 2 — SECURITY GUARDIAN
- GATE 3 — KNOWLEDGE + MEMORY INTELLIGENCE
- GATE 4 — MULTI-AGENT DEVELOPMENT TEAMS
- GATE 5 — AUTONOMOUS BUILD + QA
- GATE 6 — DEPLOYMENT + OPERATIONS
- GATE 7 — GROWTH + MARKETING
- GATE 8 — SALES + MONETIZATION
- GATE 9 — FACTORY OPTIMIZATION + SCALING

The exact roadmap may evolve. **Future Gates must never be implemented prematurely.**

## 31. Forensic Verification Protocol

No Gate is closed because code exists. Every Gate must distinguish:
`IMPLEMENTED` | `TESTED` | `LIVE_VERIFIED` | `UNVERIFIED` | `BLOCKED` | `NOT_APPLICABLE`.

- Static code is not live evidence.
- Tests are not automatically live evidence.
- Documentation is not automatically proof.

Final closure authority belongs to the architecture/review process, **not** the
implementation agent itself.

## 32. Explicit Non-Goals for Gate 1

NOT implemented in Gate 1: Full Security Guardian; Full Risk Engine; Full Anomaly
Detection; Emergency Lockdown; Full Knowledge Graph; Full Knowledge Vault; Dynamic
autonomous multi-agent teams; Real browser automation; Autonomous production deployment;
Advanced DevOps orchestration; Full Growth Engine; Full Sales Engine; Full Exit Engine;
Voice infrastructure; Kubernetes; Microservices; Complete multi-tenant SaaS; Advanced
precedent engine; Advanced autonomous learning; Full marketplace automation; Financial
transfers; Binding legal execution.

---

**END OF MASTER REFERENCE — FINAL.**
