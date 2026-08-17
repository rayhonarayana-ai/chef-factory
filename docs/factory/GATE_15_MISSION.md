# GATE 15 — MISSION OPTIONS & RECOMMENDATION

> Date: 2026-08-17
> Mode: DISCOVERY_ONLY

## 1. Candidate Missions

### C1: Streaming Response Delivery

**Description:** Add Server-Sent Events (SSE) streaming to the `/api/chat` endpoint, enabling real-time token-by-token response delivery.

| Dimension | Assessment |
|-----------|-----------|
| Business value | HIGH — Real-time chat UX is the primary user-facing bottleneck. Without streaming, users see nothing until the full response is generated. |
| Security value | NONE — No security control added or removed. |
| Reliability value | NONE — Does not improve fault tolerance. |
| Architectural leverage | HIGH — Enables chat UI, reduces perceived latency, unlocks frontend integration. |
| Current evidence | NOT_READY classification in capability audit. No SSE endpoint exists. All responses are synchronous JSON. |
| Severity of gap | MEDIUM — Functional but poor UX. Not a security or data integrity issue. |
| Scope | MEDIUM — Modify server.ts (add SSE endpoint), modify pipeline.ts or execution.ts (yield tokens), add streaming types. |
| Expected files | server.ts (modified), pipeline.ts or execution.ts (modified), new streaming types file, new test file |
| DB impact | NONE |
| API impact | New endpoint or modified existing endpoint (backward compatible) |
| Test impact | ~15-20 new tests (unit + integration) |
| Live-evidence difficulty | LOW — Can verify with real OpenAI streaming call |
| Regression risk | LOW — Additive change, existing synchronous path preserved |
| Dependencies | None |

### C2: Memory Persistence (Vector Backend)

**Description:** Implement a vector embedding backend for the memory system, enabling semantic lesson recall and long-term executive learning.

| Dimension | Assessment |
|-----------|-----------|
| Business value | HIGH — Executive learning from past decisions is a core differentiator. |
| Security value | NONE |
| Reliability value | NONE |
| Architectural leverage | HIGH — Unlocks the entire memory subsystem (currently deferred). |
| Current evidence | DEFERRED classification. MemoryGateway scaffolded but `configured: false`. `recall()` returns `[]`. `saveLesson()` exists in Store but never called. |
| Severity of gap | MEDIUM — Known deferred capability. Not blocking current workflows. |
| Scope | HIGH — Requires vector DB choice (pgvector extension, external service), embedding model integration, recall algorithm, update to memoryGateway.ts, migration. |
| Expected files | memoryGateway.ts (major rewrite), new embedding adapter, new migration, updated Store interface, new tests |
| DB impact | YES — New migration (pgvector extension or new table) |
| API impact | None (internal) |
| Test impact | ~20-30 new tests |
| Live-evidence difficulty | MEDIUM — Requires pgvector or embedding API |
| Regression risk | MEDIUM — Touches Store interface, gateway layer |
| Dependencies | None but higher complexity |

### C3: Cross-Provider Failover

**Description:** Enable automatic failover from one LLM provider to another when the primary provider's circuit breaker opens.

| Dimension | Assessment |
|-----------|-----------|
| Business value | LOW — Multiple providers rarely fail simultaneously. |
| Security value | NONE |
| Reliability value | HIGH — Prevents single-provider dependency. |
| Architectural leverage | MEDIUM — Extends resilience layer. |
| Current evidence | PARTIAL classification. Each provider has independent circuit breaker. ModelGateway selects provider but doesn't retry across providers. |
| Severity of gap | LOW — Known limitation. Individual provider resilience already strong. |
| Scope | MEDIUM — Modify ModelGateway to implement provider rotation on circuit-open. |
| Expected files | modelGateway.ts (modified), resilience.ts (modified), new tests |
| DB impact | NONE |
| API impact | None |
| Test impact | ~10-15 new tests |
| Live-evidence difficulty | MEDIUM — Requires multi-provider setup |
| Regression risk | MEDIUM — Changes provider selection logic |
| Dependencies | None |

### C4: Conversation Persistence

**Description:** Persist full conversation context across sessions, enabling conversation resume and long-running executive dialogues.

