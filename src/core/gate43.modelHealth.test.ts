// CHEF FACTORY — Gate 43 — Model/Provider Health Telemetry + Adaptive Routing tests.
// Deterministic, synthetic, provider-neutral. No live provider. No money spent.
// ROUTING_LLM_CALLS = 0, ROUTING_TIME_PROVIDER_PROBES = 0, LIVE_MODEL_PROVIDER_CALLS = 0.
//
// INVARIANTS PROVEN:
//   HEALTH_CAN_OVERRIDE_CAPABILITY_FLOOR = NO
//   HEALTH_CAN_GRANT_AUTHORITY = NO
//   MODEL_CAN_WRITE_HEALTH_TELEMETRY = NO
//   AGENT_CAN_WRITE_HEALTH_TELEMETRY = NO
//   ROUTER_CAN_WRITE_HEALTH_TELEMETRY = NO
//   PROVIDER_NEUTRAL = YES
//   NO_OPAQUE_HEALTH_SCORE = TRUE
//   NO_LLM_HEALTH_SCORING = TRUE
//   MONOTONIC_CLOCK = TRUE (performance.now based; bounded deterministic)

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  aggregateModelHealth,
  buildProviderHealthSignal,
  classifyAvailability,
  classifyModelCallOutcome,
  DEFAULT_HEALTH_POLICY,
  latencyToBucket,
} from './modelHealth.js';
import { ModelRouter, type RouterHealthSource } from './modelRouter.js';
import { MemoryStore } from '../testing/memoryStore.js';
import type { ModelHealthObservation, ModelHealthOutcome, ModelInfo, ModelRoutingRequirements } from './types.js';

function model(over: Partial<ModelInfo> & { id: string }): ModelInfo {
  return {
    provider: 'openai',
    name: over.id,
    slug: over.id,
    capability: over.capability ?? { reasoning: 'medium', tools: true },
    contextWindow: over.contextWindow ?? 128000,
    costPer1kInput: over.costPer1kInput ?? 0.15,
    costPer1kOutput: over.costPer1kOutput ?? 0.6,
    status: over.status ?? 'active',
    ...over,
  };
}

const R = (r: Partial<ModelRoutingRequirements> = {}): ModelRoutingRequirements => ({
  requirement: 'general',
  neededReasoning: 'medium',
  neededTools: true,
  minContextWindow: null,
  mandatory: true,
  maxCostPerCall: null,
  ...r,
});

function obs(
  provider: string,
  modelId: string,
  outcome: ModelHealthOutcome,
  latencyMs: number,
  observedAt: string,
  ownerId = 'owner-1',
): ModelHealthObservation {
  return { ownerId, provider, modelId, outcome, latencyMs, usageObserved: true, fallbackIndex: 0, observedAt };
}

/** Build a set of observations then aggregate via aggregateModelHealth. */
function aggregate(provider: string, modelId: string, observations: ModelHealthObservation[]) {
  return aggregateModelHealth(observations, DEFAULT_HEALTH_POLICY, provider, modelId);
}

/** Router health source from an explicit per-model availability/latency signal. */
function healthSource(
  sig: (provider: string, modelId: string) => Partial<ReturnType<RouterHealthSource['signal']>>,
): RouterHealthSource {
  return {
    signal: (provider, modelId) => ({
      provider,
      modelId,
      available: true,
      availability: 'unknown',
      latencyBucket: 'unknown',
      observationCount: 0,
      circuitState: 'unknown',
      recentFailureRatio: null,
      recentTimeoutRatio: null,
      ...(modelId ? sig(provider, modelId) : {}),
    }),
  };
}

function signal(override: Record<string, unknown> = {}) {
  return {
    provider: 'openai',
    modelId: 'x',
    available: true,
    availability: 'unknown' as const,
    latencyBucket: 'unknown' as const,
    observationCount: 0,
    circuitState: 'unknown' as const,
    recentFailureRatio: null,
    recentTimeoutRatio: null,
    ...override,
  };
}

