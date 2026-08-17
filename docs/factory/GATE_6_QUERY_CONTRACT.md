# GATE 6 — QUERY CONTRACT

> Date: 2026-08-17
> Mission: Data Intelligence Layer — query_data Tool Contract

## Tool Definition

```typescript
{
  name: 'query_data',
  description: 'Query factory data (projects, tasks, approvals, costs, audit, decisions, agents, models, runtimes). Read-only. Returns structured results with filters, sorting, and pagination.',
  riskLevel: 'low',
  actionType: 'data_query',
  requiresApproval: false,
  parameters: {
    type: 'object',
    properties: {
      entity: {
        type: 'string',
        enum: ['projects', 'tasks', 'approvals', 'audit_events', 'cost_events',
               'decisions', 'agents', 'models', 'runtimes'],
        description: 'The entity to query'
      },
      filters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'Field name (must be in approved catalog)' },
            operator: {
              type: 'string',
              enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'like', 'is_null', 'between']
            },
            value: { description: 'Filter value (type-checked per field)' }
          },
          required: ['field', 'operator', 'value']
        },
        description: 'Optional filters'
      },
      sort: {
        type: 'object',
        properties: {
          field: { type: 'string', description: 'Field to sort by' },
          direction: { type: 'string', enum: ['asc', 'desc'] }
        },
        description: 'Optional sort'
      },
      pagination: {
        type: 'object',
        properties: {
          offset: { type: 'number', description: 'Offset (default 0, max 10000)' },
          limit: { type: 'number', description: 'Limit (default 20, max 100)' }
        },
        description: 'Optional pagination'
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional field selection (subset of approved fields)'
      },
      aggregate: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] },
          field: { type: 'string', description: 'Field for aggregation (required for sum/avg/min/max)' },
          groupBy: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional group-by fields'
          }
        },
        description: 'Optional aggregation'
      }
    },
    required: ['entity']
  }
}
```

## Input Validation Rules

1. **Entity required** — Must be in approved catalog
2. **Filters optional** — If provided, each filter must have valid field + operator + value
3. **Field validation** — Filter/sort/groupBy fields must be in approved field catalog for entity
4. **Operator validation** — Must be in FilterOp enum
5. **Value type checking** — String fields accept strings, numeric fields accept numbers, etc.
6. **Sort validation** — Sort field must be sortable for entity
7. **Pagination bounds** — offset >= 0, limit 1-100, offset+limit <= 10000
8. **Fields validation** — If provided, all must be in approved catalog
9. **Aggregation validation** — operation + field must be compatible with entity

## Output Contract

```typescript
interface QueryResult {
  success: boolean;
  entity: string;
  rows: Record<string, unknown>[];
  metadata: {
    rowCount: number;        // Actual rows returned
    totalCount?: number;     // Total matching rows (if count requested)
    truncated: boolean;      // True if results were truncated
    maxRows: number;         // Max rows allowed
    latencyMs: number;       // Query execution time
    queryPlan: QueryPlan;    // What was actually queried (audit trail)
  };
  error?: string;            // Error message if success=false
}
```

## Example Queries

### "Show me all active projects"
```json
{
  "entity": "projects",
  "filters": [
    { "field": "status", "operator": "eq", "value": "active" }
  ],
  "sort": { "field": "created_at", "direction": "desc" },
  "pagination": { "limit": 20 }
}
```

### "Which projects have the most failed tasks this week?"
```json
{
  "entity": "tasks",
  "filters": [
    { "field": "status", "operator": "eq", "value": "failed" },
    { "field": "completed_at", "operator": "gte", "value": "2026-08-10T00:00:00Z" }
  ],
  "aggregate": {
    "operation": "count",
    "groupBy": ["project_id"]
  },
  "sort": { "field": "count", "direction": "desc" }
}
```

### "Show me all denied security actions"
```json
{
  "entity": "audit_events",
  "filters": [
    { "field": "action", "operator": "like", "value": "%denied%" }
  ],
  "sort": { "field": "created_at", "direction": "desc" },
  "pagination": { "limit": 50 }
}
```

### "What's the total cost by project this month?"
```json
{
  "entity": "cost_events",
  "filters": [
    { "field": "created_at", "operator": "gte", "value": "2026-08-01T00:00:00Z" }
  ],
  "aggregate": {
    "operation": "sum",
    "field": "amount",
    "groupBy": ["project_id"]
  },
  "sort": { "field": "amount", "direction": "desc" }
}
```

## Rate Limiting

New scope: `data.query`
- Max 50 queries per hour per owner
- Max 10 aggregation queries per hour per owner
- Configurable via `RateLimiter.setConfig()`

## Cost Integration

Each query records:
- Query type (simple vs aggregation)
- Entity queried
- Row count returned
- Latency
- No cost event (read-only, no model/runtime cost)

Cost is recorded only for the LLM call that produces the query plan, not for the query execution itself.
