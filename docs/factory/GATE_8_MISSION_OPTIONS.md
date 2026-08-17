# Gate 8 — Mission Options

> Date: 2026-08-17
> Source: GATE_8_DISCOVERY_REPORT.md + GATE_8_FORENSIC_REVIEW.md
> Requirement: At least 3 candidate missions from forensic findings

---

## Candidate 1: Multi-Step Task Orchestration

### MISSION NAME
Multi-Step Task Orchestration (Planner + Sequencer + Progress Tracker)

### BUSINESS VALUE
This is the highest-value capability gap. Currently, creating a project with 5 tasks requires 7 separate owner commands. With multi-step orchestration, one command like "Create a project for the mobile app, add5 tasks for the team, set priorities" would execute as a coordinated sequence.

The owner spends less time orchestrating CHEF and more time making decisions. CHEF transitions from a single-command executor to an executive assistant that plans and executes multi-step workflows.

### ARCHITECTURAL PROBLEM
The pipeline (`pipeline.ts:374-387`) creates exactly ONE task per command and executes it immediately. There is no:
- Task dependency model (`TaskRecord.parent_task_id` exists but is never populated)
- Sequence/chain model
- Planner module
- Progress tracking across steps
- Conditional branching
- Failure recovery mid-sequence

### CURRENT EVIDENCE
- `pipeline.ts:374-387` — single task creation path
- `taskEngine.ts` — state machine supports lifecycle but no sequencing
- `types.ts:TaskRecord.parent_task_id` — field exists but unused
- `intent.ts:20-22` — `plan` is a recognized verb but has no handler
- `execution.ts:426-472` — `runInformational` has no case for planning

### PROPOSED SCOPE
1. Add `sequence_id` and `step_index` fields to `TaskRecord` (via new columns OR separate `task_sequences` table)
2. Create a `PlannerModule` that:
   - Accepts a multi-step intent (parsed from natural language)
   - Decomposes it into ordered steps
   - Creates tasks in sequence
   - Tracks progress (pending/running/completed/failed per step)
3. Extend `CommandPipeline.run()` to detect multi-step intents and delegate to the planner
4. Add progress reporting (GET /api/sequences/:id)
5. Add failure handling: if step N fails, optionally skip or retry

### OUT OF SCOPE
- Cross-project workflows
- Scheduled/deferred execution
- Parallel task execution
- Dynamic re-planning mid-sequence

### FILES EXPECTED TO CHANGE
- `src/core/types.ts` — add sequence types
- `src/core/ports.ts` — add sequence Store methods
- `src/core/pipeline.ts` — detect multi-step intents, delegate to planner
- `src/core/planner.ts` — NEW: planning + sequencing module
- `src/db/repo.ts` — implement sequence Store methods
- `src/api/handlers.ts` — add sequence endpoints
- `src/api/server.ts` — register sequence routes
- `src/tools/query-catalog.ts` — add sequence entity

### DATABASE IMPACT
Option A (preferred): Add `task_sequences` table + columns on `tasks` (sequence_id, step_index, step_status)
Option B: Use existing `parent_task_id` field + JSONB metadata

### API IMPACT
- New endpoint: `GET /api/sequences/:id` (progress tracking)
- Extended: `POST /api/chat` detects multi-step intents

### SECURITY IMPACT
Low — sequences inherit the same owner/project/authority model. Each step goes through the full security chain.

### COST IMPACT
Each step in a sequence incurs model cost. A 5-step sequence costs ~5x a single command. Cost protection limits apply per-step.

### TEST IMPACT
- New unit tests: planner module (15-20 tests)
- New integration tests: sequence lifecycle (5-10 tests)
- Regression: all 370 existing tests must pass

### LIVE VERIFICATION REQUIREMENTS
- Create a multi-step sequence against live Supabase
- Verify each step creates a real task
- Verify progress tracking updates correctly
- Verify failure handling works
- Verify zero test data residue after rollback

### RISKS
1. Scope creep — multi-step can expand to "full workflow engine"
2. Cost amplification — sequences cost more than single commands
3. Error accumulation — failure in step 3 leaves steps 1-2 completed but step 3+ pending

### DEPENDENCIES
None — purely additive, no changes to existing security or authority layers.

### ROLLBACK STRATEGY
Sequence table is additive; removal restores single-command mode. No existing behavior changed.

### EVIDENCE REQUIREMENTS
- Unit tests for planner module
- Integration tests for sequence lifecycle
- Live test against real Supabase
- Cost impact analysis (5-step sequence cost)
- Regression: 370/370 existing tests pass

### ESTIMATED COMPLEXITY
MEDIUM — 3-5 files new/modified, ~400-600 lines, 20-30 new tests

### WHY THIS SHOULD BE GATE 8
This is the single highest-value bottleneck. Without multi-step orchestration, CHEF cannot function as an Executive AI — it can only execute single commands. The entire security, authority, cost, and audit infrastructure is designed for autonomous execution, but the execution surface is limited to atomic commands. Solving this unlocks the core value proposition of the factory.

