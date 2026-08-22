// CHEF FACTORY — Gate 29+31 — Agent selection primitive.
// Pure, side-effect-free, read-only selection of suitable agents.
// SELECTION_HAS_SIDE_EFFECTS = NO

import type { Store } from './ports.js';
import type { AgentRecord, TaskRecord } from './types.js';
import { normalizeCapabilities, satisfiesAll } from './capabilities.js';

// ---------- Selection types ----------

export type SelectionOutcome =
  | 'selected'
  | 'no_agents_found'
  | 'no_eligible_agent';

export interface SelectedCandidate {
  agentId: string;
  roleMatched: boolean;
  matchedCapabilities: string[];
}

export interface RejectedCandidate {
  agentId: string;
  reason: 'inactive' | 'missing_capability' | 'at_capacity' | 'capacity_zero';
}

export interface SelectionResult {
  ok: boolean;
  outcome: SelectionOutcome;
  selected?: SelectedCandidate;
  rejected?: RejectedCandidate[];
}

export interface SelectionInput {
  store: Store;
  ownerId: string;
  task: TaskRecord;
  excludeAgentIds?: string[];
}

// ---------- Core selector ----------

/**
 * Select the best candidate agent for a task.
 * Reads agents from the store, filters by lifecycle + capability + availability eligibility,
 * deterministically ranks eligible candidates, and returns structured evidence.
 *
 * Zero writes. Zero side effects. Assignment is the caller's responsibility.
 */
export async function selectCandidate(input: SelectionInput): Promise<SelectionResult> {
  const { store, ownerId, task } = input;
  const excludeSet = new Set(input.excludeAgentIds ?? []);

  // 1. Discover owner agents (O(1) DB round trip)
  const agents = (await store.listAgents(ownerId)).filter((a) => !excludeSet.has(a.id));

  // 2. Zero agents → no_agents_found
  if (agents.length === 0) {
    return { ok: false, outcome: 'no_agents_found', rejected: [] };
  }

  // 3. Gate 31: Batch workload query (single round trip, no N+1)
  const workloadRows = await store.listAgentWorkload(ownerId);
  const workloadMap = new Map<string, { assignedCount: number; runningCount: number }>();
  for (const w of workloadRows) {
    workloadMap.set(w.agentId, { assignedCount: w.assignedCount, runningCount: w.runningCount });
  }

  // 4. Normalize task requirements
  const requiredCaps = normalizeCapabilities(task.requiredCapabilities ?? []);
  const preferredRole = task.preferredRole ?? null;

  // 5. Filter and partition agents
  const eligible: (AgentRecord & { workload: number; utilization: number })[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const agent of agents) {
    // Lifecycle: only active agents are eligible
    if (agent.status !== 'active') {
      rejected.push({ agentId: agent.id, reason: 'inactive' });
      continue;
    }

    // Gate 31: capacity_zero = cannot accept new work
    if (agent.maxConcurrentTasks <= 0) {
      rejected.push({ agentId: agent.id, reason: 'capacity_zero' });
      continue;
    }

    // Capability: normalize agent capabilities, check all required present
    const agentCaps = normalizeCapabilities(agent.capabilities ?? []);
    if (!satisfiesAll(agentCaps, requiredCaps)) {
      rejected.push({ agentId: agent.id, reason: 'missing_capability' });
      continue;
    }

    // Gate 31: availability — current workload vs capacity
    const wl = workloadMap.get(agent.id) ?? { assignedCount: 0, runningCount: 0 };
    if (wl.assignedCount >= agent.maxConcurrentTasks) {
      rejected.push({ agentId: agent.id, reason: 'at_capacity' });
      continue;
    }

    const utilization = wl.assignedCount / agent.maxConcurrentTasks;
    eligible.push({ ...agent, workload: wl.assignedCount, utilization });
  }

  // 6. No eligible agents after filtering
  if (eligible.length === 0) {
    return { ok: false, outcome: 'no_eligible_agent', rejected };
  }

  // 7. Deterministic ranking
  //    Priority: LOWER utilization → preferredRole match → createdAt ASC → id ASC
  eligible.sort((a, b) => {
    // Gate 31: lower utilization first
    if (a.utilization !== b.utilization) return a.utilization - b.utilization;

    // Role preference: exact canonical match first
    if (preferredRole !== null) {
      const aRoleMatch = a.role === preferredRole ? 0 : 1;
      const bRoleMatch = b.role === preferredRole ? 0 : 1;
      if (aRoleMatch !== bRoleMatch) return aRoleMatch - bRoleMatch;
    }

    // Stable tie-break: createdAt ASC (oldest first)
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? -1 : 1;
    }

    // Final tie-break: id ASC (lexicographic, deterministic)
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // 8. Select top candidate
  const winner = eligible[0]!;
  const matchedCaps = normalizeCapabilities(winner.capabilities ?? []);

  return {
    ok: true,
    outcome: 'selected',
    selected: {
      agentId: winner.id,
      roleMatched: preferredRole !== null && winner.role === preferredRole,
      matchedCapabilities: matchedCaps,
    },
    rejected,
  };
}
