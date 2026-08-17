# Gate 3 Architectural Decisions

> **READ-ONLY document. No source code.**

## Decision Log

### D1: Gate 3 Scope — "EXECUTION GATE"

- **Decision:** Gate 3 focuses on tool-based execution, conversation context, and 5 essential tools
- **Rationale:** CHEF has enterprise-grade governance with zero execution capability. Gate 3 bridges this gap.
- **Alternatives considered:**
  - Growth Engine first (rejected: business logic before execution capability)
  - Deployment first (rejected: can't deploy what doesn't execute)
  - Full multi-agent (rejected: too complex; owner-only tools first)
- **Status:** DECIDED

### D2: Tool Count — 5 Tools Only

- **Decision:** Gate 3 includes exactly 5 tools: `create_project`, `list_projects`, `list_tasks`, `create_task`, `update_task`
- **Rationale:** Minimal viable set. Owner can create projects and manage tasks via chat. Anything else is premature.
- **Alternatives considered:**
  - 10+ tools (rejected: too much scope, hard to verify)
  - 3 tools (rejected: can't create tasks via chat)
  - 1 tool (rejected: not useful enough)
- **Status:** DECIDED

### D3: Conversation Model — Server-Side History

- **Decision:** Conversation history stored server-side in `conversation_messages` table. Client sends `conversation_id`, not message history.
- **Rationale:** Prevents client-side manipulation of conversation context. RLS enforces owner scoping.
- **Alternatives considered:**
  - Client-side history (rejected: security risk — client can inject fake context)
  - No persistence (rejected: multi-turn requires history)
  - External service (rejected: adds dependency, breaks isolation)
- **Status:** DECIDED

### D4: Vocabulary Alignment — Additive Mapping

- **Decision:** Align critical action vocabulary by adding a mapping layer in `pipeline.ts` that translates pipeline `actionTypes` to registry keys. Old `PROTECTED_ACTION_TYPES` remain.
- **Rationale:** Additive change. Old protections stay. New vocabulary alignment activates the 17 critical action rules.
- **Alternatives considered:**
  - Replace `PROTECTED_ACTION_TYPES` with registry (rejected: too risky, removes existing protection)
  - Leave INERT (rejected: security gap persists)
  - Rewrite registry to match pipeline (rejected: registry is DB-seeded, immutable)
- **Status:** DECIDED

### D5: Tool Loop Limit — 10 Rounds Max

- **Decision:** Maximum 10 tool call rounds per command. Configurable via `FACTORY_MAX_TOOL_ROUNDS`.
- **Rationale:** Prevents cost runaway from LLM tool call loops. 10 rounds is generous for most use cases.
- **Alternatives considered:**
  - 5 rounds (too restrictive for complex multi-step commands)
  - 20 rounds (too expensive in worst case)
  - No limit (dangerous — cost runaway)
- **Status:** DECIDED

### D6: Provider Tool Support — All 3 Providers

- **Decision:** Support tool calling with OpenAI, Anthropic, and Google. OpenCode Zen deferred (text-only).
- **Rationale:** All 3 providers support function calling. OpenCode Zen is CLI-based and doesn't support tool schemas.
- **Alternatives considered:**
  - OpenAI only (rejected: not model-agnostic)
  - OpenAI + Anthropic (rejected: Google also supports tools)
  - All 4 including OpenCode Zen (rejected: CLI doesn't support tool schemas)
- **Status:** DECIDED

### D7: No Agent Tools in Gate 3

- **Decision:** Gate 3 tools are owner-only. Agent tool calling is deferred to Gate 4+.
- **Rationale:** Agent lifecycle is not yet API-managed. Agent autonomy requires proven owner tool execution first.
- **Alternatives considered:**
  - Include agent tools (rejected: too complex, no agent lifecycle API)
  - Include agent read-only tools (rejected: partial capability adds confusion)
- **Status:** DECIDED

### D8: No Memory/Vector Backend in Gate 3

- **Decision:** Memory recall remains a no-op. Vector backend is deferred.
- **Rationale:** Complex integration, not essential for tool execution. Conversation context provides short-term memory.
- **Alternatives considered:**
  - Add simple file-based memory (rejected: doesn't scale, adds complexity)
  - Add ChromaDB (rejected: infrastructure dependency, breaks isolation)
- **Status:** DECIDED

### D9: Migration Strategy — Additive Only

- **Decision:** New migration adds 3 tables. No existing tables modified.
- **Rationale:** Zero risk to existing data and functionality. Additive changes are safe.
- **Alternatives considered:**
  - Modify existing tables (rejected: risk of breaking Gate 1/2)
  - Multiple migrations (rejected: single migration is simpler)
- **Status:** DECIDED

### D10: Test Count Target — ~220 Unit Tests

- **Decision:** Gate 3 adds ~39 new unit tests (181 → ~220). Total including SQL + live: ~249.
- **Rationale:** Comprehensive coverage of new capabilities. Every tool, every conversation feature, every security boundary.
- **Status:** DECIDED

---

## Open Decisions (Require Owner Input)

### OD1: Git Initialization

- **Question:** Should we initialize a git repository before Gate 3 implementation?
- **Recommendation:** YES — git provides version control and rollback capability
- **Owner decision required:** YES

### OD2: Cost Limits Configuration

- **Question:** Should cost limits be configured before Gate 3 goes live?
- **Recommendation:** YES — set daily $5, monthly $100 limits
- **Owner decision required:** YES

### OD3: Provider API Keys

- **Question:** Which provider API keys should be configured for Gate 3 testing?
- **Recommendation:** At least 1 provider (OpenAI recommended for tool calling maturity)
- **Owner decision required:** YES
