# CHEF FACTORY — Gate 10 Owner Decisions

> Date: 2026-08-17
> Mode: DISCOVERY_ONLY

---

## Owner Decisions Required

### OD-14: Provider Resilience — Retry Strategy

**Question:** What retry strategy should be used for provider API calls?

**Options:**
1. Exponential backoff with jitter (3 attempts, 1s/2s/4s base delays) — **RECOMMENDED**
2. Fixed delay retry (3 attempts, 2s delay)
3. No retry (current behavior)

**Recommendation:** Option 1 — Exponential backoff with jitter is the industry standard. Prevents thundering herd on provider recovery. Jitter prevents synchronized retries across instances.

**Rationale:** Provider 429 (rate limit) and 503 (server overload) responses are designed to be retried. Without retry, any transient failure causes immediate execution failure.

**Risk if deferred:** Every provider transient failure causes total execution failure with no recovery.

---

### OD-15: Provider Resilience — Timeout Duration

**Question:** What timeout should be applied to provider API calls?

**Options:**
1. 30 seconds — **RECOMMENDED**
2. 60 seconds
3. 120 seconds

**Recommendation:** 30 seconds. Most provider responses complete in < 10s. 30s provides ample margin while preventing indefinite hangs.

**Rationale:** OpenAI, Anthropic, and Google typically respond in 2-15 seconds. Long-running completions (e.g., complex tool loops) use the tool loop, not single calls. 30s prevents indefinite hangs while allowing legitimate slow responses.

**Risk if deferred:** Provider hangs block the entire pipeline indefinitely.

---

### OD-16: Provider Resilience — Circuit Breaker Threshold

**Question:** After how many consecutive failures should the circuit breaker open?

**Options:**
1. 5 consecutive failures — **RECOMMENDED**
2. 3 consecutive failures
3. 10 consecutive failures

**Recommendation:** 5 consecutive failures. Balances sensitivity (trips quickly during outages) with tolerance (allows brief transient issues).

**Rationale:** 3 is too sensitive (brief network blip opens circuit). 10 is too tolerant (sustained outage wastes time). 5 matches the standard pattern.

**Risk if deferred:** Repeated provider failures continue to waste API credits and execution time.

---

### OD-17: Provider Resilience — Circuit Breaker Cooldown

**Question:** How long should the circuit breaker wait before half-opening?

**Options:**
1. 60 seconds — **RECOMMENDED**
2. 30 seconds
3. 120 seconds

**Recommendation:** 60 seconds. Allows provider time to recover while not blocking users too long.

**Rationale:** Provider outages typically last 1-5 minutes. 60s cooldown allows at least one recovery probe before the next attempt.

**Risk if deferred:** Circuit stays open too long (blocking) or too short (wasting attempts).

---

### OD-18: Provider Resilience — Scope

**Question:** Should Provider Resilience apply to all adapters or only specific ones?

**Options:**
1. All adapters (OpenAI, Anthropic, Google, OpenCode Zen) — **RECOMMENDED**
2. Only LLM providers (OpenAI, Anthropic, Google)
3. Only OpenAI (most commonly used)

**Recommendation:** All adapters. The resilience pattern should be universal. Even OpenCode Zen (runtime adapter) benefits from timeout.

**Rationale:** Consistency. Future adapters inherit the pattern. No reason to leave any adapter unprotected.

**Risk if deferred:** Unprotected adapters remain fragile.

---

## Decision Summary

| OD# | Question | Recommendation | Risk if Deferred |
|-----|----------|---------------|------------------|
| OD-14 | Retry strategy | Exponential backoff with jitter | No recovery from transient failures |
| OD-15 | Timeout duration | 30 seconds | Provider hangs block pipeline |
| OD-16 | Circuit breaker threshold | 5 consecutive failures | Wasted API credits during outages |
| OD-17 | Circuit breaker cooldown | 60 seconds | Circuit timing suboptimal |
| OD-18 | Scope | All adapters | Inconsistent resilience |

---

**END OF DECISIONS**
