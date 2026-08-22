// CHEF FACTORY — Gate 32B — Authority Hardening & Autonomous Agent Execution Boundary.
// Tests: actor identity, lifecycle, assignment, authority, permissions, security,
// tool broker, owner regression, audit, hardcoded authorization, autonomy clamp.

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { evaluateAuthority, riskFromAction, clampAutonomy } from './authority.js';
import { evaluateAutonomy } from './autonomy.js';
import {
  isAgentLifecycleEligible,
  verifyTaskAssignment,
  resolveToolAuthorization,
  resolveAgentAuthority,
} from './agentAuthority.js';
import { ToolBroker } from '../gateways/toolBroker.js';
import type { AgentRecord, AgentStatus, AutonomyLevel, TaskRecord } from './types.js';
import type { Store } from './ports.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function createFixtures() {
  const store = new MemoryStore();
  const ownerA = 'owner-a-' + uuid();
  const projectA = await store.createProject(ownerA, { name: 'ProjectA', slug: 'proj-a-' + uuid() });
  return { store, ownerA, projectA };
}

async function makeAgent(store: Store, ownerId: string, overrides: Partial<{ name: string; role: string; status: AgentStatus; capabilities: string[]; maxConcurrentTasks: number }> = {}): Promise<AgentRecord> {
  return store.createAgent(ownerId, {
    name: overrides.name ?? 'Agent-' + uuid(),
    slug: 'ag-' + uuid(),
    role: overrides.role ?? 'worker',
    status: overrides.status ?? 'active',
    capabilities: overrides.capabilities ?? [],
    maxConcurrentTasks: overrides.maxConcurrentTasks,
  });
}

async function makeTask(store: Store, ownerId: string, projectId: string, overrides: Partial<{ title: string; agentId: string | null; status: TaskRecord['status'] }> = {}): Promise<TaskRecord> {
  return store.createTask(ownerId, {
    projectId,
    title: overrides.title ?? 'Task-' + uuid(),
    status: overrides.status,
    agentId: overrides.agentId ?? null,
  });
}

// ═══════════════════════════════════════════════════════════════════
// A. Actor Identity (tests 1-5)
// ═══════════════════════════════════════════════════════════════════

