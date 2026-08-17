-- CHEF FACTORY — Gate 3 — Execution Gate Migration
-- Adds conversation tracking, tool registry for LLM tool calling.
-- Purely additive: no existing tables modified.

-- ============================================================
-- 1. TABLE: public.conversations
-- ============================================================
CREATE TABLE public.conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  title       text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, id)
);

-- Indexes
CREATE INDEX conversations_owner_id_idx ON public.conversations (owner_id);
CREATE INDEX conversations_status_idx ON public.conversations (status);
CREATE INDEX conversations_created_at_idx ON public.conversations (created_at);

-- RLS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_select_owner ON public.conversations
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY conversations_insert_owner ON public.conversations
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY conversations_update_owner ON public.conversations
  FOR UPDATE USING (owner_id = auth.uid());

-- Trigger: set_updated_at
CREATE OR REPLACE FUNCTION public.conversations_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_set_updated_at();

-- ============================================================
-- 2. TABLE: public.conversation_messages
-- ============================================================
CREATE TABLE public.conversation_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  owner_id        uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content         text NOT NULL,
  tool_calls      jsonb,
  tool_call_id    text,
  name            text,
  token_count     integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX messages_conversation_id_idx ON public.conversation_messages (conversation_id, created_at);
CREATE INDEX messages_owner_id_idx ON public.conversation_messages (owner_id);

-- RLS
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_select_owner ON public.conversation_messages
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY messages_insert_owner ON public.conversation_messages
  FOR INSERT WITH CHECK (owner_id = auth.uid());

-- Append-only: no UPDATE/DELETE policies → blocked by RLS default.

-- Append-only enforcement triggers
CREATE OR REPLACE FUNCTION public.conversation_messages_no_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'conversation_messages is append-only: UPDATE not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversation_messages_no_update
  BEFORE UPDATE ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.conversation_messages_no_update();

CREATE OR REPLACE FUNCTION public.conversation_messages_no_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'conversation_messages is append-only: DELETE not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversation_messages_no_delete
  BEFORE DELETE ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.conversation_messages_no_delete();

CREATE OR REPLACE FUNCTION public.conversation_messages_no_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'conversation_messages is append-only: TRUNCATE not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversation_messages_no_truncate
  BEFORE TRUNCATE ON public.conversation_messages
  FOR EACH STATEMENT EXECUTE FUNCTION public.conversation_messages_no_truncate();

-- Truncate protection
REVOKE TRUNCATE, TRIGGER ON public.conversation_messages FROM anon, authenticated;

-- ============================================================
-- 3. TABLE: public.tools
-- ============================================================
CREATE TABLE public.tools (
  name              text PRIMARY KEY,
  description       text NOT NULL,
  parameters        jsonb NOT NULL,
  risk_level        text NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  action_type       text NOT NULL,
  requires_approval boolean NOT NULL DEFAULT false,
  enabled           boolean NOT NULL DEFAULT true,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX tools_risk_level_idx ON public.tools (risk_level);
CREATE INDEX tools_enabled_idx ON public.tools (enabled);

-- RLS
ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY tools_select_all ON public.tools
  FOR SELECT USING (true);

-- No INSERT/UPDATE/DELETE policies for anon/authenticated — admin-managed via service_role.

-- Trigger: set_updated_at
CREATE OR REPLACE FUNCTION public.tools_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tools_set_updated_at
  BEFORE UPDATE ON public.tools
  FOR EACH ROW EXECUTE FUNCTION public.tools_set_updated_at();

-- ============================================================
-- 4. SEED: 5 initial tools
-- ============================================================
INSERT INTO public.tools (name, description, parameters, risk_level, action_type, requires_approval) VALUES
  ('create_project', 'Create a new project with name, slug, and optional description', '{"type":"object","properties":{"name":{"type":"string","description":"Project display name"},"slug":{"type":"string","description":"URL-friendly identifier"},"description":{"type":"string","description":"Project description"}},"required":["name"]}'::jsonb, 'medium', 'project_create', false),
  ('list_projects', 'List all projects owned by the current user', '{"type":"object","properties":{},"required":[]}'::jsonb, 'low', 'read', false),
  ('list_tasks', 'List tasks in a project, optionally filtered by status', '{"type":"object","properties":{"project_id":{"type":"string","description":"The ID of the project to list tasks for"},"status":{"type":"string","description":"Filter by task status","enum":["pending","in_progress","completed","failed"]}},"required":["project_id"]}'::jsonb, 'low', 'read', false),
  ('create_task', 'Create a new task in a project with title and optional description', '{"type":"object","properties":{"project_id":{"type":"string","description":"The ID of the project to add the task to"},"title":{"type":"string","description":"The title of the task"},"description":{"type":"string","description":"Task description"},"priority":{"type":"string","description":"Task priority","enum":["low","medium","high","critical"]}},"required":["project_id","title"]}'::jsonb, 'medium', 'task_create', false),
  ('update_task', 'Update a task status, title, or description', '{"type":"object","properties":{"task_id":{"type":"string","description":"The ID of the task to update"},"title":{"type":"string","description":"New title"},"status":{"type":"string","description":"New status","enum":["pending","in_progress","completed","failed"]},"priority":{"type":"string","description":"New priority","enum":["low","medium","high","critical"]},"description":{"type":"string","description":"New description"}},"required":["task_id"]}'::jsonb, 'medium', 'task_update', false)
ON CONFLICT (name) DO NOTHING;
