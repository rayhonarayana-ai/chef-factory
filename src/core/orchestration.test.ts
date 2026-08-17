import { describe, expect, it } from 'vitest';
import {
  validatePlan,
  createPlan,
  executeOrchestration,
  detectMultiStepCommand,
  FACTORY_MAX_ORCHESTRATION_STEPS,
  type OrchestrationPlan,
  type OrchestratorContext,
} from './orchestration.js';
import { MemoryStore } from '../testing/memoryStore.js';
import { SecurityGuardian } from './security/guardian.js';
import { RateLimiter } from './security/rateLimit.js';
import { AnomalyDetector } from './security/anomaly.js';
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
      // list_projects query
      if (sql.includes('FROM public.projects') && sql.includes('owner_id')) {
        return { rows: store.projects.filter((p) => p.ownerId === params?.[0]).map((p) => ({ id: p.id, name: p.name, slug: p.slug, description: p.description, status: p.status, created_at: p.createdAt })) };
      }
      // list_tasks query
      if (sql.includes('FROM public.tasks') && sql.includes('owner_id')) {
        return { rows: store.tasks.filter((t) => t.ownerId === params?.[0]).map((t) => ({ id: t.id, title: t.title, status: t.status, project_id: t.projectId })) };
      }
      // update_task query
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

function baseCtx(store: MemoryStore): OrchestratorContext {
  return {
    store,
    actorCtx: owner,
    environment: 'development',
    projectId: store.projects[0].id,
    toolDb: mockDb(store),
  };
}

describe('detectMultiStepCommand', () => {
  it('detects "then" sequencing marker', () => {
    expect(detectMultiStepCommand('create project Alpha then create tasks')).toBe(true);
  });

  it('detects "and then" marker', () => {
    expect(detectMultiStepCommand('create project Alpha and then list tasks')).toBe(true);
  });

  it('detects comma-separated actions', () => {
    expect(detectMultiStepCommand('create project Alpha, create tasks')).toBe(true);
  });

  it('detects multiple action verbs', () => {
    expect(detectMultiStepCommand('create project and add tasks')).toBe(true);
  });

  it('does not flag single-verb commands', () => {
    expect(detectMultiStepCommand('create project Alpha')).toBe(false);
  });

  it('does not flag informational commands', () => {
    expect(detectMultiStepCommand('list tasks in test-proj')).toBe(false);
  });

  it('detects "finally" marker', () => {
    expect(detectMultiStepCommand('create project, create tasks, finally list tasks')).toBe(true);
  });

  it('detects "followed by" marker', () => {
    expect(detectMultiStepCommand('create project followed by adding tasks')).toBe(true);
  });
});

describe('validatePlan', () => {
  it('rejects empty plans', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [], 'corr-1');
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('no steps'))).toBe(true);
  });

  it('rejects plans exceeding max steps', () => {
    const steps = Array.from({ length: FACTORY_MAX_ORCHESTRATION_STEPS + 1 }, (_, i) => ({
      tool: 'list_projects',
      args: {},
      description: `Step ${i}`,
      dependsOn: [],
    }));
    const plan = createPlan('owner-1', 'proj-1', 'development', steps, 'corr-1');
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('maximum steps'))).toBe(true);
  });

  it('rejects plans with unknown tools', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [
      { tool: 'nonexistent_tool', args: {}, description: 'bad step', dependsOn: [] },
    ], 'corr-1');
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown tool'))).toBe(true);
  });

  it('rejects plans with circular dependencies', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [
      { tool: 'list_projects', args: {}, description: 'Step 0', dependsOn: [1] },
      { tool: 'list_projects', args: {}, description: 'Step 1', dependsOn: [0] },
    ], 'corr-1');
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Circular dependency'))).toBe(true);
  });

  it('rejects plans with self-dependency', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [
      { tool: 'list_projects', args: {}, description: 'Step 0', dependsOn: [0] },
    ], 'corr-1');
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('depends on itself'))).toBe(true);
  });

  it('rejects plans with invalid dependency index', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [
      { tool: 'list_projects', args: {}, description: 'Step 0', dependsOn: [5] },
    ], 'corr-1');
    const result = validatePlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('invalid dependency'))).toBe(true);
  });

  it('accepts valid sequential plan', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: 'proj-1' }, description: 'Tasks', dependsOn: [0] },
    ], 'corr-1');
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid independent plan', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [
      { tool: 'list_projects', args: {}, description: 'A', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: 'proj-1' }, description: 'B', dependsOn: [] },
    ], 'corr-1');
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
  });
});

