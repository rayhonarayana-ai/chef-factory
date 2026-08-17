# GATE 6 — COST PLAN

> Date: 2026-08-17
> Mission: Data Intelligence Layer — Cost Controls

## Cost Model

### What Costs Money in Data Intelligence

| Component | Cost Source | Provider |
|-----------|-----------|----------|
| LLM query plan generation | Model API call | OpenAI/Anthropic/Google |
| LLM result interpretation | Model API call | OpenAI/Anthropic/Google |
| Query execution | Supabase (free tier or existing plan) | Supabase |

**The query itself is free** — it's a parameterized SQL query against an existing Supabase database. The cost is in the LLM calls that generate the query plan and interpret the results.

### Cost Controls

#### 1. Rate Limiting (Existing + New Scope)

| Scope | Limit | Window | Purpose |
|-------|-------|--------|---------|
| `data.query` (new) | 50/hour | 1 hour | Prevent query abuse |
| `data.query.agg` (new) | 10/hour | 1 hour | Prevent expensive aggregations |
| `model.call` (existing) | 200/hour | 1 hour | Limit LLM calls |

#### 2. Query Complexity Budget

| Parameter | Limit | Purpose |
|-----------|-------|---------|
| Max rows per query | 100 | Prevent data extraction |
| Max result size | 50KB | Prevent payload abuse |
| Max filters per query | 10 | Prevent complex queries |
| Max aggregation groups | 20 | Prevent expensive aggregations |
| Query timeout | 5 seconds | Prevent slow queries |

#### 3. Cost Protection Integration

The existing `CostProtector` already handles:
- Project daily hard limit: $5/day
- Owner monthly hard limit: $100/month

Data intelligence queries add minimal cost:
- LLM call cost: ~$0.001-0.01 per query (depends on model)
- Supabase cost: $0 (existing plan)

**No new cost protection rules needed.**

#### 4. Model Selection for Data Intelligence

The LLM model selected for query plan generation affects cost:

| Model | Cost/1K Input | Cost/1K Output | Quality |
|-------|--------------|----------------|---------|
| GPT-4o-mini | $0.00015 | $0.0006 | Good for simple queries |
| GPT-4o | $0.005 | $0.015 | Better for complex queries |
| Claude 3.5 Sonnet | $0.003 | $0.015 | Good all-around |

**Recommendation:** Use the cheapest capable model for data queries. The existing `ModelGateway.select()` already handles this based on `neededReasoning: 'low'`.

#### 5. Truncation Costs

When results are truncated:
- Row count limit hit → return max rows + `truncated: true`
- Byte limit hit → return partial result + `truncated: true`
- No additional cost for truncation

## Cost Summary (V1)

| Item | Cost | Frequency | Monthly |
|------|------|-----------|---------|
| LLM query plan | ~$0.005 | 50/hour | ~$3.60 |
| LLM result interpretation | ~$0.005 | 50/hour | ~$3.60 |
| Supabase queries | $0 | 50/hour | $0 |
| **Total** | | | **~$7.20** |

This is well within the $100/month owner hard limit.

## Cost Optimization Strategies

1. **Cache frequent queries** — Store recent query results with TTL (future optimization)
2. **Batch queries** — Combine related queries into single request (future optimization)
3. **Use cheaper models** — Route data queries to cost-effective models
4. **Limit aggregation scope** — Time-range limits prevent expensive full-table scans

## Monitoring

Every data query records:
- Query type (simple vs aggregation)
- Entity queried
- Row count returned
- Latency
- LLM cost (via existing cost tracking)

This data feeds into the existing `dailyStatus()` monitoring and cost dashboards.
