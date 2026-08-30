// CHEF FACTORY — Gate 8 + Gate 11 — Multi-Step Task Orchestration.
// Owner command → plan → ordered steps → guarded execution → progress tracking
// → step result verification → controlled continuation → final response.
// Every tool execution passes through ToolBroker → Guardian → Authority.
// The orchestrator does NOT bypass any existing security controls.
// Gate 11: orchestration timeout, step timeout, cancellation, variable
// interpolation validation, dependency/result integrity, failure recovery.

import { randomUUID } from 'node:crypto';
import { evaluateAuthority, riskFromAction } from './authority.js';
import { ToolBroker, type Tool } from '../gateways/toolBroker.js';
import { GATE3_TOOLS } from '../tools/index.js';
import type { SecurityGuardian } from './security/guardian.js';
import type { RateLimiter } from './security/rateLimit.js';
import type { AnomalyDetector } from './security/anomaly.js';
import type { DbQuery } from '../tools/types.js';
import type { Store } from './ports.js';
import { redactText } from './redact.js';
import type {
  AutonomyLevel,
  EnvironmentName,
  RiskLevel,
  TaskRecord,
  Permission,
} from './types.js';
import type { ActorContext, ConversationMessage } from './pipeline.js';
import type { SecurityScopeKey } from './security/types.js';
import { resolveToolAuthorization } from './agentAuthority.js';

// ─── Constants ───────────────────────────────────────────────────────
export const FACTORY_MAX_ORCHESTRATION_STEPS = 10;

/** Default total orchestration timeout: 5 minutes. */
export const DEFAULT_ORCHESTRATION_TIMEOUT_MS = 5 * 60 * 1000;
/** Default per-step timeout: 30 seconds. */
export const DEFAULT_STEP_TIMEOUT_MS = 30 * 1000;
/** Maximum allowed step references in a single arg value. */
export const MAX_STEP_REFS_PER_ARG = 5;

// ─── Types ───────────────────────────────────────────────────────────
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type PlanStatus = 'pending' | 'running' | 'completed' | 'failed' | 'partially_completed' | 'cancelled';

/** Regex for valid variable interpolation: $step.N.field where N is an integer. */
const STEP_VAR_PATTERN = /^\$step\.(\d+)\.([a-zA-Z_][a-zA-Z0-9_]*)$/;

export interface OrchestrationStep {
  readonly index: number;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly description: string;
  readonly dependsOn: number[];
  status: StepStatus;
  result?: unknown;
  error?: string;
  taskId?: string;
}

export interface OrchestrationPlan {
  readonly id: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly environment: EnvironmentName;
  readonly steps: OrchestrationStep[];
  readonly correlationId: string;
  readonly createdAt: string;
  status: PlanStatus;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface StepExecutionResult {
  step: OrchestrationStep;
  ok: boolean;
  result?: unknown;
  error?: string;
  taskId?: string;
}

export interface OrchestrationResult {
  ok: boolean;
  planId: string;
  status: PlanStatus;
  stepsCompleted: number;
  stepsFailed: number;
  stepsSkipped: number;
  totalSteps: number;
  stepResults: StepExecutionResult[];
  error?: string;
}

/** Cancellation controller — allows external callers to abort a running orchestration. */
export interface CancellationController {
  readonly cancelled: boolean;
  cancel(): void;
}

export function createCancellationController(): CancellationController {
  let _cancelled = false;
  return {
    get cancelled() { return _cancelled; },
    cancel() { _cancelled = true; },
  };
}

export interface OrchestrationOptions {
  /** Total timeout for the entire orchestration (ms). 0 = no limit. */
  orchestrationTimeoutMs?: number;
  /** Per-step timeout (ms). 0 = no limit. */
  stepTimeoutMs?: number;
  /** External cancellation controller. */
  cancellation?: CancellationController;
  /** If true, skip steps whose dependencies failed instead of aborting. Default: false. */
  continueOnDependencyFailure?: boolean;
  /** If true, retry steps that fail with transient errors (max 1 retry). Default: false. */
  retryTransientFailures?: boolean;
}

// ─── Plan Validation ────────────────────────────────────────────────

/** Validate a single arg value for variable interpolation safety. */
export function validateVariableRef(value: string): { valid: boolean; error?: string } {
  if (!value.startsWith('$step.')) return { valid: true };
  const match = STEP_VAR_PATTERN.exec(value);
  if (!match) {
    return { valid: false, error: `Invalid variable interpolation syntax: "${value}"` };
  }
  return { valid: true };
}

/** Validate all args in a step for variable interpolation safety. Returns errors for the step. */
export function validateStepArgs(step: OrchestrationPlan['steps'][number]): string[] {
  const errors: string[] = [];
  let refCount = 0;
  for (const [key, value] of Object.entries(step.args)) {
    if (typeof value !== 'string') continue;
    const refMatches = value.match(/\$step\.\d+\.\w+/g);
    refCount += refMatches?.length ?? 0;
    if (refCount > MAX_STEP_REFS_PER_ARG * (step.args ? Object.keys(step.args).length : 1)) {
      errors.push(`Step ${step.index}: too many variable references in args`);
      break;
    }
    const result = validateVariableRef(value);
    if (!result.valid) {
      errors.push(`Step ${step.index}: ${result.error}`);
    }
    // Validate dependency index in the variable reference exists
    if (result.valid && refMatches) {
      for (const ref of refMatches) {
        const refMatch = STEP_VAR_PATTERN.exec(ref);
        if (refMatch && refMatch[1] !== undefined) {
          const depIdx = parseInt(refMatch[1], 10);
          if (depIdx < 0 || depIdx >= step.index) {
            // Only allow references to earlier steps (dependencies)
            errors.push(`Step ${step.index}: variable "${ref}" references step ${depIdx} which is not before this step`);
          }
        }
      }
    }
  }
  return errors;
}

export function validatePlan(plan: OrchestrationPlan): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (plan.steps.length === 0) {
    errors.push('Plan has no steps');
    return { valid: false, errors, warnings };
  }

