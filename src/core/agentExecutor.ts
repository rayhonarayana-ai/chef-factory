// CHEF FACTORY — Gate 34 — Autonomous Agent Task Execution Entry Point.
// Thin composition layer: Persisted Agent + Persisted Task -> existing execution stack.
// No new execution engine. No scheduler. No mission engine. No agent-to-agent delegation.
//
// FLOW:
//   load Agent + Task from Store
//   -> verify identity (agent exists under this owner)
//   -> verify lifecycle (agent.status === 'active')
//   -> verify assignment (task.agentId === agent.id)
//   -> resolveAgentAuthority (Gate 32B)
//   -> claimTaskForExecution (distributed-safe)
//   -> construct ActorContext (actorType: 'agent')
//   -> delegate to existing ExecutionRunner.execute()
//   -> handle outcome
//
// INVARIANTS:
//   AGENT_EXECUTION_AS_OWNER = NO
//   CHEF_OWNER_IMPERSONATION = NO
//   ASSIGNMENT_GRANTS_PERMISSION = NO
//   NEW_EXECUTION_ENGINE_CREATED = NO
//   WORKFORCE_ORCHESTRATION_IMPLEMENTED = NO
//   AUTONOMOUS_AGENT_TO_AGENT_DELEGATION = NO
//   MISSION_ENGINE_IMPLEMENTED = NO
//   SELF_ASSIGNMENT_BLOCKED = YES

import type { Store } from './ports.js';
import type { ActorContext, ExecutionOutcome, ExecutionRunner, ConversationMessage } from './pipeline.js';
import type {
  AgentRecord,
  EnvironmentName,
  ParsedIntent,
  RiskLevel,
  TaskRecord,
  AuthorityDecision,
  AutonomyDecision,
  Explanation,
} from './types.js';
import { riskFromAction } from './authority.js';
import { handleTaskFailure } from './taskEngine.js';
import {
  resolveAgentAuthority,
  verifyTaskAssignment,
  isAgentLifecycleEligible,
} from './agentAuthority.js';
import { parseIntent } from './intent.js';
import { buildExplanation } from './explanation.js';
import { getSpecialistProfileByRole } from './specialist/registry.js';
import { buildSpecialistSystemPrompt } from './specialist/prompt.js';
import type { Gate45AcceptanceGateway } from './gate45Acceptance.js';

// ---------- Executable Task Statuses ----------

/** Tasks that may start execution via Gate 34. */
export const EXECUTABLE_TASK_STATUSES = new Set<TaskRecord['status']>(['queued']);

/** Tasks that are terminal -- no execution possible. */
const TERMINAL_TASK_STATUSES = new Set<TaskRecord['status']>(['completed', 'failed', 'cancelled']);

// ---------- Agent System Prompt ----------

/** Agent-specific system prompt variant (Gate 34, section 16). */
export function agentSystemPrompt(agentId: string, ownerId: string, taskId: string): string {
  return [
    'You are an assigned CHEF agent executing a specific task.',
    `Agent ID: ${agentId}`,
    `Owner ID: ${ownerId}`,
    `Task ID: ${taskId}`,
    '',
    'You are a bounded worker with limited authority. You must:',
    '- Execute only the assigned task',
    '- Obey all SecurityGuardian and ToolBroker decisions',
    '- Stop immediately if approval is required',
    '- Never expose secrets, credentials, or sensitive data',
    '- Never self-assign tasks or delegate to other agents',
    '- Never attempt to approve your own actions',
    '- Report ambiguity rather than fabricate certainty',
    '- Redact secrets from all outputs and audit trails',
    '',
    'Your task assignment does NOT grant arbitrary permissions.',
    'Each tool call is independently authorized.',
    'If denied, accept the denial and report it.',
  ].join('\n');
}

// ---------- Execution Result ----------

