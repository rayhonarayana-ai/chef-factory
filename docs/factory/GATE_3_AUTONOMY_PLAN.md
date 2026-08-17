# Gate 3 Autonomy Plan

## 1. Autonomy Model (Carried from Gate 1/2)

The existing adaptive autonomy system is:

- 4 levels: auto, notify, require_approval, deny
- DENY always wins (cannot be overridden)
- Owner policy respected (but not above DENY)
- Protected classes (delete, deploy, financial, legal, account_security, credit) ALWAYS require_approval
- Escalation: notify → auto only (one-step bounded, 80%+ success, 5+ history)

## 2. Gate 3 Autonomy Changes

**No changes to the autonomy algorithm itself.** The bounded escalation system is proven and correct.

**Change: Tool calls now generate real success/failure data.**

- Before Gate 3: Tasks completed but no granular tool-level success tracking
- After Gate 3: Each tool call succeeds or fails, feeding the autonomy system with real data
- This enables the adaptive autonomy vision to actually work in practice

## 3. Autonomy Matrix for Gate 3 Tool Calls

| Action | Owner | Project | Environment | Risk | Authority | Default Autonomy | Escalation | Evidence |
|--------|-------|---------|-------------|------|-----------|-----------------|------------|----------|
| create_project | owner | none | development | medium | write | auto (owner) | N/A (owner) | Tool call success |
| list_projects | owner | none | any | low | read | auto | N/A (owner) | Tool call success |
| list_tasks | owner | project | any | low | read | auto | N/A (owner) | Tool call success |
| create_task | owner | project | any | medium | write | auto (owner) | N/A (owner) | Tool call success |
| update_task | owner | project | any | medium | write | auto (owner) | N/A (owner) | Tool call success |

**Key point:** For the owner, all 5 tools auto-execute (owner is always authorized for their own projects). The autonomy system is relevant for AGENT tool calls (Gate 4+).

## 4. Tool-Level Success Tracking

Add to autonomy_records:

- action: tool name (e.g., 'create_project')
- outcome: 'success' | 'failure'
- risk_level: tool's risk level
- selected_autonomy: 'auto' (for owner)

This feeds the success rate calculation:

- successRate = successes / total
- historyCount = total calls
- Escalation trigger: successRate >= 0.8 AND historyCount >= 5

## 5. What Gate 3 Does NOT Change

- Authority matrix rules (10 rules unchanged)
- Protected action types (6 unchanged)
- Risk calculation (riskFromAction unchanged)
- Approval engine (6 states unchanged)
- Task state machine (8 statuses unchanged)
- Security Guardian evaluation chain (11 steps unchanged)
- Precedence: lockdown > deny > require_approval > notify > allow (unchanged)

## 6. Future: Agent Tool Autonomy (Gate 4+)

When agents are added:

- Agent tool calls go through the same ToolBroker
- Agent authority is checked via agent_permissions table
- Agent success rates are tracked per-tool
- Agent escalation follows the same bounded rules
- Agents can NEVER call protected tools (delete, deploy, financial, etc.)
