# GATE 18 — EVIDENCE CONTRACT

**Date:** 2026-08-19
**Mission:** ConversationService Refactor + Test Coverage

## Required Evidence Items

| ID | Evidence | Category | Proves |
|----|----------|----------|--------|
| E1 | ConversationService accepts Store port | Architecture | Port/adapter compliance |
| E2 | No direct getPool() in conversation.ts | Architecture | No bypass |
| E3 | createConversation tested | Correctness | CRUD works |
| E4 | appendMessage tested | Correctness | CRUD works |
| E5 | loadHistory tested | Correctness | CRUD works |
| E6 | archiveConversation tested | Correctness | CRUD works |
| E7 | handlers.ts uses shared conversation init | Architecture | DRY |
| E8 | streaming.ts uses shared conversation init | Architecture | DRY |
| E9 | Owner isolation preserved | Security | RLS still works |
| E10 | All existing tests pass | Regression | No regressions |
| E11 | tsc --noEmit clean | Build | Type safety |
| E12 | No schema changes | Security | No DB changes |
| E13 | No API changes | Security | No endpoint changes |
| E14 | No security boundary changes | Security | Store port is internal |
| E15 | MemoryStore conversation methods work | Testability | Test double works |