export type AgentExecutionResultOutcome =
  | 'completed'
  | 'failed'
  | 'retry_pending'
  | 'approval_required'
  | 'denied'
  | 'already_running'
  | 'invalid_task_state'
  | 'agent_not_found'
  | 'agent_inactive'
  | 'assignment_mismatch'
  | 'owner_mismatch'
  | 'task_not_assigned'
  | 'authority_denied'
  | 'permission_denied'
  | 'task_not_found';

export interface AgentExecutionResult {
  ok: boolean;
  outcome: AgentExecutionResultOutcome;
  task: TaskRecord | null;
  agent: AgentRecord | null;
  authority: AuthorityDecision | null;
  autonomy: AutonomyDecision | null;
  explanation: Explanation | null;
  error: string | null;
  evidence: string[];
}

// ---------- Synthetic Intent Builder ----------

/** Build a synthetic ParsedIntent from a task's stored inputs. */
function buildIntentFromTask(task: TaskRecord): ParsedIntent {
  const inputs = (task.inputs ?? {}) as Record<string, unknown>;
  const intentRaw = (inputs.intent as string) ?? task.description ?? task.title;
  const environment = (inputs.environment as EnvironmentName) ?? 'development';
  const resource = (inputs.resource as string) ?? 'task';
  const parsed = parseIntent(String(intentRaw));
  return {
    ...parsed,
    environment,
    resource,
    project: null,
  };
}

// ---------- Main Entry Point ----------

export interface ExecuteAssignedAgentTaskInput {
  store: Store;
  execution: ExecutionRunner;
  ownerId: string;
  agentId: string;
  taskId: string;
  conversationHistory?: ConversationMessage[];
  /**
   * Gate 45 — Trusted acceptance gate. When the task requires verification and this
   * gateway is absent, the task FAILS CLOSED (never completed) because the model's
   * declaration of success would be the only authority (DISALLOWED).
   */
  verification?: Gate45AcceptanceGateway;
}

/**
 * Gate 34: Execute an already-assigned task as an autonomous agent.
 *
 * THINNEST entry point -- composition layer bridging persisted Agent + Task
 * into the existing execution stack.
 *
 * Does NOT create tasks, assign agents, spawn workers, or loop.
 * ONE agent, ONE task, ONE execution attempt.
 */