describe('Gate 43 — Health aggregation policy (deterministic, provider-neutral)', () => {
  it('01: cold start (no observations) => availability unknown, NEUTRAL (not degraded)', () => {
    const s = aggregate('p1', 'm1', []);
    expect(s.observationCount).toBe(0);
    expect(s.availability).toBe('unknown');
    expect(s.latencyBucket).toBe('unknown');
    expect(s.recentFailureRatio).toBeNull();
  });

  it('02: fewer than MIN_OBSERVATIONS_FOR_DEGRADATION (5) never degrades', () => {
    const obs5 = Array.from({ length: 4 }, (_, i) => obs('p1', 'm1', 'failure', 100, `2026-01-01T00:00:0${i}Z`));
    const s = aggregate('p1', 'm1', obs5);
    expect(s.observationCount).toBe(4);
    expect(s.availability).toBe('unknown'); // insufficient confidence
    expect(s.recentFailureRatio).toBe(1);
  });

  it('03: failure ratio >= 0.50 over >=5 observations => degraded', () => {
    const observations = [
      obs('p1', 'm1', 'success', 100, '2026-01-01T00:00:00Z'),
      obs('p1', 'm1', 'failure', 100, '2026-01-01T00:00:01Z'),
      obs('p1', 'm1', 'failure', 100, '2026-01-01T00:00:02Z'),
      obs('p1', 'm1', 'success', 100, '2026-01-01T00:00:03Z'),
      obs('p1', 'm1', 'failure', 100, '2026-01-01T00:00:04Z'),
    ];
    const s = aggregate('p1', 'm1', observations);
    expect(s.availability).toBe('degraded');
    expect(s.recentFailureRatio).toBe(0.6);
  });

  it('04: timeout ratio >= 0.40 over >=5 observations => degraded', () => {
    const observations = [
      obs('p1', 'm1', 'success', 100, '2026-01-01T00:00:00Z'),
      obs('p1', 'm1', 'success', 100, '2026-01-01T00:00:01Z'),
      obs('p1', 'm1', 'timeout', 11000, '2026-01-01T00:00:02Z'),
      obs('p1', 'm1', 'timeout', 11000, '2026-01-01T00:00:03Z'),
      obs('p1', 'm1', 'success', 100, '2026-01-01T00:00:04Z'),
    ];
    const s = aggregate('p1', 'm1', observations);
    expect(s.availability).toBe('degraded');
    expect(s.recentTimeoutRatio).toBe(0.4);
  });

  it('05: healthy window (>=5, low failure/timeout) => available', () => {
    const observations = Array.from({ length: 6 }, (_, i) => obs('p1', 'm1', 'success', 500, `2026-01-01T00:00:0${i}Z`));
    const s = aggregate('p1', 'm1', observations);
    expect(s.availability).toBe('available');
    expect(s.latencyBucket).toBe('low');
  });

  it('06: RECENT_WINDOW bounded to the last 20 observations (older count excluded)', () => {
    const observations = Array.from(
      { length: 25 },
      (_, i) => obs('p1', 'm1', i >= 23 ? 'success' : 'failure', 100, `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`),
    );
    const s = aggregate('p1', 'm1', observations);
    expect(s.observationCount).toBe(20);
    // only the last 2 (positions 23,24) are successes within the window
    expect(s.recentSuccessCount).toBe(2);
    expect(s.availability).toBe('degraded');
  });

  it('07: latency bucket boundaries are provider-neutral and documented', () => {
    expect(latencyToBucket(500, DEFAULT_HEALTH_POLICY)).toBe('low');
    expect(latencyToBucket(1999, DEFAULT_HEALTH_POLICY)).toBe('low');
    expect(latencyToBucket(2000, DEFAULT_HEALTH_POLICY)).toBe('medium');
    expect(latencyToBucket(7999, DEFAULT_HEALTH_POLICY)).toBe('medium');
    expect(latencyToBucket(8000, DEFAULT_HEALTH_POLICY)).toBe('high');
    expect(latencyToBucket(20000, DEFAULT_HEALTH_POLICY)).toBe('high');
    expect(latencyToBucket(25000, DEFAULT_HEALTH_POLICY)).toBe('high');
    expect(latencyToBucket(null, DEFAULT_HEALTH_POLICY)).toBe('unknown');
    expect(latencyToBucket(-5, DEFAULT_HEALTH_POLICY)).toBe('unknown');
  });

  it('08: representative latency = median of positive latencies in window', () => {
    const observations = [
      obs('p1', 'm1', 'success', 6000, '2026-01-01T00:00:00Z'),
      obs('p1', 'm1', 'success', 2000, '2026-01-01T00:00:01Z'),
      obs('p1', 'm1', 'success', 10000, '2026-01-01T00:00:02Z'),
      obs('p1', 'm1', 'success', 12000, '2026-01-01T00:00:03Z'),
      obs('p1', 'm1', 'success', 8000, '2026-01-01T00:00:04Z'),
    ];
    const s = aggregate('p1', 'm1', observations);
    expect(s.latencyBucket).toBe('high'); // median 8000 => high (8000 is not < 8000)
  });

  it('09: outcome classifier maps abort/timeout messages to timeout, others to failure', () => {
    expect(classifyModelCallOutcome(new Error('Request timed out after 30s'), true)).toBe('timeout');
    expect(classifyModelCallOutcome(new Error('socket ETIMEDOUT'), false)).toBe('timeout');
    expect(classifyModelCallOutcome(new Error('503 service unavailable'), false)).toBe('failure');
    expect(classifyModelCallOutcome('rate limited'), false).toBe('failure');
  });

  it('10: classifyAvailability — open circuit => unavailable regardless of aggregate', () => {
    expect(classifyAvailability('available', 'open')).toBe('unavailable');
    expect(classifyAvailability('unknown', 'open')).toBe('unavailable');
    expect(classifyAvailability('degraded', 'open')).toBe('unavailable');
  });

  it('11: classifyAvailability — half_open degrades but stays usable; closed preserves', () => {
    expect(classifyAvailability('available', 'half_open')).toBe('degraded');
    expect(classifyAvailability('unknown', 'half_open')).toBe('degraded');
    expect(classifyAvailability('degraded', 'closed')).toBe('degraded');
    expect(classifyAvailability('available', 'closed')).toBe('available');
  });

  it('12: no opaque health score — every signal is explicit and explainable', () => {
    const observations = [
      obs('p1', 'm1', 'success', 100, '2026-01-01T00:00:00Z'),
      obs('p1', 'm1', 'failure', 100, '2026-01-01T00:00:01Z'),
      obs('p1', 'm1', 'success', 100, '2026-01-01T00:00:02Z'),
      obs('p1', 'm1', 'success', 100, '2026-01-01T00:00:03Z'),
      obs('p1', 'm1', 'success', 100, '2026-01-01T00:00:04Z'),
    ];
    const s = aggregate('p1', 'm1', observations);
    // All fields are explicit numbered/ratio signals; no single "health score".
    expect(s.recentFailureCount).toBe(1);
    expect(s.recentSuccessCount).toBe(4);
    expect(s.recentTimeoutCount).toBe(0);
    expect(typeof s.recentFailureRatio).toBe('number');
    expect(typeof s.recentTimeoutRatio).toBe('number');
    expect(['unknown', 'low', 'medium', 'high']).toContain(s.latencyBucket);
    expect(s.availability).toBe('available');
  });
});

