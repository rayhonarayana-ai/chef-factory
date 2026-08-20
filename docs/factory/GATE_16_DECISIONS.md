# GATE 16 — DECISIONS

> Classification: GATE_16_DECISIONS
> Date: 2026-08-19

## 1. Owner Decisions Required

| OD-ID | Question | Recommendation | Alternatives | Risk of Delay |
|-------|----------|---------------|-------------|---------------|
| OD20 | Approve Persistent Security State Fix as Gate 16 mission? | Yes | Provider streaming, Security hardening, Documentation drift | Rate limits and anomaly detection remain non-persistent |
| OD21 | Initialize git repository (OD8/OD19 carried)? | Deferred | Initialize now | None — purely operational |

## 2. Technical Decisions

| TD-ID | Decision | Rationale | Alternatives Considered |
|-------|----------|-----------|------------------------|
| TD-G16-01 | Make rateLimiter/anomalyDetector mandatory in CommandPipeline constructor | Eliminates the "undefined guard" pattern that silently skips security checks | Keep optional and fix callers — rejected because it preserves the architectural weakness |
| TD-G16-02 | Use `checkPersisted()` instead of making `check()` async | Minimal change to existing code — only guardian.ts needs to change | Make `check()` async — rejected because it changes the RateLimiter interface and breaks all callers |
| TD-G16-03 | Keep rate limit/anomaly persistence as "best-effort" (fail to in-memory) | Existing behavior is correct — DB failure should not disable security | Make it fail-closed (refuse requests on DB failure) — rejected because availability > persistence for rate limits |
| TD-G16-04 | Do not add new DB tables or migrations | All persistence infrastructure already exists from Gate 14 | Add new tables — rejected because unnecessary |

## 3. Deferred Decisions

| DD-ID | Question | Target Gate |
|-------|----------|-------------|
| DD-G16-01 | Should provider streaming be broken into sub-gates? | Gate 17+ |
| DD-G16-02 | Should security hardening be bundled into one gate or split? | Gate 17+ |
| DD-G16-03 | Should conversation messages be redacted before storage? | Gate 17+ |
| DD-G16-04 | Should CORS be added to the HTTP server? | Gate 17+ |
