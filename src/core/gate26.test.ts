import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { setTaskAssignment } from './assignment.js';

async function setup() {
  const store = new MemoryStore();
  await store.createProject('owner-1', { name: 'P', slug: 'p', description: 'test' });
  return store;
}

async function createTask(store: MemoryStore, ownerId = 'owner-1') {
  const projects = await store.listProjects(ownerId);
  return store.createTask(ownerId, { projectId: projects[0]!.id, title: 'Test Task', priority: 'medium' });
}

let agentCounter = 0;
async function createAgent(store: MemoryStore, overrides?: { status?: 'active' | 'paused' | 'retired' | 'suspended'; ownerId?: string }) {
  agentCounter++;
  return store.createAgent(overrides?.ownerId ?? 'owner-1', {
    name: `Worker ${agentCounter}`,
    slug: `worker-${agentCounter}`,
    role: 'engineer',
    status: overrides?.status ?? 'active',
  });
}

// ---------------------------------------------------------------------------
// ASSIGNMENT — Eligibility
// ---------------------------------------------------------------------------

describe('Gate 26 — Assignment Eligibility', () => {
  it('active valid agent can be assigned', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store, { status: 'active' });

    const r = await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    expect(r.ok).toBe(true);
    expect(r.nextAgentId).toBe(agent.id);
    expect(r.previousAgentId).toBeNull();
    expect(r.task.agentId).toBe(agent.id);
  });

  it('paused agent is rejected', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store, { status: 'paused' });

    const r = await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_eligible');
  });

  it('retired agent is rejected', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store, { status: 'retired' });

    const r = await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_eligible');
  });

  it('suspended agent is rejected', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store, { status: 'suspended' });

    const r = await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_eligible');
  });

  it('unknown agent is rejected', async () => {
    const store = await setup();
    const task = await createTask(store);

    const r = await setTaskAssignment(store, 'owner-1', task.id, 'nonexistent-agent', 'owner-1');
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_found');
  });

  it('unknown task is rejected', async () => {
    const store = await setup();
    const agent = await createAgent(store);

    const r = await setTaskAssignment(store, 'owner-1', 'nonexistent-task', agent.id, 'owner-1');
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('task_not_found');
  });

  it('valid same-owner assignment succeeds', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store);

    const r = await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    expect(r.ok).toBe(true);
    expect(r.task.agentId).toBe(agent.id);
  });

  it('cross-owner assignment is rejected', async () => {
    const store = await setup();
    const otherAgent = await createAgent(store, { ownerId: 'owner-2' });
    await store.createProject('owner-2', { name: 'Other', slug: 'other' });
    const task = await createTask(store);

    const r = await setTaskAssignment(store, 'owner-1', task.id, otherAgent.id, 'owner-1');
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_found');
  });
});

// ---------------------------------------------------------------------------
// PERMISSION — Assignment must NOT grant authority
// ---------------------------------------------------------------------------

describe('Gate 26 — Permission Isolation', () => {
  it('assignment does not grant tool permission', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store);

    await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');

    const hasPermission = await store.agentHasPermission(agent.id, null, 'task', 'write');
    expect(hasPermission).toBe(false);
  });

  it('role does not grant delegation permission', async () => {
    const store = await setup();
    const agent = await createAgent(store);
    const task = await createTask(store);

    const r = await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    expect(r.ok).toBe(true);

    const adminAgent = await store.createAgent('owner-1', { name: 'Admin', slug: 'admin-x', role: 'admin', status: 'active' });
    const task2 = await createTask(store);
    const r2 = await setTaskAssignment(store, 'owner-1', task2.id, adminAgent.id, 'owner-1');
    expect(r2.ok).toBe(true);
  });

  it('capability does not grant delegation permission', async () => {
    const store = await setup();
    const agent = await createAgent(store);
    const task = await createTask(store);

    const r = await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    expect(r.ok).toBe(true);

    const hasPermission = await store.agentHasPermission(agent.id, null, 'task', 'write');
    expect(hasPermission).toBe(false);
  });

  it('unauthorized actor (agent) cannot assign', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agentA = await store.createAgent('owner-1', { name: 'A', slug: 'a-ua', role: 'worker', status: 'active' });
    const agentB = await store.createAgent('owner-1', { name: 'B', slug: 'b-ua', role: 'worker', status: 'active' });

    await expect(setTaskAssignment(store, 'owner-1', task.id, agentB.id, agentA.id))
      .rejects.toThrow(/only the owner may assign/);
  });

  it('unauthorized actor (different owner) cannot assign', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store);

    await expect(setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-2'))
      .rejects.toThrow(/only the owner may assign/);
  });

  it('agent cannot self-escalate through assignment', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store);

    await expect(setTaskAssignment(store, 'owner-1', task.id, agent.id, agent.id))
      .rejects.toThrow(/only the owner may assign/);
  });
});

