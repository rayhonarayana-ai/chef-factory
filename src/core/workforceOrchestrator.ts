// CHEF FACTORY — Gate 37 (+ Gate 41) — Deterministic Workforce Orchestrator.
//
// Coordinates EXISTING tasks and EXISTING agents across a bounded run.
// Composes canonical primitives ONLY:
//   - listSchedulableTasks (discovery, read-only)
//   - placeTask (Gate 30/31 atomic placement — final placement authority)
//   - executeAssignedAgentTask (Gate 34 execution — final execution authority)
//
// The orchestrator does NOT:
//   - invent missions or decompose objectives
//   - create tasks
//   - assign/claim/execute directly
//   - grant permissions, approve actions, or impersonate the owner
//   - delegate agent-to-agent
//   - bypass SecurityGuardian or ToolBroker (execution routes through Gate 34)
//   - push Git changes
//
// INVARIANTS:
//   ORCHESTRATOR_LLM_CALLS = 0
//   ORCHESTRATOR_CREATES_TASKS = NO
//   ORCHESTRATOR_IMPERSONATES_OWNER = NO
//   ORCHESTRATOR_CAN_GRANT_PERMISSION = NO
//   ORCHESTRATOR_CAN_APPROVE = NO
//   LIST_SCHEDULABLE_TASKS_GRANTS_PLACEMENT = NO
//   ORCHESTRATION_LOOP_BOUNDED = YES
//   HANDOFF_REQUIRES_NEW_ASSIGNMENT = YES
//   HANDOFF_USES_DIRECT_AGENT_TO_AGENT_CALL = NO
//   WORKFORCE_ORCHESTRATION_IMPLEMENTED = YES
//
// Gate 41 — Narrow SYSTEM WORKFORCE initiator:
//   Two allowed initiators, both strictly scoped to scheduling already-authorized work:
//     (A) OWNER   : actorId === ownerId (unchanged, owner invocation remains valid).
//     (B) SERVICE : workforceService===true and actorId === WORKFORCE_SERVICE_ACTOR.
//   In the SERVICE path the orchestrator's OWN authority identity is the reserved
//   system workforce service (actorType='system'), NOT the owner. It is NOT a reusable
//   owner-equivalent authority — it is valid ONLY for this runWorkforce scheduling entry.
//   The workforce service cannot approve, grant permissions, change budgets, bypass
//   SecurityGuardian/ToolBroker, create tasks, mutate missions, or commit/push. Every
//   executed task still runs under its ASSIGNED AGENT's identity through Gate 34.
//
// Gate 41 — Global Emergency Stop + Mission budget:
//   runWorkforce reads the durable global control (fail-closed: missing row or read
//   error => STOP) before scheduling and again before initiating discovered work, so a
//   mid-cycle global stop bounds reaction latency. Mission-backed tasks are re-checked
//   against MissionRecord.budgetLimit via missionCost; an exhausted mission is skipped
//   and never executed (ORCHESTRATOR never invokes the model after a deterministic
//   budget denial).

import type { Store } from './ports.js';
import type { TaskRecord, MissionRecord, AuditEvent } from './types.js';
import type { ExecutionRunner } from './pipeline.js';
import type { PlacementOutcome, PlacementResult } from './placement.js';
import { placeTask } from './placement.js';
import type { AgentExecutionResultOutcome } from './agentExecutor.js';
import { executeAssignedAgentTask } from './agentExecutor.js';
import type { Gate45AcceptanceGateway } from './gate45Acceptance.js';
import { CostProtector, DEFAULT_COST_PROTECTION } from './security/costProtection.js';
import { isGlobalStopActive } from './security/workforceControl.js';
import { WORKFORCE_SERVICE_ACTOR, WORKFORCE_SERVICE_ACTOR_TYPE, WORKFORCE_SERVICE_AUDIT_ACTOR_ID } from './workforceService.js';

// ---------- Bounds ----------

