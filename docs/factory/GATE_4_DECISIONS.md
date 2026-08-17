# Gate 4 Architectural Decisions

> **READ-ONLY document.**

---

## Decision Log

### D1: Gate 4 Scope — "INTEGRATION GATE"

- **Decision:** Gate 4 focuses on fixing Gate 3 drift, not adding new capabilities
- **Rationale:** Forensic audit found 3 critical gaps that prevent the system from working as designed
- **Alternatives considered:**
  - Skip fixes, move to Growth Engine (rejected: security gaps are unacceptable)
  - Full rewrite of execution pipeline (rejected: disproportionate effort)
  - Fix only conversation history (rejected: security gaps remain)
- **Status:** DECIDED

### D2: Conversation History — Server-Side Loading

- **Decision:** Load conversation history from DB in handlers.ts, pass to pipeline
- **Rationale:** Consistent with Gate 3 D3 (server-side history). Client never supplies history.
- **Alternatives considered:**
  - Client sends history (rejected: security risk)
  - No history loading (rejected: multi-turn broken)
  - Load in execution runner (rejected: handler is the right layer)
- **Status:** DECIDED

### D3: SecurityGuard Wiring — Per-Tool-Call

- **Decision:** Wire securityGuard into ToolBroker so it's called per tool call
- **Rationale:** Pipeline-level Guardian doesn't evaluate individual tool calls inside the loop
- **Alternatives considered:**
  - Keep pipeline-level only (rejected: tool calls bypass Guardian)
  - Double-guardian (pipeline + tool) (accepted: defense-in-depth)
- **Status:** DECIDED

### D4: Authority Resolution — Before ToolBroker

- **Decision:** Resolve authority BEFORE calling broker.call(), pass resolved decision
- **Rationale:** ToolBroker should receive the actual authority decision, not 'auto'
- **Alternatives considered:**
  - Resolve inside ToolBroker (rejected: ToolBroker shouldn't know about authority matrix)
  - Keep 'auto' (rejected: authority check is meaningless)
- **Status:** DECIDED

### D5: No New Database Tables

- **Decision:** Gate 4 makes zero database changes
- **Rationale:** Gate 3 schema is correct. All fixes are in source code.
- **Status:** DECIDED

### D6: No New API Endpoints

- **Decision:** Gate 4 makes zero API endpoint changes
- **Rationale:** Existing endpoints are sufficient. All fixes are internal.
- **Status:** DECIDED

---

## Open Decisions (Require Owner Input)

### OD1: Git Initialization

- **Question:** Should git be initialized?
- **Recommendation:** YES
- **Owner decision required:** YES

### OD2: Cost Limits Configuration

- **Question:** Should daily $5 / monthly $100 limits be configured?
- **Recommendation:** YES
- **Owner decision required:** YES

### OD3: Tool Registry Expansion

- **Question:** Should Gate 4 add delete_project, archive_task, search_projects tools?
- **Recommendation:** OPTIONAL — can be deferred
- **Owner decision required:** NO (optional)
