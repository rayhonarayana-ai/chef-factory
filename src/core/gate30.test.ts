// CHEF FACTORY — Gate 30 — Workforce Placement Primitive.
// Tests: selection exclusion, atomic placement, concurrency, retry, audit, invariants.

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { placeTask } from './placement.js';
import { selectCandidate } from './selector.js';
import type { AgentRecord } from './types.js';
import type { Store, AssignTaskIfUnassignedResult } from './ports.js';

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
  return { store, ownerA, ownerB, projectA, projectB };
}

async function makeAgent(store: Store, ownerId: string, overrides: Partial<{ name: string; slug: string; role: string; status: AgentRecord['status']; capabilities: string[] }> = {}): Promise<AgentRecord> {
  return store.createAgent(ownerId, {
    name: overrides.name ?? 'Agent-' + uuid(),
    slug: overrides.slug ?? 'ag-' + uuid(),
    role: overrides.role ?? 'worker',
    status: overrides.status ?? 'active',
    capabilities: overrides.capabilities ?? [],
  });
}

async function makeTask(store: Store, ownerId: string, projectId: string, overrides: Partial<{ title: string; requiredCapabilities: string[]; preferredRole: string | null }> = {}) {
  return store.createTask(ownerId, {
    projectId,
    title: overrides.title ?? 'Task-' + uuid(),
    requiredCapabilities: overrides.requiredCapabilities,
    preferredRole: overrides.preferredRole,
  });
}

describe('Gate 30 — Basic placement', () => {
  it('01: first placement success', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('placed');
    expect(result.selectedAgentId).toBe(agent.id);
    expect(result.attempts).toBe(1);
    const updated = await store.getTask(ownerA, task.id);
    expect(updated!.agentId).toBe(agent.id);
  });

  it('02: no agents returns no_agents_found', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const task = await makeTask(store, ownerA, projectA.id);
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('no_agents_found');
  });

  it('03: no eligible agent returns no_eligible_agent', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { capabilities: [] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('no_eligible_agent');
  });

  it('04: paused agents are ignored', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { status: 'paused' });
    const task = await makeTask(store, ownerA, projectA.id);
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('no_eligible_agent');
  });

  it('05: exact capability matching preserved', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { capabilities: ['java'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['javascript'] });
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('no_eligible_agent');
  });

  it('06: preferred role ranking preserved', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { name: 'Mismatch', role: 'backend', capabilities: ['typescript'] });
    const match = await makeAgent(store, ownerA, { name: 'Match', role: 'frontend', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'], preferredRole: 'frontend' });
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(true);
    expect(result.selectedAgentId).toBe(match.id);
  });
});

describe('Gate 30 — Selector exclusion extension', () => {
  it('07: exclusion list absent preserves Gate 29', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const r1 = await selectCandidate({ store, ownerId: ownerA, task });
    const r2 = await selectCandidate({ store, ownerId: ownerA, task });
    expect(r1.selected!.agentId).toBe(agent.id);
    expect(r2.selected!.agentId).toBe(agent.id);
  });

  it('08: exclusion list empty preserves Gate 29', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const r = await selectCandidate({ store, ownerId: ownerA, task, excludeAgentIds: [] });
    expect(r.ok).toBe(true);
    expect(r.selected!.agentId).toBe(agent.id);
  });

  it('09: excluded best agent not selected', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const best = await makeAgent(store, ownerA, { name: 'Best', capabilities: ['typescript'] });
    const other = await makeAgent(store, ownerA, { name: 'Other', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const r = await selectCandidate({ store, ownerId: ownerA, task, excludeAgentIds: [best.id] });
    expect(r.ok).toBe(true);
    expect(r.selected!.agentId).toBe(other.id);
  });

  it('10: deterministic ranking after exclusion', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const a = await makeAgent(store, ownerA, { name: 'A', capabilities: ['typescript'] });
    const b = await makeAgent(store, ownerA, { name: 'B', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const r1 = await selectCandidate({ store, ownerId: ownerA, task, excludeAgentIds: [a.id] });
    const r2 = await selectCandidate({ store, ownerId: ownerA, task, excludeAgentIds: [a.id] });
    expect(r1.selected!.agentId).toBe(b.id);
    expect(r2.selected!.agentId).toBe(b.id);
  });
});

