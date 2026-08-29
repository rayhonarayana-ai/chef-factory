// CHEF FACTORY — Gate 41 — Workforce Runtime Configuration.
//
// Frozen scheduling parameters from the Development Lead:
//   - ACTIVE_RECHECK = 2s
//   - FIRST_IDLE = 5s
//   - idle progression: 5s -> 10s -> 20s -> 40s -> 60s
//   - MAX_IDLE = 60s
//   - ±20% jitter to de-phase multiple worker processes
//   - Any actual work resets backoff to ACTIVE_RECHECK; no work increases backoff
//   - DB/transient error -> bounded exponential backoff
//   - All timers abortable for graceful shutdown (~30s drain default)
//
// Values may be overridden by environment variables (documented below). They are
// validated/clamped at runtime so a misconfigured env var cannot cause a busy loop or
// an unbounded batch.

import { hostname } from 'node:os';

export interface WorkforceRuntimeConfig {
  /** Delay (ms) between cycles when the previous cycle produced real work. */
  activeRecheckMs: number;
  /** First idle delay (ms). */
  firstIdleMs: number;
  /** Maximum idle delay (ms). */
  maxIdleMs: number;
  /** Progression of idle delays (ms). */
  idleProgressionMs: number[];
  /** Fractional jitter applied to every computed delay (0.2 == ±20%). */
  jitterRatio: number;
  /** Number of owners to fetch per discovery round (bounded). */
  maxOwnersPerCycle: number;
  /** Max tasks per runWorkforce pass. */
  maxTasksPerRun: number;
  /** Max parallel agent executions globally (per run) — gate37 hard max is 5. */
  maxParallelExecutions: number;
  /** How often the worker runs stale-RUNNING-task recovery (ms). */
  staleRecoveryIntervalMs: number;
  /** Grace period (ms) to finish the current cycle on shutdown. */
  drainGraceMs: number;
  /** Stable identity for this worker process (audit attribution). */
  workerId: string;
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/** Build + validate the workforce runtime configuration from the environment. */
export function getWorkforceRuntimeConfig(env: NodeJS.ProcessEnv = process.env): WorkforceRuntimeConfig {
  const firstIdleMs = Math.round(num(env['FACTORY_WORKER_FIRST_IDLE_MS'], 5000));
  const activeRecheckMs = Math.round(Math.min(num(env['FACTORY_WORKER_ACTIVE_RECHECK_MS'], 2000), firstIdleMs));
  const maxIdleMs = Math.round(Math.min(num(env['FACTORY_WORKER_MAX_IDLE_MS'], 60000), 60000));

  const idleProgressionMs = [5000, 10000, 20000, 40000, 60000]
    .map((v) => Math.min(v, maxIdleMs))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  const jitterRatio = Math.min(Math.max(Number(env['FACTORY_WORKER_JITTER'] ?? '0.2') || 0.2, 0), 0.5);

  const maxOwnersPerCycle = Math.max(1, Math.min(Math.round(num(env['FACTORY_WORKER_MAX_OWNERS_PER_CYCLE'], 8)), 200));
  const maxTasksPerRun = Math.max(1, Math.min(Math.round(num(env['FACTORY_WORKER_MAX_TASKS_PER_RUN'], 5)), 20));
  const maxParallelExecutions = Math.max(1, Math.min(Math.round(num(env['FACTORY_WORKER_MAX_PARALLEL_EXECUTIONS'], 5)), 5));

  const staleRecoveryIntervalMs = Math.round(Math.min(num(env['FACTORY_WORKER_STALE_RECOVERY_INTERVAL_MS'], 5 * 60 * 1000), 30 * 60 * 1000));
  const drainGraceMs = Math.round(num(env['FACTORY_WORKER_DRAIN_GRACE_MS'], 30_000));

  const workerId = (env['FACTORY_WORKER_ID']?.trim() || `${hostname()}-${process.pid}`).slice(0, 120);

  return {
    activeRecheckMs,
    firstIdleMs,
    maxIdleMs,
    idleProgressionMs,
    jitterRatio,
    maxOwnersPerCycle,
    maxTasksPerRun,
    maxParallelExecutions,
    staleRecoveryIntervalMs,
    drainGraceMs,
    workerId,
  };
}

/** Project a base delay through jitter (de-phases multiple workers). */
export function applyJitter(baseMs: number, ratio: number): number {
  const lo = baseMs * (1 - ratio);
  const hi = baseMs * (1 + ratio);
  return Math.max(1, Math.round(lo + Math.random() * (hi - lo)));
}
