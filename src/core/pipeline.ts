// CHEF FACTORY — Gate 1 — Command Pipeline (orchestrator).
// OWNER COMMAND → INTENT → SCOPE → PROJECT → ENVIRONMENT → RISK → AUTHORITY
// → AUTONOMY → APPROVAL IF REQUIRED → TASK → EXECUTION → AUDIT → EXPLANATION
// → OUTCOME. Ambiguity MUST NOT be converted into fabricated certainty.

import { evaluateAutonomy } from './autonomy.js';
import { evaluateAuthority, riskFromAction } from './authority.js';
import { validateNewApproval } from './approval.js';
import { buildExplanation, isCompleteExplanation } from './explanation.js';
import { parseIntent } from './intent.js';
import { redactText } from './redact.js';
import { handleTaskFailure, transitionTask } from './taskEngine.js';
import type { Store } from './ports.js';
import type { SecurityGuardResult } from './security/types.js';
import type { SecurityGuardian } from './security/guardian.js';
import type { SecurityRequest } from './security/types.js';
import type {
  ActionVerb,
  AuthorityDecision,
  AutonomyDecision,
  AutonomyLevel,
  EnvironmentName,
  Explanation,
  ParsedIntent,
  Permission,
  RiskLevel,
  TaskRecord,
} from './types.js';
import {
  detectMultiStepCommand,
  createPlan,
  executeOrchestration,
  type OrchestrationPlan,
  type OrchestrationResult,
  type OrchestratorContext,
} from './orchestration.js';
import type { RateLimiter } from './security/rateLimit.js';
import type { AnomalyDetector } from './security/anomaly.js';
import type { DbQuery } from '../tools/types.js';

export interface ActorContext {
  ownerId: string;
  actorId: string;
  actorType: 'owner' | 'agent';
  agentId?: string | null;
}

export interface ExecutionOutcome {
  ok: boolean;
  output?: unknown;
  error?: unknown;
  modelId?: string | null;
  runtimeId?: string | null;
  cost?: number;
  reason?: string;
}

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface PlanStepsResult {
  steps: Array<{ tool: string; args: Record<string, unknown>; description: string; dependsOn: number[] }>;
  cost?: number;
  modelId?: string;
}

export interface ExecutionRunner {
  execute(
    task: TaskRecord,
    ctx: ActorContext,
    intent: ParsedIntent,
    conversationHistory?: ConversationMessage[],
  ): Promise<ExecutionOutcome>;
  planSteps?(
    task: TaskRecord,
    ctx: ActorContext,
    intent: ParsedIntent,
    conversationHistory?: ConversationMessage[],
  ): Promise<PlanStepsResult | null>;
}

export type PipelineOutcome =
  | 'executed'
  | 'waiting_approval'
  | 'denied'
  | 'unknown'
  | 'unknown_project'
  | 'retry_pending'
  | 'failed'
  | 'blocked';

export interface PipelineResult {
  outcome: PipelineOutcome;
  intent: ParsedIntent;
  project: { id: string; slug: string; name: string } | null;
  environment: EnvironmentName;
  risk: RiskLevel;
  authority: AuthorityDecision | null;
  autonomy: AutonomyDecision | null;
  approvalId: string | null;
  task: TaskRecord | null;
  correlationId: string;
  explanation: Explanation;
}

const VERB_PERMISSION: Record<string, Permission> = {
  read: 'read',
  write: 'write',
  create: 'write',
  update: 'write',
  delete: 'write',
  execute: 'execute',
  deploy: 'execute',
  approve: 'approve',
  reject: 'approve',
  cancel: 'execute',
  plan: 'read',
  research: 'read',
  ask: 'read',
  list: 'read',
  status: 'read',
  unknown: 'read',
};

const VERB_ACTION_TYPE: Record<string, string> = {
  delete: 'delete',
  deploy: 'deploy',
  create: 'write',
  update: 'write',
  write: 'write',
  execute: 'execute',
  approve: 'approve',
  reject: 'approve',
  cancel: 'cancel',
  plan: 'plan',
  research: 'research',
  read: 'read',
  ask: 'ask',
  list: 'read',
  status: 'read',
  unknown: 'read',
};

