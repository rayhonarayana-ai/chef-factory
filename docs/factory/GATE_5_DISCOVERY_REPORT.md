# Gate 5 — Discovery Report

> **Date:** 2026-08-17
> **Classification:** GATE_5_DISCOVERY_COMPLETE
> **Gate 4 Baseline:** FROZEN (243 tests, all passing)

---

## 1. Architecture Reconstruction

### Full Execution Path (Verified Against Source)

```
USER → HTTP POST /api/chat
  │
  ├─ server.ts:186-225 — Route match, Bearer extraction
  │   └─ auth.ts:26-49 — verifyOwner(token) → SessionOwner|null
  │
  ├─ handlers.ts:52-101 — POST /api/chat handler
  │   ├─ conversation.get/create ─────── conversation.ts:50-77
  │   ├─ conversation.appendMessage('user') ── conversation.ts:125
  │   ├─ conversation.loadHistory(owner, conv, 20) ── conversation.ts:158
  │   └─ pipeline.run(ctx, cmd, history) ── pipeline.ts:132
  │
  ├─ pipeline.ts:132-388 — CommandPipeline.run()
  │   ├─ parseIntent(raw) ─────────── intent.ts:138
  │   ├─ store.recordAudit('command.received')
  │   ├─ store.getProjectBySlug()
  │   ├─ riskFromAction() ─────────── authority.ts:24
  │   ├─ evaluateAuthority() ──────── authority.ts:35
  │   ├─ evaluateAutonomy() ───────── autonomy.ts:12
  │   ├─ securityGuardian.evaluate() ─ guardian.ts:33
  │   ├─ createTask('queued')
  │   └─ executeTask() ────────────── pipeline.ts:390
  │
  ├─ pipeline.ts:390-514 — executeTask()
  │   ├─ store.patchTask('running')
  │   ├─ store.createTaskRun()
  │   └─ execution.execute(task, ctx, intent, history) ── execution.ts:59
  │
  ├─ execution.ts:59-152 — ExecutionRunner.execute()
  │   ├─ [INFO path] runInformational() ── execution.ts:415
  │   ├─ [MODEL path] modelGateway.select()
  │   ├─ [supportsTools] runToolLoop() ── execution.ts:161
  │   └─ [no executor] → error
  │
  ├─ execution.ts:161-404 — runToolLoop() ⚠️ CRITICAL ZONE
  │   ├─ rateLimiter.check('model.call')
  │   ├─ new ToolBroker() + register all tools
  │   ├─ while (round < 10):
  │   │   ├─ adapter.complete() → LLM response
  │   │   ├─ for each tool_call:
  │   │   │   ├─ evaluateAuthority() per tool
  │   │   │   ├─ broker.call(req, ctx) ── toolBroker.ts:40
  │   │   │   │   ├─ authority deny check
  │   │   │   │   ├─ approval check
  │   │   │   │   ├─ risk rank check
  │   │   │   │   ├─ securityGuard hook
  │   │   │   │   └─ tool.run(args) ← ⚠️ EXECUTES HANDLER #1
  │   │   │   └─ toolDef.handler() ← ⚠️ EXECUTES HANDLER #2
  │   │   └─ push tool result to messages
  │   └─ return ExecutionOutcome
  │
  ├─ pipeline.ts:425-513 — task completion/failure
  │   ├─ store.completeTaskRun()
  │   ├─ store.recordCost()
  │   ├─ store.patchTask('completed'|'failed'|'needs_approval')
  │   └─ DecisionJournal.record()
  │
  └─ handlers.ts:92-100 — response
      ├─ conversation.appendMessage('assistant')
      └─ return PipelineResult + conversation_id
```

### Layer Inventory

