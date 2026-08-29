// CHEF FACTORY — Gate 43 — Logical health observation semantics (proof).
// Drives the real execution path with fake adapters + a capturing persistence and
// asserts EXACTLY what durable model-health observations are persisted.
//
// Frozen definition:
//   ONE MODEL HEALTH OBSERVATION = one candidate execution after that candidate's
//   internal retry policy has completed. Retries NOT inside one candidate execution
//   each become separate routing-level observations; fallback candidates ARE
//   separate candidate executions (each recorded independently with its own index).
//
// NO live provider API. LIVE_MODEL_PROVIDER_CALLS = 0.
// AGENT_CAN_WRITE_HEALTH_TELEMETRY = NO
// MODEL_CAN_WRITE_HEALTH_TELEMETRY = NO
// ROUTER_CAN_WRITE_HEALTH_TELEMETRY = NO
// The ONLY write path exercised is the trusted execution collector (narrow port).

import { describe, expect, it } from 'vitest';
import { createExecutionRunner } from './execution.js';
import { ModelGateway } from '../gateways/modelGateway.js';
import { RuntimeGateway } from '../gateways/runtimeGateway.js';
import { MemoryStore } from '../testing/memoryStore.js';
import { createResilientAdapter } from '../gateways/resilience.js';
import type { ModelHealthObservation, ModelHealthOutcome, ModelInfo } from '../core/types.js';
import type { ActorContext } from '../core/pipeline.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../gateways/providerAdapter.js';

/** Capturing narrow write port — records observations SYNCHRONOUSLY for assertions. */
class CapturingHealthPersistence {
  observations: ModelHealthObservation[] = [];
  async recordModelHealthObservation(o: ModelHealthObservation): Promise<void> {
    this.observations.push({ ...o });
  }
}

const owner: ActorContext = { ownerId: 'owner-1', actorId: 'owner-1', actorType: 'owner' };

function intent(resource: string | null) {
  return { status: 'resolved', verb: 'execute', resource, project: 'test-proj', environment: 'development', target: null, confidence: 'high', missing: [], normalized: 'execute ' + (resource ?? '') } as const;
}

function makeTextOnly(provider: string, behavior: () => ProviderResponse | Promise<ProviderResponse>): ProviderAdapter {
  return {
    provider,
    configured: () => true,
    supportsTools: () => false,
    complete: async (_req: ProviderRequest) => behavior(),
  };
}

function model(provider: string, id: string, cost: number): ModelInfo {
  return {
    id, ownerId: 'owner-1', provider, name: id, slug: id,
    capability: { reasoning: 'medium', tools: true }, contextWindow: 128000,
    costPer1kInput: cost, costPer1kOutput: cost, status: 'active',
  };
}

async function setup(adapters: Map<string, ProviderAdapter>, models: ModelInfo[], health: CapturingHealthPersistence) {
  const store = new MemoryStore();
  const p = await store.createProject('owner-1', { name: 'T', slug: 'test-proj' });
  store.models.push(...models);
  const task = await store.createTask('owner-1', { projectId: p.id, title: 't', status: 'running' });
  const runner = createExecutionRunner({
    store,
    modelGateway: new ModelGateway(adapters),
    runtimeGateway: new RuntimeGateway(new Map()),
    modelHealth: health,
  });
  return { runner, task, store, health };
}

const okResponse = (modelName: string): ProviderResponse => ({
  provider: 'p',
  model: modelName,
  text: 'ok',
  usage: { inputTokens: 10, outputTokens: 5 },
});