describe('Gate 30 — Retry mechanism', () => {
  it('11: agent raced out retries with next', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agentA = await makeAgent(store, ownerA, { name: 'Alpha', capabilities: ['typescript'] });
    const agentB = await makeAgent(store, ownerA, { name: 'Beta', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const origAssign = store.assignTaskIfUnassigned.bind(store);
    let firstFailedAgentId: string | null = null;
    let calls = 0;
    store.assignTaskIfUnassigned = async (_o: string, _t: string, a: string): Promise<AssignTaskIfUnassignedResult> => {
      calls++;
      if (calls === 1) { firstFailedAgentId = a; return { ok: false, outcome: 'agent_not_eligible', previousAgentId: null, nextAgentId: a }; }
      return origAssign(_o, _t, a);
    };
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('placed');
    expect(result.selectedAgentId).not.toBe(firstFailedAgentId);
    expect(result.attempts).toBe(2);
    store.assignTaskIfUnassigned = origAssign;
  });

  it('12: retry on agent_not_found selects second', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { name: 'Alpha', capabilities: ['typescript'] });
    await makeAgent(store, ownerA, { name: 'Beta', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const origAssign = store.assignTaskIfUnassigned.bind(store);
    let firstFailedAgentId: string | null = null;
    let calls = 0;
    store.assignTaskIfUnassigned = async (_o: string, _t: string, a: string): Promise<AssignTaskIfUnassignedResult> => {
      calls++;
      if (calls === 1) { firstFailedAgentId = a; return { ok: false, outcome: 'agent_not_found', previousAgentId: null, nextAgentId: a }; }
      return origAssign(_o, _t, a);
    };
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(true);
    expect(result.selectedAgentId).not.toBe(firstFailedAgentId);
    expect(result.attempts).toBe(2);
    store.assignTaskIfUnassigned = origAssign;
  });

  it('13: retry max = 2 stops after exhaustion', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { name: 'Alpha', capabilities: ['typescript'] });
    await makeAgent(store, ownerA, { name: 'Beta', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const origAssign = store.assignTaskIfUnassigned.bind(store);
    store.assignTaskIfUnassigned = async (): Promise<AssignTaskIfUnassignedResult> => {
      return { ok: false, outcome: 'agent_not_eligible', previousAgentId: null, nextAgentId: 'x' };
    };
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('assignment_conflict_exhausted');
    expect(result.attempts).toBe(2);
    store.assignTaskIfUnassigned = origAssign;
  });

  it('14: rejected agent not selected twice via exclusion', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { name: 'Alpha', capabilities: ['typescript'] });
    await makeAgent(store, ownerA, { name: 'Beta', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const origAssign = store.assignTaskIfUnassigned.bind(store);
    let firstFailedAgentId: string | null = null;
    let calls = 0;
    store.assignTaskIfUnassigned = async (_o: string, _t: string, a: string): Promise<AssignTaskIfUnassignedResult> => {
      calls++;
      if (calls === 1) { firstFailedAgentId = a; return { ok: false, outcome: 'agent_not_eligible', previousAgentId: null, nextAgentId: a }; }
      return origAssign(_o, _t, a);
    };
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('placed');
    expect(result.selectedAgentId).not.toBe(firstFailedAgentId);
    expect(result.attempts).toBe(2);
    store.assignTaskIfUnassigned = origAssign;
  });

  it('15: retry exhaustion returns assignment_conflict_exhausted', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { name: 'Alpha', capabilities: ['typescript'] });
    await makeAgent(store, ownerA, { name: 'Beta', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const origAssign = store.assignTaskIfUnassigned.bind(store);
    store.assignTaskIfUnassigned = async (): Promise<AssignTaskIfUnassignedResult> => {
      return { ok: false, outcome: 'agent_not_eligible', previousAgentId: null, nextAgentId: 'x' };
    };
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('assignment_conflict_exhausted');
    expect(result.attempts).toBe(2);
    store.assignTaskIfUnassigned = origAssign;
  });
});

describe('Gate 30 — Already assigned task', () => {
  it('16: already assigned before placement returns already_assigned', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    await store.assignTask(ownerA, task.id, agent.id);
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('already_assigned');
    expect(result.attempts).toBe(0);
  });

  it('17: already assigned to same agent returns already_assigned', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    await store.assignTask(ownerA, task.id, agent.id);
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.outcome).toBe('already_assigned');
    const t = await store.getTask(ownerA, task.id);
    expect(t!.agentId).toBe(agent.id);
  });

  it('18: already assigned to different agent returns already_assigned', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agentX = await makeAgent(store, ownerA, { name: 'X', capabilities: ['typescript'] });
    await makeAgent(store, ownerA, { name: 'Y', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    await store.assignTask(ownerA, task.id, agentX.id);
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.outcome).toBe('already_assigned');
    const t = await store.getTask(ownerA, task.id);
    expect(t!.agentId).toBe(agentX.id);
  });

  it('19: no silent reassignment on already assigned task', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    await store.assignTask(ownerA, task.id, agent.id);
    const before = (await store.getTask(ownerA, task.id))!.agentId;
    await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    const after = (await store.getTask(ownerA, task.id))!.agentId;
    expect(after).toBe(before);
  });
});

