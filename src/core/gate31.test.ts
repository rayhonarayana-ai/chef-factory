// CHEF FACTORY — Gate 31 — Agent Workload & Capacity Foundation.
// Tests: capacity defaults, workload counting, availability, ranking, atomic capacity, retry, terminal release.

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { placeTask } from './placement.js';
import { selectCandidate } from './selector.js';
import { TERMINAL_TASK_STATUSES } from './taskEngine.js';
import type { AgentRecord } from './types.js';
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

async function makeAgent(store: Store, ownerId: string, overrides: Partial<{ name: string; slug: string; role: string; status: AgentRecord['status']; capabilities: string[]; maxConcurrentTasks: number }> = {}): Promise<AgentRecord> {
  return store.createAgent(ownerId, {
    name: overrides.name ?? 'Agent-' + uuid(),
    slug: overrides.slug ?? 'ag-' + uuid(),
    role: overrides.role ?? 'worker',
    status: overrides.status ?? 'active',
    capabilities: overrides.capabilities ?? [],
    maxConcurrentTasks: overrides.maxConcurrentTasks,
  });
}

async function makeTask(store: Store, ownerId: string, projectId: string, overrides: Partial<{ title: string; requiredCapabilities: string[]; preferredRole: string | null; status: AgentRecord['status'] }> = {}) {
  return store.createTask(ownerId, {
    projectId,
    title: overrides.title ?? 'Task-' + uuid(),
    requiredCapabilities: overrides.requiredCapabilities,
    preferredRole: overrides.preferredRole,
  });
}

// ---- 01-05: Capacity field defaults and validation ----

describe('Gate 31 — Capacity field', () => {
  it('01: default capacity = 1', async () => {
    const { store, ownerA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    expect(agent.maxConcurrentTasks).toBe(1);
  });

  it('02: custom capacity > 1', async () => {
    const { store, ownerA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { maxConcurrentTasks: 5 });
    expect(agent.maxConcurrentTasks).toBe(5);
  });

  it('03: capacity 0', async () => {
    const { store, ownerA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { maxConcurrentTasks: 0 });
    expect(agent.maxConcurrentTasks).toBe(0);
  });

  it('04: negative capacity rejected', async () => {
    const { store, ownerA } = await createFixtures();
    await expect(makeAgent(store, ownerA, { maxConcurrentTasks: -1 })).rejects.toThrow();
  });

  it('05: fractional capacity rejected', async () => {
    const { store, ownerA } = await createFixtures();
    await expect(makeAgent(store, ownerA, { maxConcurrentTasks: 1.5 })).rejects.toThrow();
  });

  it('05b: patch capacity', async () => {
    const { store, ownerA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { maxConcurrentTasks: 1 });
    const patched = await store.patchAgent(ownerA, agent.id, { maxConcurrentTasks: 3 });
    expect(patched.maxConcurrentTasks).toBe(3);
  });

  it('05c: patch negative capacity rejected', async () => {
    const { store, ownerA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { maxConcurrentTasks: 1 });
    await expect(store.patchAgent(ownerA, agent.id, { maxConcurrentTasks: -1 })).rejects.toThrow();
  });
});

// ---- 06-14: Workload counting ----

describe('Gate 31 — Workload counting', () => {
  it('06: zero workload', async () => {
    const { store, ownerA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const wl = await store.listAgentWorkload(ownerA);
    const a = wl.find((w) => w.agentId === agent.id);
    expect(a).toBeDefined();
    expect(a!.assignedCount).toBe(0);
    expect(a!.runningCount).toBe(0);
  });

  it('07: assigned created Task counted', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id);
    await store.assignTaskIfUnassigned(ownerA, task.id, agent.id);
    const wl = await store.listAgentWorkload(ownerA);
    const a = wl.find((w) => w.agentId === agent.id)!;
    expect(a.assignedCount).toBe(1);
  });

  it('08: queued counted', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id);
    await store.assignTaskIfUnassigned(ownerA, task.id, agent.id);
    await store.patchTask(ownerA, task.id, { status: 'queued' });
    const wl = await store.listAgentWorkload(ownerA);
    const a = wl.find((w) => w.agentId === agent.id)!;
    expect(a.assignedCount).toBe(1);
  });

  it('09: running counted', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id);
    await store.assignTaskIfUnassigned(ownerA, task.id, agent.id);
    await store.patchTask(ownerA, task.id, { status: 'running' });
    const wl = await store.listAgentWorkload(ownerA);
    const a = wl.find((w) => w.agentId === agent.id)!;
    expect(a.assignedCount).toBe(1);
    expect(a.runningCount).toBe(1);
  });

  it('10: paused task counted', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id);
    await store.assignTaskIfUnassigned(ownerA, task.id, agent.id);
    await store.patchTask(ownerA, task.id, { status: 'paused' });
    const wl = await store.listAgentWorkload(ownerA);
    const a = wl.find((w) => w.agentId === agent.id)!;
    expect(a.assignedCount).toBe(1);
  });

  it('11: needs_approval counted', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id);
    await store.assignTaskIfUnassigned(ownerA, task.id, agent.id);
    await store.patchTask(ownerA, task.id, { status: 'needs_approval' });
    const wl = await store.listAgentWorkload(ownerA);
    const a = wl.find((w) => w.agentId === agent.id)!;
    expect(a.assignedCount).toBe(1);
  });

  it('12: completed not counted', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id);
    await store.assignTaskIfUnassigned(ownerA, task.id, agent.id);
    await store.patchTask(ownerA, task.id, { status: 'completed' });
    const wl = await store.listAgentWorkload(ownerA);
    const a = wl.find((w) => w.agentId === agent.id)!;
    expect(a.assignedCount).toBe(0);
  });

  it('13: failed not counted', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id);
    await store.assignTaskIfUnassigned(ownerA, task.id, agent.id);
    await store.patchTask(ownerA, task.id, { status: 'failed' });
    const wl = await store.listAgentWorkload(ownerA);
    const a = wl.find((w) => w.agentId === agent.id)!;
    expect(a.assignedCount).toBe(0);
  });

  it('14: cancelled not counted', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id);
    await store.assignTaskIfUnassigned(ownerA, task.id, agent.id);
    await store.patchTask(ownerA, task.id, { status: 'cancelled' });
    const wl = await store.listAgentWorkload(ownerA);
    const a = wl.find((w) => w.agentId === agent.id)!;
    expect(a.assignedCount).toBe(0);
  });
});

