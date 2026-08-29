// CHEF FACTORY — Gate 41 — Adaptive Workforce Worker Loop.
//
// Deterministic, DB-anchored polling worker. Doctrine (frozen by the Development Lead):
//   - Any real work resets backoff to ACTIVE_RECHECK.
//   - No work advances the idle progression (5s->10s->20s->40s->60s, MAX 60s).
//   - DB/transient error applies bounded exponential backoff.
//   - ±20% jitter de-phases multiple workers.
//   - Global EMERGENCY STOP + OWNER LOCKDOWN + BUDGET (owner/project/mission) are all
//     re-checked via runWorkforce; the worker also fails closed on the global stop itself.
//   - WORKER_LLM_CALLS_FOR_DISCOVERY = 0 — discovery is purely SQL.
//   - The worker never approves, grants permissions, changes budgets, creates tasks,
//     mutates missions, or commits/pushes. Its scheduling runs under the narrow
//     SYSTEM WORKFORCE identity for audit attribution only.
//   - Multi-worker safety relies on DB-atomic placement (placeTask) + claim-safe
//     execution (executeAssignedAgentTask); no process-memory locks as correctness.

import type { Store } from '../core/ports.js';
import type { ExecutionRunner } from '../core/pipeline.js';
import { runWorkforce, type WorkforceOrchestratorOutcome } from '../core/workforceOrchestrator.js';
import { isGlobalStopActive } from '../core/security/workforceControl.js';
import { WORKFORCE_SERVICE_ACTOR, WORKFORCE_SERVICE_ACTOR_TYPE, WORKFORCE_SERVICE_AUDIT_ACTOR_ID } from '../core/workforceService.js';
import { applyJitter, type WorkforceRuntimeConfig } from './config.js';

type Activity = 'work' | 'idle' | 'error';

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise) => {
    if (signal.aborted) return resolvePromise();
    const timer = setTimeout(resolvePromise, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolvePromise();
    }, { once: true });
  });
}

export interface WorkforceWorkerDeps {
  store: Store;
  execution: ExecutionRunner;
  config: WorkforceRuntimeConfig;
}

export class WorkforceWorker {
  #store: Store;
  #execution: ExecutionRunner;
  #config: WorkforceRuntimeConfig;

  #idleStep = 0;
  #errorFails = 0;
  #roundRobinOffset = 0;
  #lastStaleRecoveryAt = 0;
  #stopping = false;

  constructor(deps: WorkforceWorkerDeps) {
    this.#store = deps.store;
    this.#execution = deps.execution;
    this.#config = deps.config;
  }

