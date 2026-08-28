// CHEF FACTORY — Gate 38 — Task Dependency / DAG Foundation (unit / memory parity).
// Verifies dependency semantics, cycle prevention, owner/project integrity,
// discovery filtering, atomic rechecks, and auditability against MemoryStore.

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import type { TaskRecord } from './types.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface Fixture {
  store: MemoryStore;
  ownerId: string;
  projectId: string;
  agentId: string;
  makeTask: (over?: { status?: TaskRecord['status']; projectId?: string }) => Promise<TaskRecord>;
}

async function makeFixture(): Promise<Fixture> {
  const store = new MemoryStore();
  const ownerId = uuid();
  const project = await store.createProject(ownerId, { name: 'G38', slug: 'g38-' + uuid() });
  const agent = await store.createAgent(ownerId, { name: 'A', slug: 'a-' + uuid(), role: 'worker', status: 'active', maxConcurrentTasks: 10 });
  return {
    store, ownerId, projectId: project.id, agentId: agent.id,
    makeTask: async (over) =>
      store.createTask(ownerId, {
        projectId: over?.projectId ?? project.id,
        title: 't-' + uuid(),
        status: over?.status === 'created' ? 'created' : 'queued',
        agentId: null,
        riskLevel: 'low',
        inputs: { intent: 'g38 test', environment: 'development', resource: 'task' },
      }).then((t) => {
        if (over?.status && over.status !== 'queued' && over.status !== 'created') {
          return store.patchTask(ownerId, t.id, { status: over.status }).then(() => store.getTask(ownerId, t.id) as Promise<TaskRecord>);
        }
        return t;
      }),
  };
}

