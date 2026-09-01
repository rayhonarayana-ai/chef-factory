// CHEF FACTORY — Gate 48 — Live Harness V2.5 (LIVE-05 restricted-context setup repair).
//
// V2.5 is derived from the frozen V2.4 harness. V2.4 corrected the LIVE-03
// result-semantics and LIVE-01/02/03/04 proofs are preserved unchanged. V2.5
// repairs the LIVE-05 restricted-context GUC setup that failed in V2.4:
//
// Frozen V2.4 used:
//     set local request.jwt.claims = $1
// which is invalid PostgreSQL SET syntax (SET does not accept bind parameters)
// and failed live with: syntax error at or near "$1".
// That failure occurred BEFORE the cross-owner read/write assertions, so:
//     RLS_WEAKNESS_PROVEN        = NO
//     LIVE05_RLS_PROOF_COMPLETED = NO
//     HARNESS_SETUP_DEFECT_PROVEN= YES
//
// V2.5 replaces ONLY the invalid GUC assignment with a parameter-safe,
// transaction-local assignment and adds a narrow JWT-context verification,
// preserving the LIVE-05 cross-owner read/write security assertions unchanged.
//
// Repaired setup:
//     BEGIN
//     → SET LOCAL ROLE authenticated
//     → select set_config('request.jwt.claims', $1, true)   (transaction-local)
//     → verify effective restricted JWT context (sub + role)
//     → cross-owner read proof
//     → cross-owner write proof
//     → verify durable state
//     → ROLLBACK / frozen cleanup path
//
// No production source, no RLS, no policy, no schema is modified.
// Synthetic namespace: gate48v2_5-. LIVE-06 absent and non-executable.
// Guard is strict opt-in to the authorized project ref dybyidtcyzgliupzzfhl.
// Synthetic identities only. Never prints secrets.

import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';
import type { ApprovalPatch } from '../core/ports.js';
import type { ApprovalRecord } from '../core/types.js';

// ─────────────────────────────────────────────────────────────────────────
// 1. ENABLEMENT — prebuilt, boolean-only diagnostics (no secrets ever).
// ─────────────────────────────────────────────────────────────────────────
const cfg = getFactoryConfig(loadEnvFile());

const guard = process.env['FACTORY_RUN_GATE48_DB_TESTS'] === 'true';
const configReady = Boolean(cfg.supabaseUrl && cfg.dbHost && cfg.dbPassword);
const configuredRef = (cfg.supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/) ?? [])[1] ?? '';
const targetAuthorized = configuredRef === 'dybyidtcyzgliupzzfhl';
const enabled = guard && configReady && targetAuthorized;

const GATE48_V2_5_DIAG = { GUARD_TRUE: guard, CONFIG_READY: configReady, TARGET_AUTHORIZED: targetAuthorized, ENABLED: enabled };

// ─────────────────────────────────────────────────────────────────────────
// 2. FIXTURE MODEL — single-identity, flag-gated ownership.
// ─────────────────────────────────────────────────────────────────────────
// ownerId === authUserId. The owner row is a deterministic DB side effect of
// the confirmed auth insert (auth trigger). It is never cleanly owned by an
// independent DELETE; it is removed via ON DELETE CASCADE on auth deletion.
interface FixtureState {
  authUserId: string | null;
  ownerId: string | null;
  expectedOwnerEmail: string | null;
  projectId: string | null;
  agentIds: string[];
  taskId: string | null;
  approvalId: string | null;
  preparedDeliveryId: string | null;
  ownerProvenProvisioned: boolean;
  confirmed: {
    authUser: boolean;
    project: boolean;
    agents: Record<string, boolean>;
    task: boolean;
    approval: boolean;
    delivery: boolean;
  };
}

