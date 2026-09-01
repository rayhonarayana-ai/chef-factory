// CHEF FACTORY — Gate 48 preclosure — gitPrepareCommit requester FK live regression.
//
// Purpose: prove the repaired gitPrepareCommit contract against a REAL Supabase
// store and the REAL approvals.requested_by → owners(id) foreign key.
//
// Proven root cause (Gate48 recon):
//   Production previously created the approval with requestedBy: agentId, but the
//   live schema constrains approvals.requested_by to public.owners(id). An agent
//   UUID is not an owner UUID, so the insert violates the FK. MemoryStore and the
//   mock stores used by gate48.prepare.test.ts / gate36v2.live.test.ts do not
//   validate that column, silently masking the defect.
// Repaired (exact, authorized):
//   requestedBy: agentId  →  requestedBy: ownerId
//
// This harness is a LIVE regression, enabled ONLY under the dedicated process
// guard FACTORY_RUN_GATE48_GIT_PREPARE_FK_TESTS=true AND the exact authorized
// target ref (dybyidtcyzgliupzzfhl). It never runs against any other target.
// Synthetic namespace: gate48gpfk-. All fixtures are confirmed-owned and removed
// by exact-ID cleanup in FK order; the owner disappears via the auth-users
// ON DELETE CASCADE. Residue must be ZERO after every test.
//
// NO production source is invoked except the real gitPrepareCommitHandler, the
// real SupabaseStore, and a scratch git workspace. LIVE-06 is absent and
// non-executable. Never prints secrets.

import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';
import { gitPrepareCommitHandler } from '../software/tools/gitPrepareCommit.js';
import { fingerprintWorkspace } from '../workspace/integrity.js';
import type { ToolHandlerInput } from '../tools/types.js';

// ─────────────────────────────────────────────────────────────────────────
// 1. ENABLEMENT — prebuilt, boolean-only diagnostics (no secrets).
// ─────────────────────────────────────────────────────────────────────────
const cfg = getFactoryConfig(loadEnvFile());

const guard = process.env['FACTORY_RUN_GATE48_GIT_PREPARE_FK_TESTS'] === 'true';
const configReady = Boolean(cfg.supabaseUrl && cfg.dbHost && cfg.dbPassword);
const configuredRef = (cfg.supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/) ?? [])[1] ?? '';
const targetAuthorized = configuredRef === 'dybyidtcyzgliupzzfhl';
const enabled = guard && configReady && targetAuthorized;

const GATE48_GPFK_DIAG = { GUARD_TRUE: guard, CONFIG_READY: configReady, TARGET_AUTHORIZED: targetAuthorized, ENABLED: enabled };

// ─────────────────────────────────────────────────────────────────────────
// 2. FIXTURE MODEL — single confirmed-owned identity per live run.
// ─────────────────────────────────────────────────────────────────────────
interface FixtureState {
  root: string | null;
  authUserId: string | null;
  ownerId: string | null;
  projectId: string | null;
  agentId: string | null;
  taskId: string | null;
  deliveryId: string | null;
  approvalId: string | null;
  confirmed: {
    authUser: boolean;
    project: boolean;
    agent: boolean;
    task: boolean;
    taskVerification: boolean;
    delivery: boolean;
    approval: boolean;
  };
}

