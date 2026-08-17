import { describe, expect, it } from 'vitest';
import { createExecutionRunner, FACTORY_MAX_TOOL_ROUNDS } from './execution.js';
import { ModelGateway } from '../gateways/modelGateway.js';
import { RuntimeGateway } from '../gateways/runtimeGateway.js';
import { MemoryStore } from '../testing/memoryStore.js';
import type { ActorContext } from '../core/pipeline.js';
import type { TaskRecord, ModelInfo } from '../core/types.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../gateways/providerAdapter.js';
import type { DbQuery } from '../tools/types.js';

const owner: ActorContext = { ownerId: 'owner-1', actorId: 'owner-1', actorType: 'owner' };

function intent(verb: string, resource: string | null) {
  return { status: 'resolved', verb, resource, project: 'test-proj', environment: 'development', target: null, confidence: 'high', missing: [], normalized: verb + ' ' + (resource ?? '') } as const;
}

const mockDb: DbQuery = {
  query: async (_sql: string, _params?: unknown[]) => {
    return { rows: [{ id: 'proj-1', name: 'Test', slug: 'test', description: null, status: 'active', created_at: new Date().toISOString() }] };
  },
};

function createMockProvider(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    provider: 'mock',
    configured: () => true,
    supportsTools: () => true,
    complete: async (req: ProviderRequest): Promise<ProviderResponse> => ({
      provider: 'mock',
      model: req.model,
      text: 'Mock response',
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
    ...overrides,
  };
}

describe('Gate 3 — Execution Runner Tool Loop', () => {
  it('FACTORY_MAX_TOOL_ROUNDS is 10', () => {
    expect(FACTORY_MAX_TOOL_ROUNDS).toBe(10);
  });

  it('text-only response returns without tool calls', async () => {
    const store = new MemoryStore();
    const p = await store.createProject('owner-1', { name: 'Test', slug: 'test-proj' });
    const mockAdapter = createMockProvider();
    const adapters = new Map([['mock', mockAdapter]]);
    const modelGateway = new ModelGateway(adapters);
    const runtimeGateway = new RuntimeGateway(new Map());
    store.models.push({
      id: 'm1', ownerId: 'owner-1', provider: 'mock', name: 'mock-model', slug: 'mock',
      capability: { reasoning: 'medium', tools: true }, contextWindow: 128000,
      costPer1kInput: 0.1, costPer1kOutput: 0.1, status: 'active',
    });
    const runner = createExecutionRunner({ store, modelGateway, runtimeGateway, toolDb: mockDb });
    const task = await store.createTask('owner-1', { projectId: p.id, title: 'test task', status: 'running' });
    const result = await runner.execute(task, owner, intent('execute', 'project'));
    expect(result.ok).toBe(true);
    const output = result.output as { text: string; model: string };
    expect(output.text).toBe('Mock response');
    expect(output.model).toContain('mock');
  });

  it('tool calling loop processes tool calls and returns final text', async () => {
    const store = new MemoryStore();
    const p = await store.createProject('owner-1', { name: 'Test', slug: 'test-proj' });
    let callCount = 0;
    const mockAdapter = createMockProvider({
      complete: async (req: ProviderRequest): Promise<ProviderResponse> => {
        callCount++;
        if (callCount === 1) {
          return {
            provider: 'mock', model: req.model, text: '', usage: { inputTokens: 100, outputTokens: 50 },
            toolCalls: [{ id: 'call_1', name: 'list_projects', arguments: {} }],
          };
        }
        return { provider: 'mock', model: req.model, text: 'Done!', usage: { inputTokens: 100, outputTokens: 50 } };
      },
    });
    const adapters = new Map([['mock', mockAdapter]]);
    const modelGateway = new ModelGateway(adapters);
    const runtimeGateway = new RuntimeGateway(new Map());
    store.models.push({
      id: 'm1', ownerId: 'owner-1', provider: 'mock', name: 'mock-model', slug: 'mock',
      capability: { reasoning: 'medium', tools: true }, contextWindow: 128000,
      costPer1kInput: 0.1, costPer1kOutput: 0.1, status: 'active',
    });
    const runner = createExecutionRunner({ store, modelGateway, runtimeGateway, toolDb: mockDb });
    const task = await store.createTask('owner-1', { projectId: p.id, title: 'list my projects', status: 'running' });
    const result = await runner.execute(task, owner, intent('execute', 'projects'));
    expect(result.ok).toBe(true);
    const output = result.output as { text: string; toolRounds: number };
    expect(output.text).toBe('Done!');
    expect(output.toolRounds).toBe(2);
  });

  it('tool loop stops at FACTORY_MAX_TOOL_ROUNDS', async () => {
    const store = new MemoryStore();
    const p = await store.createProject('owner-1', { name: 'Test', slug: 'test-proj' });
    const mockAdapter = createMockProvider({
      complete: async (req: ProviderRequest): Promise<ProviderResponse> => ({
        provider: 'mock', model: req.model, text: '', usage: { inputTokens: 100, outputTokens: 50 },
        toolCalls: [{ id: `call_${Date.now()}`, name: 'list_projects', arguments: {} }],
      }),
    });
    const adapters = new Map([['mock', mockAdapter]]);
    const modelGateway = new ModelGateway(adapters);
    const runtimeGateway = new RuntimeGateway(new Map());
    store.models.push({
      id: 'm1', ownerId: 'owner-1', provider: 'mock', name: 'mock-model', slug: 'mock',
      capability: { reasoning: 'medium', tools: true }, contextWindow: 128000,
      costPer1kInput: 0.1, costPer1kOutput: 0.1, status: 'active',
    });
    const runner = createExecutionRunner({ store, modelGateway, runtimeGateway, toolDb: mockDb });
    const task = await store.createTask('owner-1', { projectId: p.id, title: 'infinite loop test', status: 'running' });
    const result = await runner.execute(task, owner, intent('execute', 'project'));
    expect(result.ok).toBe(true);
    const output = result.output as { toolRounds: number };
    expect(output.toolRounds).toBe(FACTORY_MAX_TOOL_ROUNDS);
  });

  it('provider without tool support falls back to text-only', async () => {
    const store = new MemoryStore();
    const p = await store.createProject('owner-1', { name: 'Test', slug: 'test-proj' });
    const mockAdapter = createMockProvider({
      supportsTools: () => false,
    });
    const adapters = new Map([['mock', mockAdapter]]);
    const modelGateway = new ModelGateway(adapters);
    const runtimeGateway = new RuntimeGateway(new Map());
    store.models.push({
      id: 'm1', ownerId: 'owner-1', provider: 'mock', name: 'mock-model', slug: 'mock',
      capability: { reasoning: 'medium', tools: true }, contextWindow: 128000,
      costPer1kInput: 0.1, costPer1kOutput: 0.1, status: 'active',
    });
    const runner = createExecutionRunner({ store, modelGateway, runtimeGateway, toolDb: mockDb });
    const task = await store.createTask('owner-1', { projectId: p.id, title: 'text only', status: 'running' });
    const result = await runner.execute(task, owner, intent('execute', 'project'));
    expect(result.ok).toBe(true);
    const output = result.output as { text: string };
    expect(output.text).toBe('Mock response');
  });

  it('tool call to unknown tool returns error in tool result', async () => {
    const store = new MemoryStore();
    const p = await store.createProject('owner-1', { name: 'Test', slug: 'test-proj' });
    let callCount = 0;
    const mockAdapter = createMockProvider({
      complete: async (req: ProviderRequest): Promise<ProviderResponse> => {
        callCount++;
        if (callCount === 1) {
          return {
            provider: 'mock', model: req.model, text: '', usage: { inputTokens: 100, outputTokens: 50 },
            toolCalls: [{ id: 'call_bad', name: 'nonexistent_tool', arguments: {} }],
          };
        }
        return { provider: 'mock', model: req.model, text: 'Handled error', usage: { inputTokens: 100, outputTokens: 50 } };
      },
    });
    const adapters = new Map([['mock', mockAdapter]]);
    const modelGateway = new ModelGateway(adapters);
    const runtimeGateway = new RuntimeGateway(new Map());
    store.models.push({
      id: 'm1', ownerId: 'owner-1', provider: 'mock', name: 'mock-model', slug: 'mock',
      capability: { reasoning: 'medium', tools: true }, contextWindow: 128000,
      costPer1kInput: 0.1, costPer1kOutput: 0.1, status: 'active',
    });
    const runner = createExecutionRunner({ store, modelGateway, runtimeGateway, toolDb: mockDb });
    const task = await store.createTask('owner-1', { projectId: p.id, title: 'bad tool', status: 'running' });
    const result = await runner.execute(task, owner, intent('execute', 'project'));
    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
  });
});
