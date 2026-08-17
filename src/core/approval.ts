// CHEF FACTORY — Gate 1 — Approval Engine (deterministic core).
// Persistence-agnostic rules; enforcement is additionally backed by the DB
// unique index (one pending per task+action).

import type { ApprovalRecord, ApprovalStatus } from './types.js';

export interface NewApprovalInput {
  ownerId: string;
  projectId?: string | null;
  taskId?: string | null;
  agentId?: string | null;
  action: string;
  description?: string;
  riskLevel?: ApprovalRecord['riskLevel'];
  authorityLevel?: ApprovalRecord['authorityLevel'];
  requestedBy?: string | null;
  expiresAt?: string | null;
}

export interface ResolveInput {
  approval: ApprovalRecord;
  status: 'approved' | 'rejected' | 'denied';
  decision: string;
  decidedBy: string;
  now?: string;
}

export const APPROVAL_TERMINAL = new Set<ApprovalStatus>(['approved', 'rejected', 'denied', 'expired', 'cancelled']);

export function validateNewApproval(existingPending: ApprovalRecord[], input: NewApprovalInput): string | null {
  if (!input.action.trim()) return 'approval action is required';
  if (input.taskId) {
    const dup = existingPending.some(
      (a) => a.taskId === input.taskId && a.action === input.action && a.status === 'pending',
    );
    if (dup) return `one pending approval already exists for task ${input.taskId} action ${input.action}`;
  }
  return null;
}

export function resolveApproval(input: ResolveInput): { approval: ApprovalRecord; error: string | null } {
  if (APPROVAL_TERMINAL.has(input.approval.status)) {
    return { approval: input.approval, error: `approval already in terminal state ${input.approval.status}` };
  }
  const decidedAt = input.now ?? new Date().toISOString();
  return {
    approval: {
      ...input.approval,
      status: input.status,
      decision: input.decision,
      decisionReason: input.decision,
      decidedBy: input.decidedBy,
      decidedAt,
    },
    error: null,
  };
}

export function isExpired(approval: ApprovalRecord, now?: string): boolean {
  if (!approval.expiresAt) return false;
  return new Date(now ?? new Date().toISOString()).getTime() > new Date(approval.expiresAt).getTime();
}
