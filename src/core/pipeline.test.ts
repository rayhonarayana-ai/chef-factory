import { describe, expect, it } from 'vitest';
import { CommandPipeline, type ActorContext, type ExecutionOutcome, type ExecutionRunner } from './pipeline.js';
import { MemoryStore } from '../testing/memoryStore.js';
import { SecurityGuardian } from './security/guardian.js';
import { toLockdownRecord } from './security/lockdown.js';
import { RateLimiter } from './security/rateLimit.js';
import { AnomalyDetector } from './security/anomaly.js';

const owner: ActorContext = { ownerId: 'owner-1', actorId: 'owner-1', actorType: 'owner' };

function okRunner(output: unknown, cost = 0): ExecutionRunner {
  return {
    execute: async (): Promise<ExecutionOutcome> => ({ ok: true, output, cost, modelId: 'm1', runtimeId: 'r1' }),
  };
}

async function storeWithChefHQ() {
  const store = new MemoryStore();
  await store.createProject('owner-1', { name: 'Chef HQ', slug: 'chef-hq', description: 'the main project' });
  return store;
}

describe('CommandPipeline (OWNER COMMAND → … → OUTCOME)', () => {
  it('executes an informational command deterministically (no model invented)', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({ daily_status: { activeTasks: 1 } }));
    const r = await p.run(owner, 'status in chef-hq');
    expect(r.outcome).toBe('executed');
    expect(r.task?.status).toBe('completed');
    expect(r.explanation.outcome).toBe('executed');
    expect(r.explanation.confidence).toBe(1);
  });

  it('creates and executes a scoped task command', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({ result: 'ok' }, 0.5));
    const r = await p.run(owner, 'create task "write report" in chef-hq');
    expect(r.outcome).toBe('executed');
    expect(r.task?.projectId).toBe(store.projects[0].id);
    expect(r.task?.title).toContain('write report');
    expect(r.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    // cost recorded because runner reported a cost
    expect(store.costs).toHaveLength(1);
    expect(store.audit.some((a) => a.action === 'task.completed')).toBe(true);
  });

  it('unknown command → unknown (never fabricated certainty)', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}));
    const r = await p.run(owner, 'zzz the qux');
    expect(r.outcome).toBe('unknown');
    expect(r.task).toBeNull();
    expect(r.explanation.outcome).toBe('blocked');
    expect(store.audit.some((a) => a.action === 'command.unknown')).toBe(true);
  });

  it('unknown project → unknown_project with nothing executed', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}));
    const r = await p.run(owner, 'create task "x" in nonexistent-project');
    expect(r.outcome).toBe('unknown_project');
    expect(r.task).toBeNull();
    expect(store.audit.some((a) => a.action === 'command.unknown_project')).toBe(true);
  });

  it('ambiguous command → blocked, not guessed', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}));
    const r = await p.run(owner, 'list tasks and projects');
    expect(r.outcome).toBe('unknown');
    expect(r.explanation.why).toContain('ambiguous');
  });

  it('production deploy → waiting_approval with a pending approval', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}));
    const r = await p.run(owner, 'deploy the app in chef-hq production');
    expect(r.outcome).toBe('waiting_approval');
    expect(r.approvalId).not.toBeNull();
    expect(r.task?.status).toBe('needs_approval');
    expect(r.task?.approvalRequired).toBe(true);
    expect(store.approvals.some((a) => a.status === 'pending' && a.action === 'deploy')).toBe(true);
  });

  it('delete → require_approval regardless of environment (protected class)', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}));
    const r = await p.run(owner, 'delete task "archive" in chef-hq');
    expect(r.outcome).toBe('waiting_approval');
    expect(store.approvals.some((a) => a.action === 'delete')).toBe(true);
  });

  it('explicit DENY in owner policy always wins (even for read)', async () => {
    const store = await storeWithChefHQ();
    await store.setPreference('owner-1', 'policy', 'explicit_deny', true);
    const p = new CommandPipeline(store, okRunner({}));
    const r = await p.run(owner, 'status in chef-hq');
    expect(r.outcome).toBe('denied');
    expect(r.task?.status).toBe('cancelled');
    expect(r.explanation.outcome).toBe('denied');
  });

  it('deny:actionType policy blocks that action class', async () => {
    const store = await storeWithChefHQ();
    await store.setPreference('owner-1', 'policy', 'deny:execute', 'deny');
    const p = new CommandPipeline(store, okRunner({}));
    const r = await p.run(owner, 'execute task "001" in chef-hq');
    expect(r.outcome).toBe('denied');
  });

  it('owner autonomy policy can force auto for a class', async () => {
    const store = await storeWithChefHQ();
    await store.setPreference('owner-1', 'autonomy', 'deploy', 'auto');
    const p = new CommandPipeline(store, okRunner({}, 1));
    const r = await p.run(owner, 'deploy the app in chef-hq production');
    expect(r.outcome).toBe('executed');
  });

  it('bounded retries: first failure → retry_pending with attempts recorded, never auto-looped', async () => {
    const store = await storeWithChefHQ();
    const failing: ExecutionRunner = { execute: async () => ({ ok: false, error: new Error('boom'), reason: 'boom' }) };
    const p = new CommandPipeline(store, failing);
    const r1 = await p.run(owner, 'create task "flaky" in chef-hq');
    expect(r1.outcome).toBe('retry_pending');
    expect(r1.task?.attempts).toBe(1);
    expect(r1.task?.status).toBe('queued');
    // No runaway loop: exactly one task exists, exactly one failed run recorded.
    expect((await store.listTasks('owner-1')).length).toBe(1);
    expect(store.taskRuns.every((x) => x.status === 'failed')).toBe(true);
    expect(store.audit.some((a) => a.action === 'task.failed_retry_pending')).toBe(true);
  });

  it('agents need scoped permission (least privilege, no implicit grants)', async () => {
    const store = await storeWithChefHQ();
    store.agents.push({
      id: 'agent-a', name: 'A', slug: 'a', role: 'worker', status: 'active',
      permissions: [{ projectId: store.projects[0].id, resourceType: 'task', permission: 'write' }],
    });
    const agent: ActorContext = { ownerId: 'owner-1', actorId: 'agent-a', actorType: 'agent', agentId: 'agent-a' };
    const p = new CommandPipeline(store, okRunner({}));
    const ok = await p.run(agent, 'create task "allowed" in chef-hq');
    expect(ok.outcome).toBe('executed');
  });

  it('agents without permission are denied — project scope isolation', async () => {
    const store = await storeWithChefHQ();
    await store.createProject('owner-1', { name: 'Other', slug: 'other' });
    store.agents.push({
      id: 'agent-a', name: 'A', slug: 'a', role: 'worker', status: 'active',
      permissions: [{ projectId: store.projects[0].id, resourceType: 'task', permission: 'write' }],
    });
    const agent: ActorContext = { ownerId: 'owner-1', actorId: 'agent-a', actorType: 'agent', agentId: 'agent-a' };
    const p = new CommandPipeline(store, okRunner({}));
    const denied = await p.run(agent, 'create task "not allowed" in other');
    expect(denied.outcome).toBe('denied');
    // The only artifact in the other project is the cancellation record — no work leaked.
    const tasksInOther = await store.listTasks('owner-1', { projectId: store.projects[1].id });
    expect(tasksInOther).toHaveLength(1);
    expect(tasksInOther[0]?.status).toBe('cancelled');
  });

  it('audit trail never contains fabricated or secret-like content', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({ result: 'ok' }));
    await p.run(owner, 'create task "rotate token sbp_abc123" in chef-hq');
    const serialized = JSON.stringify(store.audit);
    expect(serialized).not.toContain('sbp_abc123');
    // Every audit event has a correlation id and is insert-only by contract
    for (const a of store.audit) expect(a.correlationId).toBeTruthy();
    expect(store.audit.length).toBeGreaterThanOrEqual(4);
  });

  it('recorded decisions meet journal invariants (options ≥ 2, confidence bounded)', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, okRunner({}, 0.1));
    await p.run(owner, 'create task "x" in chef-hq');
    for (const d of store.decisions) {
      expect(d.options.length).toBeGreaterThanOrEqual(2);
      expect(d.confidence).toBeGreaterThanOrEqual(0);
      expect(d.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('active lockdown fails closed through the pipeline when the guardian is wired (deny → cancelled + audited)', async () => {
    const store = await storeWithChefHQ();
    const ld = toLockdownRecord({ ownerId: 'owner-1', reason: 'forensic emergency', activatedBy: 'owner-1', actorType: 'owner' });
    const guardian = new SecurityGuardian({
      lockdown: (ownerId) => (ownerId === 'owner-1' ? ld : null),
      rateLimiter: new RateLimiter(),
      anomaly: new AnomalyDetector(),
      recordEvent: () => undefined,
      costCheck: async () => ({ stopped: false, reason: null }),
    });
    const p = new CommandPipeline(store, okRunner({}), guardian);
    const r = await p.run(owner, 'status in chef-hq');
    expect(r.outcome).toBe('denied');
    expect(r.explanation.outcome).toBe('denied');
    expect(r.explanation.why).toContain('lockdown');
    expect(store.audit.some((a) => a.action === 'security.guardian_denied')).toBe(true);
    const tasks = await store.listTasks('owner-1');
    expect(tasks.some((t) => t.status === 'cancelled')).toBe(true);
  });

  it('guardian wired with no lockdown does not false-positive block a normal command', async () => {
    const store = await storeWithChefHQ();
    const guardian = new SecurityGuardian({
      lockdown: () => null,
      rateLimiter: new RateLimiter(),
      anomaly: new AnomalyDetector(),
      recordEvent: () => undefined,
      costCheck: async () => ({ stopped: false, reason: null }),
    });
    const p = new CommandPipeline(store, okRunner({}, 0), guardian);
    const r = await p.run(owner, 'status in chef-hq');
    expect(r.outcome).toBe('executed');
    expect(store.audit.some((a) => a.action === 'security.guardian_denied')).toBe(false);
  });

  it('guardian registry denies a financial command through the pipeline (wired guardian)', async () => {
    const store = await storeWithChefHQ();
    const guardian = new SecurityGuardian({
      lockdown: () => null,
      rateLimiter: new RateLimiter(),
      anomaly: new AnomalyDetector(),
      recordEvent: () => undefined,
      costCheck: async () => ({ stopped: false, reason: null }),
    });
    const p = new CommandPipeline(store, okRunner({}), guardian);
    const r = await p.run(owner, 'execute transfer in chef-hq');
    // Gate 1 authority requires approval for financial actions; the wired
    // guardian must never downgrade that (result stays require_approval or stricter).
    expect(['waiting_approval', 'denied']).toContain(r.outcome);
    if (r.outcome === 'denied') {
      expect(store.audit.some((a) => a.action === 'security.guardian_denied')).toBe(true);
    }
  });
});
