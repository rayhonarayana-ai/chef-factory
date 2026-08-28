// CHEF FACTORY — Gate 39 — Mission Engine Foundation (unit + security).
// Deterministic core and MemoryStore parity proofs. These tests exercise the pure
// validator/homer, lifecycle, canonical hashing, and the MemoryStore mission parity
// (materialization is atomic, activation atomically queues ALL tasks, security
// reject rules, budget binding, status semantic rules). Live-proofs live in
// gate39.live.test.ts against real PostgreSQL.

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import type { Store } from '../core/ports.js';
import type { MissionPlanCanonical, MissionStatus, TaskRecord } from '../core/types.js';
import {
  MISSION_BOUNDS,
  MISSION_LIFECYCLE,
  hashMissionPlan,
  missionCanTransition,
  missionCompleted,
  missionFailed,
  missionTitledStatus,
  validateMissionPlan,
} from '../core/mission/missionEngine.js';
import { prepareMissionPlan } from '../core/mission/planner.js';

const uuid = (): string => crypto.randomUUID();

function makeStore(): Store {
  return new MemoryStore();
}

async function makeOwnerProject(store: Store): Promise<{ ownerId: string; projectId: string }> {
  const ownerId = uuid();
  const project = await store.createProject(ownerId, { name: 'G39', slug: 'g39-' + uuid() });
  return { ownerId, projectId: project.id };
}

// A canonical, security-clean plan.
function validPlan(): MissionPlanCanonical {
  return {
    objective: 'Ship a deterministic mission foundation',
    tasks: [
      { key: 'A', title: 'Plan A', successCriteria: ['A done'] },
      { key: 'B', title: 'Plan B', successCriteria: ['B done'] },
      { key: 'C', title: 'Plan C', successCriteria: ['C done'] },
    ],
    dependencies: [
      { prerequisiteKey: 'A', dependentKey: 'B' },
      { prerequisiteKey: 'B', dependentKey: 'C' },
    ],
    estimatedBudget: 10,
  };
}

// Drive a mission to 'approved' (draft -> pending_approval -> approved) using the
// memory parity implementations + a hash-bound approval record.
async function approveMission(store: Store, ownerId: string, projectId: string, plan: MissionPlanCanonical): Promise<{ missionId: string; hash: string }> {
  const prepared = prepareMissionPlan(plan);
  if (!prepared.ok) throw new Error('fixture plan must validate');
  const mission = await store.createMission(ownerId, { ownerId, projectId, objective: plan.objective });
  await store.saveMissionPlan(ownerId, mission.id, prepared.plan!, prepared.hash!);
  await store.setMissionPendingApproval(ownerId, mission.id);
  await store.createApproval(ownerId, {
    projectId, action: 'mission.plan.approve', description: 'Approve mission plan',
    riskLevel: 'medium', requestedBy: ownerId, metadata: { missionId: mission.id, planHash: prepared.hash },
  });
  const approvals = await store.listApprovals(ownerId, { projectId, status: 'pending' });
  const appr = approvals.find((a) => a.action === 'mission.plan.approve');
  if (!appr) throw new Error('fixture approval missing');
  await store.patchApproval(ownerId, appr.id, { status: 'approved', decidedBy: ownerId, decidedAt: new Date().toISOString(), decisionReason: 'owner' });
  await store.markMissionApproved(ownerId, mission.id);
  return { missionId: mission.id, hash: prepared.hash! };
}