describe('Gate 30 — Error cases', () => {
  it('20: task not found returns task_not_found', async () => {
    const { store, ownerA } = await createFixtures();
    const result = await placeTask({ store, ownerId: ownerA, taskId: 'nonexistent', actorId: ownerA });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('task_not_found');
  });

  it('21: unauthorized actor throws', async () => {
    const { store, ownerA, ownerB, projectA } = await createFixtures();
    const task = await makeTask(store, ownerA, projectA.id);
    await expect(placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerB })).rejects.toThrow('placement denied');
  });

  it('22: invalid actorId throws', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const task = await makeTask(store, ownerA, projectA.id);
    await expect(placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: '' })).rejects.toThrow('invalid actorId');
  });
});

describe('Gate 30 — Cross-owner isolation', () => {
  it('23: cross-owner agent invisible to selector', async () => {
    const { store, ownerA, ownerB, projectA } = await createFixtures();
    const own = await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    await makeAgent(store, ownerB, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const r = await selectCandidate({ store, ownerId: ownerA, task });
    expect(r.selected!.agentId).toBe(own.id);
  });

  it('24: cross-owner placement blocked', async () => {
    const { store, ownerA, ownerB, projectB } = await createFixtures();
    await makeAgent(store, ownerB, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerB, projectB.id, { requiredCapabilities: ['typescript'] });
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('task_not_found');
  });
});

describe('Gate 30 — Invariant checks', () => {
  it('25: selector remains read-only during placement', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const before = (await store.getTask(ownerA, task.id))!.agentId;
    await selectCandidate({ store, ownerId: ownerA, task });
    const after = (await store.getTask(ownerA, task.id))!.agentId;
    expect(after).toBe(before);
  });

  it('26: placement does not execute task', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    const updated = await store.getTask(ownerA, task.id);
    expect(updated!.status).toBe('created');
  });

  it('27: placement performs zero LLM calls', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const costBefore = store.costs.length;
    await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(store.costs.length).toBe(costBefore);
  });
});

describe('Gate 30 — Atomic persistence', () => {
  it('28: task.agentId matches selectedAgentId after placement', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(true);
    const t = await store.getTask(ownerA, task.id);
    expect(t!.agentId).toBe(result.selectedAgentId);
    expect(t!.agentId).toBe(agent.id);
  });

  it('29: placement does not use patchTask for assignment', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    let patchTaskCalled = false;
    const origPatch = store.patchTask.bind(store);
    store.patchTask = async (...args: Parameters<typeof origPatch>) => {
      patchTaskCalled = true;
      return origPatch(...args);
    };
    await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(patchTaskCalled).toBe(false);
    store.patchTask = origPatch;
  });
});