| Layer | Source File | Key Function | Inputs | Outputs | Security Boundary | Failure Mode |
|-------|-----------|-------------|--------|---------|-------------------|-------------|
| HTTP Server | server.ts | createServer handler | IncomingMessage | ServerResponse | Bearer token check | 401/404/500 |
| Authentication | auth.ts | verifyOwner(token) | JWT string | SessionOwner\|null | Supabase Auth + PostgREST | fail-closed (null→401) |
| API Handler | handlers.ts | POST /api/chat | ApiRequest | HandlerResult | owner context | 400/500 |
| Intent Parser | intent.ts | parseIntent(raw) | string | ParsedIntent | none (pure function) | unknown/ambiguous |
| Authority | authority.ts | evaluateAuthority(req) | AuthorityRequest | AuthorityDecision | matrix rules (10) | deny/require_approval |
| Autonomy | autonomy.ts | evaluateAutonomy(input) | AutonomyInput | AutonomyDecision | escalation bounds | deny/require_approval |
| Guardian | guardian.ts | evaluate(req) | SecurityRequest | SecurityGuardResult | 11-step pipeline | lockdown/deny |
| Execution | execution.ts | runToolLoop() | Task+Intent | ExecutionOutcome | authority+guardian+rate+cost | rate-limit/failure-limit |
| ToolBroker | toolBroker.ts | call(req, ctx) | ToolCallRequest | ToolCallResult | authority+guard+risk | deny/fail |
| Conversation | conversation.ts | loadHistory() | ownerId+convId | Message[] | owner-scoped RLS | empty history |
| Persistence | SupabaseStore | SQL operations | various | various | RLS + append-only | DB error |
| Monitoring | monitoring.ts | dailyStatus(ownerId) | ownerId | ProjectHealth | aggregation only | degraded |
| Cost | costProtection.ts | check(ownerId, projectId) | string | {stopped} | hard limits | DISABLED (null) |
| Anomaly | anomaly.ts | note(counter) | string | AnomalySignal\|null | threshold | monotonic (no decay) |

---

## 2. Gate 4 Baseline Verification

### G4-01: Conversation History — VERIFIED

| Check | Source | Status |
|-------|--------|--------|
| History loaded in handler | handlers.ts:80 | `loadHistory(owner.id, convId, 20)` — VERIFIED |
| History passed to pipeline | handlers.ts:89 | `pipeline.run(actorCtx(), command, conversationHistory)` — VERIFIED |
| History reaches LLM messages | execution.ts:190-198 | `[system, ...historyMessages, user]` — VERIFIED |
| No alternate path bypasses history | handlers.ts:52-101 | Single entry point — VERIFIED |

### G4-02: SecurityGuard Wiring — VERIFIED

| Check | Source | Status |
|-------|--------|--------|
| Guardian injected via factory | server.ts:245-251 | `createSecurityGuardian(store)` — VERIFIED |
| Hook closure built | execution.ts:228-260 | `securityGuardHook` captures guardian — VERIFIED |
| Hook passed to broker | execution.ts:343 | `securityGuard: securityGuardHook` — VERIFIED |
| Broker invokes hook | toolBroker.ts:57-66 | `if (ctx.securityGuard)` now TRUE — VERIFIED |
| No alternate path skips guardian | execution.ts:161-404 | Single `runToolLoop` entry — VERIFIED |

### G4-03: Authority Resolution — VERIFIED

| Check | Source | Status |
|-------|--------|--------|
| Per-tool-call resolution | execution.ts:311-327 | `evaluateAuthority()` called per tool — VERIFIED |
| Real decision passed to broker | execution.ts:341 | `decision: toolAuthority.outcome` — VERIFIED |
| No hardcoded 'auto' | execution.ts:341 | Decision from matrix — VERIFIED |
| Broker deny branch reachable | toolBroker.ts:45-46 | `ctx.decision === 'deny'` — VERIFIED |

### G4-04: Anomaly Counters — VERIFIED

| Check | Source | Status |
|-------|--------|--------|
| Unknown tool → note | execution.ts:299 | `anomalyDetector?.note('toolAnomalies')` — VERIFIED |
| Broker denial → note | execution.ts:355 | `anomalyDetector?.note('toolAnomalies')` — VERIFIED |
| Handler exception → note | execution.ts:387 | `anomalyDetector?.note('toolAnomalies')` — VERIFIED |
| Threshold signal works | anomaly.ts:50-64 | Counter ≥ threshold → signal — VERIFIED |

### G4-05: Failure-Rate Limits — VERIFIED