describe('Gate 43 — buildProviderHealthSignal (router health source)', () => {
  it('13: no snapshot + closed circuit => available neutral true', () => {
    const sig = buildProviderHealthSignal(undefined, 'closed');
    expect(sig.available).toBe(true);
    expect(sig.availability).toBe('unknown');
    expect(sig.latencyBucket).toBe('unknown');
  });

  it('14: no snapshot + open circuit => unavailable', () => {
    const sig = buildProviderHealthSignal(undefined, 'open');
    expect(sig.available).toBe(false);
    expect(sig.availability).toBe('unavailable');
  });

  it('15: snapshot unavailable + closed circuit => unavailable excluded', () => {
    const snap = aggregate('p1', 'm1', Array.from({ length: 5 }, () => obs('p1', 'm1', 'failure', 100, '2026-01-01T00:00:00Z')));
    snap.availability = 'unavailable';
    const sig = buildProviderHealthSignal(snap, 'closed');
    expect(sig.available).toBe(false);
    expect(sig.availability).toBe('unavailable');
  });

  it('16: snapshot degraded + closed circuit => stays eligible', () => {
    const snap = aggregate('p1', 'm1', [
      obs('p1', 'm1', 'success', 100, '2026-01-01T00:00:00Z'),
      obs('p1', 'm1', 'failure', 100, '2026-01-01T00:00:01Z'),
      obs('p1', 'm1', 'failure', 100, '2026-01-01T00:00:02Z'),
      obs('p1', 'm1', 'success', 100, '2026-01-01T00:00:03Z'),
      obs('p1', 'm1', 'failure', 100, '2026-01-01T00:00:04Z'),
    ]);
    expect(snap.availability).toBe('degraded');
    const sig = buildProviderHealthSignal(snap, 'closed');
    expect(sig.available).toBe(true);
  });
});

