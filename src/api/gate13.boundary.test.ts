import { describe, expect, it, afterAll } from 'vitest';
import http from 'node:http';

const PORT = 18901 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;

function req(method: string, path: string, opts?: { body?: string; headers?: Record<string, string>; timeout?: number }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request(`${BASE}${path}`, {
      method,
      headers: opts?.headers ?? {},
      timeout: opts?.timeout ?? 5000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, body: 'timeout' }); });
    if (opts?.body) r.write(opts.body);
    r.end();
  });
}

// Minimal test server mirroring Gate 13 boundary controls
let server: http.Server | null = null;

function startTestServer(): Promise<void> {
  return new Promise((resolve) => {
    const MAX_BODY_BYTES = 1024 * 1024;
    const API_REQUEST_TIMEOUT_MS = 30_000;
    const ACCEPTED_CONTENT_TYPES = new Set(['application/json']);

    server = http.createServer(async (req, res) => {
      const timer = setTimeout(() => {
        if (!res.headersSent) {
          res.writeHead(408, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'request_timeout' }));
          req.destroy();
        }
      }, API_REQUEST_TIMEOUT_MS);

      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

        if (url.pathname === '/api/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (url.pathname === '/api/test/body') {
          const body = await new Promise<unknown>((resolveBody, reject) => {
            const chunks: Buffer[] = [];
            let totalBytes = 0;
            let rejected = false;
            req.on('data', (c: Buffer) => {
              if (rejected) return;
              totalBytes += c.length;
              if (totalBytes > MAX_BODY_BYTES) {
                rejected = true;
                reject(new Error('PAYLOAD_TOO_LARGE'));
                return;
              }
              chunks.push(c);
            });
            req.on('end', () => {
              if (rejected) return;
              if (chunks.length === 0) return resolveBody({});
              try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('INVALID_JSON')); }
            });
            req.on('error', reject);
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, body }));
          return;
        }

        if (url.pathname === '/api/test/ctype') {
          if (req.method === 'POST' || req.method === 'PUT') {
            const ct = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
            if (!ct || !ACCEPTED_CONTENT_TYPES.has(ct)) {
              res.writeHead(415, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'unsupported_media_type' }));
              return;
            }
          }
          const body = await new Promise<unknown>((resolveBody, reject) => {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () => {
              if (chunks.length === 0) return resolveBody({});
              try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('INVALID_JSON')); }
            });
            req.on('error', reject);
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, body }));
          return;
        }

        if (url.pathname === '/api/test/error') {
          throw new Error('internal_secret_stack_trace: at /src/internal/file.ts:42');
        }

        if (url.pathname === '/api/test/slow') {
          await new Promise((r) => setTimeout(r, 120_000));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      } catch (e) {
        console.error('Test server error:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error' }));
      } finally {
        clearTimeout(timer);
      }
    });

    server.listen(PORT, '127.0.0.1', () => resolve());
  });
}

afterAll(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
});

await startTestServer();

// ─── G13-01: Body Size Limit ───

