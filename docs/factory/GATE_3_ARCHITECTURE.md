# GATE 3 ARCHITECTURE — EXECUTION GATE

> **Status:** DESIGN — No implementation until Gate 2 PASS is confirmed.  
> **Created:** 2026-08-19  
> **Type:** Architecture Document (READ-ONLY)  
> **Gate:** 3 of 6

---

## 1. Gate 3 Mission Statement

**"Make CHEF actually useful."**

CHEF today has enterprise-grade governance with zero execution capability. The intent parser works, the authority matrix works, the security guardian works — but when the pipeline reaches the execution phase, it sends plain text to an LLM and gets plain text back. No tool calls. No project creation. No task manipulation. No conversation memory.

Gate 3 bridges this gap by wiring tool calling into the LLM execution path, adding conversation context, and enabling essential CRUD operations through the chat interface. After Gate 3, CHEF can actually do things: create projects, list tasks, update statuses — all governed by the existing authority, risk, and security infrastructure.

**Gate 3 does not add new governance.** It activates the governance that already exists but currently has nothing to govern.

---

## 2. Architectural Principles (Carried from Gate 1/2)

These principles are non-negotiable and carried forward unchanged. Gate 3 does not alter, relax, or reinterpret any of them.

| # | Principle | Meaning |
|---|-----------|---------|
| 1 | **DENY always dominates** | If any rule says DENY, the action is denied. No override. |
| 2 | **LOCKDOWN > DENY > REQUIRE_APPROVAL > NOTIFY > ALLOW** | Escalation hierarchy is fixed. Higher authority cannot lower the response below its own level. |
| 3 | **Never fabricate certainty** | LLM output is treated as probabilistic. Authority decisions are deterministic. |
| 4 | **Fail closed** | If anything is ambiguous, deny. If the tool broker is unreachable, deny. If the database is down, deny. |
| 5 | **Model-agnostic, runtime-agnostic** | The authority matrix and tool broker do not care which LLM provider is active. |
| 6 | **Owner-only authority** | All tool calls are scoped to the authenticated owner. No cross-owner access. |
| 7 | **Evidence-first execution** | Every tool call produces an audit record before results are returned. |
| 8 | **Secrets never leak** | API keys, tokens, and credentials never appear in LLM responses or audit logs. |
| 9 | **LLM output = data, never authority** | The LLM can request a tool call. The ToolBroker decides whether to allow it. |

---

## 3. Gate 3 Architecture Layers

### Layer 1: Conversation Context (NEW)

**Problem:** Every `POST /api/chat` is stateless. The LLM has no memory of previous exchanges. Each request starts from zero.

**Solution:** Add conversation tracking to the chat pipeline.

**Changes:**
- New database tables: `conversations`, `conversation_messages`
- `POST /api/chat` accepts optional `conversation_id` field
- If `conversation_id` is provided, load message history from `conversation_messages`
- LLM receives the last N messages (configurable, default 20) as system/user/assistant turns
- After each exchange, new messages are appended to `conversation_messages`
- If no `conversation_id` is provided, a new conversation is created automatically
- Conversations are owner-scoped via RLS — one owner cannot read another's conversations

**What stays the same:**
- The intent parser is unchanged (still deterministic, still 15 verbs / 34 tokens / 19 resources)
- The authority matrix is unchanged (still 10 rules)
- The adaptive autonomy system is unchanged
- The security guardian is unchanged
- The audit system is unchanged

**New tables:**

