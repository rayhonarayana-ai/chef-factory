import { describe, expect, it } from 'vitest';
import { createSecurityGuardian } from './security.js';
import { MemoryStore } from '../testing/memoryStore.js';
import type { SecurityRequest } from '../core/security/types.js';

function request(overrides: Partial<SecurityRequest>): SecurityRequest {
  return {
    ownerId: 'owner-1',
    actorId: 'owner-1',
    actorType: 'owner',
    projectId: null,
    environment: 'development',
    resourceType: 'command',
    actionType: 'read',
    permission: 'read',
    risk: 'low',
    authorized: true,
    explicitDeny: false,
    ...overrides,
  };
}

describe('createSecurityGuardian (API boundary wiring)', () => {
  it('reads lockdown from the real Store (async) and fails closed', async () => {
    const store = new MemoryStore();
    await store.activateLockdown('owner-1', { reason: 'forensic live test', activatedBy: 'owner-1', actorType: 'owner' });
    const guardian = createSecurityGuardian(store);
    const res = await guardian.evaluate(request({}));
    expect(res.decision).toBe('lockdown');
    expect(res.denied).toBe(true);
  });

  it('does not false-positive a normal command when no lockdown is active', async () => {
    const store = new MemoryStore();
    const guardian = createSecurityGuardian(store);
    const res = await guardian.evaluate(request({}));
    expect(res.decision).toBe('allow');
    expect(res.denied).toBe(false);
  });

  it('records security events through the real Store (append-only audit trail)', async () => {
    const store = new MemoryStore();
    const guardian = createSecurityGuardian(store);
    await guardian.evaluate(request({ actionType: 'financial_transaction', environment: 'production', risk: 'high' }));
    const events = await store.listSecurityEvents('owner-1');
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.eventType === 'denied.critical' || e.eventType === 'require_approval.critical')).toBe(true);
  });

  it('wires a cost check that does not stop execution with the safe default (no limits)', async () => {
    const store = new MemoryStore();
    const guardian = createSecurityGuardian(store);
    const res = await guardian.evaluate(request({ projectId: 'project-1' }));
    expect(res.denied).toBe(false);
  });
});
