# GATE 15 — SECURITY FINDINGS & INVARIANTS

> Date: 2026-08-17
> Mode: DISCOVERY_ONLY

## 1. Security Findings

### G15-01: Guardian lockdownActive (FALSE_POSITIVE — RESOLVED)

| Attribute | Value |
|-----------|-------|
| Original severity | HIGH |
| Final classification | FALSE_POSITIVE |
| Production impact | NONE |
| Exploitability | NONE |
| Action required | None |

**Evidence:** Guardian queries DB on every `evaluate()` call (`guardian.ts:52`). Early-return guard at lines 53-65 returns `decision: 'lockdown'` immediately when DB confirms active lockdown. The `lockdownActive: false` at line 129 is structurally unreachable when lockdown is active. No in-memory cache. No process restart vulnerability.

### G15-03: MemoryGateway.saveLesson (INVALID — RESOLVED)

| Attribute | Value |
|-----------|-------|
| Original severity | MEDIUM |
| Final classification | INVALID (factually wrong) |
| Production impact | NONE |
| Action required | None |

**Evidence:** Code calls `store.saveLesson()` (not `store.executeSql()`). `saveLesson` exists on Store interface, is implemented in SupabaseStore with parameterized SQL. MemoryGateway is intentionally deferred (`configured: false`). No production code invokes it.

### New Findings (NF-1 through NF-5)

All documentation drift. No security findings. See GATE_15_DISCOVERY_REPORT.md §6.

## 2. Security Invariants Verification (16/16 Preserved)

| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Single execution (no double fire) | PRESERVED | ToolBroker `ctx.execute === false` boundary, handler exactly-once |
| 2 | SecurityGuardian on all critical paths | PRESERVED | `guardian.ts` 10-step eval chain, wired in `server.ts:197` |
| 3 | Authority resolution per-step | PRESERVED | `authority.ts` 10-rule matrix, called per orchestration step |
| 4 | Cost protection ($5/day, $100/month) | PRESERVED | `costProtection.ts:24` PRODUCTION_COST_PROTECTION, Guardian step 6 |
| 5 | Prompt injection denial | PRESERVED | `promptInjection.ts` 12 regex patterns, PolicyEngine DENY |
| 6 | Anomaly detection | PRESERVED | `PersistentAnomalyDetector` with DB persistence + decay |
| 7 | Owner isolation (WHERE clauses) | PRESERVED | Every repo.ts query takes ownerId, `WHERE owner_id = $1` |
| 8 | Project isolation (RLS) | PRESERVED | 28 tables all have RLS enabled |
| 9 | Conversation isolation | PRESERVED | `WHERE conversation_id = $1 AND owner_id = $2` |
| 10 | ToolBroker boundary | PRESERVED | `execute: false` validation-only mode, safeSummary redaction |
| 11 | Rate limiting | PRESERVED | `PersistentRateLimiter` with DB persistence |
| 12 | Lockdown enforcement | PRESERVED | DB-backed, fresh query on every Guardian call |
| 13 | Critical action registry | PRESERVED | 26 rules (17 DB-immutable + 9 code-level) |
| 14 | API boundary (body limit, timeout, CT) | PRESERVED | Gate 13: 1MB, 30s, application/json |
| 15 | Error sanitization | PRESURED | No stack traces, no internal details in API responses |
| 16 | Gate 14 persistence (rate/anomaly) | PRESERVED | PersistentRateLimiter + PersistentAnomalyDetector with fail-closed |

## 3. Security Impact of Recommended Mission (Streaming)

The recommended streaming mission has **NO security impact**:

- Streaming is a delivery mechanism (how tokens reach the client), not a security control
- All existing Guardian, authority, rate limiting, and cost protection controls remain on the execution path
- The SSE endpoint would use the same authentication (Bearer token) as existing endpoints
- No new DB tables, no new API permissions, no new attack surface beyond the existing `/api/chat` endpoint
- Response redaction (`getRedactor().redact()`) applies to streamed tokens just as it applies to synchronous responses

## 4. Security Risks of NOT Implementing Streaming

- None. Streaming is a UX improvement, not a security requirement.

## 5. Carry-Forward Security Items (All Deferred from Prior Gates)

| ID | Finding | Severity | Status | Target Gate |
|----|---------|----------|--------|-------------|
| F-CRIT-01 | Plaintext secrets in .env | CRITICAL | DEFERRED | Infrastructure (owner action) |
| F-CRIT-02 | Guardian optional in ToolBroker | CRITICAL | DEFERRED (low production risk) | Gate 16+ |
| F-CRIT-03 | SSL cert verification disabled | CRITICAL | DEFERRED | Infrastructure (owner action) |
| F-SEC-01 | Security guard hardcoded authorized | HIGH | DEFERRED | Gate 16+ |

Note: F-CRIT-01 and F-CRIT-03 are infrastructure concerns (env file encryption, SSL config) that require owner action, not code changes. F-CRIT-02 is a code-level optionality issue with no production impact (Guardian is always instantiated in server.ts).