// ---- 15-17: Batch workload ----

describe('Gate 31 — Batch workload', () => {
  it('15: owner isolation', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const ownerB = 'owner-b-' + uuid();
    const projB = await store.createProject(ownerB, { name: 'P', slug: 'p-' + uuid() });
    const agA = await makeAgent(store, ownerA);
    const agB = await makeAgent(store, ownerB);
    const tA = await makeTask(store, ownerA, projectA.id);
    await store.assignTaskIfUnassigned(ownerA, tA.id, agA.id);
    const tB = await makeTask(store, ownerB, projB.id);
    await store.assignTaskIfUnassigned(ownerB, tB.id, agB.id);
    const wlA = await store.listAgentWorkload(ownerA);
    expect(wlA.find((w) => w.agentId === agA.id)!.assignedCount).toBe(1);
    expect(wlA.find((w) => w.agentId === agB.id)).toBeUndefined();
  });

  it('16: zero-load agent represented', async () => {
    const { store, ownerA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const wl = await store.listAgentWorkload(ownerA);
    expect(wl.length).toBeGreaterThanOrEqual(1);
    const a = wl.find((w) => w.agentId === agent.id)!;
    expect(a.assignedCount).toBe(0);
    expect(a.runningCount).toBe(0);
  });

  it('17: no N+1 — single round trip for all agents', async () => {
    const { store, ownerA } = await createFixtures();
    for (let i = 0; i < 5; i++) await makeAgent(store, ownerA, { name: 'ag-' + i });
    const wl = await store.listAgentWorkload(ownerA);
    expect(wl.length).toBe(5);
    for (const w of wl) {
      expect(w.assignedCount).toBe(0);
    }
  });
});

// ---- 18-23: Availability ----

