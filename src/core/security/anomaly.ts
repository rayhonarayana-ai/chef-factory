// CHEF FACTORY — Gate 2 — Anomaly Detection Foundation.
// Deterministic thresholds only — NO fabricated "AI intelligence". Advanced ML
// anomaly detection belongs to a future Gate. Signals drive Security Events.
// Gate 14: adds PersistentAnomalyDetector wrapper for DB-backed state.

import type { AnomalyCounters, AnomalySignal } from './types.js';

export interface AnomalyThresholds {
  repeatedDeniedActions: number;
  repeatedAuthFailures: number;
  repeatedPrivilegeRequests: number;
  abnormalProjectSwitches: number;
  abnormalEnvironmentEscalations: number;
  abnormalCostSpikes: number;
  unusualRetryBursts: number;
  unusualToolAnomalies: number;
  repeatedSecretAccessAttempts: number;
  repeatedPolicyViolations: number;
}

// Gate 14: Persistence adapter interface
export interface AnomalyPersistence {
  load(ownerId: string): Promise<{ counters: Record<string, number>; lastDecay: Record<string, number> } | null>;
  save(ownerId: string, counters: Record<string, number>, lastDecay: Record<string, number>): Promise<void>;
}

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  repeatedDeniedActions: 5,
  repeatedAuthFailures: 5,
  repeatedPrivilegeRequests: 3,
  abnormalProjectSwitches: 5,
  abnormalEnvironmentEscalations: 3,
  abnormalCostSpikes: 3,
  unusualRetryBursts: 5,
  unusualToolAnomalies: 3,
  repeatedSecretAccessAttempts: 3,
  repeatedPolicyViolations: 5,
};

export class AnomalyDetector {
  protected readonly counters: AnomalyCounters = {
    deniedActions: 0,
    authFailures: 0,
    privilegeRequests: 0,
    projectSwitches: 0,
    environmentEscalations: 0,
    costSpikes: 0,
    retryBursts: 0,
    toolAnomalies: 0,
    secretAccessAttempts: 0,
    policyViolations: 0,
  };

  /** G5-05: Timestamp of last decay cycle per counter. */
  protected readonly lastDecay: Map<keyof AnomalyCounters, number> = new Map();

  /** G5-05: Decay window in milliseconds. Counters reset after this window of inactivity. */
  protected readonly decayWindowMs: number;

  constructor(
    protected readonly thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
    decayWindowMs: number = 3_600_000, // 1 hour default
    protected readonly clock: () => number = Date.now,
  ) {
    this.decayWindowMs = decayWindowMs;
  }

  /** Record an observation; returns the signal when a threshold is crossed. */
  note(kind: keyof AnomalyCounters): AnomalySignal | null {
    // G5-05: Apply decay before incrementing
    this.applyDecay(kind);

    this.counters[kind] += 1;
    const metric = this.counters[kind];
    const threshold = this.thresholdFor(kind);
    if (metric >= threshold) {
      return {
        triggered: true,
        indicator: kind,
        metric,
        threshold,
        reason: `${kind} threshold reached (${metric}/${threshold})`,
      };
    }
    return null;
  }

  get countersSnapshot(): AnomalyCounters {
    return { ...this.counters };
  }

  get lastDecaySnapshot(): Map<keyof AnomalyCounters, number> {
    return new Map(this.lastDecay);
  }

  reset(): void {
    for (const k of Object.keys(this.counters) as (keyof AnomalyCounters)[]) {
      this.counters[k] = 0;
      this.lastDecay.delete(k);
    }
  }

  /** G5-05: Decay a specific counter if enough time has elapsed since last activity. */
  private applyDecay(kind: keyof AnomalyCounters): void {
    const now = this.clock();
    const last = this.lastDecay.get(kind);
    if (last !== undefined && now - last > this.decayWindowMs) {
      // Decay: reset counter to 0 after window of inactivity
      this.counters[kind] = 0;
    }
    this.lastDecay.set(kind, now);
  }

  private thresholdFor(kind: keyof AnomalyCounters): number {
    const map: Record<keyof AnomalyCounters, number> = {
      deniedActions: this.thresholds.repeatedDeniedActions,
      authFailures: this.thresholds.repeatedAuthFailures,
      privilegeRequests: this.thresholds.repeatedPrivilegeRequests,
      projectSwitches: this.thresholds.abnormalProjectSwitches,
      environmentEscalations: this.thresholds.abnormalEnvironmentEscalations,
      costSpikes: this.thresholds.abnormalCostSpikes,
      retryBursts: this.thresholds.unusualRetryBursts,
      toolAnomalies: this.thresholds.unusualToolAnomalies,
      secretAccessAttempts: this.thresholds.repeatedSecretAccessAttempts,
      policyViolations: this.thresholds.repeatedPolicyViolations,
    };
    return map[kind];
  }
}

// Gate 14: Persistent wrapper — adds DB-backed state to the in-memory AnomalyDetector.
// note() remains synchronous for backward compatibility.
// FAIL-CLOSED: persistence failure does NOT disable anomaly detection.
export class PersistentAnomalyDetector extends AnomalyDetector {

  constructor(
    thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
    decayWindowMs: number = 3_600_000,
    private readonly persistence?: AnomalyPersistence,
    clock: () => number = Date.now,
  ) {
    super(thresholds, decayWindowMs, clock);
  }

  /** Load persisted counters and decay state from DB into memory. */
  async loadState(ownerId: string): Promise<void> {
    if (!this.persistence) return;
    try {
      const persisted = await this.persistence.load(ownerId);
      if (persisted) {
        for (const [k, v] of Object.entries(persisted.counters)) {
          if (k in this.counters) {
            (this.counters as unknown as Record<string, number>)[k] = v;
          }
        }
        for (const [k, v] of Object.entries(persisted.lastDecay)) {
          if (k in this.counters) {
            this.lastDecay.set(k as keyof AnomalyCounters, v);
          }
        }
      }
    } catch {
      console.warn('[Gate 14] Anomaly persistence load failed — using in-memory fallback');
    }
  }

  /** Save current counters and decay state to persistence (observable failure). */
  async saveState(ownerId: string): Promise<void> {
    if (!this.persistence) return;
    try {
      const countersObj: Record<string, number> = {};
      for (const [k, v] of Object.entries(this.counters)) countersObj[k] = v;
      const decayObj: Record<string, number> = {};
      for (const [k, v] of this.lastDecay) decayObj[k] = v;
      await this.persistence.save(ownerId, countersObj, decayObj);
    } catch {
      console.warn('[Gate 14] Anomaly persistence save failed — using in-memory fallback');
    }
  }

  /** Note + persist. For use in async contexts where persistence is desired. */
  async notePersisted(ownerId: string, kind: keyof AnomalyCounters): Promise<AnomalySignal | null> {
    await this.loadState(ownerId);
    const signal = this.note(kind);
    this.saveState(ownerId).catch(() => { console.warn('[Gate 17] Anomaly persistence fire-and-forget failed'); });
    return signal;
  }
}
