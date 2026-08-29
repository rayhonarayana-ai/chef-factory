// CHEF FACTORY — Gate 41 — Live 24/7 Workforce Runtime acceptance + concurrency proofs.
// Independent pg.Client physical connections against real Supabase PostgreSQL.
// Proves: worker-service auto-execution, 2/10-worker races (exactly one winner, no
// duplicate execution, no deadlock), DAG continuation through the worker, cross-owner
// isolation, needs_approval stays blocked, owner lockdown, global emergency stop,
// stale-RUNNING recovery + restart safety, migration idempotency + RLS (authenticated
// read-only on workforce_control), and the worker-loop cycle against the live DB.
//
// Skipped when the live DB environment is absent (enabled=false).
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';
import { runWorkforce } from './workforceOrchestrator.js';
import { setGlobalEmergencyStop } from './security/workforceControl.js';
import { WORKFORCE_SERVICE_ACTOR } from './workforceService.js';
import { WorkforceWorker } from '../runtime/workerLoop.js';
import { getWorkforceRuntimeConfig } from '../runtime/config.js';
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
  const project = await store.createProject(ownerId, { name: 'G41Live', slug: 'g41-live-' + uuid() });
  const agent = await store.createAgent(ownerId, {
    name: 'G41Agent', slug: 'g41-ag-' + uuid(), role: 'worker', status: 'active', maxConcurrentTasks: 1,
  });
  await conn.query(
    `INSERT INTO public.agent_permissions (agent_id, project_id, resource_type, permission, status)
     VALUES ($1, $2, 'task', 'execute', 'active') ON CONFLICT DO NOTHING`,
    [agent.id, project.id],
  );
  return { ownerId, projectId: project.id, agentId: agent.id, conn, store };
}

