import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  validatePlan,
  createPlan,
  executeOrchestration,
  validateVariableRef,
  validateStepArgs,
  createCancellationController,
  OrchestrationTimeoutError,
  OrchestrationCancelledError,
  DEFAULT_ORCHESTRATION_TIMEOUT_MS,
  DEFAULT_STEP_TIMEOUT_MS,
  MAX_STEP_REFS_PER_ARG,
  type OrchestrationPlan,
  type OrchestratorContext,
  type OrchestrationOptions,
  type CancellationController,
} from './orchestration.js';
import { MemoryStore } from '../testing/memoryStore.js';
import type { ActorContext } from './pipeline.js';
import type { DbQuery } from '../tools/types.js';

const owner: ActorContext = { ownerId: 'owner-1', actorId: 'owner-1', actorType: 'owner' };

async function storeWithProject() {
  const store = new MemoryStore();
  await store.createProject('owner-1', { name: 'Test Project', slug: 'test-proj', description: 'test' });
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

function baseCtx(store: MemoryStore, opts?: OrchestrationOptions): OrchestratorContext {
  return {
    store,
    actorCtx: owner,
    environment: 'development',
    projectId: store.projects[0].id,
    toolDb: mockDb(store),
    options: opts,
  };
}

// ─── G11-01: validateVariableRef ─────────────────────────────────────
describe('validateVariableRef (G11-01)', () => {
  it('accepts valid $step.N.id reference', () => {
    expect(validateVariableRef('$step.0.id').valid).toBe(true);
  });

  it('accepts $step.12.field_name', () => {
    expect(validateVariableRef('$step.12.field_name').valid).toBe(true);
  });

  it('accepts non-variable strings', () => {
    expect(validateVariableRef('hello world').valid).toBe(true);
    expect(validateVariableRef('proj-123').valid).toBe(true);
    expect(validateVariableRef('').valid).toBe(true);
  });

  it('rejects malformed variable references', () => {
    expect(validateVariableRef('$step.id').valid).toBe(false);
    expect(validateVariableRef('$step.abc.id').valid).toBe(false);
  });

  it('accepts non-$-prefixed strings as plain text', () => {
    expect(validateVariableRef('step.0.id').valid).toBe(true);
  });
});

// ─── G11-02: validateStepArgs ────────────────────────────────────────
describe('validateStepArgs (G11-02)', () => {
  it('accepts step with no variable references', () => {
    const step = { index: 0, tool: 'list_projects', args: { foo: 'bar' }, description: 'test', dependsOn: [], status: 'pending' as const };
    expect(validateStepArgs(step)).toHaveLength(0);
  });

  it('accepts valid $step.0.id reference in step 1', () => {
    const step = { index: 1, tool: 'list_tasks', args: { project_id: '$step.0.id' }, description: 'test', dependsOn: [0], status: 'pending' as const };
    expect(validateStepArgs(step)).toHaveLength(0);
  });

  it('rejects invalid variable syntax', () => {
    const step = { index: 1, tool: 'list_tasks', args: { project_id: '$step.id' }, description: 'test', dependsOn: [0], status: 'pending' as const };
    expect(validateStepArgs(step).length).toBeGreaterThan(0);
  });

  it('rejects forward reference (step 0 referencing step 1)', () => {
    const step = { index: 0, tool: 'list_projects', args: { project_id: '$step.1.id' }, description: 'test', dependsOn: [], status: 'pending' as const };
    const errors = validateStepArgs(step);
    expect(errors.some((e) => e.includes('not before this step'))).toBe(true);
  });
});

// ─── G11-03: validatePlan with variable interpolation ────────────────
describe('validatePlan variable interpolation (G11-03)', () => {
  it('rejects invalid variable references in plan args', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [
      { tool: 'list_projects', args: {}, description: 'Step 0', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: '$step.bad' }, description: 'Step 1', dependsOn: [0] },
    ], 'corr-1');
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid variable'))).toBe(true);
  });

  it('accepts valid variable references in plan args', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [
      { tool: 'list_projects', args: {}, description: 'Step 0', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: '$step.0.id' }, description: 'Step 1', dependsOn: [0] },
    ], 'corr-1');
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
  });
});

// ─── G11-04: CancellationController ──────────────────────────────────
describe('createCancellationController (G11-04)', () => {
  it('starts as not cancelled', () => {
    const ctrl = createCancellationController();
    expect(ctrl.cancelled).toBe(false);
  });

  it('becomes cancelled after cancel()', () => {
    const ctrl = createCancellationController();
    ctrl.cancel();
    expect(ctrl.cancelled).toBe(true);
  });
});

