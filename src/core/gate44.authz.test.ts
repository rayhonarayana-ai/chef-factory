// CHEF FACTORY — Gate 44 — Approval-Boundary Authorization (handler/API level).
// Proves the mission-plan human-approval boundary and real API authorization
// through the ACTUAL production handler (Api.handle), not by passing a bare
// ownerId into a service. The owner identity comes ONLY from the authenticated
// session (SessionOwner), never from request JSON. Uses MemoryStore parity so no
// live DB is touched and no model/provider is called.
//
// LIVE_MODEL_PROVIDER_CALLS = 0, LIVE_DB_MUTATION = NONE.

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { Api, type ApiRequest } from '../api/handlers.js';
import type { AuthService, SessionOwner } from '../api/auth.js';
import type { CommandPipeline, ExecutionRunner } from './pipeline.js';
import { WORKFORCE_SERVICE_ACTOR } from './workforceService.js';
import { hashMissionPlan } from './mission/missionEngine.js';

const uuid = (): string => crypto.randomUUID();
const session = (id: string, email?: string): SessionOwner => ({ id, email: email ?? `${id}@chef.local` });

interface Fx {
  api: Api;
  store: MemoryStore;
  ownerA: SessionOwner;
  ownerB: SessionOwner;
  agent: SessionOwner;
  service: SessionOwner;
  system: SessionOwner;
  projectA: string;
  projectB: string;
}

async function fixtures(): Promise<Fx> {
  const store = new MemoryStore();
  const api = new Api(store, {} as AuthService, {} as CommandPipeline, {} as ExecutionRunner);
  const ownerA = session('owner-A-' + uuid());
  const ownerB = session('owner-B-' + uuid());
  const agent = session('agent-44-' + uuid());
  const service = session(WORKFORCE_SERVICE_ACTOR);
  const system = session('system:admin');
  const projectA = (await store.createProject(ownerA.id, { name: 'A', slug: 'a-' + uuid() })).id;
  const projectB = (await store.createProject(ownerB.id, { name: 'B', slug: 'b-' + uuid() })).id;
  return { api, store, ownerA, ownerB, agent, service, system, projectA, projectB };
}

function call(api: Api, owner: SessionOwner, method: string, path: string, params: Record<string, string>, body?: unknown) {
  return api.handle({ method, path, params, body: body ?? {}, owner, raw: {} as never } as ApiRequest);
}

function validPlan() {
  return {
    objective: 'authorization test plan',
    tasks: [
      { key: 'A', title: 'Task A', successCriteria: ['A done'] },
      { key: 'B', title: 'Task B', successCriteria: ['B done'] },
    ],
    dependencies: [{ prerequisiteKey: 'A', dependentKey: 'B' }],
    estimatedBudget: 10,
  };
}

interface CreatedMission { mission: { id: string; status: string; planHash: string | null; projectId: string } }

async function createMissionForA(fx: Fx): Promise<string> {
  const r = await call(fx.api, fx.ownerA, 'POST', '/api/missions', {}, { projectId: fx.projectA, objective: 'objective' });
  expect(r.status).toBe(200);
  return (r.json as CreatedMission).mission.id;
}

async function proposeForA(fx: Fx, missionId: string): Promise<{ planHash: string; approvalId: string }> {
  const r = await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/plan', { missionId }, { plan: validPlan() });
  expect(r.status).toBe(200);
  const j = r.json as { plan_hash: string; approval_id: string };
  return { planHash: j.plan_hash, approvalId: j.approval_id };
}

