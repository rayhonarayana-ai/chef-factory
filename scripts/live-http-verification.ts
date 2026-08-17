// CHEF FACTORY — LIVE HTTP VERIFICATION RUNNER (GATE 2 closure).
// Runs ONLY when FACTORY_SERVICE_ROLE_KEY is present in the process environment.
// One disposable identity. Never prints/exposes any credential.
// Usage:  npx tsx scripts/live-http-verification.ts
// NEVER executed by default — it self-blocks when the key is absent.

import { randomUUID, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { getFactoryConfig, assertFactoryConfig } from '../src/db/config.js';
import { getPool } from '../src/db/pool.js';
import { startServer } from '../src/api/server.js';

const PASS = (name: string, detail: string) => console.log(`TEST ${name} = PASS (${detail})`);
const FAIL = (name: string, detail: string) => { console.log(`TEST ${name} = FAIL (${detail})`); return false; };

async function main(): Promise<void> {
  const present = Boolean(process.env['FACTORY_SERVICE_ROLE_KEY']);
  console.log(`SERVICE_ROLE_KEY_PRESENT=${present ? 'YES' : 'NO'}`);
  if (!present) {
    console.log('LIVE_VERIFICATION = BLOCKED — FACTORY_SERVICE_ROLE_KEY_MISSING');
    return;
  }

  const cfg = getFactoryConfig();
  assertFactoryConfig(cfg);
  const base = cfg.supabaseUrl;
  const anon = cfg.supabaseAnonKey;
  const key = process.env['FACTORY_SERVICE_ROLE_KEY'] as string;

  const password = randomBytes(18).toString('base64url');
  const email = `probe-live-${randomUUID()}@example.invalid`;

  const adminHeaders = { apikey: anon, 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  const anonJsonHeaders = { apikey: anon, 'Content-Type': 'application/json' };

  const jpost = async (url: string, headers: Record<string, string>, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const jget = async (url: string, headers: Record<string, string>) => {
    const res = await fetch(url, { method: 'GET', headers });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const jdelete = async (url: string, headers: Record<string, string>) => {
    const res = await fetch(url, { method: 'DELETE', headers });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  let server: { close: () => Promise<void> } | null = null;
  let ownerId: string | null = null;
  let accessToken: string | null = null;
  let results: { name: string; pass: boolean }[] = [];

  try {
    // 1. Create one disposable user (admin API).
    const created = await jpost(`${base}/auth/v1/admin/users`, adminHeaders, { email, password, email_confirm: true });
    if (created.status >= 400) throw new Error('admin user create failed: ' + created.status);
    const uid = String((created.json['id'] ?? ''));
    if (!uid) throw new Error('no user id returned');
    ownerId = uid;

    // 2. Password grant → real access token (kept in memory only).
    const grant = await jpost(`${base}/auth/v1/token?grant_type=password`, anonJsonHeaders, { email, password });
    if (grant.status >= 400) throw new Error('password grant failed: ' + grant.status);
    const token = String((grant.json['access_token'] ?? ''));
    if (!token) throw new Error('no access_token');
    accessToken = token;
    const bearer = { Authorization: `Bearer ${token}` };
    console.log('AUTHENTICATION_TEST = PASS (admin-create + password grant + real session)');

    // 3. Boot the REAL server.
    const port = Number(process.env['FACTORY_API_PORT'] ?? '18789');
    server = await startServer({ port, host: '127.0.0.1' });
    const api = `http://127.0.0.1:${port}`;

    const chat = async (command: string) => {
      const res = await fetch(`${api}/api/chat`, { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' }, body: JSON.stringify({ command }) });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };

    // T1 — HTTP → AUTH → OWNER RESOLUTION (GET /api/me).
    {
      const me = await jget(`${api}/api/me`, bearer);
      const ok = me.status === 200 && String((me.json as Record<string, unknown>)['id'] ?? '') === uid;
      results.push({ name: 'AUTH_OWNER_RESOLUTION', pass: ok });
      ok ? PASS('AUTH_OWNER_RESOLUTION', 'GET /api/me resolved the authenticated owner') : FAIL('AUTH_OWNER_RESOLUTION', `status=${me.status}`);
    }

    // T2 — create a project (RLS write as this owner).
    const projSlug = `probe-${randomUUID().slice(0, 8)}`;
    const projRes = await fetch(`${api}/api/projects`, { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'probe-live', slug: projSlug }) });
    const projJson = (await projRes.json()) as Record<string, unknown>;
    const projectId = String((((projJson['project'] ?? {}) as Record<string, unknown>)['id'] ?? ''));
    results.push({ name: 'RLS_WRITE_PROJECT', pass: projRes.status === 200 && projectId !== '' });
    (projRes.status === 200 && projectId !== '') ? PASS('RLS_WRITE_PROJECT', 'owner created its own project (RLS insert path)') : FAIL('RLS_WRITE_PROJECT', `status=${projRes.status}`);

    // T3 — authorized safe action reaches EXECUTION DECISION (guardian allows).
    {
      const r = await chat(`list tasks in ${projSlug}`);
      const outcome = String(r.json['outcome'] ?? '');
      const reached = ['executed', 'failed', 'retry_pending'].includes(outcome);
      const secDenied = outcome === 'denied' || outcome === 'blocked';
      const ok = r.status === 200 && reached && !secDenied;
      results.push({ name: 'AUTHORIZED_SAFE_EXECUTION', pass: ok });
      ok ? PASS('AUTHORIZED_SAFE_EXECUTION', `outcome=${outcome} — guardian allowed past policy into execution`) : FAIL('AUTHORIZED_SAFE_EXECUTION', `outcome=${outcome}`);
    }

    // T4 — critical action (financial) requires approval.
    {
      const r = await chat(`execute transfer 100 in ${projSlug}`);
      const outcome = String(r.json['outcome'] ?? '');
      const approvalId = r.json['approvalId'];
      const ok = r.status === 200 && outcome === 'waiting_approval' && Boolean(approvalId);
      results.push({ name: 'CRITICAL_REQUIRES_APPROVAL', pass: ok });
      ok ? PASS('CRITICAL_REQUIRES_APPROVAL', 'financial command held at waiting_approval') : FAIL('CRITICAL_REQUIRES_APPROVAL', `outcome=${outcome}`);
    }

    // T5 — fail-closed for unknown scope (deny-by-default).
    {
      const r = await chat('delete task in nonexistent-project-xyz');
      const outcome = String(r.json['outcome'] ?? '');
      const ok = r.status === 200 && ['unknown_project', 'denied', 'blocked'].includes(outcome);
      results.push({ name: 'DENY_FAIL_CLOSED', pass: ok });
      ok ? PASS('DENY_FAIL_CLOSED', `outcome=${outcome} — nothing executed`) : FAIL('DENY_FAIL_CLOSED', `outcome=${outcome}`);
    }

    // T6 — lockdown fail-closed over HTTP (owner activates, execution blocked).
    {
      const lockRes = await fetch(`${api}/api/security/lockdown`, { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'live http verification lockdown' }) });
      const lockJson = (await lockRes.json()) as Record<string, unknown>;
      const lockdownRec = ((lockJson['lockdown'] ?? {}) as Record<string, unknown>);
      const lockdownId = String(lockdownRec['lockdownId'] ?? '');
      const locked = lockRes.status === 200 && String(lockdownRec['status'] ?? '') === 'active' && lockdownId !== '';
      const r = await chat(`list tasks in ${projSlug}`);
      const outcome = String(r.json['outcome'] ?? '');
      const deniedByLockdown = outcome === 'denied';
      const r2 = await chat(`execute transfer 100 in ${projSlug}`);
      const deniedByLockdown2 = String(r2.json['outcome'] ?? '') === 'denied';
      const relRes = await fetch(`${api}/api/security/lockdown/release`, { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' }, body: JSON.stringify({ lockdownId, reason: 'live http verification release' }) });
      const released = relRes.status === 200;
      const ok = locked && deniedByLockdown && deniedByLockdown2 && released;
      results.push({ name: 'LOCKDOWN_FAIL_CLOSED', pass: ok });
      ok ? PASS('LOCKDOWN_FAIL_CLOSED', 'lockdown active → execution denied → released') : FAIL('LOCKDOWN_FAIL_CLOSED', `locked=${locked} denied=${deniedByLockdown} denied2=${deniedByLockdown2} released=${released}`);
    }

    // T7 — security event persistence (guardian events recorded, owner-scoped).
    {
      const events = await jget(`${api}/api/security/events`, bearer);
      const list = ((events.json['events'] ?? []) as Record<string, unknown>[]);
      const deniedEvents = list.filter((e) => String(e['eventType'] ?? '').startsWith('denied.') || String(e['eventType'] ?? '').startsWith('health.lockdown'));
      const ok = events.status === 200 && deniedEvents.length >= 2;
      results.push({ name: 'SECURITY_EVENT_PERSISTENCE', pass: ok });
      ok ? PASS('SECURITY_EVENT_PERSISTENCE', `${deniedEvents.length} guard deny/lockdown events persisted for this owner`) : FAIL('SECURITY_EVENT_PERSISTENCE', `count=${deniedEvents.length}`);
    }

    // T8 — retry protection: verify bounded attempts, no auto-loop on failure.
    {
      const r = await chat(`execute task in ${projSlug}`);
      const task = (r.json['task'] ?? null) as Record<string, unknown> | null;
      const attempts = Number(task?.['attempts'] ?? -1);
      const maxAttempts = Number(task?.['maxAttempts'] ?? 0);
      const ok = task !== null && attempts >= 1 && attempts <= maxAttempts && maxAttempts <= 3;
      results.push({ name: 'RETRY_BOUNDED', pass: ok });
      ok ? PASS('RETRY_BOUNDED', `attempts=${attempts}/${maxAttempts} — bounded, no auto-loop`) : FAIL('RETRY_BOUNDED', `attempts=${attempts}/${maxAttempts}`);
    }

    // T9 — project isolation (endpoints return ONLY this owner's rows).
    {
      const projects = await jget(`${api}/api/projects`, bearer);
      const list = ((projects.json['projects'] ?? []) as Record<string, unknown>[]);
      const ok = projects.status === 200 && list.every((p) => String(p['ownerId'] ?? '') === ownerId);
      results.push({ name: 'PROJECT_ISOLATION', pass: ok });
      ok ? PASS('PROJECT_ISOLATION', `${list.length} projects, all owner-scoped (RLS)`) : FAIL('PROJECT_ISOLATION', `count=${list.length}`);
    }

    console.log('ENVIRONMENT_ISOLATION = COVERED_ELSEWHERE (owner chat path cannot trigger agent env-escalation; deterministic securityGuardian.test.ts + RLS tests cover it)');

    const totalPass = results.filter((r) => r.pass).length;
    console.log(`HTTP_TESTS_PASSED=${totalPass}/${results.length}`);
    console.log(`LIVE_EXECUTION_BOUNDARY = ${totalPass === results.length ? 'VERIFIED' : 'UNVERIFIED'}`);
  } finally {
    // Cleanup — never expose credentials.
    if (ownerId) {
      try {
        const pool = getPool();
        // Purge owner-scoped rows (security rows are append-only for normal roles;
        // cleanup uses session_replication_role=replica to bypass the block triggers).
        await pool.query('begin');
        await pool.query("set local session_replication_role = 'replica'");
        await pool.query(`delete from public.owners where id = $1`, [ownerId]);
        await pool.query('commit');
      } catch { /* best effort */ }
      if (accessToken) {
        try {
          const del = await jdelete(`${base}/auth/v1/admin/users/${ownerId}`, adminHeaders);
          if (del.status >= 400) console.log(`CLEANUP_ADMIN_DELETE = FAIL (${del.status})`);
        } catch { /* best effort */ }
      }
    }
    if (server) await server.close();
  }

  // Final residue verification via a fresh pool (the server pool is already ended).
  try {
    const pool = new Pool({
      host: cfg.dbHost,
      port: cfg.dbPort,
      user: cfg.dbUser,
      password: cfg.dbPassword,
      database: cfg.dbName,
      max: 1,
      connectionTimeoutMillis: 30000,
      ssl: { rejectUnauthorized: false },
    });
    const probe = (await pool.query(`select (select count(*)::int from auth.users where email like 'probe-live-%@example.invalid') as users, (select count(*)::int from public.owners o join auth.users u on u.id=o.id where u.email like 'probe-live-%@example.invalid') as owners`)).rows[0];
    console.log(`TEST_RESIDUE users=${probe.users} owners=${probe.owners}`);
    await pool.end();
  } catch (e) {
    console.log('TEST_RESIDUE = UNKNOWN (' + String(e) + ')');
  }
}

main().then(
  () => process.exit(0),
  (e) => { console.error('RUNNER_ERROR=' + String(e)); process.exit(1); },
);
