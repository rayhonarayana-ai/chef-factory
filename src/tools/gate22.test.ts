// CHEF FACTORY — Gate 22 — Execution Timeout + Resource Management
// Tests the AbortController timeout chain:
//   pipeline.ts → execution.ts → adapter.complete() / adapter.execute()
//   → AbortController.abort() → signal.aborted → provider stops → outcome: execution-timeout

import { describe, it, expect, vi } from 'vitest';
import { EXECUTION_TIMEOUT_MS, createExecutionRunner } from '../api/execution.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../gateways/providerAdapter.js';
import type { RuntimeAdapter, RuntimeExecutionRequest, RuntimeExecutionResult } from '../gateways/runtimeGateway.js';
import { MemoryStore } from '../testing/memoryStore.js';
import type { ActorContext, ParsedIntent, TaskRecord } from '../core/pipeline.js';
import { ModelGateway } from '../gateways/modelGateway.js';
import { RuntimeGateway } from '../gateways/runtimeGateway.js';

// ─── Helpers ──────────────────────────────────────────────────────────
function makeCtx(ownerId = 'owner-g22'): ActorContext {
  return { ownerId, actorId: 'actor-g22', actorType: 'owner', sessionId: 'session-g22' };
}

function makeIntent(overrides: Partial<ParsedIntent> = {}): ParsedIntent {
  return {
    verb: 'execute',
    resource: 'general',
    action: 'run',
    environment: 'development',
    normalized: 'execute general',
    confidence: 0.9,
    ...overrides,
  };
}

function makeTask(store: MemoryStore, ownerId = 'owner-g22', title = 'test task'): TaskRecord {
  return {
    id: `task-g22-${Date.now()}-${Math.random()}`,
    projectId: 'proj-g22',
    title,
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    ownerId,
    environment: 'development',
    risk: 'low',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    error: null,
    metadata: null,
  };
}

function createMockAdapter(opts: {
  completeDelay?: number;
  response?: ProviderResponse;
  error?: Error;
  abortable?: boolean;
} = {}): ProviderAdapter {
  return {
    provider: 'mock',
    configured: () => true,
    supportsTools: () => false,
    async complete(request: ProviderRequest): Promise<ProviderResponse> {
      if (opts.abortable && request.signal) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => resolve(), opts.completeDelay ?? 100_000);
          request.signal!.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('The operation was aborted', 'AbortError'));
          }, { once: true });
        });
      } else if (opts.completeDelay) {
        await new Promise((r) => setTimeout(r, opts.completeDelay));
      }
      if (opts.error) throw opts.error;
      return opts.response ?? {
        provider: 'mock',
        model: 'mock-model',
        text: 'done',
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
}

function createMockRuntimeAdapter(opts: {
  abortable?: boolean;
  delay?: number;
  result?: RuntimeExecutionResult;
} = {}): RuntimeAdapter {
  return {
    runtimeName: 'mock-runtime',
    available: () => true,
    async execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult> {
      if (opts.abortable && request.signal) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => resolve(), opts.delay ?? 100_000);
          request.signal!.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('The operation was aborted', 'AbortError'));
          }, { once: true });
        });
      } else if (opts.delay) {
        await new Promise((r) => setTimeout(r, opts.delay));
      }
      return opts.result ?? {
        runtime: 'mock-runtime',
        ok: true,
        output: 'runtime done',
        error: null,
        durationMs: 10,
        estimatedCost: 0,
      };
    },
  };
}

function buildRunner(modelAdapter: ProviderAdapter): {
  runner: ReturnType<typeof createExecutionRunner>;
  store: MemoryStore;
} {
  const store = new MemoryStore();
  store.models.push({
    id: 'model-g22',
    provider: 'mock',
    name: 'mock-model',
    slug: 'mock-model',
    capability: { reasoning: 'medium', tools: true },
    contextWindow: 8192,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    status: 'active',
  });

  const providerMap = new Map<string, ProviderAdapter>();
  providerMap.set('mock', modelAdapter);
  const modelGateway = new ModelGateway(providerMap);
  const runtimeGateway = new RuntimeGateway(new Map());

  const runner = createExecutionRunner({ store, modelGateway, runtimeGateway });
  return { runner, store };
}

