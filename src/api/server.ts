// CHEF FACTORY — Gate 1 — Control Plane API server (minimal, no framework).
// Serves the mobile-friendly Control Plane UI and the /api/* JSON surface.
// Local binding by default; every API route is owner-authenticated.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFactoryConfig, assertFactoryConfig } from '../db/config.js';
import { getPool } from '../db/pool.js';
import { SupabaseStore } from '../db/repo.js';
import { AuthService } from './auth.js';
import { Api, type ApiRequest } from './handlers.js';
import { CommandPipeline } from '../core/pipeline.js';
import { ModelGateway } from '../gateways/modelGateway.js';
import { RuntimeGateway } from '../gateways/runtimeGateway.js';
import { createOpenAIAdapter } from '../gateways/adapters/openai.js';
import { createAnthropicAdapter } from '../gateways/adapters/anthropic.js';
import { createGoogleAdapter } from '../gateways/adapters/google.js';
import { createOpenCodeZenAdapter } from '../gateways/adapters/opencodeZen.js';
import { createResilientAdapter, DEFAULT_RESILIENCE_CONFIG } from '../gateways/resilience.js';
import { createExecutionRunner } from './execution.js';
import { createSecurityGuardian } from './security.js';
import { PersistentRateLimiter } from '../core/security/rateLimit.js';
import { PersistentAnomalyDetector } from '../core/security/anomaly.js';
import { createRateLimitPersistence, createAnomalyPersistence } from '../db/gate14Persistence.js';
import { getRedactor } from './redact.js';
import { handleStreamingChat } from './streaming.js';
import { startWorker } from '../runtime/worker.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', '..', 'public');
const PORT = Number(process.env['FACTORY_API_PORT'] ?? '8787');
const HOST = process.env['FACTORY_API_HOST'] ?? '127.0.0.1';

// Gate 13 — API boundary limits
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const API_REQUEST_TIMEOUT_MS = 30_000; // 30 seconds
const STREAMING_REQUEST_TIMEOUT_MS = 300_000; // 5 minutes for streaming
const ACCEPTED_CONTENT_TYPES = new Set(['application/json']);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

interface Route {
  method: string;
  path: string;
  pattern: RegExp;
  paramNames: string[];
  handler: (params: Record<string, string>) => string; // returns param key
}

const ROUTES: Route[] = (
  [
    ['GET', '/api/me'],
    ['POST', '/api/chat'],
    ['GET', '/api/projects'],
    ['POST', '/api/projects'],
    ['GET', '/api/passports/:projectId'],
    ['PUT', '/api/passports/:projectId'],
    ['GET', '/api/agents'],
    ['GET', '/api/tasks'],
    ['GET', '/api/approvals'],
    ['POST', '/api/approvals/:approvalId/decision'],
    ['GET', '/api/costs'],
    ['GET', '/api/audit'],
    ['GET', '/api/status'],
    ['GET', '/api/prefs'],
    ['PUT', '/api/prefs'],
    ['GET', '/api/models'],
    ['GET', '/api/runtimes'],
    ['GET', '/api/decisions'],
    ['GET', '/api/security/health'],
    ['GET', '/api/security/events'],
    ['GET', '/api/security/incidents'],
    ['POST', '/api/security/incidents'],
    ['GET', '/api/security/critical-actions'],
    ['GET', '/api/security/lockdown'],
    ['POST', '/api/security/lockdown'],
    ['POST', '/api/security/lockdown/release'],
    // Gate 3 — Conversation endpoints
    ['GET', '/api/conversations'],
    ['GET', '/api/conversations/:conversationId'],
    ['DELETE', '/api/conversations/:conversationId'],
    // Gate 44 — Mission Execution Engine (owner-scoped control plane surface)
    ['GET', '/api/missions'],
    ['GET', '/api/missions/:missionId'],
    ['POST', '/api/missions'],
    ['POST', '/api/missions/:missionId/plan'],
    ['POST', '/api/missions/:missionId/approve'],
    ['POST', '/api/missions/:missionId/materialize'],
    ['POST', '/api/missions/:missionId/reconcile'],
  ] as Array<[string, string]>
).map(([method, path]) => {
  const paramNames: string[] = [];
  const pattern = new RegExp(
    '^' +
      path
        .split('/')
        .map((seg) => {
          if (seg.startsWith(':')) {
            paramNames.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg;
        })
        .join('/') +
      '$',
  );
  return { method: method as string, path, pattern, paramNames, handler: () => '' };
});

function matchRoute(method: string, pathname: string): { route: (typeof ROUTES)[number]; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const m = pathname.match(route.pattern);
    if (m) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1]!)));
      return { route, params };
    }
  }
  return null;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
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
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function send(res: ServerResponse, status: number, body: unknown, contentType = 'application/json; charset=utf-8'): Promise<void> {
  const payload = contentType.startsWith('application/json') ? getRedactor().redact(JSON.stringify(body ?? {})) : (body as string);
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(payload);
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = normalize(resolve(PUBLIC_DIR, rel));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(target)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }
  const file = await readFile(target);
  res.writeHead(200, { 'Content-Type': MIME[extname(target)] ?? 'application/octet-stream' });
  res.end(file);
}

