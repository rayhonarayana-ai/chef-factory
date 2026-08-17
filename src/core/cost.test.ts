import { describe, expect, it } from 'vitest';
import { costForTokens, estimateTokens } from '../gateways/providerAdapter.js';
import { MemoryStore } from '../testing/memoryStore.js';
import { Monitor } from './monitoring.js';

describe('Cost Controls', () => {
  it('computes provider-agnostic token cost deterministically', () => {
    expect(costForTokens(0.15, 0.6, 1000, 1000)).toBe(0.75);
    expect(costForTokens(3, 15, 1000, 2000)).toBe(33);
    expect(costForTokens(0, 0, 99999, 99999)).toBe(0);
  });

  it('estimates tokens without a provider (fallback)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
  });

  it('never charges a negative amount', () => {
    expect(costForTokens(0.15, 0.6, -5, 0)).toBeGreaterThanOrEqual(0);
  });

  it('rolls up costs into the daily status without inventing numbers', async () => {
    const store = new MemoryStore();
    const p = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    await store.recordCost({ ownerId: 'owner-1', projectId: p.id, taskId: null, runId: null, agentId: null, costType: 'model', amount: 1.25, currency: 'USD', provider: 'openai', modelId: 'm', runtimeId: null, billedTo: 'project', metadata: {} });
    await store.recordCost({ ownerId: 'owner-1', projectId: p.id, taskId: null, runId: null, agentId: null, costType: 'mission', amount: 0.5, currency: 'USD', provider: null, modelId: null, runtimeId: null, billedTo: 'project', metadata: {} });
    const mon = new Monitor(store);
    const st = await mon.dailyStatus('owner-1');
    expect(st.cost).toBeCloseTo(1.75);
    expect(st.projects[0]?.cost).toBeCloseTo(1.75);
  });

  it('excludes other owners from cost rollups (isolation)', async () => {
    const store = new MemoryStore();
    const p = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    await store.recordCost({ ownerId: 'owner-2', projectId: p.id, taskId: null, runId: null, agentId: null, costType: 'model', amount: 999, currency: 'USD', provider: 'openai', modelId: 'm', runtimeId: null, billedTo: 'project', metadata: {} });
    const mon = new Monitor(store);
    expect((await mon.dailyStatus('owner-1')).cost).toBe(0);
  });
});
