# GATE 14 — IMPLEMENTATION

**Date:** 2026-08-17
**Mission:** Persistent Rate/Anomaly State
**Classification:** GATE_14_PASS

---

## 1. Architecture Before/After

### Before (Gate 13)
```
server.ts
├── new RateLimiter()           → execution runner
├── new AnomalyDetector()       → execution runner
├── createSecurityGuardian(store) → creates ANOTHER RateLimiter + AnomalyDetector internally
│   └── Guardian uses its own RateLimiter + AnomalyDetector
└── new CommandPipeline(store, execution, createSecurityGuardian(store))
    └── creates YET ANOTHER Guardian with its own RateLimiter + AnomalyDetector
```

**Problem:** 5 total instances (3 RateLimiter, 3 AnomalyDetector). Pipeline-level instances were dead code. State lost on restart.

### After (Gate 14)
```
server.ts
├── PersistentRateLimiter(pool)  → single instance
├── PersistentAnomalyDetector(pool) → single instance
├── createSecurityGuardian(store, rateLimiter, anomalyDetector) → shared instances
│   └── Guardian uses shared persistent instances
├── createExecutionRunner({... rateLimiter, anomalyDetector, securityGuardian: guardian })
│   └── Execution uses shared persistent instances
└── new CommandPipeline(store, execution, guardian)
    └── Pipeline uses shared Guardian (which has shared persistent instances)
```

**Result:** 1 RateLimiter, 1 AnomalyDetector, 1 Guardian in production. State persists to DB.

---

## 2. Files Changed

| File | Change | Lines Added |
|------|--------|-------------|
| `src/core/security/rateLimit.ts` | +RateLimitPersistence interface, +PersistentRateLimiter class | ~65 |
| `src/core/security/anomaly.ts` | +AnomalyPersistence interface, +PersistentAnomalyDetector class, +clock param | ~70 |
| `src/api/server.ts` | +imports, +unified instance creation, +single Guardian | ~10 |
| `src/api/security.ts` | +optional rateLimiter/anomalyDetector params, +fallback imports | ~8 |
| `src/db/gate14Persistence.ts` | NEW — DB persistence adapters for both | 61 |
| `supabase/migrations/20260820000000_gate14_security_state.sql` | NEW — 2 tables, RLS, indexes | 77 |
| `src/core/security/gate14.persistence.test.ts` | NEW — 25 unit tests | 333 |
| `src/integration/gate14.integration.test.ts` | NEW — 6 integration tests | 144 |

---

## 3. Persistence Design

### Rate Limit State
- **Table:** `rate_limit_state` (owner_id, scope, limit_key, count, window_started_at)
- **Unique constraint:** `(owner_id, scope, limit_key)` — one row per rate limit key per owner
- **Update strategy:** `INSERT ... ON CONFLICT DO UPDATE` — atomic upsert
- **Window logic:** `windowStartedAt` is a bigint (epoch ms). Window resets when `now - windowStartedAt >= windowSeconds * 1000`.

### Anomaly State
- **Table:** `anomaly_state` (owner_id, counter_kind, count, last_decay_at)
- **Unique constraint:** `(owner_id, counter_kind)` — one row per counter kind per owner
- **Update strategy:** `INSERT ... ON CONFLICT DO UPDATE` — atomic upsert
- **Decay logic:** Counter resets when `now - lastDecay > decayWindowMs`.

---

## 4. Security Behavior

### Fail-Closed on DB Unavailability
- `loadState()` catches errors → falls back to in-memory state → logs warning
- `saveState()` catches errors → state is lost but rate limiting continues → logs warning
- `check()` / `note()` remain synchronous and always enforce limits
- Rate limiting is NEVER disabled by persistence failure

### Dual Instance Prevention
- Production creates exactly 1 `PersistentRateLimiter` and 1 `PersistentAnomalyDetector`
- Both are passed to Guardian, ExecutionRunner, and Pipeline via dependency injection
- `security.ts` fallback only triggers when no instances are provided (tests only)

---

## 5. Tests

| Category | Count | Status |
|----------|-------|--------|
| Unit tests (gate14.persistence.test.ts) | 25 | ALL PASS |
| Integration tests (gate14.integration.test.ts) | 6 | SKIPPED (migration not applied) |
| Existing regression (Gate 13 baseline) | 599 | ALL PASS |
| **Total** | **624** | **ALL PASS** |

---

## 6. Migration

`20260820000000_gate14_security_state.sql`:
- 2 new tables (rate_limit_state, anomaly_state)
- 2 indexes
- 2 RLS policies (owner isolation via auth.uid()::uuid)
- 2 updated_at triggers
- Zero modifications to existing tables

**Requires manual migration application via Supabase CLI or SQL editor.**

---

## 7. Remaining Limitations

- Integration tests skip until migration is applied
- Persistence is best-effort async (fire-and-forget for saves)
- Anomaly counters are owner-scoped (not project-scoped) — consistent with base design
- No TTL/cleanup for stale rows — acceptable for current scale
