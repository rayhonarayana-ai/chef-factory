// CHEF FACTORY — Gate 44 — Mission Execution Engine (production wiring).
//
// This module connects the FROZEN Gate39 mission primitives to the production
// runtime WITHOUT redesigning them. It is a thin, deterministic orchestration
// layer over the existing Store surface (createMission / saveMissionPlan /
// setMissionPendingApproval / materializeMissionPlanAtomic /
// activateMissionAtomic / updateMissionStatus).
//
// Doctrinal guarantees:
//   - PLAN_DERIVATION is PROPOSAL_ONLY: every candidate plan passes the frozen
//     Gate39 validator (prepareMissionPlan) before it may be persisted. This
//     module never invents authority, never grants permissions, never selects
//     agents, never approves, and never executes tools.
//   - HUMAN_APPROVAL binding: an owner approval is created + resolved only
//     after the proposed plan has passed validation, and it binds to the exact
//     canonical plan hash. Materialization re-verifies the hash against BOTH
//     the persisted mission.plan_hash and the approval's metadata planHash, so
//     a stale/overwritten approval can never activate a different plan.
//   - ATOMIC_MATERIALIZATION + ATOMIC_ACTIVATION reuse the frozen all-or-nothing
//     transactions; a failure mid-materialization cannot leave an active
//     half-materialized mission.
//   - TERMINAL evaluation is deterministic + idempotent + owner/project scoped
//     and safe under concurrent workers (updateMissionStatus is guarded by the
//     lifecycle transition and an idempotent status-change guard).
//
// The workforce execution engine (Gate37/41) remains the authoritative task
// scheduler/executor. This module does NOT create a second scheduler. Mission
// tasks become schedulable only through the existing listSchedulableTasks gate
// (queued + dependency-readiness), so mission tasks obey the exact same
// workforce, authority, SecurityGuardian, ToolBroker, budget, model-routing,
// health-routing, capacity, owner isolation, and project isolation as ordinary
// tasks. MISSION_TASK_BYPASSES_WORKFORCE = NO, MISSION_TASK_BYPASSES_SECURITY = NO.

import type { Store } from '../ports.js';
import type { MissionPlanCanonical, MissionRecord } from '../types.js';
import { prepareMissionPlan } from './planner.js';
import { missionTitledStatus } from './missionEngine.js';
import { resolveApproval } from '../approval.js';
import type { PlannerResult } from './planner.js';

const MISSION_PLAN_APPROVE_ACTION = 'mission.plan.approve';

export interface PlanOutcome {
  ok: boolean;
  errors: string[];
  plan: MissionPlanCanonical | null;
  hash: string | null;
  mission: MissionRecord | null;
  validation: PlannerResult['validation'] | null;
  // The id of the PENDING approval awaiting an explicit owner decision. A plan
  // proposal NEVER resolves its own approval — it only requests review.
  approvalId: string | null;
}

export type MissionDecision = 'approved' | 'rejected' | 'denied';

export interface MissionDecisionOutcome {
  ok: boolean;
  error: string | null;
  mission: MissionRecord | null;
  approval: import('../types.js').ApprovalRecord | null;
}

export interface MaterializeActivateOutcome {
  ok: boolean;
  error: string | null;
  materializeOutcome: string | null;
  activateOutcome: string | null;
  mission: MissionRecord | null;
  queuedTaskCount: number;
}

export interface ReconcileOutcome {
  ok: boolean;
  missionId: string;
  reconciled: boolean;
  terminalStatus: 'completed' | 'failed' | 'cancelled' | null;
  mission: MissionRecord | null;
  error: string | null;
}

/**
 * Propose a mission plan through the frozen Gate39 validation + hashing path.
 * On success the validated canonical plan is persisted, the mission is moved to
 * pending_approval, and a PENDING mission.plan.approve approval record is created
 * that awaits an explicit owner decision. The mission remains NON-EXECUTABLE: no
 * tasks are created, no agents assigned, no permissions granted, and the plan is
 * NOT approved — PLAN_PROPOSAL != PLAN_APPROVAL. This function NEVER resolves its
 * own approval (MISSION_ENGINE_CAN_SELF_APPROVE = NO); only the distinct
 * authenticated owner decision (decideMissionPlanApproval) transitions it.
 * Invalid proposals are NEVER persisted (return ok:false, mission unchanged).
 */
