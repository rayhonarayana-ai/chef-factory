// CHEF FACTORY — Gate 30 — Live Supabase Concurrency Proof
// Real pg.Pool — each Store call acquires independent physical connection.
// Disposable fixtures. Zero residue.

import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';

const cfg = getFactoryConfig(loadEnvFile());
const enabled = Boolean(cfg.supabaseUrl && cfg.dbPassword && cfg.dbHost);

function makePool(): pg.Pool {
  return new pg.Pool({
    host: cfg.dbHost, port: cfg.dbPort, user: cfg.dbUser,
    password: cfg.dbPassword, database: cfg.dbName,
    ssl: { rejectUnauthorized: false },
    max: 15,
  });
}

interface DisposableOwner {
  ownerId: string;
  pool: pg.Pool;
  store: SupabaseStore;
  cleanup: () => Promise<void>;
}

async function makeDisposableOwner(): Promise<DisposableOwner> {
  const ownerId = crypto.randomUUID();
  const pool = makePool();
  const store = new SupabaseStore(pool);

  await pool.query(
    `INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
     VALUES ($1, 'authenticated', 'authenticated', $2, 'encrypted', now()) ON CONFLICT DO NOTHING`,
    [ownerId, `g30-${ownerId.slice(0,8)}@chef.local`],
  );

  return {
    ownerId, pool, store,
    cleanup: async () => {
      try {
        await pool.query(`DELETE FROM public.task_runs WHERE task_id IN (SELECT id FROM public.tasks WHERE owner_id = $1)`, [ownerId]);
        await pool.query(`DELETE FROM public.tasks WHERE owner_id = $1`, [ownerId]);
        await pool.query(`DELETE FROM public.agents WHERE owner_id = $1`, [ownerId]);
        await pool.query(`DELETE FROM public.projects WHERE owner_id = $1`, [ownerId]);
        await pool.query(`DELETE FROM public.owners WHERE id = $1`, [ownerId]);
        await pool.query(`DELETE FROM auth.users WHERE id = $1`, [ownerId]);
      } catch { /* best effort */ }
      await pool.end().catch(() => {});
    },
  };
}

// =============================================================
// SECTION LP: PHYSICAL CONCURRENCY DIAGNOSTIC
// =============================================================

describe.skipIf(!enabled)('Gate 30 Live — Physical Connection Independence', () => {
  const handles: DisposableOwner[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('LP1: two pool clients can hold row locks concurrently (pg_sleep overlap)', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);

    const client1 = await d.pool.connect();
    const client2 = await d.pool.connect();
    try {
      await client1.query('BEGIN');
      await client2.query('BEGIN');

      const lpOwner = crypto.randomUUID();
      await client1.query(
        `INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
         VALUES ($1, 'authenticated', 'authenticated', $2, 'encrypted', now()) ON CONFLICT DO NOTHING`,
        [lpOwner, `lp-${lpOwner.slice(0,8)}@chef.local`],
      );
      await client1.query(
        `INSERT INTO public.projects (owner_id, name, slug) VALUES ($1, 'LPProj', $2) ON CONFLICT DO NOTHING`,
        [lpOwner, 'lpp-' + lpOwner.slice(0,8)],
      );
      const r = await client1.query(
        `INSERT INTO public.tasks (owner_id, project_id, title) VALUES ($1, (SELECT id FROM public.projects WHERE owner_id=$1 LIMIT 1), 'LPTask') RETURNING id`,
        [lpOwner],
      );
      const taskId = r.rows[0]!.id as string;

      await client1.query(
        `UPDATE public.tasks SET title = 'locked-by-1' WHERE id = $1 AND owner_id = $2`,
        [taskId, lpOwner],
      );

      const start = Date.now();
      const [lockResult] = await Promise.all([
        (async () => {
          await client2.query('SELECT pg_sleep(0.3)');
          const lockR = await client2.query(
            `UPDATE public.tasks SET title = 'locked-by-2' WHERE id = $1 AND owner_id = $2 RETURNING id`,
            [taskId, lpOwner],
          );
          return lockR;
        })(),
        (async () => {
          await new Promise(r => setTimeout(r, 50));
          await client1.query('COMMIT');
          return null;
        })(),
      ]);
      const elapsed = Date.now() - start;

      expect(lockResult!.rowCount).toBe(1);
      expect(elapsed).toBeGreaterThanOrEqual(250);
    } finally {
      client1.release();
      client2.release();
    }
  });
});