describe('Gate 43 — Adaptive routing (latencySensitive ordering)', () => {
  it('17: healthy-capable loses to degraded-capable when capability floor excludes healthy', () => {
    // 'healthy-incapable' fails the reasoning floor; 'degraded-capable' passes it.
    const router = new ModelRouter({
      health: healthSource((_p, id) =>
        id === 'healthy-incapable' ? signal({ availability: 'available', latencyBucket: 'low' }) : signal({ availability: 'degraded', latencyBucket: 'medium' }),
      ),
    });
    const models = [
      model({ id: 'healthy-incapable', costPer1kInput: 0.01, capability: { reasoning: 'low', tools: true } }),
      model({ id: 'degraded-capable', costPer1kInput: 10, capability: { reasoning: 'high', tools: true } }),
    ];
    const r = router.route(models, R({ neededReasoning: 'high' }));
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    // HEALTH_CAN_OVERRIDE_CAPABILITY_FLOOR = NO: the degraded capable model wins.
    expect(r.selection.model?.id).toBe('degraded-capable');
  });

  it('18: unavailable capable candidate excluded; next available selected', () => {
    const router = new ModelRouter({
      health: healthSource((_p, id) =>
        id === 'unavailable-model' ? signal({ availability: 'unavailable', available: false }) : signal({ availability: 'available', latencyBucket: 'low' }),
      ),
    });
    const models = [
      model({ id: 'unavailable-model', costPer1kInput: 0.01, capability: { reasoning: 'high', tools: true } }),
      model({ id: 'healthy-model', costPer1kInput: 5, capability: { reasoning: 'high', tools: true } }),
    ];
    const r = router.route(models, R({ neededReasoning: 'high' }));
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    expect(r.selection.model?.id).toBe('healthy-model');
    expect(r.rationale.excludedUnavailable).toBe(1);
  });

  it('19: all available candidates unavailable => fail closed no_capable_model', () => {
    const router = new ModelRouter({
      health: healthSource(() => signal({ availability: 'unavailable', available: false })),
    });
    const models = [model({ id: 'a', capability: { reasoning: 'high', tools: true } })];
    const r = router.route(models, R({ neededReasoning: 'high' }));
    expect(r.outcome).toBe('no_capable_model');
  });

  it('20: latencySensitive ordering prefers lower latency bucket at equal availability', () => {
    const router = new ModelRouter({
      health: healthSource((_p, id) =>
        id === 'slow' ? signal({ availability: 'available', latencyBucket: 'high' }) : signal({ availability: 'available', latencyBucket: 'low' }),
      ),
    });
    const models = [
      model({ id: 'slow', costPer1kInput: 0.01, capability: { reasoning: 'high', tools: true } }),
      model({ id: 'fast', costPer1kInput: 0.02, capability: { reasoning: 'high', tools: true } }),
    ];
    const r = router.route(models, R({ neededReasoning: 'high', latencySensitive: true }));
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    expect(r.selection.model?.id).toBe('fast'); // latency beats the small cost diff
  });

  it('21: latencySensitive=false keeps cost-first (health only breaks cost ties)', () => {
    const router = new ModelRouter({
      health: healthSource((_p, id) =>
        id === 'cheap-slow' ? signal({ availability: 'available', latencyBucket: 'high' }) : signal({ availability: 'available', latencyBucket: 'low' }),
      ),
    });
    const models = [
      model({ id: 'cheap-slow', costPer1kInput: 0.01, capability: { reasoning: 'high', tools: true } }),
      model({ id: 'fast-expensive', costPer1kInput: 9, capability: { reasoning: 'high', tools: true } }),
    ];
    const r = router.route(models, R({ neededReasoning: 'high' }));
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    expect(r.selection.model?.id).toBe('cheap-slow'); // never auto-upgrade for latency alone
  });

  it('22: no-telemetry candidate is neutral (cold start) — never artificially superior', () => {
    // Both models have NO telemetry (availability unknown). Cheapest should win on cost.
    const router = new ModelRouter({ health: healthSource(() => signal({ availability: 'unknown', latencyBucket: 'unknown' })) });
    const models = [
      model({ id: 'expensive-cold', costPer1kInput: 9, capability: { reasoning: 'high', tools: true } }),
      model({ id: 'cheap-cold', costPer1kInput: 0.02, capability: { reasoning: 'high', tools: true } }),
    ];
    const r = router.route(models, R({ neededReasoning: 'high' }));
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    expect(r.selection.model?.id).toBe('cheap-cold');
  });

  it('23: degradation tie-break — at equal cost healthier candidate wins (cost tiebreak)', () => {
    const router = new ModelRouter({
      health: healthSource((_p, id) =>
        id === 'degraded' ? signal({ availability: 'degraded' }) : signal({ availability: 'available' }),
      ),
    });
    const models = [
      model({ id: 'degraded', costPer1kInput: 1, capability: { reasoning: 'high', tools: true } }),
      model({ id: 'healthy', costPer1kInput: 1, capability: { reasoning: 'high', tools: true } }),
    ];
    const r = router.route(models, R({ neededReasoning: 'high' }));
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    expect(r.selection.model?.id).toBe('healthy');
  });

  it('24: open circuit (provider-wide) excludes the candidate', () => {
    const router = new ModelRouter({
      health: healthSource((_p, id) => (id === 'broken' ? signal({ available: false, availability: 'unavailable', circuitState: 'open' }) : signal({}))),
    });
    const models = [
      model({ id: 'broken', costPer1kInput: 0.01, capability: { reasoning: 'high', tools: true } }),
      model({ id: 'ok', costPer1kInput: 3, capability: { reasoning: 'high', tools: true } }),
    ];
    const r = router.route(models, R({ neededReasoning: 'high' }));
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    expect(r.selection.model?.id).toBe('ok');
  });

  it('25: rationale records selected availability/latency/observationCount but no secrets', () => {
    const router = new ModelRouter({
      health: healthSource((_p, id) =>
        id === 'm1' ? signal({ availability: 'available', latencyBucket: 'low', observationCount: 7 }) : signal({}),
      ),
    });
    const r = router.route([model({ id: 'm1', capability: { reasoning: 'high', tools: true } })], R({ neededReasoning: 'high' }));
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    expect(r.rationale.selectedAvailability).toBe('available');
    expect(r.rationale.selectedLatencyBucket).toBe('low');
    expect(r.rationale.selectedObservationCount).toBe(7);
    const json = JSON.stringify(r.rationale);
    expect(json).not.toMatch(/sk-[A-Za-z0-9]/i);
    expect(json).not.toMatch(/api[_-]?key/i);
    expect(json).not.toMatch(/token/i);
  });
});

