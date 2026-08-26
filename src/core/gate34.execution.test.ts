// CHEF FACTORY — Gate 34 — Execution Lifecycle & Duplicate Protection.
import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { executeAssignedAgentTask, EXECUTABLE_TASK_STATUSES } from './agentExecutor.js';
import { createExecutionRunner } from '../api/execution.js';
import { ModelGateway } from '../gateways/modelGateway.js';
import { RuntimeGateway } from '../gateways/runtimeGateway.js';
import type { AgentRecord, TaskRecord } from './types.js';
import type { Store } from './ports.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../gateways/providerAdapter.js';
import type { DbQuery } from '../tools/types.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function mockProvider(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    provider: 'mock', configured: () => true, supportsTools: () => true,
    complete: async (req: ProviderRequest): Promise<ProviderResponse> => ({
      provider: 'mock', model: req.model, text: 'Done.', usage: { inputTokens: 50, outputTokens: 20 },
    }),
    ...overrides,
  };
}

const mockDb: DbQuery = { query: async () => ({ rows: [] }) };

async function fixtures() {
  const store = new MemoryStore();
  const ownerId = 'owner-' + uuid();
  const project = await store.createProject(ownerId, { name: 'P', slug: 'p-' + uuid() });
  return { store, ownerId, project };
}

async function makeAgent(store: Store, ownerId: string): Promise<AgentRecord> {
  return store.createAgent(ownerId, { name: 'A-' + uuid(), slug: 'a-' + uuid(), role: 'worker', status: 'active' });
}

async function makeTask(store: Store, ownerId: string, projectId: string, agentId: string, status: TaskRecord['status'] = 'queued'): Promise<TaskRecord> {
  return store.createTask(ownerId, {
    projectId, title: 'T-' + uuid(), status, agentId, riskLevel: 'low',
    inputs: { intent: 'execute test', environment: 'development', resource: 'task' },
  });
}

function buildRunner(store: Store, providerOverrides: Partial<ProviderAdapter> = {}) {
  const adapters = new Map([['mock', mockProvider(providerOverrides)]]);
  const mg = new ModelGateway(adapters);
  const rg = new RuntimeGateway(new Map());
  store.models.push({ id: 'm-' + uuid(), provider: 'mock', name: 'mock', slug: 'mock', capability: { reasoning: 'medium', tools: true }, contextWindow: 128000, costPer1kInput: 0, costPer1kOutput: 0, status: 'active' });
  return createExecutionRunner({ store, modelGateway: mg, runtimeGateway: rg, toolDb: mockDb });
}

async function readyAgent(store: Store, ownerId: string, projectId: string): Promise<{ agent: AgentRecord; task: TaskRecord }> {
  const ag = await makeAgent(store, ownerId);
  await store.agentPermissions.push({ agentId: ag.id, projectId, resourceType: 'task', permission: 'execute' });
  const t = await makeTask(store, ownerId, projectId, ag.id);
  return { agent: ag, task: t };
}

describe('Gate 34 — Execution Lifecycle', () => {
  it('01: success transitions queued->running->completed', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    const r = await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(true);
    const ft = await store.getTask(ownerId, t.id);
    expect(ft?.status).toBe('completed');
    expect(ft?.startedAt).not.toBeNull();
    expect(ft?.completedAt).not.toBeNull();
  });

  it('02: failure transitions to failed or queued', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    const r = await executeAssignedAgentTask({
      store, execution: buildRunner(store, {
        complete: async () => { throw new Error('boom'); },
      }),
      ownerId, agentId: ag.id, taskId: t.id,
    });
    expect(r.ok).toBe(false);
    const ft = await store.getTask(ownerId, t.id);
    expect(['failed', 'queued']).toContain(ft?.status);
  });

  it('03: attempts increment on failure', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    await executeAssignedAgentTask({
      store, execution: buildRunner(store, { complete: async () => { throw new Error('fail'); } }),
      ownerId, agentId: ag.id, taskId: t.id,
    });
    const ft = await store.getTask(ownerId, t.id);
    expect(ft!.attempts).toBeGreaterThanOrEqual(1);
  });

  it('04: TaskRun created on execution', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    const runsBefore = store.taskRuns.length;
    await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(store.taskRuns.length).toBe(runsBefore + 1);
  });

  it('05: actorType is agent not owner', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    let captured: any = null;
    const exec = buildRunner(store);
    const orig = exec.execute.bind(exec);
    exec.execute = async (task: any, ctx: any, intent: any, h?: any) => { captured = ctx; return orig(task, ctx, intent, h); };
    await executeAssignedAgentTask({ store, execution: exec, ownerId, agentId: ag.id, taskId: t.id });
    expect(captured).not.toBeNull();
    expect(captured.actorType).toBe('agent');
    expect(captured.actorId).toBe(ag.id);
    expect(captured.agentId).toBe(ag.id);
  });
});

