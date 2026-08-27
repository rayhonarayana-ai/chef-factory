// CHEF FACTORY — Gate 37 — Live Workforce Orchestration Concurrency Proofs.
// Independent pg.Client physical connections against real Supabase PostgreSQL.
// Proves two/many orchestrators discovering the same task yield exactly one
// placement + one execution (no duplicate execution, no capacity overflow,
// no deadlock, no cross-owner/project leakage, no duplicate on re-run).
//
// Skipped when the live DB environment is absent (enabled=false).

import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';
import { runWorkforce } from './workforceOrchestrator.js';
import type { TaskRecord } from './types.js';
import type { ExecutionOutcome, ExecutionRunner } from './pipeline.js';

const cfg = getFactoryConfig(loadEnvFile());
const enabled = Boolean(cfg.dbPassword && cfg.dbHost);

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function makeConn(): Promise<pg.Client> {
  const c = new pg.Client({
    host: cfg.dbHost, port: cfg.dbPort, user: cfg.dbUser,
    password: cfg.dbPassword, database: cfg.dbName,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  return c;
}

function wrapConn(conn: pg.Client) {
  return {
    query: (text: string, params?: unknown[]) => conn.query(text, params),
    connect: async () => ({
      query: (t: string, p?: unknown[]) => conn.query(t, p),
      release: () => undefined,
    }),
  } as unknown as pg.Pool;
}

// Stub ExecutionRunner: no LLM, records invocations per taskId, returns success.
function stubRunner(): ExecutionRunner & { calls: Map<string, number> } {
  const calls = new Map<string, number>();
  return {
    calls,
    execute: async (task: TaskRecord): Promise<ExecutionOutcome> => {
      calls.set(task.id, (calls.get(task.id) ?? 0) + 1);
      return { ok: true, output: { done: true }, cost: 0.001 };
    },
  };
}

interface OwnerFixtures {
  ownerId: string;
  projectId: string;
  agentId: string;
  conn: pg.Client;
  store: SupabaseStore;
}

async function createOwnerFixtures(conn: pg.Client, tag: string): Promise<OwnerFixtures> {
  const ownerId = crypto.randomUUID();
  const email = `${tag}-${ownerId.slice(0, 8)}@chef.local`;
  await conn.query(
    `INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
     VALUES ($1, 'authenticated', 'authenticated', $2, 'encrypted', now()) ON CONFLICT DO NOTHING`,
    [ownerId, email],
  );
  await conn.query(
    `INSERT INTO public.owners (id, email, status) VALUES ($1, $2, 'active') ON CONFLICT DO NOTHING`,
    [ownerId, email],
  );
  const store = new SupabaseStore(wrapConn(conn));
  const project = await store.createProject(ownerId, { name: 'G37Live', slug: 'g37-live-' + uuid() });
  const agent = await store.createAgent(ownerId, {
    name: 'G37Agent', slug: 'g37-ag-' + uuid(), role: 'worker', status: 'active', maxConcurrentTasks: 1,
  });
  // explicit execute permission (permissions come only from agent_permissions)
  await conn.query(
    `INSERT INTO public.agent_permissions (agent_id, project_id, resource_type, permission, status)
     VALUES ($1, $2, 'task', 'execute', 'active') ON CONFLICT DO NOTHING`,
    [agent.id, project.id],
  );
  return { ownerId, projectId: project.id, agentId: agent.id, conn, store };
}

async function createUnassignedTask(store: SupabaseStore, ownerId: string, projectId: string): Promise<string> {
  const t = await store.createTask(ownerId, {
    projectId, title: 'G37Task', status: 'queued', agentId: null, riskLevel: 'low',
    inputs: { intent: 'execute live orchestration', environment: 'development', resource: 'task' },
  });
  return t.id;
}

async function deleteOwner(conn: pg.Client, ownerId: string): Promise<void> {
  try {
    await conn.query(`DELETE FROM public.tasks WHERE owner_id = $1`, [ownerId]);
    await conn.query(`DELETE FROM public.agents WHERE owner_id = $1`, [ownerId]);
    await conn.query(`DELETE FROM public.projects WHERE owner_id = $1`, [ownerId]);
    await conn.query(`DELETE FROM public.owners WHERE id = $1`, [ownerId]);
    await conn.query(`DELETE FROM auth.users WHERE id = $1`, [ownerId]);
  } catch { /* best-effort */ }
}

const conns: pg.Client[] = [];
const owners: Array<{ ownerId: string; conn: pg.Client }> = [];

afterAll(async () => {
  for (const o of owners) await deleteOwner(o.conn, o.ownerId).catch(() => {});
  for (const c of conns) await c.end().catch(() => {});
});

describe('Gate 37 — Live Workforce Concurrency', () => {
  it('LP1: 2 orchestrators, same unassigned task -> exactly one placement/execution winner, dup execution = 0', async () => {
    if (!enabled) return;
    const connA = await makeConn(); conns.push(connA);
    const connB = await makeConn(); conns.push(connB);
    const fA = await createOwnerFixtures(connA, 'g37a');
    const fB = await createOwnerFixtures(connB, 'g37b');
    owners.push({ ownerId: fA.ownerId, conn: connA });
    void fB;

    const taskId = await createUnassignedTask(fA.store, fA.ownerId, fA.projectId);
    const runnerA = stubRunner();
    const runnerB = stubRunner();

    // Two independent orchestrator processes on two physical connections, same task.
    const [ra, rb] = await Promise.all([
      runWorkforce({ store: fA.store, execution: runnerA, ownerId: fA.ownerId, actorId: fA.ownerId, projectId: fA.projectId }),
      runWorkforce({ store: fB.store, execution: runnerB, ownerId: fA.ownerId, actorId: fA.ownerId, projectId: fA.projectId }),
    ]);

    expect(ra.error).toBeNull();
    expect(rb.error).toBeNull();

    // Exactly one run executed the task.
    const aExec = runnerA.calls.get(taskId) ?? 0;
    const bExec = runnerB.calls.get(taskId) ?? 0;
    expect(aExec + bExec).toBe(1);

    // No duplicate execution recorded in the DB.
    const runs = await connA.query(`SELECT count(*)::int AS n FROM public.task_runs WHERE task_id = $1`, [taskId]);
    expect((runs.rows[0] as { n: number }).n).toBe(1);

    // Task reached a terminal state exactly once (completed).
    const task = await fA.store.getTask(fA.ownerId, taskId);
    expect(task?.status).toBe('completed');
  });

  it('LP2: 10 orchestrators, same task -> exactly one winner, dup execution = 0, deadlocks = 0', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const f = await createOwnerFixtures(main, 'g37lp2');
    owners.push({ ownerId: f.ownerId, conn: main });
    const taskId = await createUnassignedTask(f.store, f.ownerId, f.projectId);

    // 10 independent worker connections running runWorkforce concurrently.
    const workerConns: pg.Client[] = [];
    const workerStores: SupabaseStore[] = [];
    const runners: Array<ReturnType<typeof stubRunner>> = [];
    for (let i = 0; i < 10; i++) {
      const c = await makeConn(); workerConns.push(c);
      workerStores.push(new SupabaseStore(wrapConn(c)));
      runners.push(stubRunner());
    }

    const results = await Promise.all(
      workerStores.map((s, i) =>
        runWorkforce({ store: s, execution: runners[i], ownerId: f.ownerId, actorId: f.ownerId, projectId: f.projectId }),
      ),
    );
    for (const r of results) expect(r.error).toBeNull();

    const totalExec = runners.reduce((acc, r) => acc + (r.calls.get(taskId) ?? 0), 0);
    expect(totalExec).toBe(1);

    const runs = await main.query(`SELECT count(*)::int AS n FROM public.task_runs WHERE task_id = $1`, [taskId]);
    expect((runs.rows[0] as { n: number }).n).toBe(1);

    const task = await f.store.getTask(f.ownerId, taskId);
    expect(task?.status).toBe('completed');

    for (const c of workerConns) await c.end().catch(() => {});
  });

  it('LP3: many tasks compete for one capacity=1 agent -> capacity overflow = 0', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const f = await createOwnerFixtures(main, 'g37lp3');
    owners.push({ ownerId: f.ownerId, conn: main });
    const taskIds: string[] = [];
    for (let i = 0; i < 5; i++) taskIds.push(await createUnassignedTask(f.store, f.ownerId, f.projectId));

    const r = await runWorkforce({ store: f.store, execution: stubRunner(), ownerId: f.ownerId, actorId: f.ownerId, projectId: f.projectId });

    // At most 1 task placed+executed for the capacity=1 agent (sequential placement
    // binds capacity; later tasks are capacity-blocked).
    expect(r.placed).toBeLessThanOrEqual(1);
    const assigned = await main.query(
      `SELECT count(*)::int AS n FROM public.tasks WHERE owner_id = $1 AND agent_id IS NOT NULL AND status NOT IN ('completed','failed','cancelled')`,
      [f.ownerId],
    );
    expect((assigned.rows[0] as { n: number }).n).toBeLessThanOrEqual(1);
  });

  it('LP4: capacity=N -> concurrent assigned workload never exceeds N', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const ownerId = crypto.randomUUID();
    const email = `g37lp4-${ownerId.slice(0, 8)}@chef.local`;
    await main.query(`INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at) VALUES ($1,'authenticated','authenticated',$2,'encrypted',now()) ON CONFLICT DO NOTHING`, [ownerId, email]);
    await main.query(`INSERT INTO public.owners (id, email, status) VALUES ($1,$2,'active') ON CONFLICT DO NOTHING`, [ownerId, email]);
    owners.push({ ownerId, conn: main });
    const store = new SupabaseStore(wrapConn(main));
    const project = await store.createProject(ownerId, { name: 'G37LP4', slug: 'g37-lp4-' + uuid() });
    const agent = await store.createAgent(ownerId, { name: 'N', slug: 'g37-n-' + uuid(), role: 'worker', status: 'active', maxConcurrentTasks: 3 });
    await main.query(`INSERT INTO public.agent_permissions (agent_id, project_id, resource_type, permission, status) VALUES ($1,$2,'task','execute','active') ON CONFLICT DO NOTHING`, [agent.id, project.id]);
    const taskIds: string[] = [];
    for (let i = 0; i < 8; i++) taskIds.push(await createUnassignedTask(store, ownerId, project.id));
    void taskIds;

    const r = await runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId, projectId: project.id });

    // Concurrent assigned workload never exceeds capacity (3).
    const assigned = await main.query(
      `SELECT count(*)::int AS n FROM public.tasks WHERE owner_id = $1 AND agent_id = $2 AND status NOT IN ('completed','failed','cancelled')`,
      [ownerId, agent.id],
    );
    expect((assigned.rows[0] as { n: number }).n).toBeLessThanOrEqual(3);
    expect(r.placed).toBeLessThanOrEqual(3);
    void r;
  });

  it('LP5: losing orchestrator does NOT reassign the winner task', async () => {
    if (!enabled) return;
    const connA = await makeConn(); conns.push(connA);
    const connB = await makeConn(); conns.push(connB);
    const fA = await createOwnerFixtures(connA, 'g37lp5a');
    const fB = await createOwnerFixtures(connB, 'g37lp5b');
    owners.push({ ownerId: fA.ownerId, conn: connA });
    void fB;
    const taskId = await createUnassignedTask(fA.store, fA.ownerId, fA.projectId);

    await Promise.all([
      runWorkforce({ store: fA.store, execution: stubRunner(), ownerId: fA.ownerId, actorId: fA.ownerId, projectId: fA.projectId }),
      runWorkforce({ store: fB.store, execution: stubRunner(), ownerId: fA.ownerId, actorId: fA.ownerId, projectId: fA.projectId }),
    ]);

    const task = await fA.store.getTask(fA.ownerId, taskId);
    // Winner assignment is preserved; loser never re-assigned or unassigned.
    expect(task?.agentId).not.toBeNull();
    expect(task?.status).toBe('completed');
  });

  it('LP6: cross-owner task is never scheduled', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const ownerA = await createOwnerFixtures(main, 'g37a');
    const ownerB = await createOwnerFixtures(main, 'g37b');
    owners.push({ ownerId: ownerA.ownerId, conn: main }, { ownerId: ownerB.ownerId, conn: main });
    await createUnassignedTask(ownerB.store, ownerB.ownerId, ownerB.projectId);

    const r = await runWorkforce({ store: ownerA.store, execution: stubRunner(), ownerId: ownerA.ownerId, actorId: ownerA.ownerId, projectId: ownerA.projectId });

    expect(r.discovered).toBe(0);
    // Owner B's task remains unassigned/untouched.
    const bTask = (await main.query(`SELECT id, agent_id, status FROM public.tasks WHERE owner_id = $1`, [ownerB.ownerId])).rows[0] as { agent_id: string | null; status: string };
    expect(bTask.agent_id).toBeNull();
    expect(bTask.status).toBe('queued');
  });

  it('LP7: cross-project filtering works', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const f = await createOwnerFixtures(main, 'g37lp7');
    owners.push({ ownerId: f.ownerId, conn: main });
    const project2 = await f.store.createProject(f.ownerId, { name: 'P2', slug: 'g37-p2-' + uuid() });
    await main.query(`INSERT INTO public.agent_permissions (agent_id, project_id, resource_type, permission, status) VALUES ($1,$2,'task','execute','active') ON CONFLICT DO NOTHING`, [f.agentId, project2.id]);
    await createUnassignedTask(f.store, f.ownerId, f.projectId);
    const task2 = await createUnassignedTask(f.store, f.ownerId, project2.id);

    const r = await runWorkforce({ store: f.store, execution: stubRunner(), ownerId: f.ownerId, actorId: f.ownerId, projectId: f.projectId });

    expect(r.discovered).toBe(1); // only project1 task
    const other = (await main.query(`SELECT status FROM public.tasks WHERE id = $1`, [task2])).rows[0] as { status: string };
    expect(other.status).toBe('queued'); // project2 task untouched
  });

  it('LP8: crash/restart re-run does not duplicate completed execution', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const f = await createOwnerFixtures(main, 'g37lp8');
    owners.push({ ownerId: f.ownerId, conn: main });
    const taskId = await createUnassignedTask(f.store, f.ownerId, f.projectId);

    // First run completes the task.
    const r1 = await runWorkflowHelper(f.store, f.ownerId, f.projectId);
    expect(r1.completed).toBe(1);

    // Re-run (restart) after the task completed -> nothing to do, no duplicate.
    const r2 = await runWorkflowHelper(f.store, f.ownerId, f.projectId);
    expect(r2.outcome).toBe('nothing_to_do');
    expect(r2.executed).toBe(0);

    const runs = await main.query(`SELECT count(*)::int AS n FROM public.task_runs WHERE task_id = $1`, [taskId]);
    expect((runs.rows[0] as { n: number }).n).toBe(1);
    const task = await f.store.getTask(f.ownerId, taskId);
    expect(task?.status).toBe('completed');
  });
});

async function runWorkflowHelper(store: SupabaseStore, ownerId: string, projectId: string) {
  return runWorkforce({ store, execution: stubRunner(), ownerId, actorId: ownerId, projectId });
}
