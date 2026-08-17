# Gate 5 — Forensic Review

> **Date:** 2026-08-17
> **Gate 4 Baseline:** FROZEN (243 tests)

---

## 1. Gate 4 Baseline Integrity

### G4-01: Conversation History — VERIFIED

| Claim | Source Evidence | Status |
|-------|----------------|--------|
| History loaded in handler | `handlers.ts:80` — `loadHistory(owner.id, convId, 20)` | PASS |
| History passed to pipeline | `handlers.ts:89` — `pipeline.run(actorCtx(), command, conversationHistory)` | PASS |
| History reaches LLM messages | `execution.ts:190-198` — `[system, ...historyMessages, user]` | PASS |
| No bypass path exists | Single entry point in handlers.ts:52-101 | PASS |

### G4-02: SecurityGuard Wiring — VERIFIED

| Claim | Source Evidence | Status |
|-------|----------------|--------|
| Guardian injected via factory | `server.ts:245-251` — `createSecurityGuardian(store)` | PASS |
| Hook closure built | `execution.ts:228-260` — captures `securityGuardian` | PASS |
| Hook passed to broker | `execution.ts:343` — `securityGuard: securityGuardHook` | PASS |
| Broker invokes hook | `toolBroker.ts:57-66` — `if (ctx.securityGuard)` now true | PASS |
| Guardian chain runs 11 steps | `guardian.ts:33-161` — lockdown→critical→env→cross→rate→cost→prompt→policy→combine→anomaly→events | PASS |

### G4-03: Authority Resolution — VERIFIED

| Claim | Source Evidence | Status |
|-------|----------------|--------|
| Per-tool-call resolution | `execution.ts:311-327` — `evaluateAuthority()` per tool | PASS |
| Real decision from matrix | `execution.ts:341` — `decision: toolAuthority.outcome` | PASS |
| No hardcoded 'auto' | Removed in Gate 4 | PASS |
| Deny branch reachable | `toolBroker.ts:45-46` — `ctx.decision === 'deny'` | PASS |

### G4-04: Anomaly Counters — VERIFIED

| Claim | Source Evidence | Status |
|-------|----------------|--------|
| toolAnomalies on unknown tool | `execution.ts:299` | PASS |
| toolAnomalies on denial | `execution.ts:355` | PASS |
| toolAnomalies on exception | `execution.ts:387` | PASS |
| Threshold signal fires | `anomaly.ts:50-64` — counter ≥ threshold → signal | PASS |

### G4-05: Failure-Rate Limits — VERIFIED

| Claim | Source Evidence | Status |
|-------|----------------|--------|
| model.call at loop entry | `execution.ts:179-187` | PASS |
| task.failure after 3+ fails | `execution.ts:358-366` | PASS |
| Consecutive reset on success | `execution.ts:370` | PASS |
| Loop terminates on exceed | `execution.ts:361-365` — early return | PASS |

### GATE_4_BASELINE_INTEGRITY = VERIFIED

---

## 2. New Findings (Discovered During Gate 5 Discovery)

### Finding G5-01: Double Execution Bug — CRITICAL

**Location:** `execution.ts:372` + `toolBroker.ts:71`

**Description:** Tool handlers execute twice per tool call:
1. `broker.call()` → `tool.run(args)` at toolBroker.ts:71 → wraps `toolDef.handler()` (execution.ts:220-221)
2. `runToolLoop` → `toolDef.handler()` at execution.ts:372

**Impact:** Every write tool (create_project, create_task, update_task) creates duplicate records. Read tools return results twice (wasteful but not corrupting).

**Severity:** CRITICAL — data corruption for all write operations.

**Evidence:** Source code at execution.ts:368-389 and toolBroker.ts:70-75.

**Status:** NOT FIXED (discovered during read-only discovery). Must be fixed in Gate 5 implementation.

### Finding G5-02: Text-Only Fallback Security Bypass — HIGH

**Location:** `execution.ts:89-115`

