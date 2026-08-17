import { describe, expect, it } from 'vitest';
import { isExpired, resolveApproval, validateNewApproval, APPROVAL_TERMINAL } from './approval.js';
import type { ApprovalRecord } from './types.js';

function approval(over: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id: 'a1',
    ownerId: 'owner-1',
    projectId: 'p1',
    taskId: 't1',
    agentId: null,
    action: 'deploy',
    description: null,
    riskLevel: 'high',
    authorityLevel: 'require_approval',
    status: 'pending',
    decision: null,
    decisionReason: null,
    requestedBy: 'owner-1',
    decidedBy: null,
    expiresAt: null,
    decidedAt: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe('Approval Engine', () => {
  it('allows one pending approval per task+action', () => {
    const existing = [approval({ id: 'dup' })];
    const err = validateNewApproval(existing, { ownerId: 'owner-1', taskId: 't1', action: 'deploy' });
    expect(err).toContain('one pending approval already exists');
  });

  it('allows a different pending action', () => {
    const err = validateNewApproval([approval({ action: 'delete' })], { ownerId: 'owner-1', taskId: 't1', action: 'deploy' });
    expect(err).toBeNull();
  });

  it('resolves pending → approved and records decision metadata', () => {
    const { approval: out, error } = resolveApproval({ approval: approval(), status: 'approved', decision: 'go ahead', decidedBy: 'owner-1' });
    expect(error).toBeNull();
    expect(out.status).toBe('approved');
    expect(out.decidedBy).toBe('owner-1');
    expect(out.decision).toBe('go ahead');
    expect(out.decidedAt).not.toBeNull();
  });

  it('rejects resolution of a terminal approval', () => {
    const { error } = resolveApproval({ approval: approval({ status: 'approved' }), status: 'rejected', decision: 'no', decidedBy: 'owner-1' });
    expect(error).toContain('terminal');
  });

  it('detects expiry deterministically', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isExpired(approval({ expiresAt: past }))).toBe(true);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isExpired(approval({ expiresAt: future }))).toBe(false);
    expect(isExpired(approval())).toBe(false);
  });

  it('defines the terminal set correctly', () => {
    expect(APPROVAL_TERMINAL.has('approved')).toBe(true);
    expect(APPROVAL_TERMINAL.has('rejected')).toBe(true);
    expect(APPROVAL_TERMINAL.has('denied')).toBe(true);
    expect(APPROVAL_TERMINAL.has('pending')).toBe(false);
  });
});
