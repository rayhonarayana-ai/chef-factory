// CHEF FACTORY — Gate 1 — Authority Matrix.
// Deterministic mapping: WHO/WHAT/WHERE/PROJECT/ENVIRONMENT/PERMISSION → outcome.
// Outcomes: AUTO | NOTIFY | REQUIRE_APPROVAL | DENY. Explicit DENY always wins.
// Production-sensitive, destructive, financial, legal and account-security actions
// default to REQUIRE_APPROVAL.

import type {
  AuthorityDecision,
  AuthorityRequest,
  AutonomyLevel,
  RiskLevel,
} from './types.js';

// Action classes that are always protected (default REQUIRE_APPROVAL).
export const PROTECTED_ACTION_TYPES = new Set([
  'delete',
  'deploy',
  'financial',
  'legal',
  'account_security',
  'credit',
]);

export function riskFromAction(actionType: string, environment: string): RiskLevel {
  const isProd = environment === 'production';
  if (actionType === 'delete') return 'high';
  if (actionType === 'deploy') return isProd ? 'critical' : 'high';
  if (actionType === 'financial' || actionType === 'legal' || actionType === 'account_security') return 'critical';
  if (actionType === 'execute') return isProd ? 'high' : 'medium';
  if (isProd) return 'medium';
  return 'low';
}

// Deterministic matrix. Order matters — first matching rule wins.
export function evaluateAuthority(req: AuthorityRequest): AuthorityDecision {
  const evidence: string[] = [];

  // Rule 0 — Explicit DENY always wins.
  if (req.explicitDeny) {
    return {
      outcome: 'deny',
      risk: req.risk,
      reason: 'Explicit owner DENY policy — DENY always wins.',
      evidence: [...evidence, 'owner policy explicit_deny'],
      denied: true,
    };
  }

  // Rule 1 — Authorization gate (least privilege).
  if (!req.authorized) {
    return {
      outcome: 'deny',
      risk: req.risk,
      reason: `${req.actorType} is not authorized for ${req.permission}:${req.resourceType}.`,
      evidence: [...evidence, 'authorization grant absent'],
      denied: true,
    };
  }

  // Rule 2 — Agents cannot approve or reject (owner-only authority).
  if (req.actorType === 'agent' && (req.permission === 'approve' || req.actionType === 'approve')) {
    return {
      outcome: 'deny',
      risk: req.risk,
      reason: 'Approval authority is owner-only.',
      evidence: [...evidence, 'approval authority owner-only'],
      denied: true,
    };
  }

  // Rule 3 — Protected classes default to REQUIRE_APPROVAL.
  if (PROTECTED_ACTION_TYPES.has(req.actionType)) {
    return {
      outcome: 'require_approval',
      risk: req.risk,
      reason: `Protected action class "${req.actionType}" defaults to REQUIRE_APPROVAL.`,
      evidence: [...evidence, 'protected action class', `risk=${req.risk}`, `environment=${req.environment}`],
      denied: false,
    };
  }

  // Rule 4 — Risk-level escalation.
  if (req.risk === 'critical') {
    return {
      outcome: 'require_approval',
      risk: req.risk,
      reason: 'Critical risk requires approval.',
      evidence: [...evidence, 'critical risk'],
      denied: false,
    };
  }

  // Rule 5 — Environment escalation for write/execute in production.
  if (req.environment === 'production' && (req.permission === 'write' || req.permission === 'execute')) {
    return {
      outcome: 'require_approval',
      risk: req.risk,
      reason: 'Production write/execute requires approval.',
      evidence: [...evidence, 'production environment write/execute'],
      denied: false,
    };
  }

  // Rule 6 — Read is AUTO.
  if (req.permission === 'read') {
    return {
      outcome: 'auto',
      risk: req.risk,
      reason: 'Read access is auto-approved for authorized actor.',
      evidence: [...evidence, 'permission=read'],
      denied: false,
    };
  }

  // Rule 7 — Execute outside production is NOTIFY.
  if (req.permission === 'execute') {
    return {
      outcome: 'notify',
      risk: req.risk,
      reason: 'Execute in non-production environment runs with NOTIFY.',
      evidence: [...evidence, 'permission=execute', `environment=${req.environment}`],
      denied: false,
    };
  }

  // Rule 8 — Write outside production is NOTIFY (transparent).
  if (req.permission === 'write') {
    return {
      outcome: 'notify',
      risk: req.risk,
      reason: 'Write in non-production environment runs with NOTIFY.',
      evidence: [...evidence, 'permission=write', `environment=${req.environment}`],
      denied: false,
    };
  }

  // Rule 9 — Admin permission falls back to NOTIFY unless protected above.
  return {
    outcome: 'notify',
    risk: req.risk,
    reason: 'Admin-level action in non-protected context runs with NOTIFY.',
    evidence: [...evidence, 'permission=admin'],
    denied: false,
  };
}

export function clampAutonomy(level: AutonomyLevel): AutonomyLevel {
  return level;
}