```sql
-- conversations: one row per conversation thread
conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES auth.users(id),
  title         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- conversation_messages: append-only message log
conversation_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  owner_id        uuid NOT NULL REFERENCES auth.users(id),
  role            text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content         text NOT NULL,
  tool_call_id    text,  -- for tool result messages
  tool_calls      jsonb, -- for assistant messages that include tool calls
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

**RLS policies:**
- `conversations`: owner can SELECT/INSERT/UPDATE their own rows
- `conversation_messages`: owner can SELECT/INSERT their own rows; no UPDATE or DELETE (append-only)

---

### Layer 2: Tool-Calling Execution (NEW)

**Problem:** `execution.ts:63-85` sends a plain text prompt to the LLM and receives a plain text response. No function calling. No structured output. The LLM cannot request tool execution.

**Solution:** Modify the LLM call to include tool definitions and parse tool-call responses.

**Changes to `src/services/execution.ts`:**

1. **Send tool definitions with LLM requests.** When calling OpenAI, Anthropic, or Google, include an array of tool/function definitions alongside the prompt. Each provider has its own format:
   - OpenAI: `tools` array with `function` objects
   - Anthropic: `tools` array with `name`/`description`/`input_schema`
   - Google: `tools` array with `function_declarations`

2. **Parse tool-call responses.** When the LLM returns tool calls (instead of or in addition to text), extract them. Each provider returns tool calls differently:
   - OpenAI: `response.choices[0].message.tool_calls`
   - Anthropic: `response.content` where `type === 'tool_use'`
   - Google: `response.candidates[0].content.parts` where `functionCall` is present

3. **Route tool calls to ToolBroker.** Each tool call is an object with `name`, `arguments`, and a generated `tool_call_id`. These are passed to `ToolBroker.call()`.

4. **Feed results back to LLM.** Tool results are appended to the conversation as `tool` role messages, and the LLM is called again to generate a final response incorporating the tool results.

**What stays the same:**
- The model selection logic (cheapest capable) is unchanged
- The cost tracking on `model.call` is unchanged
- The provider adapters themselves are unchanged (they already support tool calling in their APIs)
- The runtime adapter (OpenCode Zen) is unchanged

**Provider adapter surface area:**

| Provider | Tool format | Response field | Notes |
|----------|-------------|----------------|-------|
| OpenAI | `tools[].function` | `choices[0].message.tool_calls` | Supports parallel tool calls |
| Anthropic | `tools[].name` + `input_schema` | `content[].type === 'tool_use'` | Sequential tool calls |
| Google | `tools[].function_declarations` | `candidates[0].content.parts[].functionCall` | Supports function declarations |

**Execution loop (simplified):**

```
function runExecution(task, context):
  messages = buildMessages(task, context, conversationHistory)
  tools = ToolBroker.getToolDefinitions()

  loop (max 5 iterations):
    response = callLLM(provider, messages, tools)

    if response has no tool_calls:
      return response.text

    for each tool_call in response.tool_calls:
      result = ToolBroker.call(tool_call.name, tool_call.arguments)
      messages.append(toolResultMessage(tool_call.id, result))

  return "I was unable to complete this request after multiple attempts."
```

---

### Layer 3: ToolBroker Wiring (ACTIVATE EXISTING)

**Problem:** `ToolBroker` is defined but never wired. Zero tools registered. Never called. The entire authority/risk/security infrastructure for tool execution exists but has no tools to govern.

**Solution:** Wire ToolBroker into the execution loop and register 5 essential tools.

**Changes:**
- `ToolBroker.initialize()` is called during application startup
- 5 tools are registered via `ToolBroker.register()`
- `ToolBroker.call()` is invoked from the execution loop when the LLM returns tool calls
- Tool results are returned to the execution loop for LLM consumption

**ToolBroker call sequence (already implemented, now actually used):**

```
ToolBroker.call(toolName, args, ownerContext)
  1. Resolve tool by name → tool definition
  2. Authority check → is ownerContext.authority sufficient?
  3. Risk check → does tool's risk level exceed owner's risk tolerance?
  4. Security Guardian check → does tool pass all 11 security steps?
  5. Critical action check → is this a critical action? Is it locked?
  6. Execute tool → call the tool's handler function
  7. Audit record → log tool call, arguments, result, cost, decision
  8. Cost record → track against rate limits
  9. Return result to caller