// ---------------------------------------------------------------------------
// REASSIGNMENT
// ---------------------------------------------------------------------------

describe('Gate 26 — Reassignment', () => {
  it('reassignment updates agentId', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agentA = await store.createAgent('owner-1', { name: 'A', slug: 'ra', role: 'worker', status: 'active' });
    const agentB = await store.createAgent('owner-1', { name: 'B', slug: 'rb', role: 'worker', status: 'active' });

    const r1 = await setTaskAssignment(store, 'owner-1', task.id, agentA.id, 'owner-1');
    expect(r1.ok).toBe(true);
    expect(r1.task.agentId).toBe(agentA.id);

    const r2 = await setTaskAssignment(store, 'owner-1', task.id, agentB.id, 'owner-1');
    expect(r2.ok).toBe(true);
    expect(r2.previousAgentId).toBe(agentA.id);
    expect(r2.nextAgentId).toBe(agentB.id);
    expect(r2.task.agentId).toBe(agentB.id);
  });

  it('reassigning same agent returns no-change', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store);

    await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    const r2 = await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    expect(r2.ok).toBe(true);
    expect(r2.reason).toContain('no change');
  });

  it('cannot reassign to inactive agent', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agentA = await store.createAgent('owner-1', { name: 'A', slug: 'rra', role: 'worker', status: 'active' });
    const agentB = await store.createAgent('owner-1', { name: 'B', slug: 'rrb', role: 'worker', status: 'paused' });

    await setTaskAssignment(store, 'owner-1', task.id, agentA.id, 'owner-1');
    const r = await setTaskAssignment(store, 'owner-1', task.id, agentB.id, 'owner-1');
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_eligible');
  });
});

// ---------------------------------------------------------------------------
// UNASSIGN
// ---------------------------------------------------------------------------

