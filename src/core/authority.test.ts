import { describe, expect, it } from 'vitest';
import { evaluateAuthority, riskFromAction, PROTECTED_ACTION_TYPES } from './authority.js';
import type { AuthorityRequest } from './types.js';

function req(over: Partial<AuthorityRequest>): AuthorityRequest {
  return {
    actorId: 'owner-1',
    actorType: 'owner',
    projectId: 'p1',
    environment: 'development',
    resourceType: 'tasks',
    permission: 'read',
    risk: 'low',
    actionType: 'read',
    authorized: true,
    explicitDeny: false,
    ...over,
  };
}

describe('Authority Matrix', () => {
  it('grants AUTO for authorized read', () => {
    expect(evaluateAuthority(req({})).outcome).toBe('auto');
  });

  it('grants NOTIFY for write in development', () => {
    expect(evaluateAuthority(req({ permission: 'write', actionType: 'write' })).outcome).toBe('notify');
  });

  it('requires approval for production write', () => {
    const d = evaluateAuthority(req({ permission: 'write', actionType: 'write', environment: 'production' }));
    expect(d.outcome).toBe('require_approval');
  });

  it('requires approval for delete (destructive) regardless of environment', () => {
    expect(evaluateAuthority(req({ permission: 'write', actionType: 'delete' })).outcome).toBe('require_approval');
  });

  it('requires approval for deploy', () => {
    expect(evaluateAuthority(req({ permission: 'execute', actionType: 'deploy', environment: 'staging' })).outcome).toBe('require_approval');
  });

  it('requires approval for financial/legal/account_security', () => {
    for (const a of ['financial', 'legal', 'account_security']) {
      expect(evaluateAuthority(req({ permission: 'execute', actionType: a })).outcome).toBe('require_approval');
    }
  });

  it('explicit DENY always wins', () => {
    const d = evaluateAuthority(req({ explicitDeny: true, permission: 'read' }));
    expect(d.outcome).toBe('deny');
    expect(d.denied).toBe(true);
  });

  it('denies when the actor is not authorized (least privilege)', () => {
    const d = evaluateAuthority(req({ authorized: false }));
    expect(d.outcome).toBe('deny');
  });

  it('denies agents trying to approve (owner-only authority)', () => {
    const d = evaluateAuthority(req({ actorType: 'agent', permission: 'approve', actionType: 'approve' }));
    expect(d.outcome).toBe('deny');
  });

  it('notifies for execute in non-production', () => {
    expect(evaluateAuthority(req({ permission: 'execute', actionType: 'execute' })).outcome).toBe('notify');
  });

  it('escalates risk deterministically', () => {
    expect(riskFromAction('delete', 'development')).toBe('high');
    expect(riskFromAction('deploy', 'production')).toBe('critical');
    expect(riskFromAction('read', 'development')).toBe('low');
    expect(riskFromAction('execute', 'production')).toBe('high');
  });

  it('protects the expected action classes', () => {
    expect(PROTECTED_ACTION_TYPES.has('delete')).toBe(true);
    expect(PROTECTED_ACTION_TYPES.has('deploy')).toBe(true);
    expect(PROTECTED_ACTION_TYPES.has('financial')).toBe(true);
  });
});
