# GATE 6 — ARCHITECTURE

> Date: 2026-08-17
> Mission: Data Intelligence Layer — Structured Query Architecture

## Design Principles

1. **Read-only by construction** — The query layer cannot mutate state.
2. **Deterministic** — The same query always produces the same result.
3. **Auditable** — Every query is logged with full context.
4. **Bounded** — Results are size-limited; no unbounded extraction.
5. **Secure** — RLS + application layer + tool boundary + security guardian.
6. **Provider-neutral** — Works with OpenAI, Anthropic, Google equally.

## Architecture Overview

```
Owner NL question
  │
  ▼
parseIntent() → verb='read', resource='query'
  │
  ▼
CommandPipeline.run()
  │
  ▼
evaluateAuthority() → outcome='auto' (read permission)
  │
  ▼
SecurityGuardian.evaluate() → decision='allow'
  │
  ▼
ToolBroker.call(query_data, {entity, filters, sort, pagination})
  │
  ▼
ToolBroker validates: authority + security + risk
  │
  ▼
query_data handler executes:
  1. Validate query plan against approved entity catalog
  2. Compile DSL → parameterized SQL
  3. Execute via SupabaseStore.q() (RLS enforced)
  4. Validate result envelope (row count, schema)
  5. Return deterministic result + metadata
  │
  ▼
LLM interprets result → natural language response
```

## Component Design

### 1. Query Plan (Structured DSL)

The LLM produces a **query plan** — a JSON object describing the desired data:

```typescript
interface QueryPlan {
  entity: QueryEntity;           // What to query
  filters?: QueryFilter[];       // Optional filters
  sort?: QuerySort;              // Optional sorting
  pagination?: QueryPagination;  // Optional pagination
  fields?: string[];             // Optional field selection
}
```

**Why not raw SQL?**
- The LLM never writes SQL
- The compiler guarantees safety
- Every query is auditable
- RLS is always enforced

### 2. Query Entity (Approved Catalog)

Only approved entities can be queried. The catalog is hardcoded, not database-derived:

```typescript
type QueryEntity = 'projects' | 'tasks' | 'approvals' | 'models' | 'runtimes'
                 | 'audit_events' | 'cost_events' | 'decisions' | 'agents';
```

Each entity maps to:
- A Store method (e.g., `listProjects`, `listTasks`)
- An approved field catalog
- Sensitivity classification per field
- Relationship graph

### 3. Query Filters (Type-Safe)

```typescript
interface QueryFilter {
  field: string;        // Must be in approved field catalog for entity
  operator: FilterOp;
  value: unknown;       // Type-checked per field
}

type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
              | 'in' | 'like' | 'is_null' | 'between';
```

### 4. Query Sort

```typescript
interface QuerySort {
  field: string;       // Must be in approved sort catalog
  direction: 'asc' | 'desc';
}
```

### 5. Query Pagination

```typescript
interface QueryPagination {
  offset?: number;     // Default 0, max 10000
  limit?: number;      // Default 20, max 100
}
```

### 6. Query Compiler (Deterministic)

The compiler translates the query plan into a parameterized SQL string:

```typescript
function compileQuery(plan: QueryPlan): { sql: string; params: unknown[] }
```

**Rules:**
- Only SELECT queries (no INSERT/UPDATE/DELETE/DDL)
- Only approved tables and columns
- All values parameterized (never interpolated)
- WHERE clauses built from validated filters
- ORDER BY only on approved sort fields
- LIMIT/OFFSET with hard maximums
- Owner ID always injected as first WHERE condition

### 7. Result Envelope

Every query returns a deterministic envelope:

```typescript
interface QueryResult {
  success: boolean;
  entity: string;
  rows: Record<string, unknown>[];
  metadata: {
    rowCount: number;
    truncated: boolean;
    maxRows: number;
    latencyMs: number;
    queryPlan: QueryPlan;  // What was actually queried (audit)
  };
  error?: string;
}
```

### 8. Security Boundary

```
query_data tool definition:
  - riskLevel: 'low' (read-only)
  - actionType: 'data_query'
  - requiresApproval: false
```

The tool passes through:
1. ToolBroker authority check (permission='read' → auto)
2. ToolBroker security guard hook
3. SecurityGuardian.evaluate() with scope='tool'
4. Cost protection check
5. Rate limit check (model.call or new data.query scope)

## File Layout (Proposed)

```
src/tools/query-data.ts          — Tool definition + handler
src/tools/query-compiler.ts      — DSL → parameterized SQL
src/tools/query-catalog.ts       — Approved entity/field catalog
src/tools/query-types.ts         — QueryPlan, QueryResult types
src/tools/query-validate.ts      — Input validation + sanitization
```

## Backward Compatibility

- No existing files modified (Gate 5 frozen baseline preserved)
- No existing tools changed
- No DB schema changes
- No new API endpoints
- No new RLS policies (existing RLS covers all queried tables)
- ToolBroker, SecurityGuardian, Authority, Autonomy: UNCHANGED
