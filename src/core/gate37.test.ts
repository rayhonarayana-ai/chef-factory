// CHEF FACTORY — Gate 37 — Deterministic Workforce Orchestrator (unit).
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { runWorkforce, DEFAULT_MAX_TASKS_PER_RUN, DEFAULT_MAX_PARALLEL_EXECUTIONS } from './workforceOrchestrator.js';
import { createExecutionRunner } from '../api/execution.js';
import { ModelGateway } from '../gateways/modelGateway.js';
import { RuntimeGateway } from '../gateways/runtimeGateway.js';
import type { Store } from './ports.js';
import type { AgentRecord, TaskRecord } from './types.js';
import type { ExecutionOutcome, ExecutionRunner, ActorContext } from './pipeline.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../gateways/providerAdapter.js';
import type { DbQuery } from '../tools/types.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const mockDb: DbQuery = { query: async () => ({ rows: [] }) };

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
  opts: { status?: string; maxConcurrentTasks?: number; capabilities?: string[] } = {},
): Promise<AgentRecord> {
  const agent = await store.createAgent(ownerId, {
    name: 'A-' + uuid(),
    slug: 'a-' + uuid(),
    role: 'worker',
    status: (opts.status ?? 'active') as AgentRecord['status'],
    capabilities: opts.capabilities ?? [],
    maxConcurrentTasks: opts.maxConcurrentTasks ?? 1,
  });
  // grant explicit execute permission on this project (permission comes only from agent_permissions)
  store.agentPermissions.push({ agentId: agent.id, projectId, resourceType: 'task', permission: 'execute' });
  return agent;
}

async function makeSchedulableTask(
  store: MemoryStore,
  ownerId: string,
  projectId: string,
  opts: {
    status?: TaskRecord['status'];
    env?: string;
    mockResult?: string;
    requiredCapabilities?: string[];
  } = {},
): Promise<TaskRecord> {
  return store.createTask(ownerId, {
    projectId,
    title: 'T-' + uuid(),
    status: opts.status ?? 'queued',
    agentId: null,
    riskLevel: 'low',
    requiredCapabilities: opts.requiredCapabilities ?? [],
    inputs: {
      intent: 'execute orchestrated task',
      environment: opts.env ?? 'development',
      resource: 'task',
      mockResult: opts.mockResult ?? 'success',
    },
  });
}

// Controllable ExecutionRunner; records the ActorContext it was invoked with.
function stubRunner(opts: { delayMs?: number; mode?: (task: TaskRecord) => string } = {}): ExecutionRunner & {
  calls: Array<{ ctx: ActorContext; task: TaskRecord }>;
  result: (task: TaskRecord) => ExecutionOutcome;
} {
  const calls: Array<{ ctx: ActorContext; task: TaskRecord }> = [];
  const result = (task: TaskRecord): ExecutionOutcome => {
    const mode = opts.mode ? opts.mode(task) : String((task.inputs as Record<string, unknown>)?.mockResult ?? 'success');
    if (mode === 'failure') return { ok: false, error: 'agent task failed', reason: 'fail' };
    if (mode === 'throw') throw new Error('execution threw');
    return { ok: true, output: { done: true }, cost: 0.001 };
  };
  const runner: ExecutionRunner & { calls: typeof calls; result: typeof result } = {
    calls,
    result,
    execute: async (task: TaskRecord, ctx: ActorContext): Promise<ExecutionOutcome> => {
      calls.push({ ctx, task });
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      return result(task);
    },
  };
  return runner;
}

// Proxy-based spy store: override any method while delegating to MemoryStore.
function spyStore(base: MemoryStore, overrides: Record<string, (...args: any[]) => any> = {}): Store {
  return new Proxy(base, {
    get(t, prop) {
      const key = String(prop);
      if (key in overrides) return overrides[key]!.bind(t);
      const v = (t as unknown as Record<string, unknown>)[key];
      return typeof v === 'function' ? (v as (...a: any[]) => any).bind(t) : v;
    },
    set(t, prop, value) {
      (t as unknown as Record<string, unknown>)[String(prop)] = value;
      return true;
    },
  });
}

