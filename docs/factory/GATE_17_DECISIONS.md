# GATE 17 — DECISIONS

> Date: 2026-08-19

## Owner Decisions Required

| OD-ID | Question | Recommendation | Status |
|-------|----------|---------------|--------|
| OD22 | Approve Security Event Audit Trail Reliability as Gate 17 mission? | Yes | PENDING |
| OD23 | Initialize git repository? | Deferred (carried from OD8/OD19/OD21) | DEFERRED |

## Technical Decisions

| TD-ID | Decision | Rationale |
|-------|----------|-----------|
| TD-17-01 | Use retry-with-backoff for persistence failures | Simple, bounded, follows existing resilience.ts pattern |
| TD-17-02 | Buffer max 100 events in memory before dropping | Prevents unbounded memory growth during extended DB outage |
| TD-17-03 | Log persistence failures at WARN level (not ERROR) | Expected during DB maintenance; ERROR would create false alerts |
| TD-17-04 | No DB schema changes | Persistence adapters already exist; fix is in application layer |
| TD-17-05 | No API contract changes | Audit trail reliability is internal; no external impact |
| TD-17-06 | Follow existing resilience.ts pattern | Consistent with Gate 10 provider resilience approach |

## Scope Discipline

```
IN SCOPE:
- Security event recording reliability (guardian.ts, security.ts)
- Rate limit persistence reliability (rateLimit.ts)
- Anomaly persistence reliability (anomaly.ts)
- Unit tests for persistence failure scenarios
- Persistence failure logging

OUT OF SCOPE:
- Database schema changes
- API contract changes
- CORS headers (deferred to Gate 18+)
- SSE connection limits (deferred to Gate 18+)
- Conversation security (deferred to Gate 18+)
- db/repo.ts unit tests (deferred to Gate 18+)
- Structured logging (deferred to Gate 18+)
- Documentation drift repair (deferred to Gate 18+)
- Git initialization (owner decision)
```
