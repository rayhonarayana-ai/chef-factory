// CHEF FACTORY — Gate 30 — Workforce Placement Primitive.
// Composes selection (Gate 29) + atomic placement (Gate 30 store primitive).
// PLACEMENT_HAS_SIDE_EFFECTS = YES (assigns task.agent_id via atomic primitive)
// PLACEMENT_STARTS_EXECUTION = NO
// PLACEMENT_LLM_CALLS = 0

import type { Store } from './ports.js';
import type { RejectedCandidate } from './selector.js';
import { selectCandidate } from './selector.js';

// ---------- Placement types ----------

export type PlacementOutcome =
  | 'placed'
  | 'already_assigned'
  | 'task_not_found'
  | 'no_agents_found'
  | 'no_eligible_agent'
  | 'assignment_conflict_exhausted';

export interface PlacementResult {
  ok: boolean;
  outcome: PlacementOutcome;
  taskId: string;
  selectedAgentId: string | null;
  attempts: number;
  rejected: RejectedCandidate[];
}

export interface PlacementInput {
  store: Store;
  ownerId: string;
  taskId: string;
  actorId: string;
}

const MAX_SELECTION_ATTEMPTS = 2;

// ---------- Core placement primitive ----------

/**
 * Gate 30: Place an existing Task onto an Agent.
 *
 * 1. Validates inputs
 * 2. Loads the task — if already assigned, returns already_assigned
 * 3. Runs selectCandidate (Gate 29) — read-only selection
 * 4. Runs assignTaskIfUnassigned (Gate 30) — atomic placement
 * 5. On agent race failures, retries once with the failed agent excluded
 *
 * PLACEMENT_STARTS_EXECUTION = NO
 * PLACEMENT_LLM_CALLS = 0
 */
export async function placeTask(input: PlacementInput): Promise<PlacementResult> {
  const { store, ownerId, taskId, actorId } = input;

  if (typeof actorId !== 'string' || actorId.trim().length === 0) {
    throw new Error('invalid actorId: must be a non-empty string');
  }
  if (typeof ownerId !== 'string' || ownerId.trim().length === 0) {
    throw new Error('invalid ownerId: must be a non-empty string');
  }
  if (typeof taskId !== 'string' || taskId.trim().length === 0) {
    throw new Error('invalid taskId: must be a non-empty string');
  }
  if (actorId !== ownerId) {
    throw new Error('placement denied: only the owner may place tasks');
  }

  const task = await store.getTask(ownerId, taskId);
  if (!task) {
    return {
      ok: false,
      outcome: 'task_not_found',
      taskId,
      selectedAgentId: null,
      attempts: 0,
      rejected: [],
    };
  }

  if (task.agentId !== null) {
    return {
      ok: false,
      outcome: 'already_assigned',
      taskId,
      selectedAgentId: null,
      attempts: 0,
      rejected: [],
    };
  }

  const allRejected: RejectedCandidate[] = [];
  let excludeAgentIds: string[] = [];
  let lastSelectedAgentId: string | null = null;

  for (let attempt = 0; attempt < MAX_SELECTION_ATTEMPTS; attempt++) {
    const selection = await selectCandidate({
      store,
      ownerId,
      task,
      excludeAgentIds,
    });

    if (!selection.ok || selection.outcome !== 'selected') {
      return {
        ok: false,
        outcome: selection.outcome === 'no_agents_found' ? 'no_agents_found' : 'no_eligible_agent',
        taskId,
        selectedAgentId: null,
        attempts: attempt + 1,
        rejected: allRejected,
      };
    }

    lastSelectedAgentId = selection.selected!.agentId;
    if (selection.rejected) {
      allRejected.push(...selection.rejected);
    }

    const assignResult = await store.assignTaskIfUnassigned(ownerId, taskId, selection.selected!.agentId);

    if (assignResult.ok && assignResult.outcome === 'assigned') {
      return {
        ok: true,
        outcome: 'placed',
        taskId,
        selectedAgentId: selection.selected!.agentId,
        attempts: attempt + 1,
        rejected: allRejected,
      };
    }

    if (assignResult.outcome === 'already_assigned') {
      return {
        ok: false,
        outcome: 'already_assigned',
        taskId,
        selectedAgentId: null,
        attempts: attempt + 1,
        rejected: allRejected,
      };
    }

    if (assignResult.outcome === 'agent_not_found' || assignResult.outcome === 'agent_not_eligible') {
      excludeAgentIds = [...excludeAgentIds, selection.selected!.agentId];
      continue;
    }

    return {
      ok: false,
      outcome: assignResult.outcome === 'task_not_found' ? 'task_not_found' : 'assignment_conflict_exhausted',
      taskId,
      selectedAgentId: null,
      attempts: attempt + 1,
      rejected: allRejected,
    };
  }

  return {
    ok: false,
    outcome: 'assignment_conflict_exhausted',
    taskId,
    selectedAgentId: null,
    attempts: MAX_SELECTION_ATTEMPTS,
    rejected: allRejected,
  };
}
