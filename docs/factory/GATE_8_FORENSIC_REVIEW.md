# Gate 8 — Forensic Review

> Date: 2026-08-17
> Scope: Complete source code audit of 90 source files, 31 test files, 5 migrations
> Method: Read-only forensic inspection of every source file in the codebase

---

## Audit Methodology

Every file under `src/` was read and analyzed for:
1. Security boundary enforcement
2. Authority/resolution correctness
3. Error handling patterns
4. Idempotency guarantees
5. Data leakage paths
6. Cross-owner/cross-project isolation
7. Provider failure handling
8. Audit trail completeness
9. Architectural consistency

---

## Source File Inventory

| Directory | Files | Lines (approx) | Purpose |
|-----------|-------|-----------------|---------|
| `src/api/` | 11 | ~1,350 | HTTP server, handlers, auth, security wiring, execution runner |
| `src/core/` | 25 | ~1,800 | Pipeline, intent, authority, autonomy, task engine, approvals, monitoring, cost, POS, decision journal, explanation, conversation, passport, redact |
| `src/core/security/` | 16 | ~1,500 | Guardian, policy engine, risk engine, anomaly, cost protection, rate limit, prompt injection, critical actions, events, incidents, lockdown, health, secret guard, types |
| `src/db/` | 4 | ~1,050 | Config, pool, repo (729 lines), seed |
| `src/gateways/` | 10 | ~600 | ToolBroker, model/runtime/memory gateways, secret provider, provider adapter interfaces |
| `src/gateways/adapters/` | 5 | ~400 | OpenAI, Anthropic, Google, OpenCode Zen adapters |
| `src/tools/` | 13 | ~600 | 6 tool implementations, query engine/catalog/types, tool registry |
| `src/integration/` | 5 | ~1,500 | Live integration tests |
| `src/testing/` | 1 | ~100 | In-memory store for tests |

**Total: 90 source files, ~8,900 lines of production code**

---

## Security Boundary Audit

### 1. ToolBroker Boundary

| Check | Status | Evidence |
|-------|--------|----------|
| Authority check before execution | PASS | `toolBroker.ts:37-39` — `ctx.decision === 'deny'` → `denied_by_authority` |
| Approval gate | PASS | `toolBroker.ts:42-44` — `require_approval` without `approved` → `requires_approval` |
| Risk ceiling enforcement | PASS | `toolBroker.ts:48-56` — numeric risk comparison |
| SecurityGuard hook | PASS | `toolBroker.ts:58-66` — `ctx.securityGuard` callback |
| `execute: false` mode (G5-01) | PASS | `toolBroker.ts:68-70` — validation-only path |
| Safe audit summary | PASS | `toolBroker.ts:76-82` — `safeSummary()` truncates to 2000 chars + redacts |
| Unknown tool handling | PASS | `toolBroker.ts:34-36` — returns `tool_not_found` |

### 2. Pipeline Security Integration

| Check | Status | Evidence |
|-------|--------|----------|
| Security Guardian wired | PASS | `pipeline.ts:236-288` — full SecurityRequest construction |
| Guardian only more restrictive | PASS | `pipeline.ts:270-287` — `moreRestrictive()` reconciliation |
| DENY always wins | PASS | `pipeline.ts:309-321` — early return on deny |
| Ambiguity blocking | PASS | `pipeline.ts:151-170` — blocks when intent not resolved |
| No fabrication | PASS | `pipeline.ts:615-617` — throws if explanation incomplete |

### 3. Authentication Boundary

| Check | Status | Evidence |
|-------|--------|----------|
| JWT validation | PASS | `auth.ts:26-29` — `supabase.auth.getUser(token)` |
| RLS enforcement | PASS | `auth.ts:31-42` — Bearer token passed as header to PostgREST |
| Active owner check | PASS | `auth.ts:43` — `owner.status === 'active'` |
| Fail-safe null | PASS | `auth.ts:28,44` — every error returns null |
| No session persistence | PASS | `auth.ts:18-19` — `persistSession: false` |

### 4. Query Data Security

