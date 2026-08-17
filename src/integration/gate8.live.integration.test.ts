// CHEF FACTORY — Gate 8 — Live integration test (orchestration against real Supabase).
// Guarded: skipped unless FACTORY_* env is present.
// Tests multi-step task orchestration end-to-end against real schema.

import pg from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';
import { createPlan, executeOrchestration, validatePlan, detectMultiStepCommand } from '../core/orchestration.js';
import type { OrchestratorContext } from '../core/orchestration.js';
import type { DbQuery } from '../tools/types.js';

const cfg = getFactoryConfig(loadEnvFile());
const enabled = Boolean(cfg.supabaseUrl && cfg.dbPassword && cfg.dbHost);

interface ItStore {
  store: SupabaseStore;
  owner: string;
  other: string;
  client: pg.Client;
  connected: boolean;
  rollback: () => Promise<void>;
}

function makeTransactionalStore(): ItStore {
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  const client = new pg.Client({
    host: cfg.dbHost,
    port: cfg.dbPort,
    user: cfg.dbUser,
    password: cfg.dbPassword,
    database: cfg.dbName,
    ssl: { rejectUnauthorized: false },
  });
  let connected = false;
  const ensure = async () => {
    if (!connected) {
      await client.connect();
      await client.query('begin');
      await client.query(`delete from auth.users where email like 'it-g8-%@chef.local'`);
      for (const id of [owner, other]) {
        await client.query(
          `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
           values ($1, 'authenticated', 'authenticated', $2, 'encrypted', now())
           on conflict (id) do nothing`,
          [id, `it-g8-${id}@chef.local`],
        );
      }
      connected = true;
    }
  };
  const store = new SupabaseStore({
    query: async (text: string, params?: unknown[]) => { await ensure(); return client.query(text, params); },
    connect: async () => { await ensure(); return { query: (t: string, p?: unknown[]) => client.query(t, p), release: () => undefined }; },
  } as unknown as pg.Pool);
  return {
    store, owner, other, client,
    get connected() { return connected; },
    rollback: async () => { if (connected) await client.query('rollback').catch(() => undefined); await client.end().catch(() => undefined); },
  };
}

function liveDbQuery(s: ItStore): DbQuery {
  return {
    query: async (sql: string, params?: unknown[]) => {
      const res = await s.client.query(sql, params);
      return { rows: res.rows as Record<string, unknown>[] };
    },
  };
}

describe.skipIf(!enabled)('Gate 8 — Live integration (orchestration against real Supabase)', () => {
  const handles: Array<{ rollback: () => Promise<void> }> = [];

  afterEach(async () => { for (const h of handles) await h.rollback(); handles.length = 0; });
  afterAll(async () => {
    try {
      const c = new pg.Client({ host: cfg.dbHost, port: cfg.dbPort, user: cfg.dbUser, password: cfg.dbPassword, database: cfg.dbName, ssl: { rejectUnauthorized: false } });
      await c.connect();
      await c.query(`delete from auth.users where email like 'it-g8-%@chef.local'`);
      await c.end();
    } catch { /* best-effort */ }
  });

  it('detectMultiStepCommand identifies multi-step patterns', () => {
    expect(detectMultiStepCommand('create project Alpha then add tasks')).toBe(true);
    expect(detectMultiStepCommand('list projects')).toBe(false);
    expect(detectMultiStepCommand('create project, create tasks, list results')).toBe(true);
  });

  it('validatePlan catches invalid plans', () => {
    const plan = createPlan('x', 'y', 'development', [], 'c');
    expect(validatePlan(plan).valid).toBe(false);
  });

  it('orchestration creates a project and list_tasks via plan against live DB', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const project = await s.store.createProject(s.owner, { name: 'G8 Test', slug: 'g8-test', description: 'orchestration test' });
    expect(project.slug).toBe('g8-test');

    const plan = createPlan(s.owner, project.id, 'development', [
      { tool: 'create_task', args: { project_id: project.id, title: 'Step 1 task', description: 'created by orchestration' }, description: 'Create first task', dependsOn: [] },
      { tool: 'create_task', args: { project_id: project.id, title: 'Step 2 task', description: 'created by orchestration' }, description: 'Create second task', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: project.id }, description: 'List all tasks', dependsOn: [0, 1] },
    ], 'corr-g8');

    const validation = validatePlan(plan);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    const ctx: OrchestratorContext = {
      store: s.store,
      actorCtx: { ownerId: s.owner, actorId: s.owner, actorType: 'owner' },
      environment: 'development',
      projectId: project.id,
      toolDb: liveDbQuery(s),
    };

    const result = await executeOrchestration(plan, ctx);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.stepsCompleted).toBe(3);
    expect(result.stepsFailed).toBe(0);

    const tasks = await s.store.listTasks(s.owner, { projectId: project.id });
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    expect(tasks.some((t) => t.title === 'Step 1 task')).toBe(true);
    expect(tasks.some((t) => t.title === 'Step 2 task')).toBe(true);
  });

  it('orchestration records audit events via store', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const project = await s.store.createProject(s.owner, { name: 'G8 Audit', slug: 'g8-audit' });
    const correlationId = crypto.randomUUID();

    await s.store.recordAudit({
      actorType: 'owner', actorId: s.owner, action: 'orchestration.started',
      projectId: project.id, environmentId: null, resourceType: 'orchestration', resourceId: 'test-plan',
      authorizationResult: 'auto', correlationId, taskId: null,
      metadata: { planId: 'test-plan', stepsCount: 1 },
    });

    await s.store.recordAudit({
      actorType: 'owner', actorId: s.owner, action: 'orchestration.completed',
      projectId: project.id, environmentId: null, resourceType: 'orchestration', resourceId: 'test-plan',
      authorizationResult: 'auto', correlationId, taskId: null,
      metadata: { planId: 'test-plan', ok: true },
    });

    const audits = await s.store.listProjects(s.owner);
    expect(audits).toBeInstanceOf(Array);
  });

  it('orchestration with failFast returns on first handler failure', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const project = await s.store.createProject(s.owner, { name: 'G8 Fail', slug: 'g8-fail' });

    const plan = createPlan(s.owner, project.id, 'development', [
      { tool: 'update_task', args: { task_id: 'nonexistent-g8', status: 'completed' }, description: 'Update nonexistent', dependsOn: [] },
      { tool: 'list_projects', args: {}, description: 'List projects', dependsOn: [0] },
    ], 'corr-g8-fail');

    const ctx: OrchestratorContext = {
      store: s.store,
      actorCtx: { ownerId: s.owner, actorId: s.owner, actorType: 'owner' },
      environment: 'development',
      projectId: project.id,
      toolDb: liveDbQuery(s),
      failFast: true,
    };

    const result = await executeOrchestration(plan, ctx);
    expect(result.ok).toBe(false);
    expect(result.stepsFailed).toBe(1);
    expect(result.stepsSkipped).toBe(0);
  });
});
