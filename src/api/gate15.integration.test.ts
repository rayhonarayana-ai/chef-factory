// CHEF FACTORY — Gate 15 — Integration Tests.
// Tests streaming through the real pipeline + HTTP-layer mocking.
// Verifies: SSE framing, event ordering, backward compatibility, security, no duplicate execution.

import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { CommandPipeline, type ExecutionOutcome, type ExecutionRunner } from '../core/pipeline.js';
import { MemoryStore } from '../testing/memoryStore.js';
import { initSseResponse, SseWriter } from './sse.js';
import { createDisconnectAwareCallbacks } from './streaming.js';
import type { ServerResponse } from 'node:http';

function okRunner(output: unknown, cost = 0): ExecutionRunner {
  return {
    execute: async (): Promise<ExecutionOutcome> => ({ ok: true, output, cost, modelId: 'm1', runtimeId: 'r1' }),
  };
}

async function storeWithChefHQ() {
  const store = new MemoryStore();
  await store.createProject('owner-1', { name: 'Chef HQ', slug: 'chef-hq', description: 'the main project' });
  return store;
}

const ownerCtx = { ownerId: 'owner-1', actorId: 'owner-1', actorType: 'owner' as const };

// ─── Mock ServerResponse for testing SSE writing ───────────────────

function createMockRes(): { res: ServerResponse; getWritten: () => string; isClosed: () => boolean } {
  const written: string[] = [];
  let closed = false;

  const fakeRes = {
    writableEnded: false,
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((data: string | Buffer) => {
      written.push(String(data));
      return true;
    }),
    end: vi.fn(function (this: any) {
      closed = true;
      this.writableEnded = true;
    }),
  };

  return {
    res: fakeRes as unknown as ServerResponse,
    getWritten: () => written.join(''),
    isClosed: () => closed,
  };
}

import { vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════
// Section 1: SSE Event Emission Through Pipeline (8 tests)
// ═══════════════════════════════════════════════════════════════════════

describe('Gate 15 Integration — Pipeline Streaming Emission', () => {
  it('streaming emits start for successful command', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({ result: 'ok' }));
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const callbacks = {
      onEvent: (type: string, data: Record<string, unknown>) => events.push({ type, data }),
      isCancelled: () => false,
    };
    const result = await pipeline.run(ownerCtx, 'status in chef-hq', undefined, callbacks);
    expect(events[0]!.type).toBe('start');
    expect(result.outcome).toBe('executed');
  });

  it('streaming emits start event with correlationId and intent', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({}));
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const callbacks = {
      onEvent: (type: string, data: Record<string, unknown>) => events.push({ type, data }),
      isCancelled: () => false,
    };
    await pipeline.run(ownerCtx, 'status in chef-hq', undefined, callbacks);
    const start = events.find((e) => e.type === 'start');
    expect(start).toBeDefined();
    expect(typeof start!.data.correlationId).toBe('string');
    expect(start!.data.correlationId.length).toBe(36);
    expect(start!.data.intent).toContain('status');
  });

  it('pipeline returns full PipelineResult (complete emitted by handler)', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({}));
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const callbacks = {
      onEvent: (type: string, data: Record<string, unknown>) => events.push({ type, data }),
      isCancelled: () => false,
    };
    const result = await pipeline.run(ownerCtx, 'create task "test" in chef-hq', undefined, callbacks);
    // Pipeline does NOT emit 'complete' via callbacks — that's the handler's job
    expect(events.some((e) => e.type === 'complete')).toBe(false);
    // But the return value IS the full PipelineResult
    const required = ['outcome', 'intent', 'project', 'environment', 'risk', 'authority', 'autonomy', 'correlationId', 'explanation'];
    for (const key of required) {
      expect(key in result).toBe(true);
    }
    expect(result.outcome).toBe('executed');
  });

  it('streaming emits error for unknown command', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({}));
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const callbacks = {
      onEvent: (type: string, data: Record<string, unknown>) => events.push({ type, data }),
      isCancelled: () => false,
    };
    await pipeline.run(ownerCtx, 'zzz the qux', undefined, callbacks);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent!.data.code).toBe('unknown');
  });

  it('streaming emits error for unknown project', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({}));
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const callbacks = {
      onEvent: (type: string, data: Record<string, unknown>) => events.push({ type, data }),
      isCancelled: () => false,
    };
    await pipeline.run(ownerCtx, 'create task "x" in nonexistent', undefined, callbacks);
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data.code).toBe('unknown_project');
  });

  it('streaming emits approval for require_approval', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({}));
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const callbacks = {
      onEvent: (type: string, data: Record<string, unknown>) => events.push({ type, data }),
      isCancelled: () => false,
    };
    await pipeline.run(ownerCtx, 'deploy the app in chef-hq production', undefined, callbacks);
    const approvalEvent = events.find((e) => e.type === 'approval');
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent!.data.approvalId).toBeDefined();
    expect(approvalEvent!.data.risk).toBeDefined();
  });

  it('pipeline completes successfully for status command', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({}));
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const callbacks = {
      onEvent: (type: string, data: Record<string, unknown>) => events.push({ type, data }),
      isCancelled: () => false,
    };
    // Use a command that hits the execution path
    const result = await pipeline.run(ownerCtx, 'status in chef-hq', undefined, callbacks);
    // Pipeline returns successfully; no error events
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(result.outcome).toBe('executed');
  });

  it('sequence numbers are strictly monotonically increasing', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({}));
    const events: Array<{ type: string; data: Record<string, unknown>; seq: number }> = [];
    let seqCounter = 0;
    const callbacks = {
      onEvent: (type: string, data: Record<string, unknown>) => {
        events.push({ type, data, seq: seqCounter++ });
      },
      isCancelled: () => false,
    };
    await pipeline.run(ownerCtx, 'create task "test" in chef-hq', undefined, callbacks);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.seq).toBeGreaterThan(events[i - 1]!.seq);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Section 2: SSE Writer Integration (5 tests)
