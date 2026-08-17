# Gate 3 API Plan

## 1. Modified Endpoints

### POST /api/chat (MODIFIED)

- **Current:** `{ command: string }` → pipeline runs, returns result
- **Gate 3:** `{ command: string, conversation_id?: string }` → pipeline runs with conversation context, returns result + conversation_id
- **Authentication:** Bearer token (unchanged)
- **Authorization:** Owner scoping (unchanged)
- **New behavior:**
  - If `conversation_id` provided, load message history
  - If no `conversation_id`, create new conversation
  - Response includes `conversation_id` for follow-up
  - LLM receives conversation history
  - Tool calls are executed via ToolBroker
  - Both text response and tool results stored in `conversation_messages`

**Request:**

```json
{
  "command": "create project my-app with description Test",
  "conversation_id": "uuid-or-null"
}
```

**Response:**

```json
{
  "result": {
    "status": "completed",
    "verb": "create",
    "resource": "project",
    "output": "Project 'my-app' created successfully.",
    "explanation": {
      "decision": "Project created via tool call",
      "why": "Owner requested project creation via chat",
      "evidence": ["tool:create_project → success"],
      "confidence": "high",
      "risk": "medium"
    }
  },
  "conversation_id": "uuid",
  "cost": {
    "model": "gpt-4o-mini",
    "tokens": 150,
    "estimated_cost": 0.0001
  }
}
```

---

### GET /api/conversations (NEW)

- List owner's conversations
- **Query params:** `status` (active/archived), `limit`, `offset`
- **Response:** `{ conversations: [...] }`

---

### GET /api/conversations/:conversationId (NEW)

- Get conversation with message history
- **Response:** `{ conversation: {...}, messages: [...] }`

---

### DELETE /api/conversations/:conversationId (NEW)

- Archive a conversation (soft-delete via status)
- **Response:** `{ ok: true }`

---

## 2. Unchanged Endpoints

ALL existing 28 endpoints remain **UNCHANGED**. No modifications to existing behavior.

---

## 3. New Internal API (ToolBroker → Store)

These are internal method calls, not HTTP endpoints.

### Tool: create_project

```typescript
// ToolBroker calls:
store.createProject(owner.id, { name, slug, description })
// Returns: ProjectRecord
```

### Tool: list_projects

```typescript
// ToolBroker calls:
store.listProjects(owner.id)
// Returns: ProjectRecord[]
```

### Tool: list_tasks

```typescript
// ToolBroker calls:
store.listTasks(owner.id, { projectId })
// Returns: TaskRecord[]
```

### Tool: create_task

```typescript
// ToolBroker calls:
store.createTask(owner.id, projectId, { title, description })
// Returns: TaskRecord
```

### Tool: update_task

```typescript
// ToolBroker calls:
store.patchTask(owner.id, taskId, patch)
// Returns: TaskRecord
```

---

## 4. Tool Schema Format (for LLM providers)

Each tool is defined in the provider's format.

### OpenAI format

```json
{
  "type": "function",
  "function": {
    "name": "create_project",
    "description": "Create a new project with name, slug, and optional description",
    "parameters": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "description": "Project display name" },
        "slug": { "type": "string", "description": "URL-friendly identifier" },
        "description": { "type": "string", "description": "Project description" }
      },
      "required": ["name", "slug"]
    }
  }
}
```

### Anthropic format

```json
{
  "name": "create_project",
  "description": "Create a new project with name, slug, and optional description",
  "input_schema": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "Project display name" },
      "slug": { "type": "string", "description": "URL-friendly identifier" },
      "description": { "type": "string", "description": "Project description" }
    },
    "required": ["name", "slug"]
  }
}
```

### Google format

```json
{
  "function_declarations": [
    {
      "name": "create_project",
      "description": "Create a new project with name, slug, and optional description",
      "parameters": {
        "type": "OBJECT",
        "properties": {
          "name": { "type": "STRING", "description": "Project display name" },
          "slug": { "type": "STRING", "description": "URL-friendly identifier" },
          "description": { "type": "STRING", "description": "Project description" }
        },
        "required": ["name", "slug"]
      }
    }
  ]
}
```

---

## 5. Provider-Specific Tool Calling

Each adapter must handle tool calling differently.

### OpenAI adapter

- Send `tools` array in request body
- Response includes `tool_calls` array (if any)
- Tool call ID: `tool_call.id`
- Tool result format: `{ role: "tool", tool_call_id: "...", content: "..." }`

### Anthropic adapter

- Send `tools` array in request body
- Response includes content blocks with type `"tool_use"`
- Tool call ID: `content_block.id`
- Tool result format: `{ role: "user", content: [{ type: "tool_result", tool_use_id: "...", content: "..." }] }`

### Google adapter

- Send `function_declarations` in request body
- Response includes `functionCall` parts
- Tool call ID: `part.functionCall.name` (no unique ID — use name + index)
- Tool result format: `{ functionResponse: { name: "...", response: {...} } }`

---

## 6. Error Handling

| Error | HTTP Status | Response |
|-------|------------|----------|
| Invalid `conversation_id` | 400 | `{ error: "conversation not found" }` |
| Tool call fails authority check | 200 | `{ result: { status: "denied", ... }, conversation_id }` |
| Tool call fails security check | 200 | `{ result: { status: "denied", ... }, conversation_id }` |
| Tool execution error | 200 | `{ result: { status: "failed", error: "..." }, conversation_id }` |
| Provider doesn't support tools | 200 | `{ result: { status: "completed", output: "text only" }, conversation_id }` |
| Rate limit exceeded | 429 | `{ error: "rate limit exceeded", scope: "tool.call" }` |

---

## 7. Audit Events

Every tool call generates:

- **audit_events** row: `actor_type='owner'`, `action='tool.executed'`, `resource_type='tool'`, `resource_id=tool_name`, `metadata={tool_args, result_status}`
- **cost_events** row (if model call involved)
- **security_events** row (if Guardian intervened)
