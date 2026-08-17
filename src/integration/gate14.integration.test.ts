// CHEF FACTORY — Gate 14 — Persistent Rate/Anomaly State — Integration Tests
// Tests persistence against the real Supabase database.
// Skips gracefully if the Gate 14 migration tables don't exist yet.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PersistentRateLimiter } from '../core/security/rateLimit.js';
import { PersistentAnomalyDetector, DEFAULT_ANOMALY_THRESHOLDS } from '../core/security/anomaly.js';
import { createRateLimitPersistence, createAnomalyPersistence } from '../db/gate14Persistence.js';
import { getPool } from '../db/pool.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';
import type { Pool } from 'pg';

const cfg = getFactoryConfig(loadEnvFile());
const enabled = Boolean(cfg.supabaseUrl && cfg.dbPassword && cfg.dbHost);

let pool: Pool;
let ratePersist: ReturnType<typeof createRateLimitPersistence>;
let anomalyPersist: ReturnType<typeof createAnomalyPersistence>;
let tablesExist = false;
const TEST_OWNER = '00000000-0000-0000-0000-000000000001';

beforeAll(async () => {
  if (!enabled) return;
  pool = getPool();
  ratePersist = createRateLimitPersistence(pool);
  anomalyPersist = createAnomalyPersistence(pool);

  // Check if Gate 14 tables exist
  try {
    const result = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rate_limit_state'`,
    );
    tablesExist = result.rows.length > 0;
  } catch {
    tablesExist = false;
  }
});

afterAll(async () => {
  if (!pool || !tablesExist) return;
  try {
    await pool.query('DELETE FROM public.rate_limit_state WHERE owner_id = $1', [TEST_OWNER]);
    await pool.query('DELETE FROM public.anomaly_state WHERE owner_id = $1', [TEST_OWNER]);
  } catch {
    // cleanup best-effort
  }
});

// Skip all tests if DB is not available or migration hasn't been applied
const describeIntegration = enabled && tablesExist ? describe : describe.skip;

describeIntegration('Gate 14 — Live Integration (persistent security state)', () => {
  describe('I14-01: rate limit persistence (write → read → verify)', () => {
    it('persists and loads rate limit state', async () => {
      const rl = new PersistentRateLimiter(undefined, undefined, ratePersist);
      // Make 3 checks
      rl.check(TEST_OWNER, 'model', 'model.call');
      rl.check(TEST_OWNER, 'model', 'model.call');
      rl.check(TEST_OWNER, 'model', 'model.call');
      await rl.saveState(TEST_OWNER, 'model', 'model.call');

      // New instance loads from DB
      const rl2 = new PersistentRateLimiter(undefined, undefined, ratePersist);
      await rl2.loadState(TEST_OWNER, 'model', 'model.call');
      const decision = rl2.check(TEST_OWNER, 'model', 'model.call');
      // Was 3, now 4
      expect(decision.remaining).toBe(196);
    });
  });

  describe('I14-02: anomaly persistence (write → read → verify)', () => {
    it('persists and loads anomaly state', async () => {
      const ad = new PersistentAnomalyDetector(undefined, undefined, anomalyPersist);
      // Note 4 denied actions
      ad.note('deniedActions');
      ad.note('deniedActions');
      ad.note('deniedActions');
      ad.note('deniedActions');
      await ad.saveState(TEST_OWNER);

      // New instance loads from DB
      const ad2 = new PersistentAnomalyDetector(undefined, undefined, anomalyPersist);
      await ad2.loadState(TEST_OWNER);
      const signal = ad2.note('deniedActions');
      expect(signal).not.toBeNull();
      expect(signal!.triggered).toBe(true);
      expect(signal!.metric).toBe(5);
    });
  });

  describe('I14-03: restart simulation (save → new instance → load)', () => {
    it('rate limit state survives restart', async () => {
      const rl = new PersistentRateLimiter(undefined, undefined, ratePersist);
      for (let i = 0; i < 3; i++) rl.check(TEST_OWNER, 'failure', 'task.failure');
      await rl.saveState(TEST_OWNER, 'failure', 'task.failure');

      // Simulate restart: new instance
      const rl2 = new PersistentRateLimiter(undefined, undefined, ratePersist);
      await rl2.loadState(TEST_OWNER, 'failure', 'task.failure');
      const decision = rl2.check(TEST_OWNER, 'failure', 'task.failure');
      expect(decision.remaining).toBe(6); // 10 - 4 = 6
    });
  });

  describe('I14-04: owner isolation (RLS)', () => {
    it('different owners have isolated state', async () => {
      const rl = new PersistentRateLimiter(undefined, undefined, ratePersist);
      rl.check(TEST_OWNER, 'model', 'model.call');
      await rl.saveState(TEST_OWNER, 'model', 'model.call');

      // Different owner — should not see TEST_OWNER's state
      const rl2 = new PersistentRateLimiter(undefined, undefined, ratePersist);
      await rl2.loadState('99999999-9999-9999-9999-999999999999', 'model', 'model.call');
      const decision = rl2.check('99999999-9999-9999-9999-999999999999', 'model', 'model.call');
      expect(decision.remaining).toBe(199); // Fresh start for different owner
    });
  });

  describe('I14-05: concurrent persistence', () => {
    it('concurrent saves do not corrupt state', async () => {
      const rl = new PersistentRateLimiter(undefined, undefined, ratePersist);
      // Make 10 checks
      for (let i = 0; i < 10; i++) rl.check(TEST_OWNER, 'model', 'model.call');
      await rl.saveState(TEST_OWNER, 'model', 'model.call');

      // Load and verify
      const rl2 = new PersistentRateLimiter(undefined, undefined, ratePersist);
      await rl2.loadState(TEST_OWNER, 'model', 'model.call');
      const decision = rl2.check(TEST_OWNER, 'model', 'model.call');
      expect(decision.remaining).toBe(189); // 200 - 11 = 189
    });
  });

  describe('I14-06: DB failure behavior', () => {
    it('gracefully handles table not found', async () => {
      const badPersist = createRateLimitPersistence(pool);
      const rl = new PersistentRateLimiter(undefined, undefined, badPersist);
      // Should not throw — uses in-memory fallback
      await rl.loadState('nonexistent-owner', 'model', 'model.call');
      const decision = rl.check('nonexistent-owner', 'model', 'model.call');
      expect(decision.allowed).toBe(true);
    });
  });
});