export class CommandPipeline {
  constructor(
    private readonly store: Store,
    private readonly execution: ExecutionRunner,
    private readonly securityGuardian?: SecurityGuardian,
    private readonly rateLimiter?: RateLimiter,
    private readonly anomalyDetector?: AnomalyDetector,
    private readonly toolDb?: DbQuery,
  ) {}

  async run(ctx: ActorContext, raw: string, conversationHistory?: ConversationMessage[]): Promise<PipelineResult> {
    const correlationId = crypto.randomUUID();
    const intent = parseIntent(raw);

    await this.store.recordAudit({
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      action: 'command.received',
      projectId: null,
      environmentId: null,
      resourceType: intent.resource,
      resourceId: intent.project,
      authorizationResult: null,
      correlationId,
      taskId: null,
      metadata: { command: redactText(intent.normalized), intentStatus: intent.status },
    });

    // Ambiguity / unknown — never fabricated.
    if (intent.status !== 'resolved') {
      const explanation = buildExplanation({
        decision: 'Command cannot proceed.',
        why:
          intent.status === 'ambiguous'
            ? 'The command is ambiguous and was not converted into fabricated certainty.'
            : 'The command could not be fully parsed.',
        evidence: intent.missing,
        risk: 'low',
        outcome: 'blocked',
      });
      await this.store.recordAudit({
        actorType: ctx.actorType, actorId: ctx.actorId, action: `command.${intent.status}`,
        projectId: null, environmentId: null, resourceType: intent.resource, resourceId: intent.project,
        authorizationResult: null, correlationId, taskId: null,
        metadata: { missing: intent.missing, normalized: redactText(intent.normalized) },
      });
      return this.result('unknown', intent, null, 'development', 'low', null, null, null, null, correlationId, explanation);
    }

    // Project scope resolution — never fabricated.
    let projectId: string | null = null;
    let projectInfo: { id: string; slug: string; name: string } | null = null;
    if (intent.project) {
      const project = await this.store.getProjectBySlug(ctx.ownerId, intent.project);
      if (!project) {
        const explanation = buildExplanation({
          decision: 'Project unknown.',
          why: `No project matching "${intent.project}" exists. Nothing was fabricated or executed.`,
          evidence: [`project=${intent.project}`],
          risk: 'low',
          outcome: 'blocked',
        });
        await this.store.recordAudit({
          actorType: ctx.actorType, actorId: ctx.actorId, action: 'command.unknown_project',
          projectId: null, environmentId: null, resourceType: intent.resource, resourceId: intent.project,
          authorizationResult: null, correlationId, taskId: null,
          metadata: { requestedProject: intent.project },
        });
        return this.result('unknown_project', intent, null, 'development', 'low', null, null, null, null, correlationId, explanation);
      }
      projectId = project.id;
      projectInfo = { id: project.id, slug: project.slug, name: project.name };
    }

    const environment: EnvironmentName = intent.environment ?? 'development';
    const actionType = this.actionTypeFor(intent.verb, intent.resource);
    const permission = VERB_PERMISSION[intent.verb] ?? 'read';
    const risk = riskFromAction(actionType, environment);

    // Authorization resolution.
    let authorized: boolean;
    if (ctx.actorType === 'owner') {
      authorized = projectId !== null || intent.resource === 'project';
    } else {
      authorized = await this.store.agentHasPermission(ctx.agentId ?? '', projectId, intent.resource ?? '', permission);
    }

    // Explicit DENY from POS policy.
    const prefs = await this.store.getPreferences(ctx.ownerId);
    const explicitDeny = this.hasExplicitDeny(prefs, actionType);

    const authority = evaluateAuthority({
      actorId: ctx.actorId,
      actorType: ctx.actorType,
      projectId,
      environment,
      resourceType: intent.resource ?? 'command',
      permission,
      risk,
      actionType,
      authorized,
      explicitDeny,
    });
    authority.actionType = actionType;

    // Autonomy.
    const stats = ctx.actorType === 'agent' && ctx.agentId
      ? await this.store.agentStats(ctx.agentId)
      : { successRate: 1, historyCount: 100 };
    const ownerPolicy = this.ownerAutonomyPolicy(prefs, actionType);
    let autonomy = evaluateAutonomy({ authority, ...stats, ownerPolicy });

    // Gate 2 — Security Guardian (optional). Fail-closed; may only be more
    // restrictive than the Gate 1 authority decision.
    if (this.securityGuardian) {
      const req: SecurityRequest = {
        ownerId: ctx.ownerId,
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        agentId: ctx.agentId ?? null,
        projectId,
        requestedProjectId: null,
        environment,
        grantedEnvironments: [environment],
        resourceType: intent.resource ?? 'command',
        resourceId: intent.project,
        actionType,
        permission,
        risk,
        authorized,
        explicitDeny,
        authorityOutcome: authority.outcome,
        untrustedInput: intent.normalized,
        scope: actionType === 'read' || actionType === 'plan' || actionType === 'research' ? 'tool' : 'task',
        correlationId,
        taskId: null,
        evidence: authority.evidence,
      };
      const securityResult = await this.securityGuardian.evaluate(req);
      if (securityResult.decision === 'lockdown' || securityResult.decision === 'deny') {
        const task = projectId
          ? await this.createTask(ctx, intent, projectId, environment, risk, authority, autonomy, 'cancelled', correlationId)
          : null;
        const explanation = buildExplanation({
          decision: 'Denied by security policy.',
          why: securityResult.reason,
          evidence: [...authority.evidence, ...securityResult.evidence],
          confidence: 1,
          risk,
          outcome: 'denied',
        });
        await this.recordDecision(ctx, projectId, intent, 'DENY_SECURITY', 'security_guardian', authority, autonomy, risk, task?.id ?? null, 'denied');
        await this.store.recordAudit({
          actorType: ctx.actorType, actorId: ctx.actorId, action: 'security.guardian_denied',
          projectId, environmentId: null, resourceType: intent.resource, resourceId: intent.project,
          authorizationResult: 'deny', correlationId, taskId: task?.id ?? null,
          metadata: { decision: securityResult.decision, reason: redactText(securityResult.reason), rules: securityResult.rules },
        });
        return this.result('denied', intent, projectInfo, environment, risk, authority, autonomy, null, task, correlationId, explanation);
      }
      // Upgrade-only reconciliation: require_approval > notify > auto.
      if (securityResult.decision === 'require_approval' && autonomy.selected !== 'require_approval') {
        autonomy = { ...autonomy, selected: 'require_approval', reason: `Security policy requires approval: ${securityResult.reason}` };
      } else if (securityResult.decision === 'notify' && autonomy.selected === 'auto') {
        autonomy = { ...autonomy, selected: 'notify', reason: `Security policy requires notification: ${securityResult.reason}` };
      }
    }

    await this.store.recordAudit({
      actorType: ctx.actorType, actorId: ctx.actorId, action: 'authority.decision',
      projectId, environmentId: null, resourceType: intent.resource, resourceId: intent.project,
      authorizationResult: autonomy.selected, correlationId, taskId: null,
      metadata: { actionType, permission, risk, authorized, reason: authority.reason },
    });

    if (ctx.actorType === 'agent' && ctx.agentId) {
      await this.store.recordAutonomy(ctx.ownerId, {
        agentId: ctx.agentId,
        projectId,
        action: actionType,
        riskLevel: risk,
        selected: autonomy,
        approvalStatus: autonomy.selected === 'require_approval' ? 'pending' : 'not_required',
      });
    }

    // DENY — always wins.
    if (autonomy.selected === 'deny') {
      const task = projectId ? await this.createTask(ctx, intent, projectId, environment, risk, authority, autonomy, 'cancelled', correlationId) : null;
      const explanation = buildExplanation({
        decision: 'Denied.',
        why: `The authority matrix denied this action: ${authority.reason}`,
        evidence: authority.evidence,
        confidence: 1,
        risk,
        outcome: 'denied',
      });
      await this.recordDecision(ctx, projectId, intent, actionType, 'DENY', authority, autonomy, risk, task?.id ?? null, 'denied');
      return this.result('denied', intent, projectInfo, environment, risk, authority, autonomy, null, task, correlationId, explanation);
    }

    // Approval gate.
    if (autonomy.selected === 'require_approval') {
      if (!projectId) {
        const explanation = buildExplanation({
          decision: 'Blocked.',
          why: 'A project is required before an approval can be requested for this action.',
          evidence: ['project missing'],
          risk,
          outcome: 'blocked',
        });
        return this.result('blocked', intent, projectInfo, environment, risk, authority, autonomy, null, null, correlationId, explanation);
      }
      const task = await this.createTask(ctx, intent, projectId, environment, risk, authority, autonomy, 'needs_approval', correlationId);
      const pending = await this.store.listApprovals(ctx.ownerId, { taskId: task.id, status: 'pending' });
      const err = validateNewApproval(pending, {
        ownerId: ctx.ownerId,
        projectId,
        taskId: task.id,
        action: actionType,
        riskLevel: risk,
        authorityLevel: autonomy.selected,
      });
      if (err) {
        return this.result('blocked', intent, projectInfo, environment, risk, authority, autonomy, null, task, correlationId,
          buildExplanation({ decision: 'Blocked.', why: err, risk, outcome: 'blocked' }));
      }
      const approval = await this.store.createApproval(ctx.ownerId, {
        projectId,
        taskId: task.id,
        action: actionType,
        riskLevel: risk,
        authorityLevel: autonomy.selected,
        requestedBy: ctx.actorId,
      });
      await this.store.recordAudit({
        actorType: ctx.actorType, actorId: ctx.actorId, action: 'approval.requested',
        projectId, environmentId: null, resourceType: intent.resource, resourceId: intent.project,
        authorizationResult: 'require_approval', correlationId, taskId: task.id,
        metadata: { approvalId: approval.id, actionType, risk },
      });
      const explanation = buildExplanation({
        decision: 'Awaiting owner approval.',
        why: `Action "${actionType}" requires owner approval (${authority.reason}).`,
        evidence: authority.evidence,
        confidence: 1,
        risk,
        outcome: 'waiting_approval',
      });
      return this.result('waiting_approval', intent, projectInfo, environment, risk, authority, autonomy, approval.id, task, correlationId, explanation);
    }

    // AUTO / NOTIFY → create + execute.
    if (!projectId) {
      const explanation = buildExplanation({
        decision: 'Blocked.',
        why: 'A project scope is required to execute this command.',
        evidence: ['project missing'],
        risk,
        outcome: 'blocked',
      });
      return this.result('blocked', intent, projectInfo, environment, risk, authority, autonomy, null, null, correlationId, explanation);
    }

    // Gate 8 — Multi-step orchestration: detect and delegate.
    if (detectMultiStepCommand(intent.normalized)) {
      return this.runOrchestration(ctx, intent, projectId, projectInfo, environment, risk, authority, autonomy, correlationId, conversationHistory);
    }

    const task = await this.createTask(ctx, intent, projectId, environment, risk, authority, autonomy, 'queued', correlationId);
    return this.executeTask(ctx, intent, task, projectInfo, environment, risk, authority, autonomy, correlationId, conversationHistory);
  }

