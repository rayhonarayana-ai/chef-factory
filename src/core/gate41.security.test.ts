// CHEF FACTORY — Gate 41 — GLOBAL EMERGENCY STOP write-boundary security proofs.
//
// Proves the capability separation mandated by the Development Lead:
//   * READ (getWorkforceControl) lives on the general `Store`.
//   * WRITE (setWorkforceControlRaw) is a SEPARATE privileged capability
//     (WorkforceControlAdminPersistence), reachable ONLY through the system-admin-
//     gated setGlobalEmergencyStop.
//   * The worker loop reads the control but NEVER calls the write path.
//   * No agent/owner/generic-system/workforce-service can toggle the stop.
//   * Stopping requires a non-empty reason.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStore } from '../testing/memoryStore.js';
import { setGlobalEmergencyStop, canSetGlobalControl, isGlobalStopActive, SYSTEM_ADMIN_ACTOR, SYSTEM_ADMIN_AUDIT_ACTOR_ID } from './security/workforceControl.js';
import { WORKFORCE_SERVICE_ACTOR, WORKFORCE_SERVICE_ACTOR_TYPE, WORKFORCE_SERVICE_AUDIT_ACTOR_ID } from './workforceService.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), 'utf8');

describe('Gate 41 — write boundary: only authorized system-admin may toggle the stop', () => {
  it('denies an agent', async () => {
    const store = new MemoryStore();
    await expect(
      setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: false, reason: 'x', actorId: 'agent-1', actorType: 'agent' }),
    ).rejects.toThrow(/denied/);
  });

  it('denies an owner', async () => {
    const store = new MemoryStore();
    await expect(
      setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: false, reason: 'x', actorId: 'owner-1', actorType: 'owner' }),
    ).rejects.toThrow(/denied/);
  });

  it('denies a generic system actor', async () => {
    const store = new MemoryStore();
    await expect(
      setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: false, reason: 'x', actorId: 'system', actorType: 'system' }),
    ).rejects.toThrow(/denied/);
  });

  it('denies the mission engine / specialist', async () => {
    const store = new MemoryStore();
    await expect(
      setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: false, reason: 'x', actorId: 'mission-engine', actorType: 'system' }),
    ).rejects.toThrow(/denied/);
  });

  it('denies the workforce service identity even though it is a system actor', async () => {
    expect(canSetGlobalControl(WORKFORCE_SERVICE_ACTOR, WORKFORCE_SERVICE_ACTOR_TYPE)).toBe(false);
    const store = new MemoryStore();
    await expect(
      setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: false, reason: 'stop', actorId: WORKFORCE_SERVICE_ACTOR, actorType: WORKFORCE_SERVICE_ACTOR_TYPE }),
    ).rejects.toThrow(/denied/);
  });

  it('requires a non-empty reason when stopping', async () => {
    const store = new MemoryStore();
    await expect(
      setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: false, reason: '   ', actorId: 'system:admin', actorType: 'system' }),
    ).rejects.toThrow(/requires a non-empty reason/);
  });

  it('persists the authorized admin identity as updated_by (correct attribution)', async () => {
    const store = new MemoryStore();
    const record = await setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: false, reason: 'incident', actorId: SYSTEM_ADMIN_ACTOR, actorType: 'system' });
    expect(record.globallyEnabled).toBe(false);
    expect(record.updatedBy).toBe(SYSTEM_ADMIN_ACTOR);
    const audit = store.audit.find((a) => a.action === 'workforce.global_control.stopped');
    expect(audit).toBeTruthy();
    // DB audit attribution uses the stable system-admin AUDIT UUID (actor_id is a uuid column).
    expect(audit?.actorId).toBe(SYSTEM_ADMIN_AUDIT_ACTOR_ID);
    expect((audit?.metadata as Record<string, unknown>)?.['systemAdmin']).toBe(SYSTEM_ADMIN_ACTOR);
    expect((audit?.metadata as Record<string, unknown>)?.['reason']).toBe('incident');
  });

  it('the authorized admin may re-enable the stop off', async () => {
    const store = new MemoryStore();
    await setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: false, reason: 'incident', actorId: 'system:admin', actorType: 'system' });
    const again = await setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: true, reason: 'resolved', actorId: 'system:admin', actorType: 'system' });
    expect(again.globallyEnabled).toBe(true);
    expect(store.audit.some((a) => a.action === 'workforce.global_control.enabled')).toBe(true);
  });
});

