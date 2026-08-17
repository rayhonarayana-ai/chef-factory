# Gate 3 Test Plan

> **READ-ONLY document. No test execution.**
> Generated for Gate 3 milestone — Tool Calling, Conversations, and Security Hardening.

---

## 1. Test Strategy

- Unit tests for all new code (vitest)
- Integration tests for tool calling flow
- SQL tests for new RLS policies
- Live HTTP tests for end-to-end verification
- Regression tests for all Gate 1/2 functionality

---

## 2. New Unit Tests

### 2.1 `src/core/toolRegistry.test.ts` (NEW)

Tests for tool registration and lookup:

| Test ID | Name | Description |
|---------|------|-------------|
| T1 | Register a tool → found by name | Register a tool with valid schema, then look it up by name and confirm it is returned. |
| T2 | Lookup unknown tool → null | Look up a tool name that was never registered; result must be `null`. |
| T3 | List all enabled tools | Register multiple tools, then call the list function and confirm all enabled tools are returned. |
| T4 | Disable a tool → not found in enabled list | Register a tool, disable it, then confirm it no longer appears in the enabled tools list. |
| T5 | Tool schema validation (required fields) | Attempt to register a tool missing required fields (`name`, `description`, `parameters`); registration must fail with a validation error. |
| T6 | Tool risk level validation | Register tools with each valid risk level (`low`, `medium`, `high`, `critical`); confirm each is accepted. Attempt to register with an invalid risk level; confirm rejection. |

### 2.2 `src/core/conversation.test.ts` (NEW)

Tests for conversation management:

| Test ID | Name | Description |
|---------|------|-------------|
| T7 | Create conversation → returns id | Create a new conversation for a user; confirm a non-null `id` is returned. |
| T8 | Append message → stored with correct role | Append a message with role `user` and a message with role `assistant` to a conversation; confirm both are stored with the correct `role` field. |
| T9 | Load message history → ordered by created_at | Append several messages at different timestamps; load the history and confirm messages are ordered ascending by `created_at`. |
| T10 | Limit message history (last N) | Append 20 messages to a conversation; load history with `limit=5`; confirm only the 5 most recent messages are returned. |
| T11 | Archive conversation → status='archived' | Create a conversation, archive it, then load it and confirm `status` equals `'archived'`. |
| T12 | Conversation not found → error | Attempt to load a conversation with a non-existent ID; confirm an error is thrown or an appropriate null/error response is returned. |

### 2.3 `src/api/toolExecution.test.ts` (NEW)

Tests for tool execution flow:

| Test ID | Name | Description |
|---------|------|-------------|
| T13 | Execute create_project tool → project created in DB | Execute the `create_project` tool with valid arguments; confirm a new project row exists in the database. |
| T14 | Execute list_projects tool → returns owner's projects | Execute `list_projects` as an authenticated user; confirm only projects owned by that user are returned. |
| T15 | Execute list_tasks tool → returns project's tasks | Execute `list_tasks` with a valid project ID; confirm all tasks belonging to that project are returned. |
| T16 | Execute create_task tool → task created in DB | Execute `create_task` with valid arguments; confirm a new task row exists in the database with correct fields. |
| T17 | Execute update_task tool → task updated in DB | Execute `update_task` on an existing task; confirm the updated fields reflect the new values in the database. |
| T18 | Execute unknown tool → error | Execute a tool name that does not exist in the registry; confirm an error is returned indicating the tool was not found. |
| T19 | Tool call with invalid args → validation error | Execute a valid tool with malformed or missing required arguments; confirm a validation error is returned before any database writes. |
| T20 | Tool call blocked by authority → denied | Execute a tool that requires elevated authority with a user who lacks it; confirm the call is denied and no side effects occur. |

### 2.4 `src/gateways/toolBroker.test.ts` (EXISTING — add tests)

Tests for ToolBroker integration:

| Test ID | Name | Description |
|---------|------|-------------|
| T21 | Tool call passes authority check → allowed | Submit a tool call that the user is authorized for; confirm execution proceeds without error. |
| T22 | Tool call fails authority check → denied | Submit a tool call that exceeds the user's authority level; confirm execution is blocked and a denial event is recorded. |
| T23 | Tool call passes risk check → allowed | Submit a tool call whose risk level is within the allowed threshold; confirm execution proceeds. |
| T24 | Tool call fails risk check → denied | Submit a tool call whose risk level exceeds the configured threshold; confirm execution is blocked. |
| T25 | Tool call passes Guardian check → allowed | Submit a tool call that passes all Guardian policy checks; confirm execution proceeds. |
| T26 | Tool call fails Guardian check → denied | Submit a tool call that violates a Guardian policy; confirm execution is blocked and the policy violation is logged. |
| T27 | Tool call audit event recorded | Execute any tool call; confirm an audit event is written with the correct tool name, user ID, timestamp, and result status. |
| T28 | Tool call cost recorded | Execute a tool call that has an associated cost; confirm the cost is recorded in the billing/usage ledger. |

### 2.5 `src/api/execution.test.ts` (EXISTING — add tests)

Tests for tool-calling execution:

| Test ID | Name | Description |
|---------|------|-------------|
| T29 | LLM returns tool_calls → tools executed | Mock the LLM provider to return a response containing `tool_calls`; confirm the corresponding tools are invoked and their results are collected. |
| T30 | LLM returns text only → stored as output | Mock the LLM provider to return a plain text response with no `tool_calls`; confirm the text is stored as the assistant message output. |
| T31 | Tool results fed back to LLM → final response generated | Mock a multi-turn loop where tool results are returned to the LLM; confirm the LLM produces a final text response after receiving tool results. |
| T32 | Tool loop limit (10 rounds) → stops and returns partial | Mock the LLM to continuously request tool calls; confirm the loop terminates after 10 iterations and returns the partial result collected so far. |
| T33 | Provider without tool support → text-only fallback | Use a mock provider that does not support tool calling; confirm the system falls back to text-only mode without errors. |

### 2.6 `src/core/security/criticalActions.test.ts` (NEW or EXISTING — add tests)

Tests for vocabulary alignment:

| Test ID | Name | Description |
|---------|------|-------------|
| T34 | classifyCriticalAction('project_create', 'production') → match | Classify `project_create` in a `production` environment; confirm it matches as a critical action. |
| T35 | classifyCriticalAction('task_create', 'development') → no match (not critical) | Classify `task_create` in a `development` environment; confirm it does not match as critical. |
| T36 | classifyCriticalAction('financial_transaction', 'all') → deny | Classify `financial_transaction` in any environment; confirm the result is `deny`. |
| T37 | classifyCriticalAction('production_deletion', 'production') → deny | Classify `production_deletion` in a `production` environment; confirm the result is `deny`. |
| T38 | Old protected action types still work | Classify action types that were already protected in Gate 1/2; confirm they still produce the same results as before (no regression). |

---

## 3. New SQL Tests

### 3.1 `supabase/tests/rls_tests.sql` (ADD)

| Test ID | Name | Description |
|---------|------|-------------|
| TEST 8 | CONVERSATION ISOLATION — owner sees only own conversations | Insert conversations for two different users. As user A, query conversations; confirm only user A's conversations are returned. Confirm user B's conversations are invisible. |
| TEST 9 | MESSAGE APPEND-ONLY — no update/delete on messages | Insert a message into a conversation. Attempt to UPDATE the message content; confirm it fails or has no effect. Attempt to DELETE the message; confirm it fails or has no effect. |

### 3.2 `supabase/tests/rls_security_tests.sql` (ADD)

| Test ID | Name | Description |
|---------|------|-------------|
| TEST S8 | TOOL REGISTRY — read-only for authenticated, managed by service_role | As an authenticated user, query the tool registry; confirm rows are returned (read works). Attempt to INSERT/UPDATE/DELETE a tool registry row as authenticated user; confirm all modifications are denied. As service_role, perform the same INSERT/UPDATE/DELETE; confirm all modifications succeed. |

---

## 4. New Live HTTP Tests

### 4.1 `scripts/live-http-verification.ts` (ADD)

| Test ID | Name | Description |
|---------|------|-------------|
| T10 | CHAT_WITH_TOOL — POST /api/chat with "create project test-tool" → project created | Send a POST request to `/api/chat` with a message containing "create project test-tool". Confirm the HTTP response is 200. Confirm a project named `test-tool` now exists in the database. |
| T11 | CONVERSATION_CONTEXT — Two messages in same conversation → context maintained | Send two sequential POST requests to `/api/chat` with the same `conversation_id`. First message: "My name is Alice." Second message: "What is my name?". Confirm the second response references "Alice", proving context was maintained. |
| T12 | TOOL_AUTH_DENIED — Chat command that triggers denied tool → proper error | Send a POST request to `/api/chat` with a message that would trigger a tool the user is not authorized to use. Confirm the response contains a clear authorization-denied error message and no tool side effects occurred. |

---

## 5. Regression Tests

ALL existing 181 tests must pass. No modifications to existing tests except:

- Add vocabulary alignment tests to existing test files
- Add tool-calling tests to existing `execution.test.ts`

Any test failures in the existing suite constitute a Gate 3 blocker.

---

## 6. Test Execution Order

| Step | Command | Expected Outcome |
|------|---------|------------------|
| 1 | `vitest run` | All 181 existing tests pass (regression gate) |
| 2 | `vitest run src/core/toolRegistry.test.ts src/core/conversation.test.ts src/api/toolExecution.test.ts` | New unit tests pass (T1–T20) |
| 3 | `vitest run src/gateways/toolBroker.test.ts src/api/execution.test.ts` | Updated tests pass (T21–T33) |
| 4 | `psql rls_tests.sql` | SQL RLS tests pass (TEST 8, TEST 9) |
| 5 | `psql rls_security_tests.sql` | SQL security tests pass (TEST S8) |
| 6 | `tsc --noEmit` | No type errors |
| 7 | `npm run build` | Build succeeds |
| 8 | `npx tsx scripts/live-http-verification.ts` | Live HTTP tests pass (T10–T12) |

---

## 7. Expected Test Counts

| Category | Gate 2 | Gate 3 | Change |
|----------|--------|--------|--------|
| Unit tests (vitest) | 181 | ~220 | +39 |
| SQL tests | 14 | 17 | +3 |
| Live HTTP tests | 9 | 12 | +3 |
| **Total** | **204** | **~249** | **+45** |

---

## 8. Evidence Requirements

- Every new test must have a descriptive name
- Every test must assert a specific outcome
- No skipped tests (unless conditional on env vars)
- No flaky tests
- All tests must be deterministic