---

## Candidate 2: Provider Resilience Layer

### MISSION NAME
Provider Resilience (Retry + Timeout + Failover + Circuit Breaker)

### BUSINESS VALUE
Currently, a single API failure (network timeout, provider outage, rate limit) causes the entire command to fail. With resilience, CHEF would automatically retry, timeout, and failover to alternative providers. This makes the system production-reliable.

### ARCHITECTURAL PROBLEM
All 3 LLM adapters (`openai.ts`, `anthropic.ts`, `google.ts`) make a single `fetch()` call with no retry, no timeout, and no fallback. The `ModelGateway` selects the cheapest provider but does not implement failover.

### CURRENT EVIDENCE
- `openai.ts:36-46` — single fetch, throws on error
- `anthropic.ts:36-52` — single fetch, throws on error
- `google.ts:38-55` — single fetch, throws on error
- No `AbortController` in any adapter
- `execution.ts:203-225` — single model selection, no retry

### PROPOSED SCOPE
1. Add retry with exponential backoff (3 attempts, 1s/2s/4s)
2. Add timeout via `AbortController` (30s default)
3. Add provider failover: try OpenAI → Anthropic → Google
4. Add circuit breaker: after 3 consecutive failures, skip provider for 5 minutes
5. Wire into `execution.ts` model selection loop

### OUT OF SCOPE
- Streaming
- Provider-specific optimizations
- Custom retry policies per owner

### FILES EXPECTED TO CHANGE
- `src/gateways/adapters/openai.ts` — add retry + timeout
- `src/gateways/adapters/anthropic.ts` — add retry + timeout
- `src/gateways/adapters/google.ts` — add retry + timeout
- `src/gateways/modelGateway.ts` — add failover logic
- `src/api/execution.ts` — wire failover into model selection

### DATABASE IMPACT
None

### API IMPACT
None — behavior change only

### SECURITY IMPACT
Low — retry uses same credentials; no new attack surface

### COST IMPACT
Retries may double/triple cost on failure. Circuit breaker reduces wasted retries.

### TEST IMPACT
- New unit tests: retry logic, timeout, failover, circuit breaker (10-15 tests)
- Regression: 370/370 existing tests pass

### LIVE VERIFICATION REQUIREMENTS
- Mock provider failure, verify retry
- Mock provider timeout, verify AbortController
- Mock primary provider down, verify failover to secondary
- Verify circuit breaker opens after threshold

### RISKS
1. Retry amplification — retries during provider outage increase load
2. Timeout too short — complex model calls may legitimately take >30s
3. Failover ordering — cheapest-first failover may hit expensive providers

### DEPENDENCIES
None — adapter-level only.

### ROLLBACK STRATEGY
Circuit breaker can be disabled via config. Retry defaults can be set to 1 (effectively disabled).

### EVIDENCE REQUIREMENTS
- Unit tests for retry/timeout/failover/circuit breaker
- Live test with mocked provider failures
- Regression: 370/370

### ESTIMATED COMPLEXITY
MEDIUM — 5 files modified, ~200-300 lines, 10-15 new tests

### WHY THIS SHOULD BE GATE 8 (OR NOT)
Provider resilience is important for production reliability but does not unlock new Executive AI capability. The owner can already issue commands; they just fail sometimes. Multi-step orchestration (Candidate 1) unlocks a fundamentally new capability. Provider resilience should be Gate 9 or included as a secondary scope in Gate 8.

---

## Candidate 3: Conversation Context Management

### MISSION NAME
Conversation Summarization + Context Window Management

### BUSINESS VALUE
Long conversations lose critical early context due to the 20-message hard limit. With summarization, CHEF would compress old messages into summaries, preserving key decisions and context across extended interactions. This makes CHEF genuinely useful for ongoing projects.

### ARCHITECTURAL PROBLEM
`conversation.ts:47` sets `MAX_HISTORY = 20`. `loadHistory()` fetches ALL messages then slices to the last 20. Messages beyond this limit are silently dropped. No summarization, no compression, no context management.

### CURRENT EVIDENCE
- `conversation.ts:47` — `MAX_HISTORY = 20`
- `conversation.ts:158-181` — fetch all, slice to last 20
- `execution.ts:478` — injects history into model prompt
- No summarization module exists anywhere

### PROPOSED SCOPE
1. Create a `ContextManager` that:
   - Loads full conversation history
   - When history exceeds threshold (e.g., 15 messages), summarizes older messages via LLM call
   - Stores summaries as special `system` role messages
   - Returns compressed context within token budget
2. Add summary persistence to `conversation_messages` table
3. Wire into `POST /api/chat` handler

### OUT OF SCOPE
- Vector embeddings for semantic search
- Cross-conversation memory
- Real-time streaming summaries

### FILES EXPECTED TO CHANGE
- `src/core/contextManager.ts` — NEW: summarization + compression
- `src/core/conversation.ts` — add summary methods
- `src/api/handlers.ts` — wire context manager into chat handler
- `src/db/repo.ts` — add summary persistence methods

