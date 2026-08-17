// CHEF FACTORY — Gate 2 — Security Guardian (deterministic security boundary).
// Orchestrates the full chain for every security-sensitive action:
//   REQUEST → IDENTITY → PROJECT → ENVIRONMENT → AGENT → PERMISSION →
//   ACTION CLASSIFICATION → RISK → SECURITY POLICY → AUTONOMY POLICY →
//   DECISION → AUDIT
// LLMs may assist with analysis but are NEVER the final authority. All decisions
// here are deterministic. The Guardian may only be MORE restrictive than Gate 1.

import { classifyCriticalAction } from './criticalActions.js';
import { evaluatePolicy, detectCrossProject, detectEnvironmentEscalation } from './policyEngine.js';
import type { RateLimiter } from './rateLimit.js';
import type { AnomalyDetector } from './anomaly.js';
import { assessUntrustedInput } from './promptInjection.js';
import { redactText } from '../redact.js';
import type { SecurityDecision, SecurityEventInput, SecurityGuardResult, SecurityLockdownRecord, SecurityRequest } from './types.js';

export interface CostCheck {
  (ownerId: string, projectId: string | null): Promise<{ stopped: boolean; reason: string | null }>;
}

export interface GuardianDeps {
  lockdown: (ownerId: string) => SecurityLockdownRecord | null | Promise<SecurityLockdownRecord | null>;
  rateLimiter: RateLimiter;
  anomaly: AnomalyDetector;
  recordEvent: (event: SecurityEventInput) => void | Promise<void>;
  costCheck?: CostCheck;
}

export class SecurityGuardian {
  constructor(private readonly deps: GuardianDeps) {}

  /** Evaluate a security request. Deterministic. Emits events via deps.recordEvent. */
  async evaluate(req: SecurityRequest): Promise<SecurityGuardResult> {
    const events: SecurityEventInput[] = [];
    const rules: string[] = [];
    const evidence: string[] = [...(req.evidence ?? [])];
    const base: Omit<SecurityEventInput, 'eventType' | 'action' | 'reason' | 'decision' | 'severity'> = {
      ownerId: req.ownerId,
      projectId: req.projectId,
      agentId: req.agentId ?? null,
      taskId: req.taskId ?? null,
      environment: req.environment,
      correlationId: req.correlationId ?? undefined,
    };

    const emit = (event: SecurityEventInput): void => {
      events.push(event);
      void this.deps.recordEvent(event);
    };

    // 1. Lockdown — fail closed, top precedence.
    const lockdown = await this.deps.lockdown(req.ownerId);
    if (lockdown && lockdown.status === 'active') {
      const reason = `Emergency lockdown active (scope=${lockdown.scope}): ${redactText(lockdown.reason)}`;
      emit({ ...base, eventType: 'health.lockdown', severity: 'critical', action: 'guard.lockdown', resource: req.resourceId ?? null, decision: 'lockdown', reason });
      return {
        decision: 'lockdown',
        finalAutonomy: 'deny',
        reason,
        rules: ['rule.lockdown_active'],
        evidence: [`lockdown=${lockdown.lockdownId}`],
        events,
        denied: true,
      };
    }

    // 2. Critical Action Registry.
    const criticalMatch = classifyCriticalAction(req.actionType, req.environment);
    let criticalDecision: SecurityDecision | null = null;
    if (criticalMatch) {
      criticalDecision = criticalMatch.rule.defaultDecision;
      rules.push(`rule.critical.${criticalMatch.rule.action}`);
      evidence.push(`critical_action=${criticalMatch.rule.action}@v${criticalMatch.version}`);
      if (criticalDecision === 'deny') {
        emit({ ...base, eventType: 'denied.critical', severity: 'critical', action: req.actionType, resource: req.resourceId ?? null, decision: 'deny', reason: `critical action ${req.actionType} denied by registry` });
      }
    }

    // 3. Environment isolation.
    const envIsolation = detectEnvironmentEscalation(req.environment, req.grantedEnvironments, req.actorType);
    if (envIsolation.escalated) {
      emit({ ...base, eventType: 'denied.environment_escalation', severity: 'high', action: req.actionType, resource: req.resourceId ?? null, decision: 'deny', reason: envIsolation.reason ?? 'environment escalation' });
      evidence.push('environment_escalation');
    }

    // 4. Cross-project isolation.
    const crossProject = detectCrossProject(req.projectId, req.requestedProjectId, req.actorType);
    if (crossProject.crossed) {
      emit({ ...base, eventType: 'denied.cross_project', severity: 'high', action: req.actionType, resource: req.resourceId ?? null, decision: 'deny', reason: crossProject.reason ?? 'cross-project access' });
      evidence.push('cross_project');
    }

    // 5. Rate limits per scope.
    let rateLimited: { limited: boolean; scope: string | null; reason: string | null } = { limited: false, scope: null, reason: null };
    if (req.scope) {
      const limitKey = this.limitKeyFor(req);
      const decision = this.deps.rateLimiter.check(req.ownerId, req.scope, limitKey);
      if (!decision.allowed) {
        rateLimited = { limited: true, scope: `${req.scope}:${limitKey}`, reason: `limit ${decision.limit} reached; retry in ${Math.ceil((decision.retryAfterMs ?? 0) / 1000)}s` };
        emit({ ...base, eventType: 'denied.rate_limit', severity: 'high', action: req.actionType, resource: req.resourceId ?? null, decision: 'deny', reason: rateLimited.reason ?? 'rate limit exceeded' });
        evidence.push(`rate_limit=${limitKey}`);
      }
    }

    // 6. Cost protection.
    let costStopped: { stopped: boolean; reason: string | null } = { stopped: false, reason: null };
    if (this.deps.costCheck) {
      costStopped = await this.deps.costCheck(req.ownerId, req.projectId);
      if (costStopped.stopped) {
        emit({ ...base, eventType: 'denied.cost', severity: 'critical', action: req.actionType, resource: req.resourceId ?? null, decision: 'deny', reason: costStopped.reason ?? 'cost hard limit' });
        evidence.push('cost_hard_limit');
      }
    }

    // 7. Prompt injection / untrusted input — always DATA, never authority.
    let untrustedDirective: { present: boolean; matches: string[] } = { present: false, matches: [] };
    if (req.untrustedInput) {
      const assessment = assessUntrustedInput(req.untrustedInput);
      untrustedDirective = { present: assessment.authorityDirectives.length > 0, matches: assessment.authorityDirectives };
      if (untrustedDirective.present) {
        evidence.push('untrusted_authority_directive');
        evidence.push(...assessment.authorityDirectives.map((m) => `directive=${redactText(m)}`));
      }
    }

    // 8. Policy evaluation.
    const policy = evaluatePolicy({
      request: req,
      lockdownActive: false,
      criticalDecision,
      environmentIsolation: envIsolation,
      crossProject,
      rateLimited,
      costStopped,
      untrustedAuthorityDirective: untrustedDirective,
    });

    // 9. Combine with Gate 1 authority outcome — never less restrictive.
    const securityDecision: SecurityDecision = policy.decision;
    const finalAutonomy = guardianCombineAuthority(req.authorityOutcome ?? 'notify', securityDecision);

    // 10. Anomaly notes + events.
    this.noteAnomalies(req, policy.decision, envIsolation.escalated, crossProject.crossed, rateLimited.limited, costStopped.stopped, emit, base);

    // 11. Record final deny/approval events.
    if (policy.decision === 'deny' && !criticalMatch) {
      emit({ ...base, eventType: 'denied.action', severity: 'high', action: req.actionType, resource: req.resourceId ?? null, decision: 'deny', reason: policy.reason });
    } else if (policy.decision === 'require_approval' && criticalMatch) {
      emit({ ...base, eventType: 'require_approval.critical', severity: 'high', action: req.actionType, resource: req.resourceId ?? null, decision: 'require_approval', reason: policy.reason });
    }

    return {
      decision: securityDecision,
      finalAutonomy,
      reason: policy.reason,
      rules: [...rules, ...policy.rules],
      evidence,
      events,
      denied: policy.decision === 'deny' || policy.decision === 'lockdown',
    };
  }

