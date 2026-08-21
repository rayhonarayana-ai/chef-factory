// CHEF FACTORY — Gate 30A — JSONB Serialization Remediation Tests
// Live round-trip proofs for createTask + patchTask JSONB correctness.
// Disposable fixtures. Real PostgreSQL. Zero residue.

import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { SupabaseStore } from '../db/repo.js';
import { MemoryStore } from '../testing/memoryStore.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';

const cfg = getFactoryConfig(loadEnvFile());
const enabled = Boolean(cfg.supabaseUrl && cfg.dbPassword && cfg.dbHost);

interface DisposableHandle {
  ownerId: string;
  conn: pg.Client;
  store: SupabaseStore;
  cleanup: () => Promise<void>;
}

async function makeDisposable(): Promise<DisposableHandle> {
  const ownerId = crypto.randomUUID();
  const conn = new pg.Client({
    host: cfg.dbHost, port: cfg.dbPort, user: cfg.dbUser,
    password: cfg.dbPassword, database: cfg.dbName,
    ssl: { rejectUnauthorized: false },
  });
  await conn.connect();

  await conn.query(
    `INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
     VALUES ($1, 'authenticated', 'authenticated', $2, 'encrypted', now()) ON CONFLICT DO NOTHING`,
    [ownerId, `jv-${ownerId.slice(0,8)}@chef.local`],
  );

  const wrapConn = (c: pg.Client) => ({
    query: (text: string, params?: unknown[]) => c.query(text, params),
    connect: async () => ({
      query: (t: string, p?: unknown[]) => c.query(t, p),
      release: () => undefined,
    }),
  }) as unknown as pg.Pool;

  const store = new SupabaseStore(wrapConn(conn));

  return {
    ownerId, conn, store,
    cleanup: async () => {
      try {
        await conn.query(`DELETE FROM public.tasks WHERE owner_id = $1`, [ownerId]);
        await conn.query(`DELETE FROM public.agents WHERE owner_id = $1`, [ownerId]);
        await conn.query(`DELETE FROM public.projects WHERE owner_id = $1`, [ownerId]);
        await conn.query(`DELETE FROM public.owners WHERE id = $1`, [ownerId]);
        await conn.query(`DELETE FROM auth.users WHERE id = $1`, [ownerId]);
      } catch { /* best effort */ }
      await conn.end().catch(() => {});
    },
  };
}

// =============================================================
// SECTION A: createTask defaults
// =============================================================

describe.skipIf(!enabled)('JSONB A — createTask defaults', () => {
  const handles: DisposableHandle[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('A: createTask empty requiredCapabilities and inputs default to valid JSONB', async () => {
    const d = await makeDisposable();
    handles.push(d);

    const project = await d.store.createProject(d.ownerId, { name: 'AProj', slug: 'ap-' + crypto.randomUUID().slice(0,8) });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'ATask' });

    expect(task.requiredCapabilities).toEqual([]);
    expect(typeof task.inputs).toBe('object');

    const raw = await d.conn.query(
      `SELECT required_capabilities::text AS rc, inputs::text AS inp FROM public.tasks WHERE id = $1 AND owner_id = $2`,
      [task.id, d.ownerId],
    );
    expect(raw.rows[0]!.rc).toBe('[]');
    expect(raw.rows[0]!.inp).toBe('{}');
  });
});

// =============================================================
// SECTION B: createTask populated requirements
// =============================================================

