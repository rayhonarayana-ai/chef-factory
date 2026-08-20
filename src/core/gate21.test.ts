// Gate 21 — Pipeline Crash Resilience
// Tests failure isolation (audit/cost), stale task recovery, and process lifecycle.

import { describe, expect, it } from 'vitest';
import { CommandPipeline, type ActorContext, type ExecutionOutcome, type ExecutionRunner } from './pipeline.js';
import { MemoryStore } from '../testing/memoryStore.js';
import type { Store } from './ports.js';
import type { AuditEvent, CostEvent } from './types.js';

const owner: ActorContext = { ownerId: 'owner-1', actorId: 'owner-1', actorType: 'owner' };

function okRunner(output: unknown, cost = 0): ExecutionRunner {
  return {
    execute: async (): Promise<ExecutionOutcome> => ({ ok: true, output, cost, modelId: 'm1', runtimeId: 'r1' }),
  };
}

async function storeWithProject() {
  const store = new MemoryStore();
  await store.createProject('owner-1', { name: 'Chef HQ', slug: 'chef-hq', description: 'main' });
  return store;
}

// Throwing store: overrides only recordAudit/recordCost to throw, all else delegates to MemoryStore.
function throwingStore(opts: { audit?: boolean; cost?: boolean } = {}): Store {
  const base = new MemoryStore();
  const handlers = {
    get recordAudit() {
      if (opts.audit) return async (_e: AuditEvent) => { throw new Error('audit persistence failed'); };
      return base.recordAudit.bind(base);
    },
    get recordCost() {
      if (opts.cost) return async (_e: CostEvent) => { throw new Error('cost persistence failed'); };
      return base.recordCost.bind(base);
    },
  };
  return new Proxy(base, {
    get(target, prop: string) {
      if (prop === 'recordAudit') return handlers.recordAudit;
      if (prop === 'recordCost') return handlers.recordCost;
      const val = (target as Record<string, unknown>)[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}

// ================================================================
// TEST A — HEALTHY PIPELINE PATH
// ================================================================

describe('Gate 21 — TEST A: Healthy Pipeline Path', () => {
  it('audit and cost persistence succeed — pipeline completes normally', async () => {
    const store = await storeWithProject();
    const p = new CommandPipeline(store, okRunner({ result: 'ok' }, 0.5));
    const r = await p.run(owner, 'create task "report" in chef-hq');
    expect(r.outcome).toBe('executed');
    expect(r.task?.status).toBe('completed');
    expect(store.audit.some((a) => a.action === 'task.completed')).toBe(true);
    expect(store.costs).toHaveLength(1);
    expect(store.costs[0].amount).toBe(0.5);
  });

  it('no warning emitted for successful persistence', async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => { warnings.push(msg); };
    try {
      const store = await storeWithProject();
      const p = new CommandPipeline(store, okRunner({}));
      await p.run(owner, 'status in chef-hq');
      expect(warnings.filter((w) => w.includes('[Gate 21]'))).toHaveLength(0);
    } finally {
      console.warn = origWarn;
    }
  });
});

// ================================================================
// TEST B — AUDIT PERSISTENCE FAILURE
// ================================================================

describe('Gate 21 — TEST B: Audit Persistence Failure', () => {
  it('pipeline does NOT crash when recordAudit fails', async () => {
    const store = throwingStore({ audit: true });
    await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const p = new CommandPipeline(store, okRunner({ data: 'done' }));
    const r = await p.run(owner, 'status in p');
    expect(r.outcome).toBe('executed');
    expect(r.task?.status).toBe('completed');
  });

  it('failure is observable via console.warn', async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => { warnings.push(String(msg)); };
    try {
      const store = throwingStore({ audit: true });
      await store.createProject('owner-1', { name: 'P', slug: 'p' });
      const p = new CommandPipeline(store, okRunner({}));
      await p.run(owner, 'status in p');
      expect(warnings.some((w) => w.includes('[Gate 21]') && w.includes('Audit persistence failed'))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  it('no false claim that audit succeeded', async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => { warnings.push(String(msg)); };
    try {
      const store = throwingStore({ audit: true });
      await store.createProject('owner-1', { name: 'P', slug: 'p' });
      const p = new CommandPipeline(store, okRunner({}));
      const r = await p.run(owner, 'status in p');
      expect(r.outcome).toBe('executed');
      // The warning explicitly says "failed" — no false success claim
      expect(warnings.some((w) => w.includes('failed'))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  it('task execution behavior remains valid', async () => {
    const store = throwingStore({ audit: true });
    await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const p = new CommandPipeline(store, okRunner({ result: 'x' }));
    const r = await p.run(owner, 'create task "test" in p');
    expect(r.outcome).toBe('executed');
    expect(r.task).not.toBeNull();
    expect(r.explanation.decision).toContain('Executed');
  });

  it('no automatic retry occurs', async () => {
    const store = throwingStore({ audit: true });
    await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const p = new CommandPipeline(store, okRunner({}));
    const r = await p.run(owner, 'status in p');
    expect(r.outcome).not.toBe('retry_pending');
    expect(r.outcome).toBe('executed');
  });
});

// ================================================================
// TEST C — COST PERSISTENCE FAILURE
// ================================================================

describe('Gate 21 — TEST C: Cost Persistence Failure', () => {
  it('pipeline does NOT crash when recordCost fails', async () => {
    const store = throwingStore({ cost: true });
    await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const p = new CommandPipeline(store, okRunner({ result: 'ok' }, 1.5));
    const r = await p.run(owner, 'create task "x" in p');
    expect(r.outcome).toBe('executed');
    expect(r.task?.status).toBe('completed');
  });

  it('failure is observable', async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => { warnings.push(String(msg)); };
    try {
      const store = throwingStore({ cost: true });
      await store.createProject('owner-1', { name: 'P', slug: 'p' });
      const p = new CommandPipeline(store, okRunner({}, 2.0));
      await p.run(owner, 'create task "x" in p');
      expect(warnings.some((w) => w.includes('[Gate 21]') && w.includes('Cost persistence failed'))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  it('task lifecycle remains valid', async () => {
    const store = throwingStore({ cost: true });
    await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const p = new CommandPipeline(store, okRunner({ out: 'data' }, 0.75));
    const r = await p.run(owner, 'create task "y" in p');
    expect(r.outcome).toBe('executed');
    expect(r.task?.status).toBe('completed');
  });

  it('no automatic retry on cost failure', async () => {
    const store = throwingStore({ cost: true });
    await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const p = new CommandPipeline(store, okRunner({}, 3.0));
    const r = await p.run(owner, 'status in p');
    expect(r.outcome).toBe('executed');
  });

  it('no duplicate cost record created', async () => {
    const store = throwingStore({ cost: true });
    await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const p = new CommandPipeline(store, okRunner({}, 1.0));
    await p.run(owner, 'create task "z" in p');
    // Cost write failed — should be 0 records in store
    expect(store.costs).toHaveLength(0);
  });
});

// ================================================================
// TEST D — MULTIPLE PERSISTENCE FAILURES
// ================================================================

describe('Gate 21 — TEST D: Multiple Persistence Failures', () => {
  it('pipeline survives when both audit AND cost fail', async () => {
    const store = throwingStore({ audit: true, cost: true });
    await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const p = new CommandPipeline(store, okRunner({ ok: true }, 5.0));
    const r = await p.run(owner, 'create task "multi" in p');
    expect(r.outcome).toBe('executed');
    expect(r.task?.status).toBe('completed');
  });

  it('failures remain observable', async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => { warnings.push(String(msg)); };
    try {
      const store = throwingStore({ audit: true, cost: true });
      await store.createProject('owner-1', { name: 'P', slug: 'p' });
      const p = new CommandPipeline(store, okRunner({}, 1.0));
      await p.run(owner, 'status in p');
      const gate21Warnings = warnings.filter((w) => w.includes('[Gate 21]'));
      expect(gate21Warnings.length).toBeGreaterThanOrEqual(1);
    } finally {
      console.warn = origWarn;
    }
  });

  it('task execution does not become stuck', async () => {
    const store = throwingStore({ audit: true, cost: true });
    await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const p = new CommandPipeline(store, okRunner({}));
    const r = await p.run(owner, 'status in p');
    expect(r.outcome).not.toBe('failed');
    expect(r.outcome).not.toBe('retry_pending');
    expect(r.outcome).toBe('executed');
  });
});

// ================================================================
// TEST E — STALE RUNNING TASK RECOVERY
// ================================================================

describe('Gate 21 — TEST E: Stale RUNNING Task Recovery', () => {
  it('stale RUNNING task transitions to FAILED', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', {
      projectId: project.id,
      title: 'stale task',
      status: 'running',
    });
    // Manually set startedAt to 15 minutes ago
    task.startedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    store.tasks[0] = task;

    const recovered = await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(recovered).toBe(1);
    expect(task.status).toBe('failed');
    expect(task.error).toMatchObject({ message: expect.stringContaining('Stale RUNNING task') });
    expect(task.completedAt).not.toBeNull();
  });

  it('no automatic re-execution occurs', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', {
      projectId: project.id,
      title: 'stale task',
      status: 'running',
    });
    task.startedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    store.tasks[0] = task;

    await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(task.status).toBe('failed');
    // NOT queued — no retry
  });

  it('no transition to QUEUED occurs', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', {
      projectId: project.id,
      title: 'stale',
      status: 'running',
    });
    task.startedAt = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    store.tasks[0] = task;

    await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(task.status).not.toBe('queued');
    expect(task.status).toBe('failed');
  });

  it('no retry loop starts', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', {
      projectId: project.id,
      title: 'stale',
      status: 'running',
    });
    task.startedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    store.tasks[0] = task;

    const recovered = await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(recovered).toBe(1);
    // Verify no task was re-executed or re-queued
    expect(store.tasks.every((t) => t.status === 'failed' || t.status !== 'running')).toBe(true);
  });
});