  if (plan.steps.length > FACTORY_MAX_ORCHESTRATION_STEPS) {
    errors.push(`Plan exceeds maximum steps (${plan.steps.length} > ${FACTORY_MAX_ORCHESTRATION_STEPS})`);
  }

  // Validate tool names
  const validToolNames = new Set(GATE3_TOOLS.map((t) => t.name));
  for (const step of plan.steps) {
    if (!validToolNames.has(step.tool)) {
      errors.push(`Step ${step.index}: unknown tool "${step.tool}"`);
    }
  }

  // Validate dependency references
  for (const step of plan.steps) {
    for (const dep of step.dependsOn) {
      if (dep < 0 || dep >= plan.steps.length) {
        errors.push(`Step ${step.index}: invalid dependency index ${dep}`);
      }
      if (dep === step.index) {
        errors.push(`Step ${step.index}: depends on itself`);
      }
    }
  }

  // Validate variable interpolation in args
  for (const step of plan.steps) {
    const argErrors = validateStepArgs(step);
    errors.push(...argErrors);
  }

  // Validate no circular dependencies (topological sort check)
  if (errors.length === 0) {
    const visited = new Set<number>();
    const visiting = new Set<number>();
    const sorted: number[] = [];

    function dfs(idx: number): boolean {
      if (visiting.has(idx)) return false; // cycle
      if (visited.has(idx)) return true;
      const step = plan.steps[idx];
      if (!step) return true;
      visiting.add(idx);
      for (const dep of step.dependsOn) {
        if (!dfs(dep)) return false;
      }
      visiting.delete(idx);
      visited.add(idx);
      sorted.push(idx);
      return true;
    }

    for (const step of plan.steps) {
      if (!dfs(step.index)) {
        errors.push(`Circular dependency detected involving step ${step.index}`);
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Orchestrator ────────────────────────────────────────────────────

export interface OrchestratorContext {
  store: Store;
  actorCtx: ActorContext;
  environment: EnvironmentName;
  projectId: string;
  securityGuardian?: SecurityGuardian;
  rateLimiter?: RateLimiter;
  anomalyDetector?: AnomalyDetector;
  toolDb?: DbQuery;
  conversationHistory?: ConversationMessage[];
  failFast?: boolean; // default: true (abort on first failure)
  /** Gate 11: orchestration-level options. */
  options?: OrchestrationOptions;
}

/** Error thrown when orchestration or step timeout is exceeded. */
export class OrchestrationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestrationTimeoutError';
  }
}

/** Error thrown when orchestration is cancelled. */
export class OrchestrationCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestrationCancelledError';
  }
}