export const DEFAULT_MAX_TASKS_PER_RUN = 5;
export const DEFAULT_MAX_PARALLEL_EXECUTIONS = 3;
export const DEFAULT_RUN_TIMEOUT_MS = 180_000;
export const DEFAULT_DISCOVERY_BATCH_SIZE = 20;

// Hard server-side ceilings. Agent/task inputs can never raise these.
export const HARD_MAX_TASKS_PER_RUN = 20;
export const HARD_MAX_PARALLEL_EXECUTIONS = 5;
export const HARD_RUN_TIMEOUT_MS = 600_000;
export const HARD_DISCOVERY_BATCH_SIZE = 100;

// ---------- Types ----------

export type WorkforceOrchestratorOutcome =
  | 'completed'
  | 'partial'
  | 'blocked'
  | 'nothing_to_do'
  | 'aborted'
  | 'global_stopped'
  | 'budget_exhausted'
  | 'mission_budget_exhausted'
  | 'error';

export interface WorkforceTaskResult {
  taskId: string;
  placement: PlacementOutcome | 'not_attempted';
  execution: AgentExecutionResultOutcome | 'not_executed' | null;
  agentId: string | null;
  blocked: boolean;
}

export interface WorkforceOrchestratorResult {
  outcome: WorkforceOrchestratorOutcome;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  discovered: number;
  placed: number;
  executed: number;
  completed: number;
  failed: number;
  blocked: number;
  approvalRequired: number;
  noEligibleAgent: number;
  capacityBlocked: number;
  conflicts: number;
  skipped: number;
  tasks: WorkforceTaskResult[];
  error: string | null;
}

export interface WorkforceOrchestratorOptions {
  store: Store;
  execution: ExecutionRunner;
  ownerId: string;
  actorId: string;
  /** Gate 41: when true, this invocation is initiated by the narrow SYSTEM WORKFORCE service. */
  workforceService?: boolean;
  /** Gate 41: worker instance identity for audit attribution (required when workforceService). */
  workerId?: string | null;
  projectId?: string | null;
  maxTasksPerRun?: number;
  maxParallelExecutions?: number;
  runTimeoutMs?: number;
  discoveryBatchSize?: number;
  costProtector?: CostProtector;
  signal?: AbortSignal;
  correlationId?: string;
  /** Gate 45 — trusted verification acceptance gateway applied to verification-required tasks. */
  verification?: Gate45AcceptanceGateway;
}

// ---------- Helpers ----------

function cap(value: number | undefined, fallback: number, hardMax: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), hardMax);
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

function placementCapacityBlocked(result: PlacementResult): boolean {
  if (result.rejected.some((r) => r.reason === 'at_capacity' || r.reason === 'capacity_zero')) {
    return true;
  }
  return result.outcome === 'assignment_conflict_exhausted';
}

function placementNoEligible(result: PlacementResult): boolean {
  if (result.outcome === 'no_agents_found') return true;
  if (result.outcome === 'no_eligible_agent') {
    return !result.rejected.some((r) => r.reason === 'at_capacity' || r.reason === 'capacity_zero');
  }
  return false;
}

async function classifyCapacityBlocked(store: Store, ownerId: string, result: PlacementResult): Promise<boolean> {
  if (placementCapacityBlocked(result)) return true;
  if (result.outcome !== 'no_eligible_agent' && result.outcome !== 'no_agents_found') return false;
  try {
    const agents = (await store.listAgents(ownerId)).filter((a) => a.status === 'active');
    if (agents.length === 0) return false;
    const workload = new Map((await store.listAgentWorkload(ownerId)).map((w) => [w.agentId, w.assignedCount]));
    return agents.every((a) => (a.maxConcurrentTasks <= 0) || (workload.get(a.id) ?? 0) >= a.maxConcurrentTasks);
  } catch {
    return placementCapacityBlocked(result);
  }
}

// ---------- Orchestrator ----------

