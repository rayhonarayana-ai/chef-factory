// CHEF FACTORY — Gate 26/28 — Agent Assignment & Delegation Contract.
// Typed, validated, auditable contract for assigning Tasks to Agents.
//
// Core invariants:
//   ASSIGNMENT_GRANTS_PERMISSION = NO
//   Only owners may assign (agents cannot delegate)
//   Agent eligibility validated atomically at DB level (Gate 28)
//   Assignment never widens authority
//
// Gate 28: Canonical persistence path is store.assignTask().
// The old read-validate-write path is removed.

import type { Store, AssignTaskResult } from './ports.js';
import type { TaskRecord } from './types.js';

export interface AssignmentResult {
  ok: boolean;
  task?: TaskRecord;
  previousAgentId: string | null;
  nextAgentId: string | null;
  outcome: AssignTaskResult['outcome'];
  reason?: string;
}

/**
 * Validates that an actor may assign work. Gate 26: owner-only.
 * Agents cannot delegate — this is enforced at the domain level.
 */
function validateAssignor(actorId: string, ownerId: string): void {
  if (actorId !== ownerId) {
    throw new Error('assignment denied: only the owner may assign tasks');
  }
}

/**
 * Validates assignment inputs (runtime guard against untrusted data).
 */
function validateInputs(taskId: string, agentId: string | null): void {
  if (typeof taskId !== 'string' || taskId.trim().length === 0) {
    throw new Error('invalid taskId: must be a non-empty string');
  }
  if (agentId !== null && (typeof agentId !== 'string' || agentId.trim().length === 0)) {
    throw new Error('invalid agentId: must be a non-empty string or null');
  }
}

/**
 * Gate 26/28: Assign, reassign, or unassign a Task to/from an Agent.
 *
 * Canonical persistence path: store.assignTask() — atomic at DB level.
 *
 * - assign:   setTaskAssignment(store, ownerId, taskId, agentId, actorId)
 * - reassign: setTaskAssignment(store, ownerId, taskId, newAgentId, actorId)
 * - unassign: setTaskAssignment(store, ownerId, taskId, null, actorId)
 *
 * Eligibility:
 *   1. Actor must be the owner (agents cannot delegate)
 *   2. Atomic DB operation validates task existence, agent existence,
 *      and agent eligibility (status=active) under lock
 *
 * Side effects:
 *   - Records audit event (task.assigned / task.unassigned / task.reassigned)
 *
 * Does NOT:
 *   - Grant permissions
 *   - Create new database entities
 *   - Modify authority/RBAC
 *   - Trigger task execution
 */
export async function setTaskAssignment(
  store: Store,
  ownerId: string,
  taskId: string,
  agentId: string | null,
  actorId: string,
): Promise<AssignmentResult> {
  // 1. Runtime input validation
  validateInputs(taskId, agentId);
  if (typeof ownerId !== 'string' || ownerId.trim().length === 0) {
    throw new Error('invalid ownerId: must be a non-empty string');
  }
  if (typeof actorId !== 'string' || actorId.trim().length === 0) {
    throw new Error('invalid actorId: must be a non-empty string');
  }

  // 2. Actor authorization — owner-only (agents cannot delegate)
  validateAssignor(actorId, ownerId);

  // 3. Atomic assignment via Store (Gate 28: TOCTOU-protected)
  const result = await store.assignTask(ownerId, taskId, agentId);

  if (!result.ok) {
    return {
      ok: false,
      previousAgentId: result.previousAgentId,
      nextAgentId: result.nextAgentId,
      outcome: result.outcome,
      reason: result.outcome === 'task_not_found'
        ? 'assignment rejected: task not found or belongs to another owner'
        : result.outcome === 'agent_not_found'
          ? 'assignment rejected: agent not found or belongs to another owner'
          : result.outcome === 'agent_not_eligible'
            ? 'assignment rejected: agent is not eligible for assignment'
            : 'assignment failed',
    };
  }

  // 4. No-change — no audit
  if (result.outcome === 'no_change') {
    return {
      ok: true,
      previousAgentId: result.previousAgentId,
      nextAgentId: result.nextAgentId,
      outcome: 'no_change',
      reason: 'no change — task already assigned to this agent',
    };
  }

  // 5. Read the updated task for the audit event
  const updatedTask = await store.getTask(ownerId, taskId);

  // 6. Audit — best-effort, failure-isolated (Gate 21 pattern)
  const action = result.previousAgentId === null
    ? 'task.assigned'
    : agentId === null
      ? 'task.unassigned'
      : 'task.reassigned';

  try {
    await store.recordAudit({
      actorType: 'owner',
      actorId,
      action,
      projectId: updatedTask?.projectId ?? null,
      environmentId: null,
      resourceType: 'task',
      resourceId: taskId,
      authorizationResult: null,
      correlationId: null,
      taskId,
      metadata: {
        previousAgentId: result.previousAgentId,
        nextAgentId: result.nextAgentId,
        taskTitle: updatedTask?.title ?? null,
      },
    });
  } catch {
    // Gate 21 pattern: audit failure is non-fatal
  }

  return {
    ok: true,
    task: updatedTask ?? undefined,
    previousAgentId: result.previousAgentId,
    nextAgentId: result.nextAgentId,
    outcome: result.outcome,
  };
}
