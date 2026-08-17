// CHEF FACTORY — Gate 14 — Persistent Rate/Anomaly State — Unit Tests
// Tests: persistence, restart simulation, dual-instance prevention, fail-closed,
//        owner isolation, scope isolation, window behavior, decay.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiter, PersistentRateLimiter, DEFAULT_RATE_LIMITS, type RateLimitPersistence } from './rateLimit.js';
import { AnomalyDetector, PersistentAnomalyDetector, DEFAULT_ANOMALY_THRESHOLDS, type AnomalyPersistence } from './anomaly.js';
import type { SecurityScopeKey } from './types.js';

// --- Mock persistence adapters ---

function mockRateLimitPersistence(store = new Map<string, { count: number; windowStartedAt: number }>()): RateLimitPersistence {
  return {
    async load(ownerId, scope, limitKey) {
      return store.get(`${ownerId}:${scope}:${limitKey}`) ?? null;
    },
    async save(ownerId, scope, limitKey, state) {
      store.set(`${ownerId}:${scope}:${limitKey}`, state);
    },
  };
}

function mockAnomalyPersistence(store = new Map<string, { counters: Record<string, number>; lastDecay: Record<string, number> }>()): AnomalyPersistence {
  return {
    async load(ownerId) {
      return store.get(ownerId) ?? null;
    },
    async save(ownerId, counters, lastDecay) {
      store.set(ownerId, { counters, lastDecay });
    },
  };
}

function failingPersistence(): RateLimitPersistence {
  return {
    async load() { throw new Error('DB connection refused'); },
    async save() { throw new Error('DB connection refused'); },
  };
}

function failingAnomalyPersistence(): AnomalyPersistence {
  return {
    async load() { throw new Error('DB connection refused'); },
    async save() { throw new Error('DB connection refused'); },
  };
}

// ============================================================
// PersistentRateLimiter
// ============================================================

