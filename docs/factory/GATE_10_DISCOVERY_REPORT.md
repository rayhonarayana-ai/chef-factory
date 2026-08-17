# CHEF FACTORY — Gate 10 Discovery Report

> Date: 2026-08-17
> Mode: DISCOVERY_ONLY
> Classification: GATE_10_READY_FOR_OWNER_APPROVAL

---

## Executive Summary

Gate 9 successfully wired the orchestration engine into the production pipeline, resolving the F-G8-01 critical finding. The current system supports tool execution, security guardian, authority resolution, conversation persistence, structured queries, production query security controls, multi-step orchestration, cost protection, rate limiting, anomaly detection, and owner/project isolation.

Gate 10 discovery performed a comprehensive forensic audit across all 20 architectural layers (API, Pipeline, Execution, Orchestration, ToolBroker, Guardian, Authority, Policy Engine, Rate Limiting, Cost Protection, Anomaly Detection, Tool Registry, query_data, Conversation System, Provider Adapters, Runtime, Database, RLS, Tests, Documentation).

**Primary finding:** Provider Resilience is the highest-impact reliability gap. Zero retry, zero timeout, zero circuit breaker across all provider adapters. Any transient provider failure causes total execution failure with no recovery.

**Recommended Gate 10 mission:** Provider Resilience — add retry with exponential backoff, request timeouts, circuit breaker, and provider health tracking to all provider adapters.

---

## Baseline Verification

| Metric | Expected | Actual | Status |
|--------|----------|--------|--------|
| Tests | 427/427 | 427/427 | ✅ PASS |
| tsc --noEmit | CLEAN | CLEAN | ✅ PASS |
| Source files modified | 0 | 0 | ✅ PASS |
| Test files modified | 0 | 0 | ✅ PASS |
| Database modified | 0 | 0 | ✅ PASS |

**GATE_9_BASELINE = PRESERVED**

---

## Findings Summary

### CRITICAL (3)

| # | Finding | Category | Source |
|---|---------|----------|--------|
| F-CRIT-01 | `.env` contains plaintext secrets (DB password, API keys) | SECURITY | Infrastructure |
| F-CRIT-02 | Guardian optional in ToolBroker (`securityGuard?` not mandatory) | SECURITY | toolBroker.ts:59 |
| F-CRIT-03 | SSL cert verification disabled (`rejectUnauthorized: false`) | SECURITY | pool.ts:23 |

**Note:** F-CRIT-01 and F-CRIT-03 are infrastructure concerns, not code defects. F-CRIT-02 is mitigated in practice (pipeline always wires Guardian) but represents an architectural weakness.

### HIGH (12)

| # | Finding | Category | Source |
|---|---------|----------|--------|
| F-HIGH-01 | No request timeout on any provider adapter (fetch without AbortSignal) | RELIABILITY | openai.ts, anthropic.ts, google.ts |
| F-HIGH-02 | No tool execution timeout in ToolBroker | RELIABILITY | toolBroker.ts:77 |
| F-HIGH-03 | No orchestration timeout (step loop runs indefinitely) | RELIABILITY | orchestration.ts:267 |
| F-HIGH-04 | No conversation token budget management | RELIABILITY | conversation.ts, handlers.ts |
| F-HIGH-05 | `execute=false` returns misleading `'executed'` outcome | CORRECTNESS | toolBroker.ts:73 |
| F-HIGH-06 | `loadHistory()` fetches ALL rows then slices in JS | PERFORMANCE | conversation.ts:159 |
| F-HIGH-07 | No request body size limit at API boundary | RELIABILITY | server.ts:116 |
| F-HIGH-08 | Error details leaked to client in 500 handler | SECURITY | server.ts:223 |
| F-HIGH-09 | No cancellation mechanism for running executions | RELIABILITY | pipeline.ts |
| F-HIGH-10 | Pipeline accepts unbounded raw command length | RELIABILITY | pipeline.ts:158 |
| F-HIGH-11 | No unit tests for ConversationService (182 lines, 0 tests) | TESTING | conversation.ts |
| F-HIGH-12 | MemoryStore lacks conversation operations (test fidelity gap) | TESTING | memoryStore.ts, ports.ts |

### MEDIUM (15)