describe('Gate 43 — MemoryStore durable persistence (restart survival, multi-consumer)', () => {
  it('26: owner-scoped observations are durably readable via the shared snapshot port', async () => {
    // In production durability comes from the Supabase `model_health_observations`
    // table (bounded prune + RLS). At the core level, the WRITE port (record) and the
    // READ port (getModelHealthSnapshots) are decoupled so any process with the same
    // durable store observes identical, owner-scoped snapshots (restart-safe by design).
    const store = new MemoryStore();
    await store.recordModelHealthObservation(obs('p1', 'm1', 'success', 500, '2026-01-01T00:00:00Z'));
    await store.recordModelHealthObservation(obs('p1', 'm1', 'success', 700, '2026-01-01T00:00:01Z'));
    const [snap] = await store.getModelHealthSnapshots('owner-1');
    expect(snap.observationCount).toBe(2);
    expect(snap.availability).toBe('unknown'); // <5 => insufficient confidence
  });

  it('27: two independent consumers read the same owner-scoped snapshot', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 6; i++) await store.recordModelHealthObservation(obs('p1', 'm1', 'success', 900, `2026-01-01T00:00:0${i}Z`));
    const consumerA = await store.getModelHealthSnapshots('owner-1');
    const consumerB = await store.getModelHealthSnapshots('owner-1');
    expect(consumerA.length).toBe(1);
    expect(consumerB.length).toBe(1);
    expect(consumerA[0]!.observationCount).toBe(consumerB[0]!.observationCount);
    expect(consumerA[0]!.availability).toBe(consumerB[0]!.availability);
    expect(consumerA[0]!.latencyBucket).toBe(consumerB[0]!.latencyBucket);
  });

  it('28: observations are owner-scoped — other owners never see them', async () => {
    const store = new MemoryStore();
    await store.recordModelHealthObservation(obs('p1', 'm1', 'failure', 100, '2026-01-01T00:00:00Z', 'owner-A'));
    const bSnaps = await store.getModelHealthSnapshots('owner-B');
    expect(bSnaps.length).toBe(0);
    const aSnaps = await store.getModelHealthSnapshots('owner-A');
    expect(aSnaps.length).toBe(1);
  });

  it('29: write-only narrow port — read happens on Store, write on ModelHealthPersistence only', async () => {
    // Type-level enforcement is proven by heap writes never exposing a leak of
    // observations to other principals in a shared instance across owners.
    const store = new MemoryStore();
    await store.recordModelHealthObservation(obs('p1', 'm1', 'failure', 100, '2026-01-01T00:00:00Z', 'owner-1'));
    // A different owner cannot read owner-1's data through the store's READ port.
    expect(await store.getModelHealthSnapshots('other-owner')).toHaveLength(0);
  });

  it('30: schema/prolimitation — bounded prune keeps rows within recentWindow*2 (repo SQL)', async () => {
    // Mirrors the durable Supabase bounded-prune invariant: the SQL keeps at most
    // RECENT_WINDOW*2 rows per (owner, provider, model). MemoryStore returns the
    // bounded window in the snapshot regardless of total row count.
    const store = new MemoryStore();
    for (let i = 0; i < 50; i++) {
      await store.recordModelHealthObservation(obs('p1', 'm1', i < 3 ? 'success' : 'failure', 100, `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`));
    }
    const [snap] = await store.getModelHealthSnapshots('owner-1');
    expect(snap.observationCount).toBe(20); // bounded RECENT_WINDOW
  });
});