| Check | Status | Evidence |
|-------|--------|----------|
| Entity allowlist | PASS | `query-data.ts:32` — 9 allowed entities |
| Field allowlist | PASS | `query-catalog.ts` — per-entity field catalogs |
| Owner injection (server-side) | PASS | `query-data.ts:44` — `ownerId` from context, not input |
| SQL parameterization | PASS | `query-engine.ts` — all values via `$N` params |
| Byte limit (G7) | PASS | `query-engine.ts:386-399` — 50KB enforcement |
| Timeout (G7) | PASS | `query-engine.ts:380` — `SET LOCAL statement_timeout` |
| Rate limits (G7) | PASS | `rateLimit.ts:21-22` — dedicated scopes |
| Enumeration limit (G7) | PASS | `query-data.ts:95-106` — per-entity counter |
| Concurrency limit (G7) | PASS | `query-data.ts:111-128` — semaphore |
| Error sanitization (G7) | PASS | `query-data.ts:113,120` — generic messages |

### 5. Database Security

| Check | Status | Evidence |
|-------|--------|----------|
| RLS on all 26 tables | PASS | 86 RLS policies across 5 migrations |
| Append-only audit | PASS | Triggers + REVOKE on `audit_events` |
| Append-only security events | PASS | Triggers + REVOKE on `security_events` |
| Append-only conversation messages | PASS | Triggers + REVOKE on `conversation_messages` |
| Critical action immutability | PASS | Triggers + REVOKE on `critical_actions` |
| Truncate protection | PASS | 7 BEFORE TRUNCATE triggers (migration 4) |
| TRUNCATE privilege revoked | PASS | `REVOKE TRUNCATE, TRIGGER FROM anon, authenticated` |

---

## Error Handling Audit

### Adapter Error Handling

| Adapter | Error Strategy | Retry | Timeout | Fallback |
|---------|---------------|-------|---------|----------|
| OpenAI | Throws on HTTP error | NONE | NONE | None |
| Anthropic | Throws on HTTP error | NONE | NONE | None |
| Google | Throws on HTTP error | NONE | NONE | None |
| OpenCode Zen | Returns `ok: false` | NONE | NONE | None |

**Gap identified:** All three LLM adapters throw on failure with no retry, no timeout, and no cross-provider fallback. The execution runner (`execution.ts:203-225`) catches these and returns `ok: false`, but the owner gets a raw error.

### Tool Error Handling

| Tool | Strategy | Consistent |
|------|----------|------------|
| create_project | try/catch → `{ success: false, error: String(e) }` | YES |
| create_task | try/catch → `{ success: false, error: String(e) }` | YES |
| list_projects | try/catch → `{ success: false, error: String(e) }` | YES |
| list_tasks | try/catch → `{ success: false, error: String(e) }` | YES |
| update_task | try/catch → `{ success: false, error: String(e) }` | YES |
| query_data | try/catch + validation → structured errors | YES |

All 6 tools follow the same pattern: validate inputs eagerly, wrap DB operations in try/catch, return structured `{ success, data?, error? }`.

---

## Idempotency Audit

| Component | Idempotent? | Notes |
|-----------|-------------|-------|
| `parseIntent()` | YES | Pure function, no side effects |
| `evaluateAuthority()` | YES | Pure function, deterministic rules |
| `evaluateAutonomy()` | YES | Pure function, bounded escalation |
| `transitionTask()` | YES (function-level) | Returns new record, DB enforces uniqueness |
| `resolveApproval()` | PARTIAL | Checks terminal state, but DB unique index provides true idempotency |
| `ToolBroker.call()` | YES (G5-01) | `execute: false` mode + single handler invocation |
| `RateLimiter.check()` | NO | Counter increments on each call — no dedup |
| `Store.recordCost()` | NO | Append-only — no dedup key |
| `Store.recordAudit()` | NO | Append-only — no dedup key |
| `CostProtector.check()` | YES | Read-only aggregation |

**Gap identified:** `RateLimiter.check()`, `Store.recordCost()`, and `Store.recordAudit()` lack deduplication. Rapid retries could over-count costs, rate limits, or audit events.

