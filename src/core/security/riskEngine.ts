// CHEF FACTORY — Gate 2 — Deterministic Risk Classification Engine.
// LOW / MEDIUM / HIGH / CRITICAL with explicit evidence. Escalation factors are
// checked in order; CRITICAL is terminal. Never fabricated.

import type { RiskAssessment, RiskContext } from './types.js';
import type { RiskLevel } from '../types.js';

const LEVELS: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function escalate(from: RiskLevel, to: RiskLevel): RiskLevel {
  return LEVELS[from] >= LEVELS[to] ? from : to;
}

export function classifyRisk(ctx: RiskContext): RiskAssessment {
  const evidence: string[] = [`action=${ctx.actionType}`, `environment=${ctx.environment}`, `permission=${ctx.requestedPermission}`];
  let risk: RiskLevel = 'low';

  // CRITICAL factors — terminal.
  if (ctx.secretExposure) {
    risk = escalate(risk, 'critical');
    evidence.push('factor=secret_exposure');
  }
  if (ctx.privilegeEscalation) {
    risk = escalate(risk, 'critical');
    evidence.push('factor=privilege_escalation');
  }
  if (ctx.financialImpact) {
    risk = escalate(risk, 'critical');
    evidence.push('factor=financial_impact');
  }
  if (ctx.actionType === 'legal' || ctx.actionType === 'contractual') {
    risk = escalate(risk, 'critical');
    evidence.push('factor=legal_commitment');
  }

  // HIGH factors.
  if (ctx.destructivePotential && ctx.environment === 'production') {
    risk = escalate(risk, 'critical');
    evidence.push('factor=destructive_production');
  } else if (ctx.destructivePotential) {
    risk = escalate(risk, 'high');
    evidence.push('factor=destructive_potential');
  }
  if (ctx.productionImpact) {
    risk = escalate(risk, 'high');
    evidence.push('factor=production_impact');
  }
  if (ctx.actionType === 'security_policy_modification' || ctx.actionType === 'disable_audit' || ctx.actionType === 'disable_rls') {
    risk = escalate(risk, 'high');
    evidence.push('factor=security_control_change');
  }
  if (ctx.actionType === 'secret_access' || ctx.actionType === 'secret_rotation') {
    risk = escalate(risk, 'high');
    evidence.push('factor=secret_access');
  }
  if (ctx.actionType === 'permission_escalation' || ctx.actionType === 'authority_rule_change' || ctx.actionType === 'autonomy_rule_change') {
    risk = escalate(risk, 'high');
    evidence.push('factor=permission_or_authority_change');
  }
  if (ctx.dataSensitivity === 'high') {
    risk = escalate(risk, 'high');
    evidence.push('factor=sensitive_data');
  }
  if (ctx.environment === 'production' && (ctx.requestedPermission === 'write' || ctx.requestedPermission === 'execute')) {
    risk = escalate(risk, 'high');
    evidence.push('factor=production_write_or_execute');
  }

  // MEDIUM factors.
  if (ctx.externalCommunication) {
    risk = escalate(risk, 'medium');
    evidence.push('factor=external_communication');
  }
  if (ctx.scope !== 'single') {
    risk = escalate(risk, 'medium');
    evidence.push(`factor=scope_${ctx.scope}`);
  }
  if (ctx.environment === 'staging' && (ctx.requestedPermission === 'write' || ctx.requestedPermission === 'execute')) {
    risk = escalate(risk, 'medium');
    evidence.push('factor=staging_write_or_execute');
  }
  if (ctx.requestedPermission === 'execute') {
    risk = escalate(risk, 'medium');
    evidence.push('factor=execute');
  }
  if (ctx.requestedPermission === 'write') {
    risk = escalate(risk, 'medium');
    evidence.push('factor=write');
  }
  if (!ctx.reversibility) {
    risk = escalate(risk, 'medium');
    evidence.push('factor=irreversible');
  }
  if (ctx.dataSensitivity === 'medium') {
    risk = escalate(risk, 'medium');
    evidence.push('factor=medium_sensitivity');
  }

  // Anomaly indicators raise risk (bounded, never fabricated).
  for (const indicator of ctx.anomalyIndicators) {
    risk = escalate(risk, 'medium');
    evidence.push(`factor=anomaly_${indicator}`);
  }

  return { risk, evidence };
}
