# Gate 4 — Frozen Baseline

> **Frozen:** 2026-08-17
> **Classification:** GATE_4_PASS

---

## Test Count

| Category | Files | Count |
|----------|-------|-------|
| Gate 3 baseline (frozen) | 23 test files | 222 |
| Gate 4 unit tests | 1 file (`gate4.execution.test.ts`) | 16 |
| Gate 4 live integration | 1 file (`gate4.live.integration.test.ts`) | 5 |
| **Total** | **25 files** | **243** |

**All 243 tests PASS. TYPECHECK=PASS.**

---

## Files Changed Since Gate 3

| File | Nature of Change |
|------|-----------------|
| `src/core/pipeline.ts` | Added `ConversationMessage` interface, optional `conversationHistory` params |
| `src/api/handlers.ts` | Load conversation history before `pipeline.run()` |
| `src/api/execution.ts` | Conversation history, securityGuard wiring, authority resolution, anomaly counters, rate limits |
| `src/api/server.ts` | Pass securityGuardian, rateLimiter, anomalyDetector to createExecutionRunner() |
| `src/api/gate4.execution.test.ts` | **NEW** — 16 unit tests |
| `src/integration/gate4.live.integration.test.ts` | **NEW** — 5 live integration tests |

**6 files total (4 modified, 2 new). 0 database changes. 0 API endpoint changes.**

---

## Provider Status

| Provider | Tool Calling | Live Verified |
|----------|-------------|---------------|
| OpenAI | YES | Gate 3 |
| Anthropic | NOT TESTED | Gate 5 |
| Google | NOT TESTED | Gate 5 |

---

## Deferred to Gate 5

1. Anthropic tool calling verification
2. Google tool calling verification
3. Git initialization (OD1)
4. Cost limit configuration (OD2)
5. Documentation drift closure (10 items)
6. Evidence drift closure (1 item)