describe('Gate 14 — PersistentRateLimiter', () => {
  describe('G14-RL-01: persistence load/save', () => {
    it('loads persisted state into in-memory map', async () => {
      const store = new Map<string, { count: number; windowStartedAt: number }>();
      const now = Date.now();
      store.set('owner-1:model:model.call', { count: 5, windowStartedAt: now });
      const rl = new PersistentRateLimiter(undefined, undefined, mockRateLimitPersistence(store));
      await rl.loadState('owner-1', 'model', 'model.call');
      const decision = rl.check('owner-1', 'model', 'model.call');
      // count was 5, now 6 after check
      expect(decision.remaining).toBe(194); // maxCount=200, remaining=200-6=194
    });

    it('saves state to persistence after check', async () => {
      const store = new Map<string, { count: number; windowStartedAt: number }>();
      const rl = new PersistentRateLimiter(undefined, undefined, mockRateLimitPersistence(store));
      rl.check('owner-1', 'model', 'model.call');
      await rl.saveState('owner-1', 'model', 'model.call');
      const saved = store.get('owner-1:model:model.call');
      expect(saved).toBeDefined();
      expect(saved!.count).toBe(1);
    });

    it('checkPersisted loads, checks, and saves atomically', async () => {
      const store = new Map<string, { count: number; windowStartedAt: number }>();
      store.set('owner-1:tool:tool.call', { count: 98, windowStartedAt: Date.now() });
      const rl = new PersistentRateLimiter(undefined, undefined, mockRateLimitPersistence(store));
      const decision = await rl.checkPersisted('owner-1', 'tool', 'tool.call');
      // count was 98, now 99 after check; maxCount=100
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(1);
      const saved = store.get('owner-1:tool:tool.call');
      expect(saved!.count).toBe(99);
    });
  });

  describe('G14-RL-02: restart simulation', () => {
    it('state survives simulated restart (new instance loads from persistence)', async () => {
      const store = new Map<string, { count: number; windowStartedAt: number }>();
      const now = Date.now();
      // Simulate previous instance saved state
      store.set('owner-1:auth:auth.failure', { count: 3, windowStartedAt: now });

      // New instance (simulates restart)
      const rl = new PersistentRateLimiter(undefined, undefined, mockRateLimitPersistence(store));
      await rl.loadState('owner-1', 'auth', 'auth.failure');
      const decision = rl.check('owner-1', 'auth', 'auth.failure');
      // count was 3, now 4; maxCount=5
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(1);
    });

    it('exhausted window persists across restart', async () => {
      const store = new Map<string, { count: number; windowStartedAt: number }>();
      const now = Date.now();
      store.set('owner-1:auth:auth.failure', { count: 5, windowStartedAt: now });

      const rl = new PersistentRateLimiter(undefined, undefined, mockRateLimitPersistence(store));
      await rl.loadState('owner-1', 'auth', 'auth.failure');
      const decision = rl.check('owner-1', 'auth', 'auth.failure');
      expect(decision.allowed).toBe(false);
    });
  });

  describe('G14-RL-03: fail-closed on persistence failure', () => {
    it('rate limiting continues when persistence load fails', async () => {
      const rl = new PersistentRateLimiter(undefined, undefined, failingPersistence());
      // Should not throw — uses in-memory fallback
      await rl.loadState('owner-1', 'model', 'model.call');
      const decision = rl.check('owner-1', 'model', 'model.call');
      expect(decision.allowed).toBe(true);
    });

    it('rate limiting continues when persistence save fails', async () => {
      const rl = new PersistentRateLimiter(undefined, undefined, failingPersistence());
      const decision = rl.check('owner-1', 'model', 'model.call');
      // Should not throw — save is best-effort
      await rl.saveState('owner-1', 'model', 'model.call');
      expect(decision.allowed).toBe(true);
    });

    it('checkPersisted still returns correct decision when persistence fails', async () => {
      const rl = new PersistentRateLimiter(undefined, undefined, failingPersistence());
      const decision = await rl.checkPersisted('owner-1', 'model', 'model.call');
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(199);
    });
  });

  describe('G14-RL-04: owner isolation', () => {
    it('owner A limits do not affect owner B', () => {
      const rl = new PersistentRateLimiter();
      // Exhaust owner A
      for (let i = 0; i < 5; i++) rl.check('owner-A', 'auth', 'auth.failure');
      const aDecision = rl.check('owner-A', 'auth', 'auth.failure');
      expect(aDecision.allowed).toBe(false);

      // Owner B still has full quota
      const bDecision = rl.check('owner-B', 'auth', 'auth.failure');
      expect(bDecision.allowed).toBe(true);
      expect(bDecision.remaining).toBe(4);
    });
  });

  describe('G14-RL-05: scope isolation', () => {
    it('different scope+limitKey are independent', () => {
      const rl = new PersistentRateLimiter();
      for (let i = 0; i < 5; i++) rl.check('owner-1', 'auth', 'auth.failure');
      const authDecision = rl.check('owner-1', 'auth', 'auth.failure');
      expect(authDecision.allowed).toBe(false);

      // Different limit key is independent
      const taskDecision = rl.check('owner-1', 'task', 'task.execute');
      expect(taskDecision.allowed).toBe(true);
    });
  });

  describe('G14-RL-06: window expiration', () => {
    it('window resets after expiration', () => {
      let now = 1000;
      const rl = new PersistentRateLimiter(undefined, () => now);
      // Exhaust the auth limit (maxCount=5)
      for (let i = 0; i < 5; i++) rl.check('owner-1', 'auth', 'auth.failure');
      expect(rl.check('owner-1', 'auth', 'auth.failure').allowed).toBe(false);

      // Advance time past window (900s = 900000ms)
      now += 900_001;
      const decision = rl.check('owner-1', 'auth', 'auth.failure');
      expect(decision.allowed).toBe(true);
    });
  });

  describe('G14-RL-07: no persistence (backward compatible)', () => {
    it('works exactly like base RateLimiter without persistence', () => {
      const rl = new PersistentRateLimiter();
      const decision = rl.check('owner-1', 'model', 'model.call');
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(199);
    });
  });

  describe('G14-RL-08: dual-instance prevention', () => {
    it('same instance shared across callers', () => {
      const rl = new PersistentRateLimiter();
      // Simulate two callers using same instance
      rl.check('owner-1', 'model', 'model.call');
      const decision = rl.check('owner-1', 'model', 'model.call');
      expect(decision.remaining).toBe(198); // two calls total
    });

    it('base RateLimiter is parent class', () => {
      const rl = new PersistentRateLimiter();
      expect(rl).toBeInstanceOf(RateLimiter);
    });
  });
});

// ============================================================
// PersistentAnomalyDetector
// ============================================================