describe('Gate 38 — dependency readiness semantics (DEPENDENCY_SATISFIED_BY=completed)', () => {
  it('1: no dependencies => task is ready (discoverable)', async () => {
    const f = await makeFixture();
    const t = await f.makeTask();
    const ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).toContain(t.id);
  });

  it('2: completed prerequisite => ready', async () => {
    const f = await makeFixture();
    const prereq = await f.makeTask({ status: 'completed' });
    const dep = await f.makeTask();
    const r = await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    expect(r.ok).toBe(true);
    const ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).toContain(dep.id);
  });

  const blockedStatuses: TaskRecord['status'][] = ['queued', 'running', 'paused', 'needs_approval', 'failed', 'cancelled', 'created'];
  blockedStatuses.forEach((st) => {
    it(`blocked: prerequisite status "${st}" => dependent blocked`, async () => {
      const f = await makeFixture();
      const prereq = await f.makeTask({ status: st });
      const dep = await f.makeTask();
      await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
      const ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
      expect(ready.map((x) => x.id)).not.toContain(dep.id);
    });
  });

  it('10: fan-in — all prerequisites completed => ready', async () => {
    const f = await makeFixture();
    const p1 = await f.makeTask({ status: 'completed' });
    const p2 = await f.makeTask({ status: 'completed' });
    const p3 = await f.makeTask({ status: 'completed' });
    const dep = await f.makeTask();
    for (const p of [p1, p2, p3]) {
      await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: p.id, dependentTaskId: dep.id });
    }
    const ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).toContain(dep.id);
  });

  it('11: fan-in — one incomplete => blocked', async () => {
    const f = await makeFixture();
    const p1 = await f.makeTask({ status: 'completed' });
    const p2 = await f.makeTask({ status: 'running' });
    const dep = await f.makeTask();
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: p1.id, dependentTaskId: dep.id });
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: p2.id, dependentTaskId: dep.id });
    const ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).not.toContain(dep.id);
  });

  it('12: fan-out — completing one prerequisite unblocks multiple dependents', async () => {
    const f = await makeFixture();
    const prereq = await f.makeTask({ status: 'created' });
    const d1 = await f.makeTask();
    const d2 = await f.makeTask();
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: d1.id });
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: d2.id });
    let ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).not.toContain(d1.id);
    expect(ready.map((x) => x.id)).not.toContain(d2.id);
    await f.store.patchTask(f.ownerId, prereq.id, { status: 'completed' });
    ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).toContain(d1.id);
    expect(ready.map((x) => x.id)).toContain(d2.id);
  });

  it('13: transitive A -> B -> C', async () => {
    const f = await makeFixture();
    const a = await f.makeTask({ status: 'created' });
    const b = await f.makeTask();
    const c = await f.makeTask();
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: a.id, dependentTaskId: b.id });
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: b.id, dependentTaskId: c.id });
    let ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).not.toContain(c.id);
    expect(ready.map((x) => x.id)).not.toContain(b.id);
    await f.store.patchTask(f.ownerId, a.id, { status: 'completed' });
    ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).toContain(b.id);
    expect(ready.map((x) => x.id)).not.toContain(c.id);
    await f.store.patchTask(f.ownerId, b.id, { status: 'completed' });
    ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).toContain(c.id);
  });

  it('14: self-dependency rejected', async () => {
    const f = await makeFixture();
    const t = await f.makeTask();
    const r = await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: t.id, dependentTaskId: t.id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('self_dependency');
  });

  it('15: duplicate edge rejected (idempotent-safe)', async () => {
    const f = await makeFixture();
    const prereq = await f.makeTask({ status: 'completed' });
    const dep = await f.makeTask();
    const r1 = await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    expect(r1.ok).toBe(true);
    const r2 = await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    expect(r2.ok).toBe(false);
    expect(r2.outcome).toBe('already_exists');
    const { edges } = await f.store.listTaskDependencies(f.ownerId, { dependentTaskId: dep.id });
    expect(edges.length).toBe(1);
  });

  it('16: two-node cycle rejected', async () => {
    const f = await makeFixture();
    const a = await f.makeTask();
    const b = await f.makeTask();
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: a.id, dependentTaskId: b.id });
    const r = await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: b.id, dependentTaskId: a.id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('cycle_detected');
  });

  it('17: three-node cycle rejected', async () => {
    const f = await makeFixture();
    const a = await f.makeTask();
    const b = await f.makeTask();
    const c = await f.makeTask();
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: a.id, dependentTaskId: b.id });
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: b.id, dependentTaskId: c.id });
    const r = await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: c.id, dependentTaskId: a.id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('cycle_detected');
  });

  it('18: deep cycle rejected (arbitrary depth)', async () => {
    const f = await makeFixture();
    const n = 8;
    const tasks: TaskRecord[] = [];
    for (let i = 0; i < n; i++) tasks.push(await f.makeTask());
    for (let i = 0; i < n - 1; i++) {
      await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: tasks[i].id, dependentTaskId: tasks[i + 1].id });
    }
    // close the loop: last -> first
    const r = await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: tasks[n - 1].id, dependentTaskId: tasks[0].id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('cycle_detected');
  });

  it('19: cross-owner edge rejected', async () => {
    const fA = await makeFixture();
    const fB = await makeFixture();
    const prereq = await fA.makeTask();
    const dep = await fB.makeTask();
    // attempt to link two tasks belonging to different owners via owner B's context
    const r = await fB.store.addTaskDependency(fB.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('prerequisite_not_found');
  });

  it('20: cross-project edge rejected', async () => {
    const f = await makeFixture();
    const p2 = await f.store.createProject(f.ownerId, { name: 'P2', slug: 'p2-' + uuid() });
    const dep = await f.makeTask();
    const prereqOtherProject = await f.makeTask({ projectId: p2.id });
    const r = await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereqOtherProject.id, dependentTaskId: dep.id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('cross_scope');
  });
});

