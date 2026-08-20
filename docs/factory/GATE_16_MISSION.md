# GATE 16 — MISSION OPTIONS

> Classification: GATE_16_MISSION_OPTIONS
> Date: 2026-08-19
> Baseline: 687/687

## 1. Candidate Missions

### Mission A: Persistent Security State Fix (RECOMMENDED)

**Scope:** Restore the Gate 14 persistence guarantee by fixing 3 CRITICAL findings (C-02, C-03, C-04).

**Changes:**
1. `server.ts:209` — Pass `rateLimiter` and `anomalyDetector` to `CommandPipeline` constructor (1 line)
2. `pipeline.ts` — Make internal rate limit/anomaly calls use async persistent methods
3. `guardian.ts` — Switch from `check()` to `checkPersisted()` / `notePersisted()`
4. Tests — Verify DB-backed persistence in the production path

**Files modified:** ~3 production files, ~2 test files
**New files:** 0
**DB changes:** 0
**Expected tests:** 8-12 new (687 → 695-699)
**Risk:** LOW — persistence adapters already exist and are tested
**Security impact:** CRITICAL — restores rate limiting and anomaly persistence

### Mission B: Security Hardening Bundle

**Scope:** Address 4 security findings (S-CRIT-02, S-HIGH-01, S-HIGH-02, S-HIGH-03).

**Changes:**
1. Per-owner SSE connection concurrency limit (S-CRIT-02)
2. Security response headers (S-HIGH-01)
3. SSE error message sanitization (S-HIGH-02)
4. Conversation message redaction (S-HIGH-03)

**Files modified:** server.ts, streaming.ts, sse.ts, handlers.ts, conversation.ts
**Risk:** LOW — all changes are additive hardening
**Security impact:** HIGH — addresses 4 active security gaps

### Mission C: Provider Token Streaming

**Scope:** Implement true LLM token streaming via `ProviderAdapter.stream()`.

**Changes:**
1. Add `stream()` method to `ProviderAdapter` interface
2. Implement streaming HTTP in OpenAI and Anthropic adapters
3. Wire streaming adapter output through `execution.ts` to emit `delta` events
4. Extend `StreamingCallbacks` to support `delta` events

**Files modified:** providerAdapter.ts, openai.ts, anthropic.ts, execution.ts, pipeline.ts, streaming.ts
**Risk:** HIGH — touches core provider integration
**Business impact:** HIGH — enables real-time token streaming UX

### Mission D: Documentation Drift Repair

**Scope:** Update all stale documentation to reflect current state.

**Changes:**
1. ARCHITECTURE.md — Update test count, rule count, migration count, title
2. DATABASE.md — Update table count, migration count
3. SECURITY.md — Update policy count, rule count, title
4. Create CHEF_FACTORY_PHASES_MASTER_REFERENCE.md

**Files modified:** 3-4 doc files
**Risk:** NONE — documentation only
**Business impact:** LOW — but high value for maintainability

## 2. Recommendation

**Mission A: Persistent Security State Fix** is recommended as Gate 16.

### Rationale

1. **CRITICAL regression:** Gate 14 was authorized to deliver persistent rate/anomaly state. The current code has persistence adapters wired but the production code path never calls them. This undermines a previously-passed gate.

2. **Smallest scope:** Only 3 production files need modification. The persistence adapters already exist and are tested (25 Gate 14 tests pass).

3. **Lowest risk:** The fix is mechanical — switching synchronous calls to async persistent methods. No new architecture, no new interfaces.

4. **Security value:** Without this fix, rate limiting and anomaly detection reset on every server restart, allowing an attacker to exhaust limits, restart, and repeat.

5. **No DB changes required:** Tables already exist from Gate 14 migration.

### Why Not Mission B (Security Hardening)?
Important but can be addressed in Gate 17. The persistent state fix is a regression that must be fixed first.

### Why Not Mission C (Provider Streaming)?
Too large and complex for a single gate. Requires interface changes across 6+ files. Should be broken into sub-gates (interface definition → adapter implementation → pipeline wiring).

### Why Not Mission D (Documentation)?
Can be bundled into any mission as a secondary task. Not worth a gate on its own.

## 3. Scope Boundaries

### In Scope
- Fix C-02: Wire rateLimiter + anomalyDetector into CommandPipeline
- Fix C-03: Make PersistentRateLimiter check async
- Fix C-04: Make PersistentAnomalyDetector note async
- Verify existing 25 Gate 14 persistence tests still pass
- Add 8-12 new tests for production-path persistence

### Out of Scope
- Provider token streaming (deferred to Gate 17+)
- Security hardening bundle (deferred to Gate 17+)
- Documentation drift repair (deferred to Gate 17+)
- Memory/vector backend (deferred)
- Cross-provider failover (deferred)
- Database schema changes (FORBIDDEN unless explicitly approved)
