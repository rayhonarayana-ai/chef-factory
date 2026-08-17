# Gate 4 — Evidence Contract

> **Date:** 2026-08-17
> **Classification:** GATE_4_PASS

---

## Evidence E1 — Conversation History (G4-01)

| Evidence Type | File | Line(s) | Status |
|---------------|------|---------|--------|
| Type definition | `pipeline.ts` | 21-28 | PASS |
| Param in `run()` | `pipeline.ts` | 132 | PASS |
| Param in `execute()` | `pipeline.ts` | 84 | PASS |
| Param in `executeTask()` | `pipeline.ts` | 387 | PASS |
| Load in handler | `handlers.ts` | 79-86 | PASS |
| Insert in execution | `execution.ts` | 170-180 | PASS |
| Unit test | `gate4.execution.test.ts` | 3 tests | PASS |
| Live test | `gate4.live.integration.test.ts` | 2 tests | PASS |

---

## Evidence E2 — SecurityGuard Wiring (G4-02)

| Evidence Type | File | Line(s) | Status |
|---------------|------|---------|--------|
| Option type | `execution.ts` | 39-43 | PASS |
| Factory injection | `server.ts` | 245-251 | PASS |
| Hook closure | `execution.ts` | 195-207 | PASS |
| Broker context | `execution.ts` | 211 | PASS |
| ToolBroker branch | `toolBroker.ts` | 57-66 | PASS (now reachable) |
| Unit test | `gate4.execution.test.ts` | 2 tests | PASS |
| Live test (lockdown) | `gate4.live.integration.test.ts` | 1 test | PASS |

---

## Evidence E3 — Authority Resolution (G4-03)

| Evidence Type | File | Line(s) | Status |
|---------------|------|---------|--------|
| Per-tool-call resolution | `execution.ts` | 217-235 | PASS |
| Risk from tool | `execution.ts` | 219-220 | PASS |
| Matrix lookup | `execution.ts` | 221-227 | PASS |
| Real decision passed | `execution.ts` | 233-234 | PASS |
| `evaluateAuthority()` | `authority.ts` | 49-97 | PASS |
| `riskFromAction()` | `authority.ts` | 17-26 | PASS |
| Unit test | `gate4.execution.test.ts` | 2 tests | PASS |
| Live test | `gate4.live.integration.test.ts` | 1 test | PASS |

---

## Evidence E4 — Anomaly Counters (G4-04)

| Evidence Type | File | Line(s) | Status |
|---------------|------|---------|--------|
| Unknown tool increment | `execution.ts` | 229 | PASS |
| Denial increment | `execution.ts` | 237 | PASS |
| Exception increment | `execution.ts` | 284 | PASS |
| AnomalyDetector threshold | `anomaly.ts` | 16 | PASS |
| Unit test | `gate4.execution.test.ts` | 2 tests | PASS |
| Live test | `gate4.live.integration.test.ts` | 1 test | PASS |

---

## Evidence E5 — Failure-Rate-Limit Scopes (G4-05)

| Evidence Type | File | Line(s) | Status |
|---------------|------|---------|--------|
| `model.call` check | `execution.ts` | 174-177 | PASS |
| `task.failure` check | `execution.ts` | 179-182 | PASS |
| Consecutive failure reset | `execution.ts` | 282 | PASS |
| RateLimiter default limits | `rateLimit.ts` | 5 | PASS |
| Unit test | `gate4.execution.test.ts` | 4 tests | PASS |
| Live test | `gate4.live.integration.test.ts` | 1 test | PASS |

---

## Summary

| Evidence | Required | Provided | Status |
|----------|----------|----------|--------|
| E1: History | ≥1 test + live | 3 unit + 2 live | PASS |
| E2: SecurityGuard | ≥1 test + live | 2 unit + 1 live | PASS |
| E3: Authority | ≥1 test + live | 2 unit + 1 live | PASS |
| E4: Anomaly | ≥1 test + live | 2 unit + 1 live | PASS |
| E5: Rate Limit | ≥1 test + live | 4 unit + 1 live | PASS |
| **Total** | **≥10** | **21** | **ALL PASS** |
