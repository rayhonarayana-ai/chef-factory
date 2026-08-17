import { describe, expect, it } from 'vitest';
import { evaluateAutonomy } from './autonomy.js';
import type { AuthorityDecision, AutonomyInput } from './types.js';

function base(input: Partial<AutonomyInput>): AutonomyInput {
  const authority: AuthorityDecision = {
    outcome: 'notify',
    risk: 'medium',
    reason: 'r',
    evidence: [],
    denied: false,
  };
  return {
    authority,
    successRate: 0.5,
    historyCount: 2,
    ownerPolicy: null,
    ...input,
    authority: input.authority ?? authority,
  };
}

describe('Adaptive Autonomy Controller (bounded escalation)', () => {
  it('never overrides DENY', () => {
    const authority: AuthorityDecision = { outcome: 'deny', risk: 'high', reason: 'r', evidence: [], denied: true };
    const d = evaluateAutonomy(base({ authority, successRate: 1, historyCount: 100 }));
    expect(d.selected).toBe('deny');
  });

  it('never downgrades protected classes even with perfect history', () => {
    const authority: AuthorityDecision = { outcome: 'require_approval', risk: 'high', reason: 'r', evidence: [], denied: false, actionType: 'deploy' };
    const d = evaluateAutonomy(base({ authority, successRate: 1, historyCount: 100 }));
    expect(d.selected).toBe('require_approval');
  });

  it('never escalates REQUIRE_APPROVAL to full autonomy', () => {
    const authority: AuthorityDecision = { outcome: 'require_approval', risk: 'medium', reason: 'r', evidence: [], denied: false, actionType: 'write' };
    const d = evaluateAutonomy(base({ authority, successRate: 1, historyCount: 100 }));
    expect(d.selected).toBe('require_approval');
  });

  it('keeps AUTO', () => {
    const authority: AuthorityDecision = { outcome: 'auto', risk: 'low', reason: 'r', evidence: [], denied: false };
    const d = evaluateAutonomy(base({ authority }));
    expect(d.selected).toBe('auto');
  });

  it('stays NOTIFY without a sufficient track record', () => {
    const d = evaluateAutonomy(base({ successRate: 0.9, historyCount: 3 }));
    expect(d.selected).toBe('notify');
  });

  it('one-step escalation NOTIFY → AUTO on strong repeated success', () => {
    const d = evaluateAutonomy(base({ successRate: 0.95, historyCount: 20 }));
    expect(d.selected).toBe('auto');
  });

  it('respects explicit owner policy', () => {
    const d = evaluateAutonomy(base({ ownerPolicy: 'auto', successRate: 0.1, historyCount: 0 }));
    expect(d.selected).toBe('auto');
  });

  it('falls back to REQUIRE_APPROVAL on unresolved outcomes', () => {
    const authority = { outcome: 'unknown' as never, risk: 'medium', reason: 'r', evidence: [], denied: false };
    const d = evaluateAutonomy(base({ authority }));
    expect(d.selected).toBe('require_approval');
  });
});