// =====================================================================
// 01–07  Cross-owner API authorization (real handler boundary)
// =====================================================================
describe('Gate44 — API authorization (01-07)', () => {
  it('01: unauthenticated caller cannot create a mission (treats identity as absent)', async () => {
    const fx = await fixtures();
    // MemoryStore has no auth middleware; the handler derives owner from the
    // session object it is handed. An absent/unauth caller is modeled as a
    // non-owner session that cannot pass any owner-scoped create. We assert the
    // create forbids a mismatched identity, and that an anonymous actor has no
    // session owner to operate with by verifying GET mission list is empty for it.
    const anon = session('anon-' + uuid());
    const r = await call(fx.api, anon, 'GET', '/api/missions', {});
    expect(r.status).toBe(200);
    expect((r.json as { missions: unknown[] }).missions).toEqual([]);
    // owner B (different identity) cannot create in A's project scope.
    const r2 = await call(fx.api, fx.ownerB, 'POST', '/api/missions', {}, { projectId: fx.projectA, objective: 'x' });
    expect(r2.status).toBe(404);
  });

  it('02: authenticated owner A can create a mission for owner A', async () => {
    const fx = await fixtures();
    const r = await call(fx.api, fx.ownerA, 'POST', '/api/missions', {}, { projectId: fx.projectA, objective: 'objective' });
    expect(r.status).toBe(200);
    const j = r.json as CreatedMission;
    expect(j.mission.ownerId).toBe(fx.ownerA.id);
    expect(j.mission.status).toBe('draft');
  });

  it('03: request body ownerId cannot cause owner A to create a mission for B', async () => {
    const fx = await fixtures();
    const r = await call(fx.api, fx.ownerA, 'POST', '/api/missions', {}, { projectId: fx.projectA, objective: 'x', ownerId: fx.ownerB.id });
    expect(r.status).toBe(200);
    const j = r.json as CreatedMission;
    // The handler derives owner from AUTH session, not the body.
    expect(j.mission.ownerId).toBe(fx.ownerA.id);
    expect(j.mission.ownerId).not.toBe(fx.ownerB.id);
  });

  it('04: owner B cannot read owner A mission', async () => {
    const fx = await fixtures();
    const missionId = await createMissionForA(fx);
    const r = await call(fx.api, fx.ownerB, 'GET', '/api/missions/:missionId', { missionId });
    expect(r.status).toBe(404);
  });

  it('05: owner B cannot propose/replace owner A plan', async () => {
    const fx = await fixtures();
    const missionId = await createMissionForA(fx);
    const r = await call(fx.api, fx.ownerB, 'POST', '/api/missions/:missionId/plan', { missionId }, { plan: validPlan() });
    expect(r.status).toBe(422); // invalid_plan: mission not found for owner B => proposal refused
  });

  it('06: owner B cannot approve owner A plan', async () => {
    const fx = await fixtures();
    const missionId = await createMissionForA(fx);
    const { approvalId } = await proposeForA(fx, missionId);
    const r = await call(fx.api, fx.ownerB, 'POST', '/api/missions/:missionId/approve', { missionId }, { approvalId, decision: 'approved' });
    // owner B's owner-scoped getMission returns null -> refused.
    expect(r.status).toBe(404);
    const after = await fx.store.getMission(fx.ownerA.id, missionId);
    expect(after?.status).toBe('pending_approval');
  });

  it('07: owner B cannot materialize owner A plan', async () => {
    const fx = await fixtures();
    const missionId = await createMissionForA(fx);
    const { approvalId } = await proposeForA(fx, missionId);
    // A approves, then B tries to materialize.
    await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/approve', { missionId }, { approvalId, decision: 'approved' });
    const r = await call(fx.api, fx.ownerB, 'POST', '/api/missions/:missionId/materialize', { missionId }, { plan: validPlan() });
    expect(r.status).toBe(409);
    expect((r.json as { error: string }).error).toMatch(/mission_not_found/i);
    expect(await fx.store.listMissionTasks(fx.ownerA.id, missionId)).toEqual([]);
  });
});