// ================================================================
// TEST F — FRESH RUNNING TASK MUST SURVIVE
// ================================================================

describe('Gate 21 — TEST F: Fresh RUNNING Task Immunity', () => {
  it('fresh RUNNING task remains RUNNING', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', {
      projectId: project.id,
      title: 'fresh task',
      status: 'running',
    });
    task.startedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 minutes ago — fresh
    store.tasks[0] = task;

    await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(task.status).toBe('running');
  });

  it('fresh task is NOT marked FAILED', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', {
      projectId: project.id,
      title: 'active',
      status: 'running',
    });
    task.startedAt = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    store.tasks[0] = task;

    await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(task.status).not.toBe('failed');
    expect(task.completedAt).toBeNull();
  });

  it('fresh task is NOT queued', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', {
      projectId: project.id,
      title: 'active',
      status: 'running',
    });
    task.startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    store.tasks[0] = task;

    await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(task.status).toBe('running');
  });

  it('fresh task is NOT modified unnecessarily', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', {
      projectId: project.id,
      title: 'active',
      status: 'running',
    });
    task.startedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const originalUpdatedAt = task.updatedAt;
    store.tasks[0] = task;

    await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(task.updatedAt).toBe(originalUpdatedAt);
  });
});

// ================================================================
// TEST G — RECOVERY IDEMPOTENCY
// ================================================================

