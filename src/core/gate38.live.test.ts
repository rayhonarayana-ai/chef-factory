// CHEF FACTORY — Gate 38 — Live Task Dependency / DAG proofs.
// Independent pg.Client physical connections against real Supabase PostgreSQL.
// Proves: migration/objects present, RLS/constraints/indexes, real cross-owner /
// cross-project / self-dependency / cycle rejection, the CONCURRENT opposite-edge
// cycle race (distributed-safe serialization), and the TOCTOU closure
// (stale discovery cannot execute). Skipped when the live DB env is absent.

import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';

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

interface OwnerFixtures {
  ownerId: string;
  projectId: string;
  project2Id: string | null;
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
  const project = await store.createProject(ownerId, { name: 'G38Live', slug: 'g38-live-' + uuid() });
  const agent = await store.createAgent(ownerId, {
    name: 'G38Agent', slug: 'g38-ag-' + uuid(), role: 'worker', status: 'active', maxConcurrentTasks: 20,
  });
  return { ownerId, projectId: project.id, project2Id: null, agentId: agent.id, conn, store };
}

async function makeTask(store: SupabaseStore, ownerId: string, projectId: string, status = 'queued'): Promise<string> {
  const t = await store.createTask(ownerId, {
    projectId, title: 'G38Task-'+uuid(), status,
    riskLevel: 'low',
    inputs: { intent: 'gate38 live', environment: 'development', resource: 'task' },
  });
  return t.id;
}

async function deleteOwner(conn: pg.Client, ownerId: string): Promise<void> {
  try {
    await conn.query(`DELETE FROM public.task_dependencies WHERE owner_id = $1`, [ownerId]);
    await conn.query(`DELETE FROM public.tasks WHERE owner_id = $1`, [ownerId]);
    await conn.query(`DELETE FROM public.agents WHERE owner_id = $1`, [ownerId]);
    await conn.query(`DELETE FROM public.projects WHERE owner_id = $1`, [ownerId]);
    await conn.query(`DELETE FROM public.owners WHERE id = $1`, [ownerId]);
    await conn.query(`DELETE FROM auth.users WHERE id = $1`, [ownerId]);
  } catch { /* best-effort */ }
}

