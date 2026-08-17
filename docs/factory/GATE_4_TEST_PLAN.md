# Gate 4 Test Plan

> **READ-ONLY document.**

---

## 1. Test Strategy

Gate 4 focuses on fixing three drift gaps. Testing must prove the fixes work without breaking existing functionality.

---

## 2. New Tests Required

### Conversation History Loading (E1)

| Test | What It Verifies | Expected |
|------|------------------|----------|
| history loading | loadHistory called when conversation_id provided | Messages loaded from DB |
| history windowing | Last N messages returned (N=20 default) | Correct window |
| history ordering | Messages in chronological order | ASC by created_at |
| history empty | No history for new conversation | Empty array |
| history owner scoping | Only owner's messages loaded | RLS enforced |
| live multi-turn | Turn 2 references Turn 1 context | Model has context |

**Minimum:** 5 unit + 1 live = 6

### ToolBroker SecurityGuard Wiring (E2)

| Test | What It Verifies | Expected |
|------|------------------|----------|
| securityGuard called | Guardian function invoked per tool call | Called with request |
| securityGuard allow | Guardian returns allowed → tool executes | Tool runs |
| securityGuard deny | Guardian returns denied → tool blocked | Tool denied |
| securityGuard critical action | Critical action → require_approval | Approval required |

**Minimum:** 4

### Authority Resolution (E3)

| Test | What It Verifies | Expected |
|------|------------------|----------|
| authority auto | Owner with auto authority → tool executes | Tool runs |
| authority deny | Owner with deny authority → tool blocked | Tool denied |
| authority require_approval | Owner with require_approval → approval required | Approval required |

**Minimum:** 3

### Tool Result Sanitization (E4)

| Test | What It Verifies | Expected |
|------|------------------|----------|
| secret redaction | Tool result secrets redacted before storage | No secrets in stored message |
| normal result | Normal tool result stored correctly | Full result preserved |

**Minimum:** 2

---

## 3. Regression Tests

All 222 existing tests must pass. No modifications to existing test files unless the fix changes behavior that existing tests depend on.

**If existing tests break:**
1. Classify: is the breakage a regression or a correct behavior change?
2. If regression: fix the implementation
3. If correct behavior change: update the test with full documentation

---

## 4. Live Tests

| Test | What It Verifies | Evidence |
|------|------------------|----------|
| OpenAI tool calling | Full pipeline tool execution | E8 |
| Multi-turn conversation | History loaded, context preserved | E9 |
| SecurityGuard enforcement | Guardian blocks unauthorized tool call | E10 |

**Minimum:** 3 live tests

---

## 5. SQL/RLS Tests

No new SQL/RLS tests needed. Gate 3 RLS is verified and unchanged.

---

## 6. Total Test Count Target

| Suite | Gate 3 | Gate 4 Target |
|-------|--------|---------------|
| Unit | 222 | 236+ (14 new) |
| SQL/RLS | 17 | 17 (unchanged) |
| Live | — | 3+ |
| Total | 222 | 256+ |