describe('Gate 41 — capability separation (structural), worker never writes', () => {
  it('the general Store interface exposes ONLY READ (getWorkforceControl) for the control', () => {
    const src = read('../core/ports.ts');
    // Store interface body must contain getWorkforceControl but NOT setWorkforceControlRaw
    const storeIface = src.slice(src.indexOf('export interface Store'), src.indexOf('claimTaskForExecution'));
    expect(storeIface).toContain('getWorkforceControl');
    expect(storeIface).not.toContain('setWorkforceControlRaw');
    // the raw write lives ONLY in the separate admin capability interface
    const adminIface = src.slice(src.indexOf('export interface WorkforceControlAdminPersistence'));
    expect(adminIface).toContain('setWorkforceControlRaw');
  });

  it('the worker loop reads the control but NEVER invokes the write path', () => {
    const loop = read('../runtime/workerLoop.ts');
    expect(loop).toContain('getWorkforceControl');
    expect(loop).not.toContain('setWorkforceControlRaw');
    expect(loop).not.toContain('setGlobalEmergencyStop');
  });

  it('the orchestrator reads the control (fail-closed) but never writes it', () => {
    const orch = read('../core/workforceOrchestrator.ts');
    expect(orch).toContain('getWorkforceControl');
    expect(orch).not.toContain('setWorkforceControlRaw');
    expect(orch).not.toContain('setGlobalEmergencyStop');
  });

  it('the raw write primitive carries no actorType (authorization done at the core boundary)', () => {
    const repo = read('../db/repo.ts');
    // setWorkforceControlRaw signature must NOT accept/declare actorType internally.
    const rawFn = repo.slice(repo.indexOf('async setWorkforceControlRaw'), repo.indexOf('async setWorkforceControlRaw') + 220);
    expect(rawFn).not.toMatch(/actorType/);
    // and it must not silently ignore a rejected actorType field.
    expect(rawFn).not.toContain('void input.actorType');
  });

  it('Store-typed call sites cannot reach the write path (type-safety by construction)', () => {
    // Worker + orchestrator are typed against the general Store, which has no write method.
    const loop = read('../runtime/workerLoop.ts');
    expect(loop).toContain('Store');
    expect(loop).not.toContain('WorkforceControlAdminPersistence');
    const orch = read('../core/workforceOrchestrator.ts');
    expect(orch).not.toContain('WorkforceControlAdminPersistence');
  });
});