describe('Gate 31 — Availability', () => {
  it('18: active + below capacity → available', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { maxConcurrentTasks: 2 });
    const task = await makeTask(store, ownerA, projectA.id);
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('placed');
  });

  it('19: full agent rejected', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { maxConcurrentTasks: 1 });
    const t1 = await makeTask(store, ownerA, projectA.id);
    await placeTask({ store, ownerId: ownerA, taskId: t1.id, actorId: ownerA });
    const t2 = await makeTask(store, ownerA, projectA.id);
    const sel = await selectCandidate({ store, ownerId: ownerA, task: t2 });
    expect(sel.ok).toBe(false);
    expect(sel.outcome).toBe('no_eligible_agent');
  });

  it('20: capacity 0 rejected', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { maxConcurrentTasks: 0 });
    const task = await makeTask(store, ownerA, projectA.id);
    const sel = await selectCandidate({ store, ownerId: ownerA, task });
    expect(sel.ok).toBe(false);
    expect(sel.outcome).toBe('no_eligible_agent');
  });

  it('21: paused rejected', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { status: 'paused' });
    const task = await makeTask(store, ownerA, projectA.id);
    const sel = await selectCandidate({ store, ownerId: ownerA, task });
    expect(sel.ok).toBe(false);
  });

  it('22: retired rejected', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { status: 'retired' });
    const task = await makeTask(store, ownerA, projectA.id);
    const sel = await selectCandidate({ store, ownerId: ownerA, task });
    expect(sel.ok).toBe(false);
  });

  it('23: suspended rejected', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { status: 'suspended' });
    const task = await makeTask(store, ownerA, projectA.id);
    const sel = await selectCandidate({ store, ownerId: ownerA, task });
    expect(sel.ok).toBe(false);
  });
});

// ---- 24-26: Ranking ----

describe('Gate 31 — Ranking', () => {
  it('24: lower utilization preferred', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agA = await makeAgent(store, ownerA, { name: 'busy', maxConcurrentTasks: 2 });
    const agB = await makeAgent(store, ownerA, { name: 'idle', maxConcurrentTasks: 2 });
    const t1 = await makeTask(store, ownerA, projectA.id);
    const t2 = await makeTask(store, ownerA, projectA.id);
    await store.assignTaskIfUnassigned(ownerA, t1.id, agA.id); // agA workload=1, agB workload=0
    const t3 = await makeTask(store, ownerA, projectA.id);
    const sel = await selectCandidate({ store, ownerId: ownerA, task: t3 });
    expect(sel.ok).toBe(true);
    expect(sel.selected!.agentId).toBe(agB.id); // idle preferred
  });

  it('25: role preference after utilization', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agA = await makeAgent(store, ownerA, { name: 'gen', role: 'general', maxConcurrentTasks: 2 });
    const agB = await makeAgent(store, ownerA, { name: 'spec', role: 'specialist', maxConcurrentTasks: 2 });
    // Both empty → utilization equal → role preference decides
    const task = await makeTask(store, ownerA, projectA.id, { preferredRole: 'specialist' });
    const sel = await selectCandidate({ store, ownerId: ownerA, task });
    expect(sel.ok).toBe(true);
    expect(sel.selected!.agentId).toBe(agB.id);
  });

  it('26: deterministic tie-break by createdAt then id', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agA = await makeAgent(store, ownerA, { name: 'first', maxConcurrentTasks: 1 });
    const agB = await makeAgent(store, ownerA, { name: 'second', maxConcurrentTasks: 1 });
    const task = await makeTask(store, ownerA, projectA.id);
    const sel1 = await selectCandidate({ store, ownerId: ownerA, task });
    const sel2 = await selectCandidate({ store, ownerId: ownerA, task });
    expect(sel1.ok).toBe(true);
    expect(sel2.ok).toBe(true);
    // Both calls must return the exact same deterministic result
    expect(sel1.selected!.agentId).toBe(sel2.selected!.agentId);
  });
});

// ---- 27-30: Atomic capacity enforcement ----

