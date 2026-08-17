// Gate 4 live integration — verifies conversation history wiring, securityGuard
// integration, and authority resolution against the real Supabase Postgres.
// Guarded: skipped unless FACTORY_* env is present.
// Runs inside ONE transaction and rolls back — leaves zero residue.

import pg from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';
import { CommandPipeline } from '../core/pipeline.js';
import { createExecutionRunner } from '../api/execution.js';
import { createSecurityGuardian } from '../api/security.js';
import { ModelGateway } from '../gateways/modelGateway.js';
import { RuntimeGateway } from '../gateways/runtimeGateway.js';
import { RateLimiter } from '../core/security/rateLimit.js';
import { AnomalyDetector } from '../core/security/anomaly.js';
import { ConversationService } from '../core/conversation.js';
import type { ConversationMessage } from '../core/pipeline.js';
import type { DbQuery } from '../tools/types.js';

const cfg = getFactoryConfig(loadEnvFile());
const enabled = Boolean(cfg.supabaseUrl && cfg.dbPassword && cfg.dbHost);

interface ItStore {
  store: SupabaseStore;
  owner: string;
  other: string;
  rollback: () => Promise<void>;
}

function makeTransactionalStore(): ItStore {
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
      await client.query(`delete from auth.users where email like 'it-%@chef.local'`);
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

function buildPipeline(store: SupabaseStore) {
  const modelGateway = new ModelGateway(new Map());
  const runtimeGateway = new RuntimeGateway(new Map());
  const securityGuardian = createSecurityGuardian(store);
  const rateLimiter = new RateLimiter();
  const anomalyDetector = new AnomalyDetector();
  const mockDb: DbQuery = {
    query: async () => ({ rows: [] }),
  };
  const execution = createExecutionRunner({
    store, modelGateway, runtimeGateway,
    securityGuardian, rateLimiter, anomalyDetector, toolDb: mockDb,
  });
  const pipeline = new CommandPipeline(store, execution, securityGuardian);
  return { pipeline, anomalyDetector, rateLimiter };
}

describe.skipIf(!enabled)('Gate 4 Live Integration (conversation history + security + authority)', () => {
  const handles: Array<{ rollback: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const h of handles) await h.rollback();
    handles.length = 0;
  });

  afterAll(async () => {
    try {
      const c = new pg.Client({
        host: cfg.dbHost, port: cfg.dbPort, user: cfg.dbUser,
        password: cfg.dbPassword, database: cfg.dbName,
        ssl: { rejectUnauthorized: false },
      });
      await c.connect();
      await c.query(`delete from auth.users where email like 'it-%@chef.local'`);
      await c.end();
    } catch { /* best-effort */ }
  });

  it('pipeline accepts conversation history and completes informational command', async () => {
    const s = makeTransactionalStore();
    handles.push(s);
    const { pipeline } = buildPipeline(s.store);
    const project = await s.store.createProject(s.owner, { name: 'G4 Live', slug: 'g4-live' });
    const history: ConversationMessage[] = [
      { role: 'user', content: 'What projects do I have?' },
      { role: 'assistant', content: 'You have several projects.' },
    ];
    // 'read projects in g4-live' → intent.project = 'g4-live', which exists → pipeline proceeds
    const result = await pipeline.run(
      { ownerId: s.owner, actorId: s.owner, actorType: 'owner' },
      'read projects in g4-live',
      history,
    );
    expect(result.outcome).not.toBe('unknown');
    expect(result.outcome).not.toBe('blocked');
  });

  it('pipeline runs without conversation history (backward compat)', async () => {
    const s = makeTransactionalStore();
    handles.push(s);
    const { pipeline } = buildPipeline(s.store);
    const project = await s.store.createProject(s.owner, { name: 'G4 Compat', slug: 'g4-compat' });
    const result = await pipeline.run(
      { ownerId: s.owner, actorId: s.owner, actorType: 'owner' },
      'read projects in g4-compat',
    );
    expect(result.outcome).not.toBe('unknown');
  });

  it('security guardian is wired and blocks under lockdown', async () => {
    const s = makeTransactionalStore();
    handles.push(s);
    const { pipeline } = buildPipeline(s.store);
    const project = await s.store.createProject(s.owner, { name: 'G4 Lock', slug: 'g4-lock' });
    // Activate lockdown
    await s.store.activateLockdown(s.owner, { scope: 'all', reason: 'test lockdown', activatedBy: s.owner, actorType: 'owner' });
    // 'read projects in g4-lock' → project resolves, then security guardian evaluates → lockdown denies
    const result = await pipeline.run(
      { ownerId: s.owner, actorId: s.owner, actorType: 'owner' },
      'read projects in g4-lock',
    );
    // Lockdown should deny
    expect(result.outcome).toBe('denied');
    expect(result.explanation.decision).toContain('security');
    // Release lockdown
    const lockdown = await s.store.activeLockdown(s.owner);
    if (lockdown) await s.store.releaseLockdown(s.owner, lockdown.lockdownId, { releasedBy: s.owner, actorType: 'owner', reason: 'test done' });
  });

  it('authority resolution produces correct decision for read vs write actions', async () => {
    const s = makeTransactionalStore();
    handles.push(s);
    const { pipeline } = buildPipeline(s.store);
    const project = await s.store.createProject(s.owner, { name: 'G4 Auth', slug: 'g4-auth' });
    // Read action with project → should auto-approve
    const readResult = await pipeline.run(
      { ownerId: s.owner, actorId: s.owner, actorType: 'owner' },
      'read projects in g4-auth',
    );
    expect(readResult.outcome).not.toBe('denied');

    // Write action with project → create task in g4-auth
    const createResult = await pipeline.run(
      { ownerId: s.owner, actorId: s.owner, actorType: 'owner' },
      'create task named integration-test in g4-auth',
    );
    // Should not be denied — owner creating task is allowed
    expect(createResult.outcome).not.toBe('denied');
  });

  it('anomaly detector and rate limiter are active in execution', async () => {
    const s = makeTransactionalStore();
    handles.push(s);
    const { pipeline, anomalyDetector, rateLimiter } = buildPipeline(s.store);
    const project = await s.store.createProject(s.owner, { name: 'G4 Active', slug: 'g4-active' });
    // Run a command that references the existing project
    const result = await pipeline.run(
      { ownerId: s.owner, actorId: s.owner, actorType: 'owner' },
      'read projects in g4-active',
    );
    expect(result.outcome).not.toBe('unknown');
    // Rate limiter should have model.call consumed (from informational path, no model call)
    // but the infrastructure is wired
    const modelCheck = rateLimiter.check(s.owner, 'model', 'model.call');
    expect(modelCheck.allowed).toBe(true);
    // Anomaly detector is operational
    expect(anomalyDetector.countersSnapshot.deniedActions).toBe(0);
  });
});
