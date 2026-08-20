# GATE 18 — DECISIONS

**Date:** 2026-08-19

## Owner Decisions Required

| OD-ID | Question | Options | Recommendation |
|-------|----------|---------|----------------|
| OD25 | Approve ConversationService Refactor as Gate 18? | Yes / No / Alternative | Yes |
| OD26 | If no, approve CORS + Headers (MISSION 2)? | Yes / No | Alternative |
| OD27 | If no, approve Audit Recovery (MISSION 4)? | Yes / No | Alternative |

## Technical Decisions

| TD-ID | Decision | Rationale |
|-------|----------|-----------|
| TD-01 | ConversationService port name: ConversationStore or Store? | Store (existing port, add conversation methods) |
| TD-02 | Test count target: +15 or +20? | +15 (minimum viable) |
| TD-03 | DRY extraction: new module or shared function? | Shared function in conversation.ts |
| TD-04 | Backward compatibility: keep old import path? | No — clean break |

## Deferred Decisions

| DD-ID | Question | Target Gate |
|-------|----------|-------------|
| DD-01 | Recovery mechanism for audit events? | Gate 19+ |
| DD-02 | CORS origin whitelist? | Gate 18+ (if MISSION 2) |
| DD-03 | Tool handler timeout value? | Gate 18+ (if MISSION 3) |
| DD-04 | Memory/vector backend? | Gate 20+ |
| DD-05 | Approval workflow enforcement? | Gate 19+ |