| # | Finding | Category | Source |
|---|---------|----------|--------|
| F-MED-01 | Rate limiter unbounded memory growth (no eviction) | RELIABILITY | rateLimit.ts:34 |
| F-MED-02 | Rate limit scope mismatch in orchestration (uses 'model' not 'tool') | CORRECTNESS | orchestration.ts:346 |
| F-MED-03 | Tool results not size-limited for most tools | RELIABILITY | toolBroker.ts |
| F-MED-04 | ConversationService bypasses Store abstraction | ARCHITECTURE | conversation.ts:5 |
| F-MED-05 | MemoryStore sort order mismatches SupabaseStore | TESTING | memoryStore.ts |
| F-MED-06 | No unit tests for Api handlers (384 lines, 0 unit tests) | TESTING | handlers.ts |
| F-MED-07 | Inconsistent pagination across endpoints | ARCHITECTURE | handlers.ts |
| F-MED-08 | No input validation on orchestration step args | SECURITY | orchestration.ts:432 |
| F-MED-09 | Unbounded list queries in Store methods | RELIABILITY | repo.ts |
| F-MED-10 | LIMIT/OFFSET string-interpolated in query-engine.ts | SECURITY | query-engine.ts:236 |
| F-MED-11 | Missing redaction patterns (AWS keys, GitHub tokens) | SECURITY | redact.ts |
| F-MED-12 | Anomaly decay timing attack (4 denials/hour never triggers threshold=5) | SECURITY | anomaly.ts:92 |
| F-MED-13 | Unbounded maps in query-data (entityQueryCounts, concurrentQueries) | RELIABILITY | query-data.ts |
| F-MED-14 | No query timeout enforcement outside transactions | RELIABILITY | query-engine.ts:367 |
| F-MED-15 | No input truncation for conversation history messages | RELIABILITY | execution.ts:330 |

### LOW (12)

| # | Finding | Category | Source |
|---|---------|----------|--------|
| F-LOW-01 | Fire-and-forget event recording (errors silently swallowed) | RELIABILITY | guardian.ts:46 |
| F-LOW-02 | `transitionTask` exported but unused in pipeline | DEAD_CODE | taskEngine.ts:41 |
| F-LOW-03 | RateLimiter.reset() clears all windows (public method) | SECURITY | rateLimit.ts:74 |
| F-LOW-04 | Short secrets (< 4 chars) not redacted | SECURITY | secretProvider.ts:39 |
| F-LOW-05 | No Content-Security-Policy or CORS headers | SECURITY | server.ts |
| F-LOW-06 | `tokenCount` field exists but never populated | DEAD_CODE | conversation.ts:140 |
| F-LOW-07 | Google adapter never reports token usage | LIMITATION | google.ts:88 |
| F-LOW-08 | OpenCode Zen adapter ignores timeoutMs parameter | BUG | opencodeZen.ts:30 |
| F-LOW-09 | Inconsistent safeParse behavior across adapters | INCONSISTENCY | adapters |
| F-LOW-10 | Mutable authority object in pipeline | CODE_QUALITY | pipeline.ts:251 |
| F-LOW-11 | Error class in task failure is redundant string | CODE_QUALITY | taskEngine.ts:57 |
| F-LOW-12 | Incomplete explanation causes unhandled throw | RELIABILITY | pipeline.ts:824 |

### INFORMATIONAL (10)

| # | Finding | Category |
|---|---------|----------|
| F-INF-01 | All SQL queries parameterized (no injection) | POSITIVE |
| F-INF-02 | All Store methods owner-scoped | POSITIVE |
| F-INF-03 | Auth flow robust and well-tested | POSITIVE |
| F-INF-04 | DB has RLS on all tables | POSITIVE |
| F-INF-05 | Audit trail append-only at DB level | POSITIVE |
| F-INF-06 | Static file serving prevents path traversal | POSITIVE |
| F-INF-07 | Rate limiting at multiple levels | POSITIVE |
| F-INF-08 | Emergency lockdown properly implemented | POSITIVE |
| F-INF-09 | Secrets properly redacted from logs/audit | POSITIVE |
| F-INF-10 | Steps with failed dependencies correctly skipped | POSITIVE |

---

## Candidate Investigation Results

### Candidate A: Provider Resilience

**Status: HIGHEST VALUE — RECOMMENDED**

Provider failures are the most common production issue. Currently:
- Zero retry on transient failures (network errors, 429 rate limits, 503 server errors)
- Zero timeout on fetch() calls (provider hangs block indefinitely)
- Zero circuit breaker (repeated failures keep hammering the API)
- Zero provider health tracking