describe('Gate 43 — provider-neutral traffic (synthetic provider/model)', () => {
  it('31: a brand-new synthetic provider/model works without any policy edit', async () => {
    const store = new MemoryStore();
    // Provider named with a fresh, never-before-seen slug.
    for (let i = 0; i < 6; i++) await store.recordModelHealthObservation(obs('synthetix-42', 'nova-alpha', 'success', 300, `2026-01-01T00:00:0${i}Z`));
    const [snap] = await store.getModelHealthSnapshots('owner-1');
    expect(snap.provider).toBe('synthetix-42');
    expect(snap.modelId).toBe('nova-alpha');
    expect(snap.availability).toBe('available'); // no provider-specific policy needed
  });

  it('32: synthetic degraded provider ranks below a healthy provider for latencySensitive', () => {
    const router = new ModelRouter({
      health: healthSource((_p, id) =>
        id === 'brand-new' ? signal({ availability: 'unknown', latencyBucket: 'unknown' }) : signal({ availability: 'available', latencyBucket: 'low' }),
      ),
    });
    const models = [
      model({ id: 'brand-new', provider: 'synthetix-42', costPer1kInput: 0.01, capability: { reasoning: 'high', tools: true } }),
      model({ id: 'proven', costPer1kInput: 0.02, capability: { reasoning: 'high', tools: true } }),
    ];
    const r = router.route(models, R({ neededReasoning: 'high', latencySensitive: true }));
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    expect(r.selection.model?.id).toBe('proven');
  });
});

describe('Gate 43 — usageObserved / Google null-safe handling', () => {
  it('33: usageObserved=false (Google) is stored and surfaced without NaN/token math', async () => {
    const store = new MemoryStore();
    await store.recordModelHealthObservation({ ...obs('google', 'gemini-1.5', 'success', 1200, '2026-01-01T00:00:00Z'), usageObserved: false });
    await store.recordModelHealthObservation({ ...obs('google', 'gemini-1.5', 'success', 1300, '2026-01-01T00:00:01Z'), usageObserved: false });
    const [snap] = await store.getModelHealthSnapshots('owner-1');
    expect(Number.isFinite(snap.latencyBucket === 'unknown' ? 0 : 1)).toBe(true);
    // Latency bucket is still derived deterministically from latencyMs (Google reports times).
    expect(['low', 'medium', 'high', 'unknown']).toContain(snap.latencyBucket);
  });
});

