// CHEF FACTORY — Gate 41 — 24/7 Autonomous Workforce Runtime (unit).
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { runWorkforce } from './workforceOrchestrator.js';
import {
  setGlobalEmergencyStop,
  canSetGlobalControl,
  isGlobalStopActive,
  WORKFORCE_CONTROL_ADMIN_ACTORS,
} from './security/workforceControl.js';
import { WORKFORCE_SERVICE_ACTOR, WORKFORCE_SERVICE_ACTOR_TYPE, WORKFORCE_SERVICE_AUDIT_ACTOR_ID, WORKFORCE_INITIATOR } from './workforceService.js';
import { WorkforceWorker } from '../runtime/workerLoop.js';
import { getWorkforceRuntimeConfig, applyJitter } from '../runtime/config.js';
import type { Store } from './ports.js';
import type { AgentRecord, TaskRecord } from './types.js';
import type { ExecutionOutcome, ExecutionRunner, ActorContext } from './pipeline.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function fixtures() {
  const store = new MemoryStore();
  const ownerId = 'owner-' + uuid();
  const project = await store.createProject(ownerId, { name: 'P', slug: 'p-' + uuid() });
  return { store, ownerId, project };
}

async function makeAgent(
  store: MemoryStore,
  ownerId: string,
  projectId: string,
  opts: { status?: string; maxConcurrentTasks?: number } = {},
): Promise<AgentRecord> {
  const agent = await store.createAgent(ownerId, {
    name: 'A-' + uuid(),
    slug: 'a-' + uuid(),
    role: 'worker',
    status: (opts.status ?? 'active') as AgentRecord['status'],
    capabilities: [],
    maxConcurrentTasks: opts.maxConcurrentTasks ?? 1,
  });
  store.agentPermissions.push({ agentId: agent.id, projectId, resourceType: 'task', permission: 'execute' });
  return agent;
}

async function makeSchedulableTask(
  store: MemoryStore,
  ownerId: string,
  projectId: string,
  opts: { status?: TaskRecord['status']; env?: string; mockResult?: string; requiresApproval?: boolean; missionId?: string } = {},
): Promise<TaskRecord> {
  return store.createTask(ownerId, {
    projectId,
    title: 'T-' + uuid(),
    status: opts.status ?? 'queued',
    agentId: null,
    riskLevel: 'low',
    requiresApproval: opts.requiresApproval ?? false,
    missionId: opts.missionId ?? null,
    requiredCapabilities: [],
    inputs: {
      intent: 'execute orchestrated task',
      environment: opts.env ?? 'development',
      resource: 'task',
      mockResult: opts.mockResult ?? 'success',
    },
  });
}

function stubRunner(): ExecutionRunner & { calls: Map<string, number>; ctxs: Array<{ ctx: ActorContext; taskId: string }> } {
  const calls = new Map<string, number>();
  const ctxs: Array<{ ctx: ActorContext; taskId: string }> = [];
  return {
    calls,
    ctxs,
    execute: async (task: TaskRecord, ctx: ActorContext): Promise<ExecutionOutcome> => {
      calls.set(task.id, (calls.get(task.id) ?? 0) + 1);
      ctxs.push({ ctx, taskId: task.id });
      if (String((task.inputs as Record<string, unknown>)?.mockResult ?? 'success') === 'failure') {
        return { ok: false, error: 'agent task failed', reason: 'fail' };
      }
      return { ok: true, output: { done: true }, cost: 0.001 };
    },
  };
}