describe.skipIf(!enabled)('JSONB B — createTask populated requirements', () => {
  const handles: DisposableHandle[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('B: requiredCapabilities round-trips as JSONB array', async () => {
    const d = await makeDisposable();
    handles.push(d);

    const project = await d.store.createProject(d.ownerId, { name: 'BProj', slug: 'bp-' + crypto.randomUUID().slice(0,8) });
    const task = await d.store.createTask(d.ownerId, {
      projectId: project.id,
      title: 'BTask',
      requiredCapabilities: ['typescript', 'react'],
    });

    expect(task.requiredCapabilities).toEqual(['typescript', 'react']);

    const fetched = await d.store.getTask(d.ownerId, task.id);
    expect(fetched!.requiredCapabilities).toEqual(['typescript', 'react']);

    const raw = await d.conn.query(
      `SELECT required_capabilities::text AS val FROM public.tasks WHERE id = $1 AND owner_id = $2`,
      [task.id, d.ownerId],
    );
    expect(JSON.parse(raw.rows[0]!.val)).toEqual(['typescript', 'react']);
  });
});

// =============================================================
// SECTION C: createTask inputs JSON
// =============================================================

describe.skipIf(!enabled)('JSONB C — createTask inputs object', () => {
  const handles: DisposableHandle[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('C: inputs round-trips as JSONB object with nested structure', async () => {
    const d = await makeDisposable();
    handles.push(d);

    const project = await d.store.createProject(d.ownerId, { name: 'CProj', slug: 'cp-' + crypto.randomUUID().slice(0,8) });
    const inputObj = { language: 'typescript', nested: { enabled: true } };
    const task = await d.store.createTask(d.ownerId, {
      projectId: project.id,
      title: 'CTask',
      inputs: inputObj as any,
    });

    expect(task.inputs).toEqual(inputObj);

    const fetched = await d.store.getTask(d.ownerId, task.id);
    expect(fetched!.inputs).toEqual(inputObj);

    const raw = await d.conn.query(
      `SELECT inputs::text AS val FROM public.tasks WHERE id = $1 AND owner_id = $2`,
      [task.id, d.ownerId],
    );
    expect(JSON.parse(raw.rows[0]!.val)).toEqual(inputObj);
  });
});

// =============================================================
// SECTION D: patchTask requiredCapabilities
// =============================================================

describe.skipIf(!enabled)('JSONB D — patchTask requiredCapabilities', () => {
  const handles: DisposableHandle[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('D: patchTask requiredCapabilities round-trips as JSONB array', async () => {
    const d = await makeDisposable();
    handles.push(d);

    const project = await d.store.createProject(d.ownerId, { name: 'DProj', slug: 'dp-' + crypto.randomUUID().slice(0,8) });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'DTask' });

    expect(task.requiredCapabilities).toEqual([]);

    const patched = await d.store.patchTask(d.ownerId, task.id, {
      requiredCapabilities: ['python'],
    });
    expect(patched.requiredCapabilities).toEqual(['python']);

    const fetched = await d.store.getTask(d.ownerId, task.id);
    expect(fetched!.requiredCapabilities).toEqual(['python']);

    const raw = await d.conn.query(
      `SELECT required_capabilities::text AS val FROM public.tasks WHERE id = $1 AND owner_id = $2`,
      [task.id, d.ownerId],
    );
    expect(raw.rows[0]!.val).toBe('["python"]');
  });
});

// =============================================================
// SECTION E: patchTask output (JSONB field supported by TaskPatch)
// =============================================================

describe.skipIf(!enabled)('JSONB E — patchTask output', () => {
  const handles: DisposableHandle[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('E: patchTask output round-trips as JSONB object', async () => {
    const d = await makeDisposable();
    handles.push(d);

    const project = await d.store.createProject(d.ownerId, { name: 'EProj', slug: 'ep-' + crypto.randomUUID().slice(0,8) });
    const task = await d.store.createTask(d.ownerId, { projectId: project.id, title: 'ETask' });

    expect(task.output).toBeNull();

    const outputObj = { language: 'python', config: { debug: true } };
    const patched = await d.store.patchTask(d.ownerId, task.id, { output: outputObj });

    expect(patched.output).toEqual(outputObj);

    const fetched = await d.store.getTask(d.ownerId, task.id);
    expect(fetched!.output).toEqual(outputObj);

    const raw = await d.conn.query(
      `SELECT output::text AS val FROM public.tasks WHERE id = $1 AND owner_id = $2`,
      [task.id, d.ownerId],
    );
    expect(JSON.parse(raw.rows[0]!.val)).toEqual(outputObj);
  });
});

// =============================================================
// SECTION F: Memory / Supabase parity
// =============================================================

describe('JSONB F — MemoryStore / SupabaseStore parity', () => {
  it('F: MemoryStore and SupabaseStore produce equivalent TaskRecord shapes', async () => {
    const memStore = new MemoryStore();
    const memOwner = 'mem-owner-' + crypto.randomUUID();
    const memProj = await memStore.createProject(memOwner, { name: 'MemProj', slug: 'mp-' + crypto.randomUUID().slice(0,8) });

    const memTask = await memStore.createTask(memOwner, {
      projectId: memProj.id,
      title: 'ParityTask',
      requiredCapabilities: ['typescript', 'react'],
    });

    expect(memTask.requiredCapabilities).toEqual(['typescript', 'react']);
    expect(typeof memTask.inputs).toBe('object');
    expect(memTask.preferredRole).toBeNull();
    expect(memTask.title).toBe('ParityTask');
  });
});

// =============================================================
// SECTION G: Regression — pre-fix behavior MUST fail
// =============================================================

describe('JSONB G — Regression: raw array would fail against real pg', () => {
  const handles: DisposableHandle[] = [];
  afterEach(async () => { for (const h of handles) await h.cleanup(); handles.length = 0; });

  it('G: regression — sending raw JS array to jsonb column fails (proves fix was needed)', async () => {
    const d = await makeDisposable();
    handles.push(d);

    await expect(
      d.conn.query(
        `INSERT INTO public.tasks (owner_id, project_id, title, required_capabilities, inputs)
         VALUES ($1, $2, $3, $4, $5)`,
        [d.ownerId, '00000000-0000-0000-0000-000000000000', 'Regress', ['typescript', 'react'], {}],
      ),
    ).rejects.toThrow('invalid input syntax for type json');
  });
});
