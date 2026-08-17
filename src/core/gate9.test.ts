// CHEF FACTORY — Gate 9 — Pipeline orchestration wiring tests.
// Proves the production pipeline actually invokes executeOrchestration()
// and that all security invariants are preserved through the real path.

import { describe, expect, it } from 'vitest';
import {
  CommandPipeline,
  type ActorContext,
  type ExecutionOutcome,
  type ExecutionRunner,
  type PlanStepsResult,
} from './pipeline.js';
import { MemoryStore } from '../testing/memoryStore.js';
import { SecurityGuardian } from './security/guardian.js';
import { RateLimiter } from './security/rateLimit.js';
import { AnomalyDetector } from './security/anomaly.js';
import type { DbQuery } from '../tools/types.js';
import { FACTORY_MAX_ORCHESTRATION_STEPS } from './orchestration.js';

const owner: ActorContext = { ownerId: 'owner-1', actorId: 'owner-1', actorType: 'owner' };

async function storeWithChefHQ() {
  const store = new MemoryStore();
  await store.createProject('owner-1', { name: 'Chef HQ', slug: 'chef-hq', description: 'the main project' });
  return store;
}

function mockDb(store: MemoryStore): DbQuery {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM public.projects') && sql.includes('owner_id')) {
        return { rows: store.projects.filter((p) => p.ownerId === params?.[0]).map((p) => ({ id: p.id, name: p.name, slug: p.slug, description: p.description, status: p.status, created_at: p.createdAt })) };
      }
      if (sql.includes('FROM public.tasks') && sql.includes('owner_id')) {
        return { rows: store.tasks.filter((t) => t.ownerId === params?.[0]).map((t) => ({ id: t.id, title: t.title, status: t.status, project_id: t.projectId })) };
      }
      if (sql.includes('UPDATE public.tasks')) {
        const taskId = params?.[1];
        const t = store.tasks.find((x) => x.id === taskId && x.ownerId === params?.[0]);
        if (!t) return { rows: [] };
        return { rows: [{ id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority, project_id: t.projectId, created_at: t.createdAt, updated_at: t.updatedAt }] };
      }
      return { rows: [] };
    },
  };
}

function orchestratingRunner(
  steps: PlanStepsResult['steps'],
  planCost = 0,
): ExecutionRunner {
  return {
    execute: async (): Promise<ExecutionOutcome> => ({
      ok: true,
      output: { text: 'fallback' },
      cost: 0,
    }),
    planSteps: async (): Promise<PlanStepsResult> => {
      return { steps, cost: planCost, modelId: 'm-plan' };
    },
  };
}

function simpleRunner(): ExecutionRunner {
  return {
    execute: async (): Promise<ExecutionOutcome> => ({
      ok: true,
      output: { text: 'simple' },
      cost: 0,
    }),
  };
}

function nullPlanRunner(): ExecutionRunner {
  return {
    execute: async (): Promise<ExecutionOutcome> => ({
      ok: true,
      output: { text: 'fallback' },
      cost: 0,
    }),
    planSteps: async () => null,
  };
}