export async function startServer(opts?: { port?: number; host?: string }): Promise<{ close: () => Promise<void> }> {
  const cfg = getFactoryConfig();
  assertFactoryConfig(cfg);

  const pool = getPool();
  const store = new SupabaseStore(pool);
  const auth = new AuthService(cfg);

  // Gate 21: Recover stale RUNNING tasks from prior process crash.
  const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
  try {
    const staleBefore = new Date(Date.now() - STALE_THRESHOLD_MS);
    const recovered = await store.recoverStaleRunningTasks(staleBefore);
    if (recovered > 0) {
      console.log(`[Gate 21] Startup recovery: ${recovered} stale RUNNING task(s) transitioned to FAILED.`);
    }
  } catch (e) {
    console.warn(`[Gate 21] Startup recovery failed (non-fatal): ${e}`);
  }

  const modelGateway = new ModelGateway(
    new Map([
      ['openai', createResilientAdapter(createOpenAIAdapter({ apiKey: process.env['FACTORY_OPENAI_API_KEY'] }))],
      ['anthropic', createResilientAdapter(createAnthropicAdapter({ apiKey: process.env['FACTORY_ANTHROPIC_API_KEY'] }))],
      ['google', createResilientAdapter(createGoogleAdapter({ apiKey: process.env['FACTORY_GOOGLE_API_KEY'] }))],
    ]),
  );
  const runtimeGateway = new RuntimeGateway(
    new Map([
      ['opencode-zen', createOpenCodeZenAdapter({ cliPath: process.env['FACTORY_OPENCODE_CLI'], enabled: process.env['FACTORY_OPENCODE_ENABLED'] === 'true' })],
    ]),
  );

  // Gate 14: Single authoritative security state — one Guardian, one RateLimiter, one AnomalyDetector
  const rateLimiter = new PersistentRateLimiter(undefined, undefined, createRateLimitPersistence(pool));
  const anomalyDetector = new PersistentAnomalyDetector(undefined, undefined, createAnomalyPersistence(pool));
  const guardian = createSecurityGuardian(store, rateLimiter, anomalyDetector);

  const execution = createExecutionRunner({
    store,
    modelGateway,
    runtimeGateway,
    securityGuardian: guardian,
    rateLimiter,
    anomalyDetector,
    modelHealth: store,
  });
  const pipeline = new CommandPipeline(store, execution, guardian, rateLimiter, anomalyDetector);
  const api = new Api(store, auth, pipeline, execution);

  const server = createServer(async (req, res) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        send(res, 408, { error: 'request_timeout' });
        req.destroy();
      }
    }, API_REQUEST_TIMEOUT_MS);

    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = url.pathname;

      if (pathname === '/api/health') {
        return send(res, 200, { ok: true, service: 'chef-factory', time: new Date().toISOString() });
      }

      // Public client bootstrap config (anon key is public by design; never secrets).
      if (pathname === '/api/config') {
        return send(res, 200, { supabaseUrl: cfg.supabaseUrl, anonKey: cfg.supabaseAnonKey });
      }

      if (pathname.startsWith('/api/')) {
        const match = matchRoute(req.method ?? 'GET', pathname);
        if (!match) return send(res, 404, { error: 'route not found' });
        if (!req.headers.authorization?.startsWith('Bearer ')) return send(res, 401, { error: 'unauthorized' });
        const token = req.headers.authorization.slice('Bearer '.length);
        const owner = await auth.verifyOwner(token);
        if (!owner) return send(res, 401, { error: 'unauthorized' });

        // Gate 13 — Content-Type enforcement for POST/PUT
        if (req.method === 'POST' || req.method === 'PUT') {
          const ct = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
          if (!ct || !ACCEPTED_CONTENT_TYPES.has(ct)) {
            return send(res, 415, { error: 'unsupported_media_type' });
          }
        }

        const body = await readBody(req);

        // Gate 15 — Streaming chat: stream=true → SSE, stream=false/omitted → JSON
        if (pathname === '/api/chat' && req.method === 'POST') {
          const json = (body ?? {}) as Record<string, unknown>;
          const streamFlag = json['stream'] === true;
          const command = typeof json['command'] === 'string' ? json['command'] : '';
          if (!command.trim()) return send(res, 400, { error: 'command is required' });
          const conversationId = typeof json['conversation_id'] === 'string' ? json['conversation_id'] : null;

          if (streamFlag) {
            // Switch to streaming timeout
            clearTimeout(timer);
            const streamTimer = setTimeout(() => {
              if (!res.headersSent) {
                send(res, 408, { error: 'request_timeout' });
                req.destroy();
              }
            }, STREAMING_REQUEST_TIMEOUT_MS);

            try {
              await handleStreamingChat(req, res, store, pipeline, owner, command, conversationId);
            } catch (e) {
              console.error('CHEF FACTORY streaming error:', e);
              if (!res.headersSent) {
                await send(res, 500, { error: 'internal_error' });
              }
            } finally {
              clearTimeout(streamTimer);
            }
            return;
          }
        }

        const apiReq: ApiRequest = {
          method: req.method ?? 'GET',
          // Gate 44: pass the CANONICAL route path (the ROUTES literal with :param
          // placeholders), which is what the handlers dispatch on, together with the
          // already-extracted params. Passing the raw pathname here meant any
          // parameterized route (missions, passports, conversations, approvals
          // decision) could never reach its handler.
          path: match.route.path,
          params: match.params,
          body,
          owner,
          raw: req,
        };
        const result = await api.handle(apiReq);
        return send(res, result.status, result.json);
      }

      // static UI
      await serveStatic(req, res, pathname);
    } catch (e) {
      console.error('CHEF FACTORY API error:', e);
      await send(res, 500, { error: 'internal_error' });
    } finally {
      clearTimeout(timer);
    }
  });

  const port = opts?.port ?? PORT;
  const host = opts?.host ?? HOST;
  await new Promise<void>((resolveListen) => server.listen(port, host, resolveListen));
  console.log(`CHEF FACTORY Control Plane listening on http://${host}:${port}`);
  console.log('Public UI screens: CHEF Chat, Projects, Passport, Agents, Tasks, Approvals, Costs, Audit, Daily Status');

  // Gate 41: OPT-IN workforce worker autostart. OFF by default (no silent autostart).
  const workerHandle = process.env['FACTORY_WORKER_AUTOSTART'] === 'true'
    ? await startWorker()
    : null;

  return {
    close: () =>
      new Promise<void>((resolveClose) => {
        workerHandle?.stop();
        server.close(async () => {
          await pool.end().catch(() => undefined);
          resolveClose();
        });
      }),
  };
}

const isMain = process.argv[1] ? /server\.(ts|js)$/.test(process.argv[1]) : false;
if (isMain) {
  // Gate 21: Process lifecycle handlers.
  process.on('SIGTERM', () => {
    console.log('[Gate 21] SIGTERM received — shutting down gracefully.');
    process.exit(0);
  });
  process.on('SIGINT', () => {
    console.log('[Gate 21] SIGINT received — shutting down gracefully.');
    process.exit(0);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[Gate 21] Unhandled rejection (non-fatal):', reason);
  });

  startServer().catch((e) => {
    console.error(`CHEF FACTORY server failed to start: ${e.message}`);
    process.exit(1);
  });
}