/**
 * Gate 37/41: Run one bounded workforce orchestration pass for an owner.
 *
 * INITIATOR AUTHORIZATION:
 *   (A) Owner invocation:       actorId === ownerId (unchanged).
 *   (B) Workforce-service init: opts.workforceService === true AND actorId ===
 *       WORKFORCE_SERVICE_ACTOR. In this narrow path the orchestrator's own authority
 *       identity is the SYSTEM workforce service; it is valid ONLY for scheduling.
 *
 * Deterministic. No LLM calls from the orchestrator itself. Every placement goes through
 * placeTask and every execution through executeAssignedAgentTask — the two canonical
 * authorities. Global emergency stop + owner lockdown + budget (owner/project/mission)
 * all fail closed ahead of scheduling and execution.
 */
export async function runWorkforce(opts: WorkforceOrchestratorOptions): Promise<WorkforceOrchestratorResult> {
  const {
    store,
    execution,
    ownerId,
    actorId,
    projectId = null,
    costProtector = new CostProtector(store, DEFAULT_COST_PROTECTION),
    signal,
    correlationId = null,
    verification,
  } = opts;

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const fail = (outcome: WorkforceOrchestratorOutcome, error: string | null, counters: Partial<Omit<WorkforceOrchestratorResult, 'tasks'>> = {}) => {
    return {
      outcome,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      discovered: counters.discovered ?? 0,
      placed: counters.placed ?? 0,
      executed: counters.executed ?? 0,
      completed: counters.completed ?? 0,
      failed: counters.failed ?? 0,
      blocked: counters.blocked ?? 0,
      approvalRequired: counters.approvalRequired ?? 0,
      noEligibleAgent: counters.noEligibleAgent ?? 0,
      capacityBlocked: counters.capacityBlocked ?? 0,
      conflicts: counters.conflicts ?? 0,
      skipped: counters.skipped ?? 0,
      tasks: [],
      error,
    };
  };

  // 1. Initiator authorization — owner OR the narrow system workforce service.
  if (typeof ownerId !== 'string' || ownerId.trim().length === 0) {
    throw new Error('invalid ownerId: must be a non-empty string');
  }
  if (typeof actorId !== 'string' || actorId.trim().length === 0) {
    throw new Error('invalid actorId: must be a non-empty string');
  }

  const workforceService = opts.workforceService === true;
  if (workforceService) {
    // Narrow system workforce-service initiator. Its own identity is the reserved
    // workforce service actor only — never a reusable owner-equivalent authority.
    if (actorId !== WORKFORCE_SERVICE_ACTOR) {
      throw new Error('workforce orchestration denied: invalid workforce service identity');
    }
  } else if (actorId !== ownerId) {
    throw new Error('workforce orchestration denied: only the owner may trigger orchestration');
  }

  // 2. Sandbox bounds — caller values are hard-capped to safe server-side maxima.
  const maxTasksPerRun = cap(opts.maxTasksPerRun, DEFAULT_MAX_TASKS_PER_RUN, HARD_MAX_TASKS_PER_RUN);
  const maxParallelExecutions = cap(opts.maxParallelExecutions, DEFAULT_MAX_PARALLEL_EXECUTIONS, HARD_MAX_PARALLEL_EXECUTIONS);
  const runTimeoutMs = cap(opts.runTimeoutMs, DEFAULT_RUN_TIMEOUT_MS, HARD_RUN_TIMEOUT_MS);
  const discoveryBatchSize = cap(opts.discoveryBatchSize, DEFAULT_DISCOVERY_BATCH_SIZE, HARD_DISCOVERY_BATCH_SIZE);

  const taskResults: WorkforceTaskResult[] = [];
  const counters = { discovered: 0, placed: 0, executed: 0, completed: 0, failed: 0, blocked: 0, approvalRequired: 0, noEligibleAgent: 0, capacityBlocked: 0, conflicts: 0, skipped: 0 };

  // Audit attribution: the orchestrator's OWN identity is the SYSTEM workforce service
  // (with the target owner recorded) when initiated by the service; otherwise the owner.
  // audit_events.actor_id is a uuid column, so the workforce-service write carries the
  // stable system UUID; the canonical 'workforce-service' name is recorded in metadata.
  const auditActor: { actorType: AuditEvent['actorType']; actorId: string } = workforceService
    ? { actorType: WORKFORCE_SERVICE_ACTOR_TYPE, actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID }
    : { actorType: 'owner', actorId: ownerId };
  type AuditEventInput = Parameters<Store['recordAudit']>[0];
  const emitAudit: (event: AuditEventInput) => Promise<void> = (event) =>
    safeAudit(store, {
      ...event,
      ...auditActor,
      metadata: workforceService
        ? {
            ...event.metadata,
            schedulingOwnerId: ownerId,
            workerId: opts.workerId ?? null,
            workforceService: WORKFORCE_SERVICE_ACTOR,
          }
        : event.metadata,
    });

  // 2a. Global emergency stop — FAIL CLOSED (missing row or read error => STOPPED).
  let globalControl;
  try {
    globalControl = await store.getWorkforceControl();
  } catch (e) {
    await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.run.blocked', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { outcome: 'global_stopped', reason: 'global_control_read_failed', error: String(e) } });
    return fail('error', `global workforce control read failed: ${String(e)}`);
  }
  if (isGlobalStopActive(globalControl)) {
    await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.run.started', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { outcome: 'global_stopped', reason: 'global_emergency_stop' } });
    return fail('global_stopped', 'global workforce stopped: no new work scheduled');
  }

  // 3. Emergency owner lockdown — abort before scheduling (owner-specific).
  let lockdown: { lockdownId?: string } | null = null;
  try {
    lockdown = await store.activeLockdown(ownerId);
  } catch (e) {
    return fail('error', `lockdown check failed: ${String(e)}`);
  }
  if (lockdown) {
    await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.run.started', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { outcome: 'aborted', reason: 'lockdown_active' } });
    return fail('aborted', 'aborted: active security lockdown');
  }

  // 3b. Cost protection (owner/project hard limits) — stop scheduling if a limit is reached.
  let costDecision;
  try {
    costDecision = await costProtector.check(ownerId, projectId ?? null);
  } catch (e) {
    return fail('error', `cost protection check failed: ${String(e)}`);
  }
  if (costDecision.stopped) {
    await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.run.started', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { outcome: 'budget_exhausted', reason: costDecision.reason } });
    return fail('budget_exhausted', costDecision.reason ?? 'budget_exhausted');
  }

  await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.run.started', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { maxTasksPerRun, maxParallelExecutions, runTimeoutMs, discoveryBatchSize } });

  // 4. Discovery — read-only, owner/project scoped, deterministic order.
  let discovered: TaskRecord[];
  try {
    discovered = await store.listSchedulableTasks(ownerId, { projectId: projectId ?? undefined, limit: discoveryBatchSize });
  } catch (e) {
    return fail('error', `discovery failed: ${String(e)}`, { discovered: counters.discovered });
  }
  counters.discovered = discovered.length;

  // Mission budget cache (avoid re-reading the same mission for many of its tasks).
  const missionCache = new Map<string, MissionRecord | null>();

  // 4b. Global emergency stop re-check (bounds reaction latency before new work).
  try {
    const recheck = await store.getWorkforceControl();
    if (isGlobalStopActive(recheck)) {
      await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.run.completed', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { outcome: 'global_stopped', reason: 'global_emergency_stop_mid_cycle', discovered: counters.discovered } });
      return { ...fail('global_stopped', 'global workforce stopped mid-cycle'), discovered: counters.discovered, tasks: taskResults };
    }
  } catch (e) {
    await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.run.completed', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { outcome: 'global_stopped', reason: 'global_control_read_failed', error: String(e) } });
    return { ...fail('error', `global workforce control read failed: ${String(e)}`), discovered: counters.discovered, tasks: taskResults };
  }

  if (discovered.length === 0 || isAborted(signal)) {
    const outcome: WorkforceOrchestratorOutcome = isAborted(signal) ? 'aborted' : 'nothing_to_do';
    await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.run.completed', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { outcome, discovered: counters.discovered } });
    return { ...fail(outcome, null), discovered: counters.discovered, tasks: taskResults };
  }

  // 5. Sequential placement (capacity correctness) up to maxTasksPerRun.
  //    Mission-backed tasks whose mission budget is exhausted are SKIPPED (not executed).
  const placedTasks: { taskId: string; agentId: string }[] = [];
  for (const task of discovered) {
    if (placedTasks.length >= maxTasksPerRun) break;
    if (isAborted(signal)) break;
    if (Date.now() - startedMs >= runTimeoutMs) break;

    // 5a. Mission budget enforcement — a mission-backed task is never executed once the
    //     mission's spend has reached MissionRecord.budgetLimit.
    if (task.missionId) {
      let blockedByMission = false;
      try {
        let mission = missionCache.get(task.missionId);
        if (mission === undefined) {
          mission = await store.getMission(ownerId, task.missionId);
          missionCache.set(task.missionId, mission);
        }
        if (mission && typeof mission.budgetLimit === 'number' && mission.budgetLimit > 0) {
          const spend = await store.missionCost(ownerId, task.missionId);
          if (spend >= mission.budgetLimit) {
            blockedByMission = true;
          }
        }
      } catch (e) {
        // Indeterminate mission-budget state. Fail closed for THIS task (skip, do not
        // execute) rather than risk unguarded spend. Deterministic; no model call.
        blockedByMission = true;
        await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'mission_budget_unreadable', error: String(e) } });
      }
      if (blockedByMission) {
        counters.skipped += 1;
        counters.blocked += 1;
        taskResults.push({ taskId: task.id, placement: 'not_attempted', execution: null, agentId: null, blocked: true });
        await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'mission_budget_exhausted', missionId: task.missionId } });
        continue;
      }
    }

    let placement: PlacementResult;
    try {
      placement = await placeTask({ store, ownerId, taskId: task.id, actorId: ownerId });
    } catch (e) {
      taskResults.push({ taskId: task.id, placement: 'assignment_conflict_exhausted', execution: null, agentId: null, blocked: true });
      counters.blocked += 1;
      counters.conflicts += 1;
      await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'placement_threw', error: String(e) } });
      continue;
    }

    const record: WorkforceTaskResult = { taskId: task.id, placement: placement.outcome, execution: null, agentId: placement.selectedAgentId, blocked: false };

    if (placement.outcome === 'placed') {
      placedTasks.push({ taskId: task.id, agentId: placement.selectedAgentId! });
      counters.placed += 1;
      await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.placed', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { agentId: placement.selectedAgentId } });
    } else if (placement.outcome === 'already_assigned') {
      counters.conflicts += 1;
      record.blocked = true;
      await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'already_assigned' } });
    } else if (await classifyCapacityBlocked(store, ownerId, placement)) {
      counters.capacityBlocked += 1;
      counters.blocked += 1;
      record.blocked = true;
      await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'capacity_blocked' } });
    } else if (placementNoEligible(placement)) {
      counters.noEligibleAgent += 1;
      counters.blocked += 1;
      record.blocked = true;
      await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'no_eligible_agent' } });
    } else if (placement.outcome === 'task_not_found') {
      counters.conflicts += 1;
      record.blocked = true;
      await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'task_not_found' } });
    } else {
      // assignment_conflict_exhausted fallback
      counters.conflicts += 1;
      counters.blocked += 1;
      record.blocked = true;
      await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'placement_conflict' } });
    }
    taskResults.push(record);
  }

  // 6. Bounded parallel execution through Gate 34 (claim-safe). Never Promise.all over an
  //    unbounded set — only slices of size <= maxParallelExecutions are awaited together.
  for (let i = 0; i < placedTasks.length; i += maxParallelExecutions) {
    if (isAborted(signal)) break;
    if (Date.now() - startedMs >= runTimeoutMs) break;
    const slice = placedTasks.slice(i, i + maxParallelExecutions);

    const results = await Promise.all(
      slice.map((p) =>
        executeAssignedAgentTask({ store, execution, ownerId, agentId: p.agentId, taskId: p.taskId, verification })
          .then((r) => ({ kind: 'ok' as const, r, taskId: p.taskId, agentId: p.agentId }))
          .catch((e) => ({ kind: 'err' as const, taskId: p.taskId, agentId: p.agentId, error: String(e) })),
      ),
    );

    for (const item of results) {
      if (item.kind === 'err') {
        counters.executed += 1;
        counters.failed += 1;
        const rec = taskResults.find((t) => t.taskId === item.taskId);
        if (rec) { rec.execution = 'failed'; rec.blocked = true; }
        await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.failed', projectId, environmentId: null, resourceType: 'task', resourceId: item.taskId, authorizationResult: null, correlationId, taskId: item.taskId, metadata: { error: item.error } });
        continue;
      }
      const outcome = item.r.outcome;
      counters.executed += 1;
      const rec = taskResults.find((t) => t.taskId === item.taskId);
      if (rec) rec.execution = outcome;

      if (outcome === 'completed') {
        counters.completed += 1;
        await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.completed', projectId, environmentId: null, resourceType: 'task', resourceId: item.taskId, authorizationResult: null, correlationId, taskId: item.taskId, metadata: { agentId: item.agentId } });
      } else if (outcome === 'approval_required') {
        counters.approvalRequired += 1;
        counters.blocked += 1;
        if (rec) rec.blocked = true;
        await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: item.taskId, authorizationResult: null, correlationId, taskId: item.taskId, metadata: { reason: 'approval_required' } });
      } else if (outcome === 'already_running') {
        counters.conflicts += 1;
        if (rec) rec.blocked = true;
      } else if (outcome === 'agent_inactive' || outcome === 'agent_not_found' || outcome === 'assignment_mismatch') {
        counters.blocked += 1;
        if (rec) rec.blocked = true;
        await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: item.taskId, authorizationResult: null, correlationId, taskId: item.taskId, metadata: { reason: outcome } });
      } else {
        counters.failed += 1;
        if (rec) rec.blocked = true;
        await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.task.failed', projectId, environmentId: null, resourceType: 'task', resourceId: item.taskId, authorizationResult: null, correlationId, taskId: item.taskId, metadata: { reason: outcome, error: item.r.error } });
      }
    }
  }

  // 7. Deterministic outcome — never an LLM decision.
  const aborted = isAborted(signal) || Date.now() - startedMs >= runTimeoutMs;
  let outcome: WorkforceOrchestratorOutcome;
  if (aborted && (counters.completed === 0 && counters.placed === 0)) {
    outcome = 'aborted';
  } else if (aborted) {
    outcome = counters.completed > 0 ? 'partial' : 'blocked';
  } else if (counters.placed === 0) {
    // Nothing placed: distinguish a pure mission-budget skip from other blocks.
    outcome = counters.skipped > 0 && counters.completed === 0 ? 'mission_budget_exhausted' : 'blocked';
  } else if (counters.completed === counters.placed) {
    outcome = 'completed';
  } else if (counters.completed > 0) {
    outcome = 'partial';
  } else {
    outcome = 'blocked';
  }

  await emitAudit({ actorType: 'system', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, action: 'workforce.run.completed', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { outcome, ...counters } });

  return {
    outcome,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    discovered: counters.discovered,
    placed: counters.placed,
    executed: counters.executed,
    completed: counters.completed,
    failed: counters.failed,
    blocked: counters.blocked,
    approvalRequired: counters.approvalRequired,
    noEligibleAgent: counters.noEligibleAgent,
    capacityBlocked: counters.capacityBlocked,
    conflicts: counters.conflicts,
    skipped: counters.skipped,
    tasks: taskResults,
    error: null,
  };
}

async function safeAudit(store: Store, event: Parameters<Store['recordAudit']>[0]): Promise<void> {
  try {
    await store.recordAudit(event);
  } catch (e) {
    console.warn(`[Gate 37] audit persistence failed for ${event.action}: ${e}`);
  }
}