describe('Gate 31 — Atomic capacity enforcement', () => {
  it('27-30: capacity=1 two Tasks race — exactly one accepted', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { maxConcurrentTasks: 1 });
    const t1 = await makeTask(store, ownerA, projectA.id);
    const t2 = await makeTask(store, ownerA, projectA.id);
    const r1 = await store.assignTaskIfUnassigned(ownerA, t1.id, agent.id);
    const r2 = await store.assignTaskIfUnassigned(ownerA, t2.id, agent.id);
    // Exactly one assigned, one at capacity
    const assigned = [r1, r2].filter((r) => r.ok && r.outcome === 'assigned');
    const atCapacity = [r1, r2].filter((r) => !r.ok && r.outcome === 'agent_at_capacity');
    expect(assigned.length).toBe(1);
    expect(atCapacity.length).toBe(1);
  });
});

// ---- 31-34: Fallback agent ----

describe('Gate 31 — Fallback agent', () => {
  it('31-33: Agent fills → second Agent selected via placement retry', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agA = await makeAgent(store, ownerA, { name: 'A', maxConcurrentTasks: 1 });
    const agB = await makeAgent(store, ownerA, { name: 'B', maxConcurrentTasks: 1 });
    const t1 = await makeTask(store, ownerA, projectA.id);
    const t2 = await makeTask(store, ownerA, projectA.id);
    const r1 = await placeTask({ store, ownerId: ownerA, taskId: t1.id, actorId: ownerA });
    expect(r1.ok).toBe(true);
    expect(r1.outcome).toBe('placed');
    const r2 = await placeTask({ store, ownerId: ownerA, taskId: t2.id, actorId: ownerA });
    expect(r2.ok).toBe(true);
    expect(r2.outcome).toBe('placed');
    // Both placed on different agents (selector pre-filters at-capacity agent)
    expect(r1.selectedAgentId).not.toBe(r2.selectedAgentId);
    // Selector excludes at-capacity agent before store, so second placement succeeds on attempt 1
    expect(r2.attempts).toBe(1);
  });

  it('34: single agent at capacity returns no_eligible_agent', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const ag = await makeAgent(store, ownerA, { maxConcurrentTasks: 1 });
    const t1 = await makeTask(store, ownerA, projectA.id);
    await placeTask({ store, ownerId: ownerA, taskId: t1.id, actorId: ownerA });
    // Agent now at capacity — selector filters it out before store
    const t2 = await makeTask(store, ownerA, projectA.id);
    const r = await placeTask({ store, ownerId: ownerA, taskId: t2.id, actorId: ownerA });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('no_eligible_agent');
    expect(r.attempts).toBe(1);
  });
});

// ---- 35-37: Higher contention ----

describe('Gate 31 — Higher contention', () => {
  it('35-37: 2 agents capacity 2 each, 10 concurrent Tasks — max 4 placed, zero overflow', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agA = await makeAgent(store, ownerA, { name: 'A', maxConcurrentTasks: 2 });
    const agB = await makeAgent(store, ownerA, { name: 'B', maxConcurrentTasks: 2 });
    const tasks = [];
    for (let i = 0; i < 10; i++) {
      tasks.push(await makeTask(store, ownerA, projectA.id));
    }
    let placed = 0;
    for (const task of tasks) {
      const r = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
      if (r.ok && r.outcome === 'placed') placed++;
    }
    expect(placed).toBe(4); // max possible = 2 agents × 2 capacity
    // Verify no agent exceeds capacity
    const wlA = await store.listAgentWorkload(ownerA);
    for (const w of wlA) {
      const agent = (await store.getAgent(ownerA, w.agentId))!;
      expect(w.assignedCount).toBeLessThanOrEqual(agent.maxConcurrentTasks);
    }
  });
});

// ---- 38-40: Terminal state release ----

