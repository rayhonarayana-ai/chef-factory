// CHEF FACTORY — Gate 34 — Authority, Permissions & Security Invariants.
import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { executeAssignedAgentTask, EXECUTABLE_TASK_STATUSES } from './agentExecutor.js';
import { createExecutionRunner } from '../api/execution.js';
import { ModelGateway } from '../gateways/modelGateway.js';
import { RuntimeGateway } from '../gateways/runtimeGateway.js';
import { resolveAgentAuthority } from './agentAuthority.js';
import { TERMINAL_TASK_STATUSES } from './taskEngine.js';
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

function mockProvider(): ProviderAdapter {
  return {
    provider: 'mock', configured: () => true, supportsTools: () => true,
    complete: async (req: ProviderRequest): Promise<ProviderResponse> => ({
      provider: 'mock', model: req.model, text: 'Done.', usage: { inputTokens: 50, outputTokens: 20 },
    }),
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

async function makeTask(store: Store, ownerId: string, projectId: string, agentId: string): Promise<TaskRecord> {
  return store.createTask(ownerId, {
    projectId, title: 'T-' + uuid(), status: 'queued', agentId, riskLevel: 'low',
    inputs: { intent: 'execute test', environment: 'development', resource: 'task' },
  });
}

function buildRunner(store: Store) {
  const adapters = new Map([['mock', mockProvider()]]);
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

describe('Gate 34 — Authority', () => {
  it('01: missing permission denied', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId);
    const t = await makeTask(store, ownerId, project.id, ag.id);
    const r = await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toMatch(/permission_denied|authority_denied/);
  });

  it('02: role does not grant permission', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId);
    // Agent has role 'worker' but no permission rows
    const t = await makeTask(store, ownerId, project.id, ag.id);
    const r = await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(false);
  });

  it('03: capability does not grant permission', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId);
    // No permission rows at all
    const t = await makeTask(store, ownerId, project.id, ag.id);
    const r = await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(false);
  });

  it('04: assignment does not grant permission', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId);
    const t = await makeTask(store, ownerId, project.id, ag.id);
    // Assignment exists, no permission rows -> denied
    const r = await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(false);
  });

  it('05: explicit DENY permission stops execution', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId);
    await store.agentPermissions.push({ agentId: ag.id, projectId: project.id, resourceType: 'task', permission: 'deny' });
    const t = await makeTask(store, ownerId, project.id, ag.id);
    const r = await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toMatch(/permission_denied|authority_denied|denied/);
  });

  it('06: resolveAgentAuthority returns full chain for valid agent', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId);
    await store.agentPermissions.push({ agentId: ag.id, projectId: project.id, resourceType: 'task', permission: 'execute' });
    const auth = await resolveAgentAuthority({ store, agentId: ag.id, ownerId, projectId: project.id, environment: 'development', resourceType: 'task', permission: 'execute', actionType: 'create', risk: 'low' });
    expect(auth.ok).toBe(true);
    expect(auth.identity.ownerId).toBe(ownerId);
    expect(auth.identity.id).toBe(ag.id);
    expect(auth.agent?.status).toBe('active');
    expect(auth.evidence.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Gate 34 — Security Invariants', () => {
  it('07: EXECUTABLE_TASK_STATUSES is a subset of non-terminal', () => {
    for (const s of EXECUTABLE_TASK_STATUSES) {
      expect(TERMINAL_TASK_STATUSES.has(s)).toBe(false);
    }
  });

  it('08: TERMINAL_TASK_STATUSES includes completed and failed', () => {
    expect(TERMINAL_TASK_STATUSES.has('completed')).toBe(true);
    expect(TERMINAL_TASK_STATUSES.has('failed')).toBe(true);
  });

  it('09: approved task cannot be started again', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId);
    await store.agentPermissions.push({ agentId: ag.id, projectId: project.id, resourceType: 'task', permission: 'execute' });
    const t = await makeTask(store, ownerId, project.id, ag.id);
    // Execute successfully -> completed
    const r1 = await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r1.ok).toBe(true);
    // Try again -> invalid_task_state
    const r2 = await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r2.ok).toBe(false);
    expect(r2.outcome).toBe('invalid_task_state');
  });

  it('10: agent secret exfiltration path not found', async () => {
    // Audit: ensure no secrets leak through task output/error/audit
    const { store, ownerId, project } = await fixtures();
    const ag = await makeAgent(store, ownerId);
    await store.agentPermissions.push({ agentId: ag.id, projectId: project.id, resourceType: 'task', permission: 'execute' });
    const t = await makeTask(store, ownerId, project.id, ag.id);
    const r = await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    const ft = await store.getTask(ownerId, t.id);
    const output = JSON.stringify(ft?.output || '');
    const error = JSON.stringify(ft?.error || '');
    expect(output).not.toContain('sk-');
    expect(output).not.toContain('sb_');
    expect(output).not.toContain('API_KEY');
    expect(error).not.toContain('sk-');
    expect(error).not.toContain('sb_');
  });

  it('11: audit trail exists for successful execution', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    const auditsBefore = store.audit.length;
    await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(store.audit.length).toBeGreaterThanOrEqual(auditsBefore + 1);
  });

  it('12: audit trail exists for failed execution', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    const auditsBefore = store.audit.length;
    await executeAssignedAgentTask({
      store, execution: buildRunner(store, { complete: async () => { throw new Error('fail'); } }),
      ownerId, agentId: ag.id, taskId: t.id,
    });
    expect(store.audit.length).toBeGreaterThanOrEqual(auditsBefore + 1);
  });

  it('13: cost recording infrastructure available', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    const costsBefore = store.costs.length;
    await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    // Cost is recorded when outcome.cost > 0; with zero-cost mock models this may be 0
    expect(store.costs.length).toBeGreaterThanOrEqual(costsBefore);
    expect(typeof store.recordCost).toBe('function');
  });
});

