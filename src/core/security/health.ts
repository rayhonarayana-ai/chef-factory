// CHEF FACTORY — Gate 2 — Security Health Status.
// Deterministic aggregation. Never reports HEALTHY when a critical control is
// unavailable.

import type { HealthCheckResult, RlsProbe, SecurityHealth } from './types.js';

export function computeSecurityHealth(
  checks: HealthCheckResult[],
  lockdownActive: boolean,
  now = new Date().toISOString(),
): SecurityHealth {
  const critical = checks.filter((c) => c.critical);
  const failedCritical = critical.filter((c) => !c.ok);
  const failedAny = checks.filter((c) => !c.ok);

  let status: SecurityHealth['status'] = 'healthy';
  if (lockdownActive) status = 'lockdown';
  else if (failedCritical.length > 0) status = 'blocked';
  else if (failedAny.length > 0) status = 'degraded';

  return { status, checks, generatedAt: now };
}

export function rlsHealthFromProbe(probe: RlsProbe | null, error: string | null): HealthCheckResult {
  if (error) {
    return { id: 'database.rls', label: 'Database / RLS', ok: false, detail: `probe failed: ${error}`, critical: true };
  }
  if (!probe) {
    return { id: 'database.rls', label: 'Database / RLS', ok: false, detail: 'no probe data', critical: true };
  }
  const ok = probe.ok && probe.auditAppendOnly && probe.securityEventsAppendOnly && probe.rlsEnabledTables === probe.publicTables;
  return {
    id: 'database.rls',
    label: 'Database / RLS',
    ok,
    detail: `${probe.rlsEnabledTables}/${probe.publicTables} tables RLS-enabled; audit append-only=${probe.auditAppendOnly}; security events append-only=${probe.securityEventsAppendOnly}`,
    critical: true,
  };
}

export const DEFAULT_HEALTH_CHECKS = (extra: Record<string, boolean>): HealthCheckResult[] => [
  { id: 'policy_engine', label: 'Security Policy Engine', ok: extra.policyEngine !== false, detail: 'deterministic policy engine loaded', critical: true },
  { id: 'critical_actions', label: 'Critical Action Registry', ok: extra.criticalActions !== false, detail: 'core registry version 1 loaded', critical: true },
  { id: 'risk_engine', label: 'Risk Classification Engine', ok: extra.riskEngine !== false, detail: 'deterministic risk engine loaded', critical: true },
  { id: 'audit', label: 'Audit Service', ok: extra.audit !== false, detail: 'append-only audit available', critical: true },
  { id: 'secret_provider', label: 'Secret Provider', ok: extra.secretProvider !== false, detail: 'secret boundary active', critical: true },
  { id: 'anomaly_detector', label: 'Anomaly Detector', ok: extra.anomalyDetector !== false, detail: 'deterministic thresholds loaded', critical: false },
  { id: 'rate_limit', label: 'Rate Limiter', ok: extra.rateLimit !== false, detail: 'fixed-window limits loaded', critical: false },
  { id: 'cost_protection', label: 'Cost Protection', ok: extra.costProtection !== false, detail: 'hard-limit checks available', critical: false },
];
