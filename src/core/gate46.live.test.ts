// CHEF FACTORY — Gate 46 live, sequential validation only.
// Uses isolated synthetic owners and deletes them in afterAll. No model calls.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';
import { withRepoLock } from '../workspace/mutation.js';
import type { Store } from './ports.js';
import { createVerificationAcceptanceGateway } from '../software/verification/gate45.js';

const cfg = getFactoryConfig(loadEnvFile());
const enabled = Boolean(cfg.dbPassword && cfg.dbHost);

function id(): string { return crypto.randomUUID(); }
function wrap(client: pg.Client) {
  return { query: (text: string, params?: unknown[]) => client.query(text, params) } as unknown as pg.Pool;
}

let admin: pg.Client | null = null;
let peer: pg.Client | null = null;
let store: Store | null = null;
let ownerA = '';
let ownerB = '';
let projectA = '';
let projectB = '';
let taskA = '';

beforeAll(async () => {
  if (!enabled) return;
  admin = new pg.Client({ host: cfg.dbHost, port: cfg.dbPort, user: cfg.dbUser, password: cfg.dbPassword, database: cfg.dbName, ssl: { rejectUnauthorized: false } });
  peer = new pg.Client({ host: cfg.dbHost, port: cfg.dbPort, user: cfg.dbUser, password: cfg.dbPassword, database: cfg.dbName, ssl: { rejectUnauthorized: false } });
  await admin.connect();
  await peer.connect();
  store = new SupabaseStore(wrap(admin));
  ownerA = id(); ownerB = id();
  for (const ownerId of [ownerA, ownerB]) {
    const email = `g46-live-${ownerId.slice(0, 8)}@chef.local`;
    await admin.query(`insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, 'encrypted', now())`, [ownerId, email]);
    await admin.query(`insert into public.owners (id, email, status) values ($1, $2, 'active') on conflict do nothing`, [ownerId, email]);
  }
  projectA = (await store.createProject(ownerA, { name: 'Gate46A', slug: `g46a-${id()}` })).id;
  projectB = (await store.createProject(ownerA, { name: 'Gate46B', slug: `g46b-${id()}` })).id;
  taskA = (await store.createTask(ownerA, { projectId: projectA, title: 'Gate46 evidence', status: 'running', verificationRequired: true, requiredVerifications: ['test'] })).id;
});