describe('Gate 21 — TEST G: Recovery Idempotency', () => {
  it('first recovery transitions stale RUNNING → FAILED', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', {
      projectId: project.id,
      title: 'stale',
      status: 'running',
    });
    task.startedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    store.tasks[0] = task;

    const r1 = await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(r1).toBe(1);
    expect(task.status).toBe('failed');
  });

  it('subsequent recovery does not create duplicate transitions', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', {
      projectId: project.id,
      title: 'stale',
      status: 'running',
    });
    task.startedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    store.tasks[0] = task;

    await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(task.status).toBe('failed');

    // Run recovery again — should recover 0 tasks (already failed)
    const r2 = await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(r2).toBe(0);
    expect(task.status).toBe('failed');
  });

  it('no duplicate task created', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', {
      projectId: project.id,
      title: 'stale',
      status: 'running',
    });
    task.startedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    store.tasks[0] = task;
    const taskCount = store.tasks.length;

    await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(store.tasks.length).toBe(taskCount);
  });

  it('no automatic execution after recovery', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', {
      projectId: project.id,
      title: 'stale',
      status: 'running',
    });
    task.startedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    store.tasks[0] = task;

    await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    // Task is failed, not queued — no retry will happen
    expect(task.status).toBe('failed');
  });
});

// ================================================================
// TEST H — HEALTHY TASK IMMUNITY (mixed states)
// ================================================================