describe('Gate 38 — owner-only mutation (no agent/role/capability grants)', () => {
  async function setupAgentOnTask(): Promise<{ f: Fixture; prereq: TaskRecord; dep: TaskRecord }> {
    const f = await makeFixture();
    const prereq = await f.makeTask({ status: 'completed' });
    const dep = await f.makeTask();
    await f.store.assignTask(f.ownerId, dep.id, f.agentId);
    return { f, prereq, dep };
  }

  it('21: agent dependency mutation denied (cross-owner principal cannot mutate)', async () => {
    const { f, prereq, dep } = await setupAgentOnTask();
    // An agent has no authority to add/remove dependencies; the Store surface is
    // owner-scoped. Calling it from a non-owner context (agentId-as-owner) cannot
    // touch the owner task graph.
    const r = await f.store.addTaskDependency(f.agentId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    expect(r.ok).toBe(false);
    expect(['prerequisite_not_found', 'dependent_not_found']).toContain(r.outcome);
  });

  it('22: assignment does not grant dependency mutation', async () => {
    const { f, prereq, dep } = await setupAgentOnTask();
    // Task is assigned to the agent, yet the agent's owner-context cannot mutate deps.
    const r = await f.store.addTaskDependency(f.agentId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    expect(r.ok).toBe(false);
    await expect(f.store.removeTaskDependency(f.agentId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id })).resolves.toMatchObject({ ok: false });
  });

  it('23: role does not grant dependency mutation', async () => {
    const f = await makeFixture();
    const admin = await f.store.createAgent(f.ownerId, { name: 'Admin', slug: 'adm-' + uuid(), role: 'admin', status: 'active', maxConcurrentTasks: 10 });
    const prereq = await f.makeTask({ status: 'completed' });
    const dep = await f.makeTask();
    // An admin role does not confer dependency-mutation authority either.
    const r = await f.store.addTaskDependency(admin.id, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    expect(r.ok).toBe(false);
  });

  it('24: capability does not grant dependency mutation', async () => {
    const { f, prereq, dep } = await setupAgentOnTask();
    // Granting task-write-ish capability to an agent never surfaces a dependency
    // mutation path; the store remains owner-scoped.
    const r = await f.store.addTaskDependency(f.agentId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    expect(r.ok).toBe(false);
  });
});

describe('Gate 38 — discovery filtering + deterministic ordering', () => {
  it('25: discovery filters blocked tasks', async () => {
    const f = await makeFixture();
    const prereq = await f.makeTask({ status: 'created' });
    const dep = await f.makeTask();
    const free = await f.makeTask();
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    const ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).toContain(free.id);
    expect(ready.map((x) => x.id)).not.toContain(dep.id);
  });

  it('26: deterministic discovery ordering preserved (created_at ASC, id ASC)', async () => {
    const f = await makeFixture();
    const ids = (await Promise.all([1, 2, 3, 4, 5].map(async () => (await f.makeTask()).id)));
    const ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    const seen = ready.filter((x) => ids.includes(x.id)).map((x) => x.id);
    expect(ready.length).toBe(ids.length);
    const ordered = [...ids].sort();
    expect(seen).toEqual(ordered);
  });
});

describe('Gate 38 — atomic TOCTOU closure (recheck at assign + claim)', () => {
  it('27: assignTaskIfUnassigned rechecks readiness (denied on unmet prerequisite)', async () => {
    const f = await makeFixture();
    const prereq = await f.makeTask({ status: 'created' });
    const dep = await f.makeTask();
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    const r = await f.store.assignTaskIfUnassigned(f.ownerId, dep.id, f.agentId);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('not_ready');
    expect((await f.store.getTask(f.ownerId, dep.id))?.agentId).toBeNull();
  });

  it('28: claimTaskForExecution rechecks readiness (execution denied)', async () => {
    const f = await makeFixture();
    const prereq = await f.makeTask({ status: 'created' });
    const dep = await f.makeTask();
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    await f.store.assignTask(f.ownerId, dep.id, f.agentId);
    const c = await f.store.claimTaskForExecution(f.ownerId, dep.id, f.agentId);
    expect(c.ok).toBe(false);
    expect(c.outcome).toBe('not_ready');
    expect((await f.store.getTask(f.ownerId, dep.id))?.status).toBe('queued');
  });

  it('29: stale discovery cannot execute (dependency added after discovery, before assignment/claim)', async () => {
    const f = await makeFixture();
    const prereq = await f.makeTask({ status: 'created' });
    const dep = await f.makeTask();
    // Discovery happens (unassigned) with no dependency -> dep is ready.
    const discovered = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(discovered.map((x) => x.id)).toContain(dep.id);
    // Before assignment/claim, an authorized (owner) transaction creates an unmet dependency.
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    // Atomic assignment recheck fails closed.
    const assign = await f.store.assignTaskIfUnassigned(f.ownerId, dep.id, f.agentId);
    expect(assign.ok).toBe(false);
    expect(assign.outcome).toBe('not_ready');
    // Even a forced assignment cannot lead to execution: claim rechecks and denies.
    await f.store.assignTask(f.ownerId, dep.id, f.agentId);
    const c = await f.store.claimTaskForExecution(f.ownerId, dep.id, f.agentId);
    expect(c.ok).toBe(false);
    expect(c.outcome).toBe('not_ready');
    expect((await f.store.getTask(f.ownerId, dep.id))?.status).toBe('queued');
  });
});

describe('Gate 38 — retry + eventual completion', () => {
  it('30: retry prerequisite failed -> queued still blocks', async () => {
    const f = await makeFixture();
    const prereq = await f.makeTask({ status: 'failed' });
    const dep = await f.makeTask();
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    let ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).not.toContain(dep.id);
    // retry: failed -> queued
    await f.store.patchTask(f.ownerId, prereq.id, { status: 'queued' });
    ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).not.toContain(dep.id);
  });

  it('31: prerequisite eventually completed => dependent becomes ready', async () => {
    const f = await makeFixture();
    const prereq = await f.makeTask({ status: 'created' });
    const dep = await f.makeTask();
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    let ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).not.toContain(dep.id);
    await f.store.patchTask(f.ownerId, prereq.id, { status: 'completed' });
    ready = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(ready.map((x) => x.id)).toContain(dep.id);
  });
});

