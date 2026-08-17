# GATE 4 ARCHITECTURE — "INTEGRATION GATE"

> **Status:** PLANNING
> **Created:** 2026-08-17
> **Type:** Architecture Document (READ-ONLY)
> **Gate:** 4 of 6

---

## 1. Gate 4 Mission Statement

**"Fix Gate 3 drift. Make the architecture match the implementation."**

Gate 3 built the tool calling infrastructure but left three critical gaps:
1. Conversation history is persisted but never loaded into the LLM
2. ToolBroker securityGuard is defined but never wired
3. ToolBroker authority resolution is bypassed

Gate 4 closes these gaps, activates deferred Gate 2 items, and expands the tool registry.

---

## 2. Architectural Principles (Carried from Gate 1/3)

All 9 principles from Gate 3 §2 remain unchanged. Gate 4 does not alter, relax, or reinterpret any of them.

---

## 3. Gate 4 Architecture Layers

### Layer 1: Conversation History Loading (FIX CRITICAL)

**Problem:** `handlers.ts:80` calls `pipeline.run(actorCtx(), command)` without conversation history. The execution runner builds messages from scratch. Multi-turn is broken.

**Solution:** Load conversation history in the handler and pass it through to the execution runner.

**Changes:**
- `handlers.ts`: Load history via `ConversationService.loadHistory()` before calling pipeline
- `pipeline.ts`: Accept optional conversation history parameter
- `execution.ts`: Use conversation history when building messages for LLM call

**Message flow (after fix):**
```
POST /api/chat { command: "Add a task to it", conversation_id: "abc" }
  → Load history: [user: "Create project X", assistant: "Done", user: "Add a task to it"]
  → Pipeline runs with conversation context
  → LLM receives all messages (system + history + current)
  → LLM references previous tool call result
  → Response includes context from earlier turns
```

**What stays the same:**
- ConversationService unchanged (already has loadHistory)
- RLS unchanged
- Append-only enforcement unchanged

---

### Layer 2: ToolBroker SecurityGuard Wiring (FIX HIGH)

**Problem:** `initializeToolBroker()` does not accept a securityGuard. Individual tool calls bypass Guardian evaluation.

**Solution:** Pass the securityGuard into initializeToolBroker() and wire it to each tool call.

**Changes:**
- `execution.ts`: `initializeToolBroker()` accepts securityGuard parameter
- `execution.ts`: `broker.call()` includes securityGuard in context
- `security.ts`: `createSecurityGuardian()` returns guard function compatible with ToolBroker

**Security flow (after fix):**
```
LLM tool call
  → ToolBroker.call()
    → Authority check (decision from resolved authority)
    → Risk check (tool risk vs owner tolerance)
    → SecurityGuard check (Guardian evaluates per-tool-call)
      → Critical action classification
      → Prompt injection check
      → Environment scope check
    → Tool handler execution
    → Audit record
```

**What stays the same:**
- Guardian evaluation logic unchanged
- Critical action classification unchanged
- Rate limits unchanged

---

### Layer 3: ToolBroker Authority Resolution (FIX HIGH)

**Problem:** `broker.call()` uses `decision: 'auto'` which always passes the authority check.

**Solution:** Resolve the owner's actual authority before calling broker.call().

**Changes:**
- `execution.ts`: Before broker.call(), resolve authority from the authority matrix
- `execution.ts`: Pass resolved authority decision to broker.call()
- Authority resolution uses: owner identity + resource type + action + environment

**Authority flow (after fix):**
```
Tool call request
  → Resolve authority: owner + resource + action → auto/require_approval/deny
  → If deny: broker.call() returns denied_by_authority
  → If require_approval: broker.call() returns requires_approval
  → If auto: broker.call() proceeds with securityGuard check
```

---

### Layer 4: Deferred Gate 2 Activations (RECOMMENDED)

| # | Item | Change |
|---|------|--------|
| 1 | Wire 5 anomaly counters | Connect anomaly signals to security events |
| 2 | Wire 5 failure rate limits | Connect failure counts to rate limit checks |
| 3 | Configure cost limits | Owner sets daily/monthly limits |

---

### Layer 5: Tool Registry Expansion (OPTIONAL)

| Tool | Risk | Action | Priority |
|------|------|--------|----------|
| delete_project | high | project_delete | MEDIUM |
| archive_task | medium | task_update | LOW |
| search_projects | low | read | LOW |

---

## 4. Execution Flow (After Gate 4)

```
POST /api/chat { command: "Add a task to project X", conversation_id: "abc" }

  ┌─────────────────────────────────────────────────────────┐
  │ 1. CONVERSATION CONTEXT                                 │
  │    - Load history from conversation_messages (N=20)     │
  │    - Append user message                                │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 2. INTENT PARSER (unchanged)                            │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 3. AUTHORITY MATRIX (unchanged)                         │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 4. SECURITY GUARDIAN (unchanged)                        │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 5. EXECUTION RUNNER                                     │
  │    a. Build messages: system + HISTORY + user           │
  │    b. Call LLM with tools                               │
  │    c. LLM returns tool_calls                            │
  │    d. For each tool_call:                               │
  │       - Resolve owner authority → decision              │
  │       - ToolBroker.call(decision, securityGuard)        │
  │         → Authority check (resolved decision)           │
  │         → Risk check                                    │
  │         → SecurityGuard check (per-tool Guardian)       │
  │         → Tool handler execution                        │
  │         → Audit record                                  │
  │       - Append tool result to messages                  │
  │    e. Call LLM again with tool results                  │
  │    f. LLM returns final response (with context)         │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 6. CONVERSATION PERSISTENCE                             │
  │    - Append assistant + tool messages                   │
  │    - Return conversation_id                             │
  └─────────────────────────────────────────────────────────┘
```

---

## 5. What Gate 4 Does NOT Include

| Feature | Reason |
|---------|--------|
| New tools beyond expansion | Focus on fixing drift first |
| New providers | 3 providers already implemented |
| New tables | Gate 3 schema is correct |
| New API endpoints | Existing endpoints are sufficient |
| Deployment | Requires separate authorization |
| Growth/Sales Engine | Not designed |
| Memory/vector | Requires embedding strategy |
| Multi-agent | Needs lifecycle first |