/** Check if the orchestration should be aborted (cancellation or timeout). */
function checkAbortConditions(
  opts: OrchestrationOptions | undefined,
  startTime: number,
  cancellation?: CancellationController,
): void {
  if (cancellation?.cancelled) {
    throw new OrchestrationCancelledError('Orchestration was cancelled');
  }
  if (opts?.orchestrationTimeoutMs && opts.orchestrationTimeoutMs > 0) {
    const elapsed = Date.now() - startTime;
    if (elapsed > opts.orchestrationTimeoutMs) {
      throw new OrchestrationTimeoutError(
        `Orchestration timed out after ${opts.orchestrationTimeoutMs}ms`,
      );
    }
  }
}

/** Execute a promise with a timeout. Resolves with the result or rejects with OrchestrationTimeoutError. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OrchestrationTimeoutError(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Validate a dependency result has the expected shape for variable resolution.
 * Returns true if the result is usable (has data with an id), false otherwise.
 */
function validateDependencyResult(result: unknown, depIndex: number, stepIndex: number): { ok: boolean; error?: string } {
  if (result === null || result === undefined) {
    return { ok: false, error: `Step ${stepIndex}: dependency ${depIndex} result is null/undefined` };
  }
  if (typeof result !== 'object') {
    return { ok: false, error: `Step ${stepIndex}: dependency ${depIndex} result is not an object` };
  }
  const obj = result as Record<string, unknown>;
  if (!('data' in obj)) {
    return { ok: false, error: `Step ${stepIndex}: dependency ${depIndex} result missing "data" field` };
  }
  const data = obj.data;
  if (data === null || data === undefined || typeof data !== 'object') {
    return { ok: false, error: `Step ${stepIndex}: dependency ${depIndex} result.data is not an object` };
  }
  if (!('id' in (data as Record<string, unknown>))) {
    return { ok: false, error: `Step ${stepIndex}: dependency ${depIndex} result.data missing "id" field` };
  }
  return { ok: true };
}

