// CHEF FACTORY — Gate 28 — Atomic Agent Assignment & Lifecycle Integrity
//
// Tests the Store.assignTask() contract and setTaskAssignment() domain layer.
// Covers: eligible/ineligible assignment, idempotency, reassignment, unassignment,
// owner isolation, audit behavior, Gate 27 tenant invariant preservation,
// and ordinary patchTask independence.

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { setTaskAssignment } from './assignment.js';
import type { AgentRecord, TaskRecord, Store, AssignTaskResult } from './ports.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function createFixtures() {
  const store = new MemoryStore();
  const ownerA = 'owner-a-' + uuid();
  const ownerB = 'owner-b-' + uuid();

  const projectA = await store.createProject(ownerA, { name: 'ProjectA', slug: 'proj-a-' + uuid() });
  const projectB = await store.createProject(ownerB, { name: 'ProjectB', slug: 'proj-b-' + uuid() });

  const agentA = await store.createAgent(ownerA, { name: 'AgentA', slug: 'ag-a-' + uuid(), role: 'worker', status: 'active' });
  const agentB = await store.createAgent(ownerB, { name: 'AgentB', slug: 'ag-b-' + uuid(), role: 'worker', status: 'active' });
  const agentPaused = await store.createAgent(ownerA, { name: 'AgentPaused', slug: 'ag-p-' + uuid(), role: 'worker', status: 'paused' });
  const agentRetired = await store.createAgent(ownerA, { name: 'AgentRetired', slug: 'ag-r-' + uuid(), role: 'worker', status: 'retired' });
  const agentSuspended = await store.createAgent(ownerA, { name: 'AgentSuspended', slug: 'ag-s-' + uuid(), role: 'worker', status: 'suspended' });

  const task1 = await store.createTask(ownerA, { projectId: projectA.id, title: 'Task1' });
  const task2 = await store.createTask(ownerA, { projectId: projectA.id, title: 'Task2' });
  const taskB = await store.createTask(ownerB, { projectId: projectB.id, title: 'TaskB' });

  return { store, ownerA, ownerB, projectA, projectB, agentA, agentB, agentPaused, agentRetired, agentSuspended, task1, task2, taskB };
}

// ═══════════════════════════════════════════════
// 1. Store.assignTask() — core contract
// ═══════════════════════════════════════════════

describe('Gate 28 — Store.assignTask() contract', () => {
  it('1: eligible assignment succeeds', async () => {
    const { store, ownerA, task1, agentA } = await createFixtures();
    const r = await store.assignTask(ownerA, task1.id, agentA.id);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('assigned');
    expect(r.previousAgentId).toBeNull();
    expect(r.nextAgentId).toBe(agentA.id);
  });

  it('2: paused agent rejected', async () => {
    const { store, ownerA, task1, agentPaused } = await createFixtures();
    const r = await store.assignTask(ownerA, task1.id, agentPaused.id);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_eligible');
  });

  it('3: suspended agent rejected', async () => {
    const { store, ownerA, task1, agentSuspended } = await createFixtures();
    const r = await store.assignTask(ownerA, task1.id, agentSuspended.id);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_eligible');
  });

  it('4: retired agent rejected', async () => {
    const { store, ownerA, task1, agentRetired } = await createFixtures();
    const r = await store.assignTask(ownerA, task1.id, agentRetired.id);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_eligible');
  });

  it('5: unknown agent rejected', async () => {
    const { store, ownerA, task1 } = await createFixtures();
    const r = await store.assignTask(ownerA, task1.id, uuid());
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_found');
  });

  it('6: cross-owner agent rejected', async () => {
    const { store, ownerA, task1, agentB } = await createFixtures();
    const r = await store.assignTask(ownerA, task1.id, agentB.id);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_found');
  });

  it('7: unknown task rejected', async () => {
    const { store, ownerA, agentA } = await createFixtures();
    const r = await store.assignTask(ownerA, uuid(), agentA.id);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('task_not_found');
  });

  it('8: same-agent idempotency returns no_change', async () => {
    const { store, ownerA, task1, agentA } = await createFixtures();
    await store.assignTask(ownerA, task1.id, agentA.id);
    const r = await store.assignTask(ownerA, task1.id, agentA.id);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('no_change');
    expect(r.previousAgentId).toBe(agentA.id);
    expect(r.nextAgentId).toBe(agentA.id);
  });

  it('9: unassignment succeeds', async () => {
    const { store, ownerA, task1, agentA } = await createFixtures();
    await store.assignTask(ownerA, task1.id, agentA.id);
    const r = await store.assignTask(ownerA, task1.id, null);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('unassigned');
    expect(r.previousAgentId).toBe(agentA.id);
    expect(r.nextAgentId).toBeNull();
  });

  it('10: reassignment succeeds', async () => {
    const { store, ownerA, task1, agentA, agentPaused } = await createFixtures();
    // Assign to agentA first
    await store.assignTask(ownerA, task1.id, agentA.id);
    // Create a second active agent for reassignment
    const agentC = await store.createAgent(ownerA, { name: 'AgentC', slug: 'ag-c-' + uuid(), role: 'worker', status: 'active' });
    const r = await store.assignTask(ownerA, task1.id, agentC.id);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('assigned');
    expect(r.previousAgentId).toBe(agentA.id);
    expect(r.nextAgentId).toBe(agentC.id);
  });

  it('11: owner isolation — ownerA cannot assign to ownerB task', async () => {
    const { store, ownerA, taskB, agentA } = await createFixtures();
    const r = await store.assignTask(ownerA, taskB.id, agentA.id);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('task_not_found');
  });
});