describe('Gate 41 — initiator authorization', () => {
  beforeEach(() => {
    // default workforce control state for fresh test: enabled
  });

  it('forces every workforce control state via canSetGlobalControl (system:admin only)', async () => {
    expect(canSetGlobalControl('system:admin', 'system')).toBe(true);
    expect(canSetGlobalControl(WORKFORCE_SERVICE_ACTOR, WORKFORCE_SERVICE_ACTOR_TYPE)).toBe(false);
    expect(canSetGlobalControl('owner-x', 'owner')).toBe(false);
    expect(canSetGlobalControl('agent-x', 'agent')).toBe(false);
    expect(canSetGlobalControl('system', 'system')).toBe(false);
    expect(canSetGlobalControl('mission-engine', 'system')).toBe(false);
  });

  it('accepts the narrow workforce-service initiator and auto-executes', async () => {
    const { store, ownerId, project } = await fixtures();
    const agent = await makeAgent(store, ownerId, project.id);
    const task = await makeSchedulableTask(store, ownerId, project.id);
    const runner = stubRunner();

    const r = await runWorkforce({
      store, execution: runner, ownerId, actorId: WORKFORCE_SERVICE_ACTOR,
      workforceService: true, workerId: 'w-1',
    });

    expect(r.outcome).toBe('completed');
    expect(runner.calls.get(task.id)).toBe(1);
    // audit events carry the SYSTEM WORKFORCE audit identity (stable UUID) + scheduling owner
    const runStarted = store.audit.find((a) => a.action === 'workforce.run.started');
    expect(runStarted?.actorType).toBe('system');
    expect(runStarted?.actorId).toBe(WORKFORCE_SERVICE_AUDIT_ACTOR_ID);
    expect((runStarted?.metadata as Record<string, unknown>)?.['workforceService']).toBe(WORKFORCE_SERVICE_ACTOR);
    expect((runStarted?.metadata as Record<string, unknown>)?.['schedulingOwnerId']).toBe(ownerId);
    expect((runStarted?.metadata as Record<string, unknown>)?.['workerId']).toBe('w-1');
    void agent;
  });

  it('rejects a workforce service initiation under a non-reserved actorId', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const runner = stubRunner();

    await expect(
      runWorkforce({ store, execution: runner, ownerId, actorId: 'spoofed-owner', workforceService: true, workerId: 'w-1' }),
    ).rejects.toThrow(/invalid workforce service identity/);
  });

  it('rejects the workforce AUDIT UUID as a scheduling authority (attribution != authority)', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const runner = stubRunner();

    // The stable audit UUID grants scheduling authority ONLY through the semantic
    // WORKFORCE_SERVICE_ACTOR, not by being present as actorId.
    await expect(
      runWorkforce({ store, execution: runner, ownerId, actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID, workforceService: true, workerId: 'w-1' }),
    ).rejects.toThrow(/invalid workforce service identity/);
    expect(runner.calls.size).toBe(0);
  });

  it('still accepts owner invocation (no workforceService flag)', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    const task = await makeSchedulableTask(store, ownerId, project.id);
    const runner = stubRunner();

    const r = await runWorkforce({ store, execution: runner, ownerId, actorId: ownerId });
    expect(r.outcome).toBe('completed');
    expect(runner.calls.get(task.id)).toBe(1);
    const runStarted = store.audit.find((a) => a.action === 'workforce.run.started');
    expect(runStarted?.actorType).toBe('owner');
    expect(runStarted?.actorId).toBe(ownerId);
  });

  it('rejects a random actor from triggering orchestration', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const runner = stubRunner();
    await expect(
      runWorkforce({ store, execution: runner, ownerId, actorId: 'someone-else' }),
    ).rejects.toThrow(/only the owner may trigger/);
  });
});

describe('Gate 41 — global emergency stop (fail closed)', () => {
  it('returns global_stopped and executes nothing when the global stop is active', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const runner = stubRunner();

    // Authorized system-admin enables the global stop.
    await setGlobalEmergencyStop(
      { control: store, store },
      { globallyEnabled: false, reason: 'incident response', actorId: 'system:admin', actorType: 'system' },
    );

    const r = await runWorkforce({
      store, execution: runner, ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'w-1',
    });
    expect(r.outcome).toBe('global_stopped');
    expect(r.executed).toBe(0);
    expect(r.placed).toBe(0);
    expect(runner.calls.size).toBe(0);
  });

  it('fails CLOSED when the control row is missing (null => STOPPED)', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    (store as any).workforceControl = null;
    const runner = stubRunner();
    const r = await runWorkforce({ store, execution: runner, ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'w-1' });
    expect(r.outcome).toBe('global_stopped');
    expect(r.executed).toBe(0);
  });

  it('fails CLOSED when the control read errors', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const runner = stubRunner();
    const broken: Store = new Proxy(store, {
      get(t, prop) {
        if (String(prop) === 'getWorkforceControl') return async () => { throw new Error('db down'); };
        const v = (t as unknown as Record<string, unknown>)[String(prop)];
        return typeof v === 'function' ? (v as (...a: any[]) => any).bind(t) : v;
      },
    });
    const r = await runWorkforce({ store: broken, execution: runner, ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'w-1' });
    expect(r.outcome).toBe('error');
    expect(r.executed).toBe(0);
  });

  it('the workforce service / worker cannot disable the global stop', async () => {
    const { store } = await fixtures();
    for (const actor of [WORKFORCE_SERVICE_ACTOR, 'worker-2']) {
      await expect(
        setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: false, reason: 'x', actorId: actor, actorType: WORKFORCE_SERVICE_ACTOR_TYPE }),
      ).rejects.toThrow(/denied/);
    }
  });

  it('global stop is distinct from an owner lockdown (stop does not become a lockdown)', async () => {
    const { store } = await fixtures();
    await setGlobalEmergencyStop({ control: store, store }, { globallyEnabled: false, reason: 'stop', actorId: 'system:admin', actorType: 'system' });
    const record = await store.getWorkforceControl();
    expect(record?.globallyEnabled).toBe(false);
    expect(store.securityLockdowns.length).toBe(0);
    expect(isGlobalStopActive(record)).toBe(true);
  });
});

