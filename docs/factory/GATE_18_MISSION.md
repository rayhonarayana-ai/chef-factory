# GATE 18 — MISSION OPTIONS

**Date:** 2026-08-19
**Recommended:** MISSION 1

## Mission 1: ConversationService Refactor + Test Coverage

| Attribute | Value |
|-----------|-------|
| MISSION_ID | G18-M1 |
| TITLE | ConversationService Architecture + Test Coverage |
| PROBLEM | ConversationService bypasses Store port, zero tests, duplicated logic |
| EVIDENCE | F-RUN-10, F-DATA-10, F-DATA-12, F-RUN-34 |
| WHY_IT_MATTERS | Largest untested data path. Architectural violation. DRY violation. |
| SECURITY_IMPACT | LOW |
| SCOPE | Refactor to Store port + 15-20 tests |
| FILES | conversation.ts, handlers.ts, streaming.ts, new test file |
| DEPENDENCIES | None |
| RISK | LOW (pure refactor) |
| EXPECTED_BENEFIT | Testability, maintainability, correctness |
| TESTABILITY | HIGH |
| EXPECTED_TESTS | +15-20 (716 → 731-736) |
| SUCCESS_CRITERIA | Uses Store port, all CRUD tested, DRY |

## Mission 2: API Boundary Hardening (CORS + Headers)

| Attribute | Value |
|-----------|-------|
| MISSION_ID | G18-M2 |
| TITLE | API Boundary Hardening — CORS + Security Headers |
| PROBLEM | No CORS, no security headers |
| EVIDENCE | F-RUN-18 |
| WHY_IT_MATTERS | Security gap. Small scope. High leverage. |
| SECURITY_IMPACT | HIGH |
| SCOPE | CORS middleware + headers + 8-10 tests |
| FILES | server.ts, new test file |
| DEPENDENCIES | None |
| RISK | LOW |
| EXPECTED_BENEFIT | Cross-origin protection, compliance |
| TESTABILITY | HIGH |
| EXPECTED_TESTS | +8-10 (716 → 724-726) |
| SUCCESS_CRITERIA | Headers present, OPTIONS preflight works |

## Mission 3: Tool Handler Timeout + AbortSignal

| Attribute | Value |
|-----------|-------|
| MISSION_ID | G18-M3 |
| TITLE | Tool Handler Timeout + AbortSignal |
| PROBLEM | No per-handler timeout, leaked promises |
| EVIDENCE | F-RUN-03, F-RUN-25 |
| WHY_IT_MATTERS | Resource leak under load |
| SECURITY_IMPACT | LOW |
| SCOPE | AbortSignal in handler contract + timeout + 10 tests |
| FILES | types.ts, execution.ts, toolBroker.ts |
| DEPENDENCIES | None |
| RISK | MEDIUM (contract change) |
| EXPECTED_BENEFIT | Resource protection |
| TESTABILITY | HIGH |
| EXPECTED_TESTS | +10 (716 → 726) |
| SUCCESS_CRITERIA | Handlers receive signal, timeout cancels, no leaks |

## Mission 4: Security Audit Event Recovery

| Attribute | Value |
|-----------|-------|
| MISSION_ID | G18-M4 |
| TITLE | Security Audit Event Recovery |
| PROBLEM | Events permanently lost on DB failure |
| EVIDENCE | F-SEC-01, gate17.auditTrail.test.ts |
| WHY_IT_MATTERS | Completes Gate 17 story |
| SECURITY_IMPACT | MODERATE |
| SCOPE | Bounded retry + 5-8 tests |
| FILES | security.ts, rateLimit.ts, anomaly.ts |
| DEPENDENCIES | None |
| RISK | LOW |
| EXPECTED_BENEFIT | Transient failure recovery |
| TESTABILITY | HIGH |
| EXPECTED_TESTS | +5-8 (716 → 721-724) |
| SUCCESS_CRITERIA | Retry succeeds, exhaustion logged, no duplicates |

## Recommendation

**MISSION 1** (ConversationService) is recommended because:
- Highest priority score (72/100)
- Largest untested data path
- Architectural violation blocks testability
- DRY violation increases bug surface
- High leverage once completed
- Low risk, bounded scope

**MISSION 4** (Recovery) is NOT recommended as Gate 18 because:
- Event loss scoped to DB outage (rare)
- Observability already covers the gap (Gate 17)
- Security decisions correct in-memory
- Lower blast radius than ConversationService
