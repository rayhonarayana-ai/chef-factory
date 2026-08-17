import { describe, expect, it } from 'vitest';
import { buildExplanation, isCompleteExplanation } from './explanation.js';

describe('Explanation Layer', () => {
  it('always exposes decision, why, evidence, confidence, risk', () => {
    const e = buildExplanation({ decision: 'Executed', why: 'because', evidence: ['a'], confidence: 0.9, risk: 'medium', outcome: 'executed' });
    expect(e.decision).toBe('Executed');
    expect(e.why).toBe('because');
    expect(e.evidence).toEqual(['a']);
    expect(e.confidence).toBe(0.9);
    expect(e.risk).toBe('medium');
    expect(e.outcome).toBe('executed');
  });

  it('defaults optional fields deterministically', () => {
    const e = buildExplanation({ decision: 'X', why: 'Y', risk: 'low' });
    expect(e.evidence).toEqual([]);
    expect(e.confidence).toBeNull();
    expect(e.outcome).toBe('pending');
  });

  it('"Done." alone is NEVER a complete explanation', () => {
    expect(isCompleteExplanation({ decision: 'Done.', why: 'Done.', evidence: [], confidence: null, risk: 'low', outcome: 'executed' })).toBe(false);
  });

  it('requires non-empty decision and why', () => {
    expect(isCompleteExplanation({ decision: ' ', why: 'because', evidence: [], confidence: null, risk: 'low', outcome: 'executed' })).toBe(false);
    expect(isCompleteExplanation({ decision: 'Done that', why: ' ', evidence: [], confidence: null, risk: 'low', outcome: 'executed' })).toBe(false);
  });
});
