// CHEF FACTORY — Gate 32B — Agent Execution Authority Boundary.
// Canonical single path for resolving agent identity, lifecycle, assignment,
// authority, autonomy, and permission for autonomous task execution.
//
// FLOW:
//   resolve actor identity (verify DB ownership)
//   → verify lifecycle (active only)
//   → verify assignment (task.agentId matches)
//   → resolve permission (agent_permissions)
//   → evaluate authority (authority.ts)
//   → evaluate autonomy (autonomy.ts)
//   → clamp autonomy (authority ceiling)
//
// INVARIANTS:
//   ASSIGNMENT_GRANTS_PERMISSION = NO
//   AGENT_EXISTENCE_GRANTS_PERMISSION = NO
//   AGENT_ROLE_GRANTS_PERMISSION = NO
//   CAPABILITY_MATCH_GRANTS_PERMISSION = NO
//   PLACEMENT_GRANTS_PERMISSION = NO
//   AGENT_SELF_ESCALATION = BLOCKED

import type { Store } from './ports.js';
import type {
  AgentRecord,
  AgentStatus,
  AuthorityDecision,
  AutonomyDecision,
  AutonomyLevel,
  EnvironmentName,
  RiskLevel,
} from './types.js';
import { evaluateAuthority, clampAutonomy } from './authority.js';
import { evaluateAutonomy } from './autonomy.js';

// ---------- Types ----------

export type AgentExecutionOutcome =
  | 'authorized'
  | 'agent_not_found'
  | 'agent_inactive'
  | 'owner_mismatch'
  | 'task_not_assigned'
  | 'assignment_mismatch'
  | 'permission_denied'
  | 'authority_denied'
  | 'approval_required';

export interface AgentExecutionIdentity {
  type: 'owner' | 'agent';
  id: string;
  ownerId: string;
}

export interface AgentExecutionResult {
  ok: boolean;
  outcome: AgentExecutionOutcome;
  identity: AgentExecutionIdentity;
  authority: AuthorityDecision;
  autonomy: AutonomyDecision;
  agent: AgentRecord | null;
  evidence: string[];
}

export interface ResolveToolAuthInput {
  store: Store;
  actorId: string;
  actorType: 'owner' | 'agent';
  ownerId: string;
  agentId?: string | null;
  projectId: string | null;
  environment: EnvironmentName;
  resourceType: string;
  permission: string;
  actionType: string;
  risk: RiskLevel;
  explicitDeny?: boolean;
}

// ---------- Lifecycle ----------

const ELIGIBLE_LIFECYCLE_STATUSES = new Set<AgentStatus>(['active']);

/** Gate 32B: Agent MUST be active for new autonomous execution. */
export function isAgentLifecycleEligible(status: AgentStatus): boolean {
  return ELIGIBLE_LIFECYCLE_STATUSES.has(status);
}

// ---------- Assignment ----------

/** Gate 32B: Verify task is assigned to this agent under this owner. */
export function verifyTaskAssignment(
  task: { ownerId: string; agentId: string | null; id: string },
  agentId: string,
  ownerId: string,
): { ok: boolean; outcome: AgentExecutionOutcome; evidence: string[] } {
  if (task.ownerId !== ownerId) {
    return {
      ok: false,
      outcome: 'owner_mismatch',
      evidence: [`task.ownerId=${task.ownerId} != ownerId=${ownerId}`],
    };
  }
  if (task.agentId === null) {
    return {
      ok: false,
      outcome: 'task_not_assigned',
      evidence: [`task ${task.id} is unassigned`],
    };
  }
  if (task.agentId !== agentId) {
    return {
      ok: false,
      outcome: 'assignment_mismatch',
      evidence: [`task.agentId=${task.agentId} != agentId=${agentId}`],
    };
  }
  return { ok: true, outcome: 'authorized', evidence: [`task ${task.id} assigned to agent ${agentId}`] };
}

// ---------- Identity + Authority Resolution ----------

/**
 * Gate 32B: Resolve whether an actor is authorized for a tool action.
 *
 * For owners: always authorized on own projects (existing behavior preserved).
 * For agents: verifies existence, ownership, lifecycle, and permission
 * via agent_permissions table. NEVER infers from role/capabilities.
 */
