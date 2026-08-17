# CHEF FACTORY — Gate 10 Mission Options

> Date: 2026-08-17
> Mode: DISCOVERY_ONLY

---

## Mission Option A: Provider Resilience (RECOMMENDED)

### Description
Add retry with exponential backoff, request timeouts, circuit breaker, and provider health tracking to all provider adapters (OpenAI, Anthropic, Google, OpenCode Zen).

### Business Value
HIGH — Provider failures are the most common production issue. Any transient network error, rate limit response, or provider outage causes total execution failure with no recovery. This directly impacts owner experience and trust.

### Security Value
LOW — Adds no new security controls, but does not weaken existing ones.

### Reliability Value
CRITICAL — Transforms brittle single-attempt execution into resilient execution with automatic recovery.

### Architectural Value
HIGH — Establishes the resilience pattern that all future integrations will follow.

### Implementation Complexity
MEDIUM — 4 adapter files + shared retry/circuit-breaker utility + health tracking + tests.

### Risk
LOW — Retry logic is well-understood. Circuit breaker is a standard pattern. No schema changes.

### Dependencies
None.

### Estimated File Impact
| File | Change |
|------|--------|
| `src/gateways/adapters/openai.ts` | +40 lines (retry, timeout) |
| `src/gateways/adapters/anthropic.ts` | +40 lines (retry, timeout) |
| `src/gateways/adapters/google.ts` | +40 lines (retry, timeout) |
| `src/gateways/adapters/opencodeZen.ts` | +20 lines (timeout) |
| `src/gateways/resilience.ts` (NEW) | +120 lines (retry, circuit breaker, health) |
| `src/gateways/providerAdapter.ts` | +10 lines (resilience options) |
| `src/gateways/resilience.test.ts` (NEW) | +200 lines |
| `src/gateways/adapters/resilience.integration.test.ts` (NEW) | +100 lines |

### Database Impact
NONE

### API Impact
NONE (internal change only)

### Test Impact
~370 new test lines (unit + integration)

### Live Evidence Requirements
- E1: Retry succeeds after simulated transient failure
- E2: Timeout fires when provider hangs
- E3: Circuit breaker opens after repeated failures
- E4: Circuit breaker half-open after cooldown
- E5: Health status tracks provider availability
- E6: Backoff timing is within expected bounds

---

## Mission Option B: Orchestration Hardening

### Description
Add tool execution timeout, orchestration timeout, cancellation mechanism, and idempotency checks to the orchestration engine.

### Business Value
HIGH — The newly activated orchestration engine (Gate 9) can hang indefinitely if a tool handler blocks. No timeout, no cancellation, no recovery.

### Security Value
MEDIUM — Prevents resource exhaustion through hung orchestrations.

### Reliability Value
HIGH — Transforms fragile orchestration into bounded, cancellable, resumable orchestration.

### Architectural Value
MEDIUM — Completes the orchestration reliability picture started in Gate 8/9.

### Implementation Complexity
MEDIUM — Modify orchestration.ts + pipeline.ts + tests.

### Risk
MEDIUM — Timeout semantics need careful design (what happens when a step times out mid-transaction?).

### Dependencies
None (but shares timeout implementation with Option A).

### Estimated File Impact
| File | Change |
|------|--------|
| `src/core/orchestration.ts` | +60 lines (timeout, cancellation) |
| `src/core/pipeline.ts` | +30 lines (timeout wrapper, cancellation) |
| `src/core/orchestration.test.ts` | +150 lines |
| `src/integration/gate10.orchestration.test.ts` (NEW) | +100 lines |

### Database Impact
NONE

### API Impact
NONE

### Test Impact
~280 new test lines

---

## Mission Option C: Conversation Context Management

### Description
Add token budget management, conversation summarization, and SQL-level LIMIT to `loadHistory()`.

### Business Value
MEDIUM — Long conversations could exceed model context windows. The 20-message default limits immediate impact, but production conversations will grow.

### Security Value
LOW — Prevents context-window abuse.