### DATABASE IMPACT
Add `is_summary` boolean column to `conversation_messages` OR use a separate `conversation_summaries` table

### API IMPACT
None — behavior change only

### SECURITY IMPACT
Low — summaries stored in same conversation scope; same RLS policies apply

### COST IMPACT
Each summarization costs one LLM call (~$0.001-0.01 per summary). Amortized across many messages, this is cost-effective.

### TEST IMPACT
- New unit tests: context manager (8-12 tests)
- Regression: 370/370

### LIVE VERIFICATION REQUIREMENTS
- Create a conversation with 25+ messages
- Verify summarization triggers
- Verify model receives summarized context
- Verify key decisions are preserved in summaries

### RISKS
1. Summarization quality — poor summaries lose critical context
2. Cost — each summary is an LLM call
3. Latency — summarization adds delay to chat responses

### DEPENDENCIES
None — purely additive.

### ROLLBACK STRATEGY
Disable summarization via config; fall back to current 20-message slice.

### EVIDENCE REQUIREMENTS
- Unit tests for context manager
- Live test with 25+ messages
- Regression: 370/370

### ESTIMATED COMPLEXITY
MEDIUM — 4 files new/modified, ~300-400 lines, 8-12 new tests

### WHY THIS SHOULD BE GATE 8 (OR NOT)
Context management is important for long conversations but does not solve the primary bottleneck. CHEF can have a 20-message conversation today; the problem is that it can only do ONE thing per command. Multi-step orchestration (Candidate 1) is more fundamental. Context management should be Gate 9 or 10.

---

## Candidate 4: Streaming Response Delivery

### MISSION NAME
Server-Sent Events (SSE) Streaming for Chat Responses

### BUSINESS VALUE
Currently, the owner waits for the entire response to be generated before seeing any output. With SSE streaming, responses appear progressively, improving perceived performance and user experience.

### ARCHITECTURAL PROBLEM
All adapters buffer the complete response. `server.ts` returns JSON after the full response is ready. No SSE or chunked transfer encoding exists.

### CURRENT EVIDENCE
- All adapters: single `fetch()` returning complete JSON
- `server.ts` — `send(res, status, body)` writes full response at once
- No SSE endpoints exist

### PROPOSED SCOPE
1. Add SSE support to `POST /api/chat`
2. Stream model tokens as they arrive
3. Stream tool execution progress
4. Client-side: progressive rendering

### OUT OF SCOPE
- Streaming for non-chat endpoints
- WebSocket support
- Bidirectional streaming

### FILES EXPECTED TO CHANGE
- `src/gateways/adapters/openai.ts` — add streaming mode
- `src/gateways/adapters/anthropic.ts` — add streaming mode
- `src/gateways/adapters/google.ts` — add streaming mode
- `src/api/server.ts` — add SSE endpoint
- `src/api/handlers.ts` — wire streaming into chat handler
- `public/app.js` — client-side progressive rendering

### DATABASE IMPACT
None

### API IMPACT
New endpoint: `POST /api/chat/stream` (SSE)

### SECURITY IMPACT
Low — same auth; SSE is unidirectional

### COST IMPACT
None — same model calls, just streamed

### TEST IMPACT
- New unit tests: SSE formatting (5-8 tests)
- Regression: 370/370

### LIVE VERIFICATION REQUIREMENTS
- Verify SSE stream delivers tokens progressively
- Verify tool calls appear in stream
- Verify stream terminates correctly on completion/error

### RISKS
1. SSE complexity — requires client-side handling
2. Adapter streaming support — not all adapters may support it
3. Timeout — long streams may hit proxy timeouts

### DEPENDENCIES
None — additive.

### ROLLBACK STRATEGY
SSE endpoint is additive; non-streaming endpoint remains.

### ESTIMATED COMPLEXITY
HIGH — 6+ files modified, ~400-600 lines, requires client changes

### WHY THIS SHOULD BE GATE 8 (OR NOT)
Streaming improves UX but does not unlock new capability. CHEF can already respond to commands; the response just takes a moment. Multi-step orchestration (Candidate 1) is more fundamental. Streaming should be Gate 10+.

---

## Comparison Matrix

| Criterion | Candidate 1: Orchestration | Candidate 2: Resilience | Candidate 3: Context | Candidate 4: Streaming |
|-----------|---------------------------|------------------------|---------------------|----------------------|
| **Unlocks new capability** | YES — multi-step workflows | NO — same capability, more reliable | NO — same capability, longer memory | NO — same capability, faster display |
| **Solves primary bottleneck** | YES | NO | NO | NO |
| **Owner value impact** | TRANSFORMATIVE | INCREMENTAL | INCREMENTAL | INCREMENTAL |
| **Complexity** | MEDIUM | MEDIUM | MEDIUM | HIGH |
| **Risk** | MEDIUM | LOW | LOW | MEDIUM |
| **Gate 7 compatible** | YES | YES | YES | YES |
| **Recommended for Gate 8** | **YES** | No (Gate 9) | No (Gate 9) | No (Gate 10+) |