describe('Gate 32B — A. Actor Identity', () => {
  it('01: owner identity resolves correctly', async () => {
    const { store, ownerA } = await createFixtures();
    const result = await resolveToolAuthorization({
      store, actorId: ownerA, actorType: 'owner', ownerId: ownerA,
      projectId: null, environment: 'development', resourceType: 'task',
      permission: 'read', actionType: 'read', risk: 'low',
    });
    expect(result.authorized).toBe(true);
    expect(result.reason).toContain('owner');
  });

  it('02: agent identity resolves correctly', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    store.agentPermissions.push({ agentId: agent.id, projectId: projectA.id, resourceType: 'task', permission: 'read' });
    const result = await resolveToolAuthorization({
      store, actorId: agent.id, actorType: 'agent', ownerId: ownerA, agentId: agent.id,
      projectId: projectA.id, environment: 'development', resourceType: 'task',
      permission: 'read', actionType: 'read', risk: 'low',
    });
    expect(result.authorized).toBe(true);
    expect(result.agent).not.toBeNull();
    expect(result.agent!.id).toBe(agent.id);
  });

  it('03: cross-owner agent identity rejected', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const ownerB = 'owner-b-' + uuid();
    const agentB = await makeAgent(store, ownerB);
    const result = await resolveToolAuthorization({
      store, actorId: agentB.id, actorType: 'agent', ownerId: ownerA, agentId: agentB.id,
      projectId: projectA.id, environment: 'development', resourceType: 'task',
      permission: 'read', actionType: 'read', risk: 'low',
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('not found or belongs to another owner');
  });

  it('04: unknown agent rejected', async () => {
    const { store, ownerA } = await createFixtures();
    const result = await resolveToolAuthorization({
      store, actorId: 'nonexistent-agent', actorType: 'agent', ownerId: ownerA, agentId: 'nonexistent-agent',
      projectId: null, environment: 'development', resourceType: 'task',
      permission: 'read', actionType: 'read', risk: 'low',
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('05: spoofed ownerId rejected for agent', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const ownerB = 'owner-b-' + uuid();
    const agentB = await makeAgent(store, ownerB);
    const result = await resolveToolAuthorization({
      store, actorId: agentB.id, actorType: 'agent', ownerId: ownerA, agentId: agentB.id,
      projectId: projectA.id, environment: 'development', resourceType: 'task',
      permission: 'read', actionType: 'read', risk: 'low',
    });
    expect(result.authorized).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. Lifecycle (tests 6-9)
// ═══════════════════════════════════════════════════════════════════

describe('Gate 32B — B. Lifecycle', () => {
  it('06: active agent can proceed to authority evaluation', async () => {
    expect(isAgentLifecycleEligible('active')).toBe(true);
  });

  it('07: paused agent denied', async () => {
    const { store, ownerA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { status: 'paused' });
    const result = await resolveToolAuthorization({
      store, actorId: agent.id, actorType: 'agent', ownerId: ownerA, agentId: agent.id,
      projectId: null, environment: 'development', resourceType: 'task',
      permission: 'read', actionType: 'read', risk: 'low',
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('paused');
  });

  it('08: suspended agent denied', async () => {
    const { store, ownerA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { status: 'suspended' });
    const result = await resolveToolAuthorization({
      store, actorId: agent.id, actorType: 'agent', ownerId: ownerA, agentId: agent.id,
      projectId: null, environment: 'development', resourceType: 'task',
      permission: 'read', actionType: 'read', risk: 'low',
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('suspended');
  });

  it('09: retired agent denied', async () => {
    const { store, ownerA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { status: 'retired' });
    const result = await resolveToolAuthorization({
      store, actorId: agent.id, actorType: 'agent', ownerId: ownerA, agentId: agent.id,
      projectId: null, environment: 'development', resourceType: 'task',
      permission: 'read', actionType: 'read', risk: 'low',
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('retired');
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. Assignment (tests 10-14)
// ═══════════════════════════════════════════════════════════════════

describe('Gate 32B — C. Assignment', () => {
  it('10: assigned agent may attempt assigned task', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id, { agentId: agent.id });
    const check = verifyTaskAssignment(task, agent.id, ownerA);
    expect(check.ok).toBe(true);
  });

  it('11: unassigned agent cannot execute task', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id, { agentId: null });
    const check = verifyTaskAssignment(task, agent.id, ownerA);
    expect(check.ok).toBe(false);
    expect(check.outcome).toBe('task_not_assigned');
  });

  it('12: wrong agent cannot execute another agent task', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agentA = await makeAgent(store, ownerA);
    const agentB = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id, { agentId: agentA.id });
    const check = verifyTaskAssignment(task, agentB.id, ownerA);
    expect(check.ok).toBe(false);
    expect(check.outcome).toBe('assignment_mismatch');
  });

  it('13: cross-owner task execution denied', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const ownerB = 'owner-b-' + uuid();
    const agentB = await makeAgent(store, ownerB);
    const task = await makeTask(store, ownerA, projectA.id);
    task.agentId = agentB.id;
    const check = verifyTaskAssignment(task, agentB.id, ownerB);
    expect(check.ok).toBe(false);
    expect(check.outcome).toBe('owner_mismatch');
  });

  it('14: assignment does not grant tool permission', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    await makeTask(store, ownerA, projectA.id, { agentId: agent.id });
    const hasPerm = await store.agentHasPermission(agent.id, projectA.id, 'task', 'execute');
    expect(hasPerm).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// D. Authority (tests 15-20)
// ═══════════════════════════════════════════════════════════════════

describe('Gate 32B — D. Authority', () => {
  it('15: explicit DENY remains DENY', () => {
    const decision = evaluateAuthority({
      actorId: 'a', actorType: 'agent', projectId: null, environment: 'development',
      resourceType: 'task', permission: 'read', risk: 'low', actionType: 'read',
      authorized: true, explicitDeny: true,
    });
    expect(decision.outcome).toBe('deny');
    expect(decision.denied).toBe(true);
  });

  it('16: agent cannot approve', () => {
    const decision = evaluateAuthority({
      actorId: 'a', actorType: 'agent', projectId: null, environment: 'development',
      resourceType: 'approval', permission: 'approve', risk: 'low', actionType: 'approve',
      authorized: true, explicitDeny: false,
    });
    expect(decision.outcome).toBe('deny');
    expect(decision.reason).toContain('owner-only');
  });

  it('17: protected action requires approval', () => {
    const decision = evaluateAuthority({
      actorId: 'a', actorType: 'agent', projectId: null, environment: 'development',
      resourceType: 'task', permission: 'write', risk: 'high', actionType: 'delete',
      authorized: true, explicitDeny: false,
    });
    expect(decision.outcome).toBe('require_approval');
  });

  it('18: production-sensitive action retains escalation', () => {
    const decision = evaluateAuthority({
      actorId: 'a', actorType: 'agent', projectId: null, environment: 'production',
      resourceType: 'task', permission: 'write', risk: 'medium', actionType: 'write',
      authorized: true, explicitDeny: false,
    });
    expect(decision.outcome).toBe('require_approval');
  });

  it('19: critical-risk action retains escalation', () => {
    const decision = evaluateAuthority({
      actorId: 'a', actorType: 'agent', projectId: null, environment: 'development',
      resourceType: 'task', permission: 'execute', risk: 'critical', actionType: 'financial',
      authorized: true, explicitDeny: false,
    });
    expect(decision.outcome).toBe('require_approval');
  });

  it('20: agent cannot self-escalate via authority', () => {
    const decision = evaluateAuthority({
      actorId: 'a', actorType: 'agent', projectId: null, environment: 'development',
      resourceType: 'task', permission: 'approve', risk: 'low', actionType: 'approve',
      authorized: true, explicitDeny: false,
    });
    expect(decision.outcome).toBe('deny');
  });
});

// ═══════════════════════════════════════════════════════════════════
// E. Permissions (tests 21-25)
// ═══════════════════════════════════════════════════════════════════

describe('Gate 32B — E. Permissions', () => {
  it('21: permissioned low-risk tool action follows policy', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    store.agentPermissions.push({ agentId: agent.id, projectId: projectA.id, resourceType: 'task', permission: 'read' });
    const result = await resolveToolAuthorization({
      store, actorId: agent.id, actorType: 'agent', ownerId: ownerA, agentId: agent.id,
      projectId: projectA.id, environment: 'development', resourceType: 'task',
      permission: 'read', actionType: 'read', risk: 'low',
    });
    expect(result.authorized).toBe(true);
  });

  it('22: missing permission denied', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const result = await resolveToolAuthorization({
      store, actorId: agent.id, actorType: 'agent', ownerId: ownerA, agentId: agent.id,
      projectId: projectA.id, environment: 'development', resourceType: 'task',
      permission: 'write', actionType: 'write', risk: 'medium',
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('permission');
  });

  it('23: capability alone does not grant permission', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['task', 'write'] });
    const result = await resolveToolAuthorization({
      store, actorId: agent.id, actorType: 'agent', ownerId: ownerA, agentId: agent.id,
      projectId: projectA.id, environment: 'development', resourceType: 'task',
      permission: 'write', actionType: 'write', risk: 'medium',
    });
    expect(result.authorized).toBe(false);
  });

  it('24: role alone does not grant permission', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { role: 'admin' });
    const result = await resolveToolAuthorization({
      store, actorId: agent.id, actorType: 'agent', ownerId: ownerA, agentId: agent.id,
      projectId: projectA.id, environment: 'development', resourceType: 'task',
      permission: 'write', actionType: 'write', risk: 'medium',
    });
    expect(result.authorized).toBe(false);
  });

  it('25: task requirement alone does not grant permission', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id, {
      agentId: agent.id,
      title: 'requires-special-capability',
    });
    const result = await resolveToolAuthorization({
      store, actorId: agent.id, actorType: 'agent', ownerId: ownerA, agentId: agent.id,
      projectId: projectA.id, environment: 'development', resourceType: 'task',
      permission: 'write', actionType: 'write', risk: 'medium',
    });
    expect(result.authorized).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// G. ToolBroker (tests 31-34)
// ═══════════════════════════════════════════════════════════════════

describe('Gate 32B — G. ToolBroker', () => {
  it('31: agent cannot bypass ToolBroker', async () => {
    const broker = new ToolBroker();
    let handlerCalled = false;
    broker.register({
      name: 'test_tool',
      action: 'test',
      minRisk: 'low',
      run: async () => { handlerCalled = true; return { ok: true }; },
    });
    await broker.call(
      { tool: 'test_tool', args: {}, actorId: 'a', actorType: 'agent', projectId: null, environment: 'development', risk: 'low' },
      { decision: 'deny', approved: false },
    );
    expect(handlerCalled).toBe(false);
  });

  it('32: tool not executed when denied', async () => {
    const broker = new ToolBroker();
    let handlerCalled = false;
    broker.register({
      name: 'test_tool',
      action: 'test',
      minRisk: 'low',
      run: async () => { handlerCalled = true; return { ok: true }; },
    });
    const result = await broker.call(
      { tool: 'test_tool', args: {}, actorId: 'a', actorType: 'agent', projectId: null, environment: 'development', risk: 'low' },
      { decision: 'deny', approved: false, execute: true },
    );
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('denied_by_authority');
    expect(handlerCalled).toBe(false);
  });

  it('33: tool not executed while approval required', async () => {
    const broker = new ToolBroker();
    let handlerCalled = false;
    broker.register({
      name: 'test_tool',
      action: 'test',
      minRisk: 'low',
      run: async () => { handlerCalled = true; return { ok: true }; },
    });
    const result = await broker.call(
      { tool: 'test_tool', args: {}, actorId: 'a', actorType: 'agent', projectId: null, environment: 'development', risk: 'low' },
      { decision: 'require_approval', approved: false, execute: true },
    );
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('requires_approval');
    expect(handlerCalled).toBe(false);
  });

  it('34: tool executes only after all boundaries allow it', async () => {
    const broker = new ToolBroker();
    let handlerCalled = false;
    broker.register({
      name: 'test_tool',
      action: 'test',
      minRisk: 'low',
      run: async () => { handlerCalled = true; return { ok: true }; },
    });
    const result = await broker.call(
      { tool: 'test_tool', args: {}, actorId: 'a', actorType: 'owner', projectId: null, environment: 'development', risk: 'low' },
      { decision: 'auto', approved: true, execute: true },
    );
    expect(result.ok).toBe(true);
    expect(handlerCalled).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// H. Owner Regression (tests 35-37)
// ═══════════════════════════════════════════════════════════════════

describe('Gate 32B — H. Owner Regression', () => {
  it('35: existing owner execution remains functional', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const result = await resolveToolAuthorization({
      store, actorId: ownerA, actorType: 'owner', ownerId: ownerA,
      projectId: projectA.id, environment: 'development', resourceType: 'task',
      permission: 'write', actionType: 'write', risk: 'medium',
    });
    expect(result.authorized).toBe(true);
  });

  it('36: owner still requires approval where existing policy requires it', () => {
    const decision = evaluateAuthority({
      actorId: 'owner-a', actorType: 'owner', projectId: 'p1', environment: 'production',
      resourceType: 'task', permission: 'write', risk: 'medium', actionType: 'deploy',
      authorized: true, explicitDeny: false,
    });
    expect(decision.outcome).toBe('require_approval');
  });

  it('37: owner explicit deny still wins', () => {
    const decision = evaluateAuthority({
      actorId: 'owner-a', actorType: 'owner', projectId: 'p1', environment: 'development',
      resourceType: 'task', permission: 'read', risk: 'low', actionType: 'read',
      authorized: true, explicitDeny: true,
    });
    expect(decision.outcome).toBe('deny');
  });
});

// ═══════════════════════════════════════════════════════════════════
// J. Hardcoded Authorization (tests 43-45)
// ═══════════════════════════════════════════════════════════════════

describe('Gate 32B — J. Hardcoded Authorization', () => {
  it('43: no agent production execution path depends on authorized:true', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const result = await resolveToolAuthorization({
      store, actorId: agent.id, actorType: 'agent', ownerId: ownerA, agentId: agent.id,
      projectId: projectA.id, environment: 'development', resourceType: 'task',
      permission: 'read', actionType: 'read', risk: 'low',
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('permission');
  });

  it('44: agent cannot obtain owner authority by entering execution runner', async () => {
    const { store, ownerA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const decision = evaluateAuthority({
      actorId: agent.id, actorType: 'agent', projectId: null, environment: 'development',
      resourceType: 'task', permission: 'approve', risk: 'low', actionType: 'approve',
      authorized: true, explicitDeny: false,
    });
    expect(decision.outcome).toBe('deny');
  });

  it('45: orchestration path does not silently authorize agent', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const result = await resolveAgentAuthority({
      store, agentId: agent.id, ownerId: ownerA, projectId: projectA.id,
      environment: 'development', resourceType: 'tool', permission: 'write',
      actionType: 'write', risk: 'medium',
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).not.toBe('authorized');
  });
});

// ═══════════════════════════════════════════════════════════════════
// K. Autonomy Clamp (tests 46-49)
// ═══════════════════════════════════════════════════════════════════

describe('Gate 32B — K. Autonomy Clamp', () => {
  it('46: clamp never raises autonomy above authority ceiling', () => {
    const clamped = clampAutonomy('auto', 'notify');
    expect(clamped).toBe('notify');
  });

  it('47: DENY cannot become AUTO', () => {
    const clamped = clampAutonomy('auto', 'deny');
    expect(clamped).toBe('deny');
  });

  it('48: REQUIRE_APPROVAL cannot become AUTO for agent', () => {
    const clamped = clampAutonomy('auto', 'require_approval');
    expect(clamped).toBe('require_approval');
  });

  it('49: safe existing owner behavior preserved', () => {
    expect(clampAutonomy('auto', 'auto')).toBe('auto');
    expect(clampAutonomy('notify', 'auto')).toBe('notify');
    expect(clampAutonomy('notify', 'notify')).toBe('notify');
    expect(clampAutonomy('require_approval', 'notify')).toBe('require_approval');
    expect(clampAutonomy('deny', 'deny')).toBe('deny');
    expect(clampAutonomy('deny', 'auto')).toBe('deny');
    expect(clampAutonomy('notify', 'deny')).toBe('deny');
    expect(clampAutonomy('require_approval', 'deny')).toBe('deny');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Additional: resolveAgentAuthority full flow
// ═══════════════════════════════════════════════════════════════════

describe('Gate 32B — Full Agent Authority Resolution', () => {
  it('permissioned agent in active lifecycle resolves authorized', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    store.agentPermissions.push({ agentId: agent.id, projectId: projectA.id, resourceType: 'tool', permission: 'write' });
    const result = await resolveAgentAuthority({
      store, agentId: agent.id, ownerId: ownerA, projectId: projectA.id,
      environment: 'development', resourceType: 'tool', permission: 'write',
      actionType: 'write', risk: 'medium',
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('authorized');
  });

  it('unpermissioned agent resolves permission_denied', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const result = await resolveAgentAuthority({
      store, agentId: agent.id, ownerId: ownerA, projectId: projectA.id,
      environment: 'development', resourceType: 'tool', permission: 'write',
      actionType: 'write', risk: 'medium',
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('permission_denied');
  });

  it('paused agent resolves agent_inactive', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { status: 'paused' });
    const result = await resolveAgentAuthority({
      store, agentId: agent.id, ownerId: ownerA, projectId: projectA.id,
      environment: 'development', resourceType: 'tool', permission: 'read',
      actionType: 'read', risk: 'low',
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('agent_inactive');
  });

  it('agent trying to approve resolves authority_denied', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    store.agentPermissions.push({ agentId: agent.id, projectId: projectA.id, resourceType: 'approval', permission: 'approve' });
    const result = await resolveAgentAuthority({
      store, agentId: agent.id, ownerId: ownerA, projectId: projectA.id,
      environment: 'development', resourceType: 'approval', permission: 'approve',
      actionType: 'approve', risk: 'low',
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('authority_denied');
  });

  it('production write with agent resolves approval_required', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    store.agentPermissions.push({ agentId: agent.id, projectId: projectA.id, resourceType: 'tool', permission: 'write' });
    const result = await resolveAgentAuthority({
      store, agentId: agent.id, ownerId: ownerA, projectId: projectA.id,
      environment: 'production', resourceType: 'tool', permission: 'write',
      actionType: 'write', risk: 'medium',
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('approval_required');
  });

  it('agent read action in development resolves authorized', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    store.agentPermissions.push({ agentId: agent.id, projectId: projectA.id, resourceType: 'tool', permission: 'read' });
    const result = await resolveAgentAuthority({
      store, agentId: agent.id, ownerId: ownerA, projectId: projectA.id,
      environment: 'development', resourceType: 'tool', permission: 'read',
      actionType: 'read', risk: 'low',
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('authorized');
    expect(result.autonomy.selected).toBe('auto');
  });

  it('agent evidence includes all verification steps', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    store.agentPermissions.push({ agentId: agent.id, projectId: projectA.id, resourceType: 'tool', permission: 'read' });
    const result = await resolveAgentAuthority({
      store, agentId: agent.id, ownerId: ownerA, projectId: projectA.id,
      environment: 'development', resourceType: 'tool', permission: 'read',
      actionType: 'read', risk: 'low',
    });
    expect(result.evidence.some((e) => e.startsWith('agentId='))).toBe(true);
    expect(result.evidence.some((e) => e.startsWith('ownerId='))).toBe(true);
    expect(result.evidence.some((e) => e.startsWith('agent.status='))).toBe(true);
    expect(result.evidence.some((e) => e.includes('permission_granted'))).toBe(true);
    expect(result.evidence.some((e) => e.startsWith('authority.outcome='))).toBe(true);
    expect(result.evidence.some((e) => e.startsWith('autonomy.selected='))).toBe(true);
  });
});