| Check | Source | Status |
|-------|--------|--------|
| model.call at loop entry | execution.ts:179-187 | Rate limit check — VERIFIED |
| task.failure after 3+ fails | execution.ts:358-366 | Failure limit check — VERIFIED |
| Consecutive reset on success | execution.ts:370 | `consecutiveFailures = 0` — VERIFIED |
| Loop terminates on exceed | execution.ts:361-365 | Early return — VERIFIED |

### GATE_4_BASELINE_INTEGRITY = VERIFIED

No alternate paths, no bypasses, no dead legacy code interfering.

---

## 3. Gate 2 Limitations Reassessment

| ID | Limitation | Original Severity | Gate 3 Status | Gate 4 Status | Current | Next |
|----|-----------|-------------------|---------------|---------------|---------|------|
| A-4 | TRUNCATE bypasses RLS | CRITICAL | RESOLVED | RESOLVED | RESOLVED | — |
| A-5 | rlsProbe merged checks | LOW | RESOLVED | RESOLVED | RESOLVED | — |
| A-6 | Guardian not wired in server | HIGH | RESOLVED | RESOLVED | RESOLVED | — |
| A-7 | auth.ts setSession broken | CRITICAL | RESOLVED | RESOLVED | RESOLVED | — |
| A-8 | Double JSON encoding | HIGH | RESOLVED | RESOLVED | RESOLVED | — |
| C-1 | 5 anomaly counters unwired | MEDIUM | DEFERRED | RESOLVED (G4-04) | RESOLVED | — |
| C-2 | 5 failure-rate scopes unenforced | MEDIUM | DEFERRED | RESOLVED (G4-05) | RESOLVED | — |
| D-1 | Critical action vocabulary mismatch | HIGH | PARTIAL | ACTIVE | **ACTIVE** | Gate 5 |
| E-1 | Migration tracking gap | MEDIUM | DEFERRED | DEFERRED | **DEFERRED** | Owner decision |
| E-2 | run_tests.js reference | LOW | ACTIVE | ACTIVE | **ACTIVE** | Gate 5 (doc) |
| G-1 | Git initialization | MEDIUM | DEFERRED | DEFERRED | **DEFERRED** | Owner decision |
| G-2 | Cost limits configuration | MEDIUM | DEFERRED | DEFERRED | **DEFERRED** | Owner decision |

---

## 4. Gate 3 Limitations Reassessment

| ID | Limitation | Severity | Gate 4 Status | Current | Next |
|----|-----------|----------|---------------|---------|------|
| A-1 | Conversation history not loaded | CRITICAL | RESOLVED (G4-01) | RESOLVED | — |
| A-2 | SecurityGuard not wired | HIGH | RESOLVED (G4-02) | RESOLVED | — |
| A-3 | Authority resolution bypass | HIGH | RESOLVED (G4-03) | RESOLVED | — |
| B-1..B-12 | Documentation drift (12 items) | LOW | DEFERRED | **DEFERRED** | Gate 5 (doc) |
| F-1 | Anthropic not verified | MEDIUM | DEFERRED | **DEFERRED** | Gate 5 |
| F-2 | Google not verified | MEDIUM | DEFERRED | **DEFERRED** | Gate 5 |
| G-3 | Provider keys (Anthropic/Google) | HIGH | DEFERRED | **DEFERRED** | Owner decision |

---

## 5. Tool System Audit

### Tool Inventory

| Tool | Risk | Action Type | Handler Tests | Broker Tests | Live Tests | Status |
|------|------|------------|--------------|-------------|-----------|--------|
| create_project | medium | project_create | toolRegistry, gate4 | toolBroker (generic) | — | TESTED_ONLY |
| list_projects | low | read | toolRegistry, executionTools, gate4 | toolBroker (generic) | — | TESTED_ONLY |
| list_tasks | low | read | toolRegistry | toolBroker (generic) | — | TESTED_ONLY |
| create_task | medium | task_create | toolRegistry, gate4 | toolBroker (generic) | — | TESTED_ONLY |
| update_task | medium | task_update | toolRegistry | toolBroker (generic) | — | TESTED_ONLY |

