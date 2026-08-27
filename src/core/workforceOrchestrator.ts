// CHEF FACTORY — Gate 37 — Deterministic Workforce Orchestrator.
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

import type { Store } from './ports.js';
import type { TaskRecord } from './types.js';
import type { ExecutionRunner } from './pipeline.js';
import type { PlacementOutcome, PlacementResult } from './placement.js';
import { placeTask } from './placement.js';
import type { AgentExecutionResultOutcome } from './agentExecutor.js';
import { executeAssignedAgentTask } from './agentExecutor.js';
import { CostProtector, DEFAULT_COST_PROTECTION } from './security/costProtection.js';

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
  | 'budget_exhausted'
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
  tasks: WorkforceTaskResult[];
  error: string | null;
}

export interface WorkforceOrchestratorOptions {
  store: Store;
  execution: ExecutionRunner;
  ownerId: string;
  actorId: string;
  projectId?: string | null;
  maxTasksPerRun?: number;
  maxParallelExecutions?: number;
  runTimeoutMs?: number;
  discoveryBatchSize?: number;
  costProtector?: CostProtector;
  signal?: AbortSignal;
  correlationId?: string;
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

// Determine whether a placement outcome is a capacity rejection using the
// per-candidate rejection reasons returned by the canonical selector.
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

// Lightweight capacity label for an otherwise-blocked placement. This does NOT
// reproduce selection logic — it only classifies an already-denied placement by
// inspecting whether every active owner agent is currently at capacity.
// Pure read-only label: never assigns, never ranks.
async function classifyCapacityBlocked(store: Store, ownerId: string, result: PlacementResult): Promise<boolean> {
  if (placementCapacityBlocked(result)) return true;
  if (result.outcome !== 'no_eligible_agent' && result.outcome !== 'no_agents_found') return false;
  try {
    const agents = (await store.listAgents(ownerId)).filter((a) => a.status === 'active');
    if (agents.length === 0) return false; // no active agents at all → no-eligible, not capacity
    const workload = new Map((await store.listAgentWorkload(ownerId)).map((w) => [w.agentId, w.assignedCount]));
    return agents.every((a) => (a.maxConcurrentTasks <= 0) || (workload.get(a.id) ?? 0) >= a.maxConcurrentTasks);
  } catch {
    return placementCapacityBlocked(result);
  }
}

// ---------- Orchestrator ----------

/**
 * Gate 37: Run one bounded workforce orchestration pass for an owner.
 *
 * Owner-invoked (actorId === ownerId). Deterministic. No LLM calls from the
 * orchestrator itself. Every placement goes through placeTask and every
 * execution through executeAssignedAgentTask — the two canonical authorities.
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
      tasks: [],
      error,
    };
  };

  // 1. Ownership gate — orchestrator is owner-triggered, never an agent pretending to be owner.
  if (typeof ownerId !== 'string' || ownerId.trim().length === 0) {
    throw new Error('invalid ownerId: must be a non-empty string');
  }
  if (typeof actorId !== 'string' || actorId.trim().length === 0) {
    throw new Error('invalid actorId: must be a non-empty string');
  }
  if (actorId !== ownerId) {
    throw new Error('workforce orchestration denied: only the owner may trigger orchestration');
  }

  // 2. Sandbox bounds — caller values are hard-capped to safe server-side maxima.
  const maxTasksPerRun = cap(opts.maxTasksPerRun, DEFAULT_MAX_TASKS_PER_RUN, HARD_MAX_TASKS_PER_RUN);
  const maxParallelExecutions = cap(opts.maxParallelExecutions, DEFAULT_MAX_PARALLEL_EXECUTIONS, HARD_MAX_PARALLEL_EXECUTIONS);
  const runTimeoutMs = cap(opts.runTimeoutMs, DEFAULT_RUN_TIMEOUT_MS, HARD_RUN_TIMEOUT_MS);
  const discoveryBatchSize = cap(opts.discoveryBatchSize, DEFAULT_DISCOVERY_BATCH_SIZE, HARD_DISCOVERY_BATCH_SIZE);

  const taskResults: WorkforceTaskResult[] = [];
  const counters = { discovered: 0, placed: 0, executed: 0, completed: 0, failed: 0, blocked: 0, approvalRequired: 0, noEligibleAgent: 0, capacityBlocked: 0, conflicts: 0 };

  // 3. Emergency lockdown — abort before scheduling.
  let lockdown: { lockdownId?: string } | null = null;
  try {
    lockdown = await store.activeLockdown(ownerId);
  } catch (e) {
    return fail('error', `lockdown check failed: ${String(e)}`);
  }
  if (lockdown) {
    await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.run.started', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { outcome: 'aborted', reason: 'lockdown_active' } });
    return fail('aborted', 'aborted: active security lockdown');
  }

  // 3b. Cost protection — stop scheduling if a hard limit is reached.
  let costDecision;
  try {
    costDecision = await costProtector.check(ownerId, projectId ?? null);
  } catch (e) {
    return fail('error', `cost protection check failed: ${String(e)}`);
  }
  if (costDecision.stopped) {
    await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.run.started', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { outcome: 'budget_exhausted', reason: costDecision.reason } });
    return fail('budget_exhausted', costDecision.reason ?? 'budget_exhausted');
  }

  await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.run.started', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { maxTasksPerRun, maxParallelExecutions, runTimeoutMs, discoveryBatchSize } });

  // 4. Discovery — read-only, owner/project scoped, deterministic order.
  let discovered: TaskRecord[];
  try {
    discovered = await store.listSchedulableTasks(ownerId, { projectId: projectId ?? undefined, limit: discoveryBatchSize });
  } catch (e) {
    return fail('error', `discovery failed: ${String(e)}`, { discovered: counters.discovered });
  }
  counters.discovered = discovered.length;

  if (discovered.length === 0 || isAborted(signal)) {
    const outcome: WorkforceOrchestratorOutcome = isAborted(signal) ? 'aborted' : 'nothing_to_do';
    await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.run.completed', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { outcome, discovered: counters.discovered } });
    return { ...fail(outcome, null), discovered: counters.discovered, tasks: taskResults };
  }

  // 5. Sequential placement (capacity correctness) up to maxTasksPerRun.
  const placedTasks: { taskId: string; agentId: string }[] = [];
  for (const task of discovered) {
    if (placedTasks.length >= maxTasksPerRun) break;
    if (isAborted(signal)) break;
    if (Date.now() - startedMs >= runTimeoutMs) break;

    let placement: PlacementResult;
    try {
      placement = await placeTask({ store, ownerId, taskId: task.id, actorId: ownerId });
    } catch (e) {
      taskResults.push({ taskId: task.id, placement: 'assignment_conflict_exhausted', execution: null, agentId: null, blocked: true });
      counters.blocked += 1;
      counters.conflicts += 1;
      await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'placement_threw', error: String(e) } });
      continue;
    }

    const record: WorkforceTaskResult = { taskId: task.id, placement: placement.outcome, execution: null, agentId: placement.selectedAgentId, blocked: false };

    if (placement.outcome === 'placed') {
      placedTasks.push({ taskId: task.id, agentId: placement.selectedAgentId! });
      counters.placed += 1;
      await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.task.placed', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { agentId: placement.selectedAgentId } });
    } else if (placement.outcome === 'already_assigned') {
      counters.conflicts += 1;
      record.blocked = true;
      await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'already_assigned' } });
    } else if (await classifyCapacityBlocked(store, ownerId, placement)) {
      counters.capacityBlocked += 1;
      counters.blocked += 1;
      record.blocked = true;
      await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'capacity_blocked' } });
    } else if (placementNoEligible(placement)) {
      counters.noEligibleAgent += 1;
      counters.blocked += 1;
      record.blocked = true;
      await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'no_eligible_agent' } });
    } else if (placement.outcome === 'task_not_found') {
      counters.conflicts += 1;
      record.blocked = true;
      await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'task_not_found' } });
    } else {
      // assignment_conflict_exhausted fallback
      counters.conflicts += 1;
      counters.blocked += 1;
      record.blocked = true;
      await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: task.id, authorizationResult: null, correlationId, taskId: task.id, metadata: { reason: 'placement_conflict' } });
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
        executeAssignedAgentTask({ store, execution, ownerId, agentId: p.agentId, taskId: p.taskId })
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
        await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.task.failed', projectId, environmentId: null, resourceType: 'task', resourceId: item.taskId, authorizationResult: null, correlationId, taskId: item.taskId, metadata: { error: item.error } });
        continue;
      }
      const outcome = item.r.outcome;
      counters.executed += 1;
      const rec = taskResults.find((t) => t.taskId === item.taskId);
      if (rec) rec.execution = outcome;

      if (outcome === 'completed') {
        counters.completed += 1;
        await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.task.completed', projectId, environmentId: null, resourceType: 'task', resourceId: item.taskId, authorizationResult: null, correlationId, taskId: item.taskId, metadata: { agentId: item.agentId } });
      } else if (outcome === 'approval_required') {
        counters.approvalRequired += 1;
        counters.blocked += 1;
        if (rec) rec.blocked = true;
        await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: item.taskId, authorizationResult: null, correlationId, taskId: item.taskId, metadata: { reason: 'approval_required' } });
      } else if (outcome === 'already_running') {
        counters.conflicts += 1;
        if (rec) rec.blocked = true;
      } else if (outcome === 'agent_inactive' || outcome === 'agent_not_found' || outcome === 'assignment_mismatch') {
        counters.blocked += 1;
        if (rec) rec.blocked = true;
        await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.task.blocked', projectId, environmentId: null, resourceType: 'task', resourceId: item.taskId, authorizationResult: null, correlationId, taskId: item.taskId, metadata: { reason: outcome } });
      } else {
        counters.failed += 1;
        if (rec) rec.blocked = true;
        await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.task.failed', projectId, environmentId: null, resourceType: 'task', resourceId: item.taskId, authorizationResult: null, correlationId, taskId: item.taskId, metadata: { reason: outcome, error: item.r.error } });
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
    outcome = 'blocked';
  } else if (counters.completed === counters.placed) {
    outcome = 'completed';
  } else if (counters.completed > 0) {
    outcome = 'partial';
  } else {
    outcome = 'blocked';
  }

  await safeAudit(store, { actorType: 'owner', actorId: ownerId, action: 'workforce.run.completed', projectId, environmentId: null, resourceType: null, resourceId: null, authorizationResult: null, correlationId, taskId: null, metadata: { outcome, ...counters } });

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
