# GATE 17 — FINAL REPORT

**Date:** 2026-08-19
**Mission:** Security Event Audit Trail Reliability
**Classification:** PARTIAL — FAILURE_OBSERVABILITY PASS / RECOVERY UNPROVEN

---

## 1. PROBLEM STATEMENT

Four persistence paths used `void` to discard DB-write promises:
- `guardian.ts:51` → `void this.deps.recordEvent(event)` — security events silently lost
- `security.ts:23` → `void store.recordSecurityEvent(...)` — security events silently lost
- `rateLimit.ts:139` → `void this.saveState(...)` — rate limit state silently lost
- `anomaly.ts:192` → `void this.saveState(...)` — anomaly counters silently lost

Additionally, `rateLimit.ts` and `anomaly.ts` had a `persistenceFailureLogged` flag that silenced all failures after the first one.

---

## 2. WHAT WAS DONE

### 2.1 Security Event Persistence (`security.ts`)
**Before:**
```typescript
recordEvent: (event) => { void store.recordSecurityEvent(event.ownerId, event); },
```
**After:**
```typescript
recordEvent: (event) => { store.recordSecurityEvent(event.ownerId, event).catch(() => { console.warn('[Gate 17] Security event persistence failed — audit gap possible'); }); },
```
- `.catch()` handles rejection, logs every failure with explicit `[Gate 17]` tag

### 2.2 Rate Limit Persistence (`rateLimit.ts`)
- Removed `persistenceFailureLogged` flag — every failure now logged at WARN level
- `checkPersisted()` now uses `.catch()` on the `saveState()` call instead of `void`
- Failure message unchanged for backward compatibility

### 2.3 Anomaly Persistence (`anomaly.ts`)
- Removed `persistenceFailureLogged` flag — every failure now logged at WARN level
- `notePersisted()` now uses `.catch()` on the `saveState()` call instead of `void`
- Failure message unchanged for backward compatibility

---

## 3. EVIDENCE MATRIX

| Metric | Before (Gate 16 baseline) | After (Gate 17) |
|---|---|---|
| tsc --noEmit | CLEAN | CLEAN |
| Full test suite | 699/699 PASS | 716/716 PASS |
| Gate 17 new tests | 0 | 17 |
| Gate 14 regression | 25/25 | 25/25 |
| Gate 16 regression | 12/12 | 12/12 |
| SecurityGuardian regression | 41/41 | 41/41 |
| SKIPPED | 7 | 7 |

---

## 4. INDEPENDENT CLASSIFICATION

### 4.1 FAILURE_OBSERVABILITY: **PASS**

Every DB write failure is now logged at WARN level with `[Gate 14]` or `[Gate 17]` tag:
- Security event persistence: logged every time via `.catch()`
- Rate limit persistence load/save: logged every time (no more `persistenceFailureLogged` silence)
- Anomaly persistence load/save: logged every time (no more `persistenceFailureLogged` silence)

**Evidence:** `G17-LOG-01` through `G17-LOG-04` prove every failure is logged (not just once). `G17-SE-01` and `G17-SE-02` prove `.catch()` fires on security event persistence failure.

### 4.2 RECOVERY: **UNPROVEN**

No retry mechanism exists in the current architecture:
- `saveState()` tries once, catches, logs, returns — no retry loop
- `notePersisted()` tries once, catches, logs, returns — no retry loop
- `.catch()` in security.ts logs once — no retry, no re-enqueue
- No durable queue, no background worker, no global retry service (per OD22 scope)

**Evidence:** `G17-RETRY-01` through `G17-RETRY-05` prove `saveAttempts === 1` for all persistence paths.

### 4.3 OVERALL: **PARTIAL**

The system no longer silently swallows persistence failures. An operator observing logs can now detect when audit events are lost. However, when a DB write fails, the event is permanently lost — there is no recovery mechanism to re-persist it.

---

## 5. TEST INVENTORY

| Test ID | Category | What it proves |
|---|---|---|
| G17-LOG-01 | Observability | rateLimit saveState logs every failure |
| G17-LOG-02 | Observability | rateLimit loadState logs every failure |
| G17-LOG-03 | Observability | anomaly saveState logs every failure |
| G17-LOG-04 | Observability | anomaly loadState logs every failure |
| G17-SE-01 | Observability | recordEvent .catch() logs on DB failure |
| G17-SE-02 | Observability | store.recordSecurityEvent .catch() logs on DB failure |
| G17-RETRY-01 | Recovery | rateLimit saveState does NOT retry |
| G17-RETRY-02 | Recovery | anomaly saveState does NOT retry |
| G17-RETRY-03 | Recovery | checkPersisted does NOT retry |
| G17-RETRY-04 | Recovery | notePersisted does NOT retry |
| G17-RETRY-05 | Recovery | recordEvent .catch() does NOT retry |
| G17-MEMORY-01 | Correctness | in-memory counters work after persistence failure |
| G17-MEMORY-02 | Correctness | in-memory anomaly counters work after persistence failure |
| G17-FAKE-01 | Correctness | checkPersisted returns correct decision (no fake success) |
| G17-FAKE-02 | Correctness | notePersisted returns correct signal (no fake success) |
| G17-G16-01 | Regression | PersistentRateLimiter extends RateLimiter |
| G17-G16-02 | Regression | PersistentAnomalyDetector extends AnomalyDetector |

---

## 6. FILES MODIFIED

| File | Change |
|---|---|
| `src/api/security.ts` | `void store.recordSecurityEvent(...)` → `.catch()` logging |
| `src/core/security/rateLimit.ts` | Removed `persistenceFailureLogged`, every failure logged, `.catch()` in `checkPersisted` |
| `src/core/security/anomaly.ts` | Removed `persistenceFailureLogged`, every failure logged, `.catch()` in `notePersisted` |

## 7. FILES CREATED

| File | Tests |
|---|---|
| `src/core/security/gate17.auditTrail.test.ts` | 17 tests (observability, recovery, correctness, regression) |

---

## 8. SCHEMA / MIGRATION / RLS / API CHANGES

**NONE.** All changes are in TypeScript source only. No database changes.

---

## 9. GATE 5 INVARIANTS PRESERVED

- ✅ Single execution path (no new execution paths)
- ✅ SecurityGuardian still orchestrates all checks
- ✅ Authority resolution unchanged
- ✅ Cost protection unchanged
- ✅ Prompt injection denial unchanged
- ✅ Anomaly controls unchanged (counters still accumulate)
- ✅ Owner/project isolation unchanged
- ✅ ToolBroker boundary unchanged
- ✅ Fail-closed behavior preserved

---

## 10. OPEN DECISIONS

- **OD24:** Whether to add retry/recovery in a future gate (outside Gate 17 scope per OD22)
- **OD8/19/21:** Git init/push (owner decision pending)

---

**Gate 17 Status:** COMPLETE — PARTIAL classification
**Next:** Await owner review and OD24 decision