```

**What stays the same:**
- The ToolBroker class itself is unchanged
- The authority check logic is unchanged
- The risk check logic is unchanged
- The security guardian is unchanged
- The audit system is unchanged
- The cost tracking on `tool.call` (100/hour rate limit) is unchanged

---

### Layer 4: Project Creation via Chat (NEW)

**Problem:** The pipeline cannot create projects. When a user says "create a project called X," the intent parser recognizes it, but execution has no way to act on it. The pipeline blocks on `unknown_project`.

**Solution:** Delegate project creation to ToolBroker through the tool-calling execution path.

**Changes:**
- When the intent parser returns `intent.verb === 'create'` and `intent.resource === 'project'`, the execution runner includes the `create_project` tool in its LLM call
- The LLM generates a tool call to `create_project` with the parsed name, slug, and description
- ToolBroker executes `create_project` → inserts into `projects` table → returns the created project
- The LLM incorporates the result into its response ("Project X has been created.")
- Audit record is created with `actionType: 'project_create'`

**What stays the same:**
- The intent parser is unchanged (it already recognizes "create" + "project")
- The authority matrix is unchanged (it already handles project creation authority)
- The database schema for `projects` is unchanged
- The audit system is unchanged

**Error handling:**
- If the LLM does not generate a tool call (fails to), the pipeline falls back to text response: "I understand you want to create a project, but I was unable to process the request."
- If the tool call fails (database error, validation error), the error is returned to the LLM which generates a user-friendly error message
- If the authority check denies the tool call, the denial is returned to the LLM which explains the denial

---

### Layer 5: Vocabulary Alignment (FIX INERT)

**Problem:** The critical action registry defines keys like `project.create`, but the pipeline sends actionTypes like `project_create`. The keys don't match, so `classifyCriticalAction()` always returns `INERT`. Critical actions are defined but never activated.

**Solution:** Align the vocabulary between the pipeline's actionTypes and the registry's keys.

**Changes:**
- Pipeline maps verbs to registry-compatible keys before calling `classifyCriticalAction()`
- Mapping: `project_create` → `project.create`, `task_create` → `task.create`, etc.
- OR: update the registry to use underscore keys matching the pipeline's actionTypes
- Decision: **update the registry** to use underscore keys (pipeline's format), since the pipeline is the source of truth for actionTypes

**Registry key changes:**

| Old Key (Gate 2) | New Key (Gate 3) | Status |
|-------------------|------------------|--------|
| `project.create` | `project_create` | ACTIVE |
| `project.delete` | `project_delete` | ACTIVE |
| `task.create` | `task_create` | ACTIVE |
| `task.delete` | `task_delete` | ACTIVE |
| `agent.create` | `agent_create` | ACTIVE |
| `agent.delete` | `agent_delete` | ACTIVE |
| `memory.write` | `memory_write` | INERT (memory backend deferred) |
| `memory.delete` | `memory_delete` | INERT (memory backend deferred) |
| `security.policy_edit` | `security_policy_edit` | ACTIVE |

**What stays the same:**
- The critical action check logic is unchanged
- The LOCKDOWN enforcement is unchanged
- The 17 critical action rules are unchanged (only their keys change)
- The security guardian is unchanged

**Verification:** After Gate 3, `classifyCriticalAction('project_create')` must return the correct risk level and approval requirement, not `INERT`.

---

## 4. Execution Flow (After Gate 3)

```
POST /api/chat { command: "Create a project called My App", conversation_id?: "abc-123" }

  ┌─────────────────────────────────────────────────────────┐
  │ 1. CONVERSATION CONTEXT                                 │
  │    - If conversation_id provided: load history          │
  │    - If not: create new conversation                    │
  │    - Append user message to conversation_messages       │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 2. INTENT PARSER (deterministic, unchanged)             │
  │    - verb: create                                       │
  │    - resource: project                                  │
  │    - tokens: ["create", "project", "called", "my",     │
  │              "app"]                                     │
  │    - confidence: 0.95                                   │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 3. AUTHORITY MATRIX (10 rules, unchanged)               │
  │    - owner: owner_123                                   │
  │    - resource: project                                  │
  │    - action: create                                     │
  │    - result: ALLOW (owner has write authority)          │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 4. ADAPTIVE AUTONOMY (unchanged)                        │
  │    - Risk: medium                                       │
  │    - Autonomy level: standard                           │
  │    - Decision: execute (within bounds)                  │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 5. SECURITY GUARDIAN (11 steps, now with ACTIVE         │
  │    critical actions)                                    │
  │    - Step 1-10: standard checks (unchanged)             │
  │    - Step 11: classifyCriticalAction('project_create')  │
  │      → Previously: INERT (vocabulary mismatch)          │
  │      → Now: MEDIUM (vocabulary aligned)                 │
  │      → Decision: proceed with caution                   │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 6. TASK CREATION (DB, unchanged)                        │
  │    - Create task record with intent, decision, context  │
  │    - Status: executing                                  │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 7. EXECUTION RUNNER                                      │
  │    a. Model Selection (cheapest capable, unchanged)     │
  │    b. Build messages array:                             │
  │       - system prompt (with tool definitions)           │
  │       - conversation history (from Layer 1)             │
  │       - user message                                    │
  │    c. Call LLM with tools array                         │
  │    d. LLM returns: tool_calls: [{                       │
  │         name: "create_project",                         │
  │         arguments: { name: "My App", slug: "my-app",   │
  │                      description: null },               │
  │         id: "call_abc123"                               │
  │       }]                                                │
  │    e. ToolBroker.call("create_project", args, owner)    │
  │       → Authority: write ✓                              │
  │       → Risk: medium ✓                                  │
  │       → Security: all 11 steps ✓                        │
  │       → Critical action: project_create (ACTIVE) ✓      │
  │       → Execute: INSERT INTO projects ... ✓             │
  │       → Audit: logged ✓                                 │
  │       → Result: { id: "proj_456", name: "My App", ... }│
  │    f. Append tool result to messages                     │
  │    g. Call LLM again with tool result                   │
  │    h. LLM returns: text "Project 'My App' has been     │
  │       created with ID proj_456."                         │
  │    i. Store as task output                              │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 8. TASK COMPLETION (unchanged)                           │
  │    - Task status → completed                             │
  │    - Output stored                                      │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 9. AUDIT + DECISION JOURNAL (unchanged)                 │
  │    - Full audit trail: intent → authority → security →  │
  │      execution → tool call → result                     │
  │    - Decision journal entry created                     │
  │    - Cost recorded (LLM + tool.call)                    │
  └─────────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─────────────────────────────────────────────────────────┐
  │ 10. EXPLANATION RESPONSE                                │
  │    - Return: { explanation, audit_id, conversation_id } │
  │    - User sees: natural language + audit trail          │
  └─────────────────────────────────────────────────────────┘
