# Gate 8 — Discovery Report

> Date: 2026-08-17
> Mode: DISCOVERY_ONLY
> Baseline: GATE_7_PASS_FROZEN (370/370)
> Objective: Identify the single highest-value architectural/product bottleneck remaining

---

## Executive Summary

CHEF FACTORY has a **world-class security and control plane** (13-layer security chain, append-only audit, RLS enforcement, cost protection, anomaly detection) and a **fully functional single-command execution engine**. However, the system is architecturally incapable of performing multi-step workflows. Every owner command executes exactly one task, produces one result, and terminates. The owner must manually orchestrate every sequence.

**The primary bottleneck is not security, not data, not intelligence — it is the absence of multi-step task orchestration.**

---

## Forensic Audit: 25 Capability Classifications

### A. Executive Capability

| # | Capability | Classification | Evidence |
|---|-----------|---------------|----------|
| 1 | Executive command processing | IMPLEMENTED | `pipeline.ts:132-388` — 12-stage pipeline, all paths produce structured explanations |
| 2 | Natural-language command parsing | IMPLEMENTED | `intent.ts:1-181` — pure function, 15 verbs, 30+ resources, ambiguity detection |
| 3 | Data retrieval intelligence | IMPLEMENTED | `query-data.ts` + `query-engine.ts` — 9 entities, DSL, aggregation, filtering, sorting |
| 4 | Data interpretation | PARTIALLY_IMPLEMENTED | System prompt (`execution.ts:481`) instructs model to "interpret results and respond naturally" but this depends entirely on the LLM's capability; no structured interpretation layer exists |
| 5 | Decision support | PARTIALLY_IMPLEMENTED | `decisionJournal.ts` records decisions; `explanation.ts` produces structured explanations; no proactive recommendation engine |
| 6 | Planning | INERT | No planning module exists. `intent.ts` can parse "plan" as a verb but `runInformational` has no planning handler |
| 7 | Task orchestration | PARTIALLY_IMPLEMENTED | `taskEngine.ts` has state machine + bounded retry, but pipeline creates ONE task per command; no dependency chains, no sequencing, no progress tracking |
| 8 | Tool execution | IMPLEMENTED | 6 tools via `ToolBroker` boundary — authority→risk→security→execute pattern |
| 9 | Multi-turn reasoning/context | PARTIALLY_IMPLEMENTED | `conversation.ts` persists messages (20-message window); `execution.ts:478` injects history; but no summarization, no context compression, 20-message hard limit |
| 10 | Authority/security enforcement | LIVE_VERIFIED | 13-layer chain in `guardian.ts` + `policyEngine.ts` — 370/370 tests pass, live Supabase verified |
| 11 | Cost protection | LIVE_VERIFIED | `$5/day, $100/month` hard limits in `costProtection.ts`; spike detection; budget per project |
| 12 | Failure recovery | IMPLEMENTED | `taskEngine.ts:handleTaskFailure` — bounded retry (max 3); but single-provider means failure = total failure |
| 13 | Auditability | LIVE_VERIFIED | 25 event types, append-only triggers, `audit_events` + `security_events` + `decision_journal` |
| 14 | Observability | PARTIALLY_IMPLEMENTED | `monitoring.ts` computes project health + daily status; `health.ts` computes 8 security health checks; no structured logging, no alerting, no dashboards |
| 15 | Idempotency | PARTIALLY_IMPLEMENTED | Pure functions are idempotent; tool execution is single-fire (G5-01); but `Store.recordCost` has no dedup key; `Store.recordAudit` has no dedup key |
| 16 | Concurrency | PARTIALLY_IMPLEMENTED | Query semaphore (3 per owner) in `query-data.ts`; no concurrent task execution management |
| 17 | Data freshness | LIVE_VERIFIED | All queries hit live Supabase; no caching layer; real-time reads |
| 18 | Evidence provenance | LIVE_VERIFIED | `decision_journal`, `explanation`, `security_events` all carry `evidence: string[]` arrays |

