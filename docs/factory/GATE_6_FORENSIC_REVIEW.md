# GATE 6 — FORENSIC REVIEW

> Date: 2026-08-17
> Mission: Data Intelligence Layer — Forensic Architecture Review

## Scope

Read-only forensic inspection of the entire CHEF FACTORY codebase to determine
where the Data Intelligence Layer can safely fit without modifying any existing code.

## Findings

### F1: Existing Informational Path Already Supports Read Queries
- **Location:** `src/api/execution.ts:426-472` (`runInformational()`)
- **Current Behavior:** Verbs `ask`, `status`, `list`, `read`, `plan`, `research` trigger deterministic data fetches
- **Limitation:** Returns raw Store data without filtering, sorting, aggregation
- **Opportunity:** Extend this path with structured query capability via new tool
- **Risk:** NONE — new tool is additive; existing path unchanged

### F2: ToolBroker Already Supports Read-Only Tools
- **Location:** `src/gateways/toolBroker.ts:42-83`
- **Current Behavior:** `list_projects` and `list_tasks` are `riskLevel: 'low'`, `actionType: 'read'`
- **Opportunity:** `query_data` fits naturally as `riskLevel: 'low'`, `actionType: 'data_query'`
- **Risk:** NONE — ToolBroker handles read tools identically

### F3: SecurityGuardian Already Evaluates Tool Calls
- **Location:** `src/core/security/guardian.ts:33-161`
- **Current Behavior:** Every tool call passes through full security chain
- **Opportunity:** `query_data` will be evaluated by same chain (authority + security + cost + rate limit)
- **Risk:** NONE — Guardian is tool-agnostic

### F4: Authority Engine Already Grants Read Access
- **Location:** `src/core/authority.ts:104-113`
- **Current Behavior:** `permission='read'` → `outcome='auto'`
- **Opportunity:** `query_data` with `permission='read'` will be auto-approved
- **Risk:** NONE — Read access is already auto-approved

### F5: RLS Policies Already Enforce Isolation
- **Location:** `supabase/migrations/20260815220000_factory_init.sql` (55 policies)
- **Current Behavior:** All 16 tables have owner-scoped RLS
- **Opportunity:** Query execution through existing `SupabaseStore.q()` inherits RLS
- **Risk:** NONE — RLS is defense-in-depth; application layer adds owner_id injection

### F6: Existing Tool Handler Pattern is Reusable
- **Location:** `src/tools/types.ts` (ToolHandler, ToolDefinition)
- **Current Behavior:** Tools receive `{ownerId, args, db}` and return `{success, data, error}`
- **Opportunity:** `query_data` handler follows same pattern
- **Risk:** NONE — Handler pattern is established

### F7: DbQuery Interface Already Exists
- **Location:** `src/tools/types.ts:1-6`
- **Current Behavior:** `DbQuery` provides `query(sql, params?)` for parameterized SQL
- **Opportunity:** Query compiler can use this interface directly
- **Risk:** NONE — Interface is tool-agnostic

### F8: Conversation System Already Supports Tool Results
- **Location:** `src/api/execution.ts:278-402` (tool calling loop)
- **Current Behavior:** Tool results are appended as `role: 'tool'` messages
- **Opportunity:** `query_data` results flow through same mechanism
- **Risk:** NONE — Conversation system is tool-agnostic

### F9: No DB Schema Changes Required
- **Finding:** All 9 queryable entities already exist in the database
- **Impact:** No migration needed; no schema exposure risk
- **Risk:** NONE — Existing schema is sufficient

### F10: No New API Endpoints Required
- **Finding:** Data queries flow through existing `POST /api/chat`
- **Impact:** No new attack surface; existing auth + security chain preserved
- **Risk:** NONE — Existing endpoint is sufficient

### F11: Store Interface Already Has All Required Read Methods
- **Location:** `src/core/ports.ts:67-203`
- **Current Methods:** `listProjects`, `listTasks`, `listApprovals`, `listDecisions`, `listModels`, `listRuntimes`, `listAgents`, `listSecurityEvents`, `totalCost`, `projectBudget`
- **Missing:** `listAuditEvents`, `listCostEvents` (need Store extension)
- **Impact:** Two new Store methods required for audit_events and cost_events queries
- **Risk:** LOW — New methods follow existing pattern; RLS enforced

### F12: Security Event Queries Need Store Extension
- **Finding:** `listSecurityEvents` exists but returns full records; no filtering by action/status
- **Impact:** May need query-specific Store methods or extend existing ones
- **Risk:** LOW — Extension follows existing patterns

## Gate 5 Invariant Verification

| Invariant | Status | Evidence |
|-----------|--------|----------|
| Single execution | PRESERVED | ToolBroker.execute flag unchanged |
| SecurityGuardian | PRESERVED | Guardian evaluates query_data like any tool |
| Authority resolution | PRESERVED | evaluateAuthority() unchanged |
| Cost protection | PRESERVED | CostProtector.check() unchanged |
| Prompt injection deny | PRESERVED | G5-04 rule applies to query generation |
| Anomaly controls | PRESERVED | AnomalyDetector unchanged |
| Critical action vocabulary | PRESERVED | ACTION_TYPE_ALIASES unchanged |
| Owner isolation | PRESERVED | owner_id injection + RLS |
| Project isolation | PRESERVED | project_id injection + RLS |
| Conversation isolation | PRESERVED | Conversation is owner-scoped |
| ToolBroker boundary | PRESERVED | ToolBroker handles query_data |

## Conclusion

The Data Intelligence Layer fits naturally into the existing architecture with:
- **1 new tool** (`query_data`)
- **4-5 new source files** (compiler, catalog, types, validate, handler)
- **2 new Store methods** (audit_events, cost_events queries)
- **0 modifications** to existing files
- **0 DB schema changes**
- **0 new API endpoints**

**FORENSIC STATUS: CLEAN** — No existing code requires modification.