  #audit(action: string, metadata: Record<string, unknown> = {}): Promise<void> {
    return this.#store.recordAudit({
      actorType: WORKFORCE_SERVICE_ACTOR_TYPE,
      actorId: WORKFORCE_SERVICE_AUDIT_ACTOR_ID,
      action,
      projectId: null,
      environmentId: null,
      resourceType: null,
      resourceId: null,
      authorizationResult: null,
      correlationId: null,
      taskId: null,
      metadata: { workerId: this.#config.workerId, workforceService: WORKFORCE_SERVICE_ACTOR, ...metadata },
    }).catch((e) => {
      console.warn(`[worker] audit persist failed for ${action}: ${e}`);
    });
  }

  #delayFor(activity: Activity): number {
    if (activity === 'work') {
      this.#idleStep = 0;
      this.#errorFails = 0;
      return applyJitter(this.#config.activeRecheckMs, this.#config.jitterRatio);
    }
    if (activity === 'error') {
      // Bounded exponential backoff: 2s, 4s, 8s, ... capped at maxIdle.
      const base = this.#config.activeRecheckMs * 2 ** this.#errorFails;
      this.#errorFails = Math.min(this.#errorFails + 1, 10);
      return applyJitter(Math.min(base, this.#config.maxIdleMs), this.#config.jitterRatio);
    }
    // idle: advance the progression.
    const progression = this.#config.idleProgressionMs.length > 0 ? this.#config.idleProgressionMs : [this.#config.firstIdleMs];
    const delay = progression[Math.min(this.#idleStep, progression.length - 1)] ?? this.#config.firstIdleMs;
    this.#idleStep = Math.min(this.#idleStep + 1, progression.length - 1);
    return applyJitter(delay, this.#config.jitterRatio);
  }

  #rollOwners(owners: string[]): string[] {
    if (owners.length <= 1) return owners;
    const offset = this.#roundRobinOffset % owners.length;
    this.#roundRobinOffset += 1;
    return [...owners.slice(offset), ...owners.slice(0, offset)];
  }

  /**
   * Run one orchestration cycle over a set of owners. Returns the aggregate activity
   * so the caller can select the next backoff.
   */
  async runCycle(): Promise<Activity> {
    await this.#audit('worker.cycle.started', { ts: Date.now() });

    // 1. Global emergency stop — FAIL CLOSED (missing row or read error => STOPPED).
    let control;
    try {
      control = await this.#store.getWorkforceControl();
    } catch (e) {
      await this.#audit('worker.error', { reason: 'global_control_read_failed', error: String(e) });
      return 'error';
    }
    if (isGlobalStopActive(control)) {
      await this.#audit('worker.global_stop', { reason: control?.reason ?? 'global emergency stop' });
      return 'idle';
    }

    // 2. Periodic stale RUNNING-task recovery (restart safety).
    const now = Date.now();
    if (now - this.#lastStaleRecoveryAt >= this.#config.staleRecoveryIntervalMs) {
      this.#lastStaleRecoveryAt = now;
      try {
        const staleBefore = new Date(now - 10 * 60 * 1000);
        const recovered = await this.#store.recoverStaleRunningTasks(staleBefore);
        if (recovered > 0) {
          await this.#audit('worker.recovery', { recovered, staleBefore: staleBefore.toISOString() });
        }
      } catch (e) {
        await this.#audit('worker.error', { reason: 'stale_recovery_failed', error: String(e) });
      }
    }

    // 3. Discovery — deterministic SQL, no LLM.
    let owners: string[];
    try {
      owners = await this.#store.listOwnersWithSchedulableWork({ limit: this.#config.maxOwnersPerCycle });
    } catch (e) {
      await this.#audit('worker.error', { reason: 'owner_discovery_failed', error: String(e) });
      return 'error';
    }
    if (owners.length === 0) {
      await this.#audit('worker.idle', { reason: 'no_schedulable_owners' });
      return 'idle';
    }

    // 4. Round-robin fairness across owners, bounded to maxOwnersPerCycle.
    const rotated = this.#rollOwners(owners);
    let anyWork = false;
    let stopEarly = false;

    for (const ownerId of rotated.slice(0, this.#config.maxOwnersPerCycle)) {
      if (this.#stopping) break;
      let result;
      try {
        result = await runWorkforce({
          store: this.#store,
          execution: this.#execution,
          ownerId,
          actorId: WORKFORCE_SERVICE_ACTOR,
          workforceService: true,
          workerId: this.#config.workerId,
          maxTasksPerRun: this.#config.maxTasksPerRun,
          maxParallelExecutions: this.#config.maxParallelExecutions,
        });
      } catch (e) {
        await this.#audit('worker.error', { ownerId, reason: 'run_workforce_threw', error: String(e) });
        anyWork = true; // treat as activity so we don't spin blindly; recheck soon
        continue;
      }

      const outcome: WorkforceOrchestratorOutcome = result.outcome;
      if (outcome === 'global_stopped') {
        await this.#audit('worker.global_stop', { ownerId, reason: 'global_emergency_stop_mid_cycle' });
        stopEarly = true;
        break;
      }
      if (outcome === 'aborted') {
        await this.#audit('worker.owner_lockdown', { ownerId });
        continue; // owner-scoped; other owners unaffected
      }
      if (outcome === 'budget_exhausted' || outcome === 'mission_budget_exhausted') {
        await this.#audit('worker.budget_block', { ownerId, outcome });
      }
      if (result.placed > 0 || result.executed > 0 || result.completed > 0 || result.failed > 0) {
        anyWork = true;
      }
    }

    const activity: Activity = stopEarly ? 'idle' : anyWork ? 'work' : 'idle';
    await this.#audit('worker.cycle.completed', { activity, owners: rotated.slice(0, this.#config.maxOwnersPerCycle).length });
    return activity;
  }

  /**
   * Run the adaptive loop until `signal` aborts. Handles the backoff state machine and
   * bounds each cycle's work. Returns when the signal is aborted.
   */
  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !this.#stopping) {
      let activity: Activity;
      try {
        activity = await this.runCycle();
      } catch (e) {
        await this.#audit('worker.error', { reason: 'cycle_threw', error: String(e) });
        activity = 'error';
      }
      const delay = this.#delayFor(activity);
      await this.#audit('worker.backoff', { activity, delayMs: delay, idleStep: this.#idleStep });
      await sleep(delay, signal);
    }
  }

  requestStop(): void {
    this.#stopping = true;
  }

  get isStopping(): boolean {
    return this.#stopping;
  }
}