  private async executeTask(
    ctx: ActorContext,
    intent: ParsedIntent,
    task: TaskRecord,
    projectInfo: { id: string; slug: string; name: string } | null,
    environment: EnvironmentName,
    risk: RiskLevel,
    authority: AuthorityDecision,
    autonomy: AutonomyDecision,
    correlationId: string,
    conversationHistory?: ConversationMessage[],
  ): Promise<PipelineResult> {
    const started = await this.store.patchTask(ctx.ownerId, task.id, { status: 'running', startedAt: new Date().toISOString() });
    const run = await this.store.createTaskRun(ctx.ownerId, {
      taskId: task.id,
      runNumber: task.attempts + 1,
      inputSnapshot: { intent: intent.normalized } as unknown as Record<string, unknown>,
    });

    let outcome: ExecutionOutcome;
    try {
      outcome = await this.execution.execute(started, ctx, intent, conversationHistory);
    } catch (e) {
      outcome = { ok: false, error: String(e), reason: 'execution-threw' };
    }

    await this.store.recordAudit({
      actorType: ctx.actorType, actorId: ctx.actorId, action: 'task.run',
      projectId: task.projectId, environmentId: null, resourceType: 'task', resourceId: task.id,
      authorizationResult: autonomy.selected, correlationId, taskId: task.id,
      metadata: { runId: run.id, ok: outcome.ok, reason: outcome.reason ?? null },
    });

    const durationMs = Date.now() - new Date(started.startedAt ?? started.createdAt).getTime();

    if (outcome.ok) {
      await this.store.completeTaskRun(ctx.ownerId, run.id, {
        status: 'completed',
        outputSnapshot: (outcome.output ?? null) as Record<string, unknown> | null,
        durationMs,
        cost: outcome.cost ?? 0,
      });
      if (outcome.cost && outcome.cost > 0) {
        await this.store.recordCost({
          ownerId: ctx.ownerId,
          projectId: task.projectId,
          taskId: task.id,
          runId: run.id,
          agentId: task.agentId,
          costType: 'mission',
          amount: outcome.cost,
          currency: 'USD',
          provider: null,
          modelId: outcome.modelId ?? null,
          runtimeId: outcome.runtimeId ?? null,
          billedTo: 'project',
          metadata: {},
        });
      }
      const done = await this.store.patchTask(ctx.ownerId, task.id, {
        status: 'completed',
        output: (outcome.output ?? null) as Record<string, unknown> | null,
        error: null,
        completedAt: new Date().toISOString(),
      });
      await this.store.recordAudit({
        actorType: ctx.actorType, actorId: ctx.actorId, action: 'task.completed',
        projectId: task.projectId, environmentId: null, resourceType: 'task', resourceId: task.id,
        authorizationResult: autonomy.selected, correlationId, taskId: task.id,
        metadata: { attempts: done.attempts },
      });
      await this.recordDecision(ctx, task.projectId, intent, 'completed', done.id, authority, autonomy, risk, task.id, 'completed');
      const explanation = buildExplanation({
        decision: 'Executed successfully.',
        why: `Task "${done.title}" completed under ${autonomy.selected.toUpperCase()} authority.`,
        evidence: [...authority.evidence, ...autonomy.evidence],
        confidence: 1,
        risk,
        outcome: 'executed',
      });
      return this.result('executed', intent, projectInfo, environment, risk, authority, autonomy, null, done, correlationId, explanation);
    }

    // Failure path — bounded retries.
    await this.store.completeTaskRun(ctx.ownerId, run.id, {
      status: 'failed',
      error: { message: String(outcome.error ?? outcome.reason) },
      durationMs,
      cost: 0,
    });
    const current = await this.store.getTask(ctx.ownerId, task.id);
    if (!current) {
      return this.result('failed', intent, projectInfo, environment, risk, authority, autonomy, null, task, correlationId,
        buildExplanation({ decision: 'Failed.', why: 'Task state lost during failure handling.', risk, outcome: 'failed' }));
    }
    const handled = handleTaskFailure(current, outcome.error ?? outcome.reason);
    if (handled.transitioned) {
      await this.store.patchTask(ctx.ownerId, task.id, {
        status: handled.task.status,
        error: handled.task.error,
        attempts: handled.task.attempts,
      });
      await this.store.recordAudit({
        actorType: ctx.actorType, actorId: ctx.actorId,
        action: handled.stopped ? 'task.failed_final' : 'task.failed_retry_pending',
        projectId: task.projectId, environmentId: null, resourceType: 'task', resourceId: task.id,
        authorizationResult: autonomy.selected, correlationId, taskId: task.id,
        metadata: { attempts: handled.task.attempts, maxAttempts: handled.task.maxAttempts, stopped: handled.stopped },
      });
      const explanation = buildExplanation({
        decision: handled.stopped ? 'Stopped after exhausting retries.' : 'Task failed; retry pending.',
        why: handled.stopped
          ? `Reached ${handled.task.attempts}/${handled.task.maxAttempts} attempts. State preserved; owner intervention required.`
          : `Attempt ${handled.task.attempts}/${handled.task.maxAttempts} failed. No automatic retry loop is running.`,
        evidence: ['attempts=' + String(handled.task.attempts), 'max=' + String(handled.task.maxAttempts)],
        confidence: 1,
        risk,
        outcome: handled.stopped ? 'failed' : 'retry_pending',
      });
      return this.result(handled.stopped ? 'failed' : 'retry_pending', intent, projectInfo, environment, risk, authority, autonomy, null, handled.task, correlationId, explanation);
    }

    return this.result('failed', intent, projectInfo, environment, risk, authority, autonomy, null, task, correlationId,
      buildExplanation({ decision: 'Failed.', why: handled.error ?? 'execution failed', risk, outcome: 'failed' }));
  }