| Dimension | Assessment |
|-----------|-----------|
| Business value | MEDIUM — Users can resume conversations. |
| Security value | NONE |
| Reliability value | MEDIUM — Prevents context loss on session end. |
| Architectural leverage | MEDIUM — Extends conversation service. |
| Current evidence | ConversationService exists with append-only messages. Owner-scoped. But no cross-session resume mechanism. |
| Severity of gap | MEDIUM — Functional within session, lost between sessions. |
| Scope | MEDIUM — Add session resume endpoint, update conversation loading, add conversation list/detail APIs. |
| Expected files | conversation.ts (modified), new API endpoints, new tests |
| DB impact | NONE (conversations table exists) |
| API impact | New endpoints for conversation resume |
| Test impact | ~10-15 new tests |
| Live-evidence difficulty | LOW — Can test with existing DB |
| Regression risk | LOW — Additive changes |
| Dependencies | None |

### C5: SecurityGuardian Mandatory Wiring

**Description:** Remove the optional Guardian parameter from ToolBroker and ExecutionRunner, making security evaluation mandatory on all execution paths.

| Dimension | Assessment |
|-----------|-----------|
| Business value | NONE |
| Security value | HIGH — Eliminates any path that could skip Guardian. |
| Reliability value | NONE |
| Architectural leverage | LOW — Small code change. |
| Current evidence | Guardian is optional in `createSecurityGuardian(store, rateLimiter?, anomalyDetector?)`. When not provided, defaults are used. |
| Severity of gap | LOW — Guardian is always instantiated in production (server.ts:197). The optionality is a code-level concern, not a production gap. |
| Scope | LOW — Remove optional params, enforce Guardian in all constructors. |
| Expected files | security.ts, toolBroker.ts, execution.ts, updated tests |
| DB impact | NONE |
| API impact | None |
| Test impact | ~5-8 test updates |
| Live-evidence difficulty | LOW |
| Regression risk | LOW — Enforces what already happens |
| Dependencies | None |

## 2. Comparative Ranking

| Rank | Candidate | Business | Security | Reliability | Leverage | Scope | DB | Risk | TOTAL |
|------|-----------|----------|----------|-------------|----------|-------|----|------|-------|
| **1** | **C1: Streaming** | HIGH | 0 | 0 | HIGH | MED | 0 | LOW | **STRONGEST** |
| 2 | C2: Memory | HIGH | 0 | 0 | HIGH | HIGH | YES | MED | Strong but complex |
| 3 | C4: Conversation | MED | 0 | MED | MED | MED | 0 | LOW | Moderate |
| 4 | C3: Failover | LOW | 0 | HIGH | MED | MED | 0 | MED | Moderate |
| 5 | C5: Guardian | 0 | HIGH | 0 | LOW | LOW | 0 | LOW | Narrow value |

## 3. Recommended Mission

### **C1: Streaming Response Delivery**

**Rationale:**

1. **Only NOT_READY capability with direct UX impact.** Memory, failover, and conversation are DEFERRED/PARTIAL by design. Streaming is the single missing capability that degrades the user-facing experience.

2. **Lowest risk, highest return.** Confined to API layer. No DB changes. Additive change preserving existing synchronous path. Low regression risk.

3. **Architectural leverage.** Enables chat UI integration, reduces perceived latency, and follows the same boundary-hardening pattern as Gates 7 and 13.

4. **Proven pattern.** SSE streaming is well-understood, supported by all major HTTP clients, and doesn't require WebSocket complexity.

5. **No dependencies.** Can be implemented independently of other deferred capabilities.

### Implementation Scope

- **Modified files:** `server.ts` (new SSE endpoint or modified chat endpoint), `pipeline.ts` or `execution.ts` (token yield/generator pattern)
- **New files:** Streaming types, streaming test file
- **No DB changes, no migration, no API contract breaking changes**
- **Expected test addition:** ~15-20 tests (624 → ~640-644)

## 4. Deferred Candidates

| Candidate | Reason Deferred | Target Gate |
|-----------|----------------|-------------|
| C2: Memory | Higher complexity, requires DB extension choice | Gate 16+ |
| C4: Conversation | Lower priority than streaming UX | Gate 16+ |
| C3: Failover | Individual provider resilience already strong | Gate 17+ |
| C5: Guardian | Production gap doesn't exist (always wired) | Optional cleanup |
