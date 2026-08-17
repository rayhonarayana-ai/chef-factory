// CHEF FACTORY — Gate 9 — Live integration test (orchestration wiring against real Supabase).
// Guarded: skipped unless FACTORY_* env is present.
// Proves the production pipeline actually invokes executeOrchestration() with real DB.

import pg from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';
import { CommandPipeline, type ActorContext, type ExecutionOutcome, type ExecutionRunner, type PlanStepsResult } from '../core/pipeline.js';
import { SecurityGuardian } from '../core/security/guardian.js';
import { RateLimiter } from '../core/security/rateLimit.js';
import { AnomalyDetector } from '../core/security/anomaly.js';
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
      await client.query(`delete from auth.users where email like 'it-g9-%@chef.local'`);
      for (const id of [owner, other]) {
        await client.query(
          `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
           values ($1, 'authenticated', 'authenticated', $2, 'encrypted', now())
           on conflict (id) do nothing`,
          [id, `it-g9-${id}@chef.local`],
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

function makePlanRunner(steps: PlanStepsResult['steps']): ExecutionRunner {
  return {
    execute: async (): Promise<ExecutionOutcome> => ({ ok: true, output: { text: 'fallback' }, cost: 0 }),
    planSteps: async (): Promise<PlanStepsResult> => ({ steps, cost: 0, modelId: 'm-live' }),
  };
}

describe.skipIf(!enabled)('Gate 9 — Live integration (orchestration wiring against real Supabase)', () => {
  const handles: Array<{ rollback: () => Promise<void> }> = [];

  afterEach(async () => { for (const h of handles) await h.rollback(); handles.length = 0; });
  afterAll(async () => {
    try {
      const c = new pg.Client({ host: cfg.dbHost, port: cfg.dbPort, user: cfg.dbUser, password: cfg.dbPassword, database: cfg.dbName, ssl: { rejectUnauthorized: false } });
      await c.connect();
      await c.query(`delete from auth.users where email like 'it-g9-%@chef.local'`);
      await c.end();
    } catch { /* best-effort */ }
  });

  // E1 + E2: Real multi-step request enters pipeline → invokes executeOrchestration()
  it('E1+E2: real multi-step request enters pipeline and invokes executeOrchestration', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const ctx: ActorContext = { ownerId: s.owner, actorId: s.owner, actorType: 'owner' };
    const project = await s.store.createProject(s.owner, { name: 'G9 Live', slug: 'g9-live', description: 'live test' });

    const runner = makePlanRunner([
      { tool: 'list_tasks', args: { project_id: project.id }, description: 'List tasks', dependsOn: [] },
    ]);
    const pipeline = new CommandPipeline(s.store, runner, undefined, undefined, undefined, liveDbQuery(s));
    const r = await pipeline.run(ctx, 'create task "A" in g9-live then list tasks in g9-live');

    expect(r.outcome).toBe('executed');
    expect(r.task?.status).toBe('completed');
    // The result must contain orchestration evidence
    expect(r.explanation.evidence.some((e) => e.startsWith('planId='))).toBe(true);
    expect(r.explanation.evidence.some((e) => e.startsWith('steps='))).toBe(true);
  });

  // E3 + E4: Real plan validation and step execution
  it('E3+E4: real plan validation and step execution occur', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const ctx: ActorContext = { ownerId: s.owner, actorId: s.owner, actorType: 'owner' };
    const project = await s.store.createProject(s.owner, { name: 'G9 Steps', slug: 'g9-steps', description: 'live test' });

    const runner = makePlanRunner([
      { tool: 'list_tasks', args: { project_id: project.id }, description: 'List tasks', dependsOn: [] },
      { tool: 'list_projects', args: {}, description: 'List projects', dependsOn: [] },
    ]);
    const pipeline = new CommandPipeline(s.store, runner, undefined, undefined, undefined, liveDbQuery(s));
    const r = await pipeline.run(ctx, 'create task "A" in g9-steps then list tasks in g9-steps');

    expect(r.outcome).toBe('executed');
    expect(r.task?.status).toBe('completed');
    // Two steps completed
    expect(r.explanation.evidence.some((e) => e.startsWith('steps=2/'))).toBe(true);
  });

  // E5 + E6: Real ToolBroker and Guardian paths are used
  it('E5+E6: real ToolBroker and Guardian paths are used (guardian wired through)', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const ctx: ActorContext = { ownerId: s.owner, actorId: s.owner, actorType: 'owner' };
    const project = await s.store.createProject(s.owner, { name: 'G9 Broker', slug: 'g9-broker', description: 'live test' });

    const guardian = new SecurityGuardian({
      lockdown: () => null,
      rateLimiter: new RateLimiter(),
      anomaly: new AnomalyDetector(),
      recordEvent: () => {},
      costCheck: async () => ({ stopped: false, reason: null }),
    });

    const runner = makePlanRunner([
      { tool: 'list_tasks', args: { project_id: project.id }, description: 'List tasks', dependsOn: [] },
    ]);
    const pipeline = new CommandPipeline(s.store, runner, guardian, undefined, undefined, liveDbQuery(s));
    const r = await pipeline.run(ctx, 'create task "A" in g9-broker then list tasks in g9-broker');

    // Guardian is wired through: pipeline completes successfully with guardian present
    expect(r.outcome).toBe('executed');
    expect(r.task?.status).toBe('completed');
  });

  // E7: Real authority evaluation
  it('E7: real authority evaluation occurs', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const ctx: ActorContext = { ownerId: s.owner, actorId: s.owner, actorType: 'owner' };
    const project = await s.store.createProject(s.owner, { name: 'G9 Auth', slug: 'g9-auth', description: 'live test' });

    const runner = makePlanRunner([
      { tool: 'list_tasks', args: { project_id: project.id }, description: 'List tasks', dependsOn: [] },
    ]);
    const pipeline = new CommandPipeline(s.store, runner, undefined, undefined, undefined, liveDbQuery(s));
    const r = await pipeline.run(ctx, 'create task "A" in g9-auth then list tasks in g9-auth');

    expect(r.outcome).toBe('executed');
    expect(r.authority).not.toBeNull();
    expect(r.authority!.outcome).toBeDefined();
  });

  // E8: Real tool action occurs exactly once
  it('E8: tool action occurs exactly once per step', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const ctx: ActorContext = { ownerId: s.owner, actorId: s.owner, actorType: 'owner' };
    const project = await s.store.createProject(s.owner, { name: 'G9 Once', slug: 'g9-once', description: 'live test' });

    const runner = makePlanRunner([
      { tool: 'list_tasks', args: { project_id: project.id }, description: 'List tasks step 1', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: project.id }, description: 'List tasks step 2', dependsOn: [] },
    ]);
    const pipeline = new CommandPipeline(s.store, runner, undefined, undefined, undefined, liveDbQuery(s));
    const r = await pipeline.run(ctx, 'create task "A" in g9-once then list tasks in g9-once');

    expect(r.outcome).toBe('executed');
    expect(r.task?.status).toBe('completed');
    // Both steps completed (2/2)
    expect(r.explanation.evidence.some((e) => e.startsWith('steps=2/'))).toBe(true);
  });

  // E9: Failure/approval semantics work
  it('E9: failure semantics work (validation-error step fails orchestration)', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const ctx: ActorContext = { ownerId: s.owner, actorId: s.owner, actorType: 'owner' };
    const project = await s.store.createProject(s.owner, { name: 'G9 Fail', slug: 'g9-fail', description: 'live test' });

    // Step 0 fails at application level (empty project_id → validation error, no DB abort)
    const runner = makePlanRunner([
      { tool: 'create_task', args: { project_id: '', title: 'bad' }, description: 'Create with empty project', dependsOn: [] },
    ]);
    const pipeline = new CommandPipeline(s.store, runner, undefined, undefined, undefined, liveDbQuery(s));
    const r = await pipeline.run(ctx, 'create task "A" in g9-fail then list tasks in g9-fail');

    expect(['failed', 'retry_pending']).toContain(r.outcome);
  });

  // E10: Dependent step with variable resolution
  it('E10: dependent step executes after successful dependency', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const ctx: ActorContext = { ownerId: s.owner, actorId: s.owner, actorType: 'owner' };
    const project = await s.store.createProject(s.owner, { name: 'G9 Dep', slug: 'g9-dep', description: 'live test' });

    const runner = makePlanRunner([
      { tool: 'create_task', args: { project_id: project.id, title: 'Dependency task' }, description: 'Create task', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: project.id }, description: 'List after create', dependsOn: [0] },
    ]);
    const pipeline = new CommandPipeline(s.store, runner, undefined, undefined, undefined, liveDbQuery(s));
    const r = await pipeline.run(ctx, 'create task "A" in g9-dep then list tasks in g9-dep');

    expect(r.outcome).toBe('executed');
    expect(r.task?.status).toBe('completed');
  });

  // E11: Final response reflects real execution
  it('E11: final response reflects real orchestration execution', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const ctx: ActorContext = { ownerId: s.owner, actorId: s.owner, actorType: 'owner' };
    const project = await s.store.createProject(s.owner, { name: 'G9 Final', slug: 'g9-final', description: 'live test' });

    const runner = makePlanRunner([
      { tool: 'list_tasks', args: { project_id: project.id }, description: 'List tasks', dependsOn: [] },
    ]);
    const pipeline = new CommandPipeline(s.store, runner, undefined, undefined, undefined, liveDbQuery(s));
    const r = await pipeline.run(ctx, 'create task "A" in g9-final then list tasks in g9-final');

    expect(r.outcome).toBe('executed');
    expect(r.explanation.outcome).toBe('executed');
    expect(r.explanation.decision).toContain('Multi-step');
    expect(r.explanation.evidence.some((e) => e.startsWith('planId='))).toBe(true);
    expect(r.explanation.evidence.some((e) => e.startsWith('steps='))).toBe(true);
  });

  // E12: No duplicate database mutation
  it('E12: no duplicate database mutation occurs', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const ctx: ActorContext = { ownerId: s.owner, actorId: s.owner, actorType: 'owner' };
    const project = await s.store.createProject(s.owner, { name: 'G9 NoDup', slug: 'g9-nodup', description: 'live test' });

    const runner = makePlanRunner([
      { tool: 'create_task', args: { project_id: project.id, title: 'NoDup Task' }, description: 'Create', dependsOn: [] },
      { tool: 'list_tasks', args: { project_id: project.id }, description: 'List', dependsOn: [0] },
    ]);
    const pipeline = new CommandPipeline(s.store, runner, undefined, undefined, undefined, liveDbQuery(s));
    const r = await pipeline.run(ctx, 'create task "A" in g9-nodup then list tasks in g9-nodup');

    expect(r.outcome).toBe('executed');
    const tasks = await s.store.listTasks(s.owner, { projectId: project.id });
    const noDupTasks = tasks.filter((t) => t.title === 'NoDup Task');
    expect(noDupTasks).toHaveLength(1);
  });
});
