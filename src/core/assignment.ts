// CHEF FACTORY — Gate 26 — Agent Assignment & Delegation Contract Foundation.
// Typed, validated, auditable contract for assigning Tasks to Agents.
//
// Core invariants:
//   ASSIGNMENT_GRANTS_PERMISSION = NO
//   Only owners may assign (agents cannot delegate)
//   Agent must exist, belong to same owner, and be 'active'
//   Assignment never widens authority
//
// Uses existing TaskRecord.agentId as source of truth.
// No new database table. No migration.

import type { Store } from './ports.js';
import type { TaskRecord } from './types.js';

export interface AssignmentResult {
  ok: boolean;
  task: TaskRecord;
  previousAgentId: string | null;
  nextAgentId: string | null;
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
 * Validates agent eligibility for assignment:
 * - Agent must exist and belong to the same owner
 * - Agent status must be 'active'
 */
async function validateAgentEligibility(
  store: Store,
  ownerId: string,
  agentId: string,
): Promise<void> {
  const agent = await store.getAgent(ownerId, agentId);
  if (!agent) {
    throw new Error('assignment rejected: agent not found or belongs to another owner');
  }
  if (agent.status !== 'active') {
    throw new Error(`assignment rejected: agent status is "${agent.status}" — only "active" agents may receive work`);
  }
}

/**
 * Gate 26: Assign, reassign, or unassign a Task to/from an Agent.
 *
 * - assign:   setTaskAssignment(store, ownerId, taskId, agentId, actorId)
 * - reassign: setTaskAssignment(store, ownerId, taskId, newAgentId, actorId)
 * - unassign: setTaskAssignment(store, ownerId, taskId, null, actorId)
 *
 * Eligibility:
 *   1. Actor must be the owner (agents cannot delegate)
 *   2. Task must exist and belong to the owner
 *   3. If assigning: agent must exist, same owner, status=active
 *
 * Side effects:
 *   - Patches TaskRecord.agentId via existing store.patchTask
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

  // 3. Task existence and ownership
  const task = await store.getTask(ownerId, taskId);
  if (!task) {
    throw new Error('assignment rejected: task not found or belongs to another owner');
  }

  // 4. Agent eligibility (if assigning, not unassigning)
  if (agentId !== null) {
    await validateAgentEligibility(store, ownerId, agentId);
  }

  // 5. Skip if no change
  const previousAgentId = task.agentId;
  if (previousAgentId === agentId) {
    return {
      ok: true,
      task,
      previousAgentId,
      nextAgentId: agentId,
      reason: 'no change — task already assigned to this agent',
    };
  }

  // 6. Persist assignment via existing patchTask
  const updatedTask = await store.patchTask(ownerId, taskId, { agentId });

  // 7. Audit — failure-isolated (does not throw on audit persistence failure)
  const action = previousAgentId === null
    ? 'task.assigned'
    : agentId === null
      ? 'task.unassigned'
      : 'task.reassigned';

  try {
    await store.recordAudit({
      actorType: 'owner',
      actorId,
      action,
      projectId: task.projectId,
      environmentId: null,
      resourceType: 'task',
      resourceId: taskId,
      authorizationResult: null,
      correlationId: null,
      taskId,
      metadata: {
        previousAgentId,
        nextAgentId: agentId,
        taskTitle: task.title,
      },
    });
  } catch {
    // Gate 21 pattern: audit failure is non-fatal
  }

  return {
    ok: true,
    task: updatedTask,
    previousAgentId,
    nextAgentId: agentId,
  };
}