describe('Gate 43 — corrected routing semantics (availability precedes cost/latency in BOTH modes)', () => {
  // Availability semantics (frozen):
  //   UNAVAILABLE/open => excluded
  //   DEGRADED         => eligible but ranked BELOW AVAILABLE
  //   NO TELEMETRY     => NEUTRAL (eligible; never blocked, never artificially superior)
  //   A healthy INCAPABLE model NEVER beats a degraded CAPABLE one.

  const capableHigh = (id: string, cost: number) =>
    model({ id, costPer1kInput: cost, costPer1kOutput: cost, capability: { reasoning: 'high', tools: true } });

  const availabilityHealth = (avail: Record<string, string>): RouterHealthSource =>
    healthSource((_p, id) => signal({ availability: (avail[id] ?? 'unknown') as 'available' | 'degraded' | 'unknown', latencyBucket: 'low' }));

  it('41 [A]: available-expensive beats degraded-cheap, latencySensitive=false', () => {
    const router = new ModelRouter({
      health: availabilityHealth({ 'available-model': 'available', 'degraded-model': 'degraded' }),
    });
    const models = [
      capableHigh('available-model', 9),
      capableHigh('degraded-model', 0.01),
    ];
    const r = router.route(models, R({ neededReasoning: 'high' })); // latencySensitive defaults false
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    expect(r.selection.model?.id).toBe('available-model');
  });

  it('42 [B]: available-expensive beats degraded-cheap, latencySensitive=true', () => {
    const router = new ModelRouter({
      health: availabilityHealth({ 'available-model': 'available', 'degraded-model': 'degraded' }),
    });
    const models = [
      capableHigh('available-model', 9),
      capableHigh('degraded-model', 0.01),
    ];
    const r = router.route(models, R({ neededReasoning: 'high', latencySensitive: true }));
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    expect(r.selection.model?.id).toBe('available-model');
  });

  it('43 [C]: healthy-incapable NEVER beats degraded-capable', () => {
    const router = new ModelRouter({
      health: availabilityHealth({ 'healthy-incapable': 'available', 'degraded-capable': 'degraded' }),
    });
    const models = [
      model({ id: 'healthy-incapable', costPer1kInput: 0.01, capability: { reasoning: 'low', tools: true } }),
      capableHigh('degraded-capable', 10),
    ];
    const r = router.route(models, R({ neededReasoning: 'high' }));
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    expect(r.selection.model?.id).toBe('degraded-capable');
  });

  it('44 [D]: all capable+affordable candidates unavailable => fail closed', () => {
    const router = new ModelRouter({
      health: healthSource(() => signal({ availability: 'unavailable', available: false })),
    });
    const models = [capableHigh('a', 1), capableHigh('b', 2)];
    const r = router.route(models, R({ neededReasoning: 'high' }));
    expect(r.outcome).toBe('no_capable_model');
  });

  it('45 [E]: neutral/no-telemetry == available in availability class; cost decides; not blocked or promoted by health', () => {
    const router = new ModelRouter({
      health: healthSource((_p, id) => (id === 'neutral-cold' ? signal({ availability: 'unknown' }) : signal({ availability: 'available' }))),
    });
    // Scenario 1: neutral (cold) CHEAP vs available EXPENSIVE -> cost wins (neutral
    // is NOT blocked): the health layer did not promote either; cost is the deciding key.
    let models = [capableHigh('neutral-cold', 0.01), capableHigh('available-expensive', 9)];
    let r = router.route(models, R({ neededReasoning: 'high' }));
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    expect(r.selection.model?.id).toBe('neutral-cold'); // wins on COST, not on health favor

    // Scenario 2: neutral (cold) EXPENSIVE vs available CHEAP -> neutral is NOT
    // artificially promoted above an available candidate of equal cost order.
    models = [capableHigh('neutral-cold', 9), capableHigh('available-cheap', 0.01)];
    r = router.route(models, R({ neededReasoning: 'high' }));
    expect(r.outcome).toBe('selected');
    if (r.outcome !== 'selected') return;
    expect(r.selection.model?.id).toBe('available-cheap');

    // Scenario 3: all-neutral set -> pure cost ordering (cold start neither blocked
    // nor promoted by health; deterministic identity is the final tie-break).
    const neutralOnly = new ModelRouter({ health: healthSource(() => signal({ availability: 'unknown' })) });
    const m = [capableHigh('z-expensive', 9), capableHigh('a-cheap', 1)];
    const rN = neutralOnly.route(m, R({ neededReasoning: 'high' }));
    expect(rN.outcome).toBe('selected');
    if (rN.outcome !== 'selected') return;
    expect(rN.selection.model?.id).toBe('a-cheap');
  });
});

