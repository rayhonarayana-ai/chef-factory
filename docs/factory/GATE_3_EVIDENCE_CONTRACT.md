# Gate 3 Evidence Contract

**READ-ONLY document. No source code.**

---

## 1. Purpose

This document defines the EXACT evidence that must exist before any Gate 3 capability is considered VERIFIED. No claims without evidence.

---

## 2. Evidence Contract

| # | Capability | Evidence Required | Classification |
|---|-----------|-------------------|---------------|
| E1 | Tool calling (OpenAI) | Live HTTP test: tool call via OpenAI adapter returns tool_calls | LIVE_VERIFIED (2026-08-17) |
| E2 | Tool calling (Anthropic) | Live HTTP test: tool call via Anthropic adapter returns tool_use | BLOCKED (no key) |
| E3 | Tool calling (Google) | Live HTTP test: tool call via Google adapter returns functionCall | BLOCKED (no key) |
| E4 | ToolBroker wiring | Unit test: tool call goes through authority + risk + Guardian | TESTED |
| E5 | create_project tool | Unit test: tool creates project in DB; Live test: chat creates project | LIVE_VERIFIED |
| E6 | list_projects tool | Unit test: tool returns owner's projects | TESTED |
| E7 | list_tasks tool | Unit test: tool returns project's tasks | TESTED |
| E8 | create_task tool | Unit test: tool creates task in DB | TESTED |
| E9 | update_task tool | Unit test: tool updates task in DB | TESTED |
| E10 | Conversation context | Unit test: messages stored and loaded; Live test: multi-turn works | LIVE_VERIFIED |
| E11 | Conversation persistence | SQL test: RLS on conversations and messages | TESTED |
| E12 | Vocabulary alignment | Unit test: classifyCriticalAction matches pipeline actionTypes | TESTED |
| E13 | Tool loop prevention | Unit test: loop stops at max rounds | TESTED |
| E14 | Cost tracking | Unit test: cost recorded per tool-calling command | TESTED |
| E15 | Rate limiting | Unit test: rate limit enforced on tool calls | TESTED |
| E16 | Regression | All 181 Gate 2 tests pass; 0 regressions | TESTED |
| E17 | Typecheck | tsc --noEmit returns 0 errors | TESTED |
| E18 | Build | npm run build returns BUILD_EXIT=0 | TESTED |
| E19 | Live HTTP | 12/12 tests pass (9 original + 3 new) | LIVE_VERIFIED |
| E20 | Zero residue | After live tests: users=0, owners=0, events=0 | LIVE_VERIFIED |
| E21 | No credential exposure | Secret scan: 0 hits in documentation | VERIFIED |
| E22 | Factory isolation | No cross-project references in new code | VERIFIED |

---

## 3. Classification Rules

- **LIVE_VERIFIED**: Real execution evidence exists (live HTTP test output, DB query results)
- **TESTED**: Unit/integration test passes (vitest output)
- **VERIFIED**: Source inspection confirms (read-only verification)
- **UNVERIFIED**: Evidence does not yet exist
- **BLOCKED**: Cannot be verified due to dependency

---

## 4. Gate 3 Cannot Be Considered PASS Until:

- [x] E1: Tool calling (OpenAI) — LIVE_VERIFIED (2026-08-17)
- [ ] E2-E3: Tool calling (Anthropic/Google) — BLOCKED (no keys)
- [x] E4: ToolBroker wiring verified (TESTED)
- [x] E5-E9: All 5 tools work (TESTED)
- [x] E10: Conversation context works (LIVE_VERIFIED)
- [x] E11: Conversation RLS verified (TESTED)
- [x] E12: Vocabulary alignment verified (TESTED)
- [x] E13: Tool loop prevention verified (TESTED)
- [x] E14-E15: Cost and rate limits verified (TESTED)
- [x] E16: Zero regressions (222/222 PASS)
- [x] E17-E18: Typecheck and build pass (TESTED)
- [x] E19: 12/12 live HTTP tests pass (LIVE_VERIFIED)
- [x] E20: Zero residue (LIVE_VERIFIED)
- [x] E21-E22: No credentials, no contamination (VERIFIED)

---

## 5. Evidence Files

| Evidence | File | Status |
|----------|------|--------|
| Unit tests | vitest output | PASS (222/222) |
| SQL tests | psql output | PASS (17/17) |
| Live HTTP | live-verify output | LIVE_VERIFIED (OpenAI) |
| Typecheck | tsc output | PASS |
| Build | npm run build output | PASS |
| Residue | pg query output | ZERO |

---

## 6. Forensic Evidence Chain

All evidence must be:
- Timestamped
- Stored in docs/factory/ (GATE_3_EVIDENCE.md)
- Never deleted
- Linked to specific test IDs (E1-E22)