describe('Gate 43 — Logical observation semantics (proven at the trusted execution boundary)', () => {
  it('OB1: primary success -> exactly ONE success observation at fallbackIndex 0', async () => {
    const h = new CapturingHealthPersistence();
    const adapters = new Map([['p1', makeTextOnly('p1', () => okResponse('m1'))]]);
    const { runner, task } = await setup(adapters, [model('p1', 'm1', 1)], h);
    const r = await runner.execute(task, owner, intent('a'));
    expect(r.ok).toBe(true);
    expect(h.observations).toHaveLength(1);
    expect(h.observations[0]).toMatchObject({ provider: 'p1', modelId: 'm1', outcome: 'success', fallbackIndex: 0 });
  });

  it('OB2: primary exhausted failure with no fallback -> exactly ONE failure observation (fb0)', async () => {
    const h = new CapturingHealthPersistence();
    const adapters = new Map([['p1', makeTextOnly('p1', () => { throw new Error('HTTP 503'); })]]);
    const { runner, task } = await setup(adapters, [model('p1', 'm1', 1)], h);
    const r = await runner.execute(task, owner, intent('a'));
    expect(r.ok).toBe(false);
    expect(h.observations).toHaveLength(1);
    expect(h.observations[0]).toMatchObject({ provider: 'p1', modelId: 'm1', outcome: 'failure', fallbackIndex: 0 });
  });

  it('OB3: primary failure -> fallback success => TWO observations (primary fb0 failure + fallback fb1 success)', async () => {
    const h = new CapturingHealthPersistence();
    const adapters = new Map([
      ['p1', makeTextOnly('p1', () => { throw new Error('HTTP 500'); })],
      ['p2', makeTextOnly('p2', () => okResponse('m2'))],
    ]);
    const { runner, task } = await setup(adapters, [model('p1', 'm1', 1), model('p2', 'm2', 9)], h);
    const r = await runner.execute(task, owner, intent('a'));
    expect(r.ok).toBe(true);
    expect(r.modelId).toBe('m2');
    expect(h.observations).toHaveLength(2);
    expect(h.observations[0]).toMatchObject({ provider: 'p1', modelId: 'm1', outcome: 'failure', fallbackIndex: 0 });
    expect(h.observations[1]).toMatchObject({ provider: 'p2', modelId: 'm2', outcome: 'success', fallbackIndex: 1 });
  });

  it('OB4: primary exhausted timeout -> fallback success => TWO observations (fb0 timeout + fb1 success)', async () => {
    const h = new CapturingHealthPersistence();
    const adapters = new Map([
      ['p1', makeTextOnly('p1', () => { throw new Error('Request timed out'); })],
      ['p2', makeTextOnly('p2', () => okResponse('m2'))],
    ]);
    const { runner, task } = await setup(adapters, [model('p1', 'm1', 1), model('p2', 'm2', 9)], h);
    const r = await runner.execute(task, owner, intent('a'));
    expect(r.ok).toBe(true);
    expect(h.observations).toHaveLength(2);
    expect(h.observations[0]).toMatchObject({ provider: 'p1', modelId: 'm1', outcome: 'timeout', fallbackIndex: 0 });
    expect(h.observations[1]).toMatchObject({ provider: 'p2', modelId: 'm2', outcome: 'success', fallbackIndex: 1 });
  });

  it('OB5: primary failure -> fallback failure => TWO observations (both failures, indices 0 and 1)', async () => {
    const h = new CapturingHealthPersistence();
    const adapters = new Map([
      ['p1', makeTextOnly('p1', () => { throw new Error('HTTP 500'); })],
      ['p2', makeTextOnly('p2', () => { throw new Error('HTTP 502'); })],
    ]);
    const { runner, task } = await setup(adapters, [model('p1', 'm1', 1), model('p2', 'm2', 9)], h);
    const r = await runner.execute(task, owner, intent('a'));
    expect(r.ok).toBe(false);
    expect(h.observations).toHaveLength(2);
    expect(h.observations[0]).toMatchObject({ provider: 'p1', modelId: 'm1', outcome: 'failure', fallbackIndex: 0 });
    expect(h.observations[1]).toMatchObject({ provider: 'p2', modelId: 'm2', outcome: 'failure', fallbackIndex: 1 });
  });

  it('OB6: internal transport retries collapse -> exactly ONE observation per candidate execution', async () => {
    // The underlying adapter fails once then succeeds. The resilient wrapper retries
    // internally within ONE complete(); execution must record exactly ONE observation
    // (the internal retries must NOT each become separate routing-level observations).
    let calls = 0;
    const flakyInner: ProviderAdapter = makeTextOnly('p1', () => {
      calls++;
      if (calls === 1) throw new Error('HTTP 503');
      return okResponse('m1');
    });
    const resilient = createResilientAdapter(flakyInner);

    const h = new CapturingHealthPersistence();
    const adapters = new Map([['p1', resilient]]);
    const { runner, task } = await setup(adapters, [model('p1', 'm1', 1)], h);

    const r = await runner.execute(task, owner, intent('a'));
    expect(r.ok).toBe(true);
    // The resilient adapter attempted the transport up to 2 times internally...
    expect(calls).toBe(2);
    // ...but the OBSERVATION boundary is one candidate execution => exactly ONE record.
    expect(h.observations).toHaveLength(1);
    expect(h.observations[0]).toMatchObject({ provider: 'p1', modelId: 'm1', outcome: 'success', fallbackIndex: 0 });
  });
});
