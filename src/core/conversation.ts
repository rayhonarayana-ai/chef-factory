// CHEF FACTORY — Gate 3 — Conversation Context Service.
// Manages multi-turn conversation persistence via Supabase.
// Conversations are owner-scoped. Messages are append-only.

import { getPool } from '../db/pool.js';

export interface ConversationRecord {
  id: string;
  ownerId: string;
  projectId: string | null;
  title: string | null;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  ownerId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolCalls: unknown;
  toolCallId: string | null;
  name: string | null;
  tokenCount: number | null;
  createdAt: string;
}

export interface CreateConversationInput {
  ownerId: string;
  projectId?: string | null;
  title?: string | null;
}

export interface AppendMessageInput {
  conversationId: string;
  ownerId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolCalls?: unknown;
  toolCallId?: string | null;
  name?: string | null;
  tokenCount?: number | null;
}

const MAX_HISTORY = 20;

export class ConversationService {
  async createConversation(input: CreateConversationInput): Promise<ConversationRecord> {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO public.conversations (owner_id, project_id, title)
       VALUES ($1, $2, $3)
       RETURNING id, owner_id, project_id, title, status, created_at, updated_at`,
      [input.ownerId, input.projectId ?? null, input.title ?? null],
    );
    const row = res.rows[0];
    return {
      id: row.id,
      ownerId: row.owner_id,
      projectId: row.project_id,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getConversation(ownerId: string, conversationId: string): Promise<ConversationRecord | null> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, owner_id, project_id, title, status, created_at, updated_at
       FROM public.conversations
       WHERE id = $1 AND owner_id = $2`,
      [conversationId, ownerId],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      ownerId: row.owner_id,
      projectId: row.project_id,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listConversations(ownerId: string, opts?: { status?: string; limit?: number; offset?: number }): Promise<ConversationRecord[]> {
    const pool = getPool();
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const statusFilter = opts?.status ?? 'active';
    const res = await pool.query(
      `SELECT id, owner_id, project_id, title, status, created_at, updated_at
       FROM public.conversations
       WHERE owner_id = $1 AND status = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [ownerId, statusFilter, limit, offset],
    );
    return res.rows.map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      projectId: row.project_id,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async archiveConversation(ownerId: string, conversationId: string): Promise<boolean> {
    const pool = getPool();
    const res = await pool.query(
      `UPDATE public.conversations SET status = 'archived'
       WHERE id = $1 AND owner_id = $2`,
      [conversationId, ownerId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async appendMessage(input: AppendMessageInput): Promise<ConversationMessage> {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO public.conversation_messages
       (conversation_id, owner_id, role, content, tool_calls, tool_call_id, name, token_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, conversation_id, owner_id, role, content, tool_calls, tool_call_id, name, token_count, created_at`,
      [
        input.conversationId,
        input.ownerId,
        input.role,
        input.content,
        input.toolCalls ? JSON.stringify(input.toolCalls) : null,
        input.toolCallId ?? null,
        input.name ?? null,
        input.tokenCount ?? null,
      ],
    );
    const row = res.rows[0];
    return {
      id: row.id,
      conversationId: row.conversation_id,
      ownerId: row.owner_id,
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls,
      toolCallId: row.tool_call_id,
      name: row.name,
      tokenCount: row.token_count,
      createdAt: row.created_at,
    };
  }

  async loadHistory(ownerId: string, conversationId: string, limit: number = MAX_HISTORY): Promise<ConversationMessage[]> {
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, conversation_id, owner_id, role, content, tool_calls, tool_call_id, name, token_count, created_at
       FROM public.conversation_messages
       WHERE conversation_id = $1 AND owner_id = $2
       ORDER BY created_at ASC`,
      [conversationId, ownerId],
    );
    const all = res.rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      ownerId: row.owner_id,
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls,
      toolCallId: row.tool_call_id,
      name: row.name,
      tokenCount: row.token_count,
      createdAt: row.created_at,
    }));
    // Return last N messages (windowed)
    return all.slice(-limit);
  }
}
