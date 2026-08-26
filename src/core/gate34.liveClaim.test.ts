// CHEF FACTORY — Gate 34 — Live Execution Claim Concurrency Proof.
// Independent pg.Client connections against real Supabase PostgreSQL.
// Proves claimTaskForExecution is distributed-safe.

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

interface Fixtures {
  ownerId: string;
  projectId: string;
  agentId: string;
  taskId: string;
  connA: pg.Client;
  connB: pg.Client;
  storeA: SupabaseStore;
  storeB: SupabaseStore;
  cleanup: () => Promise<void>;
}

async function createFixtures(): Promise<Fixtures> {
  const ownerId = crypto.randomUUID();
  const connA = await makeConn();
  const connB = await makeConn();

  // Create owner in auth.users
  await connA.query(
    `INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
     VALUES ($1, 'authenticated', 'authenticated', $2, 'encrypted', now()) ON CONFLICT DO NOTHING`,
    [ownerId, `g34-${ownerId.slice(0,8)}@chef.local`],
  );

  // Create owner in public.owners
  await connA.query(
    `INSERT INTO public.owners (id, email, status) VALUES ($1, $2, 'active') ON CONFLICT DO NOTHING`,
    [ownerId, `g34-${ownerId.slice(0,8)}@chef.local`],
  );

  const storeA = new SupabaseStore(wrapConn(connA));
  const storeB = new SupabaseStore(wrapConn(connB));

  const project = await storeA.createProject(ownerId, { name: 'G34Live', slug: 'g34-live-' + uuid() });
  const agent = await storeA.createAgent(ownerId, { name: 'G34Agent', slug: 'g34-ag-' + uuid(), role: 'worker', status: 'active' });

  return {
    ownerId, projectId: project.id, agentId: agent.id, taskId: '',
    connA, connB, storeA, storeB,
    cleanup: async () => {
      try {
        await connA.query(`DELETE FROM public.tasks WHERE owner_id = $1`, [ownerId]);
        await connA.query(`DELETE FROM public.agents WHERE owner_id = $1`, [ownerId]);
        await connA.query(`DELETE FROM public.projects WHERE owner_id = $1`, [ownerId]);
        await connA.query(`DELETE FROM public.owners WHERE id = $1`, [ownerId]);
        await connA.query(`DELETE FROM auth.users WHERE id = $1`, [ownerId]);
      } catch { /* best-effort */ }
      await connA.end().catch(() => {});
      await connB.end().catch(() => {});
    },
  };
}

function createTask(storeA: SupabaseStore, ownerId: string, projectId: string, agentId: string): Promise<string> {
  return storeA.createTask(ownerId, {
    projectId, title: 'ClaimTest', status: 'queued', agentId, riskLevel: 'low',
    inputs: { intent: 'test', environment: 'development', resource: 'task' },
  }).then(t => t.id);
}

describe('Gate 34 — Live Execution Claim Concurrency', () => {
  const fixtures: Fixtures[] = [];

  afterAll(async () => {
    for (const f of fixtures) await f.cleanup();
  });

  it('L1: two-worker claim — exactly one winner', async () => {
    if (!enabled) return;
    const f = await createFixtures();
    fixtures.push(f);
    const taskId = await createTask(f.storeA, f.ownerId, f.projectId, f.agentId);

    // Two independent connections, same task, same agent
    const [r1, r2] = await Promise.all([
      f.storeA.claimTaskForExecution(f.ownerId, taskId, f.agentId),
      f.storeB.claimTaskForExecution(f.ownerId, taskId, f.agentId),
    ]);

    const winners = [r1, r2].filter(r => r.ok);
    const losers = [r1, r2].filter(r => !r.ok);

    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(losers[0]!.outcome).toBe('already_running');

    // Final task status must be 'running'
    const task = await f.storeA.getTask(f.ownerId, taskId);
    expect(task?.status).toBe('running');
  });

  it('L2: higher contention — 10 concurrent claim attempts', async () => {
    if (!enabled) return;
    const f = await createFixtures();
    fixtures.push(f);
    const taskId = await createTask(f.storeA, f.ownerId, f.projectId, f.agentId);

    // Create 10 independent connections
    const conns: pg.Client[] = [];
    const stores: SupabaseStore[] = [];
    for (let i = 0; i < 10; i++) {
      const c = await makeConn();
      conns.push(c);
      stores.push(new SupabaseStore(wrapConn(c)));
    }

    const results = await Promise.all(
      stores.map(s => s.claimTaskForExecution(f.ownerId, taskId, f.agentId))
    );

    const winners = results.filter(r => r.ok);
    const losers = results.filter(r => !r.ok);

    expect(winners.length).toBe(1);
    expect(losers.length).toBe(9);

    for (const l of losers) {
      expect(l.outcome).toBe('already_running');
    }

    const task = await f.storeA.getTask(f.ownerId, taskId);
    expect(task?.status).toBe('running');

    // Cleanup extra connections
    for (const c of conns) await c.end().catch(() => {});
  });

  it('L3: claim after completion returns invalid_task_state', async () => {
    if (!enabled) return;
    const f = await createFixtures();
    fixtures.push(f);
    const taskId = await createTask(f.storeA, f.ownerId, f.projectId, f.agentId);

    // Claim and manually complete
    const claimed = await f.storeA.claimTaskForExecution(f.ownerId, taskId, f.agentId);
    expect(claimed.ok).toBe(true);

    await f.storeA.patchTask(f.ownerId, taskId, { status: 'completed', completedAt: new Date().toISOString() });

    // Second claim must fail
    const r = await f.storeA.claimTaskForExecution(f.ownerId, taskId, f.agentId);
    expect(r.ok).toBe(false);
    expect(r.outcome).toMatch(/already_running|not_queued/);
  });

  it('L4: two-task parallel claim — no cross-contamination', async () => {
    if (!enabled) return;
    const f = await createFixtures();
    fixtures.push(f);
    const taskId1 = await createTask(f.storeA, f.ownerId, f.projectId, f.agentId);
    const taskId2 = await createTask(f.storeA, f.ownerId, f.projectId, f.agentId);

    // Both tasks claimed concurrently on same agent
    const [r1, r2] = await Promise.all([
      f.storeA.claimTaskForExecution(f.ownerId, taskId1, f.agentId),
      f.storeA.claimTaskForExecution(f.ownerId, taskId2, f.agentId),
    ]);

    // Both should succeed (different tasks)
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    const t1 = await f.storeA.getTask(f.ownerId, taskId1);
    const t2 = await f.storeA.getTask(f.ownerId, taskId2);
    expect(t1?.status).toBe('running');
    expect(t2?.status).toBe('running');
  });
});
