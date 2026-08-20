# Gate 20 — Evidence Contract

## Required Evidence Items

| ID | Evidence | Source | Status |
|---|---|---|---|
| E1 | Tool status enum mismatch proven | `index.ts:57,92` vs `types.ts:8-17` | VERIFIED |
| E2 | `isExpired()` has zero production callers | Source grep | VERIFIED |
| E3 | `retryCapReached()` has zero production callers | Source grep | VERIFIED |
| E4 | `retry_pending` has no auto-replay mechanism | Architecture review | VERIFIED |
| E5 | Live test deadlock on personal_preferences | Test run 2026-08-19 | VERIFIED |
| E6 | MemoryStore.queryAudit uses actorId filter | `memoryStore.ts:363` | VERIFIED |
| E7 | SupabaseStore.queryAudit uses project filter | `repo.ts:862` | VERIFIED |
| E8 | Duplicate ConversationMessage types | `pipeline.ts:70` vs `conversation.ts:17` | VERIFIED |
| E9 | Conversation resolution duplicated | `handlers.ts:60` vs `streaming.ts:69` | VERIFIED |
| E10 | Anomaly save non-transactional | `gate14Persistence.ts:49` | VERIFIED |
| E11 | Rate limiter race condition | `rateLimit.ts:129` | VERIFIED |
| E12 | 5 unused interfaces | `types.ts` various | VERIFIED |

## Verification Methods

| Method | Findings Covered |
|---|---|
| Source code reading | E1, E6, E7, E8, E9, E10, E11, E12 |
| Source grep (no callers) | E2, E3 |
| Architecture review | E4 |
| Test execution | E5 |
| Interface analysis | E1 |