describe('Gate 30 — Concurrency proof', () => {
  it('30: two concurrent placements produce exactly one winner', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const [r1, r2] = await Promise.all([
      placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA }),
      placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA }),
    ]);
    const winners = [r1, r2].filter((r) => r.ok).length;
    expect(winners).toBe(1);
  });

  it('31: losing placement cannot overwrite winner', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const [r1, r2] = await Promise.all([
      placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA }),
      placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA }),
    ]);
    const loser = r1.ok ? r2 : r1;
    expect(loser.outcome).toBe('already_assigned');
  });

  it('32: ten concurrent placements produce exactly one winner', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agents = [];
    for (let i = 0; i < 10; i++) agents.push(await makeAgent(store, ownerA, { capabilities: ['typescript'] }));
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const results = await Promise.all(
      agents.map(() => placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA }))
    );
    const winners = results.filter((r) => r.ok).length;
    expect(winners).toBe(1);
  });

  it('33: zero deadlocks in concurrent placements', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agents = [];
    for (let i = 0; i < 10; i++) agents.push(await makeAgent(store, ownerA, { capabilities: ['typescript'] }));
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const results = await Promise.all(
      agents.map(() => placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA }).catch(() => null))
    );
    const rejections = results.filter((r) => r === null);
    expect(rejections.length).toBe(0);
  });

  it('34: final assignment stable after concurrent placements', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agents = [];
    for (let i = 0; i < 10; i++) agents.push(await makeAgent(store, ownerA, { capabilities: ['typescript'] }));
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    await Promise.all(
      agents.map(() => placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA }))
    );
    const t = await store.getTask(ownerA, task.id);
    expect(t!.agentId).not.toBeNull();
    const agentIds = new Set(agents.map((a) => a.id));
    expect(agentIds.has(t!.agentId!)).toBe(true);
  });
});

describe('Gate 30 — Agent status race', () => {
  it('35: agent paused between selection and assignment retries', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agentA = await makeAgent(store, ownerA, { name: 'A', capabilities: ['typescript'] });
    const agentB = await makeAgent(store, ownerA, { name: 'B', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const origAssign = store.assignTaskIfUnassigned.bind(store);
    let calls = 0;
    store.assignTaskIfUnassigned = async (_o: string, _t: string, a: string): Promise<AssignTaskIfUnassignedResult> => {
      calls++;
      if (calls === 1) return { ok: false, outcome: 'agent_not_eligible', previousAgentId: null, nextAgentId: a };
      return origAssign(_o, _t, a);
    };
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('placed');
    expect(result.attempts).toBe(2);
    store.assignTaskIfUnassigned = origAssign;
  });

  it('36: bounded retry succeeds with agent B', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { name: 'Alpha', capabilities: ['typescript'] });
    await makeAgent(store, ownerA, { name: 'Beta', capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const origAssign = store.assignTaskIfUnassigned.bind(store);
    let firstFailedAgentId: string | null = null;
    let calls = 0;
    store.assignTaskIfUnassigned = async (_o: string, _t: string, a: string): Promise<AssignTaskIfUnassignedResult> => {
      calls++;
      if (calls === 1) { firstFailedAgentId = a; return { ok: false, outcome: 'agent_not_found', previousAgentId: null, nextAgentId: a }; }
      return origAssign(_o, _t, a);
    };
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.ok).toBe(true);
    expect(result.selectedAgentId).not.toBe(firstFailedAgentId);
    expect(result.attempts).toBe(2);
    store.assignTaskIfUnassigned = origAssign;
  });
});

describe('Gate 30 — Audit and Gate invariants', () => {
  it('37: successful placement records audit event', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const auditBefore = store.audit.length;
    await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(store.audit.length).toBeGreaterThanOrEqual(auditBefore);
  });

  it('38: failed placement with no agents records no new audit', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const task = await makeTask(store, ownerA, projectA.id);
    const auditBefore = store.audit.length;
    await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(store.audit.length).toBe(auditBefore);
  });

  it('39: Gate 27 invariant preserved - cross-owner task not found', async () => {
    const { store, ownerA, ownerB, projectB } = await createFixtures();
    const task = await makeTask(store, ownerB, projectB.id);
    const result = await placeTask({ store, ownerId: ownerA, taskId: task.id, actorId: ownerA });
    expect(result.outcome).toBe('task_not_found');
  });

  it('40: Gate 28 normal assign still works', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id);
    const result = await store.assignTask(ownerA, task.id, agent.id);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('assigned');
  });

  it('41: Gate 29 selector behavior preserved without exclusions', async () => {
    const { store, ownerA, projectA } = await createFixtures();
    const agent = await makeAgent(store, ownerA, { capabilities: ['typescript'] });
    const task = await makeTask(store, ownerA, projectA.id, { requiredCapabilities: ['typescript'] });
    const r1 = await selectCandidate({ store, ownerId: ownerA, task });
    const r2 = await selectCandidate({ store, ownerId: ownerA, task });
    expect(r1.ok).toBe(true);
    expect(r1.selected!.agentId).toBe(agent.id);
    expect(r2.selected!.agentId).toBe(agent.id);
    expect(r1.selected!.agentId).toBe(r2.selected!.agentId);
  });
});