describe('Gate 39 — canonical hashing (deterministic, insertion-order independent)', () => {
  it('G39-01: reordered input yields identical SHA-256 hash', () => {
    const h1 = hashMissionPlan({ objective: 'x', tasks: [{ key: 'a', title: 't' }, { key: 'b', title: 'u' }], dependencies: [] });
    const h2 = hashMissionPlan({ objective: 'x', tasks: [{ key: 'b', title: 'u' }, { key: 'a', title: 't' }], dependencies: [] });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('G39-02: differing content yields differing hash (plans are content-bound)', () => {
    const h1 = hashMissionPlan({ objective: 'x', tasks: [{ key: 'a', title: 't' }], dependencies: [] });
    const h2 = hashMissionPlan({ objective: 'y', tasks: [{ key: 'a', title: 't' }], dependencies: [] });
    expect(h1).not.toBe(h2);
  });
});

describe('Gate 39 — deterministic validation', () => {
  it('G39-03: valid canonical plan passes', () => {
    const r = validateMissionPlan(validPlan());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('G39-04: empty objective rejected', () => {
    const r = validateMissionPlan({ objective: '   ', tasks: [{ key: 'a', title: 't' }], dependencies: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('objective'))).toBe(true);
  });

  it('G39-05: plan with no tasks rejected', () => {
    const r = validateMissionPlan({ objective: 'x', tasks: [], dependencies: [] });
    expect(r.ok).toBe(false);
  });

  it('G39-06: task count above allowed limit rejected', () => {
    const tasks = Array.from({ length: MISSION_BOUNDS.HARD_MAX_TASKS + 1 }, (_, i) => ({ key: `k${i}`, title: `t${i}` }));
    const r = validateMissionPlan({ objective: 'x', tasks, dependencies: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('exceeds'))).toBe(true);
  });

  it('G39-07: input may lower task cap but never raise above hard ceiling', () => {
    const ts = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, title: `t${i}` }));
    // 15 tasks pass by default (<= DEFAULT_MAX_TASKS)...
    expect(validateMissionPlan({ objective: 'x', tasks: ts(15), dependencies: [] }).ok).toBe(true);
    // ...but a lowered cap of 10 rejects them.
    expect(validateMissionPlan({ objective: 'x', tasks: ts(15), dependencies: [] }, { maxTasks: 10 }).ok).toBe(false);
    // 30 tasks exceed the default cap (20) and a lowered cap (25) alike.
    expect(validateMissionPlan({ objective: 'x', tasks: ts(30), dependencies: [] }).ok).toBe(false);
    expect(validateMissionPlan({ objective: 'x', tasks: ts(30), dependencies: [] }, { maxTasks: 25 }).ok).toBe(false);
    // An input cap above the HARD ceiling is clamped to 50, so 60 tasks still fail
    // even with maxTasks requested as 500.
    expect(validateMissionPlan({ objective: 'x', tasks: ts(60), dependencies: [] }, { maxTasks: 500 }).ok).toBe(false);
    // And a 40-task plan is allowed even when the requested cap is huge (clamped to 50).
    expect(validateMissionPlan({ objective: 'x', tasks: ts(40), dependencies: [] }, { maxTasks: 500 }).ok).toBe(true);
  });

  it('G39-08: duplicate task key rejected', () => {
    const r = validateMissionPlan({ objective: 'x', tasks: [{ key: 'a', title: 't' }, { key: 'a', title: 'u' }], dependencies: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('duplicate task key'))).toBe(true);
  });

  it('G39-09: dependency referencing missing key rejected', () => {
    const r = validateMissionPlan({ objective: 'x', tasks: [{ key: 'a', title: 't' }], dependencies: [{ prerequisiteKey: 'a', dependentKey: 'ghost' }] });
    expect(r.ok).toBe(false);
  });

  it('G39-10: self dependency rejected', () => {
    const r = validateMissionPlan({ objective: 'x', tasks: [{ key: 'a', title: 't' }], dependencies: [{ prerequisiteKey: 'a', dependentKey: 'a' }] });
    expect(r.ok).toBe(false);
  });

  it('G39-11: dependency cycle rejected', () => {
    const plan: MissionPlanCanonical = {
      objective: 'x',
      tasks: [{ key: 'a', title: 't' }, { key: 'b', title: 'u' }, { key: 'c', title: 'v' }],
      dependencies: [
        { prerequisiteKey: 'a', dependentKey: 'b' },
        { prerequisiteKey: 'b', dependentKey: 'c' },
        { prerequisiteKey: 'c', dependentKey: 'a' },
      ],
    };
    const r = validateMissionPlan(plan);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('cycle'))).toBe(true);
  });

  it('G39-12: DAG depth beyond MAX_DAG_DEPTH rejected', () => {
    const n = MISSION_BOUNDS.MAX_DAG_DEPTH + 2;
    const keys = Array.from({ length: n }, (_, i) => `k${i}`);
    const dependencies = keys.slice(0, -1).map((k, i) => ({ prerequisiteKey: k, dependentKey: keys[i + 1]! }));
    const r = validateMissionPlan({ objective: 'x', tasks: keys.map((k) => ({ key: k, title: k })), dependencies });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('depth'))).toBe(true);
  });

  it('G39-13: maxTaskTitleLen bound enforced', () => {
    const r = validateMissionPlan({ objective: 'x', tasks: [{ key: 'a', title: 'x'.repeat(MISSION_BOUNDS.MAX_TASK_TITLE_LEN + 1) }], dependencies: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('title exceeds'))).toBe(true);
  });

  it('G39-14: success criterion count/length bound enforced', () => {
    const okPlan: MissionPlanCanonical = { objective: 'x', tasks: [{ key: 'a', title: 't', successCriteria: Array.from({ length: MISSION_BOUNDS.MAX_SUCCESS_CRITERIA_PER_TASK }, (_, i) => `c${i}`) }], dependencies: [] };
    expect(validateMissionPlan(okPlan).ok).toBe(true);
    const tooMany: MissionPlanCanonical = { objective: 'x', tasks: [{ key: 'a', title: 't', successCriteria: Array.from({ length: MISSION_BOUNDS.MAX_SUCCESS_CRITERIA_PER_TASK + 1 }, (_, i) => `c${i}`) }], dependencies: [] };
    const r1 = validateMissionPlan(tooMany);
    expect(r1.ok).toBe(false);
    const tooLong: MissionPlanCanonical = { objective: 'x', tasks: [{ key: 'a', title: 't', successCriteria: ['x'.repeat(MISSION_BOUNDS.MAX_SUCCESS_CRITERION_LEN + 1)] }], dependencies: [] };
    expect(validateMissionPlan(tooLong).ok).toBe(false);
  });

  it('G39-15: fan-in greater than MAX_FAN_IN rejected', () => {
    const keys = Array.from({ length: MISSION_BOUNDS.MAX_FAN_IN + 2 }, (_, i) => `k${i}`);
    // every task -> k0 (fan-in of k0 is huge)
    const dependencies = keys.slice(1).map((k) => ({ prerequisiteKey: k, dependentKey: 'k0' }));
    const r = validateMissionPlan({ objective: 'x', tasks: keys.map((k) => ({ key: k, title: k })), dependencies });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('fan-in'))).toBe(true);
  });

  it('G39-16: fan-out greater than MAX_FAN_OUT rejected', () => {
    const keys = Array.from({ length: MISSION_BOUNDS.MAX_FAN_OUT + 2 }, (_, i) => `k${i}`);
    const dependencies = keys.slice(1).map((k) => ({ prerequisiteKey: 'k0', dependentKey: k }));
    const r = validateMissionPlan({ objective: 'x', tasks: keys.map((k) => ({ key: k, title: k })), dependencies });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('fan-out'))).toBe(true);
  });
});

