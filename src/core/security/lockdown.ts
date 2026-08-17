// CHEF FACTORY — Gate 2 — Emergency Lockdown foundation.
// Lockdown fails closed: while active, every security evaluation returns LOCKDOWN.
// Activation is auditable. Release requires explicit, authenticated owner
// authorization — an agent can NEVER release its own (or any) lockdown.

import type { SecurityLockdownRecord } from './types.js';

export const LOCKDOWN_SCOPE_ALL = 'all';

export interface ActivateLockdownInput {
  ownerId: string;
  scope?: string; // default 'all'
  reason: string;
  activatedBy: string;
  actorType: 'owner' | 'agent' | 'system';
}

export interface ReleaseLockdownInput {
  ownerId: string;
  releasedBy: string;
  actorType: 'owner' | 'agent';
  reason: string;
}

export function validateLockdownActivation(input: ActivateLockdownInput): string | null {
  if (!input.reason || input.reason.trim().length === 0) return 'lockdown activation requires a reason';
  if (!input.ownerId) return 'lockdown requires ownerId';
  if (input.actorType === 'agent') return 'agents cannot activate a lockdown';
  return null;
}

export function toLockdownRecord(input: ActivateLockdownInput, now = new Date().toISOString()): SecurityLockdownRecord {
  return {
    lockdownId: crypto.randomUUID(),
    ownerId: input.ownerId,
    scope: input.scope ?? LOCKDOWN_SCOPE_ALL,
    reason: input.reason,
    status: 'active',
    activatedBy: input.activatedBy,
    releasedBy: null,
    releasedAt: null,
    createdAt: now,
  };
}

/** An agent may never release a lockdown. Owner release is explicit and audited. */
export function canReleaseLockdown(input: ReleaseLockdownInput): { allowed: boolean; error: string | null } {
  if (input.actorType !== 'owner') {
    return { allowed: false, error: 'Lockdown release requires explicit owner authorization — agents may never release lockdowns.' };
  }
  if (!input.reason || input.reason.trim().length === 0) {
    return { allowed: false, error: 'Lockdown release requires a recorded reason.' };
  }
  return { allowed: true, error: null };
}

export function releaseLockdown(
  record: SecurityLockdownRecord,
  input: ReleaseLockdownInput,
  now = new Date().toISOString(),
): { record: SecurityLockdownRecord; error: string | null } {
  if (record.status !== 'active') {
    return { record, error: 'lockdown is not active' };
  }
  const check = canReleaseLockdown(input);
  if (!check.allowed) return { record, error: check.error };
  return {
    record: { ...record, status: 'released', releasedBy: input.releasedBy, releasedAt: now },
    error: null,
  };
}
