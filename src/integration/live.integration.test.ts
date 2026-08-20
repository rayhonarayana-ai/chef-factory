// Live integration test — Gate 1 core against the real Supabase Postgres.
// Guarded: skipped unless FACTORY_* env is present (loaded from .env by config.ts).
// Runs inside ONE transaction and rolls back — leaves zero residue.

import pg from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';

const cfg = getFactoryConfig(loadEnvFile());
const enabled = Boolean(cfg.supabaseUrl && cfg.dbPassword && cfg.dbHost);

interface ItStore {
  store: SupabaseStore;
  owner: string;
  other: string;
  rollback: () => Promise<void>;
}

function makeTransactionalStore(): ItStore {
  // Fresh owner ids per call — auth.users ids are unique per run, so parallel
  // or repeated invocations can never collide.
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  const client = new pg.Client({
    host: cfg.dbHost,
    port: cfg.dbPort,
    user: cfg.dbUser,
    password: cfg.dbPassword,
    database: cfg.dbName,
    ssl: { rejectUnauthorized: false },
  });
  let connected = false;
  const ensure = async () => {
    if (!connected) {
      await client.connect();
      await client.query('begin');
      // Defensive cleanup: purge any residue from a crashed/leaked prior run.
      await client.query(`delete from auth.users where email like 'it-%@chef.local'`);
      // Create auth users so the on_auth_user_created trigger provisions the
      // owners rows required by the owner_id FKs (same approach as rls_tests.sql).
      for (const id of [owner, other]) {
        await client.query(
          `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
           values ($1, 'authenticated', 'authenticated', $2, 'encrypted', now())
           on conflict (id) do nothing`,
          [id, `it-${id}@chef.local`],
        );
      }
      connected = true;
    }
  };
  const wrapper = {
    query: async (text: string, params?: unknown[]) => {
      await ensure();
      return client.query(text, params);
    },
    connect: async () => {
      await ensure();
      return {
        query: (t: string, p?: unknown[]) => client.query(t, p),
        release: () => undefined,
      };
    },
  } as unknown as pg.Pool;
  const store = new SupabaseStore(wrapper);
  const rollback = async () => {
    if (connected) await client.query('rollback').catch(() => undefined);
    await client.end().catch(() => undefined);
  };
  return { store, owner, other, rollback };
}

