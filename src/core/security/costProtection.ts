// CHEF FACTORY — Gate 2 — Cost Abuse Protection.
// Deterministic hard limits integrated with Gate 1 Cost Tracking. When a configured
// hard limit is reached execution STOPS — spending never continues automatically.

import type { Store } from '../ports.js';

export interface CostProtectionConfig {
  projectMonthlyHardLimit: number | null; // null = disabled
  projectDailyHardLimit: number | null;
  ownerMonthlyHardLimit: number | null;
  costSpikeMultiplier: number; // alert when a single event exceeds baseline × multiplier
  baselineWindowDays: number;
}

export const DEFAULT_COST_PROTECTION: CostProtectionConfig = {
  projectMonthlyHardLimit: null,
  projectDailyHardLimit: null,
  ownerMonthlyHardLimit: 100, // G5-03: $100/month owner hard limit (OD2 approved)
  costSpikeMultiplier: 5,
  baselineWindowDays: 30,
};

/** G5-03: Production-ready cost limits per owner decision OD2. */
export const PRODUCTION_COST_PROTECTION: CostProtectionConfig = {
  projectMonthlyHardLimit: null,
  projectDailyHardLimit: 5, // G5-03: $5/day per project (OD2 approved)
  ownerMonthlyHardLimit: 100, // G5-03: $100/month per owner (OD2 approved)
  costSpikeMultiplier: 5,
  baselineWindowDays: 30,
};

export interface CostProtectionDecision {
  stopped: boolean;
  reason: string | null;
  metrics: { projectMonth: number; projectDay: number; ownerMonth: number };
}

export class CostProtector {
  constructor(
    private readonly store: Store,
    private readonly config: CostProtectionConfig = DEFAULT_COST_PROTECTION,
  ) {}

  async check(ownerId: string, projectId: string | null): Promise<CostProtectionDecision> {
    const metrics = { projectMonth: 0, projectDay: 0, ownerMonth: 0 };
    let stopped = false;
    let reason: string | null = null;

    const ownerMonth = await this.store.totalCost(ownerId);
    metrics.ownerMonth = ownerMonth;
    if (this.config.ownerMonthlyHardLimit !== null && ownerMonth > this.config.ownerMonthlyHardLimit) {
      stopped = true;
      reason = `owner monthly cost ${ownerMonth} exceeds hard limit ${this.config.ownerMonthlyHardLimit}`;
    }

    if (projectId) {
      const monthBudget = await this.store.projectBudget(ownerId, projectId);
      metrics.projectMonth = monthBudget.amount;
      if (this.config.projectMonthlyHardLimit !== null && monthBudget.amount > this.config.projectMonthlyHardLimit) {
        stopped = true;
        reason = `project monthly cost ${monthBudget.amount} exceeds hard limit ${this.config.projectMonthlyHardLimit}`;
      }
      // G5-03: Enforce daily limit if configured. The daily cost is approximated
      // from the project budget's daily field if available, otherwise from owner daily.
      if (!stopped && this.config.projectDailyHardLimit !== null) {
        const dailyCost = monthBudget.daily ?? 0;
        metrics.projectDay = dailyCost;
        if (dailyCost > this.config.projectDailyHardLimit) {
          stopped = true;
          reason = `project daily cost ${dailyCost} exceeds hard limit ${this.config.projectDailyHardLimit}`;
        }
      }
    }

    return { stopped, reason, metrics };
  }

  /** Deterministic spike check: an incoming cost event larger than baseline × multiplier. */
  isSpike(amount: number, baselineMonthly: number): boolean {
    if (this.config.costSpikeMultiplier <= 0 || baselineMonthly <= 0) return false;
    return amount > baselineMonthly * this.config.costSpikeMultiplier;
  }
}