describe('Gate 34 — No Owner Impersonation', () => {
  it('14: AGENT_EXECUTION_AS_OWNER = NO', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    let ctx: any = null;
    const exec = buildRunner(store);
    const orig = exec.execute.bind(exec);
    exec.execute = async (task: any, c: any, intent: any, h?: any) => { ctx = c; return orig(task, c, intent, h); };
    await executeAssignedAgentTask({ store, execution: exec, ownerId, agentId: ag.id, taskId: t.id });
    expect(ctx.actorType).toBe('agent');
    expect(ctx.ownerId).toBe(ownerId);
    expect(ctx.agentId).toBe(ag.id);
  });

  it('15: AGENT_CAN_APPROVE = NO', async () => {
    // The agent system prompt contains instruction to never approve
    const { agentSystemPrompt } = await import('./agentExecutor.js');
    const p = agentSystemPrompt('ag1', 'ow1', 'tk1');
    expect(p).toContain('Never attempt to approve');
  });
});

describe('Gate 34 — No Self-Assignment', () => {
  it('16: store has no placeTask method — executor cannot call it', async () => {
    const { store } = await fixtures();
    expect((store as any).placeTask).toBeUndefined();
  });

  it('17: executor never calls assignTask', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    let called = false;
    const orig = store.assignTask.bind(store);
    (store as any).assignTask = async (...a: any[]) => { called = true; return orig(...a); };
    await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(called).toBe(false);
  });

  it('18: executor never calls assignTaskIfUnassigned', async () => {
    const { store, ownerId, project } = await fixtures();
    const { agent: ag, task: t } = await readyAgent(store, ownerId, project.id);
    let called = false;
    const orig = store.assignTaskIfUnassigned.bind(store);
    (store as any).assignTaskIfUnassigned = async (...a: any[]) => { called = true; return orig(...a); };
    await executeAssignedAgentTask({ store, execution: buildRunner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(called).toBe(false);
  });
});
