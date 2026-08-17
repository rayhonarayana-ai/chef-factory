import { describe, it, expect, vi } from 'vitest';
import { ToolBroker } from '../../gateways/toolBroker';
import { classifyCriticalAction } from './criticalActions';
import { evaluatePolicy } from './policyEngine';
import { AnomalyDetector, DEFAULT_ANOMALY_THRESHOLDS } from './anomaly';
import { PRODUCTION_COST_PROTECTION, DEFAULT_COST_PROTECTION } from './costProtection';
import type { SecurityRequest } from './types';

function makeRequest(overrides?: Partial<SecurityRequest>): SecurityRequest {
  return {
    owner: 'test-owner',
    actor: { kind: 'agent', id: 'test-agent' },
    project: 'test-project',
    environment: 'development',
    actionType: 'read',
    authorized: true,
    ...overrides,
  };
}

function policyInput(overrides?: Partial<Parameters<typeof evaluatePolicy>[0]>): Parameters<typeof evaluatePolicy>[0] {
  return {
    request: makeRequest(),
    lockdownActive: false,
    criticalDecision: null,
    environmentIsolation: { escalated: false, reason: null },
    crossProject: { crossed: false, reason: null },
    rateLimited: { limited: false, scope: null, reason: null },
    costStopped: { stopped: false, reason: null },
    untrustedAuthorityDirective: { present: false, matches: [] },
    ...overrides,
  };
}

describe('Gate 5 — Execution Integrity & Security Hardening', () => {
  // G5-01: Double execution prevention
  it('G5-01: execute=false validates without calling handler', async () => {
    let called = false;
    const broker = new ToolBroker();
    broker.register({
      name: 'spy_tool',
      action: 'read',
      minRisk: 'low',
      run: async () => { called = true; return { done: true }; },
    });

    const req = { tool: 'spy_tool', args: {}, risk: 'low' as const, actionType: 'read' };
    await broker.call(req, { decision: 'allow', approved: true, execute: false });
    expect(called).toBe(false);

    await broker.call(req, { decision: 'allow', approved: true });
    expect(called).toBe(true);
  });

  it('G5-01: execute=true calls handler (default behavior)', async () => {
    let called = false;
    const broker = new ToolBroker();
    broker.register({
      name: 'normal_tool',
      action: 'read',
      minRisk: 'low',
      run: async () => { called = true; return { done: true }; },
    });

    const req = { tool: 'normal_tool', args: {}, risk: 'low' as const, actionType: 'read' };
    await broker.call(req, { decision: 'allow', approved: true });
    expect(called).toBe(true);
  });

  // G5-03: Cost protection limits
  it('G5-03: PRODUCTION_COST_PROTECTION has daily and monthly limits', () => {
    expect(PRODUCTION_COST_PROTECTION.projectDailyHardLimit).toBe(5);
    expect(PRODUCTION_COST_PROTECTION.ownerMonthlyHardLimit).toBe(100);
  });

  it('G5-03: DEFAULT_COST_PROTECTION has null daily but monthly=100', () => {
    expect(DEFAULT_COST_PROTECTION.projectDailyHardLimit).toBeNull();
    expect(DEFAULT_COST_PROTECTION.ownerMonthlyHardLimit).toBe(100);
  });

  // G5-04: Prompt injection deny rule
  it('G5-04: prompt injection with authority directive is denied', () => {
    const result = evaluatePolicy(policyInput({
      untrustedAuthorityDirective: { present: true, matches: ['override instructions'] },
    }));
    expect(result.decision).toBe('deny');
    expect(result.rules).toContain('rule.prompt_injection_deny');
  });

  it('G5-04: prompt injection without directive passes through', () => {
    const result = evaluatePolicy(policyInput());
    expect(result.decision).toBe('allow');
  });

  // G5-05: Anomaly decay
  it('G5-05: anomaly counter resets after time window', () => {
    vi.useFakeTimers();
    try {
      const detector = new AnomalyDetector(DEFAULT_ANOMALY_THRESHOLDS, 100);
      // Record 5 denials at t=0
      for (let i = 0; i < 5; i++) detector.note('deniedActions');
      expect(detector.countersSnapshot.deniedActions).toBe(5);

      // Advance past decay window (100ms)
      vi.advanceTimersByTime(101);
      // Next note should reset counter (inactive > decayWindow) then increment to 1
      detector.note('deniedActions');
      expect(detector.countersSnapshot.deniedActions).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('G5-05: default decay window preserves counter when no time passes', () => {
    const detector = new AnomalyDetector(DEFAULT_ANOMALY_THRESHOLDS);
    for (let i = 0; i < 4; i++) detector.note('deniedActions');
    const snap = detector.countersSnapshot;
    expect(snap.deniedActions).toBe(4);
  });

  // G5-06: Vocabulary aliases
  it('G5-06: "financial" aliases to "financial_transaction" (deny)', () => {
    const result = classifyCriticalAction('financial', 'production');
    expect(result).not.toBeNull();
    expect(result!.rule.action).toBe('financial_transaction');
    expect(result!.rule.defaultDecision).toBe('deny');
  });

  it('G5-06: "deploy" aliases to "production_modification" (require_approval)', () => {
    const result = classifyCriticalAction('deploy', 'production');
    expect(result).not.toBeNull();
    expect(result!.rule.action).toBe('production_modification');
    expect(result!.rule.defaultDecision).toBe('require_approval');
  });

  it('G5-06: "delete" aliases to "production_deletion" (deny in production)', () => {
    const result = classifyCriticalAction('delete', 'production');
    expect(result).not.toBeNull();
    expect(result!.rule.action).toBe('production_deletion');
    expect(result!.rule.defaultDecision).toBe('deny');
  });

  it('G5-06: "account_security" aliases to "secret_access" (require_approval)', () => {
    const result = classifyCriticalAction('account_security', 'production');
    expect(result).not.toBeNull();
    expect(result!.rule.action).toBe('secret_access');
    expect(result!.rule.defaultDecision).toBe('require_approval');
  });

  it('G5-06: "legal" aliases to "legal_commitment" (deny)', () => {
    const result = classifyCriticalAction('legal', 'production');
    expect(result).not.toBeNull();
    expect(result!.rule.action).toBe('legal_commitment');
    expect(result!.rule.defaultDecision).toBe('deny');
  });

  it('G5-06: exact actionType match still works without alias', () => {
    const result = classifyCriticalAction('financial_transaction', 'production');
    expect(result).not.toBeNull();
    expect(result!.rule.action).toBe('financial_transaction');
  });
});
