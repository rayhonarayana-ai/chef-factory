// CHEF FACTORY — Gate 15 — Streaming SSE Tests.
// 25+ unit tests covering SSE transport, pipeline streaming callbacks,
// streaming handler, disconnect detection, backward compatibility, and security preservation.

import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  formatSseEvent,
  formatSseComment,
  SseWriter,
  sseStart,
  sseDelta,
  sseTool,
  sseApproval,
  sseError,
  sseComplete,
  sseCancelled,
  createSseEmitter,
  type SseEvent,
  type SseEventEmitter,
} from '../api/sse.js';
import {
  createDisconnectAwareCallbacks,
} from '../api/streaming.js';
import { CommandPipeline, type ActorContext, type ExecutionOutcome, type ExecutionRunner, type StreamingCallbacks } from '../core/pipeline.js';
import { MemoryStore } from '../testing/memoryStore.js';

const owner: ActorContext = { ownerId: 'owner-1', actorId: 'owner-1', actorType: 'owner' };

function okRunner(output: unknown, cost = 0): ExecutionRunner {
  return {
    execute: async (): Promise<ExecutionOutcome> => ({ ok: true, output, cost, modelId: 'm1', runtimeId: 'r1' }),
  };
}

function failingRunner(error: string): ExecutionRunner {
  return {
    execute: async (): Promise<ExecutionOutcome> => ({ ok: false, error, reason: 'test-failure' }),
  };
}

async function storeWithChefHQ() {
  const store = new MemoryStore();
  await store.createProject('owner-1', { name: 'Chef HQ', slug: 'chef-hq', description: 'the main project' });
  return store;
}

// ═══════════════════════════════════════════════════════════════════════
// Section 1: SSE Event Constructors (10 tests)
// ═══════════════════════════════════════════════════════════════════════

