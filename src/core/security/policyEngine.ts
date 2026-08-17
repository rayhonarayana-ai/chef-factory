// CHEF FACTORY — Gate 2 — Security Policy Engine.
// Deterministic decision chain:
//   REQUEST → IDENTITY → PROJECT → ENVIRONMENT → AGENT → PERMISSION →
//   ACTION CLASSIFICATION → RISK → SECURITY POLICY → AUTONOMY POLICY → DECISION → AUDIT
// Precedence: LOCKDOWN > DENY > REQUIRE_APPROVAL > NOTIFY > ALLOW.
// The Security Guardian may ONLY make a decision MORE restrictive than Gate 1.

import { classifyCriticalAction } from './criticalActions.js';
import type { SecurityDecision, SecurityRequest } from './types.js';
import type { AutonomyLevel, EnvironmentName } from '../types.js';
import { SECURITY_PRECEDENCE } from './types.js';

export interface PolicyEvaluation {
  decision: SecurityDecision;
  rules: string[];
  reason: string;
  denyReason: string | null; // why denied (for audit/explanation)
}

export function moreRestrictive(a: SecurityDecision, b: SecurityDecision): SecurityDecision {
  return SECURITY_PRECEDENCE[a] >= SECURITY_PRECEDENCE[b] ? a : b;
}

/** Combine a Gate 1 authority level with a Security Guardian decision.
 *  The result is never less restrictive than the authority outcome. */
export function combineAuthority(
  authority: AutonomyLevel,
  security: SecurityDecision,
): { finalAutonomy: AutonomyLevel; finalDecision: SecurityDecision } {
  const map: Record<SecurityDecision, AutonomyLevel> = {
    allow: authority === 'deny' ? 'deny' : authority,
    notify: authority === 'deny' || authority === 'require_approval' ? authority : 'notify',
    require_approval: 'require_approval',
    deny: 'deny',
    lockdown: 'deny', // pipeline maps lockdown to blocked/deny — fail closed
  };
  return { finalAutonomy: map[security], finalDecision: security };
}

export interface PolicyEngineInput {
  request: SecurityRequest;
  lockdownActive: boolean;
  criticalDecision: SecurityDecision | null; // from Critical Action Registry (already computed)
  environmentIsolation: { escalated: boolean; reason: string | null };
  crossProject: { crossed: boolean; reason: string | null };
  rateLimited: { limited: boolean; scope: string | null; reason: string | null };
  costStopped: { stopped: boolean; reason: string | null };
  untrustedAuthorityDirective: { present: boolean; matches: string[] };
}

