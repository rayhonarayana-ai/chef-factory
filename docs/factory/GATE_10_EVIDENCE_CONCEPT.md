# CHEF FACTORY — Gate 10 Evidence Concept

> Date: 2026-08-17
> Mode: DISCOVERY_ONLY
> Mission: Provider Resilience

---

## Evidence Contract

### UNIT_VERIFIED

| E# | Claim | Type | Source | Verification | Pass Condition |
|----|-------|------|--------|-------------|----------------|
| E1 | Retry succeeds after transient HTTP 500 | UNIT | resilience.ts | Mock adapter returns 500 then 200 | Second call succeeds |
| E2 | Retry succeeds after transient network error | UNIT | resilience.ts | Mock adapter throws then succeeds | Second call succeeds |
| E3 | Retry respects max attempts | UNIT | resilience.ts | Mock adapter always fails | Stops after N attempts |
| E4 | Exponential backoff timing | UNIT | resilience.ts | Mock adapter with clock | Delays increase exponentially |
| E5 | Circuit breaker opens after threshold | UNIT | resilience.ts | Mock adapter fails N times | Circuit state = 'open' |
| E6 | Circuit breaker blocks when open | UNIT | resilience.ts | Circuit open, call made | Immediate rejection |
| E7 | Circuit breaker half-opens after cooldown | UNIT | resilience.ts | Wait cooldown period | Next call allowed |
| E8 | Circuit breaker resets on success | UNIT | resilience.ts | Half-open call succeeds | Circuit state = 'closed' |
| E9 | Timeout fires when provider hangs | UNIT | resilience.ts | Mock adapter never resolves | Timeout error after T ms |
| E10 | Health status tracks provider state | UNIT | resilience.ts | Multiple calls | Health reflects success/failure |
| E11 | Retry does not retry on 4xx (non-retryable) | UNIT | resilience.ts | Mock returns 400 | No retry attempted |
| E12 | Retry retries on 429 (rate limit) | UNIT | resilience.ts | Mock returns 429 then 200 | Retries after delay |
| E13 | Retry retries on 503 (server overload) | UNIT | resilience.ts | Mock returns 503 then 200 | Retries after delay |
| E14 | Circuit breaker does not trip on non-retryable errors | UNIT | resilience.ts | Mock returns 400 repeatedly | Circuit stays closed |

### INTEGRATION_VERIFIED

| E# | Claim | Type | Source | Verification | Pass Condition |
|----|-------|------|--------|-------------|----------------|
| E15 | OpenAI adapter retries on transient failure | INTEGRATION | openai.ts | Mock fetch | Retry + success |
| E16 | Anthropic adapter retries on transient failure | INTEGRATION | anthropic.ts | Mock fetch | Retry + success |
| E17 | Google adapter retries on transient failure | INTEGRATION | google.ts | Mock fetch | Retry + success |
| E18 | OpenAI adapter times out on hang | INTEGRATION | openai.ts | Mock fetch never resolves | Timeout error |
| E19 | Anthropic adapter times out on hang | INTEGRATION | anthropic.ts | Mock fetch never resolves | Timeout error |
| E20 | Google adapter times out on hang | INTEGRATION | google.ts | Mock fetch never resolves | Timeout error |

### LIVE_VERIFIED

| E# | Claim | Type | Source | Verification | Pass Condition |
|----|-------|------|--------|-------------|----------------|
| E21 | Provider call succeeds with resilience enabled | LIVE | adapters | Real API call | Success response |
| E22 | Health status reflects real provider availability | LIVE | resilience.ts | Check after real call | Status matches |

### FORENSIC_VERIFIED

| E# | Claim | Type | Source | Verification | Pass Condition |
|----|-------|------|--------|-------------|----------------|
| E23 | No bypass paths around retry/timeout | FORENSIC | code review | Static analysis | All adapter calls go through resilience layer |
| E24 | Circuit breaker state is in-memory only | FORENSIC | code review | No DB schema changes | No migration required |
| E25 | Backoff delays are bounded | FORENSIC | code review | Max delay constant | Delay never exceeds max |
| E26 | Timeout does not leak promises | FORENSIC | code review | AbortController usage | Promise properly cleaned up |
| E27 | Existing security invariants preserved | FORENSIC | code review | Guardian, Authority, ToolBroker unchanged | No security regression |

---

## Evidence Summary

| Category | Count |
|----------|-------|
| UNIT_VERIFIED | 14 |
| INTEGRATION_VERIFIED | 6 |
| LIVE_VERIFIED | 2 |
| FORENSIC_VERIFIED | 5 |
| **Total** | **27** |

---

**END OF EVIDENCE CONCEPT**