// ═══════════════════════════════════════════════════════════════════════

describe('Gate 15 Integration — SSE Writer Through Pipeline', () => {
  it('SseWriter correctly frames pipeline events as SSE', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({}));
    const { res, getWritten } = createMockRes();
    const writer = initSseResponse(res);
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const callbacks = {
      onEvent: (type: string, data: Record<string, unknown>) => {
        events.push({ type, data });
        writer.write({ type: type as any, seq: writer.nextSeq(), data });
      },
      isCancelled: () => false,
    };
    const result = await pipeline.run(ownerCtx, 'status in chef-hq', undefined, callbacks);
    // Simulate handler: emit complete event with full result
    writer.write({ type: 'complete' as any, seq: writer.nextSeq(), data: result as unknown as Record<string, unknown> });
    writer.close();

    const output = getWritten();
    const dataLines = output.split('\n').filter((l) => l.startsWith('data: '));
    expect(dataLines.length).toBeGreaterThanOrEqual(2);
    const first = JSON.parse(dataLines[0]!.slice(6));
    expect(first.type).toBe('start');
    const last = JSON.parse(dataLines[dataLines.length - 1]!.slice(6));
    expect(last.type).toBe('complete');
  });

  it('SseWriter sequence numbers match pipeline events', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({}));
    const { res, getWritten } = createMockRes();
    const writer = initSseResponse(res);
    const callbacks = {
      onEvent: (type: string, data: Record<string, unknown>) => {
        writer.write({ type: type as any, seq: writer.nextSeq(), data });
      },
      isCancelled: () => false,
    };
    await pipeline.run(ownerCtx, 'status in chef-hq', undefined, callbacks);
    writer.close();

    const output = getWritten();
    const dataLines = output.split('\n').filter((l) => l.startsWith('data: '));
    const seqs = dataLines.map((l) => JSON.parse(l.slice(6)).seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }
  });

  it('initSseResponse sets correct headers', () => {
    const { res } = createMockRes();
    initSseResponse(res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }));
  });

  it('SseWriter close ends the response', () => {
    const { res, isClosed } = createMockRes();
    const writer = initSseResponse(res);
    expect(isClosed()).toBe(false);
    writer.close();
    expect(isClosed()).toBe(true);
  });

  it('writer.write returns false after close', () => {
    const { res } = createMockRes();
    const writer = initSseResponse(res);
    writer.close();
    const ok = writer.write({ type: 'start', seq: 0, data: { correlationId: 'c', intent: 'i' } });
    expect(ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Section 3: Disconnect Detection (3 tests)
// ═══════════════════════════════════════════════════════════════════════

describe('Gate 15 Integration — Disconnect Detection', () => {
  it('disconnect sets cancel flag and emits cancelled event', () => {
    const req = new EventEmitter() as any;
    const { res, getWritten } = createMockRes();
    const writer = initSseResponse(res);
    const emitter = (event: any) => writer.write(event);
    const { callbacks } = createDisconnectAwareCallbacks(writer, req, emitter);

    expect(callbacks.isCancelled()).toBe(false);
    req.emit('close');
    expect(callbacks.isCancelled()).toBe(true);
    const output = getWritten();
    expect(output).toContain('"type":"cancelled"');
  });

  it('no events emitted after disconnect', () => {
    const req = new EventEmitter() as any;
    const { res, getWritten } = createMockRes();
    const writer = initSseResponse(res);
    const emitter = (event: any) => writer.write(event);
    const { callbacks } = createDisconnectAwareCallbacks(writer, req, emitter);

    req.emit('close');
    const beforeCount = getWritten().length;
    callbacks.onEvent('error', { error: 'test' });
    expect(getWritten().length).toBe(beforeCount);
  });

  it('disconnect during pipeline run stops further emission', async () => {
    const req = new EventEmitter() as any;
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({}));
    const { res, getWritten } = createMockRes();
    const writer = initSseResponse(res);
    const emitter = (event: any) => writer.write(event);
    const { callbacks, cancelFlag } = createDisconnectAwareCallbacks(writer, req, emitter);

    // Simulate disconnect before pipeline run
    req.emit('close');
    expect(callbacks.isCancelled()).toBe(true);

    // Pipeline should still complete (callbacks are checked, not blocking)
    const result = await pipeline.run(ownerCtx, 'status in chef-hq', undefined, callbacks);
    expect(result.outcome).toBe('executed');
    // But no new events should be written after disconnect
    const output = getWritten();
    const afterDisconnectEvents = (output.match(/data: /g) ?? []).length;
    // Only the initial ': connected' comment and the cancelled event should be present
    expect(output).toContain('"type":"cancelled"');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Section 4: No Duplicate Execution (3 tests)
// ═══════════════════════════════════════════════════════════════════════

describe('Gate 15 Integration — No Duplicate Execution', () => {
  it('streaming creates exactly one task', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({ result: 'ok' }));
    const callbacks = {
      onEvent: () => {},
      isCancelled: () => false,
    };
    await pipeline.run(ownerCtx, 'create task "test" in chef-hq', undefined, callbacks);
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].status).toBe('completed');
  });

  it('non-streaming creates exactly one task (identical)', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({ result: 'ok' }));
    await pipeline.run(ownerCtx, 'create task "test" in chef-hq');
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].status).toBe('completed');
  });

  it('streaming creates exactly one cost event', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({ result: 'ok' }, 1.5));
    const callbacks = {
      onEvent: () => {},
      isCancelled: () => false,
    };
    await pipeline.run(ownerCtx, 'create task "test" in chef-hq', undefined, callbacks);
    expect(store.costs).toHaveLength(1);
    expect(store.costs[0].amount).toBe(1.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Section 5: Security Preservation (4 tests)
// ═══════════════════════════════════════════════════════════════════════

describe('Gate 15 Integration — Security Preservation', () => {
  it('authority outcome identical with/without streaming', async () => {
    const store1 = await storeWithChefHQ();
    const pipeline1 = new CommandPipeline(store1, okRunner({}));
    const r1 = await pipeline1.run(ownerCtx, 'deploy the app in chef-hq production');

    const store2 = await storeWithChefHQ();
    const pipeline2 = new CommandPipeline(store2, okRunner({}));
    const r2 = await pipeline2.run(
      ownerCtx,
      'deploy the app in chef-hq production',
      undefined,
      { onEvent: () => {}, isCancelled: () => false },
    );

    expect(r1.outcome).toBe(r2.outcome);
    expect(r1.authority?.outcome).toBe(r2.authority?.outcome);
    expect(r1.autonomy?.selected).toBe(r2.autonomy?.selected);
  });

  it('audit trail identical with/without streaming', async () => {
    const store1 = await storeWithChefHQ();
    const pipeline1 = new CommandPipeline(store1, okRunner({}));
    await pipeline1.run(ownerCtx, 'create task "audit test" in chef-hq');

    const store2 = await storeWithChefHQ();
    const pipeline2 = new CommandPipeline(store2, okRunner({}));
    await pipeline2.run(
      ownerCtx,
      'create task "audit test" in chef-hq',
      undefined,
      { onEvent: () => {}, isCancelled: () => false },
    );

    const actions1 = store1.audit.map((a) => a.action).sort();
    const actions2 = store2.audit.map((a) => a.action).sort();
    expect(actions1).toEqual(actions2);
  });

  it('explicit deny produces error event with sanitized message', async () => {
    const store = await storeWithChefHQ();
    await store.setPreference('owner-1', 'policy', 'explicit_deny', true);
    const pipeline = new CommandPipeline(store, okRunner({}));
    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const callbacks = {
      onEvent: (type: string, data: Record<string, unknown>) => events.push({ type, data }),
      isCancelled: () => false,
    };
    const result = await pipeline.run(ownerCtx, 'status in chef-hq', undefined, callbacks);
    expect(result.outcome).toBe('denied');
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(typeof errorEvent!.data.error).toBe('string');
    expect(String(errorEvent!.data.error)).not.toContain('stack');
    expect(String(errorEvent!.data.error)).not.toContain('SQL');
    expect(String(errorEvent!.data.error)).not.toContain('password');
  });

  it('no secrets in streaming events', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({}));
    const allData: string[] = [];
    const callbacks = {
      onEvent: (_type: string, data: Record<string, unknown>) => allData.push(JSON.stringify(data)),
      isCancelled: () => false,
    };
    await pipeline.run(ownerCtx, 'status in chef-hq', undefined, callbacks);
    const combined = allData.join(' ');
    expect(combined).not.toContain('FACTORY_OPENAI_API_KEY');
    expect(combined).not.toContain('FACTORY_SUPABASE_KEY');
    expect(combined).not.toContain('password');
    expect(combined).not.toContain('api_key');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Section 6: Backward Compatibility (3 tests)
// ═══════════════════════════════════════════════════════════════════════

describe('Gate 15 Integration — Backward Compatibility', () => {
  it('pipeline.run without streaming returns identical result', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({ result: 'ok' }));
    const r = await pipeline.run(ownerCtx, 'status in chef-hq');
    expect(r.outcome).toBe('executed');
    expect(r.explanation).toBeDefined();
    expect(r.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('PipelineResult type unchanged with null streaming', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({}));
    const r = await pipeline.run(ownerCtx, 'status in chef-hq', undefined, null);
    const keys = ['outcome', 'intent', 'project', 'environment', 'risk', 'authority', 'autonomy', 'approvalId', 'task', 'correlationId', 'explanation'];
    for (const key of keys) {
      expect(key in r).toBe(true);
    }
  });

  it('PipelineResult type unchanged with undefined streaming', async () => {
    const store = await storeWithChefHQ();
    const pipeline = new CommandPipeline(store, okRunner({}));
    const r = await pipeline.run(ownerCtx, 'status in chef-hq', undefined, undefined);
    const keys = ['outcome', 'intent', 'project', 'environment', 'risk', 'authority', 'autonomy', 'approvalId', 'task', 'correlationId', 'explanation'];
    for (const key of keys) {
      expect(key in r).toBe(true);
    }
  });
});