```

---

## 5. Tool Registry (Gate 3 — 5 Tools)

| Tool | Description | Risk Level | Authority Required | Returns |
|------|-------------|------------|-------------------|---------|
| `create_project` | Create a new project with name, slug, and optional description | medium | write | `{ id, name, slug, description, created_at }` |
| `list_projects` | List all projects owned by the current owner | low | read | `[{ id, name, slug, description, created_at }]` |
| `list_tasks` | List all tasks in a specific project | low | read | `[{ id, title, status, priority, created_at }]` |
| `create_task` | Create a task within a project | medium | write | `{ id, title, status, priority, project_id, created_at }` |
| `update_task` | Update a task's status, title, or details | medium | write | `{ id, title, status, priority, updated_at }` |

**Tool definitions (LLM-facing schema):**

```json
{
  "name": "create_project",
  "description": "Create a new project. Use this when the user wants to start a new project.",
  "parameters": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "The display name of the project"
      },
      "slug": {
        "type": "string",
        "description": "URL-friendly identifier (auto-generated from name if not provided)"
      },
      "description": {
        "type": "string",
        "description": "Optional description of the project"
      }
    },
    "required": ["name"]
  }
}
```

```json
{
  "name": "list_projects",
  "description": "List all projects owned by the current user. Use this when the user wants to see their projects.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

```json
{
  "name": "list_tasks",
  "description": "List all tasks in a specific project. Use this when the user wants to see tasks in a project.",
  "parameters": {
    "type": "object",
    "properties": {
      "project_id": {
        "type": "string",
        "description": "The ID of the project to list tasks for"
      },
      "status": {
        "type": "string",
        "description": "Filter by task status (optional)",
        "enum": ["pending", "in_progress", "completed", "failed"]
      }
    },
    "required": ["project_id"]
  }
}
```

```json
{
  "name": "create_task",
  "description": "Create a new task within a project. Use this when the user wants to add a task to a project.",
  "parameters": {
    "type": "object",
    "properties": {
      "project_id": {
        "type": "string",
        "description": "The ID of the project to add the task to"
      },
      "title": {
        "type": "string",
        "description": "The title of the task"
      },
      "description": {
        "type": "string",
        "description": "Optional description of the task"
      },
      "priority": {
        "type": "string",
        "description": "Task priority (defaults to medium)",
        "enum": ["low", "medium", "high", "critical"]
      }
    },
    "required": ["project_id", "title"]
  }
}
```

```json
{
  "name": "update_task",
  "description": "Update a task's status, title, or other details. Use this when the user wants to modify an existing task.",
  "parameters": {
    "type": "object",
    "properties": {
      "task_id": {
        "type": "string",
        "description": "The ID of the task to update"
      },
      "title": {
        "type": "string",
        "description": "New title (optional, keeps current if not provided)"
      },
      "status": {
        "type": "string",
        "description": "New status (optional)",
        "enum": ["pending", "in_progress", "completed", "failed"]
      },
      "priority": {
        "type": "string",
        "description": "New priority (optional)",
        "enum": ["low", "medium", "high", "critical"]
      },
      "description": {
        "type": "string",
        "description": "New description (optional)"
      }
    },
    "required": ["task_id"]
  }
}
```

**Tool handler implementations:** Each tool handler is a synchronous function that performs a database operation (Supabase insert/select/update) and returns a result object. Tool handlers do NOT have access to the LLM, the authority matrix, or the security guardian — those checks are performed by ToolBroker before the handler is called.

---

## 6. Conversation Model

**Design decisions:**

1. **Conversations are owner-scoped.** RLS enforces that one owner cannot read another owner's conversations. This is consistent with the existing data model where all tables are owner-scoped.

2. **Message history is append-only.** `conversation_messages` rows are never updated or deleted. This preserves the full audit trail of what was said.

3. **History window is configurable.** The LLM receives the last N messages (default 20). This prevents context window overflow while maintaining recent context. The window size is a configuration parameter, not hardcoded.

4. **Tool messages are included in history.** When the LLM makes a tool call and receives a result, both the tool call and the result are stored in `conversation_messages`. This means the LLM can reference previous tool results in later exchanges.

5. **Conversations can be titled.** The `conversations.title` field can be auto-generated from the first user message or set explicitly. This enables UI features like conversation lists.

**Message flow for a multi-turn conversation:**

```
User: "Create a project called My App"
→ conversation_messages: [{ role: "user", content: "Create a project called My App" }]
→ LLM tool call: create_project
→ conversation_messages: [..., { role: "assistant", tool_calls: [...] }]
→ Tool result: { id: "proj_456", name: "My App" }
→ conversation_messages: [..., { role: "tool", content: "{ id: proj_456, ... }" }]
→ LLM response: "Project 'My App' has been created."
→ conversation_messages: [..., { role: "assistant", content: "Project 'My App' has been created." }]

User: "Add a task to it called Setup CI"
→ conversation_messages: [previous 4 messages + new user message]
→ LLM has context: knows project ID is proj_456
→ LLM tool call: create_task(project_id: "proj_456", title: "Setup CI")
→ ... (proceeds with tool execution)
```

**Conversation lifecycle:**

| Event | Action |
|-------|--------|
| First message with no `conversation_id` | Create new conversation, generate `conversation_id`, return it in response |
| Message with valid `conversation_id` | Load history, append new messages, return same `conversation_id` |
| Message with invalid `conversation_id` | Create new conversation, return new `conversation_id` |
| Conversation exceeds max age (90 days) | No automatic deletion; owner can delete manually |

---

## 7. What Gate 3 Does NOT Include (Deferred)

Gate 3 is deliberately scoped. The following are explicitly excluded:

| Feature | Reason for Deferral | Target Gate |
|---------|---------------------|-------------|
| Growth Engine | Not yet designed | Gate 4+ |
| Sales Engine | Not yet designed | Gate 4+ |
| Deployment | Requires infrastructure design | Gate 5+ |
| Full multi-agent autonomy | Agents creating tasks for other agents | Gate 4+ |
| Browser automation | Requires sandboxing design | Gate 5+ |
| Memory/vector backend | Requires embedding strategy | Gate 4+ |
| Proactive monitoring | Requires scheduling infrastructure | Gate 4+ |
| Financial/legal execution | Requires compliance review | Gate 5+ |
| Kubernetes/microservices | Requires container orchestration | Gate 5+ |
| New LLM providers | OpenCode Zen adapter already exists; others are stable | Gate 4+ |
| New intent verbs | 15 verbs cover current needs | Gate 4+ |
| New authority rules | 10 rules cover current needs | Gate 4+ |

**Gate 3 adds 5 tools, not 50.** The tool registry will grow in Gate 4+.

---

## 8. Migration Strategy

**Migration file:** `supabase/migrations/20260819000000_gate3_execution.sql`

**New tables (additive only):**

| Table | Purpose | Rows (est. at launch) |
|-------|---------|----------------------|
| `conversations` | Conversation threads | 0 (created on first chat) |
| `conversation_messages` | Append-only message log | 0 (created on first chat) |
| `tools` | Tool registry (metadata) | 5 (seeded) |

**Modified tables:** None. Gate 3 is purely additive on the database side.

**Modified files:**

| File | Change | Risk |
|------|--------|------|
| `src/services/execution.ts` | Add tool definitions to LLM call, parse tool-call responses, route to ToolBroker | HIGH — core execution path |
| `src/services/tool-broker.ts` | Add `getToolDefinitions()` method, register 5 tools | MEDIUM — new methods, existing class |
| `src/services/intent-parser.ts` | No changes | NONE |
| `src/services/authority-matrix.ts` | No changes | NONE |
| `src/services/security-guardian.ts` | No changes | NONE |
| `src/services/adaptivity.ts` | No changes | NONE |
| `src/services/cost-tracker.ts` | No changes | NONE |
| `src/services/audit.ts` | No changes | NONE |
| `src/services/memory.ts` | No changes (still returns []) | NONE |
| `src/api/chat.ts` | Accept `conversation_id`, return it in response | LOW — additive field |
| `src/tools/*.ts` | 5 new tool handler files | LOW — new files, no edits |
| `src/tools/index.ts` | Export all 5 tools | LOW — new file |
| `critical-actions/registry.ts` | Update key format from dot to underscore | MEDIUM — key change |

**Seed data:**

```sql
-- Insert 5 tools into registry
INSERT INTO tools (name, description, risk_level, authority_required) VALUES
  ('create_project', 'Create a new project', 'medium', 'write'),
  ('list_projects', 'List owner projects', 'low', 'read'),
  ('list_tasks', 'List tasks in a project', 'low', 'read'),
  ('create_task', 'Create a task in a project', 'medium', 'write'),
  ('update_task', 'Update task status/details', 'medium', 'write');
```

**Rollback strategy:** Drop the 3 new tables. Remove the 5 new tool files. Revert `execution.ts` and `chat.ts` to Gate 2 versions. Revert `critical-actions/registry.ts` to dot-format keys. No data loss on existing tables.

---

## 9. Security Boundary

Gate 3 does not weaken the existing security boundary. It activates security checks that were previously dormant.

**Tool call security path (fully enforced):**

```
User request
  → Intent Parser (deterministic)
  → Authority Matrix (owner check)
  → Adaptive Autonomy (risk tolerance)
  → Security Guardian (11 steps, critical actions NOW ACTIVE)
  → ToolBroker.call()
    → Authority check (second pass, tool-level)
    → Risk check (tool risk vs owner tolerance)
    → Security Guardian check (tool-level, 11 steps)
    → Critical action classification (ACTIVE, not INERT)
    → Tool handler execution (database operation)
    → Audit record (before result returned)
    → Cost record (rate limit tracking)
  → Tool result to LLM
  → LLM generates response
  → Response audit
```

**Rate limits (already wired, now enforced on actual tool calls):**

| Resource | Limit | Window | Enforcement Point |
|----------|-------|--------|-------------------|
| `tool.call` | 100/hour | Rolling | ToolBroker |
| `model.call` | 200/hour | Rolling | Execution runner |
| `chat.message` | 1000/hour | Rolling | API handler |

**Critical action enforcement (NOW ACTIVE):**

| Critical Action | Risk | LOCKDOWN Behavior |
|-----------------|------|-------------------|
| `project_create` | medium | Requires approval if LOCKDOWN enabled |
| `project_delete` | high | Denied if LOCKDOWN enabled |
| `task_create` | medium | Requires approval if LOCKDOWN enabled |
| `task_delete` | high | Denied if LOCKDOWN enabled |
| `agent_create` | high | Denied if LOCKDOWN enabled |
| `agent_delete` | high | Denied if LOCKDOWN enabled |
| `security_policy_edit` | critical | Always denied (no exceptions) |

**What was INERT, now ACTIVE:**
- `project_create`, `project_delete`, `task_create`, `task_delete`, `agent_create`, `agent_delete`, `security_policy_edit` — all now classified correctly by `classifyCriticalAction()`.

**What remains INERT (deferred):**
- `memory_write`, `memory_delete` — memory backend not yet implemented.

**Audit logging:**
- Every tool call produces an audit record with: `tool_name`, `arguments`, `result_summary`, `decision`, `cost`, `latency_ms`, `owner_id`, `timestamp`
- Audit records are append-only
- Audit records cannot be modified or deleted by any user

---

## 10. Evidence Requirements

Gate 3 is not complete until the following evidence requirements are met:

### Unit Tests

| Test | What It Verifies | Expected Count |
|------|------------------|----------------|
| `create_project` tool handler | Correct DB insert, slug generation, validation | 5+ |
| `list_projects` tool handler | Correct DB query, owner scoping, empty result | 4+ |
| `list_tasks` tool handler | Correct DB query, project scoping, status filter | 5+ |
| `create_task` tool handler | Correct DB insert, validation, project existence | 5+ |
| `update_task` tool handler | Correct DB update, partial updates, validation | 5+ |
| ToolBroker tool registration | 5 tools registered, definitions correct | 3+ |
| ToolBroker call sequence | Authority → risk → security → execute → audit | 8+ |
| ToolBroker denial paths | Authority denied, risk denied, security denied | 6+ |
| Conversation creation | New conversation created, ID returned | 3+ |
| Conversation history loading | History loaded, windowed, ordered correctly | 4+ |
| Conversation message appending | Messages appended, role preserved, tool calls stored | 4+ |
| Execution with tool calls | LLM tool calls parsed, routed, results fed back | 5+ |
| Critical action alignment | `classifyCriticalAction()` returns correct values | 5+ |
| Provider tool format | OpenAI, Anthropic, Google formats correct | 3+ (one per provider) |

**Minimum unit test count:** 65 new tests

### Integration Tests

| Test | What It Verifies |
|------|------------------|
| Create project via chat | Full pipeline: intent → authority → security → execution → tool → DB → response |
| List projects via chat | Full pipeline with read tool |
| Create task via chat | Full pipeline with dependent tool (needs project_id) |
| Update task via chat | Full pipeline with update tool |
| Multi-turn conversation | Context preserved across turns, tool results referenced |
| Tool denial via authority | Owner with read-only authority cannot create project |
| Tool denial via security | LOCKDOWN prevents project deletion |
| Critical action enforcement | `project_create` requires approval when LOCKDOWN enabled |
| Cost tracking | Tool calls counted against rate limit |
| Audit trail | Full audit trail from intent to tool result |

**Minimum integration test count:** 10 new tests

### Live HTTP Tests

| Test | What It Verifies |
|------|------------------|
| POST /api/chat with conversation_id | New field accepted, returned in response |
| POST /api/chat creates project | Full HTTP flow: create project via chat |
| POST /api/chat lists projects | Full HTTP flow: list projects via chat |
| POST /api/chat multi-turn | Second message has context from first |

**Minimum live HTTP test count:** 4 new tests (total: 9 existing + 4 new = 13 minimum)

### Regression

- **All 181 existing tests must pass.** No regressions.
- **All 9 existing live HTTP tests must pass.** No regressions.
- **Intent parser performance:** No degradation (still deterministic, same latency).
- **Authority matrix performance:** No degradation (same rules, same checks).
- **Security guardian performance:** No degradation (same steps, same checks).

### Verification Checklist

- [ ] `create_project` tool works via chat (unit + integration + HTTP)
- [ ] `list_projects` tool works via chat (unit + integration + HTTP)
- [ ] `list_tasks` tool works via chat (unit + integration + HTTP)
- [ ] `create_task` tool works via chat (unit + integration + HTTP)
- [ ] `update_task` tool works via chat (unit + integration + HTTP)
- [ ] Conversation context preserved across turns (unit + integration + HTTP)
- [ ] ToolBroker correctly enforces authority on tool calls (unit + integration)
- [ ] ToolBroker correctly enforces risk on tool calls (unit + integration)
- [ ] ToolBroker correctly enforces security on tool calls (unit + integration)
- [ ] Critical actions are ACTIVE (not INERT) for all 7 keys (unit)
- [ ] All 3 providers support tool calling (unit: one per provider)
- [ ] All 181 existing tests pass (regression)
- [ ] All 9 existing live HTTP tests pass (regression)
- [ ] Audit trail complete for tool calls (unit + integration)
- [ ] Cost tracking works for tool calls (unit + integration)
- [ ] Rate limits enforced on tool.call (unit + integration)
- [ ] No secrets in audit logs or LLM responses (security review)
- [ ] No regression on intent parser (performance)
- [ ] No regression on authority matrix (performance)
- [ ] No regression on security guardian (performance)

---

## Appendix: Gate 3 File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `src/tools/create-project.ts` | create_project tool handler |
| `src/tools/list-projects.ts` | list_projects tool handler |
| `src/tools/list-tasks.ts` | list_tasks tool handler |
| `src/tools/create-task.ts` | create_task tool handler |
| `src/tools/update-task.ts` | update_task tool handler |
| `src/tools/index.ts` | Tool registry exports |
| `src/services/conversation.ts` | Conversation context management |
| `tests/tools/*.test.ts` | Tool handler unit tests (5 files) |
| `tests/services/conversation.test.ts` | Conversation context tests |
| `tests/integration/execution-tools.test.ts` | Integration tests for tool-calling execution |
| `tests/http/chat-tools.test.ts` | Live HTTP tests for tool-calling chat |
| `supabase/migrations/20260819000000_gate3_execution.sql` | Database migration |

### Modified Files

| File | Change |
|------|--------|
| `src/services/execution.ts` | Add tool definitions, parse tool calls, route to ToolBroker, feed results back |
| `src/api/chat.ts` | Accept `conversation_id`, manage conversation context |
| `critical-actions/registry.ts` | Update keys from dot format to underscore format |
| `src/services/tool-broker.ts` | Add `getToolDefinitions()`, register 5 tools, add `initialize()` call |

### Unchanged Files (Verified No Changes)

| File | Reason |
|------|--------|
| `src/services/intent-parser.ts` | Deterministic, works as-is |
| `src/services/authority-matrix.ts` | 10 rules, works as-is |
| `src/services/security-guardian.ts` | 11 steps, works as-is |
| `src/services/adaptivity.ts` | Bounded escalation, works as-is |
| `src/services/cost-tracker.ts` | Rate limits already wired |
| `src/services/audit.ts` | Audit system already wired |
| `src/services/memory.ts` | Still returns [] (deferred to Gate 4+) |
| `src/services/providers/openai.ts` | Already supports tool calling in API |
| `src/services/providers/anthropic.ts` | Already supports tool calling in API |
| `src/services/providers/google.ts` | Already supports tool calling in API |
| `src/services/runtime/opencode-zen.ts` | Runtime adapter unchanged |
| All existing test files | Must pass without modification |

---

> **Gate 3 scope is tight.** 5 tools. Conversation context. Vocabulary alignment. That's it. No new governance, no new providers, no new verbs, no new authority rules. Just wire what exists and make it work.