export async function executeAssignedAgentTask(
  input: ExecuteAssignedAgentTaskInput,
): Promise<AgentExecutionResult> {
  const { store, execution, ownerId, agentId, taskId, conversationHistory, verification } = input;
  const evidence: string[] = [`agentId=${agentId}`, `ownerId=${ownerId}`, `taskId=${taskId}`];

  // 1. Load Agent
  const agent = await store.getAgent(ownerId, agentId);
  if (!agent) {
    return finalResult('agent_not_found', null, null, null, null, 'Agent not found or belongs to another owner', evidence);
  }
  evidence.push(`agent.status=${agent.status}`);

  // 2. Verify Lifecycle
  if (!isAgentLifecycleEligible(agent.status)) {
    return finalResult('agent_inactive', null, agent, null, null, `Agent lifecycle status "${agent.status}" does not permit execution`, evidence);
  }

  // 2b. Resolve specialist profile (suitability/prompt metadata only — NEVER a
  // grant of authority). Profiles are looked up by the agent's canonical role.
  // A missing profile is fine: agent falls back to the generic guardrail prompt.
  const specialistProfile = getSpecialistProfileByRole(agent.role ?? '');
  if (specialistProfile) {
    evidence.push(`specialist.slug=${specialistProfile.slug}`);
  }

  // 3. Load Task
  const task = await store.getTask(ownerId, taskId);
  if (!task) {
    return finalResult('task_not_found', null, agent, null, null, 'Task not found', evidence);
  }
  evidence.push(`task.status=${task.status}`, `task.agentId=${task.agentId ?? 'null'}`);

  // 4. Verify Assignment
  const assignment = verifyTaskAssignment(task, agentId, ownerId);
  evidence.push(...assignment.evidence);
  if (!assignment.ok) {
    return finalResult(
      assignment.outcome as AgentExecutionResultOutcome,
      task, agent, null, null,
      `Assignment verification failed: ${assignment.outcome}`,
      evidence,
    );
  }

  // 5. Verify Task Status
  if (TERMINAL_TASK_STATUSES.has(task.status)) {
    return finalResult('invalid_task_state', task, agent, null, null, `Task is in terminal status "${task.status}"`, evidence);
  }
  if (!EXECUTABLE_TASK_STATUSES.has(task.status)) {
    return finalResult('invalid_task_state', task, agent, null, null, `Task status "${task.status}" is not executable`, evidence);
  }

  // 6. Resolve Authority (Gate 32B)
  const environment: EnvironmentName = ((task.inputs as Record<string, unknown>)?.environment as EnvironmentName) ?? 'development';
  const resourceType = ((task.inputs as Record<string, unknown>)?.resource as string) ?? 'task';
  const actionType = 'execute';
  const permission = 'execute' as const;
  const risk: RiskLevel = task.riskLevel ?? riskFromAction(actionType, environment);

  const authorityResult = await resolveAgentAuthority({
    store, agentId, ownerId,
    projectId: task.projectId ?? null,
    environment, resourceType, permission, actionType, risk,
  });
  evidence.push(...authorityResult.evidence);

  if (!authorityResult.ok) {
    if (authorityResult.outcome === 'approval_required') {
      return finalResult('approval_required', task, agent, authorityResult.authority, authorityResult.autonomy,
        `Execution requires approval: ${authorityResult.authority.reason}`, evidence);
    }
    const mapped = authorityResult.outcome === 'authority_denied'
      ? 'authority_denied'
      : authorityResult.outcome === 'permission_denied'
        ? 'permission_denied'
        : authorityResult.outcome;
    return finalResult(
      mapped as AgentExecutionResultOutcome,
      task, agent, authorityResult.authority, authorityResult.autonomy,
      `Authority resolution denied: ${authorityResult.outcome}`,
      evidence,
    );
  }

  // 7. Claim Task (distributed-safe: queued -> running)
  const claim = await store.claimTaskForExecution(ownerId, taskId, agentId);
  evidence.push(`claim.outcome=${claim.outcome}`);

  if (!claim.ok) {
    return finalResult(
      claim.outcome as AgentExecutionResultOutcome,
      claim.task ?? task, agent, authorityResult.authority, authorityResult.autonomy,
      `Execution claim failed: ${claim.outcome}`,
      evidence,
    );
  }

  // 8. Construct ActorContext
  const ctx: ActorContext = {
    ownerId,
    actorId: agentId,
    actorType: 'agent',
    agentId,
    // Gate 40: inject the specialist-aware system prompt + provider-neutral
    // reasoning need when a profile matches. SUITABILITY/prompt only.
    // NEVER grants authority; NEVER references a model provider.
    agentSystemPrompt: buildSpecialistSystemPrompt(agentId, ownerId, task.id, specialistProfile),
    agentReasoning: specialistProfile?.modelNeeds.reasoning ?? null,
    // Gate 43: propagate the specialist's provider-neutral latency sensitivity so
    // the canonical routing requirements can treat latencySensitive operationally.
    agentLatencySensitive: specialistProfile?.modelNeeds.latencySensitive ?? null,
  };

  // 9. Build Synthetic Intent
  const claimedTask = claim.task!;
  const intent = buildIntentFromTask(claimedTask);

  // 10. Create TaskRun
  const run = await store.createTaskRun(ownerId, {
    taskId: claimedTask.id,
    runNumber: claimedTask.attempts + 1,
    inputSnapshot: { intent: intent.normalized, agentId, trigger: 'agent_executor' } as unknown as Record<string, unknown>,
  });

  // 11. Audit: execution started
  const correlationId = claimedTask.correlationId ?? crypto.randomUUID();
  await safeAudit(store, {
    actorType: 'agent',
    actorId: agentId,
    action: 'agent.execution_started',
    projectId: claimedTask.projectId,
    environmentId: null,
    resourceType: 'task',
    resourceId: claimedTask.id,
    authorizationResult: authorityResult.autonomy?.selected ?? null,
    correlationId,
    taskId: claimedTask.id,
    metadata: { runId: run.id, agentId, autonomy: authorityResult.autonomy?.selected },
  });

  // 12. Execute via existing ExecutionRunner
  let outcome: ExecutionOutcome;
  try {
    outcome = await execution.execute(claimedTask, ctx, intent, conversationHistory);
  } catch (e) {
    outcome = { ok: false, error: String(e), reason: 'execution-threw' };
  }

  // 13. Audit: execution result
  // Duration must be non-negative; run.startedAt uses the DB server clock, which
  // can be ahead of the client clock (hosted DBs), yielding negative deltas that
  // violate the task_runs.duration_ms >= 0 constraint.
  const rawDurationMs = Date.now() - new Date(run.startedAt).getTime();
  const durationMs = Number.isFinite(rawDurationMs) && rawDurationMs >= 0 ? rawDurationMs : 0;
  await safeAudit(store, {
    actorType: 'agent',
    actorId: agentId,
    action: outcome.ok ? 'agent.execution_completed' : 'agent.execution_failed',
    projectId: claimedTask.projectId,
    environmentId: null,
    resourceType: 'task',
    resourceId: claimedTask.id,
    authorizationResult: authorityResult.autonomy?.selected ?? null,
    correlationId,
    taskId: claimedTask.id,
    metadata: { runId: run.id, ok: outcome.ok, reason: outcome.reason ?? null, durationMs },
  });

  // 14. Handle success — gated by the Gate 45 trusted acceptance gate for
  //     verification-required software tasks (MODEL_DECLARES_SUCCESS = ADVISORY_ONLY).
  //     If the gate is required but absent/inconclusive, the task FAILS CLOSED.
  let shouldComplete = outcome.ok;
  let notAcceptedReason: string | null = null;
  let acceptanceClass: 'passed' | 'repairable' | 'nonRepairable' | 'blocked' | null = null;

  const requiresVerification = (claimedTask.requiredVerifications?.length ?? 0) > 0;

  if (outcome.ok && requiresVerification) {
    if (!verification) {
      // No trusted gate wired: the model's declaration cannot authorize completion.
      shouldComplete = false;
      acceptanceClass = 'blocked';
      notAcceptedReason = 'trusted_acceptance_gate_missing';
    } else {
      try {
        const decision = await verification.evaluate(claimedTask);
        shouldComplete = decision.accepted;
        acceptanceClass = decision.cls;
        notAcceptedReason = decision.reason;
      } catch (e) {
        shouldComplete = false;
        acceptanceClass = 'blocked';
        notAcceptedReason = `acceptance_gate_threw:${String(e)}`;
      }
    }
  }

  if (shouldComplete) {
    await store.completeTaskRun(ownerId, run.id, {
      status: 'completed',
      outputSnapshot: (outcome.output ?? null) as Record<string, unknown> | null,
      durationMs,
      cost: outcome.cost ?? 0,
    });
    if (outcome.cost && outcome.cost > 0) {
      await safeCost(store, {
        ownerId,
        projectId: claimedTask.projectId,
        taskId: claimedTask.id,
        runId: run.id,
        agentId,
        costType: outcome.modelId ? 'model' : 'mission',
        amount: outcome.cost,
        currency: 'USD',
        provider: outcome.provider ?? null,
        modelId: outcome.modelId ?? null,
        runtimeId: outcome.runtimeId ?? null,
        billedTo: 'project',
        metadata: { trigger: 'agent_executor' },
      });
    }
    const done = await store.patchTask(ownerId, claimedTask.id, {
      status: 'completed',
      output: (outcome.output ?? null) as Record<string, unknown> | null,
      error: null,
      completedAt: new Date().toISOString(),
    });
    await store.recordDecision(ownerId, {
      projectId: claimedTask.projectId,
      context: `Agent ${agentId} executed task ${claimedTask.id}`,
      options: ['auto', 'notify', 'require_approval', 'deny'],
      selectedOption: authorityResult.autonomy?.selected ?? null,
      reason: authorityResult.authority.reason,
      evidence,
      confidence: 1,
      riskLevel: risk,
      authorityLevel: authorityResult.autonomy?.selected ?? null,
      approvedBy: null,
      outcome: 'completed',
    });
    const explanation = buildExplanation({
      decision: 'Agent execution completed successfully.',
      why: `Agent ${agentId} completed task "${done.title}" under ${authorityResult.autonomy?.selected?.toUpperCase()} authority.`,
      evidence: [...authorityResult.authority.evidence, ...(authorityResult.autonomy?.evidence ?? [])],
      confidence: 1,
      risk,
      outcome: 'completed',
    });
    return { ok: true, outcome: 'completed', task: done, agent, authority: authorityResult.authority, autonomy: authorityResult.autonomy, explanation, error: null, evidence };
  }

  // 14b. Verification-required task NOT accepted (or gate missing). The model must
  //      never override this. Classify deterministically and route: repairable →
  //      existing bounded retry; nonRepairable/blocked → fail closed (no futile retry,
  //      no false completion, never overwrite an externally terminal/cancelled task).
  const isAcceptanceDenial = outcome.ok === true;
  const failMessage = isAcceptanceDenial
    ? `verification_not_accepted:${notAcceptedReason ?? 'unknown'}`
    : String(outcome.error ?? outcome.reason);

  await store.completeTaskRun(ownerId, run.id, {
    status: 'failed',
    error: { message: failMessage },
    durationMs,
    cost: 0,
  });

  const current = await store.getTask(ownerId, claimedTask.id);
  if (!current) {
    return finalResult('failed', claimedTask, agent, authorityResult.authority, authorityResult.autonomy, `Task state lost during ${isAcceptanceDenial ? 'acceptance' : 'failure'} handling`, evidence);
  }

  // NEVER overwrite an externally terminal/cancelled task to completed or to a
  // different terminal. CANCELLED_TASK_CAN_BE_OVERWRITTEN_COMPLETED = NO.
  if (current.status === 'cancelled' || current.status === 'completed' || current.status === 'failed') {
    return finalResult('failed', current, agent, authorityResult.authority, authorityResult.autonomy,
      `Task is ${current.status}; not overwritten by ${isAcceptanceDenial ? 'acceptance denial' : 'execution failure'}`, evidence);
  }

  const isRepairableBlocked = acceptanceClass === 'nonRepairable' || acceptanceClass === 'blocked';
  if (isAcceptanceDenial && isRepairableBlocked) {
    // Fail closed, terminal. Do NOT requeue (dependency_missing, global stop, budget,
    // lockdown, cancellation, security denial are never repaired by retrying).
    await safeAudit(store, {
      actorType: 'agent',
      actorId: agentId,
      action: 'agent.verification.blocked',
      projectId: claimedTask.projectId,
      environmentId: null,
      resourceType: 'task',
      resourceId: claimedTask.id,
      authorizationResult: authorityResult.autonomy?.selected ?? null,
      correlationId,
      taskId: claimedTask.id,
      metadata: { reason: notAcceptedReason, attempts: current.attempts + 1, maxAttempts: current.maxAttempts, stopped: true, cls: acceptanceClass },
    });
    const failed = await store.patchTask(ownerId, claimedTask.id, {
      status: 'failed',
      error: { message: failMessage },
    });
    const explanation = buildExplanation({
      decision: 'Verification-required task failed closed.',
      why: `Trusted acceptance gate blocked completion (${notAcceptedReason ?? 'verification_not_passed'}). Model declaration is advisory only.`,
      evidence: ['verificationRequired=true', 'cls=' + String(acceptanceClass)],
      confidence: 1,
      risk,
      outcome: 'failed',
    });
    return { ok: false, outcome: 'failed', task: failed, agent, authority: authorityResult.authority, autonomy: authorityResult.autonomy, explanation, error: failMessage, evidence };
  }

  // Repairable verification failure — reuse the existing bounded TaskEngine retry
  // mechanism (cross-attempt repair). No new scheduler; attempts remain bounded.
  const handled = handleTaskFailure(current, failMessage);
  if (handled.transitioned) {
    await store.patchTask(ownerId, claimedTask.id, {
      status: handled.task.status,
      error: handled.task.error,
      attempts: handled.task.attempts,
    });
    await safeAudit(store, {
      actorType: 'agent',
      actorId: agentId,
      action: isAcceptanceDenial ? 'agent.verification_retry_pending' : 'agent.execution_retry_pending',
      projectId: claimedTask.projectId,
      environmentId: null,
      resourceType: 'task',
      resourceId: claimedTask.id,
      authorizationResult: authorityResult.autonomy?.selected ?? null,
      correlationId,
      taskId: claimedTask.id,
      metadata: { attempts: handled.task.attempts, maxAttempts: handled.task.maxAttempts, stopped: handled.stopped, verificationDenied: isAcceptanceDenial ? 'true' : 'false' },
    });
    const explanation = buildExplanation({
      decision: handled.stopped ? 'Task stopped after exhausting retries.' : 'Task failed; retry pending.',
      why: handled.stopped
        ? `Reached ${handled.task.attempts}/${handled.task.maxAttempts} attempts. Owner intervention required.`
        : `Attempt ${handled.task.attempts}/${handled.task.maxAttempts} failed. No automatic retry loop is running.`,
      evidence: ['attempts=' + String(handled.task.attempts), 'max=' + String(handled.task.maxAttempts)],
      confidence: 1,
      risk,
      outcome: handled.stopped ? 'failed' : 'retry_pending',
    });
    const out = handled.stopped ? 'failed' : 'retry_pending';
    return { ok: false, outcome: out as AgentExecutionResultOutcome, task: handled.task, agent, authority: authorityResult.authority, autonomy: authorityResult.autonomy, explanation, error: failMessage, evidence };
  }

  return finalResult('failed', current, agent, authorityResult.authority, authorityResult.autonomy, handled.error ?? failMessage, evidence);
}

// ---------- Helpers ----------

function finalResult(
  outcome: AgentExecutionResultOutcome,
  task: TaskRecord | null,
  agent: AgentRecord | null,
  authority: AuthorityDecision | null,
  autonomy: AutonomyDecision | null,
  error: string,
  evidence: string[],
): AgentExecutionResult {
  const ok = outcome === 'completed';
  const explanation = buildExplanation({
    decision: ok ? 'Agent execution completed.' : `Agent execution ${outcome}.`,
    why: error,
    evidence,
    confidence: 1,
    risk: 'low',
    outcome: ok ? 'completed' : 'failed',
  });
  return { ok, outcome, task, agent, authority, autonomy, explanation, error, evidence };
}

async function safeAudit(store: Store, event: Parameters<Store['recordAudit']>[0]): Promise<void> {
  try {
    await store.recordAudit(event);
  } catch (e) {
    console.warn(`[Gate 34] Audit persistence failed for action="${event.action}": ${e}`);
  }
}

async function safeCost(store: Store, event: Parameters<Store['recordCost']>[0]): Promise<void> {
  try {
    await store.recordCost(event);
  } catch (e) {
    console.warn(`[Gate 34] Cost persistence failed for taskId="${event.taskId}": ${e}`);
  }
}
