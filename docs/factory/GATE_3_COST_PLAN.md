## Gate 3 Cost Plan

### 1. Cost Model (Carried from Gate 1/2)
- Cost tracking per model call: tokens × per-1k rates
- Cost events stored in cost_events table
- Cost protection wired into Guardian (but defaults to no limits)
- Rate limits: model.call = 200/hour, tool.call = 100/hour

### 2. Gate 3 Cost Changes

**New cost dimension: Tool call costs**
- Tool calls themselves are free (DB operations)
- But each tool call round-trip involves an LLM call (which costs money)
- A single user command may trigger: 1 initial LLM call + N tool calls + 1 final LLM call
- Worst case: 1 + N + 1 LLM calls per command

**Cost estimation:**
- Average LLM call: ~500 tokens in/out = ~$0.001 (gpt-4o-mini)
- If 5 tool calls triggered: 7 LLM calls × $0.001 = $0.007 per command
- At 100 commands/day: $0.70/day = $21/month

### 3. Cost Controls

| Control | Limit | Scope | Status |
|---------|-------|-------|--------|
| model.call rate limit | 200/hour | Per owner | EXISTING (wired) |
| tool.call rate limit | 100/hour | Per owner | EXISTING (wired) |
| task.execute rate limit | 50/hour | Per owner | EXISTING (wired) |
| Cost protection (monthly) | null (disabled) | Per owner | EXISTING (owner configures) |
| Cost protection (daily) | null (disabled) | Per project | EXISTING (owner configures) |
| Task max attempts | 3 | Per task | EXISTING |

### 4. Recommended Cost Limits (Owner Configuration)

| Limit | Recommended | Rationale |
|-------|-------------|-----------|
| Daily model cost | $5.00 | ~5000 tool-calling commands/day |
| Monthly model cost | $100.00 | ~100K commands/month |
| Per-command max LLM calls | 10 | Prevents infinite tool loops |
| Tool call rate limit | 100/hour | Already configured |

### 5. Tool Loop Prevention

The execution loop must have a hard limit:
- Maximum 10 tool call rounds per command
- If LLM requests more than 10 tool calls, stop and return partial results
- This prevents cost runaway from LLM tool call loops
- Configurable via environment variable (FACTORY_MAX_TOOL_ROUNDS, default 10)

### 6. Cost Reporting

After each command with tool calls:
```json
{
  "cost": {
    "model": "gpt-4o-mini",
    "total_tokens": 1500,
    "tool_calls": 3,
    "llm_calls": 5,
    "estimated_cost": 0.005
  }
}
```

### 7. What Gate 3 Does NOT Include
- New cost providers
- Cost budgets per agent
- Cost dashboards
- Cost alerts/notifications
- Cost optimization
- Cost allocation across projects
