// CHEF FACTORY — Gate 3 — Conversation Context Service.
// Manages multi-turn conversation persistence via Store port.
// Conversations are owner-scoped. Messages are append-only.

import type { Store } from './ports.js';

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
  constructor(private readonly store: Store) {}

  async createConversation(input: CreateConversationInput): Promise<ConversationRecord> {
    return this.store.createConversation(input.ownerId, {
      projectId: input.projectId,
      title: input.title,
    });
  }

  async getConversation(ownerId: string, conversationId: string): Promise<ConversationRecord | null> {
    return this.store.getConversation(ownerId, conversationId);
  }

  async listConversations(ownerId: string, opts?: { status?: string; limit?: number; offset?: number }): Promise<ConversationRecord[]> {
    return this.store.listConversations(ownerId, opts);
  }

  async archiveConversation(ownerId: string, conversationId: string): Promise<boolean> {
    return this.store.archiveConversation(ownerId, conversationId);
  }

  async appendMessage(input: AppendMessageInput): Promise<ConversationMessage> {
    return this.store.appendMessage(input.ownerId, {
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      toolCalls: input.toolCalls,
      toolCallId: input.toolCallId,
      name: input.name,
      tokenCount: input.tokenCount,
    });
  }

  async loadHistory(ownerId: string, conversationId: string, limit: number = MAX_HISTORY): Promise<ConversationMessage[]> {
    return this.store.loadHistory(ownerId, conversationId, limit);
  }
}
