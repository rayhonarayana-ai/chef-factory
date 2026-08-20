// CHEF FACTORY — Gate 15 — Streaming Chat Handler.
// Wraps the existing pipeline with SSE event emission.
// Backward-compatible: stream=false/omitted → JSON path (via handlers.ts).

import type { IncomingMessage } from 'node:http';
import type { ServerResponse } from 'node:http';
import type { Store } from '../core/ports.js';
import type { CommandPipeline } from '../core/pipeline.js';
import type { StreamingCallbacks } from '../core/pipeline.js';
import type { SessionOwner } from './auth.js';
import { ConversationService } from '../core/conversation.js';
import { initSseResponse, type SseWriter, type SseEvent, type SseEventEmitter } from './sse.js';

// ─── Streaming Chat Request ─────────────────────────────────────────

export interface StreamingChatRequest {
  command: string;
  conversationId: string | null;
  owner: SessionOwner;
}

// ─── Disconnect-Aware Wrapper ───────────────────────────────────────

export function createDisconnectAwareCallbacks(
  writer: SseWriter,
  req: IncomingMessage,
  emitter: SseEventEmitter,
): { callbacks: StreamingCallbacks; cancelFlag: { cancelled: boolean } } {
  const cancelFlag = { cancelled: false };

  req.on('close', () => {
    cancelFlag.cancelled = true;
    if (!writer.isClosed()) {
      emitter({ type: 'cancelled', seq: writer.nextSeq(), data: { reason: 'client_disconnect' } });
      writer.close();
    }
  });

  const callbacks: StreamingCallbacks = {
    onEvent(type, data) {
      if (writer.isClosed() || cancelFlag.cancelled) return;
      emitter({ type, seq: writer.nextSeq(), data });
    },
    isCancelled() {
      return cancelFlag.cancelled || writer.isClosed();
    },
  };

  return { callbacks, cancelFlag };
}

// ─── Streaming Chat Handler ─────────────────────────────────────────

export async function handleStreamingChat(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  pipeline: CommandPipeline,
  owner: SessionOwner,
  command: string,
  conversationId: string | null,
): Promise<void> {
  const conversations = new ConversationService(store);
  const writer = initSseResponse(res);
  const emitter: SseEventEmitter = (event: SseEvent) => writer.write(event);
  const { callbacks } = createDisconnectAwareCallbacks(writer, req, emitter);

  // Resolve or create conversation (same logic as handlers.ts)
  let convId = conversationId;
  if (convId) {
    const existing = await conversations.getConversation(owner.id, convId);
    if (!existing) {
      const conv = await conversations.createConversation({ ownerId: owner.id });
      convId = conv.id;
    }
  } else {
    const conv = await conversations.createConversation({ ownerId: owner.id });
    convId = conv.id;
  }

  // Append user message
  await conversations.appendMessage({
    conversationId: convId,
    ownerId: owner.id,
    role: 'user',
    content: command,
  });

  // Load conversation history
  const historyMessages = await conversations.loadHistory(owner.id, convId, 20);
  const conversationHistory = historyMessages.map((m) => ({
    role: m.role as 'system' | 'user' | 'assistant' | 'tool',
    content: m.content,
    ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
    ...(m.name ? { name: m.name } : {}),
  }));

  // Check for cancellation before starting pipeline
  if (callbacks.isCancelled()) {
    writer.close();
    return;
  }

  // Run pipeline with streaming callbacks
  const actorCtx = { ownerId: owner.id, actorId: owner.id, actorType: 'owner' as const };
  let result;
  try {
    result = await pipeline.run(actorCtx, command, conversationHistory, callbacks);
  } catch (e) {
    if (!writer.isClosed()) {
      emitter({ type: 'error', seq: writer.nextSeq(), data: { error: String(e), code: 'pipeline_error' } });
      writer.close();
    }
    return;
  }

  // Check for cancellation after pipeline completes
  if (callbacks.isCancelled()) {
    writer.close();
    return;
  }

  // Gate 19 (OD32): Append tool results to conversation
  if (result.toolMessages && result.toolMessages.length > 0) {
    for (const tm of result.toolMessages) {
      await conversations.appendMessage({
        conversationId: convId,
        ownerId: owner.id,
        role: 'tool',
        content: tm.content,
        toolCallId: tm.tool_call_id,
        name: tm.name,
      });
    }
  }

  // Append assistant response to conversation
  const responseText = typeof result.explanation?.decision === 'string' ? result.explanation.decision : JSON.stringify(result);
  await conversations.appendMessage({
    conversationId: convId,
    ownerId: owner.id,
    role: 'assistant',
    content: responseText,
  });

  // Send final complete event with full result + conversation_id
  // The 'complete' event is the handler's responsibility — the pipeline emits intermediate
  // events (start, error, approval) only. This is the authoritative final event.
  if (!writer.isClosed()) {
    emitter({ type: 'complete', seq: writer.nextSeq(), data: { ...result, conversation_id: convId } });
    writer.close();
  }
}