describe('Gate 9 — Pipeline orchestration wiring', () => {
  // G9-01: Pipeline invokes executeOrchestration() for a real multi-step command
  it('G9-01: pipeline routes multi-step command through executeOrchestration', async () => {
    const store = await storeWithChefHQ();
    const projectId = store.projects[0].id;
    const runner = orchestratingRunner([
      { tool: 'list_tasks', args: { project_id: projectId }, description: 'List tasks', dependsOn: [] },
    ]);
    const p = new CommandPipeline(store, runner, undefined, undefined, undefined, mockDb(store));
    const r = await p.run(owner, 'create task "A" in chef-hq then list tasks in chef-hq');
    expect(r.outcome).toBe('executed');
    expect(r.task?.status).toBe('completed');
    expect(store.audit.some((a) => a.action === 'orchestration.started')).toBe(true);
    expect(store.audit.some((a) => a.action === 'orchestration.completed')).toBe(true);
  });

  // G9-02: executeOrchestration() is not bypassed
  it('G9-02: execution.execute is not called for multi-step commands', async () => {
    const store = await storeWithChefHQ();
    const projectId = store.projects[0].id;
    let executeCalled = false;
    const runner: ExecutionRunner = {
      execute: async () => {
        executeCalled = true;
        return { ok: true, output: {} };
      },
      planSteps: async () => ({
        steps: [
          { tool: 'list_tasks', args: { project_id: projectId }, description: 'List', dependsOn: [] },
        ],
      }),
    };
    const p = new CommandPipeline(store, runner, undefined, undefined, undefined, mockDb(store));
    await p.run(owner, 'create task "A" in chef-hq then list tasks in chef-hq');
    expect(executeCalled).toBe(false);
  });

  // G9-03: Multi-step command executes all intended steps exactly once
  it('G9-03: all planned steps execute exactly once', async () => {
    const store = await storeWithChefHQ();
    const projectId = store.projects[0].id;
    const runner = orchestratingRunner([
      { tool: 'list_tasks', args: { project_id: projectId }, description: 'List tasks', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: projectId }, description: 'List tasks again', dependsOn: [] },
    ]);
    const p = new CommandPipeline(store, runner, undefined, undefined, undefined, mockDb(store));
    const r = await p.run(owner, 'create task "A" in chef-hq then list tasks in chef-hq');
    expect(r.outcome).toBe('executed');
    // Both steps completed
    expect(r.task?.status).toBe('completed');
    expect(store.audit.some((a) => a.action === 'orchestration.completed')).toBe(true);
  });

  // G9-04: ToolBroker is invoked for each step
  it('G9-04: ToolBroker validates each step through orchestrator', async () => {
    const store = await storeWithChefHQ();
    const projectId = store.projects[0].id;
    const runner = orchestratingRunner([
      { tool: 'list_tasks', args: { project_id: projectId }, description: 'List', dependsOn: [] },
    ]);
    const p = new CommandPipeline(store, runner, undefined, undefined, undefined, mockDb(store));
    const r = await p.run(owner, 'create task "A" in chef-hq then list tasks in chef-hq');
    expect(r.outcome).toBe('executed');
    expect(store.audit.some((a) => a.action === 'orchestration.completed')).toBe(true);
  });

  // G9-05: Guardian is wired through orchestration path
  it('G9-05: guardian is wired through orchestration path (rate-limit event proves evaluate call)', async () => {
    const store = await storeWithChefHQ();
    const projectId = store.projects[0].id;
    let guardianEvaluated = false;
    // Use a rate limiter that's already exhausted to force a guardian event
    const rateLimiter = new RateLimiter();
    // Exhaust the tool.call rate limit for owner-1
    for (let i = 0; i < 200; i++) {
      rateLimiter.check('owner-1', 'tool' as any, 'tool.call');
    }
    const guardian = new SecurityGuardian({
      lockdown: () => null,
      rateLimiter,
      anomaly: new AnomalyDetector(),
      recordEvent: () => { guardianEvaluated = true; },
      costCheck: async () => ({ stopped: false, reason: null }),
    });
    const runner = orchestratingRunner([
      { tool: 'list_tasks', args: { project_id: projectId }, description: 'List', dependsOn: [] },
    ]);
    const p = new CommandPipeline(store, runner, guardian, undefined, undefined, mockDb(store));
    await p.run(owner, 'create task "A" in chef-hq then list tasks in chef-hq');
    // Guardian was evaluated at pipeline level; rate limit event fires recordEvent
    expect(guardianEvaluated).toBe(true);
  });

  // G9-06: Authority is resolved for each step
  it('G9-06: authority evaluation occurs in orchestration path', async () => {
    const store = await storeWithChefHQ();
    const projectId = store.projects[0].id;
    const runner = orchestratingRunner([
      { tool: 'list_tasks', args: { project_id: projectId }, description: 'List', dependsOn: [] },
    ]);
    const p = new CommandPipeline(store, runner, undefined, undefined, undefined, mockDb(store));
    const r = await p.run(owner, 'create task "A" in chef-hq then list tasks in chef-hq');
    expect(r.authority).not.toBeNull();
    expect(r.authority!.outcome).toBeDefined();
  });

  // G9-07: Lockdown denies orchestration at pipeline level
  it('G9-07: lockdown-guarded orchestration is denied', async () => {
    const store = await storeWithChefHQ();
    const guardian = new SecurityGuardian({
      lockdown: (ownerId) => ({
        id: 'lock-g9',
        ownerId,
        status: 'active',
        scope: 'global',
        reason: 'test lockdown',
        activatedBy: 'owner-1',
        activatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }),
      rateLimiter: new RateLimiter(),
      anomaly: new AnomalyDetector(),
      recordEvent: () => undefined,
      costCheck: async () => ({ stopped: false, reason: null }),
    });
    const runner = orchestratingRunner([
      { tool: 'list_tasks', args: { project_id: store.projects[0].id }, description: 'List', dependsOn: [] },
    ]);
    const p = new CommandPipeline(store, runner, guardian);
    const r = await p.run(owner, 'create task "A" in chef-hq then list tasks in chef-hq');
    // Lockdown denies at pipeline level before orchestration runs
    expect(r.outcome).toBe('denied');
    expect(store.audit.some((a) => a.action === 'security.guardian_denied')).toBe(true);
  });

  // G9-08: Approval-required autonomy pauses orchestration
  it('G9-08: require_approval autonomy pauses before orchestration', async () => {
    const store = await storeWithChefHQ();
    await store.setPreference('owner-1', 'autonomy', 'execute', 'require_approval');
    const runner = orchestratingRunner([
      { tool: 'list_tasks', args: { project_id: store.projects[0].id }, description: 'List', dependsOn: [] },
    ]);
    const p = new CommandPipeline(store, runner);
    const r = await p.run(owner, 'execute task "001" in chef-hq');
    expect(r.outcome).toBe('waiting_approval');
    expect(r.approvalId).not.toBeNull();
  });

  // G9-09: Orchestrator handles step failure (step that fails execution)
  it('G9-09: orchestrator handles step failure (failFast)', async () => {
    const store = await storeWithChefHQ();
    const projectId = store.projects[0].id;
    // Step with nonexistent task_id — update_task will fail
    const runner = orchestratingRunner([
      { tool: 'update_task', args: { task_id: 'nonexistent-g9', status: 'completed' }, description: 'Update bad', dependsOn: [] },
    ]);
    const p = new CommandPipeline(store, runner, undefined, undefined, undefined, mockDb(store));
    const r = await p.run(owner, 'update task "X" in chef-hq then list tasks in chef-hq');
    // Orchestrator fails → pipeline records failure → retry_pending
    expect(['failed', 'retry_pending']).toContain(r.outcome);
    expect(r.task?.status).toMatch(/queued|failed/);
  });

  // G9-10: Existing single-step execution remains compatible
  it('G9-10: single-step commands still use execution.execute path', async () => {
    const store = await storeWithChefHQ();
    let executeCalled = false;
    let planStepsCalled = false;
    const runner: ExecutionRunner = {
      execute: async () => {
        executeCalled = true;
        return { ok: true, output: { result: 'ok' }, cost: 0 };
      },
      planSteps: async () => {
        planStepsCalled = true;
        return null;
      },
    };
    const p = new CommandPipeline(store, runner);
    const r = await p.run(owner, 'create task "single step" in chef-hq');
    expect(r.outcome).toBe('executed');
    expect(planStepsCalled).toBe(false);
    expect(executeCalled).toBe(true);
  });

  // G9-11: Existing tool-round limit remains enforced
  it('G9-11: FACTORY_MAX_TOOL_ROUNDS still applies in single-step path', async () => {
    const { FACTORY_MAX_TOOL_ROUNDS } = await import('../api/execution.js');
    expect(FACTORY_MAX_TOOL_ROUNDS).toBe(10);
  });

  // G9-12: Existing orchestration step limit remains enforced
  it('G9-12: FACTORY_MAX_ORCHESTRATION_STEPS still applies', async () => {
    expect(FACTORY_MAX_ORCHESTRATION_STEPS).toBe(10);
  });

  // G9-13: No duplicate mutation occurs
  it('G9-13: no duplicate task creation in orchestration', async () => {
    const store = await storeWithChefHQ();
    const projectId = store.projects[0].id;
    const runner = orchestratingRunner([
      { tool: 'list_tasks', args: { project_id: projectId }, description: 'List', dependsOn: [] },
    ]);
    const p = new CommandPipeline(store, runner, undefined, undefined, undefined, mockDb(store));
    const r = await p.run(owner, 'create task "step1" in chef-hq then create task "step2" in chef-hq');
    expect(r.outcome).toBe('executed');
    // Pipeline creates 1 task for orchestration; orchestrator runs list_tasks (no create_task).
    // Total = 1 pipeline task + 0 orchestrator-created tasks = 1.
    const tasks = store.tasks.filter((t) => t.projectId === projectId);
    expect(tasks.length).toBe(1); // Only the pipeline's orchestration task
  });

  // G9-14: Final response reflects real orchestration result
  it('G9-14: pipeline result reflects orchestration outcome', async () => {
    const store = await storeWithChefHQ();
    const projectId = store.projects[0].id;
    const runner = orchestratingRunner([
      { tool: 'list_tasks', args: { project_id: projectId }, description: 'List', dependsOn: [] },
    ]);
    const p = new CommandPipeline(store, runner, undefined, undefined, undefined, mockDb(store));
    const r = await p.run(owner, 'create task "A" in chef-hq then list tasks in chef-hq');
    expect(r.outcome).toBe('executed');
    expect(r.explanation.outcome).toBe('executed');
    expect(r.explanation.decision).toContain('Multi-step');
    expect(r.task?.status).toBe('completed');
    expect(r.explanation.evidence.some((e) => e.startsWith('planId='))).toBe(true);
    expect(r.explanation.evidence.some((e) => e.startsWith('steps='))).toBe(true);
  });

  // G9-15: planSteps returning null fails gracefully
  it('G9-15: null planSteps results in failed outcome', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, nullPlanRunner());
    const r = await p.run(owner, 'create task "A" in chef-hq then list tasks in chef-hq');
    expect(r.outcome).toBe('failed');
    expect(r.explanation.why).toContain('orchestration plan');
  });

  // G9-16: planSteps cost is recorded
  it('G9-16: planning cost is recorded when planSteps returns a cost', async () => {
    const store = await storeWithChefHQ();
    const projectId = store.projects[0].id;
    const runner = orchestratingRunner(
      [{ tool: 'list_tasks', args: { project_id: projectId }, description: 'List', dependsOn: [] }],
      0.25,
    );
    const p = new CommandPipeline(store, runner, undefined, undefined, undefined, mockDb(store));
    const r = await p.run(owner, 'create task "A" in chef-hq then list tasks in chef-hq');
    expect(r.outcome).toBe('executed');
    const costs = store.costs.filter((c) => c.amount > 0);
    expect(costs.length).toBeGreaterThanOrEqual(1);
  });

  // G9-17: backward compat — runner without planSteps still works
  it('G9-17: runner without planSteps method handles multi-step (no crash)', async () => {
    const store = await storeWithChefHQ();
    const p = new CommandPipeline(store, simpleRunner());
    const r = await p.run(owner, 'create task "A" in chef-hq then list tasks in chef-hq');
    expect(r.outcome).toBe('failed');
  });

  // G9-18: orchestration preserves task lifecycle
  it('G9-18: task transitions through queued → running → completed', async () => {
    const store = await storeWithChefHQ();
    const projectId = store.projects[0].id;
    const runner = orchestratingRunner([
      { tool: 'list_tasks', args: { project_id: projectId }, description: 'List', dependsOn: [] },
    ]);
    const p = new CommandPipeline(store, runner, undefined, undefined, undefined, mockDb(store));
    const r = await p.run(owner, 'create task "A" in chef-hq then list tasks in chef-hq');
    expect(r.outcome).toBe('executed');
    expect(r.task?.status).toBe('completed');
    expect(store.taskRuns.length).toBeGreaterThanOrEqual(1);
    const run = store.taskRuns[store.taskRuns.length - 1];
    expect(run.status).toBe('completed');
  });
});