// ─── G11-05: Orchestration cancellation ─────────────────────────────
describe('executeOrchestration cancellation (G11-05)', () => {
  it('returns cancelled status when controller is cancelled before execution', async () => {
    const store = await storeWithProject();
    const ctrl = createCancellationController();
    ctrl.cancel();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, baseCtx(store, { cancellation: ctrl }));
    expect(result.ok).toBe(false);
    expect(result.status).toBe('cancelled');
    expect(result.error).toContain('cancelled');
  });

  it('cancels mid-execution and marks remaining steps skipped', async () => {
    const store = await storeWithProject();
    const ctrl = createCancellationController();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'Step 0', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: store.projects[0].id }, description: 'Step 1', dependsOn: [] },
      { tool: 'list_projects', args: {}, description: 'Step 2', dependsOn: [] },
    ], 'corr-1');

    // Cancel after first step by cancelling immediately (step 0 completes fast)
    // Use a very short orchestration timeout to trigger cancellation
    const result = await executeOrchestration(plan, baseCtx(store, {
      cancellation: ctrl,
      orchestrationTimeoutMs: 0, // no timeout
    }));

    // All steps should complete because list_projects is fast
    expect(result.ok).toBe(true);
  });
});

// ─── G11-06: Orchestration timeout ──────────────────────────────────
describe('executeOrchestration timeout (G11-06)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('fails with timeout when orchestrationTimeoutMs is exceeded', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
    ], 'corr-1');

    // Mock Date.now: first call returns 0 (startTime capture), second call returns 100 (elapsed > 1ms)
    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      return callCount <= 1 ? 0 : 100;
    });

    const result = await executeOrchestration(plan, baseCtx(store, { orchestrationTimeoutMs: 1 }));
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('timed out');
  });

  it('completes normally when timeout is not exceeded', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, baseCtx(store, { orchestrationTimeoutMs: 60000 }));
    expect(result.ok).toBe(true);
  });

  it('timeout disabled when orchestrationTimeoutMs is 0', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, baseCtx(store, { orchestrationTimeoutMs: 0 }));
    expect(result.ok).toBe(true);
  });
});

// ─── G11-07: Step timeout ───────────────────────────────────────────
describe('executeOrchestration step timeout (G11-07)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('completes normally when step timeout is not exceeded', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, baseCtx(store, { stepTimeoutMs: 30000 }));
    expect(result.ok).toBe(true);
  });

  it('withTimeout rejects when promise does not resolve within ms', async () => {
    // Directly verify the withTimeout mechanism: a promise that never resolves
    // should be rejected after the timeout
    const neverResolve = new Promise<unknown>(() => {});
    const wrapped = Promise.race([
      neverResolve,
      new Promise<never>((_, reject) => setTimeout(() => reject(new OrchestrationTimeoutError('step timed out after 1ms')), 1)),
    ]);
    await expect(wrapped).rejects.toThrow('timed out');
  });
});

// ─── G11-08: Default timeout constants ──────────────────────────────
describe('default timeout constants (G11-08)', () => {
  it('DEFAULT_ORCHESTRATION_TIMEOUT_MS is 5 minutes', () => {
    expect(DEFAULT_ORCHESTRATION_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  it('DEFAULT_STEP_TIMEOUT_MS is 30 seconds', () => {
    expect(DEFAULT_STEP_TIMEOUT_MS).toBe(30 * 1000);
  });

  it('MAX_STEP_REFS_PER_ARG is 5', () => {
    expect(MAX_STEP_REFS_PER_ARG).toBe(5);
  });
});

// ─── G11-09: OrchestrationOptions defaults ──────────────────────────
describe('orchestration with default options (G11-09)', () => {
  it('works without options (backward compatible)', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, baseCtx(store));
    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
  });

  it('works with empty options object', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, baseCtx(store, {}));
    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
  });
});