**Description:** When the selected model does not support tools, the text-only fallback path calls `adapter.complete()` directly without:
- ToolBroker checks
- Authority evaluation
- SecurityGuardian evaluation
- Rate limit checks (beyond the initial model.call check)
- Anomaly recording

**Impact:** A text-only model execution bypasses the entire security chain after the initial gateway selection.

**Severity:** HIGH — security chain gap in a defined execution path.

**Evidence:** Source code at execution.ts:89-115 — no broker, no authority, no guardian calls.

**Status:** NOT FIXED. Must be addressed in Gate 5.

### Finding G5-03: Cost Protection Disabled — HIGH

**Location:** `costProtection.ts:15-21`

**Description:** All three hard limits are `null` by default:
- `projectMonthlyHardLimit: null`
- `ownerMonthlyHardLimit: null`
- `projectDailyHardLimit: null`

The `check()` method returns `{stopped: false}` when limits are null, effectively disabling cost protection.

**Impact:** No automatic spending stop unless operator manually configures limits.

**Severity:** HIGH — production cost exposure.

**Evidence:** Source code at costProtection.ts:15-21; AS_BUILT_SECURITY.md:661.

**Status:** NOT FIXED. Requires owner decision (OD4) to configure limits.

### Finding G5-04: Prompt Injection No-Deny Rule — MEDIUM

**Location:** `policyEngine.ts:51-151`

**Description:** The policy engine has 12 rules but none check for `untrustedAuthorityDirective.present === true`. The Guardian records the directive as evidence (guardian.ts:116-124) but the policy engine does not act on it.

**Impact:** Prompt injection directives are detected and logged but do not block the action.

**Severity:** MEDIUM — defense-in-depth gap.

**Evidence:** Source code at policyEngine.ts:51-151 (no untrustedAuthorityDirective branch).

**Status:** NOT FIXED. Must be addressed in Gate 5.

### Finding G5-05: Anomaly Counter Monotonic Accumulation — LOW

**Location:** `anomaly.ts:50-64`

**Description:** Anomaly counters increment monotonically with no time-based reset. A long-running process accumulates counters forever, eventually hitting thresholds even at normal request rates.

**Impact:** False positive anomaly signals in long-running sessions.

**Severity:** LOW — operational nuisance, not security breach.

**Evidence:** Source code at anomaly.ts:50-64 (no decay logic).

**Status:** NOT FIXED. Must be addressed in Gate 5.

### Finding G5-06: Critical Action Vocabulary Dormant — MEDIUM

**Location:** `authority.ts` + `criticalActions.ts`

**Description:** The pipeline's `actionTypeFor()` produces vocabulary like `financial`, `deploy`, `delete`. The critical action registry uses `financial_transaction`, `production_modification`, `production_deletion`. Without an alias map, `classifyCriticalAction()` never matches pipeline action types.

**Impact:** The critical action defense-in-depth layer is dormant in the execution path.

**Severity:** MEDIUM — defense layer exists but is unreachable.

**Evidence:** Gate 2 Forensic Review Section 25.2; authority.ts riskFromAction vs criticalActions.ts rule matching.

**Status:** NOT FIXED (partially mitigated in Gate 3 with v2 rules, but alias map still missing).

---

## 3. Drift Summary

| Category | Gate 4 Baseline | Gate 5 New | Total Active |
|----------|----------------|-----------|-------------|
| CRITICAL | 0 | 1 (G5-01) | 1 |
| HIGH | 0 | 2 (G5-02, G5-03) | 2 |
| MEDIUM | 0 | 2 (G5-04, G5-06) | 2 |
| LOW | 0 | 1 (G5-05) | 1 |
| **Total** | **0** | **6** | **6** |

---

## 4. Classification

```
GATE_4_BASELINE_INTEGRITY = VERIFIED
GATE_5_NEW_FINDINGS = 6 (1 CRITICAL, 2 HIGH, 2 MEDIUM, 1 LOW)
GATE_5_FORENSIC_REVIEW = COMPLETE
```
