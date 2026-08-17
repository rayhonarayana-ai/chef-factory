# GATE 6 — DECISIONS

> Date: 2026-08-17
> Mission: Data Intelligence Layer — Owner Decisions Required

## Decision Summary

8 owner decisions required before Gate 6 implementation begins.

---

### OD1: Query Architecture — Structured DSL vs Repository Abstraction

**Question:** Should the query layer use a structured query DSL (entity + filters + sort) or a repository abstraction (pre-built query methods per entity)?

**Option A: Structured Query DSL** (Recommended)
- LLM produces a JSON query plan
- Compiler translates to parameterized SQL
- Full flexibility for filters, sorting, aggregation
- More complex implementation
- More auditable (query plan is the audit record)

**Option B: Repository Abstraction**
- Pre-built query methods per entity (e.g., `listTasksWithFilters()`)
- LLM selects method + parameters
- Simpler implementation
- Less flexible (fixed query patterns)
- Less auditable (method name doesn't capture intent)

**Recommendation:** Option A (Structured DSL) — More flexible, more auditable, provider-neutral.

---

### OD2: Initial Entity Scope

**Question:** Which entities should be queryable in V1?

**Option A: Core entities only** (Recommended)
- projects, tasks, approvals
- Lowest risk, highest business value
- Fastest to implement

**Option B: Core + operational**
- projects, tasks, approvals, models, runtimes
- Medium risk, medium business value

**Option C: Full scope**
- All 9 entities (projects, tasks, approvals, models, runtimes, audit_events, cost_events, decisions, agents)
- Highest risk, highest value
- Slowest to implement

**Recommendation:** Option A (Core entities only) — Start with highest-value, lowest-risk entities. Expand in Gate 7+.

---

### OD3: Maximum Rows / Result Size

**Question:** What are the maximum result size limits?

**Option A: Conservative** (Recommended)
- Max 100 rows per query
- Max 50KB result size
- Truncation flag when limits hit

**Option B: Moderate**
- Max 200 rows per query
- Max 100KB result size

**Option C: Liberal**
- Max 500 rows per query
- Max 200KB result size

**Recommendation:** Option A (Conservative) — Prevent data extraction; owner can increase if needed.

---

### OD4: Maximum Query Execution Time

**Question:** What is the query timeout?

**Option A: 5 seconds** (Recommended)
- Sufficient for most queries
- Prevents expensive aggregation DoS

**Option B: 10 seconds**
- Allows more complex queries
- Higher DoS risk

**Option C: 30 seconds**
- Allows very complex queries
- Significant DoS risk

**Recommendation:** Option A (5 seconds) — Sufficient for V1; can increase in future gates.

---

### OD5: Aggregation Limits

**Question:** Should V1 support aggregation queries (count, sum, avg, group-by)?

**Option A: Yes, with limits** (Recommended)
- Aggregation supported
- Max 20 group-by groups
- Max 10 aggregation queries/hour
- Time-range filter required for aggregation

**Option B: No aggregation in V1**
- Simple queries only
- Aggregation deferred to Gate 7

**Option C: Full aggregation**
- No limits on group-by
- No rate limiting on aggregations

**Recommendation:** Option A (Yes with limits) — Aggregation is high-value; limits prevent abuse.

---

### OD6: Security/Audit Event Queries in V1

**Question:** Should security events and audit events be queryable in V1?

**Option A: Audit events only** (Recommended)
- Audit events queryable (owner-scoped, append-only)
- Security events deferred to Gate 7 (sensitivity)
- Decision journal queryable

**Option B: Both audit and security events**
- Full operational visibility
- Higher sensitivity exposure

**Option C: Neither in V1**
- Only projects, tasks, approvals
- Audit/security deferred to Gate 7

**Recommendation:** Option A (Audit events only) — Audit events have moderate sensitivity; security events need careful handling.

---

### OD7: Query Result Export

**Question:** Can query results be exported (downloaded, copied, shared)?

**Option A: No export in V1** (Recommended)
- Results displayed in conversation only
- No download/copy/share capability
- Prevents data exfiltration

**Option B: Copy only**
- Results can be copied to clipboard
- No download or sharing

**Option C: Full export**
- Download as CSV/JSON
- Sharing capability

**Recommendation:** Option A (No export) — Prevents exfiltration; export is a future gate feature.

---

### OD8: Git Initialization Before Implementation

**Question:** Should the git repository be initialized before Gate 6 implementation?

**Option A: Yes** (Recommended)
- Initialize git repo before coding
- Enables version control for Gate 6 changes
- Enables rollback if needed

**Option B: No**
- Git initialization deferred
- Implementation proceeds without version control

**Recommendation:** Option A (Yes) — Git initialization is overdue; should happen before any new code.

---

## Decision Matrix

| Decision | Recommendation | Owner Approval Required |
|----------|---------------|------------------------|
| OD1 | Structured DSL | YES |
| OD2 | Core entities only | YES |
| OD3 | 100 rows / 50KB | YES |
| OD4 | 5 seconds | YES |
| OD5 | Yes with limits | YES |
| OD6 | Audit events only | YES |
| OD7 | No export | YES |
| OD8 | Yes, git init | YES |

## Next Steps After Approval

1. Git initialization (if OD8 = Yes)
2. Implement query compiler (OD1)
3. Implement entity catalog (OD2)
4. Implement query validation (OD3, OD4, OD5)
5. Implement query_data tool
6. Implement Store extensions (OD6)
7. Test everything
8. Forensic closure