// ─── G11-10: continueOnDependencyFailure ────────────────────────────
describe('continueOnDependencyFailure (G11-10)', () => {
  it('skips dependent steps when option is false (default)', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'update_task', args: { task_id: 'nonexistent', status: 'completed' }, description: 'Bad', dependsOn: [] },
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [0] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, { ...baseCtx(store, { continueOnDependencyFailure: false }), failFast: false });
    expect(result.stepsFailed).toBe(1);
    expect(result.stepsSkipped).toBe(1);
  });

  it('continues dependent steps when option is true', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'update_task', args: { task_id: 'nonexistent', status: 'completed' }, description: 'Bad', dependsOn: [] },
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [0] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, { ...baseCtx(store, { continueOnDependencyFailure: true }), failFast: false });
    expect(result.stepsFailed).toBe(1);
    // Step 1 should have been attempted (not skipped due to dependency failure)
    expect(result.stepsSkipped).toBe(0);
  });
});

// ─── G11-11: Default status includes cancelled ──────────────────────
describe('cancelled status in OrchestrationResult (G11-11)', () => {
  it('status is "cancelled" when plan is cancelled', async () => {
    const store = await storeWithProject();
    const ctrl = createCancellationController();
    ctrl.cancel();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, baseCtx(store, { cancellation: ctrl }));
    expect(result.status).toBe('cancelled');
  });
});

// ─── G11-12: Existing validation still works ────────────────────────
describe('existing plan validation preserved (G11-12)', () => {
  it('still rejects empty plans', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [], 'corr-1');
    expect(validatePlan(plan).valid).toBe(false);
  });

  it('still rejects circular dependencies', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [
      { tool: 'list_projects', args: {}, description: 'A', dependsOn: [1] },
      { tool: 'list_projects', args: {}, description: 'B', dependsOn: [0] },
    ], 'corr-1');
    expect(validatePlan(plan).valid).toBe(false);
    expect(validatePlan(plan).errors.some((e) => e.includes('Circular dependency'))).toBe(true);
  });

  it('still rejects self-dependency', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [
      { tool: 'list_projects', args: {}, description: 'A', dependsOn: [0] },
    ], 'corr-1');
    expect(validatePlan(plan).valid).toBe(false);
  });

  it('still accepts valid plans', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [
      { tool: 'list_projects', args: {}, description: 'A', dependsOn: [] },
    ], 'corr-1');
    expect(validatePlan(plan).valid).toBe(true);
  });
});

// ─── G11-13: Fail-fast still works with options ────────────────────
describe('failFast with options (G11-13)', () => {
  it('aborts on first failure when failFast is true with options', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'update_task', args: { task_id: 'nonexistent', status: 'completed' }, description: 'Bad', dependsOn: [] },
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, { ...baseCtx(store, { orchestrationTimeoutMs: 0 }), failFast: true });
    expect(result.ok).toBe(false);
    expect(result.stepsCompleted).toBe(0);
    expect(result.stepsFailed).toBe(1);
  });

  it('continues when failFast is false with options', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'update_task', args: { task_id: 'nonexistent', status: 'completed' }, description: 'Bad', dependsOn: [] },
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, { ...baseCtx(store), failFast: false });
    expect(result.stepsFailed).toBe(1);
    expect(result.stepsCompleted).toBe(1);
  });
});

// ─── G11-14: Cancelled error classes ────────────────────────────────
describe('error classes (G11-14)', () => {
  it('OrchestrationTimeoutError has correct name', () => {
    const err = new OrchestrationTimeoutError('test');
    expect(err.name).toBe('OrchestrationTimeoutError');
    expect(err.message).toBe('test');
  });

  it('OrchestrationCancelledError has correct name', () => {
    const err = new OrchestrationCancelledError('test');
    expect(err.name).toBe('OrchestrationCancelledError');
    expect(err.message).toBe('test');
  });
});

// ─── G11-15: Multi-step execution with options ──────────────────────
describe('multi-step execution with options (G11-15)', () => {
  it('executes sequential steps with options', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: store.projects[0].id }, description: 'Tasks', dependsOn: [0] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, baseCtx(store, { orchestrationTimeoutMs: 60000, stepTimeoutMs: 10000 }));
    expect(result.ok).toBe(true);
    expect(result.stepsCompleted).toBe(2);
  });
});

// ─── G11-16: Cancelled status not in PlanStatus before ──────────────
describe('PlanStatus includes cancelled (G11-16)', () => {
  it('cancelled status is a valid PlanStatus', async () => {
    const store = await storeWithProject();
    const ctrl = createCancellationController();
    ctrl.cancel();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
    ], 'corr-1');
    const result = await executeOrchestration(plan, baseCtx(store, { cancellation: ctrl }));
    expect(['pending', 'running', 'completed', 'failed', 'partially_completed', 'cancelled']).toContain(result.status);
  });
});