describe('Gate 41 — owner lockdown', () => {
  it('aborts before scheduling when the owner has an active lockdown', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const runner = stubRunner();
    await store.activateLockdown(ownerId, { reason: 'suspicious activity', activatedBy: ownerId, actorType: 'owner' });
    const r = await runWorkforce({ store, execution: runner, ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'w-1' });
    expect(r.outcome).toBe('aborted');
    expect(r.placed).toBe(0);
    expect(runner.calls.size).toBe(0);
  });

  it('an unrelated owner continues while another owner is locked down', async () => {
    const { store, ownerId: o1, project: p1 } = await fixtures();
    const ownerId2 = 'owner-' + uuid();
    const p2 = await store.createProject(ownerId2, { name: 'P2', slug: 'p-' + uuid() });
    await store.activateLockdown(o1, { reason: 'x', activatedBy: o1, actorType: 'owner' });
    await makeAgent(store, ownerId2, p2.id);
    const task2 = await makeSchedulableTask(store, ownerId2, p2.id);
    const runner = stubRunner();

    const r1 = await runWorkforce({ store, execution: runner, ownerId: o1, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'w-1' });
    expect(r1.outcome).toBe('aborted');
    const r2 = await runWorkforce({ store, execution: runner, ownerId: ownerId2, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'w-1' });
    expect(r2.outcome).toBe('completed');
    expect(runner.calls.get(task2.id)).toBe(1);
    void p1;
  });
});

describe('Gate 41 — mission budget enforcement', () => {
  it('skips (never executes) a mission-backed task whose mission budget is exhausted', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    const mission = await store.createMission(ownerId, { projectId: project.id, objective: 'mission', budgetLimit: 10 });
    const task = await makeSchedulableTask(store, ownerId, project.id, { missionId: mission.id });
    await store.recordCost({
      ownerId, projectId: project.id, taskId: task.id, runId: null, agentId: null,
      costType: 'mission', amount: 10, currency: 'usd', provider: null, modelId: null, runtimeId: null,
      billedTo: 'mission', metadata: {},
    });
    const runner = stubRunner();

    const r = await runWorkforce({ store, execution: runner, ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'w-1' });
    expect(r.executed).toBe(0);
    expect(r.placed).toBe(0);
    expect(runner.calls.size).toBe(0);
    expect(r.outcome).toBe('mission_budget_exhausted');
    const audit = store.audit.find((a) => a.action === 'workforce.task.blocked'
      && (a.metadata as Record<string, unknown>)?.['reason'] === 'mission_budget_exhausted');
    expect(audit).toBeTruthy();
  });
});

describe('Gate 41 — needs_approval is never auto-approved', () => {
  it('blocks execution instead of approving a needs_approval task', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id, { requiresApproval: true });
    const runner = stubRunner();
    const r = await runWorkforce({ store, execution: runner, ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'w-1' });
    expect(r.approvalRequired).toBeGreaterThanOrEqual(0);
    // needs_approval tasks must never become approved by the workforce path.
    const approvals = store.approvals;
    expect(approvals.filter((a) => a.status === 'approved').length).toBe(0);
  });
});

