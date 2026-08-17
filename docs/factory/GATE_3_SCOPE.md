# Gate 3 Scope: "EXECUTION GATE"

> **Purpose:** Make CHEF actually useful by adding tool-based execution.
> **Status:** Scope definition — READ-ONLY document.
> **Gate:** 3 of 5

---

## Section 1: Capability Matrix

Every capability appears exactly ONCE.

| # | Capability | Required/Optional/Deferred/Forbidden | Rationale |
|---|-----------|--------------------------------------|-----------|
| 1 | Tool-calling in LLM requests | REQUIRED | Core gap — CHEF cannot act without tools |
| 2 | ToolBroker wiring | REQUIRED | Already defined boundary, must be activated |
| 3 | create_project tool | REQUIRED | Pipeline cannot create projects today |
| 4 | list_projects tool | REQUIRED | Read project state via chat |
| 5 | list_tasks tool | REQUIRED | Read task state via chat |
| 6 | create_task tool | REQUIRED | Create tasks via chat |
| 7 | update_task tool | REQUIRED | Update tasks via chat |
| 8 | Conversation context | REQUIRED | Multi-turn conversation |
| 9 | Conversation persistence | REQUIRED | Message history in DB |
| 10 | Critical action vocabulary alignment | REQUIRED | INERT → ACTIVE security |
| 11 | Provider-specific tool schemas | REQUIRED | OpenAI, Anthropic, Google each have different tool formats |
| 12 | POST /api/agents (create) | DEFERRED | Agent lifecycle is not Gate 3 scope |
| 13 | Memory/vector backend | DEFERRED | Complex, separate effort |
| 14 | Growth Engine | DEFERRED | Business logic, not execution |
| 15 | Sales Engine | DEFERRED | Business logic, not execution |
| 16 | Deployment | DEFERRED | Requires separate authorization |
| 17 | Browser automation | DEFERRED | Complex integration |
| 18 | Proactive monitoring | DEFERRED | Requires scheduler |
| 19 | Financial execution | DEFERRED | High risk, requires proven governance |
| 20 | Legal execution | DEFERRED | High risk, requires proven governance |
| 21 | Full multi-agent autonomy | DEFERRED | Agents need lifecycle first |
| 22 | Kubernetes/microservices | DEFERRED | Infrastructure change |
| 23 | Git initialization | OPTIONAL | Recommended but not required for Gate 3 |
| 24 | Control Plane UI | DEFERRED | API-first, UI later |

---

## Section 2: Gate 2 Limitations Carried Forward

| # | Limitation | Gate 3 Action | Status After Gate 3 |
|---|-----------|---------------|-------------------|
| 1 | Critical action vocabulary mismatch | FIX — align vocabularies | ACTIVE (was INERT) |
| 2 | 5 anomaly counters unwired | DEFERRED — not Gate 3 scope | Still DEFERRED |
| 3 | 5 rate-limit scopes unenforced | DEFERRED — not Gate 3 scope | Still DEFERRED |
| 4 | Migration tracking gap 3-4 | DOCUMENT — do not fix | Still OPEN |
| 5 | No auth on DELETE endpoints | DEFERRED — soft-delete works | Still UNVERIFIED |
| 6 | Cost protection defaults | DEFERRED — owner configures later | Still NOT_APPLICABLE |

---

## Section 3: Dependency Matrix

For each REQUIRED capability, list dependencies:

| Capability | Existing Dep | New Dep | Security Dep | Data Dep | Model Dep | Runtime Dep | Evidence Required |
|-----------|-------------|---------|-------------|----------|-----------|-------------|-------------------|
| Tool-calling | Provider adapters | None | Guardian must evaluate tool calls | None | Provider must support function calling | None | All 3 providers work |
| ToolBroker wiring | ToolBroker.ts (exists) | Tool registry table | Authority + risk checks | tools table | None | None | ToolBroker tests pass |
| create_project | store.createProject | ToolBroker | write authority | projects table | None | None | Project created in DB |
| list_projects | store.listProjects | ToolBroker | read authority | projects table | None | None | Projects returned |
| list_tasks | store.listTasks | ToolBroker | read authority | tasks table | None | None | Tasks returned |
| create_task | store.createTask | ToolBroker | write authority | tasks table | None | None | Task created in DB |
| update_task | store.patchTask | ToolBroker | write authority | tasks table | None | None | Task updated in DB |
| Conversation context | None | conversation_messages table | owner scoping | conversations + messages | None | None | Multi-turn works |
| Vocabulary alignment | criticalActions.ts | pipeline.ts mapping | None | None | None | None | classifyCriticalAction matches |

---

## Section 4: Scope Boundaries

### IN SCOPE for Gate 3

- Tool calling integration with LLM providers
- ToolBroker activation with 5 tools
- Conversation context and persistence
- Critical action vocabulary alignment
- Provider-specific tool schema support
- Tests for all new capabilities
- Live verification

### OUT OF SCOPE for Gate 3

- Anything not listed as REQUIRED in Section 1
- New infrastructure
- New providers
- New databases
- Deployment
- Business logic (Growth/Sales)
