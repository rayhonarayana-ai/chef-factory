# Gate 4 Evidence Contract

**READ-ONLY document.**

---

## 1. Purpose

Define the EXACT evidence required before Gate 4 can be classified as PASS.

---

## 2. Evidence Contract

| # | Capability | Evidence Required | Classification |
|---|-----------|-------------------|---------------|
| E1 | Conversation history loaded into LLM | Unit test: loadHistory called, messages in context; Live test: multi-turn references prior turn | UNVERIFIED |
| E2 | ToolBroker securityGuard wired | Unit test: securityGuard called per tool call, returns allowed/denied | UNVERIFIED |
| E3 | Authority resolved per tool call | Unit test: broker.call() receives resolved decision, not 'auto' | UNVERIFIED |
| E4 | Tool result sanitization | Unit test: tool results sanitized before conversation storage | UNVERIFIED |
| E5 | Regression (222+ tests) | vitest run: all pass | UNVERIFIED |
| E6 | Typecheck | tsc --noEmit: 0 errors | UNVERIFIED |
| E7 | Build | npm run build: BUILD_EXIT=0 | UNVERIFIED |
| E8 | Live tool calling (OpenAI) | Real LLM tool call → ToolBroker → tool → DB → result → model | UNVERIFIED |
| E9 | Live conversation continuity | Real multi-turn: turn 1 creates project, turn 2 references it | UNVERIFIED |
| E10 | Live securityGuard enforcement | Real tool call that would be denied by Guardian → denied | UNVERIFIED |
| E11 | Zero credential exposure | Secret scan: 0 hits | UNVERIFIED |
| E12 | Zero test residue | DB query: test data = 0 | UNVERIFIED |
| E13 | Anomaly counters wired | Unit test: anomaly signals generate security events | UNVERIFIED |
| E14 | Failure rate limits wired | Unit test: failure counts trigger rate limits | UNVERIFIED |

---

## 3. Classification Rules

- **LIVE_VERIFIED:** Real execution evidence exists
- **TESTED:** Unit/integration test passes
- **VERIFIED:** Source inspection confirms
- **UNVERIFIED:** Evidence does not yet exist
- **BLOCKED:** Cannot be verified due to dependency
- **DEFERRED:** Not required for Gate 4

---

## 4. Gate 4 Cannot Be Considered PASS Until:

- [ ] E1: Conversation history loaded (TESTED + LIVE_VERIFIED)
- [ ] E2: ToolBroker securityGuard wired (TESTED)
- [ ] E3: Authority resolved per tool call (TESTED)
- [ ] E4: Tool result sanitization (TESTED)
- [ ] E5: 222+ tests pass (TESTED)
- [ ] E6: Typecheck pass (TESTED)
- [ ] E7: Build pass (TESTED)
- [ ] E8: OpenAI tool calling live (LIVE_VERIFIED)
- [ ] E9: Conversation continuity live (LIVE_VERIFIED)
- [ ] E10: SecurityGuard enforcement live (LIVE_VERIFIED or TESTED)
- [ ] E11: No credentials (VERIFIED)
- [ ] E12: Zero residue (VERIFIED)
- [ ] E13: Anomaly counters (DEFERRED or TESTED)
- [ ] E14: Failure rate limits (DEFERRED or TESTED)

---

## 5. Failure Criteria

A single mandatory BLOCKED/UNVERIFIED capability prevents PASS, EXCEPT:
- E13 and E14 are DEFERRED (can be PASS with DEFERRED classification)
- All other capabilities must be TESTED or better

---

## 6. Mandatory Live Evidence

At minimum:
- One real OpenAI tool call via the FULL pipeline (not test script)
- One real multi-turn conversation via the FULL pipeline
- One real securityGuard denial via the FULL pipeline

Direct tool handler invocation is NOT sufficient.
Mocked provider is NOT sufficient.
Test script bypassing pipeline is NOT sufficient.