export async function executeOrchestration(
  plan: OrchestrationPlan,
  ctx: OrchestratorContext,
): Promise<OrchestrationResult> {
  const validation = validatePlan(plan);
  if (!validation.valid) {
    return {
      ok: false,
      planId: plan.id,
      status: 'failed',
      stepsCompleted: 0,
      stepsFailed: 0,
      stepsSkipped: 0,
      totalSteps: plan.steps.length,
      stepResults: [],
      error: `Plan validation failed: ${validation.errors.join('; ')}`,
    };
  }

  const opts = ctx.options ?? {};
  const orchestrationTimeoutMs = opts.orchestrationTimeoutMs ?? DEFAULT_ORCHESTRATION_TIMEOUT_MS;
  const stepTimeoutMs = opts.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const cancellation = opts.cancellation;
  const startTime = Date.now();

  plan.status = 'running';

  // Build ToolBroker (validate-only, execute=false)
  const broker = new ToolBroker();
  for (const toolDef of GATE3_TOOLS) {
    const tool: Tool = {
      name: toolDef.name,
      action: toolDef.actionType,
      minRisk: toolDef.riskLevel,
      approvalRequest: toolDef.approvalRequest,
      approvalBound: toolDef.approvalBound,
      run: async (args: Record<string, unknown>) => {
        return toolDef.handler({ ownerId: ctx.actorCtx.ownerId, args, db: ctx.toolDb, store: ctx.store });
      },
    };
    broker.register(tool);
  }

  // Build security guard hook
  const securityGuardHook = ctx.securityGuardian
    ? async (request: { tool: string; args: Record<string, unknown>; actorId: string; actorType: string; projectId: string | null; environment: string; risk: string }): Promise<{ allowed: boolean; decision?: string; reason?: string; evidence?: string[] }> => {
        const toolDef = GATE3_TOOLS.find((t) => t.name === request.tool);
        const actionType = toolDef?.actionType ?? 'read';
        const permission = (toolDef?.riskLevel === 'low' || toolDef?.riskLevel === 'medium') ? 'read' : 'write';
        const resolvedAuth = await resolveToolAuthorization({
          store: ctx.store,
          actorId: ctx.actorCtx.actorId,
          actorType: ctx.actorCtx.actorType,
          ownerId: ctx.actorCtx.ownerId,
          agentId: ctx.actorCtx.agentId ?? null,
          projectId: ctx.projectId,
          environment: (request.environment ?? ctx.environment) as EnvironmentName,
          resourceType: 'tool',
          permission,
          actionType,
          risk: (request.risk ?? 'low') as RiskLevel,
          explicitDeny: false,
        });
        const result = await ctx.securityGuardian!.evaluate({
          ownerId: ctx.actorCtx.ownerId,
          actorId: ctx.actorCtx.actorId,
          actorType: ctx.actorCtx.actorType as 'owner' | 'agent',
          agentId: ctx.actorCtx.agentId ?? null,
          projectId: ctx.projectId,
          environment: (request.environment ?? ctx.environment) as EnvironmentName,
          grantedEnvironments: [(request.environment ?? ctx.environment) as EnvironmentName],
          resourceType: 'tool',
          resourceId: request.tool,
          actionType,
          permission: permission as Permission,
          risk: request.risk as RiskLevel,
          authorized: resolvedAuth.authorized,
          explicitDeny: false,
          authorityOutcome: 'auto',
          scope: 'tool',
          correlationId: plan.correlationId,
          taskId: null,
          evidence: resolvedAuth.evidence,
        });
        return {
          allowed: !result.denied,
          decision: result.decision,
          reason: result.reason,
          evidence: result.evidence,
        };
      }
    : undefined;

  // Track which steps completed for dependency resolution
  const completedSteps = new Map<number, unknown>();
  const stepResults: StepExecutionResult[] = [];
  let stepsCompleted = 0;
  let stepsFailed = 0;
  let stepsSkipped = 0;
  const failFast = ctx.failFast !== false;
  const warnings: string[] = [];

  // Build variable context from completed steps for arg interpolation
  function resolveArgs(args: Record<string, unknown>): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.startsWith('$step.') && value.endsWith('.id')) {
        const stepIdx = parseInt(value.slice(6, -3), 10);
        const stepResult = completedSteps.get(stepIdx);
        if (stepResult && typeof stepResult === 'object' && stepResult !== null && 'data' in stepResult) {
          const data = (stepResult as { data: unknown }).data;
          if (data && typeof data === 'object' && 'id' in (data as Record<string, unknown>)) {
            resolved[key] = (data as Record<string, unknown>).id;
          } else {
            resolved[key] = value; // keep unresolved
          }
        } else {
          resolved[key] = value; // keep unresolved
        }
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  /** Helper to build the result object with current counters. */
  function buildResult(ok: boolean, error?: string): OrchestrationResult {
    return {
      ok,
      planId: plan.id,
      status: plan.status,
      stepsCompleted,
      stepsFailed,
      stepsSkipped,
      totalSteps: plan.steps.length,
      stepResults,
      error,
    };
  }

  /** Mark plan as failed and return result. */
  function failPlan(error: string): OrchestrationResult {
    plan.status = 'failed';
    return buildResult(false, error);
  }

  /** Mark plan as cancelled and return result. */
  function cancelPlan(error: string): OrchestrationResult {
    plan.status = 'cancelled';
    // Mark remaining pending steps as skipped
    for (const step of plan.steps) {
      if (step.status === 'pending') {
        step.status = 'skipped';
        stepsSkipped++;
        stepResults.push({ step, ok: false, error: 'Cancelled' });
      }
    }
    return buildResult(false, error);
  }

  /** Execute a single step with timeout and cancellation checks. */
  async function executeStep(step: OrchestrationStep): Promise<boolean> {
    // Check abort conditions before starting the step
    checkAbortConditions(opts, startTime, cancellation);

    // Check dependencies
    const depsMet = step.dependsOn.every((dep) => completedSteps.has(dep));
    if (!depsMet) {
      if (opts.continueOnDependencyFailure) {
        // Continue despite unmet dependencies — log warning
        warnings.push(`Step ${step.index}: dependencies not met but continuing due to continueOnDependencyFailure`);
      } else {
        step.status = 'skipped';
        stepsSkipped++;
        stepResults.push({ step, ok: false, error: 'Dependencies not met' });
        if (failFast) return false;
        return true;
      }
    }

    // Check if dependencies failed (skip this step if any dependency failed)
    const depsFailed = step.dependsOn.some((dep) => {
      const result = stepResults.find((r) => r.step.index === dep);
      return result && !result.ok;
    });
    if (depsFailed) {
      if (opts.continueOnDependencyFailure) {
        // Continue despite dependency failure — log warning
        warnings.push(`Step ${step.index}: dependency failed but continuing due to continueOnDependencyFailure`);
      } else {
        step.status = 'skipped';
        stepsSkipped++;
        stepResults.push({ step, ok: false, error: 'Dependency failed' });
        if (failFast) return false;
        return true;
      }
    }

    // Validate dependency result integrity before resolving args (only if step uses $step. refs)
    const hasStepRefs = Object.values(step.args).some(
      (v) => typeof v === 'string' && v.startsWith('$step.'),
    );
    if (hasStepRefs) {
      for (const dep of step.dependsOn) {
        const depResult = completedSteps.get(dep);
        const integrity = validateDependencyResult(depResult, dep, step.index);
        if (!integrity.ok) {
          step.status = 'skipped';
          stepsSkipped++;
          stepResults.push({ step, ok: false, error: integrity.error });
          if (failFast) return false;
          return true;
        }
      }
    }

    // Resolve arguments (replace $step.N.id references)
    const resolvedArgs = resolveArgs(step.args);

    // Find tool definition
    const toolDef = GATE3_TOOLS.find((t) => t.name === step.tool);
    if (!toolDef) {
      step.status = 'failed';
      step.error = `Unknown tool: ${step.tool}`;
      stepsFailed++;
      stepResults.push({ step, ok: false, error: step.error });
      if (failFast) return false;
      return true;
    }

    // Rate limit check
    if (ctx.rateLimiter) {
      const modelLimit = ctx.rateLimiter.check(ctx.actorCtx.ownerId, 'model' as SecurityScopeKey, 'model.call');
      if (!modelLimit.allowed) {
        step.status = 'failed';
        step.error = `Rate limit exceeded: ${modelLimit.limit} per ${Math.round(modelLimit.windowMs / 1000)}s`;
        stepsFailed++;
        stepResults.push({ step, ok: false, error: step.error });
        return false; // always abort on rate limit
      }
    }

    step.status = 'running';

    // Authority resolution
    const toolRisk = toolDef.riskLevel;
    const toolActionType = toolDef.actionType;
    const toolPermission = (toolRisk === 'low' || toolRisk === 'medium') ? 'read' : 'write';
    const toolRiskLevel = riskFromAction(toolActionType, ctx.environment);
    const toolAuth = ctx.actorCtx.actorType === 'owner'
      ? { authorized: true, reason: 'owner always authorized on own projects' }
      : await resolveToolAuthorization({
          store: ctx.store,
          actorId: ctx.actorCtx.actorId,
          actorType: ctx.actorCtx.actorType,
          ownerId: ctx.actorCtx.ownerId,
          agentId: ctx.actorCtx.agentId ?? null,
          projectId: ctx.projectId,
          environment: ctx.environment,
          resourceType: 'tool',
          permission: toolPermission,
          actionType: toolActionType,
          risk: toolRiskLevel,
          explicitDeny: false,
        });
    const toolAuthority = evaluateAuthority({
      actorId: ctx.actorCtx.actorId,
      actorType: ctx.actorCtx.actorType as 'owner' | 'agent',
      projectId: ctx.projectId,
      environment: ctx.environment,
      resourceType: 'tool',
      permission: toolPermission as Permission,
      risk: toolRiskLevel,
      actionType: toolActionType,
      authorized: toolAuth.authorized,
      explicitDeny: false,
    });

    // ToolBroker validation
    const brokerResult = await broker.call(
      {
        tool: step.tool,
        args: resolvedArgs,
        actorId: ctx.actorCtx.actorId,
        actorType: ctx.actorCtx.actorType,
        projectId: ctx.projectId,
        environment: ctx.environment,
        risk: toolDef.riskLevel,
      },
      {
        decision: toolAuthority.outcome,
        approved: toolAuthority.outcome !== 'deny' && toolAuthority.outcome !== 'require_approval',
        securityGuard: securityGuardHook,
        execute: false, // G5-01: validate only
      },
    );

    if (!brokerResult.ok) {
      step.status = 'failed';
      step.error = `Security/authority denied: ${brokerResult.outcome}`;
      stepsFailed++;
      stepResults.push({ step, ok: false, error: step.error });
      ctx.anomalyDetector?.note('toolAnomalies');
      if (failFast) return false;
      return true;
    }

    // Execute tool handler with step timeout (G11-03)
    const maxAttempts = opts.retryTransientFailures ? 2 : 1;
    let lastError: string = '';
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Check abort conditions before handler execution
        checkAbortConditions(opts, startTime, cancellation);

        const handlerPromise = toolDef.handler({
          ownerId: ctx.actorCtx.ownerId,
          args: resolvedArgs,
          db: ctx.toolDb,
          store: ctx.store,
        });

        const handlerResult = await withTimeout(
          handlerPromise,
          stepTimeoutMs,
          `Step ${step.index} (${step.tool})`,
        );

        // Check handler result success field (not all handlers throw on failure)
        const handlerSuccess = handlerResult && typeof handlerResult === 'object' && 'success' in handlerResult
          ? (handlerResult as { success: boolean }).success
          : true;
        if (!handlerSuccess) {
          const errorMsg = handlerResult && typeof handlerResult === 'object' && 'error' in handlerResult
            ? String((handlerResult as { error: unknown }).error)
            : 'handler returned success=false';
          lastError = errorMsg;
          if (attempt < maxAttempts - 1) continue; // retry
          step.status = 'failed';
          step.error = errorMsg;
          stepsFailed++;
          stepResults.push({ step, ok: false, error: errorMsg });
          ctx.anomalyDetector?.note('toolAnomalies');
          if (failFast) return false;
          return true;
        }

        step.status = 'completed';
        step.result = handlerResult;
        completedSteps.set(step.index, handlerResult);
        stepsCompleted++;
        stepResults.push({ step, ok: true, result: handlerResult });
        return true;
      } catch (e) {
        lastError = String(e);
        // Don't retry on cancellation or timeout from orchestration level
        if (e instanceof OrchestrationCancelledError || e instanceof OrchestrationTimeoutError) {
          throw e;
        }
        // For step-level timeout, don't retry (it's a real timeout)
        if (e instanceof OrchestrationTimeoutError) {
          throw e;
        }
        if (attempt < maxAttempts - 1) continue; // retry
        step.status = 'failed';
        step.error = lastError;
        stepsFailed++;
        stepResults.push({ step, ok: false, error: step.error });
        ctx.anomalyDetector?.note('toolAnomalies');
        if (failFast) return false;
        return true;
      }
    }

    // Should not reach here, but handle gracefully
    step.status = 'failed';
    step.error = lastError || 'Unknown error after retries';
    stepsFailed++;
    stepResults.push({ step, ok: false, error: step.error });
    if (failFast) return false;
    return true;
  }

  // Execute steps with orchestration-level timeout
  try {
    for (const step of plan.steps) {
      const shouldContinue = await executeStep(step);
      if (!shouldContinue && failFast) {
        return failPlan(`Step ${step.index} failed: ${stepResults[stepResults.length - 1]?.error ?? 'unknown'}`);
      }
    }
  } catch (e) {
    if (e instanceof OrchestrationCancelledError) {
      return cancelPlan(e.message);
    }
    if (e instanceof OrchestrationTimeoutError) {
      return failPlan(e.message);
    }
    return failPlan(`Orchestration error: ${String(e)}`);
  }

  // Determine final status
  if (stepsFailed === 0 && stepsSkipped === 0) {
    plan.status = 'completed';
  } else if (stepsCompleted > 0) {
    plan.status = 'partially_completed';
  } else {
    plan.status = 'failed';
  }

  return buildResult(stepsFailed === 0);
}