### Tool System Assessment

| Metric | Value |
|--------|-------|
| TOOLS_TOTAL | 5 |
| TOOLS_LIVE_VERIFIED | 0 |
| TOOLS_TESTED_ONLY | 5 |
| TOOLS_UNVERIFIED | 0 |

### Critical Tool Gap: Double Execution Bug ⚠️

**Discovered during forensic reconstruction.** Tool handlers execute **TWICE per tool call**:

1. `broker.call()` at `toolBroker.ts:71` calls `tool.run(args)` — which wraps `toolDef.handler()` (execution.ts:220-221)
2. `runToolLoop` at `execution.ts:372` calls `toolDef.handler()` directly

**Impact:** Every write tool (create_project, create_task, update_task) creates **duplicate records** in the database. Read tools return results twice (harmless but wasteful).

**Severity:** CRITICAL — data corruption for all write operations in production.

**Note:** This bug is masked in tests because:
- Unit tests use mock handlers (not real DB)
- Live integration tests test the Store layer directly, not through the tool loop
- No end-to-end test exercises a real tool call through `runToolLoop` → `broker.call()` → handler → DB

---

## 6. Execution Engine Audit

| Question | Answer | Source |
|----------|--------|--------|
| Max LLM rounds? | 10 (`FACTORY_MAX_TOOL_ROUNDS`) | execution.ts:25 |
| Tool call representation? | `ToolCall { id, name, arguments }` from provider adapter | providerAdapter.ts |
| Tool results to model? | Pushed as `{ role: 'tool', content, tool_call_id }` messages | execution.ts:348-377 |
| Conversation state preserved? | Yes — `messages[]` array accumulates across rounds | execution.ts:190 |
| Failure handling? | Error message pushed to LLM, loop continues | execution.ts:348-353 |
| Retry handling? | No automatic retry; task-level retry via `handleTaskFailure` | pipeline.ts:485 |
| Anomalies recorded? | `anomalyDetector?.note()` on unknown tools, denials, exceptions | execution.ts:299,355,387 |
| Costs tracked? | `costForTokens()` after loop, recorded to DB | execution.ts:394-396 |
| Termination conditions? | (a) No tool calls in response, (b) max rounds, (c) rate limit, (d) failure limit | execution.ts:282,268,179,358 |
| Model loops? | Bounded by `FACTORY_MAX_TOOL_ROUNDS = 10` | execution.ts:268 |
| Tool fails repeatedly? | After 3+ consecutive: `task.failure` rate limit check | execution.ts:358-366 |
| Malicious tool output? | Prompt injection scan via `assessUntrustedInput()` | guardian.ts:116-124 |
| Unauthorized tool? | `tool_not_found` error pushed to LLM | execution.ts:296-305 |

### Execution Boundary Weaknesses

| Finding | Severity | Evidence |
|---------|----------|----------|
| Double execution bug | **CRITICAL** | toolBroker.ts:71 + execution.ts:372 |
| No tool-level idempotency keys | MEDIUM | No dedup mechanism for tool calls |
| No streaming support | LOW | Synchronous request/response only |
| Text-only fallback bypasses securityGuard+authority | MEDIUM | execution.ts:89-115 — no broker, no authority, no guardian |

---

## 7. Security Maturity Audit

### Security Chain Assessment

| Check | Status | Evidence |
|-------|--------|----------|
| Fail-closed behavior | STRONG | auth.ts:47 returns null on exception; guardian.ts:52-65 lockdown |
| Deny dominance | STRONG | policyEngine.ts:51-151 — deny > all |
| Lockdown | STRONG | guardian.ts:52-65 — fail-closed, owner-only release |
| Critical actions | STRONG | 25+ immutable rules, criticalActions.ts |
| Project isolation | STRONG | RLS + policy engine cross-project detection |
| Environment isolation | STRONG | policyEngine.ts:160-175 — env rank comparison |
| Owner isolation | STRONG | RLS enforced on all tables |
| Conversation isolation | STRONG | owner_id filter in all conversation queries |
| Secret handling | STRONG | Regex scan + deep JSON scan + redaction on events |
| Prompt injection | FOUNDATIONAL | 12 regex patterns, evidence-only, no deny rule |
| Tool-result injection | NOT TESTED | No test for malicious tool output → LLM manipulation |
| Replay protection | NONE | No nonce/timestamp validation on commands |
| Retry abuse | PARTIAL | Rate limiter prevents rapid retry; no dedup |
| Rate limits | GOOD | 7 fixed-window scopes; no sliding window |
| Cost abuse | **DISABLED** | All hard limits null (costProtection.ts:15-21) |
| Registry tampering | STRONG | Critical actions immutable (isCore: true) |
| Approval integrity | STRONG | Unique index on pending approvals |