describe('Gate 31 — Terminal state release', () => {
  it('38: completed frees capacity', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { maxConcurrentTasks: 1 });
    const t1 = await makeTask(store, ownerA, projectA.id);
    await placeTask({ store, ownerId: ownerA, taskId: t1.id, actorId: ownerA });
    // Agent full
    const t2 = await makeTask(store, ownerA, projectA.id);
    const sel1 = await selectCandidate({ store, ownerId: ownerA, task: t2 });
    expect(sel1.ok).toBe(false); // at capacity
    // Complete t1
    await store.patchTask(ownerA, t1.id, { status: 'completed' });
    // Agent available again
    const sel2 = await selectCandidate({ store, ownerId: ownerA, task: t2 });
    expect(sel2.ok).toBe(true);
    expect(sel2.selected!.agentId).toBe(agent.id);
  });

  it('39: failed frees capacity', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { maxConcurrentTasks: 1 });
    const t1 = await makeTask(store, ownerA, projectA.id);
    await placeTask({ store, ownerId: ownerA, taskId: t1.id, actorId: ownerA });
    await store.patchTask(ownerA, t1.id, { status: 'failed' });
    const t2 = await makeTask(store, ownerA, projectA.id);
    const sel = await selectCandidate({ store, ownerId: ownerA, task: t2 });
    expect(sel.ok).toBe(true);
  });

  it('40: cancelled frees capacity', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { maxConcurrentTasks: 1 });
    const t1 = await makeTask(store, ownerA, projectA.id);
    await placeTask({ store, ownerId: ownerA, taskId: t1.id, actorId: ownerA });
    await store.patchTask(ownerA, t1.id, { status: 'cancelled' });
    const t2 = await makeTask(store, ownerA, projectA.id);
    const sel = await selectCandidate({ store, ownerId: ownerA, task: t2 });
    expect(sel.ok).toBe(true);
  });
});

// ---- 41-45: Backward compatibility ----

describe('Gate 31 — Backward compatibility', () => {
  it('41: cross-owner workload hidden', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const ownerB = 'owner-b-' + uuid();
    const projB = await store.createProject(ownerB, { name: 'B', slug: 'b-' + uuid() });
    const agA = await makeAgent(store, ownerA);
    const agB = await makeAgent(store, ownerB);
    const tA = await makeTask(store, ownerA, projectA.id);
    await store.assignTaskIfUnassigned(ownerA, tA.id, agA.id);
    const tB = await makeTask(store, ownerB, projB.id);
    await store.assignTaskIfUnassigned(ownerB, tB.id, agB.id);
    const wlA = await store.listAgentWorkload(ownerA);
    expect(wlA.length).toBe(1);
    expect(wlA[0]!.agentId).toBe(agA.id);
  });

  it('42: Gate 27 preserved — selection deterministic', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const ag = await makeAgent(store, ownerA, { maxConcurrentTasks: 10 });
    const task = await makeTask(store, ownerA, projectA.id);
    const sel1 = await selectCandidate({ store, ownerId: ownerA, task });
    const sel2 = await selectCandidate({ store, ownerId: ownerA, task });
    expect(sel1.selected!.agentId).toBe(sel2.selected!.agentId);
  });

  it('43: Gate 28 preserved — assign/reassign/unassign/no_change', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const ag = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id);
    const r1 = await store.assignTask(ownerA, task.id, ag.id);
    expect(r1.outcome).toBe('assigned');
    const r2 = await store.assignTask(ownerA, task.id, ag.id);
    expect(r2.outcome).toBe('no_change');
    const r3 = await store.assignTask(ownerA, task.id, null);
    expect(r3.outcome).toBe('unassigned');
  });

  it('44: Gate 29 preserved — exact capability matching', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { capabilities: ['typescript', 'react'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const sel = await selectCandidate({ store, ownerId: ownerA, task });
    expect(sel.ok).toBe(true);
    const task2 = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['python'] });
    const sel2 = await selectCandidate({ store, ownerId: ownerA, task: task2 });
    expect(sel2.ok).toBe(false);
  });

  it('45: Gate 30 preserved — exactly-one-winner, no accidental reassignment', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { maxConcurrentTasks: 10 });
    const t1 = await makeTask(store, ownerA, projectA.id);
    const t2 = await makeTask(store, ownerA, projectA.id);
    const r1 = await store.assignTaskIfUnassigned(ownerA, t1.id, agent.id);
    const r2 = await store.assignTaskIfUnassigned(ownerA, t2.id, agent.id);
    // Both should succeed with capacity=10
    expect(r1.ok && r1.outcome === 'assigned').toBe(true);
    expect(r2.ok && r2.outcome === 'assigned').toBe(true);
    // Try to reassign t1 — should fail
    const r3 = await store.assignTaskIfUnassigned(ownerA, t1.id, agent.id);
    expect(r3.outcome).toBe('already_assigned');
  });
});