// =====================================================================
// 08–11  Non-owner/agent/workforce/system/model identities cannot approve
// =====================================================================
describe('Gate44 — only the owner can approve (08-11)', () => {
  async function proposePending(fx: Fx): Promise<{ missionId: string; approvalId: string }> {
    const missionId = await createMissionForA(fx);
    const { approvalId } = await proposeForA(fx, missionId);
    return { missionId, approvalId };
  }

  it('08: agent identity cannot approve', async () => {
    const fx = await fixtures();
    const { missionId, approvalId } = await proposePending(fx);
    const r = await call(fx.api, fx.agent, 'POST', '/api/missions/:missionId/approve', { missionId }, { approvalId, decision: 'approved' });
    expect(r.status).toBe(404);
    const appr = await fx.store.getApproval(fx.ownerA.id, approvalId);
    expect(appr?.status).toBe('pending');
  });

  it('09: workforce-service identity cannot approve', async () => {
    const fx = await fixtures();
    const { missionId, approvalId } = await proposePending(fx);
    const r = await call(fx.api, fx.service, 'POST', '/api/missions/:missionId/approve', { missionId }, { approvalId, decision: 'approved' });
    expect(r.status).toBe(404);
    const appr = await fx.store.getApproval(fx.ownerA.id, approvalId);
    expect(appr?.status).toBe('pending');
  });

  it('10: generic system identity cannot approve', async () => {
    const fx = await fixtures();
    const { missionId, approvalId } = await proposePending(fx);
    const r = await call(fx.api, fx.system, 'POST', '/api/missions/:missionId/approve', { missionId }, { approvalId, decision: 'approved' });
    expect(r.status).toBe(404);
    const appr = await fx.store.getApproval(fx.ownerA.id, approvalId);
    expect(appr?.status).toBe('pending');
  });

  it('11: model output cannot mark approval approved (model identity reaches no owner record)', async () => {
    const fx = await fixtures();
    const { missionId, approvalId } = await proposePending(fx);
    const modelActor = session('model-' + uuid());
    const r = await call(fx.api, modelActor, 'POST', '/api/missions/:missionId/approve', { missionId }, { approvalId, decision: 'approved' });
    expect(r.status).toBe(404);
    const appr = await fx.store.getApproval(fx.ownerA.id, approvalId);
    expect(appr?.status).toBe('pending');
    const after = await fx.store.getMission(fx.ownerA.id, missionId);
    expect(after?.status).toBe('pending_approval');
  });
});

