// CHEF FACTORY — Gate 2 — AuthService regression tests (PHASE 4, GATE 2 BLOCKER REMEDIATION).
// Deterministic: the Supabase network seam is replaced by a mocked fetch; no real
// credentials are used. Proves the Bearer-token owner-resolution path (A–H).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.js';
import type { FactoryConfig } from '../db/config.js';

function makeConfig(overrides: Partial<FactoryConfig> = {}): FactoryConfig {
  return {
    supabaseUrl: 'https://dybyidtcyzgliupzzfhl.supabase.co',
    supabaseAnonKey: 'anon-test-key',
    dbPassword: 'x',
    dbHost: 'h',
    dbPort: 5432,
    dbUser: 'u',
    dbName: 'n',
    ownerEmail: null,
    ownerPassword: null,
    ...overrides,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function installFetchMock(routes: {
  user?: () => Response;
  owners?: (init?: RequestInit) => Response;
}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/auth/v1/user')) return routes.user ? routes.user() : json({ message: 'missing' }, 401);
    if (url.includes('/rest/v1/owners')) return routes.owners ? routes.owners(init) : json([]);
    return json({ message: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const USER_A = { id: 'owner-a', aud: 'authenticated', role: 'authenticated', email: 'a@example.com' };
const USER_B = { id: 'owner-b', aud: 'authenticated', role: 'authenticated', email: 'b@example.com' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuthService.verifyOwner (Bearer-token owner resolution)', () => {
  it('A — valid token resolves the active owner', async () => {
    installFetchMock({
      user: () => json(USER_A),
      owners: () => json([{ id: 'owner-a', email: 'a@example.com', status: 'active' }]),
    });
    const auth = new AuthService(makeConfig());
    const owner = await auth.verifyOwner('valid.jwt.token');
    expect(owner).toEqual({ id: 'owner-a', email: 'a@example.com' });
  });

  it('B — invalid token is DENIED', async () => {
    installFetchMock({ user: () => json({ message: 'Invalid JWT', code: 'invalid_claim' }, 401) });
    const auth = new AuthService(makeConfig());
    expect(await auth.verifyOwner('bogus.token')).toBeNull();
  });

  it('C — missing/empty token is DENIED', async () => {
    installFetchMock({ user: () => json(USER_A) });
    const auth = new AuthService(makeConfig());
    expect(await auth.verifyOwner('')).toBeNull();
  });

  it('D — a token resolves only its own owner (never another owner)', async () => {
    // The verified token is owner-b; PostgREST is queried with id=eq.owner-b under
    // RLS, so it can only ever return owner-b's row. verifyOwner must never
    // resolve to a different owner.
    installFetchMock({
      user: () => json(USER_B),
      owners: () => json([{ id: 'owner-b', email: 'b@example.com', status: 'active' }]),
    });
    const auth = new AuthService(makeConfig());
    const owner = await auth.verifyOwner('token-for-b');
    expect(owner?.id).toBe('owner-b');
    expect(owner?.id).not.toBe('owner-a');
  });

  it('E — owner ID cannot be spoofed (owners row id must match the verified JWT sub)', async () => {
    // getUser verifies the token as owner-a, but the owners row claims owner-b.
    installFetchMock({
      user: () => json(USER_A),
      owners: () => json([{ id: 'owner-b', email: 'b@example.com', status: 'active' }]),
    });
    const auth = new AuthService(makeConfig());
    expect(await auth.verifyOwner('valid.jwt.token')).toBeNull();
  });

  it('F — owner lookup carries ONLY the caller Bearer token (RLS sees auth.uid())', async () => {
    let ownersInit: RequestInit | undefined;
    let ownersUrl = '';
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/rest/v1/owners')) {
        ownersUrl = url;
        ownersInit = init;
        return json([{ id: 'owner-a', email: 'a@example.com', status: 'active' }]);
      }
      if (url.includes('/auth/v1/user')) return json(USER_A);
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fn);
    const auth = new AuthService(makeConfig());
    await auth.verifyOwner('valid.jwt.token');
    const headers = ownersInit?.headers as Record<string, string>;
    expect(ownersUrl).toContain('/rest/v1/owners');
    expect(ownersUrl).toContain('id=eq.owner-a');
    expect(headers['Authorization']).toBe('Bearer valid.jwt.token');
    expect(headers['apikey']).toBe('anon-test-key');
  });

  it('G — service_role is never used on the normal owner-resolution path', async () => {
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/v1/user')) return json(USER_A);
      if (url.includes('/rest/v1/owners')) return json([{ id: 'owner-a', email: 'a@example.com', status: 'active' }]);
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fn);
    const auth = new AuthService(makeConfig());
    await auth.verifyOwner('valid.jwt.token');
    for (const call of fn.mock.calls) {
      const headers = (call[1]?.headers ?? {}) as Record<string, string>;
      expect(headers['apikey']).toBe('anon-test-key');
      expect(headers['Authorization']).toBe('Bearer valid.jwt.token');
      expect(headers['Authorization']).not.toContain('service_role');
    }
  });

  it('H — inactive owner is DENIED (fail closed)', async () => {
    installFetchMock({
      user: () => json(USER_A),
      owners: () => json([{ id: 'owner-a', email: 'a@example.com', status: 'pending' }]),
    });
    const auth = new AuthService(makeConfig());
    expect(await auth.verifyOwner('valid.jwt.token')).toBeNull();
  });
});