describe('Gate 39 — security reject rules (plan must never encode authority)', () => {
  it('G39-17: plan must never embed an agent/id UUID', () => {
    const plan: MissionPlanCanonical = { objective: 'x', tasks: [{ key: 'a', title: 't', description: 'use agent ' + uuid() }], dependencies: [] };
    const r = validateMissionPlan(plan);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('UUID id'))).toBe(true);
  });

  it('G39-18: plan must be free of permission/grant/authority/approve/deny signals', () => {
    for (const bad of ['grant write permission', 'approve the target', 'authorize deploy', 'deny access', 'permission denied']) {
      const r = validateMissionPlan({ objective: 'x', tasks: [{ key: 'a', title: 't', description: bad }], dependencies: [] });
      expect(r.ok).toBe(false);
    }
  });

  it('G39-19: plan must not encode direct tool/shell/push execution', () => {
    for (const bad of ['git push origin', 'rake rm -rf', 'run shell: sudo', 'execute script.sh']) {
      const r = validateMissionPlan({ objective: 'x', tasks: [{ key: 'a', title: 't', description: bad }], dependencies: [] });
      expect(r.ok).toBe(false);
    }
  });

  it('G39-20: required capability must not itself be an authority grant', () => {
    const r = validateMissionPlan({ objective: 'x', tasks: [{ key: 'a', title: 't', requiredCapabilities: ['production_write'] }], dependencies: [] });
    expect(r.ok).toBe(false);
  });

  it('G39-21: objective length bounded', () => {
    const r = validateMissionPlan({ objective: 'x'.repeat(MISSION_BOUNDS.MAX_OBJECTIVE_LEN + 1), tasks: [{ key: 'a', title: 't' }], dependencies: [] });
    expect(r.ok).toBe(false);
  });
});