afterAll(async () => {
  if (admin) {
    await admin.query('delete from auth.users where id = any($1::uuid[])', [[ownerA, ownerB]]).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
  if (peer) await peer.end().catch(() => undefined);
});

describe.skipIf(!enabled)('Gate 46 — live evidence and coordination', () => {
  it('schema has exact nullable columns, constraint, index, RLS, and policies', async () => {
    const cols = await admin!.query(`select column_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name='task_verifications'
      and column_name in ('verification_session_id','workspace_fingerprint') order by column_name`);
    expect(cols.rows).toEqual([
      { column_name: 'verification_session_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
      { column_name: 'workspace_fingerprint', data_type: 'text', is_nullable: 'YES', column_default: null },
    ]);
    const constraint = await admin!.query(`select pg_get_constraintdef(oid) as definition from pg_constraint
      where conrelid='public.task_verifications'::regclass and conname='task_verifications_workspace_fingerprint_check'`);
    expect(constraint.rows[0]!.definition).toContain("^[0-9a-f]{64}$");
    const index = await admin!.query(`select indexname from pg_indexes where schemaname='public'
      and tablename='task_verifications' and indexname='task_verifications_session_idx'`);
    expect(index.rows).toHaveLength(1);
    const rls = await admin!.query(`select relrowsecurity from pg_class where oid='public.task_verifications'::regclass`);
    expect(rls.rows[0]!.relrowsecurity).toBe(true);
    const policies = await admin!.query(`select policyname from pg_policies where schemaname='public'
      and tablename='task_verifications' order by policyname`);
    expect(policies.rows.map((r) => r.policyname)).toEqual(['tv_no_delete', 'tv_no_insert', 'tv_no_update', 'tv_select_owner']);
  });

  it('Store round-trips trusted UUID session and SHA-256 fingerprint; scope is enforced', async () => {
    const session = id();
    const fingerprint = 'a'.repeat(64);
    const row = await store!.recordTaskVerification(ownerA, {
      projectId: projectA, taskId: taskA, attempt: 1, operation: 'test', outcome: 'passed',
      verificationSessionId: session, workspaceFingerprint: fingerprint,
    });
    expect(row.verificationSessionId).toBe(session);
    expect(row.workspaceFingerprint).toBe(fingerprint);
    const rows = await store!.listTaskVerifications(ownerA, taskA);
    expect(rows.some((item) => item.id === row.id && item.verificationSessionId === session && item.workspaceFingerprint === fingerprint)).toBe(true);
    await expect(store!.recordTaskVerification(ownerA, {
      projectId: projectB, taskId: taskA, attempt: 1, operation: 'test', outcome: 'passed',
    })).rejects.toThrow('task project mismatch');
    expect(await store!.listTaskVerifications(ownerB, taskA)).toEqual([]);
  });

  it('authenticated ordinary authority can read only its owner rows and cannot write evidence', async () => {
    await admin!.query('begin');
    try {
      await admin!.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ownerA]);
      await admin!.query('set local role authenticated');
      const own = await admin!.query(`select count(*)::int as count from public.task_verifications where task_id=$1`, [taskA]);
      expect(own.rows[0]!.count).toBeGreaterThan(0);
      await expect(admin!.query(`insert into public.task_verifications
        (owner_id, project_id, task_id, attempt, operation, outcome) values ($1,$2,$3,1,'test','passed')`, [ownerA, projectA, taskA])).rejects.toThrow();
    } finally {
      await admin!.query('rollback');
    }
    await admin!.query('begin');
    try {
      await admin!.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ownerB]);
      await admin!.query('set local role authenticated');
      const other = await admin!.query(`select count(*)::int as count from public.task_verifications where task_id=$1`, [taskA]);
      expect(other.rows[0]!.count).toBe(0);
    } finally {
      await admin!.query('rollback');
    }
  });

  it('historical live evidence cannot authorize a new failed Gate45 evaluation', async () => {
    const task = await store!.getTask(ownerA, taskA);
    expect(task).not.toBeNull();
    const gate = createVerificationAcceptanceGateway({
      store: store!,
      resolveWorkspaceRoot: async () => '/tmp/gate46-live',
      fingerprint: async () => ({ ok: true, value: { algorithm: 'sha256', fingerprint: 'b'.repeat(64), fileCount: 1, totalBytes: 1 } }),
      runOp: async (operation) => ({ ok: false, outcome: 'failed', operation, exitCode: 1, timedOut: false, durationMs: 1, stdout: '', stderr: '', truncated: false, manifestHash: null }),
    });
    expect((await gate.evaluate(task!)).accepted).toBe(false);
  });

  it('live advisory lock serializes a competing trusted mutation boundary', async () => {
    const root = `g46-live-lock-${id()}`;
    let peerEntered = false;
    const held = new Promise<void>((resolve) => setTimeout(resolve, 200));
    const first = withRepoLock(wrap(admin!), root, async () => { await held; return 'first'; });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = withRepoLock(wrap(peer!), root, async () => { peerEntered = true; return 'second'; });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(peerEntered).toBe(false);
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
  });

  it('live completion CAS refuses a cancelled task', async () => {
    const task = await store!.createTask(ownerA, { projectId: projectA, title: 'Gate46 cancellation', status: 'running' });
    await store!.patchTask(ownerA, task.id, { status: 'cancelled' });
    expect(await store!.completeTaskIfRunning(ownerA, task.id, { status: 'completed', completedAt: new Date().toISOString() })).toBeNull();
  });
});