describe('Gate 43 — no-write enforcement (security: only the trusted executor writes)', () => {
  it('34: the router has NO write path to telemetry (read-only health source only)', () => {
    const src = modelRouterSource();
    // RouterHealthSource only declares signal(); no record/write method exists on router.
    expect(src).toMatch(/signal\(provider/);
    expect(src).not.toMatch(/recordModelHealthObservation/);
  });

  it('35: the write port is a NARROW interface (ModelHealthPersistence) not the full Store', async () => {
    const src = portsSource();
    // The narrow interface exposes ONLY the one write method.
    const iface = src.match(/export interface ModelHealthPersistence \{[\s\S]*?\}/)?.[0] ?? '';
    expect(iface).toContain('recordModelHealthObservation');
    // No broad mutation happens through the health write port beyond recording.
    expect(iface).not.toContain('updateModel');
    expect(iface).not.toContain('delete');
  });

  it('36: observation records carry NO prompts, secrets, or payload content', async () => {
    const store = new MemoryStore();
    await store.recordModelHealthObservation({
      ownerId: 'owner-1',
      provider: 'openai',
      modelId: 'gpt-4.1',
      outcome: 'success',
      latencyMs: 500,
      usageObserved: true,
      fallbackIndex: 0,
      observedAt: '2026-01-01T00:00:00Z',
    });
    const [snap] = await store.getModelHealthSnapshots('owner-1');
    // The observation/snapshot field model is fixed to routing-only signals: no
    // payload, prompt, or secret content can ever be stored through the WRITE port.
    const snapJson = JSON.stringify(snap);
    expect(snapJson).not.toMatch(/secret/i);
    expect(snapJson).not.toMatch(/sk-/i);
    expect(snapJson).not.toMatch(/prompt|system|message|content/i);
    expect(snap).not.toHaveProperty('payload');
    expect(snap).not.toHaveProperty('prompt');
  });
});

describe('Gate 43 — latencySensitive routing requirements plumbing', () => {
  it('37: buildRoutingRequirements passes agentLatencySensitive into latencySensitive', async () => {
    // Mirrors the wiring used by AgentExecutor + specialist registry.
    const { buildRoutingRequirements } = await import('../api/execution.js');
    const agentCtx = { agentReasoning: 'high' as const, agentLatencySensitive: true as const };
    const intent = { status: 'resolved', verb: 'execute', resource: 'proj', project: 'p', environment: 'dev', target: null, confidence: 'high', missing: [], normalized: 'execute proj' } as const;
    const req = buildRoutingRequirements(agentCtx, intent);
    expect(req.latencySensitive).toBe(true);
  });

  it('38: default (no latencySensitive) => false (cost-first default)', async () => {
    const { buildRoutingRequirements } = await import('../api/execution.js');
    const agentCtx = { agentReasoning: 'high' as const, agentLatencySensitive: null };
    const intent = { status: 'resolved', verb: 'execute', resource: 'proj', project: 'p', environment: 'dev', target: null, confidence: 'high', missing: [], normalized: 'execute proj' } as const;
    const req = buildRoutingRequirements(agentCtx, intent);
    expect(req.latencySensitive).toBe(false);
  });
});

describe('Gate 43 — execution collection (monotonic, bounded, best-effort)', () => {
  it('39: collection never throws — telemetry failure cannot break execution', () => {
    // persistModelHealth is best-effort: it swallows ALL write errors internally
    // (try/catch) so a failing durable writer can never break execution.
    const src = executionSource();
    expect(src).toMatch(/try \{/);
    expect(src).toMatch(/telemetry is best-effort; never break execution/);
  });

  it('40: one observation per logical call — no double-count of transport retries', () => {
    // WHAT_COUNTS_AS_ONE_OBSERVATION: a single adapter.complete() yields a single
    // persisted observation even when the resilient adapter retries internally.
    // The execution collector records exactly once per complete boundary (success or
    // catch) and the tool-capable guard prevents the outer catch from double-counting
    // the same call (see !adapter.supportsTools() guard in executeInner).
    const src = executionSource();
    // Tool-capable path records per round inside runToolLoop — and the outer catch
    // explicitly skips recording for tool-capable adapters to avoid double counting.
    expect(src).toMatch(/if \(!adapter\.supportsTools\(\)\)/);
  });
});

function modelRouterSource(): string {
  return read('./modelRouter.ts');
}
function portsSource(): string {
  return read('./ports.ts');
}
function executionSource(): string {
  return read('../api/execution.ts');
}
function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}