### Reliability Value
MEDIUM — Prevents model errors from oversized context.

### Architectural Value
MEDIUM — Integrates conversation system into Store abstraction.

### Implementation Complexity
MEDIUM — Modify conversation.ts, add token counting, integrate into Store.

### Risk
MEDIUM — Token counting accuracy varies by provider. Summarization requires model calls.

### Dependencies
None.

### Estimated File Impact
| File | Change |
|------|--------|
| `src/core/conversation.ts` | +80 lines (token budget, SQL LIMIT) |
| `src/core/ports.ts` | +10 lines (conversation methods in Store) |
| `src/testing/memoryStore.ts` | +50 lines (conversation stubs) |
| `src/api/handlers.ts` | +20 lines (token budget check) |
| `src/api/execution.ts` | +30 lines (truncation before model call) |
| Tests | ~200 lines |

### Database Impact
NONE

### API Impact
NONE

### Test Impact
~200 new test lines

---

## Mission Option D: API Boundary Hardening

### Description
Add request body size limit, input validation, error sanitization, and security headers.

### Business Value
MEDIUM — Prevents resource exhaustion and information leakage.

### Security Value
HIGH — Closes information leakage (error details) and adds defense-in-depth (security headers).

### Reliability Value
MEDIUM — Prevents memory exhaustion from large payloads.

### Architectural Value
LOW — Standard hardening, not architectural.

### Implementation Complexity
LOW — Small changes to server.ts and handlers.ts.

### Risk
LOW — Well-understood patterns.

### Dependencies
None.

### Estimated File Impact
| File | Change |
|------|--------|
| `src/api/server.ts` | +40 lines (body limit, headers, error sanitization) |
| `src/api/handlers.ts` | +20 lines (input validation) |
| Tests | ~100 lines |

### Database Impact
NONE

### API Impact
NONE

### Test Impact
~100 new test lines

---

## Mission Option E: Variable Interpolation Security

### Description
Sanitize and validate all variable interpolation in orchestration step arguments.

### Business Value
LOW — Current risk is mitigated by parameterized SQL and Guardian evaluation.

### Security Value
MEDIUM — Defense-in-depth against prompt injection through intermediate results.

### Reliability Value
LOW — Prevents incorrect argument resolution.

### Architectural Value
LOW — Targeted fix, not architectural.

### Implementation Complexity
LOW — Small changes to orchestration.ts.

### Risk
LOW — Adding validation is straightforward.

### Dependencies
None.

### Estimated File Impact
| File | Change |
|------|--------|
| `src/core/orchestration.ts` | +30 lines (validation) |
| Tests | ~80 lines |

---

## Candidate Ranking

| Rank | Mission | Business Value | Security Value | Reliability Value | Complexity | Risk |
|------|---------|---------------|----------------|-------------------|------------|------|
| **1** | **A: Provider Resilience** | **HIGH** | LOW | **CRITICAL** | MEDIUM | LOW |
| 2 | B: Orchestration Hardening | HIGH | MEDIUM | HIGH | MEDIUM | MEDIUM |
| 3 | D: API Boundary Hardening | MEDIUM | HIGH | MEDIUM | LOW | LOW |
| 4 | C: Conversation Context | MEDIUM | LOW | MEDIUM | MEDIUM | MEDIUM |
| 5 | E: Variable Security | LOW | MEDIUM | LOW | LOW | LOW |

---

## Priority Rationale

1. **No CRITICAL security findings** that require immediate code fixes. The Guardian optional issue is architectural but mitigated in practice.

2. **HIGH reliability gap exists** — Provider Resilience (Option A) addresses the most impactful reliability issue. Provider failures are the most common production failure mode.

3. **Option A is foundational** — Retry and timeout patterns establish the resilience infrastructure that other improvements (Orchestration Hardening) can build on.

4. **Option B is the logical follow-up** — Orchestration Hardening shares timeout implementation with Option A and completes the reliability picture.

**END OF MISSION OPTIONS**