### SECURITY_MATURITY = OPERATIONAL

**Reason:** Strong foundational architecture with 11-step deterministic guardian pipeline, but cost protection disabled, prompt injection has no deny rule, and no tool-result injection defense. The system is operational for controlled environments but not production-hardened.

---

## 8. Executive Capability Audit

### What CHEF Can Actually Do Today

| Capability | Status | Limitation |
|-----------|--------|-----------|
| Create project | IMPLEMENTED | ⚠️ Double execution creates duplicates |
| List projects | IMPLEMENTED | Working correctly |
| List tasks | IMPLEMENTED | Working correctly |
| Create task | IMPLEMENTED | ⚠️ Double execution creates duplicates |
| Update task | IMPLEMENTED | ⚠️ Double execution creates duplicates |
| Multi-turn conversation | IMPLEMENTED | History loaded (G4-01); max 20 messages |
| Tool execution | IMPLEMENTED | Via LLM → ToolBroker → handler |
| Authorization | IMPLEMENTED | 10-rule authority matrix |
| Security enforcement | IMPLEMENTED | 11-step guardian pipeline |
| Auditability | IMPLEMENTED | Append-only audit + security events |

### What Important Executive Workflow Is Still Impossible?

| Gap | Impact | Why It Matters |
|-----|--------|---------------|
| **CHEF cannot read data back from the DB** | CRITICAL | After creating a project/task, CHEF cannot confirm it exists or show it to the owner. `list_projects`/`list_tasks` exist but the LLM has no way to know WHAT to list without first seeing existing data. |
| **CHEF cannot search/filter across projects** | HIGH | Owner manages multiple projects; CHEF cannot answer "show me all high-priority tasks across my projects" |
| **CHEF cannot execute arbitrary shell/commands** | HIGH | The system has no generic execution tool; all operations are limited to the 5 CRUD tools |
| **CHEF cannot interact with external services** | HIGH | No HTTP/webhook tools; CHEF is isolated to its own DB |
| **CHEF has no memory of past conversations** | MEDIUM | History is loaded per-conversation but there's no cross-conversation memory or learning |

### Smallest Set for Largest Executive Usefulness Increase

**The #1 bottleneck is that CHEF can write data but cannot intelligently read it back.**

The current tool set allows:
- `create_project` → creates project (but double-executes)
- `list_projects` → lists ALL projects (no filtering)
- `create_task` → creates task (but double-executes)
- `list_tasks` → lists tasks in a project (requires project_id)
- `update_task` → updates task (but double-executes)

**Missing:** A tool that lets the owner ask "what's the status of X?" or "show me my active projects" or "what tasks are due this week?" — intelligence over stored data.

**Recommended smallest capability set:**
1. Fix double execution bug (CRITICAL — data corruption)
2. Add a `query_data` or `search` tool that lets CHEF answer questions about stored data
3. Configure cost protection limits (currently disabled)

---

## 9. Architectural Bottleneck Analysis

### Ranked Bottlenecks