  private limitKeyFor(req: SecurityRequest): string {
    const map: Record<string, string> = {
      task: 'task.execute',
      tool: 'tool.call',
      runtime: 'runtime.execute',
      model: 'model.call',
      auth: 'auth.failure',
      approval: 'approval.request',
      failure: 'task.failure',
      data_query: 'data_query.count',
    };
    return map[req.scope ?? ''] ?? `${req.scope}.${req.actionType}`;
  }

  private noteAnomalies(
    req: SecurityRequest,
    decision: SecurityDecision,
    envEscalated: boolean,
    crossProject: boolean,
    rateLimited: boolean,
    costStopped: boolean,
    emit: (e: SecurityEventInput) => void,
    base: Omit<SecurityEventInput, 'eventType' | 'action' | 'reason' | 'decision' | 'severity'>,
  ): void {
    if (decision === 'deny' || decision === 'lockdown') {
      const signal = this.deps.anomaly.note('deniedActions');
      if (signal) emit({ ...base, eventType: 'anomaly.repeated_denial', severity: 'medium', action: req.actionType, resource: req.resourceId ?? null, decision, reason: signal.reason, metadata: { indicator: signal.indicator, metric: signal.metric, threshold: signal.threshold } });
    }
    if (envEscalated) {
      const signal = this.deps.anomaly.note('environmentEscalations');
      if (signal) emit({ ...base, eventType: 'anomaly.environment_escalation', severity: 'medium', action: req.actionType, resource: req.resourceId ?? null, decision: 'deny', reason: signal.reason });
    }
    if (crossProject) {
      const signal = this.deps.anomaly.note('projectSwitches');
      if (signal) emit({ ...base, eventType: 'anomaly.project_switching', severity: 'medium', action: req.actionType, resource: req.resourceId ?? null, decision: 'deny', reason: signal.reason });
    }
    if (rateLimited) {
      const signal = this.deps.anomaly.note('policyViolations');
      if (signal) emit({ ...base, eventType: 'anomaly.policy_violations', severity: 'medium', action: req.actionType, resource: req.resourceId ?? null, decision: 'deny', reason: signal.reason });
    }
    if (costStopped) {
      const signal = this.deps.anomaly.note('costSpikes');
      if (signal) emit({ ...base, eventType: 'anomaly.cost_spike', severity: 'medium', action: req.actionType, resource: req.resourceId ?? null, decision: 'deny', reason: signal.reason });
    }
  }
}

/** Combine the Guardian decision with the Gate 1 authority outcome.
 *  Security precedence: LOCKDOWN > DENY > REQUIRE_APPROVAL > NOTIFY > ALLOW.
 *  The result is never less restrictive than the Gate 1 authority outcome. */
import { combineAuthority } from './policyEngine.js';
import type { AutonomyLevel } from '../types.js';

export function guardianCombineAuthority(authority: AutonomyLevel, security: SecurityDecision): AutonomyLevel {
  return combineAuthority(authority, security).finalAutonomy;
}