export async function proposeMissionPlan(
  store: Store,
  ownerId: string,
  missionId: string,
  proposal: MissionPlanCanonical,
  opts: { maxTasks?: number; maxEdges?: number } = {},
): Promise<PlanOutcome> {
  const prepared = prepareMissionPlan(proposal, opts);
  if (!prepared.ok || !prepared.plan || !prepared.hash) {
    return { ok: false, errors: prepared.validation.errors, plan: null, hash: null, mission: null, validation: prepared.validation, approvalId: null };
  }
  const saved = await store.saveMissionPlan(ownerId, missionId, prepared.plan, prepared.hash);
  if (!saved) {
    return { ok: false, errors: ['mission not found or plan already bound to a different hash'], plan: null, hash: null, mission: null, validation: prepared.validation, approvalId: null };
  }
  const pending = await store.setMissionPendingApproval(ownerId, missionId);
  const approval = await store.createApproval(ownerId, {
    projectId: saved.projectId,
    action: MISSION_PLAN_APPROVE_ACTION,
    description: 'Approve mission plan',
    riskLevel: 'medium',
    requestedBy: ownerId,
    metadata: { missionId, planHash: prepared.hash },
  });
  return { ok: true, errors: [], plan: prepared.plan, hash: prepared.hash, mission: pending ?? saved, validation: prepared.validation, approvalId: approval.id };
}

/**
 * The EXPLICIT owner decision on a proposed mission plan. This is the ONLY path
 * that resolves a mission.plan.approve approval to a terminal state. It is a
 * distinct, authenticated, owner-scoped action — a plan proposal (proposeMissionPlan)
 * merely REQUESTED this review and never self-approves. The decision:
 *
 *   - loads the mission through the owner-scoped Store surface (non-owner => null),
 *   - requires the mission to be pending_approval,
 *   - requires the referenced approval to exist for THIS owner, be a
 *     mission.plan.approve approval, and bind to BOTH the exact missionId and the
 *     exact persisted planHash (metadata { missionId, planHash }),
 *   - resolves it via the frozen resolveApproval + patchApproval core, recording
 *     decidedBy = the authenticated owner. Agents, models, the workforce service,
 *     generic system actors, and unauthenticated callers cannot reach this as an
 *     owner (MISSION_ENGINE_CAN_SELF_APPROVE/MODEL_CAN_APPROVE/
 *     AGENT_CAN_APPROVE/WORKFORCE_CAN_APPROVE = NO),
 *   - only after an 'approved' decision does it transition the mission to approved
 *     (markMissionApproved); rejected/denied leaves it pending_approval and
 *     non-executable.
 *
 * STALE_APPROVAL_REJECTED: if the approval's bound planHash no longer equals the
 * mission's current plan_hash (plan was re-proposed/replaced), the decision is
 * refused so a stale approval can never activate a changed plan.
 */
export async function decideMissionPlanApproval(
  store: Store,
  ownerId: string,
  missionId: string,
  approvalId: string,
  decision: MissionDecision,
  opts: { reason?: string; now?: string } = {},
): Promise<MissionDecisionOutcome> {
  const mission = await store.getMission(ownerId, missionId);
  if (!mission) return { ok: false, error: 'mission not found', mission: null, approval: null };
  if (mission.status !== 'pending_approval') {
    return { ok: false, error: `mission not pending approval (status=${mission.status})`, mission, approval: null };
  }
  const approval = await store.getApproval(ownerId, approvalId);
  if (!approval) return { ok: false, error: 'approval not found', mission, approval: null };
  if (approval.action !== MISSION_PLAN_APPROVE_ACTION || approval.taskId !== null) {
    return { ok: false, error: 'approval is not a mission plan approval', mission, approval };
  }
  const boundMission = approval.metadata?.['missionId'];
  const boundHash = approval.metadata?.['planHash'];
  if (boundMission !== missionId || boundHash !== mission.planHash) {
    return { ok: false, error: 'stale approval: does not bind this mission and its exact plan hash', mission, approval };
  }
  if (isTerminalApproval(approval)) {
    return { ok: false, error: `approval already in terminal state ${approval.status}`, mission, approval };
  }
  const { approval: resolved, error } = resolveApproval({
    approval,
    status: decision,
    decision: opts.reason ?? decision,
    decidedBy: ownerId,
    now: opts.now,
  });
  if (error) return { ok: false, error, mission, approval };
  const patched = await store.patchApproval(ownerId, approvalId, {
    status: resolved.status,
    decision: resolved.decision,
    decisionReason: resolved.decisionReason,
    decidedBy: resolved.decidedBy,
    decidedAt: resolved.decidedAt,
  });
  let m: MissionRecord | null = mission;
  if (decision === 'approved') {
    m = (await store.markMissionApproved(ownerId, missionId)) ?? mission;
  }
  return { ok: true, error: null, mission: m, approval: patched };
}

