// Live API integration — Gate 2 Security Guardian endpoints against real Supabase.
// Guarded: skipped unless FACTORY_* env is present. Transactional + rollback;
// afterAll purges `sec-api-%@chef.local` users (cascade removes residue).

import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';
import { Api, type ApiRequest } from '../api/handlers.js';
import type { SessionOwner } from '../api/auth.js';
import type { CommandPipeline, ExecutionRunner } from '../core/pipeline.js';

const cfg = getFactoryConfig(loadEnvFile());
const enabled = Boolean(cfg.supabaseUrl && cfg.dbPassword && cfg.dbHost);

describe.skipIf(!enabled)('Live security API integration (real Supabase Postgres, transactional)', () => {
  it('security endpoints respond end to end against the live schema', async () => {
    const client = new pg.Client({
      host: cfg.dbHost, port: cfg.dbPort, user: cfg.dbUser, password: cfg.dbPassword,
      database: cfg.dbName, ssl: { rejectUnauthorized: false },
    });
    let rollback: () => Promise<void> = async () => undefined;
    try {
      await client.connect();
      await client.query('begin');
      rollback = () => client.query('rollback').catch(() => undefined);
      await client.query(`delete from auth.users where email like 'sec-api-%@chef.local'`);
      const owner = crypto.randomUUID();
      await client.query(
        `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
         values ($1, 'authenticated', 'authenticated', $2, 'encrypted', now()) on conflict (id) do nothing`,
        [owner, `sec-api-${owner}@chef.local`],
      );
      const wrapper = {
        query: (t: string, p?: unknown[]) => client.query(t, p),
        connect: async () => ({ query: (t: string, p?: unknown[]) => client.query(t, p), release: () => undefined }),
      } as unknown as pg.Pool;
      const store = new SupabaseStore(wrapper);
      const api = new Api(store, {} as never, {} as CommandPipeline, {} as ExecutionRunner);
      const session: SessionOwner = { id: owner, email: `sec-api-${owner}@chef.local` };
      const call = (method: string, path: string, body?: unknown) =>
        api.handle({ method, path, params: {}, body: body ?? {}, owner: session, raw: {} as never } as ApiRequest);

      const health = await call('GET', '/api/security/health');
      expect(health.status).toBe(200);
      expect((health.json as { health: { status: string } }).health.status).toBe('healthy');

      const ca = await call('GET', '/api/security/critical-actions');
      expect(ca.status).toBe(200);
      expect((ca.json as { criticalActions: unknown[] }).criticalActions).toHaveLength(17);

      const ev = await call('GET', '/api/security/events');
      expect(ev.status).toBe(200);

      const created = await call('POST', '/api/security/incidents', { title: 'api live incident' });
      expect(created.status).toBe(200);
      const incidentId = (created.json as { incident: { incidentId: string } }).incident.incidentId;
      const listed = await call('GET', '/api/security/incidents');
      expect((listed.json as { incidents: Array<{ incidentId: string }> }).incidents.some((i) => i.incidentId === incidentId)).toBe(true);

      // validation: empty title → 400
      const badTitle = await call('POST', '/api/security/incidents', { title: '' });
      expect(badTitle.status).toBe(400);

      const activate = await call('POST', '/api/security/lockdown', { reason: 'live api emergency' });
      expect(activate.status).toBe(200);
      const active = await call('GET', '/api/security/lockdown');
      const lockdownId = (active.json as { lockdown: { lockdownId: string } }).lockdown.lockdownId;
      const release = await call('POST', '/api/security/lockdown/release', { lockdownId, reason: 'resolved' });
      expect(release.status).toBe(200);
      const gone = await call('GET', '/api/security/lockdown');
      expect((gone.json as { lockdown: unknown }).lockdown).toBeNull();

      // validation: missing reason / missing lockdownId → 400; unknown id → 404; unknown route → 404
      expect((await call('POST', '/api/security/lockdown', {})).status).toBe(400);
      expect((await call('POST', '/api/security/lockdown/release', { lockdownId, reason: '' })).status).toBe(400);
      expect((await call('POST', '/api/security/lockdown/release', { lockdownId: '00000000-0000-0000-0000-000000000000', reason: 'x' })).status).toBe(404);
      expect((await call('GET', '/api/security/nope')).status).toBe(404);
    } finally {
      await rollback();
      await client.end().catch(() => undefined);
    }
  });

  afterAll(async () => {
    try {
      const c = new pg.Client({
        host: cfg.dbHost, port: cfg.dbPort, user: cfg.dbUser, password: cfg.dbPassword,
        database: cfg.dbName, ssl: { rejectUnauthorized: false },
      });
      await c.connect();
      await c.query(`delete from auth.users where email like 'sec-api-%@chef.local'`);
      await c.end();
    } catch {
      // best-effort cleanup
    }
  });
});