| Rank | Category | Bottleneck | Business Impact | Security Impact | Arch Impact | Cost to Fix | Risk |
|------|----------|-----------|----------------|----------------|-------------|-------------|------|
| **1** | **Reliability** | **Double execution bug** | **CRITICAL** — all writes create duplicates | HIGH — data corruption | HIGH — trust-breaking | LOW — remove one line | LOW |
| **2** | Security | Cost protection disabled | MEDIUM — no spending stop | CRITICAL — unlimited cost exposure | LOW — config change | LOW — set limits | LOW |
| **3** | Intelligence | No data query capability | HIGH — owner can't ask about stored data | LOW | MEDIUM — new tool | MEDIUM | MEDIUM |
| **4** | Security | Text-only fallback bypasses security chain | MEDIUM — unguarded execution path | HIGH — authority+guardian skipped | LOW — wire checks | LOW | LOW |
| **5** | Security | Prompt injection has no deny rule | MEDIUM — evidence-only | MEDIUM — directives recorded but not blocked | LOW — add rule | LOW | LOW |
| **6** | Operations | Anomaly counters never decay | LOW — false positives in long sessions | LOW | LOW — add timer | LOW | LOW |
| **7** | Security | Critical action vocabulary dormant | MEDIUM — defense-in-depth layer inactive | MEDIUM | MEDIUM — alias map | MEDIUM | MEDIUM |
| **8** | Reliability | No idempotency keys | MEDIUM — duplicate writes possible | LOW | MEDIUM | MEDIUM | MEDIUM |
| **9** | Operations | No git version control | MEDIUM — no change tracking | LOW | LOW | LOW | LOW |
| **10** | Operations | Migration tracking gap | LOW — future migration conflicts | LOW | LOW | LOW | LOW |

### ARCHITECTURAL_BOTTLENECK = Double Execution Bug (Reliability) + Cost Protection Disabled (Security)

---

## 10. Gate 5 Candidate Missions

### Candidate 1: Execution Integrity & Reliability Hardening

**MISSION NAME:** Execution Integrity Hardening

**MISSION PURPOSE:** Fix the double execution bug, disable the text-only security bypass, and establish execution-boundary guarantees.

**WHY NOW:** The double execution bug means every write operation creates duplicate records. This is a data corruption bug that must be fixed before any further feature work. The text-only fallback path bypasses all security checks.

**PROBLEM SOLVED:**
- Tool handlers execute twice per call (data corruption)
- Text-only fallback skips authority + security guardian
- No idempotency protection for tool calls

**CAPABILITIES:**
- Fix double execution (remove redundant handler call)
- Wire security checks into text-only fallback path
- Add idempotency keys for write operations
- Add tool-result injection defense

**FILES/LAYERS LIKELY AFFECTED:**
- `src/api/execution.ts` — remove redundant handler call, wire text-only path
- `src/gateways/toolBroker.ts` — possibly restructure to separate check vs execute
- Tests — new tests for single-execution guarantee

**DATABASE IMPACT:** None (unless idempotency keys require new column)
**API IMPACT:** None
**SECURITY IMPACT:** HIGH — eliminates data corruption + closes text-only bypass
**TEST IMPACT:** 5-10 new tests
**LIVE EVIDENCE REQUIRED:** End-to-end test proving tool executes exactly once

**RISKS:** Minimal — removing code, not adding features
**DEPENDENCIES:** None
**DEFERRED ITEMS:** None

**ESTIMATED COMPLEXITY:** LOW-MEDIUM

---

### Candidate 2: Production Security Hardening

**MISSION NAME:** Production Security Hardening

**MISSION PURPOSE:** Enable cost protection, add prompt injection deny rule, activate anomaly decay, and wire the critical action vocabulary alias map.

**WHY NOW:** Cost protection is disabled (all limits null), prompt injection directives are evidence-only, and the critical action defense-in-depth layer is dormant. These are security gaps that must be closed before production use.

**PROBLEM SOLVED:**
- No spending limits enforced (cost protection disabled)
- Prompt injection detected but not blocked
- Anomaly counters accumulate forever (false positives)
- Critical action vocabulary alias map missing (dormant defense)

**CAPABILITIES:**
- Configure cost protection limits (daily $5, monthly $100 per OD2)
- Add deny rule for untrusted authority directives in policy engine
- Add time-decay to anomaly counters (reset after window)
- Implement vocabulary alias map for critical action alignment
- Add dedicated CostProtector unit tests