### B. Isolation Boundaries

| # | Capability | Classification | Evidence |
|---|-----------|---------------|----------|
| 19 | User/owner isolation | LIVE_VERIFIED | RLS policies on all 26 tables + application-layer `owner_id = $1` in every query |
| 20 | Project isolation | LIVE_VERIFIED | Subquery scoping + RLS + application layer; live verified in `gate6.live.integration.test.ts` T2/T3 |
| 21 | Conversation isolation | LIVE_VERIFIED | `conversation.ts:73,100,119,163` — all queries filter `owner_id = $2` at SQL level |

### C. Provider & Model Layer

| # | Capability | Classification | Evidence |
|---|-----------|---------------|----------|
| 22 | Provider resilience | MISSING | All 3 adapters (OpenAI, Anthropic, Google) make single `fetch()` with no retry, no timeout, no fallback. `openai.ts:36-46`: single HTTP call, throws on failure. No `AbortController`. No circuit breaker. |
| 23 | Model routing | IMPLEMENTED | `modelGateway.ts` — deterministic cost-based selection; capability matching; reasoning/tool/context filters |
| 24 | Autonomous action boundaries | IMPLEMENTED | `autonomy.ts` — bounded escalation (80% success + 5 history → auto from notify); protected classes pinned |
| 25 | Human approval boundaries | IMPLEMENTED | `approval.ts` — one-pending-per-task+action; terminal states; timeout support |

---

## Primary Architectural Bottleneck

### Finding: Single-Command Execution Model

**Severity: HIGH**

**Evidence:**

1. **Pipeline creates ONE task per command** (`pipeline.ts:374-387`):
   ```
   const task = await this.createTask(ownerId, intent, projectId, environment);
   const execResult = await this.executeTask(task, ctx, intent);
   ```
   There is no mechanism to create multiple tasks from a single command.

2. **ExecutionRunner processes ONE task** (`execution.ts:171-415`):
   The `runToolLoop` handles a single task with bounded tool rounds (max 10), but there is no outer loop for task sequences.

3. **No task dependency model** (`ports.ts`, `repo.ts`, `types.ts`):
   `TaskRecord` has a `parent_task_id` field but it is never set by any code path. There is no `depends_on`, `sequence_id`, or `workflow_id` field.

4. **No planner module**:
   `intent.ts` recognizes `plan` as a verb but `runInformational` (`execution.ts:426-472`) has no case for `plan` — it falls through to `dailyStatus`. There is no planning logic anywhere in the codebase.

5. **Owner must manually chain commands**:
   To create a project + 5 tasks + assign priorities, the owner must issue 7 separate commands. Each goes through the full 12-stage pipeline independently.

**Impact:**
This is the fundamental limitation preventing CHEF from functioning as an Executive AI system. The entire security, authority, cost, and audit infrastructure is designed for autonomous execution, but the execution surface is limited to single atomic commands. The owner spends more time orchestrating CHEF than CHEF spends executing.

**What this blocks:**
- Multi-step project setup (project → tasks → assignments → priorities)
- Batch operations (update 10 tasks at once)
- Conditional workflows (if X then Y else Z)
- Scheduled/deferred execution
- Progress tracking across steps
- Automatic retry of failed sequences

---

## Secondary Bottlenecks

### Finding: No Provider Resilience

**Severity: HIGH**

**Evidence:**

1. `openai.ts:36-46` — single `fetch()` call, no retry
2. `anthropic.ts:36-52` — single `fetch()` call, no retry
3. `google.ts:38-55` — single `fetch()` call, no retry
4. `execution.ts:203-225` — single model selection, no failover
5. No `AbortController` or timeout in any adapter
6. No circuit breaker pattern

**Impact:** A single API failure (network timeout, rate limit, provider outage) causes the entire command to fail. No retry, no alternative provider, no graceful degradation.