// Real runner (SecurityGuardian + ToolBroker in path), like Gate 34.
function realRunner(store: Store) {
  const adapters = new Map<string, ProviderAdapter>([
    ['mock', {
      provider: 'mock', configured: () => true, supportsTools: () => true,
      complete: async (req: ProviderRequest): Promise<ProviderResponse> => ({
        provider: 'mock', model: req.model, text: 'Done.', usage: { inputTokens: 50, outputTokens: 20 },
      }),
    }],
  ]);
  const mg = new ModelGateway(adapters);
  const rg = new RuntimeGateway(new Map());
  store.models.push({ id: 'm-' + uuid(), provider: 'mock', name: 'mock', slug: 'mock', capability: { reasoning: 'medium', tools: true }, contextWindow: 128000, costPer1kInput: 0, costPer1kOutput: 0, status: 'active' });
  return createExecutionRunner({ store, modelGateway: mg, runtimeGateway: rg, toolDb: mockDb });
}

describe('Gate 37 — Workforce Orchestrator unit', () => {
  let store: MemoryStore;
  let ownerId: string;
  let project: { id: string };

  beforeEach(async () => {
    const f = await fixtures();
    store = f.store;
    ownerId = f.ownerId;
    project = f.project;
  });

  it('01: nothing_to_do when no schedulable tasks', async () => {
    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId });
    expect(r.outcome).toBe('nothing_to_do');
    expect(r.discovered).toBe(0);
    expect(r.placed).toBe(0);
    expect(r.executed).toBe(0);
  });

  it('02: one task -> one placement -> one execution completed', async () => {
    await makeAgent(store, ownerId, project.id);
    const task = await makeSchedulableTask(store, ownerId, project.id);
    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId });
    expect(r.discovered).toBe(1);
    expect(r.placed).toBe(1);
    expect(r.executed).toBe(1);
    expect(r.completed).toBe(1);
    expect(r.outcome).toBe('completed');
    const ft = await store.getTask(ownerId, task.id);
    expect(ft?.status).toBe('completed');
  });

  it('03: multiple tasks execute in deterministic discovery order', async () => {
    const agent = await makeAgent(store, ownerId, project.id, { maxConcurrentTasks: 5 });
    const t1 = await makeSchedulableTask(store, ownerId, project.id);
    const t2 = await makeSchedulableTask(store, ownerId, project.id);
    const t3 = await makeSchedulableTask(store, ownerId, project.id);
    // Force deterministic created_at ordering independent of UUIDs.
    store.tasks.find((t) => t.id === t1.id)!.createdAt = '2026-01-01T00:00:00.000Z';
    store.tasks.find((t) => t.id === t2.id)!.createdAt = '2026-01-02T00:00:00.000Z';
    store.tasks.find((t) => t.id === t3.id)!.createdAt = '2026-01-03T00:00:00.000Z';
    void agent;
    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId, maxParallelExecutions: 1 });
    expect(r.discovered).toBe(3);
    expect(r.placed).toBe(3);
    expect(r.executed).toBe(3);
    expect(r.completed).toBe(3);
    // taskResults are recorded in placement (= discovery) order: oldest first.
    expect(r.tasks.map((t) => t.taskId)).toEqual([t1.id, t2.id, t3.id]);
  });

  it('04: maxTasksPerRun enforced', async () => {
    await makeAgent(store, ownerId, project.id, { maxConcurrentTasks: 10 });
    for (let i = 0; i < 4; i++) await makeSchedulableTask(store, ownerId, project.id);
    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId, maxTasksPerRun: 2 });
    expect(r.discovered).toBe(4);
    expect(r.placed).toBe(2);
    expect(r.executed).toBe(2);
  });

  it('05: no eligible agent -> noEligibleAgent counter', async () => {
    await makeAgent(store, ownerId, project.id, { status: 'paused' });
    await makeSchedulableTask(store, ownerId, project.id);
    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId });
    expect(r.noEligibleAgent).toBe(1);
    expect(r.placed).toBe(0);
    expect(r.outcome).toBe('blocked');
  });

  it('06: capacity blocked when agent at maxConcurrentTasks', async () => {
    await makeAgent(store, ownerId, project.id, { maxConcurrentTasks: 1 });
    await makeSchedulableTask(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId });
    // first placed+executed (completes -> terminal), capacity free for recheck but the
    // orchestrator places all unassigned first: second is blocked while first is assigned.
    expect(r.capacityBlocked).toBe(1);
    expect(r.placed).toBe(1);
    expect(r.executed).toBe(1);
  });

  it('07: placement conflict -> conflicts counter, no reassignment', async () => {
    const agent = await makeAgent(store, ownerId, project.id);
    // Simulate a discovery race: the task is reported schedulable but is actually already assigned.
    const assigned = await store.createTask(ownerId, { projectId: project.id, title: 'T', status: 'queued', agentId: agent.id });
    void assigned;
    const spy = spyStore(store, {
      // Discovery returns a task that is actually already assigned (race).
      listSchedulableTasks: async (o: string) => {
        const unassigned = await makeSchedulableTask(store, o, project.id);
        await store.assignTask(ownerId, unassigned.id, agent.id); // assigned underneath
        return [store.tasks.find((t) => t.id === unassigned.id)!];
      },
    });
    const r = await runWorkforce({ store: spy, execution: stubRunner(), ownerId, actorId: ownerId });
    expect(r.conflicts).toBeGreaterThanOrEqual(1);
    expect(r.placed).toBe(0);
  });

  it('08: already-assigned race -> not stolen, classified as conflict', async () => {
    const agent = await makeAgent(store, ownerId, project.id);
    const task = await makeSchedulableTask(store, ownerId, project.id);
    // Intercept placeTask's underlying assign to simulate a concurrent assignor winning.
    const spy = spyStore(store, {
      assignTaskIfUnassigned: async (o: string, taskId: string, agentId2: string) => {
        // another orchestrator already assigned it: return already_assigned
        await store.assignTask(ownerId, taskId, agentId2);
        return { ok: false, outcome: 'already_assigned' as const, previousAgentId: null, nextAgentId: agentId2 };
      },
    });
    const r = await runWorkforce({ store: spy, execution: stubRunner(), ownerId, actorId: ownerId });
    expect(r.conflicts).toBeGreaterThanOrEqual(1);
    expect(r.placed).toBe(0);
    const ft = await store.getTask(ownerId, task.id);
    expect(ft?.agentId).toBe(agent.id); // existing assignment preserved, not stolen
  });

  it('09: execution claim loss -> conflicts counter', async () => {
    const agent = await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id, { mockResult: 'success' });
    const spy = spyStore(store, {
      claimTaskForExecution: async (o: string, taskId: string, agentId2: string) => {
        void o; void agentId2;
        const t = store.tasks.find((x) => x.id === taskId);
        if (!t) return { ok: false, outcome: 'task_not_found' as const, task: null };
        return { ok: false, outcome: 'already_running' as const, task: { ...t } };
      },
    });
    void agent;
    const r = await runWorkforce({ store: spy, execution: stubRunner(), ownerId, actorId: ownerId });
    expect(r.conflicts).toBeGreaterThanOrEqual(1);
    expect(r.completed).toBe(0);
  });

  it('10: task execution failure -> failed counter', async () => {
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id, { mockResult: 'failure' });
    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId });
    expect(r.executed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.completed).toBe(0);
  });

  it('11: bounded retry is Gate 34 responsibility, not re-run in same loop', async () => {
    await makeAgent(store, ownerId, project.id);
    const task = await makeSchedulableTask(store, ownerId, project.id, { mockResult: 'failure' });
    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId });
    // exactly one placement, one execution for this task — no orchestrator-side retry loop
    expect(r.placed).toBe(1);
    expect(r.executed).toBe(1);
    expect(r.tasks.length).toBe(1);
    const ft = await store.getTask(ownerId, task.id);
    expect(['queued', 'failed']).toContain(ft?.status);
    expect(ft!.attempts).toBeGreaterThanOrEqual(1);
  });

  it('12: approval-required execution stops correctly', async () => {
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id, { env: 'production' });
    const runner = stubRunner();
    const r = await runWorkforce({ store, execution: runner, ownerId, actorId: ownerId });
    expect(r.approvalRequired).toBe(1);
    expect(r.executed).toBe(1); // passed to executor; authority resolved before runner ran
    expect(runner.calls.length).toBe(0); // runner never invoked (approval ahead of execution)
  });

  it('13: paused agent cannot be scheduled', async () => {
    await makeAgent(store, ownerId, project.id, { status: 'paused' });
    await makeSchedulableTask(store, ownerId, project.id);
    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId });
    expect(r.placed).toBe(0);
    expect(r.noEligibleAgent).toBe(1);
    expect(r.outcome).toBe('blocked');
  });

  it('14: owner isolation — owner B work never scheduled by owner A', async () => {
    const ownerB = 'owner-' + uuid();
    const projectB = await store.createProject(ownerB, { name: 'PB', slug: 'pb-' + uuid() });
    const agentB = await makeAgent(store, ownerB, projectB.id);
    await store.createTask(ownerB, { projectId: projectB.id, title: 'BT', status: 'queued', agentId: null });
    // owner A has no agents/tasks
    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId });
    expect(r.discovered).toBe(0);
    expect(r.outcome).toBe('nothing_to_do');
    const b = await store.getTask(ownerB, agentB.id);
    void b;
  });

  it('15: project isolation — only projectP1 scheduled', async () => {
    const project2 = await store.createProject(ownerId, { name: 'P2', slug: 'p2-' + uuid() });
    const agent = await makeAgent(store, ownerId, project.id, { maxConcurrentTasks: 10 });
    store.agentPermissions.push({ agentId: agent.id, projectId: project2.id, resourceType: 'task', permission: 'execute' });
    const t1 = await makeSchedulableTask(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project2.id);
    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId, projectId: project.id });
    expect(r.discovered).toBe(1);
    expect(r.placed).toBe(1);
    expect(r.tasks[0].taskId).toBe(t1.id);
    const other = store.tasks.filter((t) => t.projectId === project2.id && t.status === 'queued');
    expect(other.length).toBe(1); // project2 task untouched
  });

  it('16: abort before run', async () => {
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const controller = new AbortController();
    controller.abort();
    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId, signal: controller.signal });
    expect(r.outcome).toBe('aborted');
    expect(r.executed).toBe(0);
  });

  it('17: abort during run stops scheduling', async () => {
    const agent = await makeAgent(store, ownerId, project.id, { maxConcurrentTasks: 10 });
    await makeSchedulableTask(store, ownerId, project.id, { mockResult: 'success' });
    await makeSchedulableTask(store, ownerId, project.id, { mockResult: 'success' });
    void agent;
    const controller = new AbortController();
    const runner = stubRunner({
      mode: (task) => {
        void task;
        return 'success';
      },
    });
    const origExec = runner.execute.bind(runner);
    let count = 0;
    runner.execute = async (task: TaskRecord, ctx: ActorContext) => {
      count++;
      if (count === 1) controller.abort();
      return origExec(task, ctx);
    };
    const r = await runWorkforce({ store, execution: runner, ownerId, actorId: ownerId, maxParallelExecutions: 1, signal: controller.signal });
    expect(r.executed).toBeLessThan(2);
  });

  it('18: run timeout aborts', async () => {
    const agent = await makeAgent(store, ownerId, project.id, { maxConcurrentTasks: 10 });
    await makeSchedulableTask(store, ownerId, project.id, { mockResult: 'success' });
    await makeSchedulableTask(store, ownerId, project.id, { mockResult: 'success' });
    void agent;
    const runner = stubRunner({ delayMs: 30 });
    const r = await runWorkforce({ store, execution: runner, ownerId, actorId: ownerId, maxParallelExecutions: 1, runTimeoutMs: 5 });
    expect(['aborted', 'partial', 'blocked']).toContain(r.outcome);
    expect(r.executed).toBeLessThan(2);
  });

  it('19: deterministic result counters', async () => {
    const agent = await makeAgent(store, ownerId, project.id, { maxConcurrentTasks: 10 });
    void agent;
    const t1 = await makeSchedulableTask(store, ownerId, project.id, { mockResult: 'success' });
    const t2 = await makeSchedulableTask(store, ownerId, project.id, { mockResult: 'failure' });
    const t3 = await makeSchedulableTask(store, ownerId, project.id, { env: 'production' });
    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId });
    void t1; void t2; void t3;
    expect(r.discovered).toBe(3);
    expect(r.placed).toBe(3);
    expect(r.executed).toBe(3);
    expect(r.completed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.approvalRequired).toBe(1);
    expect(r.blocked).toBe(1);
    expect(r.placed).toBe(r.completed + r.failed + r.approvalRequired);
  });

  it('20: orchestrator does not create tasks', async () => {
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const before = store.tasks.length;
    await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId });
    expect(store.tasks.length).toBe(before);
  });

  it('21: orchestrator does not grant permissions', async () => {
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const before = store.agentPermissions.length;
    await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId });
    expect(store.agentPermissions.length).toBe(before);
  });

  it('22: no agent-to-agent invocation; each execution is the assigned agent identity', async () => {
    const agent = await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const runner = stubRunner();
    const r = await runWorkforce({ store, execution: runner, ownerId, actorId: ownerId });
    expect(r.executed).toBe(1);
    expect(runner.calls.length).toBe(1);
    expect(runner.calls[0].ctx.actorType).toBe('agent');
    expect(runner.calls[0].ctx.actorId).toBe(agent.id);
    expect(runner.calls[0].ctx.actorId).not.toBe(ownerId); // never owner impersonation
  });

  it('23: zero orchestrator LLM calls (runner invoked exactly once per placed task)', async () => {
    const agent = await makeAgent(store, ownerId, project.id, { maxConcurrentTasks: 3 });
    void agent;
    await makeSchedulableTask(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const runner = stubRunner();
    const r = await runWorkforce({ store, execution: runner, ownerId, actorId: ownerId, maxParallelExecutions: 3 });
    expect(r.placed).toBe(2);
    expect(runner.calls.length).toBe(2); // no extra overhead calls from the orchestrator
    expect(r.executed).toBe(2);
  });

  it('24: SecurityGuardian path preserved (execution routes through Gate 34 canonical runner)', async () => {
    await makeAgent(store, ownerId, project.id);
    await makeSchedulableTask(store, ownerId, project.id);
    const r = await runWorkforce({ store, execution: realRunner(store), ownerId, actorId: ownerId });
    expect(r.executed).toBe(1);
    expect(r.completed).toBe(1);
  });

  it('25: ToolBroker path preserved via Gate 34 executor', async () => {
    const agent = await makeAgent(store, ownerId, project.id);
    const task = await makeSchedulableTask(store, ownerId, project.id);
    await runWorkforce({ store, execution: realRunner(store), ownerId, actorId: ownerId });
    const ft = await store.getTask(ownerId, task.id);
    void agent;
    expect(ft?.status).toBe('completed');
    // a completed run implies the tool execution path (guardian+broker) was exercised
    expect(store.taskRuns.length).toBeGreaterThanOrEqual(1);
  });
});