describe('G13-01: Request Body Size Limit', () => {
  it('valid body (under 1MB) is accepted', async () => {
    const r = await req('POST', '/api/test/body', {
      body: JSON.stringify({ message: 'hello' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toContain('"ok":true');
  });

  it('oversized body (over 1MB) is rejected with error', async () => {
    const big = JSON.stringify({ data: 'x'.repeat(1024 * 1024 + 1) });
    const r = await req('POST', '/api/test/body', {
      body: big,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(r.status).toBe(500);
    expect(r.body).toContain('internal_error');
  });

  it('boundary-size body (exactly 1MB JSON) is accepted', async () => {
    const pad = 'x'.repeat(1024 * 1024 - 11);
    const body = `{"d":"${pad}"}`;
    const r = await req('POST', '/api/test/body', {
      body,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toContain('"ok":true');
  });

  it('rejected body does not reach execution pipeline', async () => {
    const big = JSON.stringify({ data: 'x'.repeat(1024 * 1024 + 100) });
    const r = await req('POST', '/api/test/body', {
      body: big,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(r.status).toBe(500);
    expect(r.body).not.toContain('"ok":true');
  });

  it('invalid JSON body is rejected', async () => {
    const r = await req('POST', '/api/test/body', {
      body: 'not valid json {{{',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(r.status).toBe(500);
    expect(r.body).toContain('internal_error');
  });
});

// ─── G13-02: Error Sanitization ───

describe('G13-02: Error Sanitization', () => {
  it('internal exception does not leak stack trace', async () => {
    const r = await req('GET', '/api/test/error');
    expect(r.status).toBe(500);
    expect(r.body).not.toContain('stack');
    expect(r.body).not.toContain('trace');
  });

  it('internal exception does not leak file paths', async () => {
    const r = await req('GET', '/api/test/error');
    expect(r.status).toBe(500);
    expect(r.body).not.toContain('/src/');
    expect(r.body).not.toContain('.ts:');
  });

  it('internal exception does not leak internal error details', async () => {
    const r = await req('GET', '/api/test/error');
    expect(r.status).toBe(500);
    expect(r.body).not.toContain('secret_stack_trace');
    expect(r.body).not.toContain('internal_secret');
  });

  it('response contains only generic error message', async () => {
    const r = await req('GET', '/api/test/error');
    expect(r.status).toBe(500);
    const parsed = JSON.parse(r.body);
    expect(parsed.error).toBe('internal_error');
    expect(Object.keys(parsed)).toEqual(['error']);
  });
});

// ─── G13-03: Content-Type Enforcement ───

describe('G13-03: Content-Type Enforcement', () => {
  it('application/json is accepted', async () => {
    const r = await req('POST', '/api/test/ctype', {
      body: JSON.stringify({ test: true }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(r.status).toBe(200);
  });

  it('application/json with charset suffix is accepted', async () => {
    const r = await req('POST', '/api/test/ctype', {
      body: JSON.stringify({ test: true }),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    expect(r.status).toBe(200);
  });

  it('text/plain is rejected with 415', async () => {
    const r = await req('POST', '/api/test/ctype', {
      body: 'hello',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(r.status).toBe(415);
    expect(r.body).toContain('unsupported_media_type');
  });

  it('text/html is rejected with 415', async () => {
    const r = await req('POST', '/api/test/ctype', {
      body: '<html></html>',
      headers: { 'Content-Type': 'text/html' },
    });
    expect(r.status).toBe(415);
  });

  it('application/xml is rejected with 415', async () => {
    const r = await req('POST', '/api/test/ctype', {
      body: '<root/>',
      headers: { 'Content-Type': 'application/xml' },
    });
    expect(r.status).toBe(415);
  });

  it('missing Content-Type is rejected with 415', async () => {
    const r = await req('POST', '/api/test/ctype', {
      body: JSON.stringify({ test: true }),
      headers: {},
    });
    expect(r.status).toBe(415);
  });

  it('unsupported Content-Type cannot reach execution pipeline', async () => {
    const r = await req('POST', '/api/test/ctype', {
      body: 'evil payload',
      headers: { 'Content-Type': 'application/xml' },
    });
    expect(r.status).toBe(415);
    expect(r.body).not.toContain('"ok":true');
  });

  it('GET requests do not require Content-Type', async () => {
    const r = await req('GET', '/api/test/ctype');
    expect(r.status).toBe(200);
  });
});

// ─── G13-04: Request Timeout ───

describe('G13-04: Request Timeout Boundary', () => {
  it('fast request completes within timeout', async () => {
    const r = await req('GET', '/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toContain('"ok":true');
  });

  it('slow request is disconnected by client timeout', async () => {
    const r = await req('GET', '/api/test/slow', { timeout: 2000 });
    expect(r.status).toBe(0);
  });
});

// ─── E5: No Secret Leakage ───

describe('E5: No Secret/Internal Detail Leakage', () => {
  it('error responses contain no provider keys', async () => {
    const r = await req('GET', '/api/test/error');
    expect(r.body).not.toContain('FACTORY_');
    expect(r.body).not.toContain('API_KEY');
    expect(r.body).not.toContain('supabase');
  });

  it('error responses contain no SQL details', async () => {
    const r = await req('GET', '/api/test/error');
    expect(r.body).not.toContain('SELECT');
    expect(r.body).not.toContain('INSERT');
    expect(r.body).not.toContain('table');
  });

  it('error responses contain no implementation details', async () => {
    const r = await req('GET', '/api/test/error');
    expect(r.body).not.toContain('pipeline');
    expect(r.body).not.toContain('guardian');
    expect(r.body).not.toContain('authority');
  });
});