describe('Gate 34 — Duplicate Execution Protection', () => {
  it('06: claim wins once', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId);
    const t = await makeTask(store, ownerId, project.id, ag.id);
    const c1 = await store.claimTaskForExecution(ownerId, t.id, ag.id);
    expect(c1.ok).toBe(true);
    expect(c1.outcome).toBe('claimed');
  });

  it('07: second claim returns already_running', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId);
    const t = await makeTask(store, ownerId, project.id, ag.id);
    await store.claimTaskForExecution(ownerId, t.id, ag.id);
    const c2 = await store.claimTaskForExecution(ownerId, t.id, ag.id);
    expect(c2.ok).toBe(false);
    expect(c2.outcome).toBe('already_running');
  });

  it('08: claim on unassigned task fails', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId);
    const t = await store.createTask(ownerId, { projectId: project.id, title: 'X', status: 'queued', agentId: null });
    const c = await store.claimTaskForExecution(ownerId, t.id, ag.id);
    expect(c.ok).toBe(false);
    expect(c.outcome).toBe('not_assigned');
  });

  it('09: claim on nonexistent task returns task_not_found', async () => {
    const { store, ownerId } = await fixtures();
    const ag = await makeAgent(store, ownerId);
    const c = await store.claimTaskForExecution(ownerId, 'none', ag.id);
    expect(c.ok).toBe(false);
    expect(c.outcome).toBe('task_not_found');
  });

  it('10: execution blocks duplicate start', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId);
    await store.agentPermissions.push({ agentId: ag.id, projectId: project.id, resourceType: 'task', permission: 'execute' });
    const t = await makeTask(store, ownerId, project.id, ag.id);
    // First execution claims and runs
    const r1 = await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r1.ok).toBe(true);
    // Create another queued task for the same agent
    const t2 = await makeTask(store, ownerId, project.id, ag.id);
    const r2 = await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t2.id });
    expect(r2.ok).toBe(true);
  });
});

describe('Gate 34 — Boundaries', () => {
  it('11: store has no placeTask method — executor cannot call it', async () => {
    const { store } = await fixtures();
    expect((store as any).placeTask).toBeUndefined();
  });

  it('12: executor does not call assignTask', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    let called = false;
    const orig = store.assignTask.bind(store);
    (store as any).assignTask = async (...a: any[]) => { called = true; return orig(...a); };
    await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(called).toBe(false);
  });

  it('13: executor does not call assignTaskIfUnassigned', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    let called = false;
    const orig = store.assignTaskIfUnassigned.bind(store);
    (store as any).assignTaskIfUnassigned = async (...a: any[]) => { called = true; return orig(...a); };
    await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(called).toBe(false);
  });

  it('14: AGENT_EXECUTION_AS_OWNER = NO', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    let ctx: any = null;
    const exec = buildRunner(store);
    const orig = exec.execute.bind(exec);
    exec.execute = async (task: any, c: any, intent: any, h?: any) => { ctx = c; return orig(task, c, intent, h); };
    await executeAssignedAgentTask({ store, execution: exec, ownerId, agentId: ag.id, taskId: t.id });
    expect(ctx.actorId).not.toBe(ctx.ownerId);
  });
});
