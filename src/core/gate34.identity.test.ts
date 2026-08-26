// CHEF FACTORY — Gate 34 — Agent Identity & Task Preconditions.
import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { executeAssignedAgentTask, EXECUTABLE_TASK_STATUSES, agentSystemPrompt } from './agentExecutor.js';
import { createExecutionRunner } from '../api/execution.js';
import { ModelGateway } from '../gateways/modelGateway.js';
import { RuntimeGateway } from '../gateways/runtimeGateway.js';
import { isAgentLifecycleEligible, verifyTaskAssignment } from './agentAuthority.js';
import { TERMINAL_TASK_STATUSES } from './taskEngine.js';
import type { AgentRecord, AgentStatus, TaskRecord } from './types.js';
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

async function agent(store: Store, ownerId: string, status: AgentStatus = 'active'): Promise<AgentRecord> {
  return store.createAgent(ownerId, { name: 'A-' + uuid(), slug: 'a-' + uuid(), role: 'worker', status });
}

async function assignedTask(store: Store, ownerId: string, projectId: string, agentId: string, status: TaskRecord['status'] = 'queued'): Promise<TaskRecord> {
  return store.createTask(ownerId, {
    projectId, title: 'T-' + uuid(), status, agentId, riskLevel: 'low',
    inputs: { intent: 'execute test', environment: 'development', resource: 'task' },
  });
}

function runner(store: Store) {
  const adapters = new Map([['mock', mockProvider()]]);
  const mg = new ModelGateway(adapters);
  const rg = new RuntimeGateway(new Map());
  store.models.push({ id: 'm-' + uuid(), provider: 'mock', name: 'mock', slug: 'mock', capability: { reasoning: 'medium', tools: true }, contextWindow: 128000, costPer1kInput: 0, costPer1kOutput: 0, status: 'active' });
  return createExecutionRunner({ store, modelGateway: mg, runtimeGateway: rg, toolDb: mockDb });
}

describe('Gate 34 — Identity', () => {
  it('01: assigned active agent succeeds', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await agent(store, ownerId);
    await store.agentPermissions.push({ agentId: ag.id, projectId: project.id, resourceType: 'task', permission: 'execute' });
    const t = await assignedTask(store, ownerId, project.id, ag.id);
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('completed');
  });

  it('02: wrong agent denied', async () => {
    const { store, ownerId, project } = await fixtures();
    const a1 = await agent(store, ownerId);
    const a2 = await agent(store, ownerId);
    await store.agentPermissions.push({ agentId: a1.id, projectId: project.id, resourceType: 'task', permission: 'execute' });
    await store.agentPermissions.push({ agentId: a2.id, projectId: project.id, resourceType: 'task', permission: 'execute' });
    const t = await assignedTask(store, ownerId, project.id, a1.id);
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: a2.id, taskId: t.id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('assignment_mismatch');
  });

  it('03: unassigned task denied', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await agent(store, ownerId);
    const t = await store.createTask(ownerId, { projectId: project.id, title: 'X', status: 'queued', agentId: null });
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('task_not_assigned');
  });

  it('04: cross-owner denied', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await agent(store, ownerId);
    const otherOwner = 'owner-' + uuid();
    const t = await assignedTask(store, ownerId, project.id, ag.id);
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId: otherOwner, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(false);
  });

  it('05: paused agent denied', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await agent(store, ownerId, 'paused');
    const t = await assignedTask(store, ownerId, project.id, ag.id);
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_inactive');
  });

  it('06: suspended agent denied', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await agent(store, ownerId, 'suspended');
    const t = await assignedTask(store, ownerId, project.id, ag.id);
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_inactive');
  });

  it('07: retired agent denied', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await agent(store, ownerId, 'retired');
    const t = await assignedTask(store, ownerId, project.id, ag.id);
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_inactive');
  });

  it('08: nonexistent agent returns agent_not_found', async () => {
    const { store, ownerId } = await fixtures();
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: 'none', taskId: 'none' });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_found');
  });
});