describe('executeOrchestration', () => {
  it('executes a single-step plan successfully', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'List projects', dependsOn: [] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, baseCtx(store));
    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.stepsCompleted).toBe(1);
    expect(result.stepsFailed).toBe(0);
    expect(result.totalSteps).toBe(1);
  });

  it('executes sequential steps in order', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: store.projects[0].id }, description: 'Tasks', dependsOn: [0] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, baseCtx(store));
    expect(result.ok).toBe(true);
    expect(result.stepsCompleted).toBe(2);
  });

  it('skips steps when dependencies fail', async () => {
    const store = await storeWithProject();
    // Step 0: update_task with nonexistent task_id will fail (no such task)
    // Step 1 depends on step 0 and should be skipped
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'update_task', args: { task_id: 'nonexistent-id', status: 'completed' }, description: 'Bad update', dependsOn: [] },
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [0] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, { ...baseCtx(store), failFast: false });
    expect(result.ok).toBe(false);
    expect(result.stepsFailed).toBe(1);
    expect(result.stepsSkipped).toBe(1);
  });

  it('aborts on first failure when failFast is true', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'update_task', args: { task_id: 'nonexistent-id', status: 'completed' }, description: 'Bad update', dependsOn: [] },
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, { ...baseCtx(store), failFast: true });
    expect(result.ok).toBe(false);
    expect(result.stepsCompleted).toBe(0);
    expect(result.stepsFailed).toBe(1);
  });

  it('rejects plans that fail validation', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [], 'corr-1');

    const result = await executeOrchestration(plan, baseCtx(store));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('validation failed');
  });

  it('returns correct step results', async () => {
    const store = await storeWithProject();
    const plan = createPlan('owner-1', store.projects[0].id, 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: store.projects[0].id }, description: 'Tasks', dependsOn: [] },
    ], 'corr-1');

    const result = await executeOrchestration(plan, baseCtx(store));
    expect(result.ok).toBe(true);
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[0].ok).toBe(true);
    expect(result.stepResults[1].ok).toBe(true);
  });

  it('enforces max step limit', async () => {
    const store = await storeWithProject();
    const steps = Array.from({ length: FACTORY_MAX_ORCHESTRATION_STEPS + 1 }, () => ({
      tool: 'list_projects',
      args: {},
      description: 'step',
      dependsOn: [],
    }));
    const plan = createPlan('owner-1', store.projects[0].id, 'development', steps, 'corr-1');

    const result = await executeOrchestration(plan, baseCtx(store));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('validation failed');
  });
});

describe('createPlan', () => {
  it('creates a plan with correct structure', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [
      { tool: 'list_projects', args: {}, description: 'List', dependsOn: [] },
    ], 'corr-1');

    expect(plan.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(plan.ownerId).toBe('owner-1');
    expect(plan.projectId).toBe('proj-1');
    expect(plan.environment).toBe('development');
    expect(plan.correlationId).toBe('corr-1');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].tool).toBe('list_projects');
    expect(plan.steps[0].status).toBe('pending');
    expect(plan.status).toBe('pending');
  });

  it('assigns correct indices to steps', () => {
    const plan = createPlan('owner-1', 'proj-1', 'development', [
      { tool: 'list_projects', args: {}, description: 'A', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: 'proj-1' }, description: 'B', dependsOn: [0] },
    ], 'corr-1');

    expect(plan.steps[0].index).toBe(0);
    expect(plan.steps[1].index).toBe(1);
    expect(plan.steps[1].dependsOn).toEqual([0]);
  });
});