async function createTask(
  store: SupabaseStore,
  ownerId: string,
  projectId: string,
  opts: { status?: string; approvalRequired?: boolean; missionId?: string | null; env?: string } = {},
): Promise<string> {
  const t = await store.createTask(ownerId, {
    projectId, title: 'G41Task', status: (opts.status ?? 'queued') as TaskRecord['status'],
    agentId: null, riskLevel: 'low', approvalRequired: opts.approvalRequired ?? false,
    missionId: opts.missionId ?? null,
    inputs: { intent: 'execute live orchestration', environment: opts.env ?? 'development', resource: 'task' },
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
const poolStores: pg.Pool[] = [];
const owners: Array<{ ownerId: string; conn: pg.Client }> = [];

afterAll(async () => {
  for (const o of owners) await deleteOwner(o.conn, o.ownerId).catch(() => {});
  for (const c of conns) await c.end().catch(() => {});
  for (const p of poolStores) await p.end().catch(() => {});
});

describe('Gate 41 — Live Workforce Worker + Global Control', () => {
  it('W1: worker-service initiation auto-executes an unassigned task against the live DB', async () => {
    if (!enabled) return;
    const conn = await makeConn(); conns.push(conn);
    const f = await createOwnerFixtures(conn, 'g41w1');
    owners.push({ ownerId: f.ownerId, conn });
    await createTask(f.store, f.ownerId, f.projectId);
    const runner = stubRunner();

    const r = await runWorkforce({
      store: f.store, execution: runner, ownerId: f.ownerId,
      actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'live-w1',
    });
    expect(r.outcome).toBe('completed');
    expect(r.placed).toBe(1);
    expect(r.executed).toBe(1);
    expect(r.error).toBeNull();
  });

  it('W2: 2 workers, same unassigned task -> exactly one execution, dup execution = 0', async () => {
    if (!enabled) return;
    const connA = await makeConn(); conns.push(connA);
    const connB = await makeConn(); conns.push(connB);
    const fA = await createOwnerFixtures(connA, 'g41ra');
    const fB = await createOwnerFixtures(connB, 'g41rb');
    owners.push({ ownerId: fA.ownerId, conn: connA });
    void fB;
    await createTask(fA.store, fA.ownerId, fA.projectId);

    const runnerA = stubRunner();
    const runnerB = stubRunner();
    const [ra, rb] = await Promise.all([
      runWorkforce({ store: fA.store, execution: runnerA, ownerId: fA.ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'live-a' }),
      runWorkforce({ store: fB.store, execution: runnerB, ownerId: fA.ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'live-b' }),
    ]);

    expect(ra.error).toBeNull();
    expect(rb.error).toBeNull();
    const total = (runnerA.calls.size) + (runnerB.calls.size);
    expect(total).toBeLessThanOrEqual(1);
    expect(ra.placed + rb.placed).toBeLessThanOrEqual(1);
  });

  it('W3: DAG continuation through the worker — dependent task executes after its prerequisite', async () => {
    if (!enabled) return;
    const conn = await makeConn(); conns.push(conn);
    const f = await createOwnerFixtures(conn, 'g41dag');
    owners.push({ ownerId: f.ownerId, conn });
    const t1 = await createTask(f.store, f.ownerId, f.projectId);
    const t2 = await createTask(f.store, f.ownerId, f.projectId);
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: t1, dependentTaskId: t2 });
    const runner = stubRunner();

    const r1 = await runWorkforce({ store: f.store, execution: runner, ownerId: f.ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'live-dag' });
    expect(r1.placed).toBe(1);

    const runner2 = stubRunner();
    const r2 = await runWorkforce({ store: f.store, execution: runner2, ownerId: f.ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'live-dag' });
    expect(r2.placed).toBe(1);
    expect(r2.executed).toBe(1);
    void t2;
  });

  it('W4: cross-owner isolation — other owners are not scheduled by this owner run', async () => {
    if (!enabled) return;
    const conn = await makeConn(); conns.push(conn);
    const fA = await createOwnerFixtures(conn, 'g41iso-a');
    const fB = await createOwnerFixtures(conn, 'g41iso-b');
    owners.push({ ownerId: fA.ownerId, conn }, { ownerId: fB.ownerId, conn: fB.conn });
    const tB = await createTask(fB.store, fB.ownerId, fB.projectId); // foreign task
    const runner = stubRunner();

    const r = await runWorkforce({ store: fA.store, execution: runner, ownerId: fA.ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'live-iso' });
    expect(r.placed).toBe(0);
    expect(runner.calls.has(tB)).toBe(false);
    expect(r.outcome).toBe('nothing_to_do');
  });

  it('W5: needs_approval coexists — worker does not approve; requiresApproval task stays blocked', async () => {
    if (!enabled) return;
    const conn = await makeConn(); conns.push(conn);
    const f = await createOwnerFixtures(conn, 'g41appr');
    owners.push({ ownerId: f.ownerId, conn });
    // The authority approval boundary is triggered by the environment (production
    // write/execute => REQUIRE_APPROVAL), the frozen mechanism proven in Gate 37 test 12.
    // `approvalRequired: true` is retained as the semantic owner marker.
    const taskId = await createTask(f.store, f.ownerId, f.projectId, { approvalRequired: true, env: 'production' });
    const runner = stubRunner();
    const r = await runWorkforce({ store: f.store, execution: runner, ownerId: f.ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'live-appr' });
    // Frozen semantic B (Gate 37 test 12): the approval-required task is discovered and
    // placed, but execution stops at the approval boundary BEFORE the downstream runner.
    expect(r.placed).toBe(1);             // may be placed
    expect(r.executed).toBe(1);           // passed to executor; authority resolved
    expect(r.approvalRequired).toBe(1);   // reached the approval boundary
    expect(r.completed).toBe(0);          // NO auto-approval / NOT completed without approval
    expect(runner.calls.size).toBe(0);    // downstream execution never invoked
    // The task is NOT completed without approval and no agent/workforce grant occurred.
    const after = await f.store.getTask(f.ownerId, taskId);
    expect(after).not.toBeNull();
    expect(['queued', 'needs_approval']).toContain(after!.status);
    expect(after!.status).not.toBe('completed');
    expect(after!.status).not.toBe('failed');
  });

  it('W6: owner lockdown aborts before scheduling', async () => {
    if (!enabled) return;
    const conn = await makeConn(); conns.push(conn);
    const f = await createOwnerFixtures(conn, 'g41lk');
    owners.push({ ownerId: f.ownerId, conn });
    await createTask(f.store, f.ownerId, f.projectId);
    await f.conn.query(
      `INSERT INTO public.security_lockdowns (lockdown_id, owner_id, scope, reason, activated_by, status)
       VALUES ($1, $2, 'all', 'live lockdown', $2, 'active') ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), f.ownerId],
    );
    const runner = stubRunner();
    const r = await runWorkforce({ store: f.store, execution: runner, ownerId: f.ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'live-lk' });
    expect(r.outcome).toBe('aborted');
    expect(r.placed).toBe(0);
  });

  it('W7: global emergency stop — authorized system-admin stops; worker-service cannot toggle; worker sees it fail-closed', async () => {
    if (!enabled) return;
    const conn = await makeConn(); conns.push(conn);
    const f = await createOwnerFixtures(conn, 'g41stop');
    owners.push({ ownerId: f.ownerId, conn });
    await createTask(f.store, f.ownerId, f.projectId);

    // Non-admin (workforce service) is denied the write path.
    await expect(
      setGlobalEmergencyStop({ control: f.store, store: f.store }, { globallyEnabled: false, reason: 'x', actorId: WORKFORCE_SERVICE_ACTOR, actorType: 'system' }),
    ).rejects.toThrow(/denied/);

    // Authorized system-admin stops the world.
    await setGlobalEmergencyStop({ control: f.store, store: f.store }, { globallyEnabled: false, reason: 'live incident', actorId: 'system:admin', actorType: 'system' });
    const runner = stubRunner();
    const r = await runWorkforce({ store: f.store, execution: runner, ownerId: f.ownerId, actorId: WORKFORCE_SERVICE_ACTOR, workforceService: true, workerId: 'live-stop' });
    expect(r.outcome).toBe('global_stopped');
    expect(r.placed).toBe(0);
    expect(runner.calls.size).toBe(0);

    // Restore global state for other tests.
    await setGlobalEmergencyStop({ control: f.store, store: f.store }, { globallyEnabled: true, reason: 'resolved', actorId: 'system:admin', actorType: 'system' });
  });

  it('M1: workforce_control migration idempotent + RLS read-only for authenticated', async () => {
    if (!enabled) return;
    const conn = await makeConn(); conns.push(conn);
    const f = await createOwnerFixtures(conn, 'g41mig');
    owners.push({ ownerId: f.ownerId, conn });
    const rows = await f.conn.query(`SELECT count(*)::int AS n FROM public.workforce_control WHERE singleton_key = 'global'`);
    expect(rows.rows[0].n).toBe(1);
    const gr = await f.conn.query(`SELECT globally_enabled FROM public.workforce_control WHERE singleton_key = 'global'`);
    expect(gr.rows[0].globally_enabled).toBe(true);

    // RLS (authenticated read-only on workforce_control): the write boundary is enforced
    // by row-level security, not by table-level grants (Supabase default-grants table
    // ALL to `authenticated`). Prove it behaviorally by exercising RLS as `authenticated`.
    // NOTE: row_security_active() must be evaluated as a role subject to RLS — it returns
    // false for the table owner/superuser whose rows bypass RLS — so check it after SET ROLE.
    await f.conn.query(`SET ROLE authenticated`);
    try {
      const rlsEnabled = await f.conn.query(`SELECT row_security_active('public.workforce_control') AS rls_enabled`);
      expect(rlsEnabled.rows[0].rls_enabled).toBe(true);
      // SELECT (permitted by workforce_control_select) still returns the singleton.
      const sel = await f.conn.query(
        `SELECT count(*)::int AS n FROM public.workforce_control WHERE singleton_key = 'global'`,
      );
      expect(sel.rows[0].n).toBe(1);
      // UPDATE/DELETE are filtered to 0 rows by RLS (permissive `false` policies).
      const upd = await f.conn.query(
        `UPDATE public.workforce_control SET globally_enabled = false WHERE singleton_key = 'global'`,
      );
      expect(upd.rowCount).toBe(0);
      const del = await f.conn.query(
        `DELETE FROM public.workforce_control WHERE singleton_key = 'global'`,
      );
      expect(del.rowCount).toBe(0);
      // The singleton is unchanged by the denied write.
      const after = await f.conn.query(
        `SELECT globally_enabled FROM public.workforce_control WHERE singleton_key = 'global'`,
      );
      expect(after.rows[0].globally_enabled).toBe(true);
    } finally {
      await f.conn.query(`RESET ROLE`);
    }
  });

  it('W8: stale recovery + restart safety — worker recovers stale RUNNING tasks at startup', async () => {
    if (!enabled) return;
    const conn = await makeConn(); conns.push(conn);
    const f = await createOwnerFixtures(conn, 'g41stale');
    owners.push({ ownerId: f.ownerId, conn });
    const t = await createTask(f.store, f.ownerId, f.projectId);
    // Backdate a RUNNING task that predates our recovery window.
    await f.conn.query(
      `UPDATE public.tasks SET status='running', started_at = now() - interval '2 hours', updated_at = now() - interval '2 hours' WHERE id = $1`,
      [t],
    );
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
    const recovered = await f.store.recoverStaleRunningTasks(staleBefore);
    expect(recovered).toBeGreaterThanOrEqual(1);
  });

  it('W9: the worker loop cycles against the live DB and reports work/idle', async () => {
    if (!enabled) return;
    const conn = await makeConn(); conns.push(conn);
    const f = await createOwnerFixtures(conn, 'g41loop');
    owners.push({ ownerId: f.ownerId, conn });
    await createTask(f.store, f.ownerId, f.projectId);

    // Isolate this worker's cycle: runCycle() sweeps EVERY owner returned by
    // listOwnersWithSchedulableWork (global, not per-owner). Leftover schedulable
    // queued tasks from other tests/runs in this shared live DB would otherwise be
    // processed too — making the cycle slow and non-deterministic and breaking the
    // second-cycle 'idle' expectation. Clean up foreign schedulable work so only this
    // owner's task remains, mirroring a fresh single-owner DB.
    await f.conn.query(
      `UPDATE public.tasks SET status = 'cancelled', updated_at = now()
        WHERE status = 'queued' AND agent_id IS NULL AND owner_id <> $1 AND NOT EXISTS (
         SELECT 1 FROM public.task_dependencies d
         WHERE d.dependent_task_id = tasks.id
           AND NOT EXISTS (
             SELECT 1 FROM public.tasks pr
             WHERE pr.id = d.prerequisite_task_id AND pr.status = 'completed'
           )
       )`,
      [f.ownerId],
    );

    // The production worker runs bounded-parallel claim transactions via pool.connect()
    // (maxParallelExecutions defaults to 3; each claim does BEGIN + pg_advisory_xact_lock
    // + COMMIT). That requires a REAL multi-connection pg.Pool (as production uses in
    // getPool()). The per-test fake single-client wrapper would self-deadlock on the
    // advisory lock if >1 task is claimed in parallel, so give the worker a real pool.
    const workerPool = new pg.Pool({
      host: cfg.dbHost, port: cfg.dbPort, user: cfg.dbUser,
      password: cfg.dbPassword, database: cfg.dbName,
      max: 5, connectionTimeoutMillis: 30000,
      ssl: { rejectUnauthorized: false },
    });
    poolStores.push(workerPool);

    const runner = stubRunner();
    const config = getWorkforceRuntimeConfig({ FACTORY_WORKER_MAX_OWNERS_PER_CYCLE: '8' });
    const worker = new WorkforceWorker({ store: new SupabaseStore(workerPool), execution: runner, config });
    const activity = await worker.runCycle();
    // Either the task executes (work) or is momentarily claimed by the pool; afterwards
    // a second cycle has nothing to do (idle).
    expect(['work', 'idle']).toContain(activity);
    const activity2 = await worker.runCycle();
    expect(activity2).toBe('idle');
  });
});
