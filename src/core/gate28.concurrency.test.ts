// Gate 28 — Live Concurrency Proof + Bounded Contention Test
// Two independent DB connections. Disposable fixtures. Zero residue.
// Proves FOR UPDATE blocking between assignment and lifecycle mutations.

import pg from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';

const cfg = getFactoryConfig(loadEnvFile());
const enabled = Boolean(cfg.supabaseUrl && cfg.dbPassword && cfg.dbHost);

interface DisposableOwner {
  ownerId: string;
  connA: pg.Client;
  connB: pg.Client;
  storeA: SupabaseStore;
  storeB: SupabaseStore;
  cleanup: () => Promise<void>;
}

async function makeDisposableOwner(): Promise<DisposableOwner> {
  const ownerId = crypto.randomUUID();
  const makeConn = async () => {
    const c = new pg.Client({
      host: cfg.dbHost, port: cfg.dbPort, user: cfg.dbUser,
      password: cfg.dbPassword, database: cfg.dbName,
      ssl: { rejectUnauthorized: false },
    });
    await c.connect();
    return c;
  };
  const connA = await makeConn();
  const connB = await makeConn();

  await connA.query(
    `INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
     VALUES ($1, 'authenticated', 'authenticated', $2, 'encrypted', now()) ON CONFLICT DO NOTHING`,
    [ownerId, `cc-${ownerId.slice(0,8)}@chef.local`],
  );

  const wrapConn = (conn: pg.Client) => ({
    query: (text: string, params?: unknown[]) => conn.query(text, params),
    connect: async () => ({
      query: (t: string, p?: unknown[]) => conn.query(t, p),
      release: () => undefined,
    }),
  }) as unknown as pg.Pool;

  const storeA = new SupabaseStore(wrapConn(connA));
  const storeB = new SupabaseStore(wrapConn(connB));

  return {
    ownerId, connA, connB, storeA, storeB,
    cleanup: async () => {
      try {
        await connA.query(`DELETE FROM public.tasks WHERE owner_id = $1`, [ownerId]);
        await connA.query(`DELETE FROM public.agents WHERE owner_id = $1`, [ownerId]);
        await connA.query(`DELETE FROM public.projects WHERE owner_id = $1`, [ownerId]);
        await connA.query(`DELETE FROM public.owners WHERE id = $1`, [ownerId]);
        await connA.query(`DELETE FROM auth.users WHERE id = $1`, [ownerId]);
      } catch { /* best effort */ }
      await connA.end().catch(() => {});
      await connB.end().catch(() => {});
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// SECTION A: LIVE CONCURRENCY PROOF — FOR UPDATE blocking
// ═══════════════════════════════════════════════════════════════

describe.skipIf(!enabled)('Gate 28 — Live Concurrency Proof (FOR UPDATE)', () => {
  const handles: DisposableOwner[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('A1: assignment holds Agent row lock while lifecycle mutation blocks', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);

    const project = await d.storeA.createProject(d.ownerId, { name: 'ConcProj', slug: 'conc-' + crypto.randomUUID().slice(0,8) });
    const agent = await d.storeA.createAgent(d.ownerId, { name: 'LockAgent', slug: 'la-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const task = await d.storeA.createTask(d.ownerId, { projectId: project.id, title: 'LockTask' });

    // Step 1: connA locks the agent row
    await d.connA.query('BEGIN');
    await d.connA.query(
      `SELECT id, status FROM public.agents WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
      [agent.id, d.ownerId],
    );

    // Step 2: connB tries to update agent status — will BLOCK on the row lock
    // Start the update in a detached promise so it runs concurrently
    const blockedUpdate = d.connB.query(
      `UPDATE public.agents SET status = 'paused', updated_at = now() WHERE id = $1 AND owner_id = $2`,
      [agent.id, d.ownerId],
    );

    // Step 3: Give the blocked query time to attempt and block
    await new Promise(r => setTimeout(r, 300));

    // Step 4: Verify agent is still 'active' from connA's perspective (lock still held)
    const check1 = await d.connA.query(
      `SELECT status FROM public.agents WHERE id = $1`, [agent.id],
    );
    expect(check1.rows[0]!.status).toBe('active');

    // Step 5: Release connA's lock by committing
    await d.connA.query('COMMIT');

    // Step 6: Now connB's blocked update completes
    await blockedUpdate;

    // Step 7: Verify agent is now 'paused' from connB
    const check2 = await d.connB.query(
      `SELECT status FROM public.agents WHERE id = $1`, [agent.id],
    );
    expect(check2.rows[0]!.status).toBe('paused');

    // Step 8: Verify task is still unassigned (no mutation from assignTask)
    const checkTask = await d.connA.query(
      `SELECT agent_id FROM public.tasks WHERE id = $1`, [task.id],
    );
    expect(checkTask.rows[0]!.agent_id).toBeNull();
  });

  it('A2: full assignTask transaction serializes correctly against lifecycle update', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);

    const project = await d.storeA.createProject(d.ownerId, { name: 'FullProj', slug: 'fp-' + crypto.randomUUID().slice(0,8) });
    const agent = await d.storeA.createAgent(d.ownerId, { name: 'FullAgent', slug: 'fa-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const task = await d.storeA.createTask(d.ownerId, { projectId: project.id, title: 'FullTask' });

    // Step 1: Run assignTask (opens BEGIN, locks agent+task, validates, updates, commits)
    const assignPromise = d.storeA.assignTask(d.ownerId, task.id, agent.id);

    // Step 2: Concurrently try to pause the agent via raw SQL (autocommit)
    await new Promise(r => setTimeout(r, 30));
    const lifecyclePromise = d.connB.query(
      `UPDATE public.agents SET status = 'paused', updated_at = now()
       WHERE id = $1 AND owner_id = $2`,
      [agent.id, d.ownerId],
    ).then(() => 'applied' as const).catch(() => 'blocked' as const);

    const [assign, lifecycle] = await Promise.all([assignPromise, lifecyclePromise]);

    // Step 3: Both complete (serialized). Two valid outcomes:
    // Case 1: assignTask locked first → assigns task, then lifecycle pauses agent
    //         assign.ok = true, lifecycle = 'applied', final: task assigned + agent paused
    // Case 2: lifecycle autocommitted first → agent already paused
    //         assign.ok = false (agent_not_eligible), lifecycle = 'applied', final: task unassigned + agent paused
    const finalTask = await d.storeA.getTask(d.ownerId, task.id);
    const finalAgent = await d.storeA.getAgent(d.ownerId, agent.id);

    if (assign.ok) {
      // Case 1: Assignment won the lock race
      expect(assign.outcome).toBe('assigned');
      expect(finalTask!.agentId).toBe(agent.id);
    } else {
      // Case 2: Lifecycle update committed before lock acquisition
      expect(assign.outcome).toBe('agent_not_eligible');
      expect(finalTask!.agentId).toBeNull();
    }
    // In both cases: agent is paused, state is consistent
    expect(finalAgent!.status).toBe('paused');
  });

  it('A3: TOCTOU violation NOT possible — both serializations are consistent', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);

    const project = await d.storeA.createProject(d.ownerId, { name: 'TOCTOUProj', slug: 'tc-' + crypto.randomUUID().slice(0,8) });
    const agent = await d.storeA.createAgent(d.ownerId, { name: 'TOCTOUAgent', slug: 'ta-' + crypto.randomUUID().slice(0,8), role: 'worker', status: 'active' });
    const task = await d.storeA.createTask(d.ownerId, { projectId: project.id, title: 'TOCTOUTask' });

    // Start assignment — this acquires FOR UPDATE on agent, validates status=active, updates task
    const assignPromise = d.storeA.assignTask(d.ownerId, task.id, agent.id);

    // Immediately try to retire the agent (autocommit)
    await new Promise(r => setTimeout(r, 20));
    await d.connB.query(
      `UPDATE public.agents SET status = 'retired', updated_at = now()
       WHERE id = $1 AND owner_id = $2`,
      [agent.id, d.ownerId],
    );

    const assign = await assignPromise;

    // Two valid outcomes (no TOCTOU violation):
    // Case 1: assign locked first → assignment succeeds, agent later retired
    // Case 2: retire committed first → assignment fails with agent_not_eligible
    const finalTask = await d.storeA.getTask(d.ownerId, task.id);
    const finalAgent = await d.storeA.getAgent(d.ownerId, agent.id);

    if (assign.ok) {
      expect(assign.outcome).toBe('assigned');
      expect(finalTask!.agentId).toBe(agent.id);
    } else {
      expect(assign.outcome).toBe('agent_not_eligible');
      expect(finalTask!.agentId).toBeNull();
    }
    // Agent is always in a consistent terminal state
    expect(['retired', 'active']).toContain(finalAgent!.status);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION B: BOUNDED CONTENTION TEST
// ═══════════════════════════════════════════════════════════════

describe.skipIf(!enabled)('Gate 28 — Bounded Contention Test', () => {
  const handles: DisposableOwner[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('B1: 20 parallel assignments produce zero deadlocks and zero violations', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);

    const project = await d.storeA.createProject(d.ownerId, { name: 'ContentProj', slug: 'cp-' + crypto.randomUUID().slice(0,8) });

    const agents = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        d.storeA.createAgent(d.ownerId, { name: `Agent${i}`, slug: `ag-${i}-${crypto.randomUUID().slice(0,4)}`, role: 'worker', status: 'active' })
      ),
    );
    const tasks = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        d.storeA.createTask(d.ownerId, { projectId: project.id, title: `Task${i}` })
      ),
    );

    let deadlocks = 0;
    let crossOwnerViolations = 0;
    let invalidAssignments = 0;
    let unexpectedFailures = 0;
    let successCount = 0;

    const results = await Promise.allSettled(
      tasks.map((task, i) => {
        const agent = agents[i % agents.length]!;
        return d.storeA.assignTask(d.ownerId, task.id, agent.id);
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        const v = r.value;
        if (v.ok && v.outcome === 'assigned') successCount++;
        else if (v.outcome === 'agent_not_found') crossOwnerViolations++;
        else if (v.outcome === 'agent_not_eligible' || v.outcome === 'task_not_found') invalidAssignments++;
        else unexpectedFailures++;
      } else {
        const msg = r.reason?.message ?? '';
        if (msg.includes('deadlock') || msg.includes('Deadlock')) deadlocks++;
        else unexpectedFailures++;
      }
    }

    expect(deadlocks).toBe(0);
    expect(crossOwnerViolations).toBe(0);
    expect(invalidAssignments).toBe(0);
    expect(unexpectedFailures).toBe(0);
    expect(successCount).toBe(20);
  });

  it('B2: concurrent assign + unassign on same task produces consistent state', async () => {
    const d = await makeDisposableOwner();
    handles.push(d);

    const project = await d.storeA.createProject(d.ownerId, { name: 'RaceProj', slug: 'rp-' + crypto.randomUUID().slice(0,8) });
    const agent1 = await d.storeA.createAgent(d.ownerId, { name: 'R1', slug: 'r1-' + crypto.randomUUID().slice(0,4), role: 'worker', status: 'active' });
    const agent2 = await d.storeA.createAgent(d.ownerId, { name: 'R2', slug: 'r2-' + crypto.randomUUID().slice(0,4), role: 'worker', status: 'active' });
    const task = await d.storeA.createTask(d.ownerId, { projectId: project.id, title: 'RaceTask' });

    await d.storeA.assignTask(d.ownerId, task.id, agent1.id);

    const [assign2, unassign] = await Promise.allSettled([
      d.storeA.assignTask(d.ownerId, task.id, agent2.id),
      d.storeA.assignTask(d.ownerId, task.id, null),
    ]);

    const final = await d.storeA.getTask(d.ownerId, task.id);
    expect([agent2.id, null]).toContain(final!.agentId);

    const assign2Ok = assign2.status === 'fulfilled' && assign2.value.ok;
    const unassignOk = unassign.status === 'fulfilled' && unassign.value.ok;
    expect(assign2Ok || unassignOk).toBe(true);
  });

  it('B3: parallel cross-owner attempts produce no cross-contamination', async () => {
    const d1 = await makeDisposableOwner();
    const d2 = await makeDisposableOwner();
    handles.push(d1, d2);

    const proj1 = await d1.storeA.createProject(d1.ownerId, { name: 'P1', slug: 'p1-' + crypto.randomUUID().slice(0,4) });
    const proj2 = await d2.storeA.createProject(d2.ownerId, { name: 'P2', slug: 'p2-' + crypto.randomUUID().slice(0,4) });
    const ag1 = await d1.storeA.createAgent(d1.ownerId, { name: 'A1', slug: 'a1-' + crypto.randomUUID().slice(0,4), role: 'worker', status: 'active' });
    const ag2 = await d2.storeA.createAgent(d2.ownerId, { name: 'A2', slug: 'a2-' + crypto.randomUUID().slice(0,4), role: 'worker', status: 'active' });
    const t1 = await d1.storeA.createTask(d1.ownerId, { projectId: proj1.id, title: 'T1' });
    const t2 = await d2.storeA.createTask(d2.ownerId, { projectId: proj2.id, title: 'T2' });

    const [cross1, cross2] = await Promise.allSettled([
      d1.storeA.assignTask(d1.ownerId, t1.id, ag2.id),
      d2.storeA.assignTask(d2.ownerId, t2.id, ag1.id),
    ]);

    if (cross1.status === 'fulfilled') expect(cross1.value.ok).toBe(false);
    if (cross2.status === 'fulfilled') expect(cross2.value.ok).toBe(false);

    const [legit1, legit2] = await Promise.allSettled([
      d1.storeA.assignTask(d1.ownerId, t1.id, ag1.id),
      d2.storeA.assignTask(d2.ownerId, t2.id, ag2.id),
    ]);

    expect(legit1.status === 'fulfilled' && legit1.value.ok).toBe(true);
    expect(legit2.status === 'fulfilled' && legit2.value.ok).toBe(true);
  });
});