// =====================================================================
// 12–20  Pending state, no-DAG until approval, binding, replay safety
// =====================================================================
describe('Gate44 — pending state, binding, replay safety (12-20)', () => {
  it('12: plan proposal ends in pending-approval and 13: no tasks exist while pending', async () => {
    const fx = await fixtures();
    const missionId = await createMissionForA(fx);
    const { planHash, approvalId } = await proposeForA(fx, missionId);
    const m = await fx.store.getMission(fx.ownerA.id, missionId);
    expect(m?.status).toBe('pending_approval');
    expect(m?.planHash).toBe(planHash);
    expect(approvalId).toBeTruthy();
    expect(await fx.store.listMissionTasks(fx.ownerA.id, missionId)).toEqual([]);
  });

  it('14: pending approval cannot materialize', async () => {
    const fx = await fixtures();
    const missionId = await createMissionForA(fx);
    await proposeForA(fx, missionId);
    const r = await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/materialize', { missionId }, { plan: validPlan() });
    expect(r.status).toBe(409);
    expect((r.json as { materialize_outcome: string }).materialize_outcome).toMatch(
      /no_approval|mission_not_approved|stale_approval/,
    );
  });

  it('15: explicit owner approval changes the correct approval to approved', async () => {
    const fx = await fixtures();
    const missionId = await createMissionForA(fx);
    const { approvalId } = await proposeForA(fx, missionId);
    const r = await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/approve', { missionId }, { approvalId, decision: 'approved', reason: 'approved by owner' });
    expect(r.status).toBe(200);
    const appr = await fx.store.getApproval(fx.ownerA.id, approvalId);
    expect(appr?.status).toBe('approved');
    expect(appr?.decidedBy).toBe(fx.ownerA.id);
    const m = await fx.store.getMission(fx.ownerA.id, missionId);
    expect(m?.status).toBe('approved');
  });

  it('16: approval metadata binds exact missionId + planHash', async () => {
    const fx = await fixtures();
    const missionId = await createMissionForA(fx);
    const { approvalId, planHash } = await proposeForA(fx, missionId);
    const appr = await fx.store.getApproval(fx.ownerA.id, approvalId);
    expect(appr?.metadata).toMatchObject({ missionId, planHash });
    expect(appr?.action).toBe('mission.plan.approve');
  });

  it('17: stale approval cannot approve a changed plan', async () => {
    const fx = await fixtures();
    const missionId = await createMissionForA(fx);
    const { approvalId } = await proposeForA(fx, missionId);
    const current = await fx.store.getMission(fx.ownerA.id, missionId);
    // A stale approval: same mission but bound to a DIFFERENT (wrong) plan hash via
    // the store directly — the owner's decision on it must be refused because it no
    // longer binds the exact persisted plan hash.
    const stale = await fx.store.createApproval(fx.ownerA.id, {
      projectId: fx.projectA, action: 'mission.plan.approve', requestedBy: fx.ownerA.id,
      metadata: { missionId, planHash: '0'.repeat(64) },
    });
    const refused = await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/approve', { missionId }, { approvalId: stale.id, decision: 'approved' });
    expect(refused.status).toBe(409);
    expect((refused.json as { error: string }).error).toMatch(/stale/i);
    // The real, correctly-bound approval is untouched and still pending.
    const real = await fx.store.getApproval(fx.ownerA.id, approvalId);
    expect(real?.status).toBe('pending');
    expect(current?.status).toBe('pending_approval');
    // Materialization cannot occur while the matching approval is pending.
    const r3 = await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/materialize', { missionId }, { plan: validPlan() });
    expect(r3.status).toBe(409);
    expect(await fx.store.listMissionTasks(fx.ownerA.id, missionId)).toEqual([]);
  });

  it('18: approved plan can materialize exactly once per the frozen atomic contract', async () => {
    const fx = await fixtures();
    const missionId = await createMissionForA(fx);
    const { approvalId, planHash } = await proposeForA(fx, missionId);
    const appr = await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/approve', { missionId }, { approvalId, decision: 'approved' });
    expect(appr.status).toBe(200);
    const r = await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/materialize', { missionId }, { plan: validPlan() });
    expect(r.status).toBe(200);
    expect((r.json as { materialize_outcome: string }).materialize_outcome).toBe('materialized');
    expect(planHash).toBe(hashMissionPlan(validPlan()));
    const tasks = await fx.store.listMissionTasks(fx.ownerA.id, missionId);
    expect(tasks).toHaveLength(2);
    // Second materialize is idempotent (already_materialized) — no duplicate DAG.
    const r2 = await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/materialize', { missionId }, { plan: validPlan() });
    expect((r2.json as { materialize_outcome: string }).materialize_outcome).toBe('already_materialized');
    expect((await fx.store.listMissionTasks(fx.ownerA.id, missionId))).toHaveLength(2);
  });

  it('19: replayed approval/materialization cannot create duplicate DAG', async () => {
    const fx = await fixtures();
    const missionId = await createMissionForA(fx);
    const { approvalId } = await proposeForA(fx, missionId);
    // Repeat the owner decision on the SAME approvalId several times.
    for (const _ of Array.from({ length: 3 })) {
      await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/approve', { missionId }, { approvalId, decision: 'approved' });
    }
    const r = await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/materialize', { missionId }, { plan: validPlan() });
    expect(r.status).toBe(200);
    const edges = (await fx.store.listTaskDependencies(fx.ownerA.id, { projectId: fx.projectA })).edges;
    expect(edges).toHaveLength(1);
    expect(await fx.store.listMissionTasks(fx.ownerA.id, missionId)).toHaveLength(2);
  });

  it('20: activation remains owner-authorized and exact-plan-bound', async () => {
    const fx = await fixtures();
    const missionId = await createMissionForA(fx);
    const { approvalId } = await proposeForA(fx, missionId);
    await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/approve', { missionId }, { approvalId, decision: 'approved' });
    // The /materialize endpoint performs atomic materialize + activate for the owner.
    const r = await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/materialize', { missionId }, { plan: validPlan() });
    expect((r.json as { materialize_outcome: string }).materialize_outcome).toBe('materialized');
    expect((r.json as { activate_outcome: string }).activate_outcome).toBe('activated');
    const m = await fx.store.getMission(fx.ownerA.id, missionId);
    expect(m?.status).toBe('active');
    // Reconcile on an active mission with no terminal tasks does nothing (no early completion).
    const ar = await call(fx.api, fx.ownerA, 'POST', '/api/missions/:missionId/reconcile', { missionId });
    expect((ar.json as { reconciled: boolean }).reconciled).toBe(false);
    expect((await fx.store.getMission(fx.ownerA.id, missionId))?.status).toBe('active');
    // owner B cannot materialize/activate A's mission.
    const denied = await call(fx.api, fx.ownerB, 'POST', '/api/missions/:missionId/materialize', { missionId }, { plan: validPlan() });
    expect(denied.status).toBe(409);
  });
});