  private async runOrchestration(
    ctx: ActorContext,
    intent: ParsedIntent,
    projectId: string,
    projectInfo: { id: string; slug: string; name: string } | null,
    environment: EnvironmentName,
    risk: RiskLevel,
    authority: AuthorityDecision,
    autonomy: AutonomyDecision,
    correlationId: string,
    conversationHistory?: ConversationMessage[],
  ): Promise<PipelineResult> {
    // Create the task (same as single-step)
    const task = await this.createTask(ctx, intent, projectId, environment, risk, authority, autonomy, 'queued', correlationId);

    // Gate 9: Get plan steps from execution layer (LLM-proposed real tool steps)
    let planStepsResult: PlanStepsResult | null = null;
    if (this.execution.planSteps) {
      try {
        planStepsResult = await this.execution.planSteps(task, ctx, intent, conversationHistory);
      } catch {
        planStepsResult = null;
      }
    }

    if (!planStepsResult || planStepsResult.steps.length === 0) {
      await this.store.patchTask(ctx.ownerId, task.id, {
        status: 'failed',
        error: { message: 'Could not generate orchestration plan.' },
        completedAt: new Date().toISOString(),
      });
      return this.result('failed', intent, projectInfo, environment, risk, authority, autonomy, null, task, correlationId,
        buildExplanation({ decision: 'Failed.', why: 'Could not generate orchestration plan.', risk, outcome: 'failed' }));
    }

    // Create the orchestration plan with REAL tool steps
    const plan = createPlan(
      ctx.ownerId,
      projectId,
      environment,
      planStepsResult.steps,
      correlationId,
    );

    // Audit orchestration start
    await this.store.recordAudit({
      actorType: ctx.actorType, actorId: ctx.actorId, action: 'orchestration.started',
      projectId, environmentId: null, resourceType: 'orchestration', resourceId: plan.id,
      authorizationResult: autonomy.selected, correlationId, taskId: task.id,
      metadata: { planId: plan.id, stepsCount: plan.steps.length, command: redactText(intent.normalized) },
    });

    // Mark task running
    const started = await this.store.patchTask(ctx.ownerId, task.id, { status: 'running', startedAt: new Date().toISOString() });
    const run = await this.store.createTaskRun(ctx.ownerId, {
      taskId: task.id,
      runNumber: task.attempts + 1,
      inputSnapshot: { intent: intent.normalized, orchestration: true } as unknown as Record<string, unknown>,
    });

    // Gate 9: Execute through the REAL orchestration engine (not execution.execute)
    const orchestrationCtx: OrchestratorContext = {
      store: this.store,
      actorCtx: ctx,
      environment,
      projectId,
      securityGuardian: this.securityGuardian,
      rateLimiter: this.rateLimiter,
      anomalyDetector: this.anomalyDetector,
      toolDb: this.toolDb,
      conversationHistory,
    };

    const orchestrationResult = await executeOrchestration(plan, orchestrationCtx);

    // Record planning cost from model call
    const planningCost = planStepsResult.cost ?? 0;
    if (planningCost > 0) {
      await this.store.recordCost({
        ownerId: ctx.ownerId,
        projectId: task.projectId,
        taskId: task.id,
        runId: run.id,
        agentId: task.agentId,
        costType: 'mission',
        amount: planningCost,
        currency: 'USD',
        provider: null,
        modelId: planStepsResult.modelId ?? null,
        runtimeId: null,
        billedTo: 'project',
        metadata: { phase: 'planning' },
      });
    }

    await this.store.recordAudit({
      actorType: ctx.actorType, actorId: ctx.actorId, action: 'orchestration.completed',
      projectId, environmentId: null, resourceType: 'orchestration', resourceId: plan.id,
      authorizationResult: autonomy.selected, correlationId, taskId: task.id,
      metadata: { planId: plan.id, ok: orchestrationResult.ok, status: orchestrationResult.status },
    });

    const durationMs = Date.now() - new Date(started.startedAt ?? started.createdAt).getTime();

    if (orchestrationResult.ok) {
      await this.store.completeTaskRun(ctx.ownerId, run.id, {
        status: 'completed',
        outputSnapshot: orchestrationResult as unknown as Record<string, unknown> | null,
        durationMs,
        cost: planningCost,
      });
      const done = await this.store.patchTask(ctx.ownerId, task.id, {
        status: 'completed',
        output: orchestrationResult as unknown as Record<string, unknown> | null,
        error: null,
        completedAt: new Date().toISOString(),
      });
      await this.store.recordAudit({
        actorType: ctx.actorType, actorId: ctx.actorId, action: 'task.completed',
        projectId: task.projectId, environmentId: null, resourceType: 'task', resourceId: task.id,
        authorizationResult: autonomy.selected, correlationId, taskId: task.id,
        metadata: { attempts: done.attempts, orchestration: true, planId: plan.id },
      });
      await this.recordDecision(ctx, task.projectId, intent, 'completed', done.id, authority, autonomy, risk, task.id, 'completed');
      const explanation = buildExplanation({
        decision: 'Multi-step execution completed.',
        why: `Orchestration plan completed under ${autonomy.selected.toUpperCase()} authority.`,
        evidence: [...authority.evidence, ...autonomy.evidence, `planId=${plan.id}`, `steps=${orchestrationResult.stepsCompleted}/${orchestrationResult.totalSteps}`],
        confidence: 1,
        risk,
        outcome: 'executed',
      });
      return this.result('executed', intent, projectInfo, environment, risk, authority, autonomy, null, done, correlationId, explanation);
    }

    // Failure path
    const errorMsg = orchestrationResult.error ?? 'orchestration failed';
    await this.store.completeTaskRun(ctx.ownerId, run.id, {
      status: 'failed',
      error: { message: errorMsg },
      durationMs,
      cost: 0,
    });
    const current = await this.store.getTask(ctx.ownerId, task.id);
    if (!current) {
      return this.result('failed', intent, projectInfo, environment, risk, authority, autonomy, null, task, correlationId,
        buildExplanation({ decision: 'Failed.', why: 'Task state lost during orchestration failure.', risk, outcome: 'failed' }));
    }
    const handled = handleTaskFailure(current, errorMsg);
    if (handled.transitioned) {
      await this.store.patchTask(ctx.ownerId, task.id, {
        status: handled.task.status,
        error: handled.task.error,
        attempts: handled.task.attempts,
      });
      await this.store.recordAudit({
        actorType: ctx.actorType, actorId: ctx.actorId,
        action: handled.stopped ? 'orchestration.failed_final' : 'orchestration.failed_retry_pending',
        projectId: task.projectId, environmentId: null, resourceType: 'orchestration', resourceId: plan.id,
        authorizationResult: autonomy.selected, correlationId, taskId: task.id,
        metadata: { planId: plan.id, attempts: handled.task.attempts, maxAttempts: handled.task.maxAttempts, stopped: handled.stopped },
      });
      const explanation = buildExplanation({
        decision: handled.stopped ? 'Orchestration stopped after exhausting retries.' : 'Orchestration failed; retry pending.',
        why: handled.stopped
          ? `Reached ${handled.task.attempts}/${handled.task.maxAttempts} attempts. State preserved; owner intervention required.`
          : `Attempt ${handled.task.attempts}/${handled.task.maxAttempts} failed. No automatic retry loop is running.`,
        evidence: ['attempts=' + String(handled.task.attempts), 'max=' + String(handled.task.maxAttempts), `planId=${plan.id}`],
        confidence: 1,
        risk,
        outcome: handled.stopped ? 'failed' : 'retry_pending',
      });
      return this.result(handled.stopped ? 'failed' : 'retry_pending', intent, projectInfo, environment, risk, authority, autonomy, null, handled.task, correlationId, explanation);
    }

    return this.result('failed', intent, projectInfo, environment, risk, authority, autonomy, null, task, correlationId,
      buildExplanation({ decision: 'Failed.', why: handled.error ?? errorMsg, risk, outcome: 'failed' }));
  }

