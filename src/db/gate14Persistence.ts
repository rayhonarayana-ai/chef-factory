// CHEF FACTORY — Gate 14 — Security state persistence adapters.
// Implements RateLimitPersistence and AnomalyPersistence using the Supabase/Postgres pool.
// FAIL-CLOSED: all methods catch errors and re-throw after logging.

import type { Pool } from 'pg';
import type { RateLimitPersistence } from '../core/security/rateLimit.js';
import type { AnomalyPersistence } from '../core/security/anomaly.js';

export function createRateLimitPersistence(pool: Pool): RateLimitPersistence {
  return {
    async load(ownerId: string, scope: string, limitKey: string) {
      const result = await pool.query(
        `SELECT count, window_started_at FROM public.rate_limit_state WHERE owner_id = $1 AND scope = $2 AND limit_key = $3`,
        [ownerId, scope, limitKey],
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return { count: row.count, windowStartedAt: row.window_started_at };
    },

    async save(ownerId: string, scope: string, limitKey: string, state) {
      await pool.query(
        `INSERT INTO public.rate_limit_state (owner_id, scope, limit_key, count, window_started_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (owner_id, scope, limit_key) DO UPDATE SET count = $4, window_started_at = $5`,
        [ownerId, scope, limitKey, state.count, state.windowStartedAt],
      );
    },
  };
}

export function createAnomalyPersistence(pool: Pool): AnomalyPersistence {
  return {
    async load(ownerId: string) {
      const result = await pool.query(
        `SELECT counter_kind, count, last_decay_at FROM public.anomaly_state WHERE owner_id = $1`,
        [ownerId],
      );
      if (result.rows.length === 0) return null;
      const counters: Record<string, number> = {};
      const lastDecay: Record<string, number> = {};
      for (const row of result.rows) {
        counters[row.counter_kind] = row.count;
        lastDecay[row.counter_kind] = row.last_decay_at;
      }
      return { counters, lastDecay };
    },

    async save(ownerId: string, counters: Record<string, number>, lastDecay: Record<string, number>) {
      const kinds = Object.keys(counters);
      for (const kind of kinds) {
        await pool.query(
          `INSERT INTO public.anomaly_state (owner_id, counter_kind, count, last_decay_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (owner_id, counter_kind) DO UPDATE SET count = $3, last_decay_at = $4`,
          [ownerId, kind, counters[kind] ?? 0, lastDecay[kind] ?? 0],
        );
      }
    },
  };
}