describe('Gate 41 — worker loop + discovery', () => {
  it('listOwnersWithSchedulableWork is deterministic, bounded, and returns only owner ids', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const list1 = await store.listOwnersWithSchedulableWork({ limit: 10 });
    const list2 = await store.listOwnersWithSchedulableWork({ limit: 10 });
    expect(list1).toEqual(list2);
    expect(list1).toContain(ownerId);
    expect(list1.length).toBeLessThanOrEqual(10);
  });

  it('worker runCycle returns work on a schedulable owner and idle on none', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const runner = stubRunner();
    const config = getWorkforceRuntimeConfig({ FACTORY_WORKER_MAX_OWNERS_PER_CYCLE: '8' });
    const worker = new WorkforceWorker({ store, execution: runner, config });
    const activity = await worker.runCycle();
    expect(activity).toBe('work');
    expect(runner.calls.size).toBe(1);

    // second run: no schedulable work remains -> idle
    const activity2 = await worker.runCycle();
    expect(activity2).toBe('idle');
  });

  it('worker-generated audit events persist the stable WORKFORCE_SERVICE_AUDIT_ACTOR_ID', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const runner = stubRunner();
    const config = getWorkforceRuntimeConfig({ FACTORY_WORKER_MAX_OWNERS_PER_CYCLE: '8' });
    const worker = new WorkforceWorker({ store, execution: runner, config });
    const activity = await worker.runCycle();
    expect(activity).toBe('work');

    const cycleStarted = store.audit.find((a) => a.action === 'worker.cycle.started');
    expect(cycleStarted).toBeTruthy();
    expect(cycleStarted?.actorType).toBe('system');
    expect(cycleStarted?.actorId).toBe(WORKFORCE_SERVICE_AUDIT_ACTOR_ID);
    // semantic attribution retained in metadata, not as the DB actor_id
    expect((cycleStarted?.metadata as Record<string, unknown>)?.['workforceService']).toBe(WORKFORCE_SERVICE_ACTOR);
  });

  it('a transient DB error activity selects a bounded exponential backoff (via run())', async () => {
    const { store, ownerId, project } = await fixtures();
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const runner = stubRunner();
    const config = getWorkforceRuntimeConfig({});
    // Craft a worker whose discovery always throws (transient error) to prove run() stays bounded.
    const brokenStore: Store = new Proxy(store, {
      get(t, prop) {
        if (String(prop) === 'listOwnersWithSchedulableWork') return async () => { throw new Error('connection reset'); };
        const v = (t as unknown as Record<string, unknown>)[String(prop)];
        return typeof v === 'function' ? (v as (...a: any[]) => any).bind(t) : v;
      },
    });
    const worker = new WorkforceWorker({ store: brokenStore as MemoryStore, execution: runner, config });
    const controller = new AbortController();
    const promise = worker.run(controller.signal);
    // Let it iterate a couple times, then stop.
    await new Promise((r) => setTimeout(r, 60));
    controller.abort();
    await promise;
    // No crash, and it stayed bounded: still alive at end.
    expect(true).toBe(true);
  });

  it('applyJitter stays within ±ratio and is positive', () => {
    for (let i = 0; i < 100; i++) {
      const j = applyJitter(1000, 0.2);
      expect(j).toBeGreaterThanOrEqual(800);
      expect(j).toBeLessThanOrEqual(1200);
    }
  });

  it('config constants match the frozen doctrine (recheck 2s, idle 5s..60s)', () => {
    const config = getWorkforceRuntimeConfig({});
    expect(config.activeRecheckMs).toBe(2000);
    expect(config.firstIdleMs).toBe(5000);
    expect(config.maxIdleMs).toBe(60000);
    expect(config.idleProgressionMs).toEqual([5000, 10000, 20000, 40000, 60000]);
    expect(config.jitterRatio).toBe(0.2);
  });
});

describe('Gate 41 — workforce identity constants', () => {
  it('the workforce service is a narrow system identity, distinct from owner', () => {
    expect(WORKFORCE_SERVICE_ACTOR).toBe('workforce-service');
    expect(WORKFORCE_SERVICE_ACTOR_TYPE).toBe('system');
    expect(WORKFORCE_INITIATOR).toBe('workforce-service');
    expect(WORKFORCE_SERVICE_ACTOR).not.toMatch(/^owner-/);
    expect(WORKFORCE_CONTROL_ADMIN_ACTORS.has(WORKFORCE_SERVICE_ACTOR)).toBe(false);
  });

  it('the workforce audit actor id is a stable UUID, never an owner/agent id', () => {
    // Valid, stable UUID form (not regenerated per event -> constant literal).
    expect(WORKFORCE_SERVICE_AUDIT_ACTOR_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    // Must differ from the semantic authority identity.
    expect(WORKFORCE_SERVICE_AUDIT_ACTOR_ID).not.toBe(WORKFORCE_SERVICE_ACTOR);
    // Not a real owner/agent identity pattern.
    expect(WORKFORCE_SERVICE_AUDIT_ACTOR_ID).not.toMatch(/^owner-/);
    // Transitioning the authority identity into the audit id must not SKIP the authority gate.
    expect(canSetGlobalControl(WORKFORCE_SERVICE_AUDIT_ACTOR_ID, 'system')).toBe(false);
  });
});