function freshFixtureState(): FixtureState {
  return {
    root: null,
    authUserId: null,
    ownerId: null,
    projectId: null,
    agentId: null,
    taskId: null,
    deliveryId: null,
    approvalId: null,
    confirmed: { authUser: false, project: false, agent: false, task: false, taskVerification: false, delivery: false, approval: false },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. CLIENT LIFECYCLE — registered clients always ended; exact-ID cleanup.
// ─────────────────────────────────────────────────────────────────────────
const clients: pg.Client[] = [];
const fixtures = new Map<pg.Client, FixtureState>();

function makeClient(): pg.Client {
  const value = new pg.Client({
    host: cfg.dbHost,
    port: cfg.dbPort,
    user: cfg.dbUser,
    password: cfg.dbPassword,
    database: cfg.dbName,
    ssl: { rejectUnauthorized: false },
  });
  clients.push(value);
  return value;
}

// Wraps a single pg.Client as a pool-shaped object for SupabaseStore (the
// repository's established live-testing convention: gate28/gate38/gate46).
function wrapConn(conn: pg.Client): pg.Pool {
  return {
    query: (text: string, params?: unknown[]) => conn.query(text, params),
    connect: async () => ({
      query: (t: string, p?: unknown[]) => conn.query(t, p),
      release: () => undefined,
    }),
  } as unknown as pg.Pool;
}

async function connectClient(c: pg.Client): Promise<void> { await c.connect(); }

// Exact-ID delete. Table name is a compile-time literal (never user input);
// ids are parameterized. Callers MUST only pass ids this run confirmed-created.
async function exactDelete(c: pg.Client, table: string, id: string): Promise<void> {
  await c.query(`delete from ${table} where id = $1`, [id]);
}

// Cleanup deletes ONLY resources this run confirmed-created, in FK-safe order.
// The owner is NOT directly deleted; it disappears via auth.users ON DELETE
// CASCADE (owners.id → auth.users(id)). task_verifications rows are removed by
// the proven task FK ON DELETE CASCADE when the confirmed task is deleted.
async function cleanupFixture(c: pg.Client): Promise<void> {
  const state = fixtures.get(c);
  if (!state) return;
  try {
    const pdelivery = state.confirmed.delivery && state.deliveryId;
    if (pdelivery) await exactDelete(c, 'public.prepared_deliveries', pdelivery);
    const approval = state.confirmed.approval && state.approvalId;
    if (approval) await exactDelete(c, 'public.approvals', approval);
    const task = state.confirmed.task && state.taskId;
    if (task) await exactDelete(c, 'public.tasks', task);
    const agent = state.confirmed.agent && state.agentId;
    if (agent) await exactDelete(c, 'public.agents', agent);
    const project = state.confirmed.project && state.projectId;
    if (project) await exactDelete(c, 'public.projects', project);
    const authUser = state.confirmed.authUser && state.authUserId;
    if (authUser) await exactDelete(c, 'auth.users', authUser);
  } catch {
    // Residue proof surfaces any leak loudly.
  } finally {
    fixtures.delete(c);
  }
}

// Post-cleanup proof: every resource THIS run confirmed-created is absent.
async function verifyOwnedRowsGone(c: pg.Client, state: FixtureState): Promise<void> {
  const idChecks: Array<[string, string | null, boolean]> = [
    ['public.prepared_deliveries', state.deliveryId, state.confirmed.delivery],
    ['public.approvals', state.approvalId, state.confirmed.approval],
    ['public.tasks', state.taskId, state.confirmed.task],
    ['public.agents', state.agentId, state.confirmed.agent],
    ['public.projects', state.projectId, state.confirmed.project],
    ['public.owners', state.ownerId, state.confirmed.authUser],
  ];
  for (const [table, id, confirmed] of idChecks) {
    if (confirmed && id) {
      const r = await c.query(`select 1 from ${table} where id = $1 limit 1`, [id]);
      expect(r.rows.length).toBe(0);
    }
  }
  if (state.confirmed.taskVerification && state.taskId) {
    const r = await c.query(`select 1 from public.task_verifications where task_id = $1 limit 1`, [state.taskId]);
    expect(r.rows.length).toBe(0);
  }
  if (state.confirmed.authUser && state.authUserId) {
    const r = await c.query(`select 1 from auth.users where id = $1 limit 1`, [state.authUserId]);
    expect(r.rows.length).toBe(0);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. SCRATCH GIT WORKSPACE — isolated, disposable, base commit + change.
// ─────────────────────────────────────────────────────────────────────────
async function makeScratchRepo(): Promise<{ root: string; fingerprint: string }> {
  const root = await mkdtemp(join(tmpdir(), 'chef-g48gpfk-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'a.ts'), 'export const value = 1;\n');
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git(['init', '-q']);
  git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'add', '.']);
  git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base']);
  await writeFile(join(root, 'src', 'a.ts'), 'export const value = 2;\n');
  const fp = await fingerprintWorkspace(root);
  if (!fp.ok) throw new Error('scratch workspace fingerprint failed');
  return { root, fingerprint: fp.value.fingerprint };
}

// ─────────────────────────────────────────────────────────────────────────
// 5. FIXTURE CREATION — single identity, trigger-provisioned owner.
// ─────────────────────────────────────────────────────────────────────────
async function fixture(): Promise<{
  c: pg.Client;
  store: SupabaseStore;
  state: FixtureState;
  ownerId: string;
  projectId: string;
  agentId: string;
  taskId: string;
  root: string;
  fingerprint: string;
}> {
  const c = makeClient();
  await connectClient(c);
  const state = freshFixtureState();
  fixtures.set(c, state);

  const authUserId = crypto.randomUUID();
  const ownerId = authUserId; // ONE canonical identity — no independent owner UUID
  const email = `gate48gpfk-${authUserId}@chef.local`;
  state.ownerId = ownerId;
  state.authUserId = authUserId;

  const authRows = await c.query<{ id: string }>(
    `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
     values ($1, 'authenticated', 'authenticated', $2, 'encrypted', now())
     returning id`,
    [authUserId, email],
  );
  if (authRows.rows.length !== 1 || authRows.rows[0]?.id !== authUserId) {
    throw new Error('gate48gpfk: auth user insert was not positively ours — aborting (delete nothing)');
  }
  state.confirmed.authUser = true;

  // Trigger-provisioned owner must be exactly verified.
  const ownerProbe = await c.query<{ id: string; email: string }>(
    `select id, email from public.owners where id = $1 limit 4`,
    [authUserId],
  );
  const firstOwner = ownerProbe.rows[0];
  const exactOwner =
    ownerProbe.rows.length === 1 &&
    firstOwner !== undefined &&
    firstOwner.id === authUserId &&
    firstOwner.email === email;
  if (!exactOwner) {
    throw new Error('gate48gpfk: trigger-provisioned owner not exactly verified (absent/multiple/email/id mismatch) — aborting');
  }

  const store = new SupabaseStore(wrapConn(c));

  const project = await store.createProject(ownerId, { name: 'gate48gpfk', slug: `gate48gpfk-${ownerId}` });
  state.projectId = project.id;
  state.confirmed.project = true;

  const { root, fingerprint } = await makeScratchRepo();
  state.root = root;
  await store.upsertPassport(ownerId, project.id, { repository: { workspaceRoot: root } });

  const agent = await store.createAgent(ownerId, { name: 'gate48gpfk-agent', role: 'assistant', capabilities: [], maxConcurrentTasks: 1 });
  state.agentId = agent.id;
  state.confirmed.agent = true;

  const task = await store.createTask(ownerId, {
    projectId: project.id, agentId: agent.id, title: 'gate48gpfk task', status: 'needs_approval',
  });
  state.taskId = task.id;
  state.confirmed.task = true;

  return { c, store, state, ownerId, projectId: project.id, agentId: agent.id, taskId: task.id, root, fingerprint };
}

function makeInput(fx: Awaited<ReturnType<typeof fixture>>): ToolHandlerInput {
  return {
    ownerId: fx.ownerId,
    args: { message: 'gate48gpfk verified delivery' },
    store: fx.store,
    // Repo advisory-lock stub — the Store already carries the real connection.
    db: { query: async () => ({ rows: [] }) },
    context: {
      projectId: fx.projectId,
      actorType: 'agent',
      actorId: fx.agentId,
      agentId: fx.agentId,
      taskId: fx.taskId,
      environment: 'development',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 6. LIVE MODULE — repaired gitPrepareCommit requester FK regression.
// ─────────────────────────────────────────────────────────────────────────
describe.skipIf(!enabled)('Gate 48 Git Prepare FK Live — owner requester contract', () => {
  afterEach(async () => {
    const states: FixtureState[] = [];
    for (const c of clients) {
      const s = fixtures.get(c);
      if (s) states.push(s);
    }
    for (const c of clients) await cleanupFixture(c);
    if (states.length > 0) {
      const observer = makeClient();
      await connectClient(observer);
      try {
        for (const s of states) await verifyOwnedRowsGone(observer, s);
      } finally {
        await observer.end().catch(() => undefined);
      }
    }
    for (const c of clients) await c.end().catch(() => undefined);
    clients.length = 0;
    for (const s of states) {
      if (s.root) await rm(s.root, { recursive: true, force: true });
    }
  });

  // ── GPFK-01: positive path against the REAL owners FK ────────────
  it('LIVE GPFK-01 persists an owner-requester approval via the real requested_by → owners(id) FK', async () => {
    const fx = await fixture();
    const sessionId = crypto.randomUUID();
    await fx.store.recordTaskVerification(fx.ownerId, {
      projectId: fx.projectId, taskId: fx.taskId, attempt: 1, operation: 'build', outcome: 'passed',
      verificationSessionId: sessionId, workspaceFingerprint: fx.fingerprint,
    });
    fx.state.confirmed.taskVerification = true;

    const result = await gitPrepareCommitHandler(makeInput(fx));
    expect(result.success).toBe(true);
    const data = result.data as { deliveryId: string; approvalId: string; status: string };
    fx.state.deliveryId = data.deliveryId;
    fx.state.approvalId = data.approvalId;
    fx.state.confirmed.delivery = true;
    fx.state.confirmed.approval = true;

    // Persisted approval columns — directly from the real DB row.
    const approval = await fx.c.query<{
      requested_by: string | null;
      owner_id: string | null;
      project_id: string | null;
      task_id: string | null;
      agent_id: string | null;
    }>(`select requested_by, owner_id, project_id, task_id, agent_id from public.approvals where id = $1`, [data.approvalId]);
    expect(approval.rows).toHaveLength(1);
    const a = approval.rows[0]!;
    expect(a.requested_by).toBe(fx.ownerId);
    expect(a.requested_by).not.toBe(fx.agentId);
    expect(a.owner_id).toBe(fx.ownerId);
    expect(a.project_id).toBe(fx.projectId);
    expect(a.task_id).toBe(fx.taskId);
    expect(a.agent_id).toBe(fx.agentId);

    // Persisted prepared-delivery bindings — directly from the real DB row.
    const delivery = await fx.c.query<{
      owner_id: string | null;
      project_id: string | null;
      task_id: string | null;
      agent_id: string | null;
      approval_id: string | null;
    }>(`select owner_id, project_id, task_id, agent_id, approval_id from public.prepared_deliveries where id = $1`, [data.deliveryId]);
    expect(delivery.rows).toHaveLength(1);
    const d = delivery.rows[0]!;
    expect(d.owner_id).toBe(fx.ownerId);
    expect(d.project_id).toBe(fx.projectId);
    expect(d.task_id).toBe(fx.taskId);
    expect(d.agent_id).toBe(fx.agentId);
    expect(d.approval_id).toBe(data.approvalId);

    // Read-path contract coherence.
    const viaStore = await fx.store.getApproval(fx.ownerId, data.approvalId);
    expect(viaStore?.status).toBe('pending');
    expect(viaStore?.action).toBe('git.commit');
    const deliveryViaStore = await fx.store.getPreparedDelivery(fx.ownerId, data.deliveryId);
    expect(deliveryViaStore?.status).toBe('prepared');
  });

  // ── GPFK-02: missing/invalid Gate46 evidence fails closed BEFORE insert ─
  it('LIVE GPFK-02 fails before insert when Gate46 evidence is missing or malformed', async () => {
    const fx = await fixture();

    // No evidence at all → handler must reject before any insert.
    const noEvidence = await gitPrepareCommitHandler(makeInput(fx));
    expect(noEvidence.success).toBe(false);
    expect(String(noEvidence.error)).toContain('Gate46');

    // Malformed session uuid → still rejected.
    await fx.store.recordTaskVerification(fx.ownerId, {
      projectId: fx.projectId, taskId: fx.taskId, attempt: 1, operation: 'test', outcome: 'passed',
      verificationSessionId: 'not-a-uuid', workspaceFingerprint: 'f'.repeat(64),
    });
    fx.state.confirmed.taskVerification = true;
    const malformed = await gitPrepareCommitHandler(makeInput(fx));
    expect(malformed.success).toBe(false);
    expect(String(malformed.error)).toContain('Gate46');

    // NOTHING may have been inserted for this owner.
    const approvals = await fx.c.query(`select id from public.approvals where owner_id = $1`, [fx.ownerId]);
    const deliveries = await fx.c.query(`select id from public.prepared_deliveries where owner_id = $1`, [fx.ownerId]);
    expect(approvals.rows).toHaveLength(0);
    expect(deliveries.rows).toHaveLength(0);
  });

  // ── GPFK-03: stale workspace fingerprint rejected BEFORE insert ─────
  it('LIVE GPFK-03 rejects stale verified fingerprint evidence before insert', async () => {
    const fx = await fixture();
    // Shape-valid but STALE: the recorded fingerprint does not match the real
    // trusted recomputation of the workspace (fingerprintWorkspace). The handler
    // recomputes the live fingerprint and must reject before any insert.
    await fx.store.recordTaskVerification(fx.ownerId, {
      projectId: fx.projectId, taskId: fx.taskId, attempt: 1, operation: 'build', outcome: 'passed',
      verificationSessionId: crypto.randomUUID(), workspaceFingerprint: 'f'.repeat(64),
    });
    fx.state.confirmed.taskVerification = true;

    const result = await gitPrepareCommitHandler(makeInput(fx));
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('stale');

    const approvals = await fx.c.query(`select id from public.approvals where owner_id = $1`, [fx.ownerId]);
    const deliveries = await fx.c.query(`select id from public.prepared_deliveries where owner_id = $1`, [fx.ownerId]);
    expect(approvals.rows).toHaveLength(0);
    expect(deliveries.rows).toHaveLength(0);
  });
});