describe('Gate 39 — lifecycle transitions (deterministic)', () => {
  it('G39-22: legal lifecycle enforced (draft->pending->approved->materialized->active->terminal)', () => {
    const chain: Array<[string, string, boolean]> = [
      ['draft', 'pending_approval', true],
      ['pending_approval', 'approved', true],
      ['approved', 'materialized', true],
      ['materialized', 'active', true],
      ['active', 'completed', true],
      ['active', 'failed', true],
      ['active', 'cancelled', true],
    ];
    for (const [from, to, ok] of chain) expect(missionCanTransition(from as never, to as never)).toBe(ok);
  });

  it('G39-23: terminal statuses have no outgoing transitions; skipping states is illegal', () => {
    for (const t of ['completed', 'failed', 'cancelled']) {
      for (const n of Object.keys(MISSION_LIFECYCLE) as string[]) {
        expect(missionCanTransition(t as MissionStatus, n as never)).toBe(false);
      }
    }
    expect(missionCanTransition('draft', 'approved')).toBe(false);
    expect(missionCanTransition('pending_approval', 'materialized')).toBe(false);
    expect(missionCanTransition('approved', 'active')).toBe(false);
    expect(missionCanTransition('materialized', 'completed')).toBe(false);
  });

  it('G39-24: owner cancellation classifies as cancelled, never failed', () => {
    expect(missionCanTransition('pending_approval', 'cancelled')).toBe(true);
    expect(missionCanTransition('approved', 'cancelled')).toBe(true);
    expect(missionCanTransition('materialized', 'cancelled')).toBe(true);
    expect(missionCanTransition('draft', 'failed')).toBe(false);
  });

  it('G39-25: MISSION_COMPLETED iff EVERY mission task completed', () => {
    const mk = (status: TaskRecord['status']) => ({ status } as TaskRecord);
    expect(missionCompleted([mk('completed'), mk('completed')])).toBe(true);
    expect(missionCompleted([mk('completed'), mk('queued')])).toBe(false);
    expect(missionCompleted([mk('completed')])).toBe(true);
    expect(missionCompleted([])).toBe(false);
  });

  it('G39-26: MISSION_FAILED iff >=1 task reaches final failed state (retryable != failed)', () => {
    const mk = (status: TaskRecord['status']) => ({ status } as TaskRecord);
    expect(missionFailed([mk('completed'), mk('failed')])).toBe(true);
    // Transient/retryable states are NOT mission failure.
    expect(missionFailed([mk('queued'), mk('running')])).toBe(false);
    expect(missionFailed([mk('failed')])).toBe(true);
    // Titled status precedence: completed if all done, else failed if any final failure.
    expect(missionTitledStatus([mk('completed'), mk('completed')])).toBe('completed');
    expect(missionTitledStatus([mk('completed'), mk('failed')])).toBe('failed');
    expect(missionTitledStatus([mk('queued')])).toBeNull();
  });
});