  private async createTask(
    ctx: ActorContext,
    intent: ParsedIntent,
    projectId: string,
    environment: EnvironmentName,
    risk: RiskLevel,
    authority: AuthorityDecision,
    autonomy: AutonomyDecision,
    status: TaskRecord['status'],
    correlationId: string,
  ): Promise<TaskRecord> {
    const task = await this.store.createTask(ctx.ownerId, {
      projectId,
      title: redactText(intent.target ? `${intent.verb} ${intent.target}` : intent.normalized),
      description: redactText(intent.normalized),
      agentId: ctx.agentId ?? null,
      riskLevel: risk,
      authorityLevel: authority.outcome,
      autonomy: autonomy.selected,
      approvalRequired: status === 'needs_approval',
      status,
      inputs: { intent: redactText(intent.normalized), environment, resource: intent.resource ?? null },
      correlationId,
      createdBy: ctx.actorId,
    });
    await this.store.recordAudit({
      actorType: ctx.actorType, actorId: ctx.actorId, action: 'task.created',
      projectId, environmentId: null, resourceType: 'task', resourceId: task.id,
      authorizationResult: authority.outcome, correlationId, taskId: task.id,
      metadata: { status, autonomy: autonomy.selected },
    });
    return task;
  }

  private async recordDecision(
    ctx: ActorContext,
    projectId: string | null,
    intent: ParsedIntent,
    outcome: string,
    reference: string,
    authority: AuthorityDecision,
    autonomy: AutonomyDecision,
    risk: RiskLevel,
    taskId: string | null,
    decisionOutcome: string,
  ): Promise<void> {
    await this.store.recordDecision(ctx.ownerId, {
      projectId,
      context: redactText(`Command "${intent.normalized}" → outcome ${outcome}`),
      options: ['auto', 'notify', 'require_approval', 'deny'],
      selectedOption: autonomy.selected,
      reason: authority.reason,
      evidence: [...authority.evidence, ...autonomy.evidence, `task=${taskId ?? 'none'}`, `reference=${reference}`],
      confidence: 1,
      riskLevel: risk,
      authorityLevel: autonomy.selected,
      approvedBy: autonomy.selected === 'deny' || autonomy.selected === 'require_approval' ? ctx.actorId : null,
      outcome: decisionOutcome,
    });
  }

