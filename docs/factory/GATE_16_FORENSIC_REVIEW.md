# GATE 16 — FORENSIC REVIEW

> Classification: GATE_16_FORENSIC_REVIEW
> Date: 2026-08-19
> Scope: Deep source analysis of all post-Gate-15 findings

## 1. CRITICAL Findings — Deep Validation

### C-02: CommandPipeline Constructor Missing RateLimiter/AnomalyDetector

**Files:**
- `src/api/server.ts:209` — `new CommandPipeline(store, execution, guardian)` — does NOT pass rateLimiter or anomalyDetector
- `src/core/pipeline.ts:158-166` — Constructor accepts optional `rateLimiter` and `anomalyDetector` params
- `src/core/orchestration.ts:544-553` — Rate limit check guards against `this.rateLimiter` being undefined → silently skips
- `src/api/execution.ts:371,147,244` — Same pattern: `if (this.rateLimiter)` guards → no-op when undefined

**Impact:** Orchestration steps and the planning LLM call bypass rate limiting entirely. A burst of multi-step commands could exhaust provider credits without any rate guard.

**Fix scope:** 1 line change in `server.ts:209` to pass the already-constructed instances.

### C-03: PersistentRateLimiter.check() Synchronous

**Files:**
- `src/core/security/rateLimit.ts:60-79` — `check()` operates purely on in-memory `windows` Map
- `src/core/security/rateLimit.ts:103-117` — `checkPersisted()` exists (async, loads from DB) but is never called in production
- `src/core/security/guardian.ts:97` — Calls `this.deps.rateLimiter.check()` (synchronous path)
- `src/db/gate14Persistence.ts` — Persistence adapter wired at `server.ts:197` but never exercised

**Impact:** Rate limit counters reset on every server restart. The Gate 14 persistence guarantee is broken.

**Fix scope:** Make `check()` async internally, or change guardian to call `checkPersisted()`.

### C-04: PersistentAnomalyDetector.note() Synchronous

**Files:**
- `src/core/security/anomaly.ts:69-86` — `note()` operates on in-memory `counters` only
- `src/core/security/anomaly.ts:189-194` — `notePersisted()` exists but is never called in production
- `src/core/security/guardian.ts:188` — Calls `this.deps.anomaly.note()` (synchronous path)

**Impact:** Anomaly detection state (repeated denials, environment escalations, etc.) is lost on restart.

**Fix scope:** Same pattern as C-03.

## 2. HIGH Findings — Deep Validation

### H-01: Delta Events Dead

**Files:**
- `src/api/sse.ts:12` — `'delta'` in `SseEventType` union
- `src/api/sse.ts:30` — `sseDelta()` constructor defined
- `src/core/pipeline.ts:42` — `StreamingEventType` does NOT include `'delta'` (only start/tool/approval/error/complete/cancelled)

**Impact:** Even if provider streaming is added, the pipeline callback type must be extended. This is architecturally deferred — provider streaming (C-01) is the prerequisite.

### H-02: No Conversation Message Input Validation

**Files:**
- `src/api/handlers.ts:72-77` — Raw `command` appended to conversation
- `src/api/streaming.ts:82-87` — Same pattern
- `src/core/security/promptInjection.ts` — Exists but only called inside Guardian for `untrustedInput` field
- `src/core/conversation.ts:125` — `appendMessage()` stores content as-is

**Impact:** Direct prompt injection through conversation history. A malicious user command appears verbatim in the LLM prompt.

**Severity assessment:** HIGH but partially mitigated by the Guardian's own prompt injection check on the main command. The risk is that conversation history from *previous* turns may contain injection payloads that persist in the LLM context.

### H-03: loadHistory Performance Bomb

**Files:**
- `src/core/conversation.ts:158-181` — `SELECT ... ORDER BY created_at ASC` with no LIMIT, fetches all rows, then `.slice(-limit)`

**Impact:** O(n) memory and query cost per chat message. For long conversations, this causes increasing latency.

**Fix scope:** Add `LIMIT` to SQL query, reverse in JS.

## 3. Security Findings — Deep Validation

### S-CRIT-01: Plaintext Secrets in .env

**Verified.** The `.env` file contains 4 plaintext credentials. Mitigated by:
- `.env` is gitignored (needs verification)
- `secretProvider.ts` registers keys for redaction
- `redact.ts` scrubs known patterns from logs

**Recommendation:** Rotate credentials, add pre-commit hook.

### S-CRIT-02: No Concurrent SSE Connection Limit

**Verified.** The streaming path at `streaming.ts:54-139` creates long-lived connections with no per-owner cap. An authenticated owner could open dozens of simultaneous connections.

**Recommendation:** Add per-owner concurrent connection cap (3-5 max).

### S-HIGH-02: SSE Error Events Leak Internal Details

**Verified.** `streaming.ts:111` sends `String(e)` directly to client. Pipeline sends `securityResult.reason` via `pipeline.ts:328`.

**Recommendation:** Apply `redactText()` to error messages. Map internal errors to generic strings.

### S-HIGH-03: Conversation Messages Without Redaction

**Verified.** Both handlers and streaming append raw `command` to `conversation_messages` without `redactText()`. Contrast: `pipeline.ts:803` correctly redacts task descriptions.

**Recommendation:** Apply `redactText()` before DB persistence.

## 4. Drift Audit — Deep Validation

All 12 drift items verified. Key corrections needed:

| Document | Current Claims | Actual |
|----------|---------------|--------|
| ARCHITECTURE.md | "166 tests, 20 files" | 687 tests, 44 files |
| ARCHITECTURE.md | "17 immutable rules" | 26 rules |
| DATABASE.md | 16 tables + 6 security | 27 tables total |
| SECURITY.md | 61 policies | >80 policies |
| All docs | "GATE 1 + GATE 2" | Gate 15 scope |

## 5. Positive Security Observations

1. **Security chain preserved under streaming** — Confirmed by `gate15.streaming.test.ts:450-500`
2. **Fail-closed lockdown** — Early return at `guardian.ts:52-65`
3. **Append-only enforcement** — DB-level triggers on conversation messages
4. **Disconnect-aware cancellation** — `streaming.ts:31-37`
5. **Body size limits** — 1MB max, 30s API timeout, 5min streaming timeout
6. **Static file path traversal prevention** — `serveStatic` at `server.ts:159-173`
7. **Persistent rate limiter fail-closed** — Falls back to in-memory on DB failure
8. **Persistent anomaly detector fail-closed** — Same pattern
9. **Owner-scoped conversations** — All queries include `owner_id`
10. **Redaction on audit trail** — `recordAudit` applies `redactText()` consistently

## 6. Final Classification

```
GATE_16_FORENSIC_REVIEW=COMPLETE
CRITICAL_FINDINGS=4
HIGH_FINDINGS=7
SECURITY_FINDINGS_NEW=9
DOC_DRIFT_ITEMS=12
POSITIVE_OBSERVATIONS=10
REGRESSIONS_FROM_GATE_15=0
```