export function evaluatePolicy(input: PolicyEngineInput): PolicyEvaluation {
  const rules: string[] = [];
  const { request } = input;

  // 1. LOCKDOWN — highest precedence; fail closed.
  if (input.lockdownActive) {
    return {
      decision: 'lockdown',
      rules: ['rule.lockdown_active'],
      reason: 'Emergency lockdown is active — all execution is suspended.',
      denyReason: 'Emergency lockdown active.',
    };
  }

  // 2. CRITICAL ACTION default decision (never weakened for agents or owners).
  if (input.criticalDecision !== null) {
    rules.push('rule.critical_action_default');
    if (input.criticalDecision === 'deny') {
      return { decision: 'deny', rules, reason: 'Critical action is denied by the Critical Action Registry.', denyReason: 'Critical action default DENY.' };
    }
    // require_approval → continues through remaining checks but can only get stricter.
  }

  // 3. Environment isolation — explicit DENY on silent escalation.
  if (input.environmentIsolation.escalated) {
    rules.push('rule.environment_isolation');
    return {
      decision: 'deny',
      rules,
      reason: `Environment escalation blocked: ${input.environmentIsolation.reason ?? 'no authority for requested environment'}.`,
      denyReason: 'Environment escalation without explicit authority.',
    };
  }

  // 4. Cross-project access — DENY by default.
  if (input.crossProject.crossed) {
    rules.push('rule.cross_project_deny');
    return {
      decision: 'deny',
      rules,
      reason: `Cross-project access denied: ${input.crossProject.reason ?? 'project not in actor scope'}.`,
      denyReason: 'Cross-project access denied by default.',
    };
  }

  // 5. Rate limits — deterministic runaway prevention.
  if (input.rateLimited.limited) {
    rules.push('rule.rate_limit');
    return {
      decision: 'deny',
      rules,
      reason: `Rate limit exceeded (${input.rateLimited.scope ?? 'unknown'}): ${input.rateLimited.reason ?? 'limit reached'}.`,
      denyReason: 'Rate limit exceeded.',
    };
  }

  // 6. Cost protection — deterministic hard stop.
  if (input.costStopped.stopped) {
    rules.push('rule.cost_protection');
    return {
      decision: 'deny',
      rules,
      reason: `Cost protection stopped execution: ${input.costStopped.reason ?? 'hard limit reached'}.`,
      denyReason: 'Cost hard limit reached.',
    };
  }

  // 7. G5-04: Prompt injection — confirmed malicious directives produce DENY.
  // When untrusted input contains authority-override directives, block the action.
  if (input.untrustedAuthorityDirective.present && input.untrustedAuthorityDirective.matches.length > 0) {
    rules.push('rule.prompt_injection_deny');
    return {
      decision: 'deny',
      rules,
      reason: `Prompt injection detected: ${input.untrustedAuthorityDirective.matches.join(', ')}. Untrusted authority directives are denied.`,
      denyReason: 'Confirmed prompt injection — untrusted authority directive.',
    };
  }

  // 8. Critical action default require_approval (never reduced to allow).
  if (input.criticalDecision === 'require_approval') {
    rules.push('rule.critical_action_require_approval');
    return { decision: 'require_approval', rules, reason: 'Critical action requires approval.', denyReason: null };
  }

  // 9. Production write/execute — policy floor require_approval.
  if (request.environment === 'production' && (request.permission === 'write' || request.permission === 'execute')) {
    rules.push('rule.production_write_execute');
    return { decision: 'require_approval', rules, reason: 'Production write/execute requires approval.', denyReason: null };
  }

  // 10. Staging write/execute — policy floor notify.
  if (request.environment === 'staging' && (request.permission === 'write' || request.permission === 'execute')) {
    rules.push('rule.staging_write_execute');
    return { decision: 'notify', rules, reason: 'Staging write/execute runs with NOTIFY.', denyReason: null };
  }

  // 11. Deny unless authorized (least privilege).
  if (!request.authorized) {
    rules.push('rule.not_authorized');
    return { decision: 'deny', rules, reason: 'Actor is not authorized for this action.', denyReason: 'Not authorized.' };
  }

  // 12. Explicit owner DENY — always wins.
  if (request.explicitDeny) {
    rules.push('rule.explicit_deny');
    return { decision: 'deny', rules, reason: 'Explicit owner DENY policy.', denyReason: 'Explicit owner DENY.' };
  }

  // 13. Default: ALLOW subject to authority (Gate 1 remains the floor).
  rules.push('rule.default_allow');
  return { decision: 'allow', rules, reason: 'No security policy restriction; Gate 1 authority applies.', denyReason: null };
}

// ---------- Environment isolation helpers ----------
export function environmentRank(e: EnvironmentName): number {
  return e === 'development' ? 0 : e === 'staging' ? 1 : 2;
}

/** An agent granted only lower environments attempting a higher one is an
 *  environment escalation (requires explicit authority). */
export function detectEnvironmentEscalation(
  environment: EnvironmentName,
  grantedEnvironments: EnvironmentName[] | undefined,
  actorType: 'owner' | 'agent',
): { escalated: boolean; reason: string | null } {
  if (actorType === 'owner') return { escalated: false, reason: null };
  if (!grantedEnvironments || grantedEnvironments.length === 0) {
    // No grant → escalation only if the requested env is higher than development.
    return { escalated: environment !== 'development', reason: environment !== 'development' ? 'no environment grant held' : null };
  }
  const highest = Math.max(...grantedEnvironments.map(environmentRank));
  if (environmentRank(environment) > highest) {
    return { escalated: true, reason: `requested ${environment}, highest granted is ${grantedEnvironments.map((e) => e).sort((a, b) => environmentRank(a) - environmentRank(b))[highest] ?? 'unknown'}` };
  }
  return { escalated: false, reason: null };
}

/** An agent whose project scope is a single project accessing another project is
 *  cross-project access — denied by default. */
export function detectCrossProject(
  projectId: string | null,
  requestedProjectId: string | null | undefined,
  actorType: 'owner' | 'agent',
): { crossed: boolean; reason: string | null } {
  if (actorType === 'owner') return { crossed: false, reason: null };
  if (requestedProjectId === undefined || requestedProjectId === null || requestedProjectId === projectId) {
    return { crossed: false, reason: null };
  }
  return { crossed: true, reason: `requested project ${requestedProjectId} differs from scoped project ${projectId ?? '(none)'}` };
}

export { classifyCriticalAction };
