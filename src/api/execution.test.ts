import { describe, expect, it } from 'vitest';
import { createExecutionRunner } from './execution.js';
import { ModelGateway } from '../gateways/modelGateway.js';
import { RuntimeGateway } from '../gateways/runtimeGateway.js';
import { MemoryStore } from '../testing/memoryStore.js';
import type { ActorContext } from '../core/pipeline.js';
import type { TaskRecord } from '../core/types.js';

const owner: ActorContext = { ownerId: 'owner-1', actorId: 'owner-1', actorType: 'owner' };

async function taskFor(store: MemoryStore, projectId: string, title: string, status: TaskRecord['status'] = 'queued') {
  return store.createTask('owner-1', { projectId, title, status });
}

function intent(verb: string, resource: string | null) {
  return { status: 'resolved', verb, resource, project: 'chef-hq', environment: 'development', target: null, confidence: 'high', missing: [], normalized: verb + ' ' + (resource ?? '') } as const;
}

describe('Execution Runner (deterministic, model-agnostic, no fabrication)', () => {
  it('answers informational commands from live store evidence', async () => {
    const store = new MemoryStore();
    const p = await store.createProject('owner-1', { name: 'Chef HQ', slug: 'chef-hq' });
    const runner = createExecutionRunner({ store, modelGateway: new ModelGateway(new Map()), runtimeGateway: new RuntimeGateway(new Map()) });
    const out = await runner.execute(await taskFor(store, p.id, 'status'), owner, intent('status', null));
    expect(out.ok).toBe(true);
    expect((out.output as { kind: string }).kind).toBe('daily_status');
  });

  it('reports no-executor honestly when nothing is configured (state preserved, no fake success)', async () => {
    const store = new MemoryStore();
    const p = await store.createProject('owner-1', { name: 'Chef HQ', slug: 'chef-hq' });
    const runner = createExecutionRunner({ store, modelGateway: new ModelGateway(new Map()), runtimeGateway: new RuntimeGateway(new Map()) });
    const out = await runner.execute(await taskFor(store, p.id, 'execute migration 001'), owner, intent('execute', 'migration'));
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no-executor');
  });

  it('never invents a model: with models present but no provider, still no fake output', async () => {
    const store = new MemoryStore();
    const p = await store.createProject('owner-1', { name: 'Chef HQ', slug: 'chef-hq' });
    store.models.push({ id: 'm1', ownerId: 'owner-1', provider: 'openai', name: 'gpt-4o-mini', slug: 'gpt-4o-mini', capability: { reasoning: 'low', tools: true }, contextWindow: 128000, costPer1kInput: 0.15, costPer1kOutput: 0.6, status: 'active' });
    const runner = createExecutionRunner({ store, modelGateway: new ModelGateway(new Map()), runtimeGateway: new RuntimeGateway(new Map()) });
    const out = await runner.execute(await taskFor(store, p.id, 'execute migration 001'), owner, intent('execute', 'migration'));
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no-executor');
  });
});