// ─── Tests ────────────────────────────────────────────────────────────
describe('Gate 22 — Execution Timeout + Resource Management', () => {

  // T1: Normal execution succeeds without timeout
  it('T1: normal execution succeeds without timeout', async () => {
    const adapter = createMockAdapter();
    const { runner } = buildRunner(adapter);
    const ctx = makeCtx();
    const task = makeTask(new MemoryStore());
    const result = await runner.execute(task, ctx, makeIntent());
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  // T2: Timeout fires when provider hangs beyond EXECUTION_TIMEOUT_MS
  it('T2: timeout fires when provider hangs', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hangAdapter = createMockAdapter({ abortable: true, completeDelay: 999_999 });
    const { runner, store } = buildRunner(hangAdapter);
    const ctx = makeCtx();
    const task = makeTask(store);

    const execPromise = runner.execute(task, ctx, makeIntent());
    // Fast-forward time past the timeout
    await vi.advanceTimersByTimeAsync(EXECUTION_TIMEOUT_MS + 1000);
    const result = await execPromise;

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('execution-timeout');
    expect(result.error).toContain('timed out');
    vi.useRealTimers();
  });

  // T3: AbortController signal.aborted is true after timeout
  it('T3: signal.aborted is true after timeout fires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let capturedSignal: AbortSignal | undefined;
    const adapter = createMockAdapter({ abortable: true, completeDelay: 999_999 });
    const originalComplete = adapter.complete;
    adapter.complete = async (request: ProviderRequest) => {
      capturedSignal = request.signal;
      return originalComplete.call(adapter, request);
    };

    const { runner, store } = buildRunner(adapter);
    const ctx = makeCtx();
    const task = makeTask(store);
    const execPromise = runner.execute(task, ctx, makeIntent());
    await vi.advanceTimersByTimeAsync(EXECUTION_TIMEOUT_MS + 1000);
    await execPromise;

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(true);
    vi.useRealTimers();
  });

  // T4: Provider adapter receives the signal and stops
  it('T4: provider receives signal and stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let abortCalled = false;
    const hangAdapter: ProviderAdapter = {
      provider: 'mock',
      configured: () => true,
      supportsTools: () => false,
      async complete(request: ProviderRequest): Promise<ProviderResponse> {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => resolve(), 999_999);
          request.signal!.addEventListener('abort', () => {
            clearTimeout(timer);
            abortCalled = true;
            reject(new DOMException('The operation was aborted', 'AbortError'));
          }, { once: true });
        });
        return { provider: 'mock', model: 'mock-model', text: '', usage: null };
      },
    };

    const { runner, store } = buildRunner(hangAdapter);
    const ctx = makeCtx();
    const task = makeTask(store);
    const execPromise = runner.execute(task, ctx, makeIntent());
    await vi.advanceTimersByTimeAsync(EXECUTION_TIMEOUT_MS + 1000);
    await execPromise;

    expect(abortCalled).toBe(true);
    vi.useRealTimers();
  });

  // T5: No false timeout on fast execution
  it('T5: no false timeout on fast execution', async () => {
    const fastAdapter = createMockAdapter({ completeDelay: 5 });
    const { runner, store } = buildRunner(fastAdapter);
    const ctx = makeCtx();
    const task = makeTask(store);
    const result = await runner.execute(task, ctx, makeIntent());
    expect(result.ok).toBe(true);
    expect(result.reason).not.toBe('execution-timeout');
  });

  // T6: Normal provider errors are unchanged (not misidentified as timeout)
  it('T6: normal provider errors unchanged', async () => {
    const failAdapter = createMockAdapter({ error: new Error('provider exploded') });
    const { runner, store } = buildRunner(failAdapter);
    const ctx = makeCtx();
    const task = makeTask(store);
    const result = await runner.execute(task, ctx, makeIntent());
    expect(result.ok).toBe(false);
    expect(result.reason).not.toBe('execution-timeout');
    expect(result.error).toContain('provider exploded');
  });

  // T7: Timer is cleaned up after normal completion (no leak)
  it('T7: timer cleaned up after normal completion', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const fastAdapter = createMockAdapter({ completeDelay: 5 });
    const { runner, store } = buildRunner(fastAdapter);
    const ctx = makeCtx();
    const task = makeTask(store);
    await runner.execute(task, ctx, makeIntent());
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  // T8: RuntimeAdapter also receives signal on timeout
  it('T8: runtime adapter receives signal on timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let runtimeAbortCalled = false;
    const hangRuntime: RuntimeAdapter = {
      runtimeName: 'hang-runtime',
      available: () => true,
      async execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult> {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => resolve(), 999_999);
          request.signal!.addEventListener('abort', () => {
            clearTimeout(timer);
            runtimeAbortCalled = true;
            reject(new DOMException('The operation was aborted', 'AbortError'));
          }, { once: true });
        });
        return { runtime: 'hang-runtime', ok: true, output: '', error: null, durationMs: 0, estimatedCost: 0 };
      },
    };

    const store = new MemoryStore();
    store.runtimes.push({
      id: 'rt-g22', name: 'hang-runtime', slug: 'hang-runtime', version: null,
      capability: {}, costPerHour: 0, status: 'active',
    });
    const providerMap = new Map<string, ProviderAdapter>();
    const modelGateway = new ModelGateway(providerMap);

    const runtimeMap = new Map<string, RuntimeAdapter>();
    runtimeMap.set('hang-runtime', hangRuntime);
    const runtimeGateway = new RuntimeGateway(runtimeMap);

    const runner = createExecutionRunner({ store, modelGateway, runtimeGateway });
    const ctx = makeCtx();
    const task = makeTask(store);
    const execPromise = runner.execute(task, ctx, makeIntent());
    await vi.advanceTimersByTimeAsync(EXECUTION_TIMEOUT_MS + 1000);
    const result = await execPromise;

    expect(runtimeAbortCalled).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('execution-timeout');
    vi.useRealTimers();
  });

  // T9: Regression — informational commands still work
  it('T9: informational commands still work (no regression)', async () => {
    const store = new MemoryStore();
    const providerMap = new Map<string, ProviderAdapter>();
    const modelGateway = new ModelGateway(providerMap);
    const runtimeGateway = new RuntimeGateway(new Map());
    const runner = createExecutionRunner({ store, modelGateway, runtimeGateway });
    const ctx = makeCtx();
    const task = makeTask(store);
    const result = await runner.execute(task, ctx, makeIntent({ verb: 'ask', resource: 'status' }));
    expect(result.ok).toBe(true);
    expect(result.output).toBeDefined();
  });

  // Concurrency: timeout in one execution does not affect another
  it('concurrency: timeout in exec A does not abort exec B', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const hangAdapter = createMockAdapter({ abortable: true, completeDelay: 999_999 });
    const fastAdapter = createMockAdapter({ completeDelay: 5 });

    const storeA = new MemoryStore();
    storeA.models.push({
      id: 'model-g22', provider: 'mock', name: 'mock-model', slug: 'mock-model',
      capability: { reasoning: 'medium', tools: true }, contextWindow: 8192,
      costPer1kInput: 0, costPer1kOutput: 0, status: 'active',
    });
    const providerMapA = new Map<string, ProviderAdapter>();
    providerMapA.set('mock', hangAdapter);
    const runnerA = createExecutionRunner({
      store: storeA,
      modelGateway: new ModelGateway(providerMapA),
      runtimeGateway: new RuntimeGateway(new Map()),
    });

    const storeB = new MemoryStore();
    storeB.models.push({
      id: 'model-g22', provider: 'mock', name: 'mock-model', slug: 'mock-model',
      capability: { reasoning: 'medium', tools: true }, contextWindow: 8192,
      costPer1kInput: 0, costPer1kOutput: 0, status: 'active',
    });
    const providerMapB = new Map<string, ProviderAdapter>();
    providerMapB.set('mock', fastAdapter);
    const runnerB = createExecutionRunner({
      store: storeB,
      modelGateway: new ModelGateway(providerMapB),
      runtimeGateway: new RuntimeGateway(new Map()),
    });

    const ctx = makeCtx();
    const pA = runnerA.execute(makeTask(storeA, 'owner-g22', 'task-A'), ctx, makeIntent());
    const pB = runnerB.execute(makeTask(storeB, 'owner-g22', 'task-B'), ctx, makeIntent());

    await vi.advanceTimersByTimeAsync(100);
    const resultB = await pB;
    expect(resultB.ok).toBe(true);

    await vi.advanceTimersByTimeAsync(EXECUTION_TIMEOUT_MS + 1000);
    const resultA = await pA;
    expect(resultA.ok).toBe(false);
    expect(resultA.reason).toBe('execution-timeout');

    vi.useRealTimers();
  });

  // OpenCodeZen: signal kills child process on timeout
  it('OpenCodeZen: signal propagated to child process adapter', async () => {
    let capturedSignal: AbortSignal | undefined;
    const mockRuntimeAdapter: RuntimeAdapter = {
      runtimeName: 'opencode-zen',
      available: () => true,
      async execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult> {
        capturedSignal = request.signal;
        // Simulate abort-aware behavior
        if (request.signal) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => resolve(), 999_999);
            request.signal!.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new DOMException('The operation was aborted', 'AbortError'));
            }, { once: true });
          });
        }
        return { runtime: 'opencode-zen', ok: true, output: '', error: null, durationMs: 0, estimatedCost: 0 };
      },
    };

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const store = new MemoryStore();
    store.runtimes.push({
      id: 'rt-zen', name: 'opencode-zen', slug: 'opencode-zen', version: null,
      capability: {}, costPerHour: 1, status: 'active',
    });
    const providerMap = new Map<string, ProviderAdapter>();
    const runtimeMap = new Map<string, RuntimeAdapter>();
    runtimeMap.set('opencode-zen', mockRuntimeAdapter);
    const runner = createExecutionRunner({
      store,
      modelGateway: new ModelGateway(providerMap),
      runtimeGateway: new RuntimeGateway(runtimeMap),
    });

    const ctx = makeCtx();
    const task = makeTask(store);
    const execPromise = runner.execute(task, ctx, makeIntent());
    await vi.advanceTimersByTimeAsync(EXECUTION_TIMEOUT_MS + 1000);
    const result = await execPromise;

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('execution-timeout');
    vi.useRealTimers();
  });

  // EXECUTION_TIMEOUT_MS constant is defined and reasonable
  it('EXECUTION_TIMEOUT_MS is defined and >= 10_000', () => {
    expect(EXECUTION_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(typeof EXECUTION_TIMEOUT_MS).toBe('number');
  });
});