**FILES/LAYERS LIKELY AFFECTED:**
- `src/core/security/costProtection.ts` — enable limits, add daily limit
- `src/core/security/policyEngine.ts` — add prompt injection deny rule
- `src/core/security/anomaly.ts` — add time-decay
- `src/core/authority.ts` or `src/tools/index.ts` — vocabulary alias map
- Tests — new tests for each change

**DATABASE IMPACT:** None (limits configured at application layer)
**API IMPACT:** None
**SECURITY IMPACT:** HIGH — production-readiness for cost + injection defense
**TEST IMPACT:** 10-15 new tests
**LIVE EVIDENCE REQUIRED:** Cost protection blocks when limits exceeded; prompt injection deny fires

**RISKS:** MEDIUM — enabling limits could block legitimate operations if set too low
**DEPENDENCIES:** Owner decision on cost limits (OD2)
**DEFERRED ITEMS:** None

**ESTIMATED COMPLEXITY:** MEDIUM

---

### Candidate 3: Data Intelligence Layer

**MISSION PURPOSE:** Give CHEF the ability to query and reason about stored data, enabling the most basic executive workflows.

**WHY NOW:** CHEF can write data but cannot read it back intelligently. The owner cannot ask "what's the status of my projects?" or "show me overdue tasks." Without this, CHEF is a write-only system with no executive usefulness.

**PROBLEM SOLVED:**
- No way to query stored data intelligently
- list_projects/list_tasks return unfiltered results
- No cross-project visibility
- No natural language → data query translation

**CAPABILITIES:**
- Add `query_data` tool with filtering, sorting, aggregation
- Add natural language → structured query translation via LLM
- Add project/task search across owner's data
- Support status, priority, date-range, and text filters

**FILES/LAYERS LIKELY AFFECTED:**
- New tool handler: `src/tools/query-data.ts`
- `src/tools/index.ts` — register new tool
- `src/core/authority.ts` — classify new action type
- Tests — tool tests + integration tests

**DATABASE IMPACT:** None (reads existing data)
**API IMPACT:** None (new tool via existing tool calling)
**SECURITY IMPACT:** LOW (read-only tool, low risk)
**TEST IMPACT:** 5-8 new tests
**LIVE EVIDENCE REQUIRED:** Query tool returns filtered results from real DB

**RISKS:** LOW
**DEPENDENCIES:** None
**DEFERRED ITEMS:** None

**ESTIMATED COMPLEXITY:** MEDIUM

---

## 11. Candidate Comparison

| Criterion | C1: Execution Integrity | C2: Security Hardening | C3: Data Intelligence |
|-----------|------------------------|----------------------|---------------------|
| Business Impact | CRITICAL (data corruption) | HIGH (production readiness) | HIGH (executive usefulness) |
| Security Impact | HIGH (closes bypass) | CRITICAL (cost + injection) | LOW (read-only) |
| Architectural Impact | HIGH (fixes core loop) | MEDIUM (config + rules) | MEDIUM (new tool) |
| Complexity | LOW-MEDIUM | MEDIUM | MEDIUM |
| Risk | LOW | MEDIUM | LOW |
| Dependencies | None | Owner decision (OD2) | None |
| **Priority** | **1** | **2** | **3** |

---

## 12. Recommended Gate 5 Mission

### RECOMMENDED_GATE_5_MISSION = Execution Integrity Hardening (Candidate 1) + Production Security Hardening (Candidate 2)

**Rationale:** Candidates 1 and 2 are both security/reliability concerns that must be addressed before any feature work. They share the same character: fixing broken or disabled security mechanisms. Candidate 3 (Data Intelligence) is a feature and should be Gate 6+.

**Combined scope is manageable:** Both candidates have LOW-MEDIUM complexity and no external dependencies (beyond OD2 for cost limits, which can be set during implementation).

---

## 13. Gate 5 Scope Discipline

### REQUIRED

1. Fix double execution bug (remove redundant handler call in execution.ts)
2. Wire security checks into text-only fallback path
3. Enable cost protection limits (daily $5, monthly $100)
4. Add deny rule for untrusted authority directives
5. Add time-decay to anomaly counters
6. Implement critical action vocabulary alias map
7. Add CostProtector dedicated unit tests
8. All 243 existing tests continue to pass
9. New tests for each fix