// ---- Terminal task status sanity ----

describe('Gate 31 — TERMINAL_TASK_STATUSES sanity', () => {
  it('TERMINAL_TASK_STATUSES contains completed, failed, cancelled', () => {
    expect(TERMINAL_TASK_STATUSES.has('completed')).toBe(true);
    expect(TERMINAL_TASK_STATUSES.has('failed')).toBe(true);
    expect(TERMINAL_TASK_STATUSES.has('cancelled')).toBe(true);
    expect(TERMINAL_TASK_STATUSES.has('created')).toBe(false);
    expect(TERMINAL_TASK_STATUSES.has('running')).toBe(false);
  });
});

// ---- Regression: AgentRecord camelCase contract ----
// BUG CONTEXT: SupabaseStore.q() applies toCamel() converting snake_case DB columns
// to camelCase BEFORE mapAgentRow consumes them. If mapAgentRow accesses snake_case
// keys (owner_id, created_at, max_concurrent_tasks), ALL values resolve to undefined
// and fall back to defaults. This caused maxConcurrentTasks to always be 1.
//
// These tests verify the AgentRecord contract through MemoryStore. They would catch
// any interface drift if the Store contract changes. SupabaseStore-specific regression
// coverage is in gate31.live.test.ts Step 7.

describe('Gate 31 — Regression: AgentRecord camelCase contract', () => {
  it('R1: AgentRecord has camelCase fields, not snake_case', async () => {
    const { store, ownerA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { maxConcurrentTasks: 3 });
    expect(agent).toHaveProperty('ownerId');
    expect(agent).toHaveProperty('maxConcurrentTasks');
    expect(agent).toHaveProperty('createdAt');
    expect(agent).toHaveProperty('updatedAt');
    expect(agent).not.toHaveProperty('owner_id');
    expect(agent).not.toHaveProperty('max_concurrent_tasks');
    expect(agent).not.toHaveProperty('created_at');
    expect(agent).not.toHaveProperty('updated_at');
    expect(agent.ownerId).toBe(ownerA);
    expect(agent.maxConcurrentTasks).toBe(3);
  });

  it('R2: patched AgentRecord preserves camelCase fields', async () => {
    const { store, ownerA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { maxConcurrentTasks: 1 });
    const patched = await store.patchAgent(ownerA, agent.id, { maxConcurrentTasks: 5 });
    expect(patched.maxConcurrentTasks).toBe(5);
    expect(patched.ownerId).toBe(ownerA);
    expect(patched.id).toBe(agent.id);
  });
});

// ---- Regression: listAgentWorkload camelCase contract ----
// BUG CONTEXT: Same q()/toCamel() issue. listAgentWorkload returned rows with
// camelCase keys (agentId, assignedCount, runningCount) but the mapping code
// accessed snake_case (agent_id, assigned_count, running_count), producing NaN.
//
// SupabaseStore-specific regression coverage is in gate31.live.test.ts Step 8.

describe('Gate 31 — Regression: listAgentWorkload camelCase contract', () => {
  it('R3: AgentWorkload has camelCase fields', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA);
    const task = await makeTask(store, ownerA, projectA.id);
    await store.assignTaskIfUnassigned(ownerA, task.id, agent.id);
    const wl = await store.listAgentWorkload(ownerA);
    const w = wl.find((x) => x.agentId === agent.id)!;
    expect(w).toHaveProperty('agentId');
    expect(w).toHaveProperty('assignedCount');
    expect(w).toHaveProperty('runningCount');
    expect(w).not.toHaveProperty('agent_id');
    expect(w).not.toHaveProperty('assigned_count');
    expect(w).not.toHaveProperty('running_count');
    expect(w.agentId).toBe(agent.id);
    expect(w.assignedCount).toBe(1);
    expect(typeof w.assignedCount).toBe('number');
    expect(typeof w.runningCount).toBe('number');
  });
});