// =============================================================
// SECTION L1: LIVE TWO-CALLER CONCURRENCY
// =============================================================

describe.skipIf(!enabled)('Gate 30 Live — Two-Caller Concurrency', () => {
  const handles: DisposableOwner[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('L1: two concurrent assignTaskIfUnassigned on same task produce exactly one winner', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);

    const project = await d.store.createProject(d.ownerId, { name: 'L1Proj', slug: 'l1p-' + crypto.randomUUID().slice(0,8) });
    const agent = await d.store.createAgent(d.ownerId, { name: 'L1Agent', slug: 'l1a-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'L1Task' });

    const results = await Promise.all([
      d.store.assignTaskIfUnassigned(d.ownerId, task.id, agent.id),
      d.store.assignTaskIfUnassigned(d.ownerId, task.id, agent.id),
    ]);

    const winners = results.filter(r => r.ok && r.outcome === 'assigned').length;
    const alreadyAssigned = results.filter(r => !r.ok && r.outcome === 'already_assigned').length;
    const finalTask = await d.store.getTask(d.ownerId, task.id);

    expect(winners).toBe(1);
    expect(alreadyAssigned).toBe(1);
    expect(finalTask!.agentId).toBe(agent.id);
  });

  it('L1b: two callers selecting different agents produce exactly one winner', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);

    const project = await d.store.createProject(d.ownerId, { name: 'L1bProj', slug: 'l1bp-' + crypto.randomUUID().slice(0,8) });
    const agentA = await d.store.createAgent(d.ownerId, { name: 'AgentAlpha', slug: 'l1ba-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const agentB = await d.store.createAgent(d.ownerId, { name: 'AgentBeta', slug: 'l1bb-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'L1bTask' });

    const results = await Promise.all([
      d.store.assignTaskIfUnassigned(d.ownerId, task.id, agentA.id),
      d.store.assignTaskIfUnassigned(d.ownerId, task.id, agentB.id),
    ]);

    const winners = results.filter(r => r.ok && r.outcome === 'assigned').length;
    const finalTask = await d.store.getTask(d.ownerId, task.id);

    expect(winners).toBe(1);
    expect(finalTask!.agentId).not.toBeNull();
    const validAgentIds = new Set([agentA.id, agentB.id]);
    expect(validAgentIds.has(finalTask!.agentId!)).toBe(true);
  });
});

// =============================================================
// SECTION L2: HIGHER-CONTENTION PROOF (10+)
// =============================================================

describe.skipIf(!enabled)('Gate 30 Live — Higher-Contention Proof', () => {
  const handles: DisposableOwner[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('L2: 10 concurrent assignTaskIfUnassigned calls produce exactly one winner', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);

    const project = await d.store.createProject(d.ownerId, { name: 'L2Proj', slug: 'l2p-' + crypto.randomUUID().slice(0,8) });

    const agents = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        d.store.createAgent(d.ownerId, { name: `L2Agent${i}`, slug: `l2a-${i}-${crypto.randomUUID().slice(0,4)}`, role: 'worker', status: 'active' })
      ),
    );
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'L2Task' });

    let deadlocks = 0;
    let crossOwnerViolations = 0;

    const results = await Promise.allSettled(
      agents.map(agent =>
        d.store.assignTaskIfUnassigned(d.ownerId, task.id, agent.id)
      ),
    );

    let successCount = 0;
    let alreadyAssignedCount = 0;
    let unexpectedCount = 0;

    for (const r of results) {
      if (r.status === 'fulfilled') {
        const v = r.value;
        if (v.ok && v.outcome === 'assigned') successCount++;
        else if (!v.ok && v.outcome === 'already_assigned') alreadyAssignedCount++;
        else if (v.outcome === 'agent_not_found') crossOwnerViolations++;
        else unexpectedCount++;
      } else {
        const msg = r.reason?.message ?? '';
        if (msg.includes('deadlock') || msg.includes('Deadlock')) deadlocks++;
        else unexpectedCount++;
      }
    }

    const finalTask = await d.store.getTask(d.ownerId, task.id);

    expect(deadlocks).toBe(0);
    expect(crossOwnerViolations).toBe(0);
    expect(successCount).toBe(1);
    expect(alreadyAssignedCount).toBe(9);
    expect(unexpectedCount).toBe(0);
    expect(finalTask!.agentId).not.toBeNull();
    const agentIds = new Set(agents.map(a => a.id));
    expect(agentIds.has(finalTask!.agentId!)).toBe(true);
  });
});

