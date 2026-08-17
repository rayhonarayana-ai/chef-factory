# Gate 4 Scope: "INTEGRATION GATE"

> **Purpose:** Fix Gate 3 drift. Make architecture match implementation.
> **Status:** Scope definition — READ-ONLY document.
> **Gate:** 4 of 6

---

## Section 1: Capability Matrix

| # | Capability | Required/Optional/Deferred | Rationale |
|---|-----------|--------------------------|-----------|
| 1 | Wire conversation history into LLM pipeline | REQUIRED | Multi-turn is broken without this |
| 2 | Wire ToolBroker securityGuard | REQUIRED | Per-tool security is bypassed |
| 3 | Fix ToolBroker authority resolution | REQUIRED | Authority check always passes |
| 4 | Regression (222+ tests) | REQUIRED | No regressions allowed |
| 5 | Live verification (OpenAI + conversation) | REQUIRED | Prove multi-turn works |
| 6 | Wire 5 anomaly counters | DEFERRED | Not critical for execution |
| 7 | Wire 5 failure rate limits | DEFERRED | Not critical for execution |
| 8 | Cost limit configuration | DEFERRED | Owner action required |
| 9 | delete_project tool | OPTIONAL | Expands capability |
| 10 | archive_task tool | OPTIONAL | Expands capability |
| 11 | search_projects tool | OPTIONAL | Expands capability |
| 12 | Git initialization | OPTIONAL | Owner action required |

---

## Section 2: Gate 3 Limitations Carried Forward

| # | Limitation | Gate 4 Action | Status After Gate 4 |
|---|-----------|---------------|-------------------|
| 1 | Conversation history not loaded | FIX — wire into pipeline | RESOLVED |
| 2 | ToolBroker securityGuard not wired | FIX — wire in execution | RESOLVED |
| 3 | ToolBroker authority bypassed | FIX — resolve authority | RESOLVED |
| 4 | Only OpenAI verified live | VERIFY — live test | VERIFIED |
| 5 | Cost protection defaults disabled | CONFIGURE — owner sets limits | CONFIGURED |
| 6 | 5 anomaly counters unwired | ACTIVATE — wire to events | ACTIVE |
| 7 | 5 failure rate scopes unenforced | ACTIVATE — wire to checks | ACTIVE |

---

## Section 3: Scope Boundaries

### IN SCOPE for Gate 4

- Fix conversation history loading (CRITICAL)
- Fix ToolBroker securityGuard wiring (HIGH)
- Fix ToolBroker authority resolution (HIGH)
- Activate deferred Gate 2 items (anomaly counters, failure rate limits)
- Optional tool registry expansion
- Regression verification
- Live verification

### OUT OF SCOPE for Gate 4

- Growth Engine
- Sales Engine
- Deployment
- Full multi-agent autonomy
- Browser automation
- Memory/vector backend
- New LLM providers
- New database tables
- New API endpoints
- Kubernetes/microservices
