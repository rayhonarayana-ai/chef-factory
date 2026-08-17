# Gate 3 Database Plan

READ-ONLY document. No SQL execution.

## Migration File

New migration: `supabase/migrations/20260819000000_gate3_execution.sql`

## New Tables

### Table: public.conversations

**Purpose:** Track multi-turn conversation sessions

```sql
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  title text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, id)
);
```

- **id:** Unique conversation identifier.
- **owner_id:** FK to `public.owners`. Cascades delete. Scoped to owner.
- **project_id:** FK to `public.projects`. Nullable. Set null on project delete.
- **title:** Auto-generated from first message if null.
- **status:** `active` or `archived`. Defaults to `active`.
- **created_at / updated_at:** Timestamps with `set_updated_at()` trigger.
- **UNIQUE(owner_id, id):** Owner scoping constraint.

**RLS:** Owner-scoped SELECT / INSERT / UPDATE (same pattern as projects).

**Indexes:** `owner_id`, `status`, `created_at`.

**Append-only:** No. Conversations can be updated or archived.

**Triggers:** `conversations_set_updated_at` — BEFORE UPDATE → `set_updated_at()`.

---

### Table: public.conversation_messages

**Purpose:** Store individual messages in a conversation

```sql
CREATE TABLE public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content text NOT NULL,
  tool_calls jsonb,
  tool_call_id text,
  name text,
  token_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- **id:** Unique message identifier.
- **conversation_id:** FK to `public.conversations`. Cascades delete.
- **owner_id:** FK to `public.owners`. Cascades delete. Enables RLS scoping.
- **role:** Message role — `user`, `assistant`, `tool`, or `system`.
- **content:** Message text content.
- **tool_calls:** JSONB. Stores LLM tool call responses. Nullable.
- **tool_call_id:** Text. For tool result messages linking back to the call. Nullable.
- **name:** Text. Tool name for tool messages. Nullable.
- **token_count:** Integer. For cost estimation. Nullable.
- **created_at:** Timestamp.

**RLS:** Owner-scoped SELECT / INSERT only. No UPDATE / DELETE policies (append-only).

**Indexes:** `(conversation_id, created_at)` composite, `owner_id`.

**Append-only:** YES. INSERT + SELECT only. UPDATE and DELETE are blocked by triggers and absence of policies.

**Triggers:**
- `conversation_messages_no_update` — BEFORE UPDATE → block (append-only enforcement)
- `conversation_messages_no_delete` — BEFORE DELETE → block (append-only enforcement)
- `conversation_messages_no_truncate` — BEFORE TRUNCATE → block

**Truncate protection:** Yes. REVOKE TRUNCATE and TRIGGER from `anon`, `authenticated`.

---

### Table: public.tools

**Purpose:** Registry of available tools for LLM tool calling

```sql
CREATE TABLE public.tools (
  name text PRIMARY KEY,
  description text NOT NULL,
  parameters jsonb NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  action_type text NOT NULL,
  requires_approval boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- **name:** Tool name. Primary key.
- **description:** Human-readable description.
- **parameters:** JSON Schema for tool parameters.
- **risk_level:** `low`, `medium`, `high`, or `critical`.
- **action_type:** Category of action (e.g. `project_create`, `read`, `task_create`, `task_update`).
- **requires_approval:** Whether tool execution requires user approval.
- **enabled:** Whether the tool is currently active.
- **version:** Schema version for tool evolution.
- **created_at / updated_at:** Timestamps with `set_updated_at()` trigger.

**RLS:** SELECT for all authenticated users (tool names are not secret). INSERT / UPDATE / DELETE restricted to `service_role` only (admin-managed).

**Indexes:** `risk_level`, `enabled`.

**Append-only:** No. Tools can be updated.

**Triggers:** `tools_set_updated_at` — BEFORE UPDATE → `set_updated_at()`.

**Seeded:** 5 tools (see Seed Data below).

---

## Unchanged Tables

ALL existing 23 tables remain **UNCHANGED**. No columns added, no columns removed, no constraints modified.

## RLS Policies

### conversations

| Policy | Operation | Condition |
|--------|-----------|-----------|
| conversations_select_owner | SELECT | `owner_id = auth.uid()` |
| conversations_insert_owner | INSERT | `owner_id = auth.uid()` |
| conversations_update_owner | UPDATE | `owner_id = auth.uid()` |

### conversation_messages

| Policy | Operation | Condition |
|--------|-----------|-----------|
| messages_select_owner | SELECT | `owner_id = auth.uid()` |
| messages_insert_owner | INSERT | `owner_id = auth.uid()` |

No UPDATE or DELETE policies — append-only.

### tools

| Policy | Operation | Condition |
|--------|-----------|-----------|
| tools_select_all | SELECT | `true` |

No INSERT / UPDATE / DELETE policies for `anon` or `authenticated` — admin-managed via `service_role`.

## Indexes

| Table | Index | Columns | Type |
|-------|-------|---------|------|
| conversations | conversations_owner_id_idx | owner_id | btree |
| conversations | conversations_status_idx | status | btree |
| conversations | conversations_created_at_idx | created_at | btree |
| conversation_messages | messages_conversation_id_idx | conversation_id, created_at | btree |
| conversation_messages | messages_owner_id_idx | owner_id | btree |
| tools | tools_risk_level_idx | risk_level | btree |
| tools | tools_enabled_idx | enabled | btree |

## Triggers

| Trigger | Table | Event | Action |
|---------|-------|-------|--------|
| conversations_set_updated_at | conversations | BEFORE UPDATE | `set_updated_at()` |
| tools_set_updated_at | tools | BEFORE UPDATE | `set_updated_at()` |
| conversation_messages_no_update | conversation_messages | BEFORE UPDATE | block (append-only) |
| conversation_messages_no_delete | conversation_messages | BEFORE DELETE | block (append-only) |
| conversation_messages_no_truncate | conversation_messages | BEFORE TRUNCATE | block |

## REVOKE Statements

```sql
REVOKE TRUNCATE, TRIGGER ON public.conversation_messages FROM anon, authenticated;
```

## Seed Data (tools)

5 tools seeded:

| name | description | risk_level | action_type |
|------|-------------|------------|-------------|
| create_project | Create a new project with name, slug, and optional description | medium | project_create |
| list_projects | List all projects owned by the current user | low | read |
| list_tasks | List tasks in a project, optionally filtered by status | low | read |
| create_task | Create a new task in a project with title and optional description | medium | task_create |
| update_task | Update a task's status, title, or description | medium | task_update |

## Aggregate Counts After Gate 3

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Tables | 23 | 26 | +3 |
| Indexes | 59 | 66 | +7 |
| RLS Policies | 80 | 86 | +6 |
| Triggers | 28 | 33 | +5 |
| Functions | 11 | 11 | 0 |
| REVOKEs | 7 | 8 | +1 |

## Migration Strategy

1. Write migration file: `20260819000000_gate3_execution.sql`
2. Apply via `supabase db push` (or `psql`)
3. Verify table creation (`conversations`, `conversation_messages`, `tools`)
4. Verify RLS policies (3 + 2 + 1 = 6 new policies)
5. Verify seed data (5 tools inserted)
6. Run regression tests
7. No existing data affected (additive only)