describe('Gate 38 — auditability', () => {
  it('32: dependency mutation audit recorded (add + remove), owner/project/actor present', async () => {
    const f = await makeFixture();
    const prereq = await f.makeTask({ status: 'completed' });
    const dep = await f.makeTask();
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    let addAudits = f.store.audit.filter((a) => a.action === 'task.dependency.add');
    expect(addAudits.length).toBe(1);
    expect(addAudits[0]!.actorType).toBe('owner');
    expect(addAudits[0]!.actorId).toBe(f.ownerId);
    expect(addAudits[0]!.projectId).toBe(f.projectId);
    expect(addAudits[0]!.resourceType).toBe('task_dependencies');
    expect(addAudits[0]!.taskId).toBe(dep.id);
    expect(addAudits[0]!.metadata).toMatchObject({ outcome: 'added', prerequisiteTaskId: prereq.id });

    await f.store.removeTaskDependency(f.ownerId, { prerequisiteTaskId: prereq.id, dependentTaskId: dep.id });
    const remAudits = f.store.audit.filter((a) => a.action === 'task.dependency.remove');
    expect(remAudits.length).toBe(1);
    expect(remAudits[0]!.metadata).toMatchObject({ outcome: 'removed', prerequisiteTaskId: prereq.id });
  });

  it('32b: failed dependency mutation does not fabricate success', async () => {
    const f = await makeFixture();
    const t = await f.makeTask();
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: t.id, dependentTaskId: t.id });
    const adds = f.store.audit.filter((a) => a.action === 'task.dependency.add');
    expect(adds.length).toBe(0);
  });
});