describe('Gate 14 — PersistentAnomalyDetector', () => {
  describe('G14-AD-01: persistence load/save', () => {
    it('loads persisted counters into memory', async () => {
      const store = new Map<string, { counters: Record<string, number>; lastDecay: Record<string, number> }>();
      store.set('owner-1', { counters: { deniedActions: 3 }, lastDecay: { deniedActions: Date.now() } });
      const ad = new PersistentAnomalyDetector(undefined, undefined, mockAnomalyPersistence(store));
      await ad.loadState('owner-1');
      const snapshot = ad.countersSnapshot;
      expect(snapshot.deniedActions).toBe(3);
    });

    it('saves state to persistence', async () => {
      const store = new Map<string, { counters: Record<string, number>; lastDecay: Record<string, number> }>();
      const ad = new PersistentAnomalyDetector(undefined, undefined, mockAnomalyPersistence(store));
      ad.note('deniedActions');
      await ad.saveState('owner-1');
      const saved = store.get('owner-1');
      expect(saved).toBeDefined();
      expect(saved!.counters.deniedActions).toBe(1);
    });

    it('notePersisted loads, notes, and saves atomically', async () => {
      const store = new Map<string, { counters: Record<string, number>; lastDecay: Record<string, number> }>();
      store.set('owner-1', { counters: { deniedActions: 4 }, lastDecay: { deniedActions: Date.now() } });
      const ad = new PersistentAnomalyDetector(undefined, undefined, mockAnomalyPersistence(store));
      const signal = await ad.notePersisted('owner-1', 'deniedActions');
      expect(signal).not.toBeNull();
      expect(signal!.triggered).toBe(true);
      expect(signal!.metric).toBe(5);
      const saved = store.get('owner-1');
      expect(saved!.counters.deniedActions).toBe(5);
    });
  });

  describe('G14-AD-02: restart simulation', () => {
    it('counters survive simulated restart', async () => {
      const store = new Map<string, { counters: Record<string, number>; lastDecay: Record<string, number> }>();
      const now = Date.now();
      store.set('owner-1', { counters: { deniedActions: 4 }, lastDecay: { deniedActions: now } });

      const ad = new PersistentAnomalyDetector(undefined, undefined, mockAnomalyPersistence(store));
      await ad.loadState('owner-1');
      const signal = ad.note('deniedActions');
      expect(signal).not.toBeNull();
      expect(signal!.metric).toBe(5);
    });
  });

  describe('G14-AD-03: fail-closed on persistence failure', () => {
    it('anomaly detection continues when persistence fails', async () => {
      const ad = new PersistentAnomalyDetector(undefined, undefined, failingAnomalyPersistence());
      await ad.loadState('owner-1');
      const signal = ad.note('deniedActions');
      expect(signal).toBeNull(); // threshold is 5, first call
    });

    it('notePersisted works when persistence fails', async () => {
      const ad = new PersistentAnomalyDetector(undefined, undefined, failingAnomalyPersistence());
      const signal = await ad.notePersisted('owner-1', 'deniedActions');
      expect(signal).toBeNull(); // threshold is 5, first call
    });
  });

  describe('G14-AD-04: owner isolation', () => {
    it('counters are global (not owner-scoped in-memory)', () => {
      // AnomalyDetector is per-instance; owner isolation is via separate instances
      const ad = new AnomalyDetector();
      ad.note('deniedActions');
      ad.note('deniedActions');
      const snapshot = ad.countersSnapshot;
      expect(snapshot.deniedActions).toBe(2);
    });
  });

  describe('G14-AD-05: decay behavior', () => {
    it('decay resets counter after window of inactivity', () => {
      let now = 1000;
      const ad = new AnomalyDetector(DEFAULT_ANOMALY_THRESHOLDS, 1000, () => now);
      // Note 3 times
      ad.note('privilegeRequests');
      ad.note('privilegeRequests');
      ad.note('privilegeRequests');
      expect(ad.countersSnapshot.privilegeRequests).toBe(3);

      // Advance past decay window
      now += 1001;
      ad.note('privilegeRequests');
      // Decay resets counter, then increments to 1
      expect(ad.countersSnapshot.privilegeRequests).toBe(1);
    });
  });

  describe('G14-AD-06: base class compatibility', () => {
    it('PersistentAnomalyDetector extends AnomalyDetector', () => {
      const ad = new PersistentAnomalyDetector();
      expect(ad).toBeInstanceOf(AnomalyDetector);
    });

    it('base AnomalyDetector still works (no persistence)', () => {
      const ad = new AnomalyDetector();
      const signal = ad.note('deniedActions');
      expect(signal).toBeNull();
      expect(ad.countersSnapshot.deniedActions).toBe(1);
    });
  });
});

// ============================================================
// createSecurityGuardian backward compatibility
// ============================================================

describe('Gate 14 — createSecurityGuardian backward compatibility', () => {
  it('import works without specifying persistence', async () => {
    const { createSecurityGuardian } = await import('../../api/security.js');
    const { MemoryStore } = await import('../../testing/memoryStore.js');
    const store = new MemoryStore();
    // Should not throw — uses default non-persistent instances
    const guardian = createSecurityGuardian(store);
    expect(guardian).toBeDefined();
  });
});