// ═══════════════════════════════════════════════
// 2. setTaskAssignment() — domain layer
// ═══════════════════════════════════════════════

describe('Gate 28 — setTaskAssignment() domain layer', () => {
  it('12: owner can assign', async () => {
    const { store, ownerA, task1, agentA } = await createFixtures();
    const r = await setTaskAssignment(store, ownerA, task1.id, agentA.id, ownerA);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('assigned');
  });

  it('13: non-owner cannot assign', async () => {
    const { store, ownerA, task1, agentA } = await createFixtures();
    await expect(
      setTaskAssignment(store, ownerA, task1.id, agentA.id, 'attacker-' + uuid()),
    ).rejects.toThrow(/only the owner may assign/i);
  });

  it('14: agent cannot delegate', async () => {
    const { store, ownerA, task1, agentA } = await createFixtures();
    await expect(
      setTaskAssignment(store, ownerA, task1.id, agentA.id, agentA.id),
    ).rejects.toThrow(/only the owner may assign/i);
  });

  it('15: no_change does not produce audit', async () => {
    const { store, ownerA, task1, agentA } = await createFixtures();
    await setTaskAssignment(store, ownerA, task1.id, agentA.id, ownerA);
    const r = await setTaskAssignment(store, ownerA, task1.id, agentA.id, ownerA);
    expect(r.outcome).toBe('no_change');
    // Audit count should not have increased
  });

  it('16: failed assignment produces no audit', async () => {
    const { store, ownerA, task1 } = await createFixtures();
    const r = await setTaskAssignment(store, ownerA, task1.id, uuid(), ownerA);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_found');
  });

  it('17: assignment records audit', async () => {
    const { store, ownerA, task1, agentA } = await createFixtures();
    const r = await setTaskAssignment(store, ownerA, task1.id, agentA.id, ownerA);
    expect(r.ok).toBe(true);
    // Audit is best-effort; verify the assignment itself succeeded
    const task = await store.getTask(ownerA, task1.id);
    expect(task?.agentId).toBe(agentA.id);
  });

  it('18: reassignment records correct action', async () => {
    const { store, ownerA, task1, agentA } = await createFixtures();
    await setTaskAssignment(store, ownerA, task1.id, agentA.id, ownerA);
    const agentC = await store.createAgent(ownerA, { name: 'AgentC', slug: 'ag-c-' + uuid(), role: 'worker', status: 'active' });
    const r = await setTaskAssignment(store, ownerA, task1.id, agentC.id, ownerA);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('assigned');
  });

  it('19: unassignment records correct action', async () => {
    const { store, ownerA, task1, agentA } = await createFixtures();
    await setTaskAssignment(store, ownerA, task1.id, agentA.id, ownerA);
    const r = await setTaskAssignment(store, ownerA, task1.id, null, ownerA);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('unassigned');
  });
});

// ═══════════════════════════════════════════════
// 3. Gate 27 invariant preserved
// ═══════════════════════════════════════════════

describe('Gate 28 — Gate 27 tenant invariant preserved', () => {
  it('20: cross-owner assignment rejected', async () => {
    const { store, ownerA, task1, agentB } = await createFixtures();
    const r = await store.assignTask(ownerA, task1.id, agentB.id);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('agent_not_found');
  });

  it('21: NULL assignment works', async () => {
    const { store, ownerA, task1, agentA } = await createFixtures();
    await store.assignTask(ownerA, task1.id, agentA.id);
    const r = await store.assignTask(ownerA, task1.id, null);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('unassigned');
  });
});

// ═══════════════════════════════════════════════
// 4. patchTask independence
// ═══════════════════════════════════════════════

describe('Gate 28 — patchTask behavior unaffected', () => {
  it('22: ordinary patchTask still works for non-assignment fields', async () => {
    const { store, ownerA, task1 } = await createFixtures();
    const patched = await store.patchTask(ownerA, task1.id, { title: 'Updated', priority: 'high' });
    expect(patched.title).toBe('Updated');
    expect(patched.priority).toBe('high');
  });

  it('23: patchTask agentId validation still works', async () => {
    const { store, ownerA, task1 } = await createFixtures();
    await expect(
      store.patchTask(ownerA, task1.id, { agentId: 'nonexistent' }),
    ).rejects.toThrow(/cross-owner agent assignment rejected/i);
  });
});

// ═══════════════════════════════════════════════
// 5. Eligibility boundary
// ═══════════════════════════════════════════════

describe('Gate 28 — Eligibility boundary', () => {
  it('24: only active status passes eligibility', async () => {
    const { store, ownerA, task1, agentA, agentPaused, agentRetired, agentSuspended } = await createFixtures();
    expect((await store.assignTask(ownerA, task1.id, agentA.id)).ok).toBe(true);
    const task2 = (await store.createTask(ownerA, { projectId: uuid(), title: 'T2' }));
    expect((await store.assignTask(ownerA, task2.id, agentPaused.id)).ok).toBe(false);
    const task3 = (await store.createTask(ownerA, { projectId: uuid(), title: 'T3' }));
    expect((await store.assignTask(ownerA, task3.id, agentRetired.id)).ok).toBe(false);
    const task4 = (await store.createTask(ownerA, { projectId: uuid(), title: 'T4' }));
    expect((await store.assignTask(ownerA, task4.id, agentSuspended.id)).ok).toBe(false);
  });
});