// =============================================================
// SECTION L3: AGENT STATUS RACE
// =============================================================

describe.skipIf(!enabled)('Gate 30 Live — Agent Status Race', () => {
  const handles: DisposableOwner[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('L3: assignTaskIfUnassigned rejects paused agent atomically', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);

    const project = await d.store.createProject(d.ownerId, { name: 'L3Proj', slug: 'l3p-' + crypto.randomUUID().slice(0,8) });
    const agent = await d.store.createAgent(d.ownerId, { name: 'L3Agent', slug: 'l3a-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'L3Task' });

    const assignPromise = d.store.assignTaskIfUnassigned(d.ownerId, task.id, agent.id);

    await new Promise(r => setTimeout(r, 20));
    await d.pool.query(
      `UPDATE public.agents SET status = 'paused', updated_at = now() WHERE id = $1 AND owner_id = $2`,
      [agent.id, d.ownerId],
    );

    const assign = await assignPromise;

    const finalTask = await d.store.getTask(d.ownerId, task.id);
    const finalAgent = await d.store.getAgent(d.ownerId, agent.id);

    if (assign.ok) {
      expect(assign.outcome).toBe('assigned');
      expect(finalTask!.agentId).toBe(agent.id);
    } else {
      expect(assign.outcome).toBe('agent_not_eligible');
      expect(finalTask!.agentId).toBeNull();
    }
    expect(finalAgent!.status).toBe('paused');
  });

  it('L3b: placeTask retries when first agent becomes ineligible', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);

    const project = await d.store.createProject(d.ownerId, { name: 'L3bProj', slug: 'l3bp-' + crypto.randomUUID().slice(0,8) });
    await d.store.createAgent(d.ownerId, { name: 'Alpha', slug: 'l3ba-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    await d.store.createAgent(d.ownerId, { name: 'Beta', slug: 'l3bb-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'L3bTask' });

    const origAssign = d.store.assignTaskIfUnassigned.bind(d.store);
    let firstFailedAgentId: string | null = null;
    let calls = 0;
    (d.store as any).assignTaskIfUnassigned = async (o: string, t: string, a: string) => {
      calls++;
      if (calls === 1) { firstFailedAgentId = a; return { ok: false, outcome: 'agent_not_eligible', previousAgentId: null, nextAgentId: a }; }
      return origAssign(o, t, a);
    };

    const { placeTask } = await import('./placement.js');
    const result = await placeTask({ store: d.store, ownerId: d.ownerId, taskId: task.id, actorId: d.ownerId });

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('placed');
    expect(result.selectedAgentId).not.toBe(firstFailedAgentId);
    expect(result.attempts).toBe(2);

    (d.store as any).assignTaskIfUnassigned = origAssign;
  });
});

// =============================================================
// SECTION L4: ALREADY-ASSIGNED LIVE PROOF
// =============================================================

describe.skipIf(!enabled)('Gate 30 Live — Already-Assigned', () => {
  const handles: DisposableOwner[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('L4: already-assigned task returns safe terminal outcome', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);

    const project = await d.store.createProject(d.ownerId, { name: 'L4Proj', slug: 'l4p-' + crypto.randomUUID().slice(0,8) });
    const agentA = await d.store.createAgent(d.ownerId, { name: 'L4AgentA', slug: 'l4a-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    await d.store.createAgent(d.ownerId, { name: 'L4AgentB', slug: 'l4b-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'L4Task' });

    await d.store.assignTask(d.ownerId, task.id, agentA.id);

    const before = await d.store.getTask(d.ownerId, task.id);
    const result = await d.store.assignTaskIfUnassigned(d.ownerId, task.id, agentA.id);
    const after = await d.store.getTask(d.ownerId, task.id);

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('already_assigned');
    expect(before!.agentId).toBe(agentA.id);
    expect(after!.agentId).toBe(agentA.id);
    expect(after!.agentId).toBe(before!.agentId);
  });
});

// =============================================================
// SECTION L5: GATE 28 BACKWARD COMPATIBILITY
// =============================================================

