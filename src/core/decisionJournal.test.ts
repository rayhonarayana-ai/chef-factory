import { describe, expect, it } from 'vitest';
import { toDecisionRecord, validateDecision } from './decisionJournal.js';

describe('Decision Journal', () => {
  it('requires context and options', () => {
    expect(validateDecision({ ownerId: 'o', context: '', options: ['a'] })).toContain('context');
    expect(validateDecision({ ownerId: 'o', context: 'c', options: [] })).toContain('options');
  });

  it('requires at least two options unless one is selected', () => {
    expect(validateDecision({ ownerId: 'o', context: 'c', options: ['a'] })).toContain('at least two');
    expect(validateDecision({ ownerId: 'o', context: 'c', options: ['a'], selectedOption: 'a' })).toBeNull();
  });

  it('validates confidence bounds', () => {
    expect(validateDecision({ ownerId: 'o', context: 'c', options: ['a', 'b'], confidence: 1.5 })).toContain('confidence');
    expect(validateDecision({ ownerId: 'o', context: 'c', options: ['a', 'b'], confidence: 0.7 })).toBeNull();
  });

  it('requires selected_option to be one of the options', () => {
    expect(validateDecision({ ownerId: 'o', context: 'c', options: ['a', 'b'], selectedOption: 'z' })).toContain('selected_option');
  });

  it('builds a record with the documented structure', () => {
    const d = toDecisionRecord({
      ownerId: 'o', context: 'pick a stack', options: ['a', 'b'], selectedOption: 'b',
      reason: 'cheaper', evidence: ['cost analysis'], confidence: 0.9, riskLevel: 'medium',
      authorityLevel: 'auto', outcome: 'decided',
    });
    expect(d.options).toEqual(['a', 'b']);
    expect(d.selectedOption).toBe('b');
    expect(d.reason).toBe('cheaper');
    expect(d.confidence).toBe(0.9);
  });
});
