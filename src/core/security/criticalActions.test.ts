import { describe, expect, it } from 'vitest';
import { classifyCriticalAction, CRITICAL_ACTIONS, CRITICAL_ACTIONS_REGISTRY_VERSION } from './criticalActions.js';

describe('Gate 3 — Critical Action Vocabulary Alignment', () => {
  it('registry version is 2 (Gate 3 alignment)', () => {
    expect(CRITICAL_ACTIONS_REGISTRY_VERSION).toBe(2);
  });

  it('project_create is classified correctly in development', () => {
    const match = classifyCriticalAction('project_create', 'development');
    expect(match).not.toBeNull();
    expect(match!.rule.action).toBe('project_create');
    expect(match!.rule.defaultDecision).toBe('require_approval');
  });

  it('project_create is classified correctly in production', () => {
    const match = classifyCriticalAction('project_create', 'production');
    expect(match).not.toBeNull();
    expect(match!.rule.action).toBe('project_create');
  });

  it('task_create is classified correctly', () => {
    const match = classifyCriticalAction('task_create', 'development');
    expect(match).not.toBeNull();
    expect(match!.rule.action).toBe('task_create');
    expect(match!.rule.defaultDecision).toBe('allow');
  });

  it('project_delete is deny by default', () => {
    const match = classifyCriticalAction('project_delete', 'production');
    expect(match).not.toBeNull();
    expect(match!.rule.defaultDecision).toBe('deny');
  });

  it('task_delete requires approval', () => {
    const match = classifyCriticalAction('task_delete', 'development');
    expect(match).not.toBeNull();
    expect(match!.rule.defaultDecision).toBe('require_approval');
  });

  it('agent_create requires approval', () => {
    const match = classifyCriticalAction('agent_create', 'development');
    expect(match).not.toBeNull();
    expect(match!.rule.defaultDecision).toBe('require_approval');
  });

  it('agent_delete is deny', () => {
    const match = classifyCriticalAction('agent_delete', 'development');
    expect(match).not.toBeNull();
    expect(match!.rule.defaultDecision).toBe('deny');
  });

  it('security_policy_edit is deny', () => {
    const match = classifyCriticalAction('security_policy_edit', 'development');
    expect(match).not.toBeNull();
    expect(match!.rule.defaultDecision).toBe('deny');
  });

  it('memory_write is deferred (allow)', () => {
    const match = classifyCriticalAction('memory_write', 'development');
    expect(match).not.toBeNull();
    expect(match!.rule.defaultDecision).toBe('allow');
  });

  it('memory_delete is deferred (allow)', () => {
    const match = classifyCriticalAction('memory_delete', 'development');
    expect(match).not.toBeNull();
    expect(match!.rule.defaultDecision).toBe('allow');
  });

  it('old production_modification rule still works (no regression)', () => {
    const match = classifyCriticalAction('production_modification', 'production');
    expect(match).not.toBeNull();
    expect(match!.rule.defaultDecision).toBe('require_approval');
    expect(match!.rule.isCore).toBe(true);
  });

  it('old production_deletion rule still denies in production (no regression)', () => {
    const match = classifyCriticalAction('production_deletion', 'production');
    expect(match).not.toBeNull();
    expect(match!.rule.defaultDecision).toBe('deny');
  });

  it('old financial_transaction still denies (no regression)', () => {
    const match = classifyCriticalAction('financial_transaction', 'development');
    expect(match).not.toBeNull();
    expect(match!.rule.defaultDecision).toBe('deny');
  });

  it('registry has at least 25 rules', () => {
    expect(CRITICAL_ACTIONS.length).toBeGreaterThanOrEqual(25);
  });

  it('all rules are flagged as core (immutable)', () => {
    expect(CRITICAL_ACTIONS.every((r) => r.isCore)).toBe(true);
  });

  it('unknown action returns null (not false positive)', () => {
    const match = classifyCriticalAction('nonexistent_action_xyz', 'development');
    expect(match).toBeNull();
  });
});