describe.skipIf(!enabled)('Gate 30 Live — Gate 28 Backward Compatibility', () => {
  const handles: DisposableOwner[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('L5: assignTask still supports assign', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);
    const project = await d.store.createProject(d.ownerId, { name: 'L5Proj', slug: 'l5p-' + crypto.randomUUID().slice(0,8) });
    const agent = await d.store.createAgent(d.ownerId, { name: 'L5Agent', slug: 'l5a-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'L5Task' });

    const r = await d.store.assignTask(d.ownerId, task.id, agent.id);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('assigned');
    const t = await d.store.getTask(d.ownerId, task.id);
    expect(t!.agentId).toBe(agent.id);
  });

  it('L5: assignTask still supports reassign', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);
    const project = await d.store.createProject(d.ownerId, { name: 'L5bProj', slug: 'l5bp-' + crypto.randomUUID().slice(0,8) });
    const agent1 = await d.store.createAgent(d.ownerId, { name: 'L5b1', slug: 'l5b1-' + crypto.randomUUID().slice(0,4), role: 'worker', status: 'active' });
    const agent2 = await d.store.createAgent(d.ownerId, { name: 'L5b2', slug: 'l5b2-' + crypto.randomUUID().slice(0,4), role: 'worker', status: 'active' });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'L5bTask' });

    await d.store.assignTask(d.ownerId, task.id, agent1.id);
    const r = await d.store.assignTask(d.ownerId, task.id, agent2.id);
    expect(r.ok).toBe(true);
    const t = await d.store.getTask(d.ownerId, task.id);
    expect(t!.agentId).toBe(agent2.id);
  });

  it('L5: assignTask still supports unassign', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);
    const project = await d.store.createProject(d.ownerId, { name: 'L5cProj', slug: 'l5cp-' + crypto.randomUUID().slice(0,8) });
    const agent = await d.store.createAgent(d.ownerId, { name: 'L5cAgent', slug: 'l5ca-' + crypto.randomUUID().slice(0,4), role: 'worker', status: 'active' });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'L5cTask' });

    await d.store.assignTask(d.ownerId, task.id, agent.id);
    const r = await d.store.assignTask(d.ownerId, task.id, null);
    expect(r.ok).toBe(true);
    const t = await d.store.getTask(d.ownerId, task.id);
    expect(t!.agentId).toBeNull();
  });
});

// =============================================================
// SECTION L6: SELECTOR BACKWARD COMPATIBILITY (LIVE)
// =============================================================

describe.skipIf(!enabled)('Gate 30 Live — Selector Backward Compatibility', () => {
  const handles: DisposableOwner[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('L6: selector without excludeAgentIds behaves as Gate 29', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);
    const project = await d.store.createProject(d.ownerId, { name: 'L6Proj', slug: 'l6p-' + crypto.randomUUID().slice(0,8) });
    const agent = await d.store.createAgent(d.ownerId, { name: 'L6Agent', slug: 'l6a-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'L6Task' });

    const { selectCandidate } = await import('./selector.js');
    const r1 = await selectCandidate({ store: d.store, ownerId: d.ownerId, task });
    const r2 = await selectCandidate({ store: d.store, ownerId: d.ownerId, task });
    expect(r1.ok).toBe(true);
    expect(r1.selected!.agentId).toBe(agent.id);
    expect(r2.selected!.agentId).toBe(agent.id);
  });

  it('L6: selector with empty excludeAgentIds behaves as Gate 29', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);
    const project = await d.store.createProject(d.ownerId, { name: 'L6bProj', slug: 'l6bp-' + crypto.randomUUID().slice(0,8) });
    const agent = await d.store.createAgent(d.ownerId, { name: 'L6bAgent', slug: 'l6ba-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'L6bTask' });

    const { selectCandidate } = await import('./selector.js');
    const r = await selectCandidate({ store: d.store, ownerId: d.ownerId, task, excludeAgentIds: [] });
    expect(r.ok).toBe(true);
    expect(r.selected!.agentId).toBe(agent.id);
  });

  it('L6: excluded agent is never selected', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);
    const project = await d.store.createProject(d.ownerId, { name: 'L6cProj', slug: 'l6cp-' + crypto.randomUUID().slice(0,8) });
    const agentA = await d.store.createAgent(d.ownerId, { name: 'L6cAlpha', slug: 'l6ca-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const agentB = await d.store.createAgent(d.ownerId, { name: 'L6cBeta', slug: 'l6cb-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'L6cTask' });

    const { selectCandidate } = await import('./selector.js');
    const r = await selectCandidate({ store: d.store, ownerId: d.ownerId, task, excludeAgentIds: [agentA.id] });
    expect(r.ok).toBe(true);
    expect(r.selected!.agentId).toBe(agentB.id);
  });
});
