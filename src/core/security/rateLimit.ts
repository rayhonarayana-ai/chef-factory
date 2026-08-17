// CHEF FACTORY — Gate 2 — Rate Limiting / abuse protection foundation.
// Deterministic fixed-window counters with configurable limits. Prevents runaway
// execution. In-memory counters by default; config documents all defaults.
// Gate 14: adds PersistentRateLimiter wrapper for DB-backed state.

import type { RateLimitConfig, SecurityScopeKey } from './types.js';

export interface RateLimitState {
  count: number;
  windowStartedAt: number;
}

// Gate 14: Persistence adapter interface (optional dependency)
export interface RateLimitPersistence {
  load(ownerId: string, scope: string, limitKey: string): Promise<{ count: number; windowStartedAt: number } | null>;
  save(ownerId: string, scope: string, limitKey: string, state: { count: number; windowStartedAt: number }): Promise<void>;
}

export const DEFAULT_RATE_LIMITS: Omit<RateLimitConfig, 'id' | 'ownerId'>[] = [
  { scope: 'task', limitKey: 'task.execute', maxCount: 50, windowSeconds: 3600, enabled: true, version: 1 },
  { scope: 'tool', limitKey: 'tool.call', maxCount: 100, windowSeconds: 3600, enabled: true, version: 1 },
  { scope: 'runtime', limitKey: 'runtime.execute', maxCount: 20, windowSeconds: 3600, enabled: true, version: 1 },
  { scope: 'model', limitKey: 'model.call', maxCount: 200, windowSeconds: 3600, enabled: true, version: 1 },
  { scope: 'auth', limitKey: 'auth.failure', maxCount: 5, windowSeconds: 900, enabled: true, version: 1 },
  { scope: 'approval', limitKey: 'approval.request', maxCount: 20, windowSeconds: 3600, enabled: true, version: 1 },
  { scope: 'failure', limitKey: 'task.failure', maxCount: 10, windowSeconds: 3600, enabled: true, version: 1 },
  // G7-03: Dedicated data_query rate limits (separate from generic tool.call)
  { scope: 'data_query', limitKey: 'data_query.count', maxCount: 200, windowSeconds: 3600, enabled: true, version: 1 },
  { scope: 'data_query', limitKey: 'data_query_agg.count', maxCount: 50, windowSeconds: 3600, enabled: true, version: 1 },
];

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number | null;
  limit: number;
  windowMs: number;
}

export class RateLimiter {
  protected readonly windows = new Map<string, RateLimitState>();
  protected readonly configs = new Map<string, Omit<RateLimitConfig, 'id' | 'ownerId'>>();

  constructor(
    configs: Omit<RateLimitConfig, 'id' | 'ownerId'>[] = DEFAULT_RATE_LIMITS,
    protected readonly clock: () => number = Date.now,
  ) {
    for (const c of configs) this.configs.set(`${c.scope}:${c.limitKey}`, c);
  }

  setConfig(cfg: Omit<RateLimitConfig, 'id' | 'ownerId'>): void {
    this.configs.set(`${cfg.scope}:${cfg.limitKey}`, cfg);
  }

  getConfig(scope: SecurityScopeKey, limitKey: string): Omit<RateLimitConfig, 'id' | 'ownerId'> | null {
    return this.configs.get(`${scope}:${limitKey}`) ?? null;
  }

  /** Fixed-window check; returns false (deny) once the window limit is exhausted. */
  check(ownerId: string, scope: SecurityScopeKey, limitKey: string): RateLimitDecision {
    const cfg = this.configs.get(`${scope}:${limitKey}`);
    if (!cfg || !cfg.enabled) {
      return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterMs: null, limit: 0, windowMs: 0 };
    }
    const windowMs = cfg.windowSeconds * 1000;
    const key = `${ownerId}:${scope}:${limitKey}`;
    const now = this.clock();
    let state = this.windows.get(key);
    if (!state || now - state.windowStartedAt >= windowMs) {
      state = { count: 0, windowStartedAt: now };
      this.windows.set(key, state);
    }
    state.count += 1;
    if (state.count > cfg.maxCount) {
      const retryAfterMs = Math.max(0, windowMs - (now - state.windowStartedAt));
      return { allowed: false, remaining: 0, retryAfterMs, limit: cfg.maxCount, windowMs };
    }
    return { allowed: true, remaining: cfg.maxCount - state.count, retryAfterMs: null, limit: cfg.maxCount, windowMs };
  }

  /** Reset counters (used by tests / when config changes). */
  reset(): void {
    this.windows.clear();
  }
}

// Gate 14: Persistent wrapper — adds DB-backed state to the in-memory RateLimiter.
// check() remains synchronous for backward compatibility.
// Persistence is loaded via loadState() and saved via saveState() (async).
// FAIL-CLOSED: persistence failure does NOT disable rate limiting.
export class PersistentRateLimiter extends RateLimiter {
  private persistenceFailureLogged = false;

  constructor(
    configs: Omit<RateLimitConfig, 'id' | 'ownerId'>[] = DEFAULT_RATE_LIMITS,
    clock: () => number = Date.now,
    private readonly persistence?: RateLimitPersistence,
  ) {
    super(configs, clock);
  }

  /** Load persisted state for a given owner/scope/limitKey into in-memory map. */
  async loadState(ownerId: string, scope: SecurityScopeKey, limitKey: string): Promise<void> {
    if (!this.persistence) return;
    try {
      const persisted = await this.persistence.load(ownerId, scope, limitKey);
      if (persisted) {
        const key = `${ownerId}:${scope}:${limitKey}`;
        this.windows.set(key, { count: persisted.count, windowStartedAt: persisted.windowStartedAt });
      }
    } catch {
      if (!this.persistenceFailureLogged) {
        console.error('[Gate 14] Rate limit persistence load failed — using in-memory fallback');
        this.persistenceFailureLogged = true;
      }
    }
  }

  /** Save current in-memory state to persistence (best-effort, fire-and-forget). */
  async saveState(ownerId: string, scope: SecurityScopeKey, limitKey: string): Promise<void> {
    if (!this.persistence) return;
    const key = `${ownerId}:${scope}:${limitKey}`;
    const state = this.windows.get(key);
    if (!state) return;
    try {
      await this.persistence.save(ownerId, scope, limitKey, { count: state.count, windowStartedAt: state.windowStartedAt });
    } catch {
      if (!this.persistenceFailureLogged) {
        console.error('[Gate 14] Rate limit persistence save failed — using in-memory fallback');
        this.persistenceFailureLogged = true;
      }
    }
  }

  /** Check + persist. For use in async contexts where persistence is desired. */
  async checkPersisted(ownerId: string, scope: SecurityScopeKey, limitKey: string): Promise<RateLimitDecision> {
    await this.loadState(ownerId, scope, limitKey);
    const decision = this.check(ownerId, scope, limitKey);
    void this.saveState(ownerId, scope, limitKey);
    return decision;
  }
}