describe('Gate 39 — MemoryStore mission parity', () => {
  let store: Store;
  beforeEach(() => { store = makeStore(); });

  it('G39-27: createMission persists owner/project/objective with draft status', async () => {
    const { ownerId, projectId } = await makeOwnerProject(store);
    const m = await store.createMission(ownerId, { ownerId, projectId, objective: 'hello', budgetLimit: 100 });
    expect(m.status).toBe('draft');
    expect(m.ownerId).toBe(ownerId);
    expect(m.projectId).toBe(projectId);
    expect(m.planHash).toBeNull();
    const got = await store.getMission(ownerId, m.id);
    expect(got?.id).toBe(m.id);
  });

  it('G39-28: listMissions filters by project and status', async () => {
    const { ownerId, projectId } = await makeOwnerProject(store);
    await store.createMission(ownerId, { ownerId, projectId, objective: 'a' });
    await store.createMission(ownerId, { ownerId, projectId, objective: 'b' });
    expect((await store.listMissions(ownerId, { projectId })).length).toBe(2);
    expect((await store.listMissions(ownerId, { status: 'draft' })).length).toBe(2);
  });

  it('G39-29: cross-owner mission isolation in MemoryStore', async () => {
    const { ownerId, projectId } = await makeOwnerProject(store);
    const m = await store.createMission(ownerId, { ownerId, projectId, objective: 'secret' });
    const other = uuid();
    expect(await store.getMission(other, m.id)).toBeNull();
    expect((await store.listMissions(other)).length).toBe(0);
  });

  it('G39-30: materialization is atomic all-or-nothing and idempotent-safe', async () => {
    const { ownerId, projectId } = await makeOwnerProject(store);
    const plan = validPlan();
    const { missionId } = await approveMission(store, ownerId, projectId, plan);
    const prepared = prepareMissionPlan(plan);
    const r = await store.materializeMissionPlanAtomic(ownerId, missionId, prepared.plan!);
    expect(r.ok).toBe(true);
    expect(r.taskCount).toBe(3);
    const tasks = await store.listMissionTasks(ownerId, missionId);
    expect(tasks.length).toBe(3);
    for (const t of tasks) {
      expect(t.status).toBe('created');
      expect(t.agentId).toBeNull();
      expect(t.missionId).toBe(missionId);
      expect(t.missionTaskKey).not.toBeNull();
    }
    const mission = await store.getMission(ownerId, missionId);
    expect(mission?.status).toBe('materialized');
    // Repeat materialization is idempotent -> no duplicate tasks.
    const r2 = await store.materializeMissionPlanAtomic(ownerId, missionId, prepared.plan!);
    expect(r2.outcome).toBe('already_materialized');
    expect((await store.listMissionTasks(ownerId, missionId)).length).toBe(3);
  });

  it('G39-31: materialize without approval is rejected (no_approval)', async () => {
    const { ownerId, projectId } = await makeOwnerProject(store);
    const plan = validPlan();
    const prepared = prepareMissionPlan(plan);
    const mission = await store.createMission(ownerId, { ownerId, projectId, objective: plan.objective });
    await store.saveMissionPlan(ownerId, mission.id, prepared.plan!, prepared.hash!);
    await store.setMissionPendingApproval(ownerId, mission.id);
    await store.markMissionApproved(ownerId, mission.id); // approved but NO approval row
    const r = await store.materializeMissionPlanAtomic(ownerId, mission.id, prepared.plan!);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('no_approval');
    expect((await store.listMissionTasks(ownerId, mission.id)).length).toBe(0);
  });

  it('G39-32: stale plan hash cannot materialize (approval bound to exact hash)', async () => {
    const { ownerId, projectId } = await makeOwnerProject(store);
    const plan = validPlan();
    // Approve for the ORIGINAL hash.
    const { missionId } = await approveMission(store, ownerId, projectId, plan);
    // Now attempt to materialize a DIFFERENT plan (different hash) than was approved.
    const other = prepareMissionPlan({ objective: 'different objective!', tasks: [{ key: 'A', title: 'T' }], dependencies: [] });
    const r = await store.materializeMissionPlanAtomic(ownerId, missionId, other.plan!);
    // The approved plan was bound to its canonical hash; a different plan yields a
    // different hash => the approval is now STALE and cannot materialize.
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('stale_approval');
    expect((await store.listMissionTasks(ownerId, missionId)).length).toBe(0);
  });

  it('G39-33: activation atomically queues ALL mission tasks (ALL or NONE)', async () => {
    const { ownerId, projectId } = await makeOwnerProject(store);
    const plan = validPlan();
    const { missionId } = await approveMission(store, ownerId, projectId, plan);
    const prepared = prepareMissionPlan(plan);
    await store.materializeMissionPlanAtomic(ownerId, missionId, prepared.plan!);
    const r = await store.activateMissionAtomic(ownerId, missionId);
    expect(r.ok).toBe(true);
    expect(r.queuedTaskCount).toBe(3);
    const tasks = await store.listMissionTasks(ownerId, missionId);
    expect(tasks.every((t) => t.status === 'queued')).toBe(true);
    const mission = await store.getMission(ownerId, missionId);
    expect(mission?.status).toBe('active');
    // Repeat activation is idempotent.
    const r2 = await store.activateMissionAtomic(ownerId, missionId);
    expect(r2.outcome).toBe('already_active');
  });

  it('G39-34: activation before materialization is rejected; never partial-active', async () => {
    const { ownerId, projectId } = await makeOwnerProject(store);
    const mission = await store.createMission(ownerId, { ownerId, projectId, objective: 'x' });
    const r = await store.activateMissionAtomic(ownerId, mission.id);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('mission_not_materialized');
  });

  it('G39-35: mission_task_key is unique per mission and persisted', async () => {
    const { ownerId, projectId } = await makeOwnerProject(store);
    const plan: MissionPlanCanonical = {
      objective: 'x',
      tasks: [{ key: 'dup', title: 't1' }, { key: 'dup', title: 't2' }],
      dependencies: [],
    };
    const prepared = prepareMissionPlan(plan); // validator rejects duplicate key
    expect(prepared.ok).toBe(false);
    // A valid plan materializes distinct keys.
    const good = validPlan();
    const { missionId } = await approveMission(store, ownerId, projectId, good);
    const gp = prepareMissionPlan(good);
    await store.materializeMissionPlanAtomic(ownerId, missionId, gp.plan!);
    const keys = (await store.listMissionTasks(ownerId, missionId)).map((t) => t.missionTaskKey).sort();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('G39-36: budget exceeds project hard budget -> materialization rejected', async () => {
    const { ownerId, projectId } = await makeOwnerProject(store);
    // Set a tiny project hard budget.
    await store.setPreference(ownerId, 'budget', projectId, 5);
    const plan: MissionPlanCanonical = { ...validPlan(), estimatedBudget: 1000 };
    const prepared = prepareMissionPlan(plan);
    expect(prepared.ok).toBe(true);
    const mission = await store.createMission(ownerId, { ownerId, projectId, objective: plan.objective });
    await store.saveMissionPlan(ownerId, mission.id, prepared.plan!, prepared.hash!);
    await store.setMissionPendingApproval(ownerId, mission.id);
    await store.createApproval(ownerId, { projectId, action: 'mission.plan.approve', requestedBy: ownerId, metadata: { missionId: mission.id, planHash: prepared.hash } });
    const pending = (await store.listApprovals(ownerId, { projectId, status: 'pending' })).find((a) => a.action === 'mission.plan.approve')!;
    await store.patchApproval(ownerId, pending.id, { status: 'approved', decidedBy: ownerId });
    await store.markMissionApproved(ownerId, mission.id);
    const r = await store.materializeMissionPlanAtomic(ownerId, mission.id, prepared.plan!);
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('budget_exceeded');
    expect((await store.listMissionTasks(ownerId, mission.id)).length).toBe(0);
  });

  it('G39-37: mission engine creates NO assignments and NO agent selection', async () => {
    const { ownerId, projectId } = await makeOwnerProject(store);
    const plan = validPlan();
    const { missionId } = await approveMission(store, ownerId, projectId, plan);
    const prepared = prepareMissionPlan(plan);
    await store.materializeMissionPlanAtomic(ownerId, missionId, prepared.plan!);
    const tasks = await store.listMissionTasks(ownerId, missionId);
    for (const t of tasks) expect(t.agentId).toBeNull();
  });

  it('G39-38: updateMissionStatus enforces legal lifecycle and records timestamps', async () => {
    const { ownerId, projectId } = await makeOwnerProject(store);
    const mission = await store.createMission(ownerId, { ownerId, projectId, objective: 'x' });
    expect((await store.updateMissionStatus(ownerId, mission.id, 'approved'))).toBeNull(); // illegal jump
    await store.updateMissionStatus(ownerId, mission.id, 'cancelled');
    const c = await store.getMission(ownerId, mission.id);
    expect(c?.status).toBe('cancelled');
    expect(c?.cancelledAt).not.toBeNull();
  });

  it('G39-39: status semantic rule is driven by memory engine (completed only when all done)', async () => {
    const mk = (status: TaskRecord['status']) => ({ status } as TaskRecord);
    expect(missionTitledStatus([mk('completed'), mk('completed')])).toBe('completed');
    expect(missionTitledStatus([mk('completed'), mk('running')])).toBeNull();
  });
});