// ─── Plan Creation ───────────────────────────────────────────────────

export function createPlan(
  ownerId: string,
  projectId: string,
  environment: EnvironmentName,
  steps: Array<{ tool: string; args: Record<string, unknown>; description: string; dependsOn: number[] }>,
  correlationId: string,
): OrchestrationPlan {
  return {
    id: randomUUID(),
    ownerId,
    projectId,
    environment,
    steps: steps.map((s, i) => ({
      index: i,
      tool: s.tool,
      args: s.args,
      description: s.description,
      dependsOn: s.dependsOn,
      status: 'pending' as StepStatus,
    })),
    correlationId,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
}

// ─── Multi-Step Detection ───────────────────────────────────────────

const SEQUENCE_MARKERS = /\b(then|next|after|finally|first|second|third|also|and\s+then|followed\s+by)\b/i;
const COMMA_SEPARATED_ACTIONS = /,\s*(create|add|update|delete|list|set|assign|deploy|execute)\b/i;

export function detectMultiStepCommand(raw: string): boolean {
  // Heuristic: command has sequencing markers or comma-separated actions
  if (SEQUENCE_MARKERS.test(raw)) return true;
  if (COMMA_SEPARATED_ACTIONS.test(raw)) return true;
  // Count action verbs: if more than one, likely multi-step
  const verbPattern = /\b(create|add|update|delete|list|set|assign|deploy|execute|plan|research)\b/gi;
  const matches = raw.match(verbPattern);
  return (matches?.length ?? 0) > 1;
}