// Directed acyclicity check over the LIVE dependency graph for an owner.
async function liveGraphIsAcyclic(conn: pg.Client, ownerId: string): Promise<boolean> {
  const rows = await conn.query(
    `SELECT prerequisite_task_id AS p, dependent_task_id AS d FROM public.task_dependencies WHERE owner_id = $1`,
    [ownerId],
  );
  const adj = new Map<string, string[]>();
  for (const r of rows.rows as { p: string; d: string }[]) {
    if (!adj.has(r.p)) adj.set(r.p, []);
    adj.get(r.p)!.push(r.d);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const dfs = (n: string): boolean => {
    color.set(n, GRAY);
    for (const m of adj.get(n) ?? []) {
      const c = color.get(m) ?? WHITE;
      if (c === GRAY) return true; // back edge => cycle
      if (c === WHITE && dfs(m)) return true;
    }
    color.set(n, BLACK);
    return false;
  };
  for (const n of adj.keys()) {
    if ((color.get(n) ?? WHITE) === WHITE && dfs(n)) return false;
  }
  return true;
}

const conns: pg.Client[] = [];
const owners: Array<{ ownerId: string; conn: pg.Client }> = [];

afterAll(async () => {
  for (const o of owners) await deleteOwner(o.conn, o.ownerId).catch(() => {});
  for (const c of conns) await c.end().catch(() => {});
});

describe('Gate 38 — Live migration / object verification', () => {
  it('LM1: migration artifacts exist (table, RLS, policies, constraints, indexes)', async () => {
    if (!enabled) return;
    const conn = await makeConn(); conns.push(conn);

    const table = await conn.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='task_dependencies'`,
    );
    expect(table.rowCount).toBe(1);

    const rls = await conn.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname='task_dependencies' AND relnamespace='public'::regnamespace`,
    );
    expect((rls.rows[0] as { relrowsecurity: boolean }).relrowsecurity).toBe(true);

    const policies = await conn.query(
      `SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='task_dependencies' ORDER BY policyname`,
    );
    const names = (policies.rows as { policyname: string }[]).map((r) => r.policyname);
    for (const p of ['task_dependencies_select_owner', 'task_dependencies_insert_owner', 'task_dependencies_update_owner', 'task_dependencies_delete_owner']) {
      expect(names).toContain(p);
    }

    const constraints = await conn.query(
      `SELECT conname, contype FROM pg_constraint WHERE conrelid='public.task_dependencies'::regclass`,
    );
    const cons = (constraints.rows as { conname: string; contype: string }[]).map((r) => r.conname);
    for (const c of ['task_dependencies_edge_uniq', 'task_dependencies_no_self', 'task_dependencies_prereq_fk', 'task_dependencies_dependent_fk']) {
      expect(cons).toContain(c);
    }

    const indexes = await conn.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='task_dependencies'`,
    );
    const idxs = (indexes.rows as { indexname: string }[]).map((r) => r.indexname);
    for (const i of ['task_dependencies_dependent_idx', 'task_dependencies_prereq_idx', 'task_dependencies_scope_idx']) {
      expect(idxs).toContain(i);
    }

    const trigger = await conn.query(
      `SELECT tgname FROM pg_trigger WHERE tgname='trg_task_dependency_cycle_guard'`,
    );
    expect(trigger.rowCount).toBe(1);

    const tasksUnique = await conn.query(
      `SELECT 1 FROM pg_constraint WHERE conname='tasks_owner_project_id_uniq' AND conrelid='public.tasks'::regclass`,
    );
    expect(tasksUnique.rowCount).toBe(1);
  });
});

describe('Gate 38 — Live real rejections', () => {
  it('LR1: real cross-owner edge rejected', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const a = await createOwnerFixtures(main, 'g38lr1a');
    const b = await createOwnerFixtures(main, 'g38lr1b');
    owners.push({ ownerId: a.ownerId, conn: main }, { ownerId: b.ownerId, conn: main });
    const aPrereq = await makeTask(a.store, a.ownerId, a.projectId);
    const bDep = await makeTask(b.store, b.ownerId, b.projectId);
    const r = await b.store.addTaskDependency(b.ownerId, { prerequisiteTaskId: aPrereq, dependentTaskId: bDep });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('prerequisite_not_found');
    const all = await main.query(`SELECT count(*)::int AS n FROM public.task_dependencies WHERE owner_id=$1 OR owner_id=$2`, [a.ownerId, b.ownerId]);
    expect((all.rows[0] as { n: number }).n).toBe(0);
  });

  it('LR2: real cross-project edge rejected (same owner)', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const f = await createOwnerFixtures(main, 'g38lr2');
    owners.push({ ownerId: f.ownerId, conn: main });
    const p2 = await f.store.createProject(f.ownerId, { name: 'P2', slug: 'g38-p2-' + uuid() });
    const prereq = await makeTask(f.store, f.ownerId, f.projectId);
    const dep2 = await makeTask(f.store, f.ownerId, p2.id);
    const r = await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq, dependentTaskId: dep2 });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('cross_scope');
  });

  it('LR3: real self-dependency rejected', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const f = await createOwnerFixtures(main, 'g38lr3');
    owners.push({ ownerId: f.ownerId, conn: main });
    const t = await makeTask(f.store, f.ownerId, f.projectId);
    const r = await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: t, dependentTaskId: t });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('self_dependency');
  });

  it('LR4: real cycle rejected (A->B->C->A)', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const f = await createOwnerFixtures(main, 'g38lr4');
    owners.push({ ownerId: f.ownerId, conn: main });
    const a = await makeTask(f.store, f.ownerId, f.projectId);
    const b = await makeTask(f.store, f.ownerId, f.projectId);
    const c = await makeTask(f.store, f.ownerId, f.projectId);
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: a, dependentTaskId: b });
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: b, dependentTaskId: c });
    const r = await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: c, dependentTaskId: a });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('cycle_detected');
    expect(await liveGraphIsAcyclic(main, f.ownerId)).toBe(true);
  });
});

describe('Gate 38 — Live concurrent cycle race (distributed-safe serialization)', () => {
  it('LC1: two concurrent opposite-edge insertions -> at most one succeeds, acyclic, no deadlock', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const f = await createOwnerFixtures(main, 'g38lc1');
    owners.push({ ownerId: f.ownerId, conn: main });
    const t1 = await makeTask(f.store, f.ownerId, f.projectId);
    const t2 = await makeTask(f.store, f.ownerId, f.projectId);

    const connA = await makeConn();
    const connB = await makeConn();
    const storeA = new SupabaseStore(wrapConn(connA));
    const storeB = new SupabaseStore(wrapConn(connB));

    const [ra, rb] = await Promise.all([
      storeA.addTaskDependency(f.ownerId, { prerequisiteTaskId: t1, dependentTaskId: t2 }),
      storeB.addTaskDependency(f.ownerId, { prerequisiteTaskId: t2, dependentTaskId: t1 }),
    ]);

    await connA.end().catch(() => {});
    await connB.end().catch(() => {});

    const successes = [ra, rb].filter((r) => r.ok).length;
    expect(successes).toBeLessThanOrEqual(1);
    expect(await liveGraphIsAcyclic(main, f.ownerId)).toBe(true);

    const edges = await main.query(`SELECT count(*)::int AS n FROM public.task_dependencies WHERE owner_id=$1`, [f.ownerId]);
    expect((edges.rows[0] as { n: number }).n).toBe(successes);
  });

  it('LC2: three concurrent 3-node cycle race -> acyclic, at most 2 succeed', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const f = await createOwnerFixtures(main, 'g38lc2');
    owners.push({ ownerId: f.ownerId, conn: main });
    const a = await makeTask(f.store, f.ownerId, f.projectId);
    const b = await makeTask(f.store, f.ownerId, f.projectId);
    const c = await makeTask(f.store, f.ownerId, f.projectId);

    const conns3: pg.Client[] = [];
    const stores: SupabaseStore[] = [];
    for (let i = 0; i < 3; i++) {
      const cc = await makeConn(); conns3.push(cc);
      stores.push(new SupabaseStore(wrapConn(cc)));
    }

    const results = await Promise.all([
      stores[0]!.addTaskDependency(f.ownerId, { prerequisiteTaskId: a, dependentTaskId: b }),
      stores[1]!.addTaskDependency(f.ownerId, { prerequisiteTaskId: b, dependentTaskId: c }),
      stores[2]!.addTaskDependency(f.ownerId, { prerequisiteTaskId: c, dependentTaskId: a }),
    ]);

    for (const cc of conns3) await cc.end().catch(() => {});

    const successes = results.filter((r) => r.ok).length;
    expect(successes).toBeLessThanOrEqual(2);
    expect(await liveGraphIsAcyclic(main, f.ownerId)).toBe(true);
    const edges = await main.query(`SELECT count(*)::int AS n FROM public.task_dependencies WHERE owner_id=$1`, [f.ownerId]);
    expect((edges.rows[0] as { n: number }).n).toBe(successes);
  });

  it('LC3: many concurrent edge inserts stay acyclic (no deadlock)', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const f = await createOwnerFixtures(main, 'g38lc3');
    owners.push({ ownerId: f.ownerId, conn: main });
    const n = 6;
    const tasks: string[] = [];
    const extraConns: pg.Client[] = [];
    for (let i = 0; i < n; i++) tasks.push(await makeTask(f.store, f.ownerId, f.projectId));

    const stores: SupabaseStore[] = [];
    for (let i = 0; i < n; i++) {
      const cc = await makeConn(); stores.push(new SupabaseStore(wrapConn(cc)));
      extraConns.push(cc);
    }
    // attempt a ring of n edges (each task_i -> task_{i+1 mod n})
    const results = await Promise.all(
      tasks.map((tPrereq, i) =>
        stores[i]!.addTaskDependency(f.ownerId, { prerequisiteTaskId: tPrereq, dependentTaskId: tasks[(i + 1) % n]! }),
      ),
    );
    for (const cc of extraConns) await cc.end().catch(() => {});
    // At most n-1 of the ring can coexist; final graph must be acyclic.
    const okCount = results.filter((r) => r.ok).length;
    expect(okCount).toBeLessThanOrEqual(n - 1);
    expect(await liveGraphIsAcyclic(main, f.ownerId)).toBe(true);
  });
});

describe('Gate 38 — Live TOCTOU closure', () => {
  it('LT1: stale discovery cannot execute; claim denied after dependency added', async () => {
    if (!enabled) return;
    const main = await makeConn(); conns.push(main);
    const f = await createOwnerFixtures(main, 'g38lt1');
    owners.push({ ownerId: f.ownerId, conn: main });

    const prereq = await makeTask(f.store, f.ownerId, f.projectId, 'created');
    const dep = await makeTask(f.store, f.ownerId, f.projectId, 'queued');

    // Discovery: dep is ready (no dependency yet).
    const d1 = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(d1.map((x) => x.id)).toContain(dep);

    // An authorized (owner) transaction adds an unmet dependency before claim.
    await f.store.addTaskDependency(f.ownerId, { prerequisiteTaskId: prereq, dependentTaskId: dep });

    // Discovery now excludes dep.
    const d2 = await f.store.listSchedulableTasks(f.ownerId, { projectId: f.projectId });
    expect(d2.map((x) => x.id)).not.toContain(dep);

    // Assign attempts recheck: denied (not_ready).
    const assign = await f.store.assignTaskIfUnassigned(f.ownerId, dep, f.agentId);
    expect(assign.ok).toBe(false);
    expect(assign.outcome).toBe('not_ready');

    // Forced assignment then claim: claim denied (not_ready), execution NOT started.
    await f.store.assignTask(f.ownerId, dep, f.agentId);
    const claim = await f.store.claimTaskForExecution(f.ownerId, dep, f.agentId);
    expect(claim.ok).toBe(false);
    expect(claim.outcome).toBe('not_ready');

    const st = (await main.query(`SELECT status FROM public.tasks WHERE id=$1`, [dep])).rows[0] as { status: string };
    expect(st.status).toBe('queued'); // never transitioned to running -> no execution
    const runs = await main.query(`SELECT count(*)::int AS n FROM public.task_runs WHERE task_id=$1`, [dep]);
    expect((runs.rows[0] as { n: number }).n).toBe(0);

    // Completing the prerequisite makes it ready and claimable.
    await f.store.patchTask(f.ownerId, prereq, { status: 'completed' });
    const claim2 = await f.store.claimTaskForExecution(f.ownerId, dep, f.agentId);
    expect(claim2.ok).toBe(true);
    expect(claim2.outcome).toBe('claimed');
  });
});

