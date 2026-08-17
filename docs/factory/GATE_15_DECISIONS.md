# GATE 15 — OWNER DECISIONS

> Date: 2026-08-17
> Mode: DISCOVERY_ONLY

## Owner Decisions Required

### OD18: Approve Streaming as Gate 15 Mission

| Attribute | Value |
|-----------|-------|
| OD-ID | OD18 |
| Question | Approve Streaming Response Delivery as the Gate 15 implementation mission? |
| Recommendation | Yes |
| Alternatives | Memory Persistence (C2), Cross-Provider Failover (C3), Conversation Persistence (C4), SecurityGuardian Mandatory Wiring (C5) |
| Risk of Delay | Streaming is the only NOT_READY capability with direct UX impact. Delay means continued synchronous-only responses. |
| Impact on Gate 15 | Required to proceed with implementation. |

**Context:** Streaming was selected as the recommended mission based on:
- Highest business value (real-time UX)
- Lowest risk (no DB changes, confined to API layer)
- Highest architectural leverage (enables chat UI)
- Only NOT_READY capability with direct user-facing impact

### OD19: Git Initialization (Carried from Gate 5)

| Attribute | Value |
|-----------|-------|
| OD-ID | OD19 |
| Question | Initialize git repository in the chef-factory directory? |
| Recommendation | Deferred (not blocking Gate 15) |
| Alternatives | Initialize now, continue deferring |
| Risk of Delay | No code versioning. Risk increases as codebase grows. |
| Impact on Gate 15 | None — purely operational |

**Context:** Git binary is not installed on this machine. Would need to be installed first. Non-blocking for any Gate work.

## Technical Decisions (No Owner Approval Required)

### TD-1: Streaming Protocol

| Decision | SSE (Server-Sent Events) over WebSocket |
|----------|----------------------------------------|
| Rationale | Simpler implementation, HTTP-native, no new dependency, sufficient for unidirectional streaming |
| Alternatives considered | WebSocket (overkill for server-to-client streaming), HTTP chunked transfer (less standard for LLM streaming) |

### TD-2: Streaming Endpoint Strategy

| Decision | Add streaming support to existing `/api/chat` endpoint via `stream: true` parameter |
|----------|-----------------------------------------------------------------------------------|
| Rationale | Backward compatible, single authentication path, no endpoint proliferation |
| Alternatives considered | New `/api/chat/stream` endpoint (more complex routing) |

### TD-3: Token Yield Mechanism

| Decision | AsyncGenerator pattern in pipeline/execution layer |
|----------|---------------------------------------------------|
| Rationale | TypeScript native, composable, testable, fits existing async architecture |
| Alternatives considered | EventEmitter (less type-safe), callback (less modern) |

## Decisions NOT Required

The following decisions were evaluated and determined to not require owner input:

| Decision | Reason |
|----------|--------|
| Streaming security controls | All existing controls (Guardian, rate limiting, auth) apply automatically to the new endpoint |
| Database changes | None required for streaming |
| Migration changes | None required for streaming |
| Test framework | Continue using vitest (existing framework) |
| API versioning | No versioning needed — backward compatible addition |