function isTerminalApproval(a: import('../types.js').ApprovalRecord): boolean {
  return ['approved', 'rejected', 'denied', 'expired', 'cancelled'].includes(a.status);
}

/**
 * Materialize + activate the approved mission through the frozen atomic
 * primitives. Only an approved + hash-verified plan can materialize; only a
 * fully materialized mission activates. A failure in either transaction leaves
 * NO active half-materialized state.
 */
export async function materializeAndActivateMission(
  store: Store,
  ownerId: string,
  missionId: string,
  plan: MissionPlanCanonical,
): Promise<MaterializeActivateOutcome> {
  const mat = await store.materializeMissionPlanAtomic(ownerId, missionId, plan);
  if (!mat.ok) {
    return {
      ok: false,
      error: `materialization rejected: ${mat.outcome}`,
      materializeOutcome: mat.outcome,
      activateOutcome: null,
      mission: mat.mission,
      queuedTaskCount: 0,
    };
  }
  const act = await store.activateMissionAtomic(ownerId, missionId);
  if (!act.ok) {
    return {
      ok: false,
      error: `activation rejected: ${act.outcome}`,
      materializeOutcome: mat.outcome,
      activateOutcome: act.outcome,
      mission: act.mission,
      queuedTaskCount: 0,
    };
  }
  return {
    ok: true,
    error: null,
    materializeOutcome: mat.outcome,
    activateOutcome: act.outcome,
    mission: act.mission,
    queuedTaskCount: act.queuedTaskCount,
  };
}

/**
 * Deterministic, idempotent terminal reconciliation for a single mission, driven
 * ONLY by persisted task state (never an LLM). If every required mission task is
 * 'completed' -> mission completed. If any required task reached the terminal
 * 'failed' state -> mission failed (frozen Gate39 semantics). CANCELLED is never
 * treated as completion, and a FAILED prerequisite never satisfies a dependency.
 * Safe under concurrent workers: updateMissionStatus returns null on an illegal
 * or already-applied transition, so concurrent reconcilers cannot corrupt state.
 */
export async function reconcileMissionTerminalState(
  store: Store,
  ownerId: string,
  missionId: string,
): Promise<ReconcileOutcome> {
  try {
    const mission = await store.getMission(ownerId, missionId);
    if (!mission) return { ok: false, missionId, reconciled: false, terminalStatus: null, mission: null, error: 'mission not found' };
    if (mission.status !== 'active') {
      return { ok: true, missionId, reconciled: false, terminalStatus: null, mission, error: null };
    }
    const tasks = await store.listMissionTasks(ownerId, missionId);
    const status = missionTitledStatus(tasks);
    if (status === null) {
      return { ok: true, missionId, reconciled: false, terminalStatus: null, mission, error: null };
    }
    const terminal: 'completed' | 'failed' = status === 'completed' ? 'completed' : 'failed';
    const updated = await store.updateMissionStatus(ownerId, missionId, terminal);
    return { ok: true, missionId, reconciled: true, terminalStatus: terminal, mission: updated ?? mission, error: null };
  } catch (e) {
    return { ok: false, missionId, reconciled: false, terminalStatus: null, mission: null, error: String(e) };
  }
}

/**
 * Bounded reconciliation of all ACTIVE missions for an owner. Cheap: one
 * status-filtered listing plus per-active-mission terminal reconciliation. Safe
 * to call repeatedly (idempotent) and under concurrent workers.
 */
export async function reconcileOwnerActiveMissions(store: Store, ownerId: string): Promise<ReconcileOutcome[]> {
  const active = await store.listMissions(ownerId, { status: 'active' });
  const outcomes: ReconcileOutcome[] = [];
  for (const m of active) {
    outcomes.push(await reconcileMissionTerminalState(store, ownerId, m.id));
  }
  return outcomes;
}

// Re-export the deterministic core so callers/tests can consume one surface.
export { prepareMissionPlan, missionTitledStatus };