  private actionTypeFor(verb: ActionVerb, resource: string | null): string {
    if (resource && ['credit', 'funding', 'money', 'transfer'].includes(resource)) return 'financial';
    if (resource && ['legal', 'contract'].includes(resource)) return 'legal';
    if (resource && ['account', 'security', 'access', 'secret', 'keys'].includes(resource)) return 'account_security';
    if (verb === 'deploy') return 'deploy';
    if (verb === 'delete') return 'delete';
    if (verb === 'execute') return 'execute';
    return VERB_ACTION_TYPE[verb] ?? 'read';
  }

  private hasExplicitDeny(prefs: Record<string, unknown>, actionType: string): boolean {
    const policy = (prefs['policy'] ?? {}) as Record<string, unknown>;
    if (policy['explicit_deny'] === true) return true;
    if (policy[`deny:${actionType}`] === true) return true;
    if (policy[`deny:${actionType}`] === 'deny') return true;
    return false;
  }

  private ownerAutonomyPolicy(prefs: Record<string, unknown>, actionType: string): AutonomyLevel | null {
    const autonomyPrefs = (prefs['autonomy'] ?? {}) as Record<string, unknown>;
    const v = (autonomyPrefs[actionType] ?? autonomyPrefs['default'] ?? null) as AutonomyLevel | null;
    return v && ['auto', 'notify', 'require_approval', 'deny'].includes(v) ? v : null;
  }

  private result(
    outcome: PipelineOutcome,
    intent: ParsedIntent,
    project: { id: string; slug: string; name: string } | null,
    environment: EnvironmentName,
    risk: RiskLevel,
    authority: AuthorityDecision | null,
    autonomy: AutonomyDecision | null,
    approvalId: string | null,
    task: TaskRecord | null,
    correlationId: string,
    explanation: Explanation,
  ): PipelineResult {
    if (!isCompleteExplanation(explanation)) {
      throw new Error('pipeline produced an incomplete explanation');
    }
    return { outcome, intent, project, environment, risk, authority, autonomy, approvalId, task, correlationId, explanation };
  }
}