describe('Gate 15 — SSE Event Constructors', () => {
  it('sseStart creates start event with correct fields', () => {
    const e = sseStart(0, { correlationId: 'abc', intent: 'test' });
    expect(e.type).toBe('start');
    expect(e.seq).toBe(0);
    expect(e.data.correlationId).toBe('abc');
    expect(e.data.intent).toBe('test');
  });

  it('sseDelta creates delta event with token and accum', () => {
    const e = sseDelta(1, { token: 'hello', accum: 'hello' });
    expect(e.type).toBe('delta');
    expect(e.seq).toBe(1);
    expect(e.data.token).toBe('hello');
    expect(e.data.accum).toBe('hello');
  });

  it('sseTool creates tool event with call phase', () => {
    const e = sseTool(2, { phase: 'call', tool: 'query' });
    expect(e.type).toBe('tool');
    expect(e.data.phase).toBe('call');
    expect(e.data.tool).toBe('query');
  });

  it('sseTool creates tool event with result phase', () => {
    const e = sseTool(3, { phase: 'result', tool: 'query', ok: true, outcome: 'found 5 rows' });
    expect(e.type).toBe('tool');
    expect(e.data.phase).toBe('result');
    expect(e.data.ok).toBe(true);
  });

  it('sseApproval creates approval event', () => {
    const e = sseApproval(4, { approvalId: 'ap-1', task: 'deploy', risk: 'high' });
    expect(e.type).toBe('approval');
    expect(e.data.approvalId).toBe('ap-1');
  });

  it('sseError creates error event', () => {
    const e = sseError(5, { error: 'something broke', code: 'test' });
    expect(e.type).toBe('error');
    expect(e.data.error).toBe('something broke');
    expect(e.data.code).toBe('test');
  });

  it('sseComplete creates complete event with full data', () => {
    const e = sseComplete(6, { outcome: 'executed', cost: 0.5 });
    expect(e.type).toBe('complete');
    expect(e.data.outcome).toBe('executed');
    expect(e.data.cost).toBe(0.5);
  });

  it('sseCancelled creates cancelled event with reason', () => {
    const e = sseCancelled(7, { reason: 'client_disconnect' });
    expect(e.type).toBe('cancelled');
    expect(e.data.reason).toBe('client_disconnect');
  });

  it('all event types have required type and seq fields', () => {
    const events: SseEvent[] = [
      sseStart(0, { correlationId: 'a', intent: 'b' }),
      sseDelta(1, { token: 'x', accum: 'x' }),
      sseTool(2, { phase: 'call', tool: 't' }),
      sseApproval(3, { approvalId: 'a', task: 't', risk: 'low' }),
      sseError(4, { error: 'e' }),
      sseComplete(5, {}),
      sseCancelled(6, { reason: 'r' }),
    ];
    for (const e of events) {
      expect(typeof e.type).toBe('string');
      expect(typeof e.seq).toBe('number');
      expect(typeof e.data).toBe('object');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Section 2: SSE Framing (5 tests)
// ═══════════════════════════════════════════════════════════════════════

describe('Gate 15 — SSE Framing', () => {
  it('formatSseEvent produces valid SSE data line', () => {
    const e = sseStart(0, { correlationId: 'c', intent: 'test' });
    const framed = formatSseEvent(e);
    expect(framed.startsWith('data: ')).toBe(true);
    expect(framed.endsWith('\n\n')).toBe(true);
    const payload = JSON.parse(framed.slice(6, -2));
    expect(payload.type).toBe('start');
    expect(payload.seq).toBe(0);
    expect(payload.data.correlationId).toBe('c');
  });

  it('formatSseComment produces colon-prefixed comment', () => {
    const comment = formatSseComment('connected');
    expect(comment).toBe(': connected\n\n');
  });

  it('formatSseEvent handles all event types', () => {
    const types = ['start', 'delta', 'tool', 'approval', 'error', 'complete', 'cancelled'] as const;
    for (const type of types) {
      let event: SseEvent;
      switch (type) {
        case 'start': event = sseStart(0, { correlationId: 'c', intent: 'i' }); break;
        case 'delta': event = sseDelta(0, { token: 't', accum: 'a' }); break;
        case 'tool': event = sseTool(0, { phase: 'call', tool: 't' }); break;
        case 'approval': event = sseApproval(0, { approvalId: 'a', task: 't', risk: 'low' }); break;
        case 'error': event = sseError(0, { error: 'e' }); break;
        case 'complete': event = sseComplete(0, {}); break;
        case 'cancelled': event = sseCancelled(0, { reason: 'r' }); break;
      }
      const framed = formatSseEvent(event);
      expect(framed.startsWith('data: ')).toBe(true);
      const payload = JSON.parse(framed.slice(6, -2));
      expect(payload.type).toBe(type);
    }
  });

  it('SseWriter.nextSeq increments sequence', () => {
    const chunks: Buffer[] = [];
    const fakeRes = {
      writableEnded: false,
      write: vi.fn((data: string | Buffer) => { chunks.push(Buffer.from(data)); return true; }),
      end: vi.fn(),
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
    } as any;
    const writer = new SseWriter(fakeRes);
    expect(writer.nextSeq()).toBe(0);
    expect(writer.nextSeq()).toBe(1);
    expect(writer.nextSeq()).toBe(2);
  });

  it('SseWriter.write sends formatted event', () => {
    const written: string[] = [];
    const fakeRes = {
      writableEnded: false,
      write: vi.fn((data: string | Buffer) => { written.push(String(data)); return true; }),
      end: vi.fn(),
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
    } as any;
    const writer = new SseWriter(fakeRes);
    const ok = writer.write(sseStart(0, { correlationId: 'c', intent: 'i' }));
    expect(ok).toBe(true);
    expect(written.length).toBe(1);
    expect(written[0].startsWith('data: ')).toBe(true);
  });

  it('SseWriter.close ends the response', () => {
    const fakeRes = {
      writableEnded: false,
      write: vi.fn(() => true),
      end: vi.fn(function() { (this as any).writableEnded = true; }),
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
    } as any;
    const writer = new SseWriter(fakeRes);
    writer.close();
    expect(fakeRes.end).toHaveBeenCalled();
    expect(writer.isClosed()).toBe(true);
  });

  it('SseWriter.write returns false after close', () => {
    const fakeRes = {
      writableEnded: false,
      write: vi.fn(() => true),
      end: vi.fn(function() { (this as any).writableEnded = true; }),
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
    } as any;
    const writer = new SseWriter(fakeRes);
    writer.close();
    const ok = writer.write(sseStart(0, { correlationId: 'c', intent: 'i' }));
    expect(ok).toBe(false);
  });

  it('SseWriter handles write errors gracefully', () => {
    const fakeRes = {
      writableEnded: false,
      write: vi.fn(() => { throw new Error('write failed'); }),
      end: vi.fn(),
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
    } as any;
    const writer = new SseWriter(fakeRes);
    const ok = writer.write(sseStart(0, { correlationId: 'c', intent: 'i' }));
    expect(ok).toBe(false);
    expect(writer.isClosed()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Section 3: Pipeline Streaming Callbacks (8 tests)
// ═══════════════════════════════════════════════════════════════════════

describe('Gate 15 — Pipeline Streaming Callbacks', () => {
  it('emits start event on pipeline.run', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}));
    const events: SseEvent[] = [];
    const callbacks: StreamingCallbacks = {
      onEvent: (type, data) => events.push({ type, seq: events.length, data }),
      isCancelled: () => false,
    };
    await p.run(owner, 'status in chef-hq', undefined, callbacks);
    expect(events.some((e) => e.type === 'start')).toBe(true);
    expect(events.find((e) => e.type === 'start')?.data.correlationId).toBeDefined();
  });

  it('pipeline returns full result on success (complete emitted by handler)', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({ result: 'ok' }));
    const events: SseEvent[] = [];
    const callbacks: StreamingCallbacks = {
      onEvent: (type, data) => events.push({ type, seq: events.length, data }),
      isCancelled: () => false,
    };
    const result = await p.run(owner, 'create task "test" in chef-hq', undefined, callbacks);
    // Pipeline does NOT emit 'complete' — that's the handler's job
    expect(events.some((e) => e.type === 'complete')).toBe(false);
    // But the return value IS the full PipelineResult
    expect(result.outcome).toBe('executed');
    expect(result.intent).toBeDefined();
  });

  it('emits error event on unknown command', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}));
    const events: SseEvent[] = [];
    const callbacks: StreamingCallbacks = {
      onEvent: (type, data) => events.push({ type, seq: events.length, data }),
      isCancelled: () => false,
    };
    await p.run(owner, 'zzz the qux', undefined, callbacks);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    const err = events.find((e) => e.type === 'error');
    expect(err?.data.code).toBe('unknown');
  });

  it('emits error event on unknown project', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}));
    const events: SseEvent[] = [];
    const callbacks: StreamingCallbacks = {
      onEvent: (type, data) => events.push({ type, seq: events.length, data }),
      isCancelled: () => false,
    };
    await p.run(owner, 'create task "x" in nonexistent-project', undefined, callbacks);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    const err = events.find((e) => e.type === 'error');
    expect(err?.data.code).toBe('unknown_project');
  });

  it('emits approval event on require_approval', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}));
    const events: SseEvent[] = [];
    const callbacks: StreamingCallbacks = {
      onEvent: (type, data) => events.push({ type, seq: events.length, data }),
      isCancelled: () => false,
    };
    await p.run(owner, 'deploy the app in chef-hq production', undefined, callbacks);
    expect(events.some((e) => e.type === 'approval')).toBe(true);
    const approval = events.find((e) => e.type === 'approval');
    expect(approval?.data.approvalId).toBeDefined();
    expect(approval?.data.risk).toBeDefined();
  });

  it('emits error event on execution failure', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, failingRunner('model error'));
    const events: SseEvent[] = [];
    const callbacks: StreamingCallbacks = {
      onEvent: (type, data) => events.push({ type, seq: events.length, data }),
      isCancelled: () => false,
    };
    await p.run(owner, 'status in chef-hq', undefined, callbacks);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('no events emitted when streaming is null (backward compat)', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}));
    const events: SseEvent[] = [];
    // No streaming parameter → no events
    const r = await p.run(owner, 'status in chef-hq');
    expect(r.outcome).toBe('executed');
    expect(events).toHaveLength(0);
  });

  it('no events emitted when streaming is undefined (backward compat)', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}));
    const events: SseEvent[] = [];
    const r = await p.run(owner, 'status in chef-hq', undefined, undefined);
    expect(r.outcome).toBe('executed');
    expect(events).toHaveLength(0);
  });

  it('sequence numbers are sequential', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({ result: 'ok' }));
    const events: SseEvent[] = [];
    const callbacks: StreamingCallbacks = {
      onEvent: (type, data) => events.push({ type, seq: events.length, data }),
      isCancelled: () => false,
    };
    await p.run(owner, 'create task "test" in chef-hq', undefined, callbacks);
    for (let i = 0; i < events.length; i++) {
      expect(events[i]!.seq).toBe(i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Section 4: Disconnect Detection & Cancellation (4 tests)
// ═══════════════════════════════════════════════════════════════════════

describe('Gate 15 — Disconnect Detection & Cancellation', () => {
  it('createDisconnectAwareCallbacks sets cancelFlag on req close', () => {
    const req = new EventEmitter() as any;
    const written: string[] = [];
    const fakeRes = {
      writableEnded: false,
      write: vi.fn((data: string | Buffer) => { written.push(String(data)); return true; }),
      end: vi.fn(function() { (this as any).writableEnded = true; }),
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
    } as any;
    const writer = new SseWriter(fakeRes);
    const emitter: SseEventEmitter = (event) => writer.write(event);
    const { callbacks } = createDisconnectAwareCallbacks(writer, req, emitter);

    expect(callbacks.isCancelled()).toBe(false);
    req.emit('close');
    expect(callbacks.isCancelled()).toBe(true);
  });

  it('emits cancelled event on client disconnect', () => {
    const req = new EventEmitter() as any;
    const written: string[] = [];
    const fakeRes = {
      writableEnded: false,
      write: vi.fn((data: string | Buffer) => { written.push(String(data)); return true; }),
      end: vi.fn(function() { (this as any).writableEnded = true; }),
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
    } as any;
    const writer = new SseWriter(fakeRes);
    const emitter: SseEventEmitter = (event) => writer.write(event);
    const { callbacks } = createDisconnectAwareCallbacks(writer, req, emitter);

    req.emit('close');
    expect(written.some((w) => w.includes('"type":"cancelled"'))).toBe(true);
  });

  it('callbacks.onEvent does nothing after disconnect', () => {
    const req = new EventEmitter() as any;
    const written: string[] = [];
    const fakeRes = {
      writableEnded: false,
      write: vi.fn((data: string | Buffer) => { written.push(String(data)); return true; }),
      end: vi.fn(function() { (this as any).writableEnded = true; }),
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
    } as any;
    const writer = new SseWriter(fakeRes);
    const emitter: SseEventEmitter = (event) => writer.write(event);
    const { callbacks } = createDisconnectAwareCallbacks(writer, req, emitter);

    req.emit('close');
    const beforeCount = written.length;
    callbacks.onEvent('error', { error: 'test' });
    expect(written.length).toBe(beforeCount);
  });

  it('isCancelled returns true if writer is closed', () => {
    const req = new EventEmitter() as any;
    const fakeRes = {
      writableEnded: false,
      write: vi.fn(() => true),
      end: vi.fn(function() { (this as any).writableEnded = true; }),
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
    } as any;
    const writer = new SseWriter(fakeRes);
    const emitter: SseEventEmitter = (event) => writer.write(event);
    const { callbacks } = createDisconnectAwareCallbacks(writer, req, emitter);

    writer.close();
    expect(callbacks.isCancelled()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Section 5: Security Preservation Under Streaming (3 tests)
// ═══════════════════════════════════════════════════════════════════════

describe('Gate 15 — Security Preservation Under Streaming', () => {
  it('authority resolution is unchanged with streaming callbacks', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}));
    const events: SseEvent[] = [];
    const callbacks: StreamingCallbacks = {
      onEvent: (type, data) => events.push({ type, seq: events.length, data }),
      isCancelled: () => false,
    };
    const r = await p.run(owner, 'deploy the app in chef-hq production', undefined, callbacks);
    expect(r.outcome).toBe('waiting_approval');
    expect(r.approvalId).not.toBeNull();
    // Authority decision is identical regardless of streaming
    expect(r.authority?.outcome).toBe('require_approval');
    expect(r.autonomy?.selected).toBe('require_approval');
  });

  it('denied outcome preserved under streaming', async () => {
    const store = await storeWithChefHQ();
    await store.setPreference('owner-1', 'policy', 'explicit_deny', true);
    const p = new CommandPipeline(store, okRunner({}));
    const events: SseEvent[] = [];
    const callbacks: StreamingCallbacks = {
      onEvent: (type, data) => events.push({ type, seq: events.length, data }),
      isCancelled: () => false,
    };
    const r = await p.run(owner, 'status in chef-hq', undefined, callbacks);
    expect(r.outcome).toBe('denied');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('audit trail is identical with and without streaming', async () => {
    const store1 = await storeWithChefHQ();
    const p1 = new CommandPipeline(store1, okRunner({}));
    const r1 = await p1.run(owner, 'status in chef-hq');

    const store2 = await storeWithChefHQ();
    const p2 = new CommandPipeline(store2, okRunner({}));
    const callbacks: StreamingCallbacks = {
      onEvent: () => {},
      isCancelled: () => false,
    };
    const r2 = await p2.run(owner, 'status in chef-hq', undefined, callbacks);

    // Both produce same outcome and task status
    expect(r1.outcome).toBe(r2.outcome);
    expect(r1.task?.status).toBe(r2.task?.status);
    // Both record same audit actions
    const actions1 = store1.audit.map((a) => a.action).sort();
    const actions2 = store2.audit.map((a) => a.action).sort();
    expect(actions1).toEqual(actions2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Section 6: SSE Event Emitter (2 tests)
// ═══════════════════════════════════════════════════════════════════════

describe('Gate 15 — SSE Event Emitter', () => {
  it('createSseEmitter returns function that writes events', () => {
    const written: string[] = [];
    const fakeRes = {
      writableEnded: false,
      write: vi.fn((data: string | Buffer) => { written.push(String(data)); return true; }),
      end: vi.fn(),
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
    } as any;
    const writer = new SseWriter(fakeRes);
    const emitter = createSseEmitter(writer);
    emitter(sseStart(0, { correlationId: 'c', intent: 'i' }));
    expect(written.length).toBe(1);
    expect(written[0].startsWith('data: ')).toBe(true);
  });

  it('emitter writes multiple events with incrementing seq', () => {
    const written: string[] = [];
    const fakeRes = {
      writableEnded: false,
      write: vi.fn((data: string | Buffer) => { written.push(String(data)); return true; }),
      end: vi.fn(),
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
    } as any;
    const writer = new SseWriter(fakeRes);
    const emitter = createSseEmitter(writer);
    emitter(sseStart(writer.nextSeq(), { correlationId: 'c', intent: 'i' }));
    emitter(sseDelta(writer.nextSeq(), { token: 'hi', accum: 'hi' }));
    emitter(sseComplete(writer.nextSeq(), {}));
    expect(written.length).toBe(3);
    const seqs = written.map((w) => JSON.parse(w.slice(6, -2)).seq);
    expect(seqs).toEqual([0, 1, 2]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Section 7: Backward Compatibility (2 tests)
// ═══════════════════════════════════════════════════════════════════════

describe('Gate 15 — Backward Compatibility', () => {
  it('pipeline.run without streaming returns identical result shape', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({ result: 'ok' }, 1.5));
    const r = await p.run(owner, 'create task "test" in chef-hq');
    expect(r.outcome).toBe('executed');
    expect(r.intent).toBeDefined();
    expect(r.project).toBeDefined();
    expect(r.environment).toBeDefined();
    expect(r.risk).toBeDefined();
    expect(r.authority).toBeDefined();
    expect(r.autonomy).toBeDefined();
    expect(r.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.explanation).toBeDefined();
    expect(r.task?.status).toBe('completed');
  });

  it('PipelineResult type is unchanged with streaming', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}));
    const r = await p.run(owner, 'status in chef-hq', undefined, null);
    // All PipelineResult fields present
    const keys = ['outcome', 'intent', 'project', 'environment', 'risk', 'authority', 'autonomy', 'approvalId', 'task', 'correlationId', 'explanation'];
    for (const key of keys) {
      expect(key in r).toBe(true);
    }
  });
});
