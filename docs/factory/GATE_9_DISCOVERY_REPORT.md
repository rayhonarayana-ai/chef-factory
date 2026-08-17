# CHEF FACTORY — Gate 9 Discovery Report

> Date: 2026-08-17
> Source: Post-Gate-8 forensic audit (23 findings across 4 categories)
> Classification: GATE_9_DISCOVERY_ONLY

---

## Forensic Audit Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Architecture | 1 | 2 | 3 | 1 | 7 |
| Security | 0 | 2 | 2 | 1 | 5 |
| Reliability | 1 | 3 | 0 | 1 | 5 |
| Capability | 0 | 0 | 2 | 0 | 2 |
| **Total** | **2** | **7** | **7** | **3** | **23** |

### CRITICAL Findings

| ID | Finding | Impact |
|----|---------|--------|
| F-G8-01 | Orchestration engine is dead code — never called from pipeline | Gate 8 implementation incomplete |
| F-GAP-01 | Zero retry/backoff in all provider adapters | Single transient error breaks execution |

### HIGH Findings

| ID | Finding | Impact |
|----|---------|--------|
| F-G8-02 | Variable interpolation ($step.N.id) has no sanitization | Second-order injection vector |
| F-G8-03 | Multi-step detection is regex heuristic | Bypass/false-positive risk |
| F-GAP-02 | In-memory rate/anomaly state lost on restart | Security state reset |
| F-GAP-03 | Duplicate Guardian instances with split state | Anomaly detection weakened |
| F-GAP-04 | Conversation history has no token budget | Context limit/cost risk |
| F-SEC-01 | Security guard hook hardcodes authorized: true | Authorization bypass |
| F-ARCH-01 | No command text length validation | Regex DoS vector |
| F-ARCH-02 | Tool results in orchestration not redacted | Secret leak vector |

---

## Gate 9 Mission Options

### Option A: Wire Orchestration Engine (Recommended)

**Mission:** Complete the Gate 8 implementation by wiring `executeOrchestration()` into the pipeline, fixing the dead code issue, and hardening the orchestration security chain.

**Scope:**
1. F-G8-01: Wire `executeOrchestration()` into `runOrchestration()` — replace `this.execution.execute()` with actual orchestration
2. F-G8-04: Implement proper plan decomposition (LLM-generated or pattern-based)
3. F-G8-02: Add type/length validation to `$step.N.id` variable interpolation
4. F-G8-03: Improve multi-step detection (LLM-assisted or structured parsing)
5. F-SEC-01: Pass real authority resolution to security guard hook
6. F-ARCH-02: Apply `safeSummary()` to orchestration step results
7. F-SEC-02: Redact step descriptions at plan creation time

**Files to change:** orchestration.ts, pipeline.ts, toolBroker.ts
**Risk:** MEDIUM — touches core execution path
**Value:** HIGH — completes Gate 8's intended capability

### Option B: Provider Resilience

**Mission:** Add retry/backoff, circuit breaker, and provider failover to all provider adapters.

**Scope:**
1. F-GAP-01: Add exponential backoff with jitter to OpenAI/Anthropic/Google adapters
2. F-GAP-01: Parse Retry-After headers from 429 responses
3. F-GAP-06: Implement provider fallback chain
4. F-GAP-05: Fix Google adapter API key leak (use header instead of URL param)

**Files to change:** openai.ts, anthropic.ts, google.ts, execution.ts
**Risk:** MEDIUM — provider boundary changes
**Value:** HIGH — production reliability

### Option C: Security Hardening

**Mission:** Fix security boundary gaps (shared Guardian, input validation, error sanitization).

**Scope:**
1. F-GAP-02/F-GAP-03: Share single Guardian/RateLimiter/AnomalyDetector across all code paths
2. F-ARCH-01: Add command text length validation (10,000 chars max)
3. F-ARCH-06: Add HTTP request body size limit (1MB)
4. F-SEC-03: Orchestration respects pipeline approval gate
5. F-SEC-04: Configurable anomaly thresholds per-owner

**Files to change:** server.ts, handlers.ts, pipeline.ts, security.ts
**Risk:** LOW-MEDIUM — isolated changes
**Value:** MEDIUM — defense in depth

### Option D: Context Management

**Mission:** Implement token-aware conversation history and context window management.

**Scope:**
1. F-GAP-04: Token budget management for conversation history
2. F-ARCH-04: Configurable system prompt per-owner/project
3. Conversation summarization for long-running sessions

**Files to change:** conversation.ts, execution.ts, handlers.ts
**Risk:** LOW — additive changes
**Value:** MEDIUM — cost optimization

---

## Recommended Mission: Option A (Wire Orchestration Engine)

**Rationale:** F-G8-01 is CRITICAL — Gate 8's 556-line orchestrator is dead code. The implementation is incomplete. This must be fixed before adding new capabilities.

**Priority order:**
1. Wire `executeOrchestration()` into pipeline (F-G8-01)
2. Implement plan decomposition (F-G8-04)
3. Fix security guard authorization (F-SEC-01)
4. Add variable sanitization (F-G8-02)
5. Apply tool result redaction (F-ARCH-02)
6. Improve multi-step detection (F-G8-03)
7. Redact step descriptions (F-SEC-02)

---

## Evidence Items

| # | Evidence | Category |
|---|----------|----------|
| E1 | pipeline.ts:548-558 creates plan with `orchestrate` tool (not in GATE3_TOOLS) | F-G8-01 |
| E2 | pipeline.ts:584 calls `this.execution.execute()` not `executeOrchestration()` | F-G8-01 |
| E3 | orchestration.ts:165 `executeOrchestration()` never called from pipeline | F-G8-01 |
| E4 | openai.ts:33-41 single fetch, no retry | F-GAP-01 |
| E5 | anthropic.ts:41-50 single fetch, no retry | F-GAP-01 |
| E6 | google.ts:57-64 single fetch, no retry | F-GAP-01 |
| E7 | orchestration.ts:244-265 `resolveArgs` no type/length validation | F-G8-02 |
| E8 | orchestration.ts:545-556 regex heuristic for detection | F-G8-03 |
| E9 | server.ts:179,183 two separate `createSecurityGuardian()` calls | F-GAP-03 |
| E10 | rateLimit.ts:34 in-memory Map, lost on restart | F-GAP-02 |
| E11 | conversation.ts:47 MAX_HISTORY=20, no token counting | F-GAP-04 |
| E12 | orchestration.ts:218-219 hardcoded `authorized: true` | F-SEC-01 |
| E13 | handlers.ts:53 no command length check | F-ARCH-01 |
| E14 | orchestration.ts:431-470 raw handler result, no safeSummary | F-ARCH-02 |
