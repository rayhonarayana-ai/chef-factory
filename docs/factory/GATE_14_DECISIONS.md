# GATE 14 — DECISIONS

**Date:** 2026-08-17
**Baseline:** 599/599 PASS (frozen Gate 13)
**Mission:** Persistent Rate/Anomaly State

---

## 1. Required Owner Decisions

| # | Decision | Options | Recommendation | Rationale |
|---|----------|---------|----------------|-----------|
| OD14-1 | **DB persistence for rate/anomaly state** | A) New tables (rate_limit_state, anomaly_state) via authorized migration<br>B) Use existing tables (audit_log) with new rows<br>C) In-memory only (accept restart risk) | **A: New tables** | Cleanest separation. Existing tables have specific CHECK constraints incompatible with rate/anomaly data. Migration is simple and reversible. |
| OD14-2 | **Migration authorization** | A) Authorize new migration for rate_limit_state + anomaly_state<br>B) Skip — in-memory only | **A: Authorize migration** | Addresses 2 HIGH architectural findings. No impact on existing schema. Tables are small (key, count, TTL). |
| OD14-3 | **Failover behavior on DB unavailability** | A) Fail-open (use in-memory, log warning)<br>B) Fail-close (reject all requests) | **A: Fail-open** | Availability > strictness for rate limiting. Logging ensures visibility. |
| OD14-4 | **Dual instance fix scope** | A) Unify in Gate 14<br>B) Defer to later gate | **A: Unify in Gate 14** | Directly related to persistence work. Low effort. Eliminates the architectural inconsistency. |

---

## 2. Decisions Deferred to Later Gates

| # | Decision | Deferred Gate | Reason |
|---|----------|---------------|--------|
| OD8 | Git initialization | Gate 15+ | Requires git binary installation — non-blocking |
| OD14-5 | Mandatory Guardian wiring | Gate 15 | Requires interface changes to pipeline/execution/orchestration |
| OD14-6 | Streaming response delivery | Gate 15 | Requires SSE/WebSocket infrastructure |
| OD14-7 | Conversation persistence | Gate 15 | Requires new DB tables + conversation state management |
| OD14-8 | Documentation drift repair | Gate 15 | Independent of implementation; can be done alongside any gate |
| OD14-9 | Cross-provider failover | Gate 15 | Requires architectural changes to resilience layer |
| OD14-10 | Memory/vector backend | Gate 15+ | Requires external dependency + architecture |

---

## 3. Classification

**GATE_14_DECISIONS_DEFINED**

4 owner decisions required. All have clear recommendations. No blockers for Gate 14 implementation.
