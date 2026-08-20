// CHEF FACTORY — Gate 15 — SSE Transport Layer.
// Server-Sent Events framing, event vocabulary, and write utilities.
// Backward-compatible: stream=false or omitted → JSON response (no SSE).

import type { ServerResponse } from 'node:http';

// ─── Event Vocabulary ───────────────────────────────────────────────

export type SseEventType =
  | 'start'       // Stream began, pipeline starting
  | 'delta'       // Incremental text token from LLM
  | 'tool'        // Tool call initiated / completed
  | 'approval'    // Approval required, stream paused
  | 'error'       // Error occurred during processing
  | 'complete'    // Pipeline finished, final result
  | 'cancelled';  // Client disconnected, stream terminated

export interface SseEvent {
  type: SseEventType;
  seq: number;
  data: Record<string, unknown>;
}

// ─── Event Constructors ─────────────────────────────────────────────

export function sseStart(seq: number, data: { correlationId: string; intent: string; project?: string | null }): SseEvent {
  return { type: 'start', seq, data };
}

export function sseDelta(seq: number, data: { token: string; accum: string }): SseEvent {
  return { type: 'delta', seq, data };
}

export function sseTool(seq: number, data: { phase: 'call' | 'result'; tool: string; action?: string; ok?: boolean; outcome?: string }): SseEvent {
  return { type: 'tool', seq, data };
}

export function sseApproval(seq: number, data: { approvalId: string; task: string; risk: string }): SseEvent {
  return { type: 'approval', seq, data };
}

export function sseError(seq: number, data: { error: string; code?: string }): SseEvent {
  return { type: 'error', seq, data };
}

export function sseComplete(seq: number, data: Record<string, unknown>): SseEvent {
  return { type: 'complete', seq, data };
}

export function sseCancelled(seq: number, data: { reason: string }): SseEvent {
  return { type: 'cancelled', seq, data };
}

// ─── Framing ────────────────────────────────────────────────────────

export function formatSseEvent(event: SseEvent): string {
  const payload = JSON.stringify({ type: event.type, seq: event.seq, data: event.data });
  return `data: ${payload}\n\n`;
}

export function formatSseComment(comment: string): string {
  return `: ${comment}\n\n`;
}

// ─── Writer ─────────────────────────────────────────────────────────

export class SseWriter {
  private seq = 0;
  private closed = false;

  constructor(private readonly res: ServerResponse) {}

  nextSeq(): number {
    return this.seq++;
  }

  isClosed(): boolean {
    return this.closed || this.res.writableEnded;
  }

  write(event: SseEvent): boolean {
    if (this.closed || this.res.writableEnded) return false;
    try {
      this.res.write(formatSseEvent(event));
      return true;
    } catch {
      this.closed = true;
      return false;
    }
  }

  writeComment(comment: string): boolean {
    if (this.closed || this.res.writableEnded) return false;
    try {
      this.res.write(formatSseComment(comment));
      return true;
    } catch {
      this.closed = true;
      return false;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (!this.res.writableEnded) {
      try {
        this.res.end();
      } catch { /* ignore close errors */ }
    }
  }
}

// ─── SSE Response Setup ─────────────────────────────────────────────

export function initSseResponse(res: ServerResponse): SseWriter {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  // Send initial comment to establish connection
  res.write(': connected\n\n');
  return new SseWriter(res);
}

// ─── Event Emitter (callback interface for pipeline) ────────────────

export type SseEventEmitter = (event: SseEvent) => void;

export function createSseEmitter(writer: SseWriter): SseEventEmitter {
  return (event: SseEvent) => {
    writer.write(event);
  };
}