describe('Gate 26 — Unassignment', () => {
  it('unassignment clears agentId', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store);

    await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    const r = await setTaskAssignment(store, 'owner-1', task.id, null, 'owner-1');
    expect(r.ok).toBe(true);
    expect(r.previousAgentId).toBe(agent.id);
    expect(r.nextAgentId).toBeNull();
    expect(r.task.agentId).toBeNull();
  });

  it('unassigning already-unassigned task is no-op', async () => {
    const store = await setup();
    const task = await createTask(store);

    const r = await setTaskAssignment(store, 'owner-1', task.id, null, 'owner-1');
    expect(r.ok).toBe(true);
    expect(r.reason).toContain('no change');
  });

  it('assign then unassign round-trip', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store);

    await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    const verify1 = await store.getTask('owner-1', task.id);
    expect(verify1?.agentId).toBe(agent.id);

    await setTaskAssignment(store, 'owner-1', task.id, null, 'owner-1');
    const verify2 = await store.getTask('owner-1', task.id);
    expect(verify2?.agentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PERSISTENCE — Data integrity
// ---------------------------------------------------------------------------

describe('Gate 26 — Persistence', () => {
  it('assigned agentId persists correctly', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store);

    await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    const fetched = await store.getTask('owner-1', task.id);
    expect(fetched?.agentId).toBe(agent.id);
  });

  it('reassignment persists correctly', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agentA = await store.createAgent('owner-1', { name: 'A', slug: 'pa', role: 'worker', status: 'active' });
    const agentB = await store.createAgent('owner-1', { name: 'B', slug: 'pb', role: 'worker', status: 'active' });

    await setTaskAssignment(store, 'owner-1', task.id, agentA.id, 'owner-1');
    await setTaskAssignment(store, 'owner-1', task.id, agentB.id, 'owner-1');
    const fetched = await store.getTask('owner-1', task.id);
    expect(fetched?.agentId).toBe(agentB.id);
  });

  it('partial task data is preserved on assignment', async () => {
    const store = await setup();
    const projects = await store.listProjects('owner-1');
    const task = await store.createTask('owner-1', {
      projectId: projects[0]!.id,
      title: 'Important Task',
      description: 'Keep this description',
      priority: 'critical',
    });
    const agent = await createAgent(store);

    await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    const fetched = await store.getTask('owner-1', task.id);
    expect(fetched?.title).toBe('Important Task');
    expect(fetched?.description).toBe('Keep this description');
    expect(fetched?.priority).toBe('critical');
    expect(fetched?.agentId).toBe(agent.id);
  });

  it('failed validation causes zero mutation', async () => {
    const store = await setup();
    const task = await createTask(store);

    try {
      await setTaskAssignment(store, 'owner-1', task.id, 'nonexistent', 'owner-1');
    } catch {
      // expected
    }
    const fetched = await store.getTask('owner-1', task.id);
    expect(fetched?.agentId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AUDIT
// ---------------------------------------------------------------------------

describe('Gate 26 — Audit', () => {
  it('successful assignment is auditable', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store);
    const before = store.audit.length;

    await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    expect(store.audit.length).toBe(before + 1);

    const event = store.audit[store.audit.length - 1]!;
    expect(event.action).toBe('task.assigned');
    expect(event.taskId).toBe(task.id);
    expect(event.actorId).toBe('owner-1');
    expect(event.resourceType).toBe('task');
  });

  it('reassignment is auditable', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agentA = await store.createAgent('owner-1', { name: 'A', slug: 'aa', role: 'worker', status: 'active' });
    const agentB = await store.createAgent('owner-1', { name: 'B', slug: 'bb', role: 'worker', status: 'active' });

    await setTaskAssignment(store, 'owner-1', task.id, agentA.id, 'owner-1');
    await setTaskAssignment(store, 'owner-1', task.id, agentB.id, 'owner-1');

    const reassignEvent = store.audit[store.audit.length - 1]!;
    expect(reassignEvent.action).toBe('task.reassigned');
    expect(reassignEvent.taskId).toBe(task.id);
  });

  it('unassignment is auditable', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store);

    await setTaskAssignment(store, 'owner-1', task.id, agent.id, 'owner-1');
    await setTaskAssignment(store, 'owner-1', task.id, null, 'owner-1');

    const unassignEvent = store.audit[store.audit.length - 1]!;
    expect(unassignEvent.action).toBe('task.unassigned');
    expect(unassignEvent.taskId).toBe(task.id);
  });
});

// ---------------------------------------------------------------------------
// INPUT VALIDATION
// ---------------------------------------------------------------------------

describe('Gate 26 — Input Validation', () => {
  it('empty taskId is rejected', async () => {
    const store = await setup();
    const agent = await createAgent(store);

    await expect(setTaskAssignment(store, 'owner-1', '', agent.id, 'owner-1'))
      .rejects.toThrow(/invalid taskId/);
  });

  it('empty agentId string is rejected', async () => {
    const store = await setup();
    const task = await createTask(store);

    await expect(setTaskAssignment(store, 'owner-1', task.id, '', 'owner-1'))
      .rejects.toThrow(/invalid agentId/);
  });

  it('empty ownerId is rejected', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store);

    await expect(setTaskAssignment(store, '', task.id, agent.id, 'owner-1'))
      .rejects.toThrow(/invalid ownerId/);
  });

  it('empty actorId is rejected', async () => {
    const store = await setup();
    const task = await createTask(store);
    const agent = await createAgent(store);

    await expect(setTaskAssignment(store, 'owner-1', task.id, agent.id, ''))
      .rejects.toThrow(/invalid actorId/);
  });
});