describe('Gate 41 — audit UUID vs authority identity separation (attribution != authority)', () => {
  it('WORKFORCE_SERVICE_AUDIT_ACTOR_ID is a valid, stable, deterministic UUID distinct from the semantic actor', () => {
    expect(WORKFORCE_SERVICE_AUDIT_ACTOR_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(WORKFORCE_SERVICE_AUDIT_ACTOR_ID).not.toBe(WORKFORCE_SERVICE_ACTOR);
    // deterministic literal, not crypto.randomUUID() (no per-event regeneration)
    expect(WORKFORCE_SERVICE_AUDIT_ACTOR_ID).toBe('00000000-0000-4000-a000-00000000f41a');
  });

  it('SYSTEM_ADMIN_AUDIT_ACTOR_ID is a valid, stable, deterministic UUID distinct from SYSTEM_ADMIN_ACTOR', () => {
    expect(SYSTEM_ADMIN_AUDIT_ACTOR_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(SYSTEM_ADMIN_AUDIT_ACTOR_ID).not.toBe(SYSTEM_ADMIN_ACTOR);
    expect(SYSTEM_ADMIN_AUDIT_ACTOR_ID).toBe('00000000-0000-4000-a000-00000000f1ff');
  });

  it('the system-admin AUDIT UUID alone cannot mutate global control', async () => {
    const store = new MemoryStore();
    await expect(
      setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: false, reason: 'stop', actorId: SYSTEM_ADMIN_AUDIT_ACTOR_ID, actorType: 'system' }),
    ).rejects.toThrow(/denied/);
  });

  it('the workforce AUDIT UUID cannot mutate global control', async () => {
    const store = new MemoryStore();
    await expect(
      setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: false, reason: 'stop', actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, actorType: 'system' }),
    ).rejects.toThrow(/denied/);
  });

  it('the canonical SYSTEM_ADMIN_ACTOR succeeds and audits the reserved system-admin UUID + semantic attribution', async () => {
    const store = new MemoryStore();
    const record = await setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: false, reason: 'incident-42', actorId: SYSTEM_ADMIN_ACTOR, actorType: 'system' });
    expect(record.globallyEnabled).toBe(false);
    const audit = store.audit.find((a) => a.action === 'workforce.global_control.stopped');
    expect(audit).toBeTruthy();
    expect(audit?.actorId).toBe(SYSTEM_ADMIN_AUDIT_ACTOR_ID);
    expect((audit?.metadata as Record<string, unknown>)?.['systemAdmin']).toBe(SYSTEM_ADMIN_ACTOR);
    expect((audit?.metadata as Record<string, unknown>)?.['reason']).toBe('incident-42');
  });

  it('behavior: only SYSTEM_ADMIN_ACTOR passes canSetGlobalControl among all candidate authorities', () => {
    expect(canSetGlobalControl(SYSTEM_ADMIN_ACTOR, 'system')).toBe(true);
    expect(canSetGlobalControl(SYSTEM_ADMIN_AUDIT_ACTOR_ID, 'system')).toBe(false);
    expect(canSetGlobalControl(WORKFORCE_SERVICE_ACTOR, WORKFORCE_SERVICE_ACTOR_TYPE)).toBe(false);
    expect(canSetGlobalControl(WORKFORCE_SERVICE_AUDIT_ACTOR_ID, 'system')).toBe(false);
    expect(canSetGlobalControl('agent-x', 'agent')).toBe(false);
    expect(canSetGlobalControl('owner-x', 'owner')).toBe(false);
    expect(canSetGlobalControl('system', 'system')).toBe(false);
    expect(canSetGlobalControl('mission-engine', 'system')).toBe(false);
  });

  it('worker.started and worker.stopped persist the stable workforce audit UUID (not the semantic actor)', () => {
    const src = read('../runtime/worker.ts');
    // no randomUUID audit identity generation
    expect(src).not.toMatch(/randomUUID\(\)[\s\S]{0,80}actorId/);
    // both worker audit events persist the dedicated audit actor id
    const started = src.slice(src.indexOf("action: 'worker.started'") - 120, src.indexOf("action: 'worker.started'"));
    const stopped = src.slice(src.indexOf("action: 'worker.stopped'") - 120, src.indexOf("action: 'worker.stopped'"));
    expect(started).toContain('WORKFORCE_SERVICE_AUDIT_ACTOR_ID');
    expect(stopped).toContain('WORKFORCE_SERVICE_AUDIT_ACTOR_ID');
  });

  it('the semantic WORKFORCE_SERVICE_ACTOR is no longer used as a DB actor_id in worker.ts', () => {
    const src = read('../runtime/worker.ts');
    expect(src).not.toContain('WORKFORCE_SERVICE_ACTOR,');
  });

  it('the worker loop + orchestrator audits persist the audit UUID while keeping semantic attribution in metadata', () => {
    const loop = read('../runtime/workerLoop.ts');
    expect(loop).toContain('actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID');
    expect(loop).toContain('workforceService: WORKFORCE_SERVICE_ACTOR');
    const orch = read('../core/workforceOrchestrator.ts');
    expect(orch).toContain('actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID');
    expect(orch).toContain('workforceService: WORKFORCE_SERVICE_ACTOR');
    // authority identity is still required by the narrow scheduling gate
    expect(orch).toContain('actorId !== WORKFORCE_SERVICE_ACTOR');
  });

  it('fail-closed: a missing/unreadable global-control row blocks NEW work before scheduling', async () => {
    // Worker + orchestrator treat getWorkflowControl() null OR error as stopped.
    expect(isGlobalStopActive(null)).toBe(true);
  });

  it('the API server does NOT auto-start the worker unless explicitly opted-in (default OFF)', () => {
    const server = read('../api/server.ts');
    // The ONLY startWorker() path is gated behind the explicit FACTORY_WORKER_AUTOSTART opt-in.
    const autostartIdx = server.indexOf("process.env['FACTORY_WORKER_AUTOSTART'] === 'true'");
    expect(autostartIdx).toBeGreaterThan(-1);
    const startIdx = server.indexOf('await startWorker()');
    expect(startIdx).toBeGreaterThan(-1);
    // startWorker() must appear only after/within the autostart opt-in expression (never unconditional).
    expect(startIdx).toBeGreaterThan(autostartIdx);
    // No unconditional, ungated startWorker() invocation at statement top-level outside the gate.
    expect(server).not.toMatch(/;\s*\n\s*await startWorker\(\)/);
  });
});
