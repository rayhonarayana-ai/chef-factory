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
  const { store, execution, ownerId, agentId, taskId, conversationHistory } = input;
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
  const durationMs = Date.now() - new Date(run.startedAt).getTime();
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

  // 14. Handle success
  if (outcome.ok) {
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
        costType: 'mission',
        amount: outcome.cost,
        currency: 'USD',
        provider: null,
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

  // 15. Handle failure -- bounded retries via existing taskEngine
  await store.completeTaskRun(ownerId, run.id, {
    status: 'failed',
    error: { message: String(outcome.error ?? outcome.reason) },
    durationMs,
    cost: 0,
  });
  const current = await store.getTask(ownerId, claimedTask.id);
  if (!current) {
    return finalResult('failed', claimedTask, agent, authorityResult.authority, authorityResult.autonomy, 'Task state lost during failure handling', evidence);
  }
  const handled = handleTaskFailure(current, outcome.error ?? outcome.reason);
  if (handled.transitioned) {
    await store.patchTask(ownerId, claimedTask.id, {
      status: handled.task.status,
      error: handled.task.error,
      attempts: handled.task.attempts,
    });
    await safeAudit(store, {
      actorType: 'agent',
      actorId: agentId,
      action: handled.stopped ? 'agent.execution_failed_final' : 'agent.execution_retry_pending',
      projectId: claimedTask.projectId,
      environmentId: null,
      resourceType: 'task',
      resourceId: claimedTask.id,
      authorizationResult: authorityResult.autonomy?.selected ?? null,
      correlationId,
      taskId: claimedTask.id,
      metadata: { attempts: handled.task.attempts, maxAttempts: handled.task.maxAttempts, stopped: handled.stopped },
    });
    const explanation = buildExplanation({
      decision: handled.stopped ? 'Agent execution stopped after exhausting retries.' : 'Agent task failed; retry pending.',
      why: handled.stopped
        ? `Reached ${handled.task.attempts}/${handled.task.maxAttempts} attempts. Owner intervention required.`
        : `Attempt ${handled.task.attempts}/${handled.task.maxAttempts} failed. No automatic retry loop is running.`,
      evidence: ['attempts=' + String(handled.task.attempts), 'max=' + String(handled.task.maxAttempts)],
      confidence: 1,
      risk,
      outcome: handled.stopped ? 'failed' : 'retry_pending',
    });
    const out = handled.stopped ? 'failed' : 'retry_pending';
    return { ok: false, outcome: out as AgentExecutionResultOutcome, task: handled.task, agent, authority: authorityResult.authority, autonomy: authorityResult.autonomy, explanation, error: String(outcome.error ?? outcome.reason), evidence };
  }

  return finalResult('failed', current, agent, authorityResult.authority, authorityResult.autonomy, handled.error ?? 'execution failed', evidence);
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