describe('Gate 21 — TEST H: Mixed-State Recovery', () => {
  it('only stale RUNNING tasks are affected', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });

    // Create tasks in various states
    const staleRunning = await store.createTask('owner-1', { projectId: project.id, title: 'stale-running', status: 'running' });
    staleRunning.startedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    store.tasks[store.tasks.length - 1] = staleRunning;

    const freshRunning = await store.createTask('owner-1', { projectId: project.id, title: 'fresh-running', status: 'running' });
    freshRunning.startedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    store.tasks[store.tasks.length - 1] = freshRunning;

    const failed = await store.createTask('owner-1', { projectId: project.id, title: 'already-failed', status: 'failed' });
    store.tasks[store.tasks.length - 1] = failed;

    const completed = await store.createTask('owner-1', { projectId: project.id, title: 'completed', status: 'completed' });
    store.tasks[store.tasks.length - 1] = completed;

    const queued = await store.createTask('owner-1', { projectId: project.id, title: 'queued', status: 'queued' });
    store.tasks[store.tasks.length - 1] = queued;

    const created = await store.createTask('owner-1', { projectId: project.id, title: 'created', status: 'created' });
    store.tasks[store.tasks.length - 1] = created;

    const recovered = await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));

    expect(recovered).toBe(1); // Only staleRunning
    expect(staleRunning.status).toBe('failed');
    expect(freshRunning.status).toBe('running');
    expect(failed.status).toBe('failed');
    expect(completed.status).toBe('completed');
    expect(queued.status).toBe('queued');
    expect(created.status).toBe('created');
  });

  it('no RUNNING tasks without startedAt are affected', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', { projectId: project.id, title: 'no-startedAt', status: 'running' });
    // startedAt is null by default
    store.tasks[store.tasks.length - 1] = task;

    const recovered = await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(recovered).toBe(0);
    expect(task.status).toBe('running');
  });
});

// ================================================================
// ADDITIONAL — No automatic retry / No queued recovery
// ================================================================

describe('Gate 21 — No Automatic Retry Verification', () => {
  it('recovered task is NOT queued for retry', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', { projectId: project.id, title: 'stale', status: 'running' });
    task.startedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    store.tasks[0] = task;

    await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(task.status).toBe('failed');
    expect(task.status).not.toBe('queued');
  });

  it('recovered task has error message about restart', async () => {
    const store = new MemoryStore();
    const project = await store.createProject('owner-1', { name: 'P', slug: 'p' });
    const task = await store.createTask('owner-1', { projectId: project.id, title: 'stale', status: 'running' });
    task.startedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    store.tasks[0] = task;

    await store.recoverStaleRunningTasks(new Date(Date.now() - 10 * 60 * 1000));
    expect(task.error).toMatchObject({ message: expect.stringContaining('Process restarted') });
  });
});

// ================================================================
// Store interface verification
// ================================================================

describe('Gate 21 — Store Interface', () => {
  it('recoverStaleRunningTasks method exists on Store interface', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/core/ports.ts',
      'utf-8',
    );
    expect(content).toContain('recoverStaleRunningTasks');
  });

  it('MemoryStore implements recoverStaleRunningTasks', async () => {
    const store = new MemoryStore();
    expect(typeof store.recoverStaleRunningTasks).toBe('function');
  });

  it('SupabaseStore implements recoverStaleRunningTasks', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(
      'C:/Users/user11/Documents/Default Project/chef-factory/src/db/repo.ts',
      'utf-8',
    );
    expect(content).toContain('async recoverStaleRunningTasks');
  });
});
