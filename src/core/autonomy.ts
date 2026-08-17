// CHEF FACTORY — Gate 1 — Adaptive Autonomy Controller.
// Bounded escalation: historical success never grants unlimited authority.
// Protected classes and DENY can never be downgraded by success.

import { PROTECTED_ACTION_TYPES } from './authority.js';
import type { AutonomyDecision, AutonomyInput, AutonomyLevel } from './types.js';

// Deterministic thresholds for bounded escalation.
export const ESCALATION_MIN_SUCCESS_RATE = 0.8;
export const ESCALATION_MIN_HISTORY = 5;

export function evaluateAutonomy(input: AutonomyInput): AutonomyDecision {
  const evidence: string[] = [];
  const authorityOutcome = input.authority.outcome;

  // DENY always wins — cannot be overridden by autonomy.
  if (authorityOutcome === 'deny') {
    return {
      selected: 'deny',
      reason: 'Authority matrix returned DENY; autonomy cannot override.',
      evidence: ['authority=deny'],
    };
  }

  // Owner policy (explicit) is respected, but never above DENY/protection.
  if (input.ownerPolicy && input.ownerPolicy !== 'deny') {
    evidence.push(`owner_policy=${input.ownerPolicy}`);
    return { selected: input.ownerPolicy, reason: 'Explicit owner autonomy policy applied.', evidence };
  }

  // Protected classes stay REQUIRE_APPROVAL regardless of history.
  if (PROTECTED_ACTION_TYPES.has(input.authority.actionType ?? '')) {
    return {
      selected: 'require_approval',
      reason: 'Protected action class cannot be escalated to full autonomy.',
      evidence: ['protected_action_class', `authority=${authorityOutcome}`],
    };
  }

  // REQUIRE_APPROVAL from authority stays (never downgraded by success).
  if (authorityOutcome === 'require_approval') {
    return {
      selected: 'require_approval',
      reason: 'Authority requires approval; autonomy does not downgrade protection.',
      evidence: ['authority=require_approval'],
    };
  }

  // AUTO stays AUTO.
  if (authorityOutcome === 'auto') {
    return {
      selected: 'auto',
      reason: 'Authority granted full auto; autonomy confirms.',
      evidence: ['authority=auto'],
    };
  }

  // NOTIFY: bounded, one-step escalation to AUTO on strong, repeated success.
  if (authorityOutcome === 'notify') {
    const strong = input.successRate >= ESCALATION_MIN_SUCCESS_RATE && input.historyCount >= ESCALATION_MIN_HISTORY;
    evidence.push(`success_rate=${input.successRate.toFixed(2)}`);
    evidence.push(`history_count=${input.historyCount}`);
    if (strong) {
      return {
        selected: 'auto',
        reason: 'Strong repeated success enables one-step escalation to AUTO (bounded).',
        evidence,
      };
    }
    return {
      selected: 'notify',
      reason: 'Insufficient track record for escalation; stays NOTIFY.',
      evidence,
    };
  }

  // Safety net — unknown outcomes fall back to REQUIRE_APPROVAL.
  return {
    selected: 'require_approval',
    reason: 'Unresolved autonomy outcome falls back to REQUIRE_APPROVAL.',
    evidence: ['unresolved'],
  };
}