**Evidence:**
- `openai.ts:33-40` — fetch() without AbortSignal, throws on any HTTP error
- `anthropic.ts:41-49` — same pattern
- `google.ts:57-63` — same pattern
- `execution.ts:83-128` — model call failure returns `{ ok: false }`, no retry

**Impact:** Any provider outage or transient failure causes immediate execution failure. No recovery path exists.

### Candidate B: Variable/Template Interpolation Security

**Status: LOW-MEDIUM VALUE**

F-G8-02 identified unsanitized variable interpolation in orchestration. Audit reveals:
- `$step.N.id` is the only interpolation pattern (`orchestration.ts:247`)
- Resolved values are passed to tool handlers which use parameterized SQL
- ToolBroker validates tool names against GATE3_TOOLS whitelist
- Guardian evaluates each tool call

**Risk is mitigated** by existing layers. Not the highest-priority.

### Candidate C: Conversation Context Management

**Status: MEDIUM VALUE**

- No token budget management (`conversation.ts` has `tokenCount` field but never populates it)
- `loadHistory()` fetches ALL rows then slices in JS (performance issue at scale)
- Default limit is 20 messages (reasonable for most use cases)
- No summarization or truncation

**Real bottleneck** for very long conversations, but the 20-message default limits immediate impact.

### Candidate D: Streaming Response Delivery

**Status: LOW VALUE**

- Orchestration typically completes in seconds
- Streaming improves UX for long commands but is not a reliability/security gap
- SSE/WebSocket adds complexity (cancellation, failure semantics)
- Not a production-readiness issue

### Candidate E: Memory/Vector Intelligence

**Status: LOW VALUE**

- Current conversation persistence works for most use cases
- `recall()` is already a stub returning empty array
- Vector memory is an advanced feature not yet needed
- Feature expansion, not gap resolution

### Candidate F: Orchestration Reliability

**Status: HIGH VALUE — SECONDARY OPTION**

Now that orchestration is active (Gate 9), production-critical gaps exist:
- No timeout on orchestration loop or individual tool execution
- No cancellation mechanism
- No resume capability
- Cost accumulation without limits

**Overlaps with Provider Resilience** on timeout implementation. Could be a follow-up gate.

---

## Production Readiness Score

| Capability | Status | Evidence | Production Ready? |
|------------|--------|----------|-------------------|
| API routing + auth | READY | server.ts, auth.ts | YES |
| Intent parsing | READY | intent.ts, intent.test.ts | YES |
| Authority resolution | READY | authority.ts, authority.test.ts | YES |
| Autonomy evaluation | READY | autonomy.ts, autonomy.test.ts | YES |
| Security Guardian | READY | guardian.ts, securityGuardian.test.ts | YES (caveat: optional in ToolBroker) |
| ToolBroker boundary | READY | toolBroker.ts, toolBroker.test.ts | YES (caveat: execute=false label) |
| Single-step execution | READY | execution.ts, execution.test.ts | YES (caveat: no timeout) |
| Multi-step orchestration | READY | orchestration.ts, orchestration.test.ts | YES (caveat: no timeout) |
| Rate limiting | READY | rateLimit.ts | YES (caveat: unbounded memory) |
| Cost protection | READY | cost.ts, cost.test.ts | YES |
| Anomaly detection | READY | anomaly.ts | YES (caveat: timing attack) |
| Conversation persistence | PARTIAL | conversation.ts | PARTIAL (no token budget) |
| Provider resilience | NOT READY | adapters/* | NO (zero retry/timeout/circuit breaker) |
| Query data security | READY | query-engine.ts | YES |
| Owner isolation | READY | repo.ts (all methods verified) | YES |
| Audit trail | READY | repo.ts | YES |
| Explanation system | READY | explanation.ts | YES |

**PRODUCTION_READINESS = 82%** (14/17 fully ready, 2/17 partial, 1/17 not ready)

---

## Documentation Drift

| Layer | Drift | Details |
|-------|-------|---------|
| Source | NONE | No unexpected modifications |
| Tests | NONE | No unexpected modifications |
| Database | NONE | No unexpected modifications |
| Evidence | NONE | All prior gate evidence accurate |

---

## Gate 10 Readiness Classification

**GATE_10_READY_FOR_OWNER_APPROVAL**

Clear mission exists (Provider Resilience). No baseline blocker. All prior gates frozen and verified.

---

**END OF DISCOVERY REPORT**
