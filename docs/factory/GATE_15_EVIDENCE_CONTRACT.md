# GATE 15 — EVIDENCE CONTRACT

> Date: 2026-08-17
> Purpose: Define verification items for future Gate 15 implementation (Streaming)

## Evidence Items (14)

### E1: SSE Endpoint Exists

| Attribute | Value |
|-----------|-------|
| Evidence ID | E1 |
| Claim | `/api/chat` (or new `/api/chat/stream`) supports SSE streaming |
| Verification level | UNIT |
| Required environment | Local test server |
| Pass condition | Endpoint returns `Content-Type: text/event-stream` when `stream: true` |
| Fail condition | Endpoint returns `application/json` or 404 |

### E2: Token Yield Pipeline

| Attribute | Value |
|-----------|-------|
| Evidence ID | E2 |
| Claim | LLM response tokens are yielded incrementally (generator/async iterator) |
| Verification level | UNIT |
| Required environment | Mock LLM adapter |
| Pass condition | Test receives multiple `data:` events with incremental tokens |
| Fail condition | Single event with full response |

### E3: Backward Compatibility

| Attribute | Value |
|-----------|-------|
| Evidence ID | E3 |
| Claim | Existing synchronous `/api/chat` behavior unchanged when `stream: false` or absent |
| Verification level | UNIT |
| Required environment | Local test server |
| Pass condition | Non-streaming requests return standard JSON response |
| Fail condition | Non-streaming requests fail or return SSE format |

### E4: Authentication on Stream Endpoint

| Attribute | Value |
|-----------|-------|
| Evidence ID | E4 |
| Claim | SSE endpoint requires Bearer authentication |
| Verification level | UNIT |
| Required environment | Local test server |
| Pass condition | Unauthenticated SSE request returns 401 |
| Fail condition | Unauthenticated request returns 200 |

### E5: Guardian Enforcement on Stream

| Attribute | Value |
|-----------|-------|
| Evidence ID | E5 |
| Claim | SecurityGuardian evaluates requests on streaming path |
| Verification level | UNIT |
| Required environment | Mock Guardian |
| Pass condition | Guardian deny returns SSE error event, not streamed tokens |
| Fail condition | Tokens streamed before Guardian approval |

### E6: Rate Limiting on Stream

| Attribute | Value |
|-----------|-------|
| Evidence ID | E6 |
| Claim | Rate limiting applies to streaming requests |
| Verification level | UNIT |
| Required environment | Mock rate limiter |
| Pass condition | Rate-limited streaming request returns error event |
| Fail condition | Streaming bypasses rate limiter |

### E7: Error Handling

| Attribute | Value |
|-----------|-------|
| Evidence ID | E7 |
| Claim | Stream errors (LLM failure, timeout, cancellation) emit proper SSE error events |
| Verification level | UNIT |
| Required environment | Mock LLM adapter (error scenarios) |
| Pass condition | Error event contains `{ type: 'error', message: string }`, stream closes |
| Fail condition | Unhandled promise rejection or hung stream |

### E8: Stream Cancellation

| Attribute | Value |
|-----------|-------|
| Evidence ID | E8 |
| Claim | Client disconnect aborts LLM request and cleans up resources |
| Verification level | UNIT |
| Required environment | Local test server |
| Pass condition | Client abort triggers AbortController, LLM request cancelled |
| Fail condition | LLM continues generating after client disconnect |

### E9: Conversation Persistence on Stream

| Attribute | Value |
|-----------|-------|
| Evidence ID | E9 |
| Claim | Full response is persisted to conversation_messages after stream completes |
| Verification level | INTEGRATION |
| Required environment | Mock store |
| Pass condition | After stream completes, conversation_messages contains full response |
| Fail condition | Partial or missing persistence |

### E10: Cost Tracking on Stream

| Attribute | Value |
|-----------|-------|
| Evidence ID | E10 |
| Claim | Token usage and cost are recorded after stream completes |
| Verification level | INTEGRATION |
| Required environment | Mock store |
| Pass condition | `recordCost()` called with correct token counts |
| Fail condition | No cost recorded |

### E11: Redaction on Stream

| Attribute | Value |
|-----------|-------|
| Evidence ID | E11 |
| Claim | Streamed tokens are passed through the redactor |
| Verification level | UNIT |
| Required environment | Mock redactor |
| Pass condition | Redacted tokens in SSE events |
| Fail condition | Unredacted secrets in stream |

### E12: No Regression

| Attribute | Value |
|-----------|-------|
| Evidence ID | E12 |
| Claim | All 624 existing tests continue to pass |
| Verification level | FORENSIC |
| Required environment | Full test suite |
| Pass condition | 624+ passed, 0 new failures |
| Fail condition | Any regression |

### E13: tsc Clean

| Attribute | Value |
|-----------|-------|
| Evidence ID | E13 |
| Claim | TypeScript compilation passes with no errors |
| Verification level | FORENSIC |
| Required environment | TypeScript compiler |
| Pass condition | `npx tsc --noEmit` exits 0 |
| Fail condition | Any type error |

### E14: Live Provider Verification

| Attribute | Value |
|-----------|-------|
| Evidence ID | E14 |
| Claim | Real OpenAI streaming call works end-to-end |
| Verification level | LIVE |
| Required environment | Live OpenAI API key |
| Pass condition | Streaming response received token-by-token |
| Fail condition | Timeout, error, or non-streaming response |

## Evidence Summary

| Level | Count | Items |
|-------|-------|-------|
| UNIT | 8 | E1-E8 |
| INTEGRATION | 2 | E9-E10 |
| LIVE | 1 | E14 |
| FORENSIC | 2 | E12-E13 |
| **Total** | **13** | (E11 is UNIT/forensic hybrid) |

## Verification Order

1. E13 (tsc clean) — must pass before any other verification
2. E12 (no regression) — baseline preservation
3. E1-E3 (core functionality) — endpoint, yield, backward compat
4. E4-E6 (security controls) — auth, guardian, rate limit
5. E7-E8 (error handling) — errors, cancellation
6. E9-E11 (integration) — persistence, cost, redaction
7. E14 (live) — real provider verification