describe('Gate 34 — Task Status', () => {
  it('09: completed task denied', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await agent(store, ownerId);
    const t = await assignedTask(store, ownerId, project.id, ag.id, 'completed');
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.outcome).toBe('invalid_task_state');
  });

  it('10: failed task denied', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await agent(store, ownerId);
    const t = await assignedTask(store, ownerId, project.id, ag.id, 'failed');
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.outcome).toBe('invalid_task_state');
  });

  it('11: cancelled task denied', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await agent(store, ownerId);
    const t = await assignedTask(store, ownerId, project.id, ag.id, 'cancelled');
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.outcome).toBe('invalid_task_state');
  });

  it('12: running task denied', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await agent(store, ownerId);
    const t = await assignedTask(store, ownerId, project.id, ag.id, 'running');
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.outcome).toBe('invalid_task_state');
  });

  it('13: needs_approval task denied', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await agent(store, ownerId);
    const t = await assignedTask(store, ownerId, project.id, ag.id, 'needs_approval');
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: ag.id, taskId: t.id });
    expect(r.outcome).toBe('invalid_task_state');
  });

  it('14: EXECUTABLE_TASK_STATUSES contains only queued', () => {
    expect(EXECUTABLE_TASK_STATUSES.size).toBe(1);
    expect(EXECUTABLE_TASK_STATUSES.has('queued')).toBe(true);
  });

  it('15: terminal statuses disjoint from executable', () => {
    for (const s of EXECUTABLE_TASK_STATUSES) {
      expect(TERMINAL_TASK_STATUSES.has(s)).toBe(false);
    }
  });

  it('16: task not found returns task_not_found', async () => {
    const { store, ownerId } = await fixtures();
    const ag = await agent(store, ownerId);
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: ag.id, taskId: 'none' });
    expect(r.outcome).toBe('task_not_found');
  });
});

describe('Gate 34 — System Prompt', () => {
  it('17: contains security directives', () => {
    const p = agentSystemPrompt('ag1', 'ow1', 'tk1');
    expect(p).toContain('bounded worker');
    expect(p).toContain('NOT grant arbitrary permissions');
    expect(p).toContain('independently authorized');
    expect(p).toContain('Never expose secrets');
    expect(p).toContain('Never self-assign');
    expect(p).toContain('Never attempt to approve');
    expect(p).toContain('Stop immediately');
  });

  it('18: no secrets in prompt', () => {
    const p = agentSystemPrompt('ag1', 'ow1', 'tk1');
    expect(p).not.toContain('sk-');
    expect(p).not.toContain('sb_');
    expect(p).not.toContain('password');
    expect(p).not.toContain('API_KEY');
  });
});

describe('Gate 34 — Invariants', () => {
  it('19: isAgentLifecycleEligible only active', () => {
    expect(isAgentLifecycleEligible('active')).toBe(true);
    expect(isAgentLifecycleEligible('paused')).toBe(false);
    expect(isAgentLifecycleEligible('suspended')).toBe(false);
    expect(isAgentLifecycleEligible('retired')).toBe(false);
  });

  it('20: verifyTaskAssignment all failure modes', () => {
    const t = { ownerId: 'o1', agentId: 'a1', id: 't1' };
    expect(verifyTaskAssignment(t, 'a1', 'o2').ok).toBe(false);
    expect(verifyTaskAssignment({ ...t, agentId: null }, 'a1', 'o1').ok).toBe(false);
    expect(verifyTaskAssignment(t, 'a2', 'o1').ok).toBe(false);
    expect(verifyTaskAssignment(t, 'a1', 'o1').ok).toBe(true);
  });

  it('21: result always includes explanation', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await agent(store, ownerId);
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: ag.id, taskId: 'none' });
    expect(r.explanation).not.toBeNull();
    expect(r.explanation!.decision).toBeTruthy();
  });

  it('22: result includes evidence trail', async () => {
    const { store, ownerId, project } = await fixtures();
    const ag = await agent(store, ownerId);
    const r = await executeAssignedAgentTask({ store, execution: runner(store), ownerId, agentId: ag.id, taskId: 'none' });
    expect(r.evidence.length).toBeGreaterThan(0);
  });
});