export async function resolveToolAuthorization(
  input: ResolveToolAuthInput,
): Promise<{ authorized: boolean; reason: string; agent: AgentRecord | null; evidence: string[] }> {
  const {
    store, actorId, actorType, ownerId, agentId,
    projectId, environment, resourceType, permission,
    actionType, risk, explicitDeny = false,
  } = input;

  if (actorType === 'owner') {
    return {
      authorized: true,
      reason: 'owner is authorized on own projects',
      agent: null,
      evidence: ['actorType=owner'],
    };
  }

  const targetAgentId = agentId ?? actorId;
  if (!targetAgentId) {
    return {
      authorized: false,
      reason: 'agent identity not provided',
      agent: null,
      evidence: ['agentId missing'],
    };
  }

  const agent = await store.getAgent(ownerId, targetAgentId);
  if (!agent) {
    return {
      authorized: false,
      reason: 'agent not found or belongs to another owner',
      agent: null,
      evidence: [`agentId=${targetAgentId}`, `ownerId=${ownerId}`],
    };
  }

  if (!isAgentLifecycleEligible(agent.status)) {
    return {
      authorized: false,
      reason: `agent lifecycle status "${agent.status}" does not permit execution`,
      agent,
      evidence: [`agent.status=${agent.status}`, 'lifecycle_denied'],
    };
  }

  const hasPermission = await store.agentHasPermission(
    targetAgentId,
    projectId,
    resourceType,
    permission,
  );
  if (!hasPermission) {
    return {
      authorized: false,
      reason: `agent lacks permission "${permission}" for resource "${resourceType}"`,
      agent,
      evidence: [
        `agentId=${targetAgentId}`,
        `permission=${permission}`,
        `resourceType=${resourceType}`,
        'permission_denied',
      ],
    };
  }

  return {
    authorized: true,
    reason: 'agent has required permission grant',
    agent,
    evidence: [
      `agentId=${targetAgentId}`,
      `permission=${permission}`,
      `resourceType=${resourceType}`,
      'permission_granted',
    ],
  };
}

/**
 * Gate 32B: Full agent authority resolution for autonomous execution.
 * Returns structured outcome with authority and autonomy decisions.
 */
export async function resolveAgentAuthority(params: {
  store: Store;
  agentId: string;
  ownerId: string;
  projectId: string | null;
  environment: EnvironmentName;
  resourceType: string;
  permission: string;
  actionType: string;
  risk: RiskLevel;
  explicitDeny?: boolean;
}): Promise<AgentExecutionResult> {
  const { store, agentId, ownerId, projectId, environment, resourceType, permission, actionType, risk, explicitDeny = false } = params;
  const identity: AgentExecutionIdentity = { type: 'agent', id: agentId, ownerId };
  const evidence: string[] = [`agentId=${agentId}`, `ownerId=${ownerId}`];

  const agent = await store.getAgent(ownerId, agentId);
  if (!agent) {
    return buildResult(identity, 'agent_not_found', null, evidence, 'agent not found or belongs to another owner');
  }
  evidence.push(`agent.status=${agent.status}`);

  if (!isAgentLifecycleEligible(agent.status)) {
    return buildResult(identity, 'agent_inactive', agent, evidence, `agent lifecycle "${agent.status}" denies execution`);
  }

  const auth = await resolveToolAuthorization({
    store, actorId: agentId, actorType: 'agent', ownerId, agentId,
    projectId, environment, resourceType, permission, actionType, risk, explicitDeny,
  });
  evidence.push(...auth.evidence);

  if (!auth.authorized) {
    return buildResult(identity, 'permission_denied', agent, evidence, auth.reason);
  }

  const authority = evaluateAuthority({
    actorId: agentId,
    actorType: 'agent',
    projectId,
    environment,
    resourceType,
    permission: permission as import('./types.js').Permission,
    risk,
    actionType,
    authorized: true,
    explicitDeny,
  });
  authority.actionType = actionType;
  evidence.push(`authority.outcome=${authority.outcome}`, `authority.denied=${authority.denied}`);

  if (authority.denied) {
    return buildResult(identity, 'authority_denied', agent, evidence, authority.reason, authority);
  }

  const stats = await store.agentStats(agentId);
  const autonomy = evaluateAutonomy({
    authority,
    successRate: stats.successRate,
    historyCount: stats.historyCount,
    ownerPolicy: null,
  });
  const clamped = clampAutonomy(autonomy.selected, authority.outcome);
  const clampedAutonomy: AutonomyDecision = {
    ...autonomy,
    selected: clamped,
    reason: clamped !== autonomy.selected
      ? `clamped from ${autonomy.selected} to ${clamped} by authority ceiling`
      : autonomy.reason,
    evidence: [...autonomy.evidence, `clamp=${clamped}`],
  };
  evidence.push(`autonomy.selected=${clampedAutonomy.selected}`);

  if (clampedAutonomy.selected === 'require_approval') {
    return buildResult(identity, 'approval_required', agent, evidence, authority.reason, authority, clampedAutonomy);
  }

  return {
    ok: true,
    outcome: 'authorized',
    identity,
    authority,
    autonomy: clampedAutonomy,
    agent,
    evidence,
  };
}

// ---------- Helpers ----------

function buildResult(
  identity: AgentExecutionIdentity,
  outcome: AgentExecutionOutcome,
  agent: AgentRecord | null,
  evidence: string[],
  reason: string,
  authority?: AuthorityDecision,
  autonomy?: AutonomyDecision,
): AgentExecutionResult {
  const defaultAuthority: AuthorityDecision = {
    outcome: outcome === 'authorized' ? 'auto' : 'deny',
    risk: 'low',
    reason,
    evidence,
    denied: outcome !== 'authorized' && outcome !== 'approval_required',
  };
  const defaultAutonomy: AutonomyDecision = {
    selected: outcome === 'authorized' ? 'auto' : outcome === 'approval_required' ? 'require_approval' : 'deny',
    evidence,
    reason,
  };
  return {
    ok: outcome === 'authorized',
    outcome,
    identity,
    authority: authority ?? defaultAuthority,
    autonomy: autonomy ?? defaultAutonomy,
    agent,
    evidence,
  };
}
