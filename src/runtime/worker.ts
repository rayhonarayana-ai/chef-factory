// CHEF FACTORY — Gate 41 — Standalone 24/7 Workforce Worker process.
//
// Separate process from the API server (doctrine: SEPARATE WORKER). Deterministic
// adaptive polling is driven by src/runtime/workerLoop.ts. This entry point:
//   - validates configuration
//   - builds the shared DB/store + the canonical execution runner (same pyramid as the
//     API server so tasks execute under the SAME SecurityGuardian/ToolBroker pipeline)
//   - recovers stale RUNNING tasks at startup (restart safety)
//   - wires SIGTERM/SIGINT graceful shutdown with a bounded drain
//   - audits worker.started / worker.stopped
//
// The worker NEVER autostarts the HTTP server and the server NEVER silently autostarts
// the worker. The worker is launched via `npm run worker` (or FACTORY_WORKER_AUTOSTART,
// an explicit opt-in, only from a supervised parent).

import { getFactoryConfig, assertFactoryConfig } from '../db/config.js';
import { getPool } from '../db/pool.js';
import { SupabaseStore } from '../db/repo.js';
import { ModelGateway } from '../gateways/modelGateway.js';
import { RuntimeGateway } from '../gateways/runtimeGateway.js';
import { createOpenAIAdapter } from '../gateways/adapters/openai.js';
import { createAnthropicAdapter } from '../gateways/adapters/anthropic.js';
import { createGoogleAdapter } from '../gateways/adapters/google.js';
import { createOpenCodeZenAdapter } from '../gateways/adapters/opencodeZen.js';
import { createResilientAdapter } from '../gateways/resilience.js';
import { createExecutionRunner } from '../api/execution.js';
import { createSecurityGuardian } from '../api/security.js';
import { PersistentRateLimiter } from '../core/security/rateLimit.js';
import { PersistentAnomalyDetector } from '../core/security/anomaly.js';
import { createRateLimitPersistence, createAnomalyPersistence } from '../db/gate14Persistence.js';
import { getWorkforceRuntimeConfig, type WorkforceRuntimeConfig } from './config.js';
import { WorkforceWorker } from './workerLoop.js';
import { WORKFORCE_SERVICE_ACTOR_TYPE, WORKFORCE_SERVICE_AUDIT_ACTOR_ID } from '../core/workforceService.js';

interface WorkerRuntime {
  config: WorkforceRuntimeConfig;
  store: SupabaseStore;
  worker: WorkforceWorker;
  controller: AbortController;
}

async function buildRuntime(): Promise<WorkerRuntime> {
  const cfg = getFactoryConfig();
  assertFactoryConfig(cfg);
  const envConfig = getWorkforceRuntimeConfig();
  const pool = getPool();
  const store = new SupabaseStore(pool);

  // Startup recovery — restart safety (Gate 21 semantics reused by the worker).
  try {
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
    const recovered = await store.recoverStaleRunningTasks(staleBefore);
    if (recovered > 0) {
      console.log(`[worker] startup recovery: ${recovered} stale RUNNING task(s) -> FAILED.`);
    }
  } catch (e) {
    console.warn(`[worker] startup recovery failed (non-fatal): ${e}`);
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

  const rateLimiter = new PersistentRateLimiter(undefined, undefined, createRateLimitPersistence(pool));
  const anomalyDetector = new PersistentAnomalyDetector(undefined, undefined, createAnomalyPersistence(pool));
  const guardian = createSecurityGuardian(store, rateLimiter, anomalyDetector);
  const execution = createExecutionRunner({ store, modelGateway, runtimeGateway, securityGuardian: guardian, rateLimiter, anomalyDetector });

  const worker = new WorkforceWorker({ store, execution, config: envConfig });
  const controller = new AbortController();
  return { config: envConfig, store, worker, controller };
}

export interface WorkerHandle {
  workerId: string;
  promise: Promise<void>;
  stop: () => void;
}

/**
 * Build + start a workforce worker. Used directly by `npm run worker` (CLI) and by the
 * API server's OPT-IN autostart path (FACTORY_WORKER_AUTOSTART=true). The worker never
 * silently autostarts — only an explicit opt-in flag may start it from the server.
 */
export async function startWorker(): Promise<WorkerHandle> {
  const runtime = await buildRuntime();
  const { worker, controller, config } = runtime;

  await runtime.store.recordAudit({
    actorType: WORKFORCE_SERVICE_ACTOR_TYPE,
    actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID,
    action: 'worker.started',
    projectId: null,
    environmentId: null,
    resourceType: null,
    resourceId: null,
    authorizationResult: null,
    correlationId: null,
    taskId: null,
    metadata: { workerId: config.workerId, activeRecheckMs: config.activeRecheckMs, maxIdleMs: config.maxIdleMs, maxOwnersPerCycle: config.maxOwnersPerCycle },
  }).catch((e) => console.warn(`[worker] audit start failed: ${e}`));

  console.log(`[worker] started id=${config.workerId} owners/cycle=${config.maxOwnersPerCycle} tasks/run=${config.maxTasksPerRun} idle=5s..60s`);

  const handle: WorkerHandle = {
    workerId: config.workerId,
    promise: Promise.resolve(),
    stop: () => {
      if (worker.isStopping) return;
      console.log(`[worker] stopping (drain <= ${config.drainGraceMs}ms)...`);
      worker.requestStop();
      controller.abort();
      const drainTimer = setTimeout(async () => {
        try {
          await runtime.store.recordAudit({
            actorType: WORKFORCE_SERVICE_ACTOR_TYPE,
            actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID,
            action: 'worker.stopped',
            projectId: null,
            environmentId: null,
            resourceType: null,
            resourceId: null,
            authorizationResult: null,
            correlationId: null,
            taskId: null,
            metadata: { workerId: config.workerId, signal: 'graceful' },
          });
        } catch {
          /* best-effort */
        }
      }, 0);
      drainTimer.unref();
    },
  };

  handle.promise = worker.run(controller.signal);
  return handle;
}

async function main(): Promise<void> {
  const handle = await startWorker();
  process.on('SIGTERM', () => handle.stop());
  process.on('SIGINT', () => handle.stop());
  await handle.promise;
}

const isMain = process.argv[1] ? /worker\.(ts|js)$/.test(process.argv[1]) : false;
if (isMain) {
  main().catch((e) => {
    console.error(`[worker] fatal startup/runtime error: ${e}`);
    void process.exit(1);
  });
}
