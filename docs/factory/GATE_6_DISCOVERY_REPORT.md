# GATE 6 — DISCOVERY REPORT

> Date: 2026-08-17
> Mission: Data Intelligence Layer
> Mode: Discovery / Forensic Architecture Only
> Gate 5 Baseline: FROZEN (257/257)

## Executive Summary

CHEF FACTORY currently operates as a **mutation-capable assistant**: it can create projects, create/update tasks, but has **no read-only data intelligence capability**. The owner cannot ask natural-language data questions like "Which projects have the most failed tasks this week?" and receive an evidence-backed answer.

Gate 6 introduces a `query_data` tool that enables safe, structured, read-only queries against authorized factory data through natural language.

## Current State

### What CHEF Can Do Today
- **Create projects** (via `create_project` tool)
- **List projects** (via `list_projects` tool — already exists but LLM-only, no structured query)
- **List tasks** (via `list_tasks` tool — project-scoped, status-filtered)
- **Create/update tasks** (via `create_task`, `update_task` tools)
- **Informational commands** (via `runInformational()` in execution.ts — returns raw Store data for `ask`, `status`, `list`, `read`, `plan`, `research` verbs)

### What CHEF Cannot Do Today
- **Structured queries** with filters, sorting, aggregation across entities
- **Cross-entity analysis** (e.g., "tasks by project by status with cost")
- **Time-range queries** (e.g., "tasks created this week")
- **Aggregation queries** (e.g., "total cost by project")
- **Security event queries** (e.g., "show me all denied actions")
- **Cost analysis** (e.g., "which model is most expensive")

### Architecture Inventory (16 tables, 55 RLS policies)

| Table | Queryable in V1 | RLS | Notes |
|-------|----------------|-----|-------|
| owners | NO | Owner-only | Identity table, never query directly |
| projects | YES | Owner + agent-read | Core entity |
| project_environments | NO | Owner + agent-read | Derived from projects |
| project_passports | NO | Owner + agent-read | Metadata blob, not queryable |
| agents | YES | Owner-only | Agent registry |
| agent_permissions | NO | Owner-only | Permission grants |
| tasks | YES | Owner + agent-read | Core entity |
| task_runs | NO | Owner + agent-read | Execution detail, deferred |
| models | YES | Owner-only | Model registry |
| runtimes | YES | Owner-only | Runtime registry |
| approvals | YES | Owner + agent-read | Approval workflow |
| audit_events | YES (owner only) | Owner + agent-read | Append-only |
| cost_events | YES (owner only) | Owner-only | Cost tracking |
| personal_preferences | NO | Owner-only | Policy, not queryable |
| decision_journal | YES (owner only) | Owner-only | Decision audit |
| autonomy_records | NO | Owner-only | Agent autonomy, deferred |

## Gap Analysis

### Current Pipeline
```
Natural language
→ intent (parseIntent)
→ authority (evaluateAuthority)
→ autonomy (evaluateAutonomy)
→ security (SecurityGuardian)
→ execution (ToolBroker → tool handler)
→ mutation tools only
```

### Target Pipeline
```
Natural language
→ intent (parseIntent)
→ data requirement extraction
→ authorization (evaluateAuthority)
→ security (SecurityGuardian)
→ structured query plan (deterministic)
→ query execution (read-only boundary)
→ result validation (size, schema)
→ deterministic result envelope
→ LLM interpretation
→ natural language response
```

### Minimum Architectural Addition

One new tool: `query_data` with:
- Structured query DSL (entity + filters + sort + pagination)
- Deterministic query compiler (DSL → parameterized SQL)
- Read-only execution boundary (no INSERT/UPDATE/DELETE)
- Result envelope with metadata (row count, truncation, latency)
- Full security chain integration (ToolBroker + SecurityGuardian + Authority)

## Key Architectural Decisions (Preliminary)

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Query boundary | Repository layer (Store methods) | Reuses existing RLS, parameterized queries, owner isolation |
| Query language | Structured DSL (entity + filters) | Deterministic, auditable, no arbitrary SQL |
| Schema exposure | Approved entity catalog only | LLM never sees raw DB schema |
| Result safety | Max 100 rows, max 50KB, truncation | Prevents data exfiltration and DoS |
| Execution path | Through existing ToolBroker | Maintains all Gate 5 invariants |

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Arbitrary SQL injection | CRITICAL | No raw SQL — structured DSL only |
| Owner isolation bypass | CRITICAL | RLS + application-layer owner_id enforcement |
| Excessive data extraction | HIGH | Row limit, byte limit, truncation |
| Schema enumeration | MEDIUM | Approved entity catalog, no schema exposure |
| Prompt injection into queries | MEDIUM | Deterministic query compiler, LLM cannot modify SQL |
| Cost DoS | MEDIUM | Rate limiting, query complexity budget |

## Recommendation

**GATE_6_READY_FOR_OWNER_APPROVAL** — All architectural questions resolved. 8 owner decisions required before implementation.

## Next Steps

1. Owner reviews and approves 8 decisions (OD1–OD8)
2. Gate 6 implementation (query_data tool + query engine)
3. Gate 6 testing (unit + integration + live)
4. Gate 6 forensic closure