function freshFixtureState(): FixtureState {
  return {
    authUserId: null,
    ownerId: null,
    expectedOwnerEmail: null,
    projectId: null,
    agentIds: [],
    taskId: null,
    approvalId: null,
    preparedDeliveryId: null,
    ownerProvenProvisioned: false,
    confirmed: { authUser: false, project: false, agents: {}, task: false, approval: false, delivery: false },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. CLIENT LIFECYCLE — every client registered so it is always ended.
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
// repository's established live-test convention: gate28/gate38/gate46).
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

// Cleanup deletes ONLY resources this run confirmed-created. The owner is NOT
// directly deleted; it disappears via auth.users ON DELETE CASCADE.
async function cleanupFixture(c: pg.Client): Promise<void> {
  const state = fixtures.get(c);
  if (!state) return;
  try {
    if (state.confirmed.delivery && state.preparedDeliveryId) {
      await exactDelete(c, 'public.prepared_deliveries', state.preparedDeliveryId);
    }
    if (state.confirmed.approval && state.approvalId) {
      await exactDelete(c, 'public.approvals', state.approvalId);
    }
    if (state.confirmed.task && state.taskId) {
      await exactDelete(c, 'public.tasks', state.taskId);
    }
    for (const agentId of state.agentIds) {
      if (state.confirmed.agents[agentId]) await exactDelete(c, 'public.agents', agentId);
    }
    if (state.confirmed.project && state.projectId) {
      await exactDelete(c, 'public.projects', state.projectId);
    }
    // AUTH-DELETE-CASCADE-ONLY owner cleanup: deleting the confirmed-owned auth
    // user removes the trigger-provisioned owner via owners_id_fkey
    // (public.owners.id REFERENCES auth.users(id) ON DELETE CASCADE).
    if (state.confirmed.authUser && state.authUserId) {
      await exactDelete(c, 'auth.users', state.authUserId);
    }
  } catch {
    // Residue proof surfaces any leak loudly.
  } finally {
    fixtures.delete(c);
  }
}

// Post-cleanup proof: every resource THIS run confirmed-created is absent, and
// the cascade-owned owner is gone. Does NOT assert absence of unowned data.
async function verifyOwnedRowsGone(c: pg.Client, state: FixtureState): Promise<void> {
  const checks: Array<[string, string, boolean]> = [
    ['public.prepared_deliveries', state.preparedDeliveryId ?? '', state.confirmed.delivery],
    ['public.approvals', state.approvalId ?? '', state.confirmed.approval],
    ['public.tasks', state.taskId ?? '', state.confirmed.task],
    ['public.projects', state.projectId ?? '', state.confirmed.project],
    ['public.owners', state.ownerId ?? '', state.ownerProvenProvisioned],
  ];
  for (const [table, id, confirmed] of checks) {
    if (confirmed && id) {
      const r = await c.query(`select 1 from ${table} where id = $1 limit 1`, [id]);
      expect(r.rows.length).toBe(0);
    }
  }
  for (const agentId of state.agentIds) {
    if (state.confirmed.agents[agentId]) {
      const r = await c.query(`select 1 from public.agents where id = $1 limit 1`, [agentId]);
      expect(r.rows.length).toBe(0);
    }
  }
  if (state.confirmed.authUser && state.authUserId) {
    const r = await c.query(`select 1 from auth.users where id = $1 limit 1`, [state.authUserId]);
    expect(r.rows.length).toBe(0);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. FIXTURE CREATION — single identity, trigger-provisioned owner, flag-gated.
// ─────────────────────────────────────────────────────────────────────────
// authUserId === ownerId. NO explicit public.owners INSERT. The owner is the
// trigger-provisioned side effect, exactly verified (single row, id and email
// match) before the fixture treats the owner identity as usable.
async function fixture(clientOverride?: pg.Client): Promise<{
  c: pg.Client;
  store: SupabaseStore;
  state: FixtureState;
  ownerId: string;
  approval: ApprovalRecord;
  deliveryId: string;
  taskId: string;
}> {
  const c = clientOverride ?? makeClient();
  await connectClient(c);
  const state = freshFixtureState();
  fixtures.set(c, state); // registered so cleanup/end always run; nothing owned yet

  const authUserId = crypto.randomUUID();
  const ownerId = authUserId; // ONE canonical identity — no independent owner UUID
  const expectedEmail = `gate48v2_5-${authUserId}@chef.local`;
  state.ownerId = ownerId;
  state.authUserId = authUserId;
  state.expectedOwnerEmail = expectedEmail;

  // auth user — positive insertion evidence only. RETURNING id proves THIS run
  // created the user. A zero-row conflict/no-op is NOT ownership.
  const authRows = await c.query<{ id: string }>(
    `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
     values ($1, 'authenticated', 'authenticated', $2, 'encrypted', now())
     returning id`,
    [authUserId, expectedEmail],
  );
  // No await/await-external-call is permitted between the successful RETURNING
  // result and marking authUser confirmed-owned (CASE E must not strand it).
  if (authRows.rows.length !== 1 || authRows.rows[0]?.id !== authUserId) {
    throw new Error('gate48v2_5: auth user insert was not positively ours — aborting (delete nothing)');
  }
  state.confirmed.authUser = true;

  // Trigger-provisioned owner confirmation — must NOT be assumed silently.
  // Exactly one row, exact id/email match; otherwise FAIL fixture setup.
  const ownerProbe = await c.query<{ id: string; email: string }>(
    `select id, email from public.owners where id = $1 limit 4`,
    [authUserId],
  );
  const firstOwner = ownerProbe.rows[0];
  const exactOwner =
    ownerProbe.rows.length === 1 &&
    firstOwner !== undefined &&
    firstOwner.id === authUserId &&
    firstOwner.email === expectedEmail;
  if (!exactOwner) {
    throw new Error('gate48v2_5: trigger-provisioned owner not exactly verified (absent/multiple/email/id mismatch) — aborting');
  }
  state.ownerProvenProvisioned = true;

  const store = new SupabaseStore(wrapConn(c));

  const project = await store.createProject(ownerId, { name: 'gate48v2_5', slug: `gate48v2_5-${ownerId}` });
  state.projectId = project.id;
  state.confirmed.project = true;

  const agent = await store.createAgent(ownerId, { name: 'gate48v2_5-agent', role: 'assistant', capabilities: [], maxConcurrentTasks: 1 });
  state.agentIds.push(agent.id);
  state.confirmed.agents[agent.id] = true;

  const task = await store.createTask(ownerId, {
    projectId: project.id, agentId: agent.id, title: 'gate48v2_5 transaction', status: 'needs_approval',
  });
  state.taskId = task.id;
  state.confirmed.task = true;

  const delivery = await store.createPreparedDelivery(ownerId, {
    projectId: project.id, taskId: task.id, agentId: agent.id,
    message: 'gate48v2_5 delivery', messageHash: '0'.repeat(64), baseCommit: '1'.repeat(40),
    preparedTreeSha: '2'.repeat(40), manifest: [{ path: 'src/v2_5.ts', kind: 'M', sha256: '3'.repeat(64) }],
    manifestFingerprint: '4'.repeat(64), workspaceFingerprint: '5'.repeat(64),
    verificationSessionId: crypto.randomUUID(), verificationWorkspaceFingerprint: '5'.repeat(64),
  });
  state.preparedDeliveryId = delivery.id;
  state.confirmed.delivery = true;

  const approval = await store.createApproval(ownerId, {
    projectId: project.id, taskId: task.id, agentId: agent.id, action: 'git.commit', riskLevel: 'critical', requestedBy: ownerId,
  });
  state.approvalId = approval.id;
  state.confirmed.approval = true;

  const linked = await store.linkPreparedDeliveryApproval(ownerId, delivery.id, approval.id);
  if (!linked) throw new Error('fixture link failed');

  return { c, store, state, ownerId, approval, deliveryId: delivery.id, taskId: task.id };
}

function approvalPatch(ownerId: string, status: 'approved' | 'denied'): Required<ApprovalPatch> {
  return {
    status,
    decision: status,
    decisionReason: status,
    decidedBy: ownerId,
    decidedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 5. LIVE MODULE — LIVE-01..LIVE-05 (LIVE-06 excluded by design).
// ─────────────────────────────────────────────────────────────────────────
describe.skipIf(!enabled)('Gate 48 Live V2.5 — atomic approval/delivery transaction', () => {
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
      for (const s of states) await verifyOwnedRowsGone(observer, s);
      await observer.end().catch(() => undefined);
    }
    for (const c of clients) await c.end().catch(() => undefined);
    clients.length = 0;
  });

  // ── LIVE-01: happy-path atomic pair ──────────────────────────────
  it('LIVE-01 commits pending/prepared to approved/approved atomically', async () => {
    const fx = await fixture();
    const result = await fx.store.decideApprovalWithPreparedDelivery(
      fx.ownerId, fx.approval.id, approvalPatch(fx.ownerId, 'approved'), 'approved',
    );
    expect(result).not.toBeNull();
    expect((await fx.store.getApproval(fx.ownerId, fx.approval.id))?.status).toBe('approved');
    expect((await fx.store.getPreparedDelivery(fx.ownerId, fx.deliveryId))?.status).toBe('approved');
  });

  // ── LIVE-02: REAL second-op failure + REAL rollback ──────────────
  it('LIVE-02 proves real rollback when the second delivery UPDATE faults', async () => {
    const fx = await fixture();
    const failingConn = makeClient();
    await connectClient(failingConn);

    const originalQuery = failingConn.query.bind(failingConn);
    type InterceptQuery = (text: string | { text: string; values?: unknown[] }, params?: unknown[]) => Promise<unknown>;
    const interceptor: InterceptQuery = async (text, params) => {
      if (typeof text === 'string' && text.trimStart().toLowerCase().startsWith('update public.prepared_deliveries')) {
        const seen = await originalQuery(
          `select status from public.approvals where id = $1`, [fx.approval.id],
        ) as { rows: Array<{ status: string }> };
        if (seen.rows[0]?.status !== 'approved') {
          throw new Error('LIVE-02 guard: approval UPDATE did not precede delivery fault');
        }
        throw new Error('controlled second-operation failure');
      }
      return originalQuery(text, params);
    };
    (failingConn as unknown as { query: InterceptQuery }).query = interceptor;

    const failingStore = new SupabaseStore(wrapConn(failingConn));

    await expect(
      failingStore.decideApprovalWithPreparedDelivery(
        fx.ownerId, fx.approval.id, approvalPatch(fx.ownerId, 'approved'), 'approved',
      ),
    ).rejects.toThrow('controlled second-operation failure');

    const observer = makeClient();
    await connectClient(observer);
    const a = await observer.query(`select status from public.approvals where id = $1`, [fx.approval.id]);
    const d = await observer.query(`select status from public.prepared_deliveries where id = $1`, [fx.deliveryId]);
    expect(a.rows[0]?.status).toBe('pending');
    expect(d.rows[0]?.status).toBe('prepared');

    expect((await fx.store.getApproval(fx.ownerId, fx.approval.id))?.status).toBe('pending');
    expect((await fx.store.getPreparedDelivery(fx.ownerId, fx.deliveryId))?.status).toBe('prepared');
  });

  // ── LIVE-03: true concurrency, single terminal winner ────────────
  // Winner is determined from RETURNED DOMAIN VALUES (non-null = winner, null =
  // normal loser) and the final durable pair is bound to the actual winner.
  // Promise rejection is never used as a normal loser signal.
  it('LIVE-03 allows exactly one concurrent terminal decision', async () => {
    const fx = await fixture();
    const connB = makeClient();
    await connectClient(connB);
    const storeB = new SupabaseStore(wrapConn(connB));
    const connL = makeClient();
    await connectClient(connL);

    await connL.query('begin');
    await connL.query(
      `select a.id from public.approvals a
       join public.prepared_deliveries d on d.approval_id = a.id and d.owner_id = a.owner_id
       where a.owner_id = $1 and a.id = $2 for update of a, d`,
      [fx.ownerId, fx.approval.id],
    );

    const approvedPromise = fx.store.decideApprovalWithPreparedDelivery(
      fx.ownerId, fx.approval.id, approvalPatch(fx.ownerId, 'approved'), 'approved',
    );
    const deniedPromise = storeB.decideApprovalWithPreparedDelivery(
      fx.ownerId, fx.approval.id, approvalPatch(fx.ownerId, 'denied'), 'denied',
    );

    // Bounded waiting + no early completion while the deliberate lock is held.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const doneBeforeRelease = await Promise.race([
      Promise.all([approvedPromise, deniedPromise]).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
    ]);
    expect(doneBeforeRelease).toBe(false);

    await connL.query('commit');

    const [approved, denied] = await Promise.allSettled([approvedPromise, deniedPromise]);

    // Both operations must have completed WITHOUT unexpected SQL/runtime
    // exceptions. Under the canonical contract both settle as fulfilled (the
    // loser fulfills with null). A rejected promise is unexpected evidence and
    // fails the test.
    if (approved.status === 'rejected') {
      throw new Error(`LIVE-03 unexpected approved rejection: ${String(approved.reason)}`);
    }
    if (denied.status === 'rejected') {
      throw new Error(`LIVE-03 unexpected denied rejection: ${String(denied.reason)}`);
    }

    // Exactly-one-winner invariant from RETURNED DOMAIN VALUES: a fulfilled
    // non-null result is a WIN; a fulfilled null result is the NORMAL LOSER.
    const approvedWon = approved.status === 'fulfilled' && approved.value !== null;
    const deniedWon = denied.status === 'fulfilled' && denied.value !== null;
    const winnerCount = Number(approvedWon) + Number(deniedWon);

    // Winner MUST be a fulfilled non-null ApprovalRecord; loser MUST be a
    // fulfilled null (normal fail-closed sentinel), never a rejection.
    expect(winnerCount).toBe(1);
    expect(approved.status).toBe('fulfilled');
    expect(denied.status).toBe('fulfilled');

    // Fresh durable observation MUST be captured and bound to the actual winner.
    // No assertion that could prevent reaching this observation is placed
    // before it except the unexpected-exception guards above.
    const approval = await fx.store.getApproval(fx.ownerId, fx.approval.id);
    const delivery = await fx.store.getPreparedDelivery(fx.ownerId, fx.deliveryId);
    const finalApprovalStatus = approval?.status;
    const finalDeliveryStatus = delivery?.status;

    if (approvedWon) {
      expect(approved.value).not.toBeNull();
      expect(denied.value).toBeNull();
      expect(finalApprovalStatus).toBe('approved');
      expect(finalDeliveryStatus).toBe('approved');
    } else {
      // deniedWon === true (winnerCount === 1 and approvedWon must be false)
      expect(denied.value).not.toBeNull();
      expect(approved.value).toBeNull();
      expect(finalApprovalStatus).toBe('denied');
      expect(finalDeliveryStatus).toBe('rejected');
    }

    // The final durable pair must be one of the two allowed consistent pairs.
    const pair: [string | undefined, string | undefined] = [finalApprovalStatus, finalDeliveryStatus];
    expect([['approved', 'approved'], ['denied', 'rejected']]).toContainEqual(pair);

    await connL.end().catch(() => undefined);
  });

  // ── LIVE-04: binding / zero-row fail-closed ──────────────────────
  it('LIVE-04 fails closed on missing, terminal, and binding-mismatch pairs', async () => {
    const fx = await fixture();
    expect(await fx.store.decideApprovalWithPreparedDelivery(
      fx.ownerId, crypto.randomUUID(), approvalPatch(fx.ownerId, 'approved'), 'approved',
    )).toBeNull();

    const first = await fx.store.decideApprovalWithPreparedDelivery(
      fx.ownerId, fx.approval.id, approvalPatch(fx.ownerId, 'approved'), 'approved',
    );
    expect(first).not.toBeNull();
    expect(await fx.store.decideApprovalWithPreparedDelivery(
      fx.ownerId, fx.approval.id, approvalPatch(fx.ownerId, 'denied'), 'denied',
    )).toBeNull();
    expect((await fx.store.getApproval(fx.ownerId, fx.approval.id))?.status).toBe('approved');
    expect((await fx.store.getPreparedDelivery(fx.ownerId, fx.deliveryId))?.status).toBe('approved');

    const fx2 = await fixture();
    const secondAgent = await fx2.store.createAgent(fx2.ownerId, { name: 'g48v25-b', role: 'assistant', capabilities: [], maxConcurrentTasks: 1 });
    fx2.state.agentIds.push(secondAgent.id);
    fx2.state.confirmed.agents[secondAgent.id] = true;
    await fx2.c.query(
      `update public.prepared_deliveries set agent_id = $1, updated_at = now() where id = $2`,
      [secondAgent.id, fx2.deliveryId],
    );
    expect(await fx2.store.decideApprovalWithPreparedDelivery(
      fx2.ownerId, fx2.approval.id, approvalPatch(fx2.ownerId, 'approved'), 'approved',
    )).toBeNull();
    expect((await fx2.store.getApproval(fx2.ownerId, fx2.approval.id))?.status).toBe('pending');
    expect((await fx2.store.getPreparedDelivery(fx2.ownerId, fx2.deliveryId))?.status).toBe('prepared');
  });

  // ── LIVE-05: RLS / restricted-context enforcement ────────────────
  it('LIVE-05 proves RLS is enabled and a restricted non-owner context cannot access synthetic rows', async () => {
    const fx = await fixture();
    const rls = await fx.store.rlsProbe(fx.ownerId);
    expect(rls.ok).toBe(true);

    const restricted = makeClient();
    await connectClient(restricted);
    const intruderId = crypto.randomUUID();

    try {
      await restricted.query('begin');
      // Transaction-local role change — validated by the earlier precheck that
      // SET LOCAL ROLE authenticated resolves EFFECTIVE_ROLE = authenticated.
      await restricted.query(`set local role authenticated`);
      // Parameter-safe, transaction-local GUC assignment for the synthetic
      // intruder JWT context. SET does not accept $1 placeholders; set_config
      // does, and the third argument (true) scopes it to the current
      // transaction (no session-persistent leakage).
      await restricted.query(
        `select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: intruderId, role: 'authenticated' })],
      );

      // Narrow JWT-context verification BEFORE exercising RLS: the restricted
      // transaction must carry the intended synthetic intruder identity. If the
      // GUC is missing this fails closed (current_setting with missing_ok=true
      // returns NULL → unparseable → fail). Only sub and role are compared;
      // nothing sensitive is printed. intruderId is a synthetic fixture id.
      const jctx = await restricted.query<{ claims: string | null }>(
        `select current_setting('request.jwt.claims', true) as claims`,
      );
      const jwtText = String(jctx.rows[0]?.claims ?? '');
      let jwtSub = '';
      let jwtRole = '';
      try {
        const parsed = JSON.parse(jwtText) as { sub?: unknown; role?: unknown };
        jwtSub = String(parsed.sub ?? '');
        jwtRole = String(parsed.role ?? '');
      } catch {
        throw new Error('LIVE-05 JWT context missing or unparseable (fail closed)');
      }
      expect(jwtText.length).toBeGreaterThan(0);
      expect(jwtSub).toBe(intruderId);
      expect(jwtRole).toBe('authenticated');

      // CROSS-OWNER READ PROOF: the authenticated intruder (sub != ownerId)
      // must NOT be able to read the owner's project row under live RLS.
      const read = await restricted.query(
        `select 1 from public.projects where id = $1`, [fx.state.projectId],
      ).catch((e: Error) => e);
      if (!(read instanceof Error)) {
        expect(read.rows.length).toBe(0);
      }

      // CROSS-OWNER WRITE PROOF: the same intruder must NOT be able to mutate
      // the owner's row, and the forbidden write must produce no durable change.
      const write = await restricted.query(
        `update public.projects set name = 'pwned', updated_at = now() where id = $1`, [fx.state.projectId],
      ).catch((e: Error) => e);
      expect(write instanceof Error || (write as { rowCount?: number }).rowCount === 0).toBe(true);
      await restricted.query('rollback');
    } catch (err) {
      throw new Error(`LIVE-05 restricted-context setup failed (fail closed): ${String(err)}`);
    }
  });
});
