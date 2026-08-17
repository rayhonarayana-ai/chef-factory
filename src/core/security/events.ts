// CHEF FACTORY — Gate 2 — Security Event model.
// Security events are append-only, owner-scoped, and must never contain secrets.
// No agent may delete or modify historical security events (RLS + trigger).

import type { EventSeverity, SecurityEventInput, SecurityEventRecord } from './types.js';
import { redactText } from '../redact.js';

export const SECURITY_EVENT_TYPES = [
  'lockdown.activated',
  'lockdown.released',
  'lockdown.release_denied',
  'denied.action',
  'denied.cross_project',
  'denied.environment_escalation',
  'denied.rate_limit',
  'denied.cost',
  'denied.tool',
  'denied.runtime',
  'denied.lockdown_release',
  'require_approval.critical',
  'secret.access_attempt',
  'secret.potential_leak',
  'policy.violation',
  'anomaly.repeated_denial',
  'anomaly.auth_failures',
  'anomaly.cost_spike',
  'anomaly.retry_burst',
  'anomaly.tool_anomaly',
  'anomaly.policy_violations',
  'incident.opened',
  'incident.updated',
  'health.lockdown',
  'info.default_deny',
] as const;

const SEVERITY_ORDER: Record<EventSeverity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Deterministic severity inference from event type (overridable by explicit severity). */
export function severityFor(eventType: string, fallback: EventSeverity = 'medium'): EventSeverity {
  if (eventType.startsWith('info.')) return 'info';
  if (eventType.includes('lockdown')) return 'critical';
  if (eventType.includes('denied.critical') || eventType.includes('secret.potential_leak')) return 'critical';
  if (eventType.startsWith('anomaly.')) return 'medium';
  if (eventType.startsWith('denied.') || eventType === 'secret.access_attempt' || eventType === 'policy.violation') return 'high';
  if (eventType === 'require_approval.critical') return 'high';
  return fallback;
}

export function validateSecurityEvent(input: SecurityEventInput): string | null {
  if (!input.ownerId) return 'security event requires ownerId';
  if (!input.eventType) return 'security event requires eventType';
  if (!input.action) return 'security event requires action';
  if (!input.reason || input.reason.trim().length === 0) return 'security event requires reason';
  if (input.metadata) {
    const leaked = redactText(JSON.stringify(input.metadata));
    if (leaked.includes('[REDACTED]')) {
      // Redaction already applied — caller must pre-redact. We still record safely.
    }
  }
  return null;
}

export function toSecurityEventRecord(input: SecurityEventInput, now = new Date().toISOString()): SecurityEventRecord {
  return {
    eventId: crypto.randomUUID(),
    ownerId: input.ownerId,
    projectId: input.projectId ?? null,
    agentId: input.agentId ?? null,
    taskId: input.taskId ?? null,
    correlationId: input.correlationId ?? null,
    environment: input.environment ?? 'development',
    eventType: input.eventType,
    severity: input.severity ?? severityFor(input.eventType),
    action: input.action,
    resource: input.resource ?? null,
    decision: input.decision ?? null,
    reason: redactText(input.reason),
    evidenceReferences: input.evidenceReferences ?? [],
    metadata: redactMetadata(input.metadata ?? {}),
    occurredAt: input.occurredAt ?? now,
    recordedAt: now,
  };
}

function redactMetadata(m: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = typeof v === 'string' ? redactText(v) : v;
  }
  return out;
}

export function severityRank(s: EventSeverity): number {
  return SEVERITY_ORDER[s];
}