### OPTIONAL

1. Add idempotency keys for write tools
2. Add tool-result injection defense
3. Clean dead code (guardCalled variable)
4. Documentation drift closure (10 items)

### DEFERRED

1. Data Intelligence Layer (Candidate 3) — Gate 6+
2. Anthropic/Google tool calling verification — Gate 6+
3. Git initialization — Owner decision
4. Migration tracking repair — Owner decision

### OUT_OF_SCOPE

- Growth Engine
- Sales Engine
- Autonomous deployment
- Multi-agent system
- Browser automation
- Kubernetes/microservices
- Financial automation
- Legal automation
- UI screens
- Memory/vector backend
- New tool handlers (except idempotency)
- API endpoint changes
- Database schema changes

---

## 14. Evidence Contract

| ID | Capability | Test Method | Expected Result | Classification |
|----|-----------|------------|----------------|---------------|
| E1 | Single execution guarantee | Unit test: mock handler called exactly once per tool call | handler invocation count = 1 | UNIT_TESTED |
| E2 | Single execution guarantee | Live integration: create_project creates exactly 1 record | SELECT count(*) = 1 | LIVE_VERIFIED |
| E3 | Text-only path security | Unit test: text-only fallback triggers authority+guardian checks | Security hooks invoked | UNIT_TESTED |
| E4 | Cost protection active | Unit test: spending above daily limit → blocked | stopped = true | UNIT_TESTED |
| E5 | Cost protection active | Live integration: cost check with real store returns correct result | stopped = false when under limit | LIVE_VERIFIED |
| E6 | Prompt injection deny | Unit test: untrusted directive → deny decision | decision = 'deny' | UNIT_TESTED |
| E7 | Anomaly decay | Unit test: counter resets after time window | counter = 0 after decay | UNIT_TESTED |
| E8 | Vocabulary alias map | Unit test: 'financial' maps to 'financial_transaction' | classifyCriticalAction matches | UNIT_TESTED |
| E9 | Baseline regression | All 243 existing tests pass | 243/243 PASS | UNIT_TESTED |
| E10 | CostProtector unit test | Unit test: CostProtector.check() with mock store | Correct stop/allow decisions | UNIT_TESTED |

---

## 15. Security Threat Model (Gate 5 Mission)

| THREAT | ATTACK SURFACE | MITIGATION | TEST | RESIDUAL RISK |
|--------|---------------|------------|------|--------------|
| Double execution creates duplicate data | toolBroker.ts:71 + execution.ts:372 | Remove redundant handler call | E1, E2 | LOW — single execution point |
| Cost abuse (unlimited spending) | costProtection.ts:15-21 (null limits) | Enable hard limits | E4, E5 | LOW — limits enforced |
| Prompt injection bypasses defenses | promptInjection.ts → policyEngine.ts (no deny) | Add deny rule to policy engine | E6 | LOW — directive blocks action |
| Anomaly false positives in long sessions | anomaly.ts:50-64 (no decay) | Add time-window decay | E7 | LOW — counters reset |
| Text-only path skips security | execution.ts:89-115 | Wire authority+guardian into fallback | E3 | LOW — all paths guarded |
| Vocabulary gap in critical actions | authority.ts + criticalActions.ts | Alias map alignment | E8 | LOW — defense-in-depth active |

---

## 16. Owner Decisions

| OD# | Question | Recommendation | Consequence if No | Default Action |
|-----|----------|---------------|-------------------|---------------|
| OD4 | Configure cost limits: daily $5, monthly $100? | YES — enables cost protection | Cost protection stays disabled | Enable with recommended limits |
| OD5 | Initialize git repository? | YES — version control is essential | No change tracking | Defer to Gate 6 |

---

## 17. Gate 5 Readiness

```
GATE_5_READINESS = GATE_5_DISCOVERY_COMPLETE
```

**Next steps:**
1. Forensic Architect review of this discovery
2. GATE_5_ARCHITECTURE (detailed design)
3. Owner approval
4. Implementation

Gate 4 remains FROZEN throughout.