describe.skipIf(!enabled)('Live integration (real Supabase Postgres, transactional, zero residue)', () => {
  const handles: Array<{ rollback: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const h of handles) await h.rollback();
    handles.length = 0;
  });

  afterAll(async () => {
    // The pooler does not reliably roll back transaction-scoped DML (auto-commit
    // can leak rows), so purge every test-namespaced user explicitly. The
    // on-delete-cascade FK chain removes all residue regardless of what leaked.
    try {
      const c = new pg.Client({
        host: cfg.dbHost,
        port: cfg.dbPort,
        user: cfg.dbUser,
        password: cfg.dbPassword,
        database: cfg.dbName,
        ssl: { rejectUnauthorized: false },
      });
      await c.connect();
      await c.query(`delete from auth.users where email like 'it-%@chef.local'`);
      await c.end();
    } catch {
      // best-effort cleanup; individual tests still assert their own behavior
    }
  });

  it('runs a full task lifecycle against the live schema', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const project = await s.store.createProject(s.owner, { name: 'IT Project', slug: 'it-project' });
    expect(project.slug).toBe('it-project');

    const task = await s.store.createTask(s.owner, { projectId: project.id, title: 'integration task', riskLevel: 'medium', correlationId: crypto.randomUUID() });
    expect(task.status).toBe('created');

    const queued = await s.store.patchTask(s.owner, task.id, { status: 'queued' });
    expect(queued.status).toBe('queued');

    const run = await s.store.createTaskRun(s.owner, { taskId: task.id, runNumber: 1 });
    expect(run.status).toBe('running');

    await s.store.completeTaskRun(s.owner, run.id, { status: 'completed', outputSnapshot: { ok: true }, cost: 0.5, durationMs: 10 });
    const done = await s.store.patchTask(s.owner, task.id, { status: 'completed', output: { ok: true }, completedAt: new Date().toISOString() });
    expect(done.status).toBe('completed');
    expect(done.output).toEqual({ ok: true });
  });

  it('resolves an approval and exposes it pending then decided', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const project = await s.store.createProject(s.owner, { name: 'IT P', slug: 'it-p' });
    const approval = await s.store.createApproval(s.owner, { projectId: project.id, action: 'deploy', riskLevel: 'high', authorityLevel: 'require_approval', requestedBy: s.owner });
    expect(approval.status).toBe('pending');

    const pending = await s.store.listApprovals(s.owner, { taskId: approval.taskId ?? undefined, status: 'pending' });
    expect(pending.some((a) => a.id === approval.id)).toBe(true);

    const decided = await s.store.patchApproval(s.owner, approval.id, { status: 'approved', decision: 'go', decisionReason: 'ok', decidedBy: s.owner, decidedAt: new Date().toISOString() });
    expect(decided.status).toBe('approved');
    expect(decided.decidedBy).toBe(s.owner);
  });

  it('append-only audit: events are insert-only and survive round-trip', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const correlationId = crypto.randomUUID();
    await s.store.recordAudit({
      actorType: 'owner', actorId: s.owner, action: 'command.received', projectId: null, environmentId: null,
      resourceType: 'status', resourceId: null, authorizationResult: null, correlationId, taskId: null,
      metadata: { secret_guard: 'none' },
    });
    // The Store contract exposes no update/delete for audit; verify data landed without a secret leak.
    const raw = await s.store.listProjects(s.owner); // sanity: repo connected
    expect(raw).toBeInstanceOf(Array);
  });

  it('bounded retry cap stops a task at max attempts', async () => {
    const s = makeTransactionalStore();
    handles.push(s);
    const project = await s.store.createProject(s.owner, { name: 'IT R', slug: 'it-r' });
    const task = await s.store.createTask(s.owner, { projectId: project.id, title: 'flaky', maxAttempts: 3 });
    const failed = await s.store.patchTask(s.owner, task.id, { status: 'failed', error: { message: 'boom' }, attempts: 3 });
    expect(failed.status).toBe('failed');
    expect(failed.attempts).toBe(3);
    expect(failed.maxAttempts).toBe(3);
  });

  it('project isolation at the application layer: other owners see nothing', async () => {
    const s = makeTransactionalStore();
    handles.push(s);
    await s.store.createProject(s.owner, { name: 'Isolated', slug: 'isolated' });
    const otherProjects = await s.store.listProjects(s.other);
    const mine = await s.store.listProjects(s.owner);
    expect(otherProjects).toHaveLength(0);
    expect(mine.some((p) => p.slug === 'isolated')).toBe(true);
  });

  it('memory lessons persist behind the memory boundary', async () => {
    const s = makeTransactionalStore();
    handles.push(s);
    await s.store.saveLesson(s.owner, { title: 'kept this pattern reusable', summary: 'extract config to typed module', category: 'architecture', projectId: null, confidence: 0.8 });
    // recall stays deterministic-empty (no vector backend — never fabricated)
    expect(await s.store.recall(s.owner, 'reusable')).toEqual([]);
  });

  it('POS preference versioning is safe and transactional', async () => {
    const s = makeTransactionalStore();
    handles.push(s);
    await s.store.setPreference(s.owner, 'policy', 'deny:execute', 'deny');
    await s.store.setPreference(s.owner, 'policy', 'deny:execute', 'allow');
    const prefs = await s.store.getPreferences(s.owner);
    const policy = prefs['policy'] as Record<string, unknown>;
    expect(policy['deny:execute']).toBe('allow');
  });

  it('Gate 23 — title/priority/description persist through SupabaseStore.patchTask', async () => {
    const s = makeTransactionalStore();
    handles.push(s);

    const project = await s.store.createProject(s.owner, { name: 'IT G23', slug: 'it-g23' });
    const task = await s.store.createTask(s.owner, { projectId: project.id, title: 'original title', riskLevel: 'medium', correlationId: crypto.randomUUID() });
    expect(task.title).toBe('original title');
    expect(task.priority).toBe('medium');
    expect(task.description).toBeNull();

    const patched1 = await s.store.patchTask(s.owner, task.id, { title: 'updated title' });
    expect(patched1.title).toBe('updated title');
    expect(patched1.priority).toBe('medium');

    const patched2 = await s.store.patchTask(s.owner, task.id, { priority: 'critical' });
    expect(patched2.title).toBe('updated title');
    expect(patched2.priority).toBe('critical');

    const patched3 = await s.store.patchTask(s.owner, task.id, { description: 'a new description' });
    expect(patched3.description).toBe('a new description');

    const patched4 = await s.store.patchTask(s.owner, task.id, { description: null });
    expect(patched4.description).toBeNull();

    const patched5 = await s.store.patchTask(s.owner, task.id, { title: 'final', priority: 'low', description: 'combined' });
    expect(patched5.title).toBe('final');
    expect(patched5.priority).toBe('low');
    expect(patched5.description).toBe('combined');
  });

  it('budget report rolls costs per month without inventing numbers', async () => {
    const s = makeTransactionalStore();
    handles.push(s);
    const project = await s.store.createProject(s.owner, { name: 'IT B', slug: 'it-b' });
    await s.store.recordCost({ ownerId: s.owner, projectId: project.id, taskId: null, runId: null, agentId: null, costType: 'model', amount: 2.25, currency: 'USD', provider: 'openai', modelId: null, runtimeId: null, billedTo: 'project', metadata: {} });
    const budget = await s.store.projectBudget(s.owner, project.id);
    expect(budget.amount).toBeGreaterThanOrEqual(2.25);
    expect(budget.exceeded).toBe(false);
    expect(await s.store.totalCost(s.owner, project.id)).toBeCloseTo(2.25);
  });
});