### Finding: Context Window Degradation

**Severity: MEDIUM**

**Evidence:**

1. `conversation.ts:47` — `MAX_HISTORY = 20` messages
2. `conversation.ts:158-181` — `loadHistory` fetches ALL messages then slices to last 20
3. No summarization, no compression, no context window management
4. Messages beyond 20 are silently dropped

**Impact:** Long conversations lose critical early context. The model cannot reference decisions made more than 20 messages ago.

### Finding: Memory Layer Inert

**Severity: MEDIUM**

**Evidence:**

1. `memoryGateway.ts:30-31` — `recall()` returns `[]`, `configured: false`
2. No vector backend configured
3. `repo.ts:recall()` — stub, returns `[]`
4. `repo.ts:saveLesson()` — persists to `memory_lessons` but nothing reads them back meaningfully

**Impact:** No institutional memory. CHEF cannot learn from past interactions, remember preferences beyond POS, or recall past decisions.

---

## Gap Analysis Matrix

| Gap | Type | Severity | Solvable Without Gate 7 Violation? | Smallest Mission |
|-----|------|----------|-------------------------------------|------------------|
| No multi-step orchestration | Orchestration | HIGH | Yes (additive, no schema changes needed) | Planner + task chain |
| No provider resilience | Provider | HIGH | Yes (adapter-level only) | Retry + timeout + failover |
| Context window degradation | Intelligence | MEDIUM | Yes (conversation layer only) | Summarization |
| Memory layer inert | Intelligence | MEDIUM | Yes (gateway layer only) | Vector backend integration |
| No streaming | Product | MEDIUM | Yes (adapter + API layer) | SSE streaming |
| Limited write tools | Product | LOW | Yes (additive tools) | Approval/agent/project tools |
| No structured logging | Observability | LOW | Yes (additive) | Structured logger |

---

## Security Regression Check

| Check | Status | Evidence |
|-------|--------|----------|
| ToolBroker boundary | PRESERVED | `toolBroker.ts` unchanged |
| SecurityGuardian chain | PRESERVED | `guardian.ts` unchanged |
| Authority resolution | PRESERVED | `authority.ts` unchanged |
| Rate limiting | PRESERVED | `rateLimit.ts` unchanged |
| Cost protection | PRESERVED | `costProtection.ts` unchanged |
| Prompt injection defense | PRESERVED | `promptInjection.ts` unchanged |
| RLS enforcement | PRESERVED | No schema changes |
| Owner isolation | PRESERVED | All queries scoped by owner_id |
| Audit trail | PRESERVED | Append-only triggers intact |
| Lockdown mechanism | PRESERVED | No changes |

**ZERO security regressions detected.**

---

## Source/Documentation Drift Analysis

| Check | Status | Details |
|-------|--------|---------|
| ARCHITECTURE.md accuracy | MINOR_DRIFT | Documents "17 immutable rules" in critical_actions but source has 24 rules (Gate 5-6 additions) |
| Critical action count | DOCUMENTATION_DRIFT | Doc says 17; actual is 24 (6 added in Gate 5-6) |
| todo.md accuracy | ACCURATE | All Gate statuses match source reality |
| SECURITY.md accuracy | MINOR_DRIFT | Does not reflect Gate 7 query hardening additions |
| Other docs | ACCURATE | Gate-specific docs match their respective implementations |

**DOCUMENTATION_DRIFT = 2** (minor, non-blocking)

---

## Recommendation

The forensic evidence conclusively demonstrates that the **single highest-value remaining bottleneck is the absence of multi-step task orchestration**. This is the architectural boundary that prevents CHEF from becoming a genuinely useful Executive AI system.

Everything else (security, data, authority, cost, audit) is production-ready. The system is safe, isolated, audited, and cost-controlled. But it can only do one thing at a time, and the owner must manually plan every sequence.

**Gate 8 should solve multi-step orchestration.**