---

## Isolation Audit

### Owner Isolation

| Layer | Mechanism | Evidence |
|-------|-----------|----------|
| Database | RLS `owner_id = auth.uid()` | 86 policies across 26 tables |
| Application | `ownerId` parameter in every Store method | `ports.ts` — all 40+ methods take `ownerId` first |
| Tool handlers | `ownerId` from context, not input | `query-data.ts:44`, `create-task.ts:22` |
| Conversations | `owner_id = $2` in SQL | `conversation.ts:73,100,119,163` |

### Project Isolation

| Layer | Mechanism | Evidence |
|-------|-----------|----------|
| Database | RLS subquery to `projects` | Tasks, approvals, etc. verified via project ownership |
| Application | Subquery in repo methods | `repo.ts` — ownership subqueries |
| Query data | Server-side owner_id injection | `query-data.ts:44` |

### Conversation Isolation

| Layer | Mechanism | Evidence |
|-------|-----------|----------|
| Database | RLS on `conversations` + `conversation_messages` | Migration 5 |
| Application | `owner_id = $2` in all queries | `conversation.ts` — every method filters by owner |

**ZERO isolation gaps detected.**

---

## Audit Trail Completeness

| Event Type | Source | Persisted | Append-Only |
|-----------|--------|-----------|-------------|
| command.received | `pipeline.ts` | `store.recordAudit` | YES (triggers) |
| tool.execution | `pipeline.ts` | `store.recordAudit` | YES |
| decision.recorded | `pipeline.ts` | `store.recordDecision` | YES (no triggers but insert-only pattern) |
| security.* (25 types) | `guardian.ts` | `store.recordSecurityEvent` | YES (triggers + REVOKE) |
| cost.recorded | `execution.ts` | `store.recordCost` | YES (no triggers but insert-only pattern) |
| task.lifecycle | `pipeline.ts` | `store.patchTask` | YES (updates allowed but tracked) |

---

## Architectural Consistency Check

| Pattern | Consistent? | Evidence |
|---------|-------------|----------|
| Pure functions in `src/core/` | YES | intent, authority, autonomy, taskEngine, approval, explanation, decisionJournal, pos — all pure |
| Store port pattern | YES | `ports.ts` defines interface; `repo.ts` implements; tests use in-memory fakes |
| ToolHandler pattern | YES | All 6 tools: `(input: ToolHandlerInput) => Promise<ToolHandlerResult>` |
| Error-as-value pattern | YES | No thrown exceptions in core logic; errors returned as structured objects |
| Owner-scoped methods | YES | Every Store method takes `ownerId` first |
| "Nothing invented" | YES | ModelGateway/RuntimeGateway return `null` with reasons; `parseIntent` returns `missing[]` |

---

## Findings Summary

| # | Finding | Severity | Classification |
|---|---------|----------|----------------|
| F1 | Single-command execution (no multi-step orchestration) | HIGH | PRIMARY_BOTTLENECK |
| F2 | No provider retry/timeout/fallback | HIGH | CAPABILITY_GAP |
| F3 | No conversation summarization (20-msg hard limit) | MEDIUM | CAPABILITY_GAP |
| F4 | Memory layer inert (no vector backend) | MEDIUM | CAPABILITY_GAP |
| F5 | RateLimiter.check() not idempotent | LOW | ARCHITECTURE |
| F6 | Store.recordCost() no dedup key | LOW | ARCHITECTURE |
| F7 | No streaming response delivery | MEDIUM | PRODUCT_GAP |
| F8 | Google adapter usage always null | LOW | ADAPTER |
| F9 | No AbortController in any adapter | MEDIUM | RELIABILITY |
| F10 | ARCHITECTURE.md says 17 critical actions (actual: 24) | LOW | DOCUMENTATION_DRIFT |

**CRITICAL_FINDINGS = 0**
**HIGH_FINDINGS = 2** (F1, F2)
**MEDIUM_FINDINGS = 4** (F3, F4, F7, F9)
**LOW_FINDINGS = 4** (F5, F6, F8, F10)
