# GATE 14 — FORENSIC REVIEW

**Date:** 2026-08-17
**Baseline:** 599/599 PASS (frozen Gate 13)
**Scope:** Deep forensic analysis of all source modules

---

## 1. Source File Inventory

| Module | Lines | Key Finding | Gate |
|--------|-------|-------------|------|
| `src/api/server.ts` | 287 | Gate 13 boundary controls working | Gate 13 |
| `src/api/execution.ts` | 667 | Token budget, tool loop, authority-per-step | Gate 11 |
| `src/api/handlers.ts` | 384 | Route dispatch, input validation | Gate 1 |
| `src/api/security.ts` | 22 | Guardian wiring — creates independent RateLimiter/AnomalyDetector | Gate 2 |
| `src/api/redact.ts` | 18 | Lazy singleton redactor | Gate 1 |
| `src/core/pipeline.ts` | 829 | Central orchestrator — rateLimiter/anomalyDetector never passed | Gate 1 |
| `src/core/orchestration.ts` | 751 | Multi-step — variable resolution mismatch | Gate 8 |
| `src/core/intent.ts` | 181 | Deterministic NLP parser | Gate 1 |
| `src/core/authority.ts` | 149 | 10-rule matrix — clampAutonomy is dead code | Gate 1 |
| `src/core/autonomy.ts` | 83 | Bounded escalation controller | Gate 1 |
| `src/core/taskEngine.ts` | ~150 | Task lifecycle | Gate 1 |
| `src/core/approval.ts` | ~100 | Approval engine | Gate 1 |
| `src/core/pos.ts` | ~80 | Personal OS | Gate 1 |
| `src/core/decisionJournal.ts` | ~60 | Decision journal | Gate 1 |
| `src/core/explanation.ts` | ~80 | Explanation layer | Gate 1 |
| `src/core/monitoring.ts` | ~70 | Monitoring | Gate 1 |
| `src/core/redact.ts` | 31 | Pattern-based redaction | Gate 1 |
| `src/core/security/guardian.ts` | 218 | 11-step eval chain — costCheck optional | Gate 2 |
| `src/core/security/criticalActions.ts` | 93 | 26 rules (DB has 17) | Gate 2+3 |
| `src/core/security/policyEngine.ts` | 203 | Precedence chain — environmentRank bug | Gate 2 |
| `src/core/security/rateLimit.ts` | 78 | In-memory, dual-instance, off-by-one | Gate 2 |
| `src/core/security/anomaly.ts` | 117 | In-memory, dual-instance, decay on call | Gate 2 |
| `src/core/security/promptInjection.ts` | 52 | Regex-only — modelOutputIsAuthority unused | Gate 2 |
| `src/core/security/lockdown.ts` | 71 | Owner-only release | Gate 2 |
| `src/core/security/secretGuard.ts` | 64 | 4 patterns, deep scan | Gate 2 |
| `src/db/repo.ts` | 729 | All SQL parameterized, owner_id in WHERE | Gate 1 |
| `src/db/pool.ts` | 33 | Connection pool | Gate 1 |
| `src/tools/query-engine.ts` | 432 | LIMIT/OFFSET interpolated, statement_timeout ineffective | Gate 6 |
| `src/tools/query-catalog.ts` | 206 | Entity whitelist | Gate 6 |
| `src/gateways/toolBroker.ts` | 92 | securityGuard optional, execute=false convention | Gate 1 |
| `src/gateways/resilience.ts` | 280 | Per-provider circuit, no cross-failover, dead reference | Gate 10 |
| `src/gateways/memoryGateway.ts` | 53 | Inert: recall returns [], saveLesson writes unreachable data | Gate 1 |
| `src/gateways/providerAdapter.ts` | ~150 | 3 adapters (OpenAI, Anthropic, Google) | Gate 1 |
| `src/gateways/modelGateway.ts` | ~100 | Model selection | Gate 1 |
| `src/gateways/runtimeGateway.ts` | ~100 | Runtime selection | Gate 1 |
| `src/gateways/secretProvider.ts` | ~80 | Secret provider | Gate 1 |
| `src/testing/memoryStore.ts` | ~400 | In-memory store for tests | Gate 3 |
| `src/integration/gate12.workflows.test.ts` | 974 | 62 workflow tests | Gate 12 |
| `src/api/gate13.boundary.test.ts` | ~350 | 22 boundary tests | Gate 13 |

---

## 2. Key Cross-Module Findings

### 2.1 Dual RateLimiter/AnomalyDetector Instances

```
server.ts line 198: new RateLimiter() → execution runner
server.ts line 199: new AnomalyDetector() → execution runner
security.ts line 17: new RateLimiter() → SecurityGuardian (inside guardian)
security.ts line 18: new AnomalyDetector() → SecurityGuardian (inside guardian)
pipeline.ts: rateLimiter/anomalyDetector → undefined (never passed from server.ts)
```

**Result:** 2 independent RateLimiter instances, 2 independent AnomalyDetector instances. Pipeline-level controls are dead code. Rate limits are effectively doubled.

### 2.2 SecurityGuardian Optional Wiring

```
pipeline.ts:152 — securityGuardian?: SecurityGuardian
execution.ts:90 — securityGuardian?: SecurityGuardian  
orchestration.ts:245 — securityGuardian?: SecurityGuardian
toolBroker.ts:59 — if (ctx.securityGuard) ... // optional
```

**Result:** Guardian is always provided in current production code, but the architecture allows silent omission. No startup assertion.

### 2.3 Variable Resolution Mismatch

```
orchestration.ts:44 — STEP_VAR_PATTERN = /^\$step\.(\d+)\.([a-zA-Z_]+)$/
orchestration.ts:125-132 — validateVariableRef() accepts any field name
orchestration.ts:418 — resolveArgs() only handles .id: value.endsWith('.id')
```

**Result:** `$step.0.data` passes validation but remains unresolved at execution.

---

## 3. Dead Code and Unreachable Paths

| # | File | Line | Description |
|---|------|------|-------------|
| D1 | orchestration.ts | 656-659 | Duplicate OrchestrationTimeoutError catch (unreachable) |
| D2 | authority.ts | 147-148 | `clampAutonomy()` is identity function, never called |
| D3 | execution.ts | 361 | `_secrets` parameter unused in runToolLoop |
| D4 | resilience.ts | 230 | `health.getState;` dead reference (no-op) |
| D5 | promptInjection.ts | — | `modelOutputIsAuthority` defined but unused |

---

## 4. Classification

**GATE_14_FORENSIC_REVIEW_COMPLETE**

55+ files read. 35 source findings, 23 drift findings. Security invariants verified (10/16 fully preserved, 6/16 with architectural concerns). 599/599 baseline preserved.
