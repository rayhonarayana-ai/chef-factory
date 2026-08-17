# GATE 6 — DATA MODEL

> Date: 2026-08-17
> Mission: Data Intelligence Layer — Entity & Field Catalog

## Approved Query Entities (V1)

### Entity: `projects`
- **Table:** `projects`
- **Store Method:** `listProjects(ownerId)`, `getProject(ownerId, projectId)`
- **Sensitivity:** LOW
- **Relationships:** has many `tasks`, has one `passport`, has many `environments`

| Field | Type | Sortable | Filterable | Sensitive | Description |
|-------|------|----------|------------|-----------|-------------|
| id | uuid | yes | yes | no | Project identifier |
| name | text | yes | yes | no | Display name |
| slug | text | yes | yes | no | URL-friendly identifier |
| description | text | no | no | no | Project description |
| status | text | yes | yes | no | draft/active/paused/archived/deleted |
| created_at | timestamp | yes | yes | no | Creation time |
| updated_at | timestamp | yes | yes | no | Last update time |

**Hidden fields:** `owner_id` (injected by compiler), `metadata` (internal)

### Entity: `tasks`
- **Table:** `tasks`
- **Store Method:** `listTasks(ownerId, filter?)`, `getTask(ownerId, taskId)`
- **Sensitivity:** MEDIUM
- **Relationships:** belongs to `project`, has many `task_runs`, may have `agent`

| Field | Type | Sortable | Filterable | Sensitive | Description |
|-------|------|----------|------------|-----------|-------------|
| id | uuid | yes | yes | no | Task identifier |
| project_id | uuid | yes | yes | no | Parent project |
| title | text | yes | yes | no | Task title |
| description | text | no | no | no | Task description |
| status | text | yes | yes | no | created/queued/running/completed/failed/cancelled/paused/needs_approval |
| priority | text | yes | yes | no | low/medium/high/critical |
| risk_level | text | yes | yes | no | low/medium/high/critical |
| autonomy | text | yes | yes | no | auto/notify/require_approval/deny |
| attempts | int | yes | yes | no | Retry count |
| max_attempts | int | no | no | no | Max retries |
| created_at | timestamp | yes | yes | no | Creation time |
| started_at | timestamp | yes | yes | no | Execution start |
| completed_at | timestamp | yes | yes | no | Execution end |
| correlation_id | uuid | no | yes | no | Pipeline correlation |

**Hidden fields:** `owner_id` (injected), `inputs`, `output`, `error`, `agent_id`, `parent_task_id`, `environment_id`, `created_by`, `approval_required`, `authority_level`

### Entity: `approvals`
- **Table:** `approvals`
- **Store Method:** `listApprovals(ownerId, filter?)`
- **Sensitivity:** MEDIUM
- **Relationships:** belongs to `project`, belongs to `task`

| Field | Type | Sortable | Filterable | Sensitive | Description |
|-------|------|----------|------------|-----------|-------------|
| id | uuid | yes | yes | no | Approval identifier |
| project_id | uuid | yes | yes | no | Parent project |
| task_id | uuid | yes | yes | no | Parent task |
| action | text | yes | yes | no | Action type |
| status | text | yes | yes | no | pending/approved/rejected/denied/expired/cancelled |
| risk_level | text | yes | yes | no | low/medium/high/critical |
| authority_level | text | yes | yes | no | auto/notify/require_approval/deny |
| decision | text | no | no | no | Decision text |
| decision_reason | text | no | no | no | Reason |
| created_at | timestamp | yes | yes | no | Creation time |
| decided_at | timestamp | yes | yes | no | Decision time |

**Hidden fields:** `owner_id` (injected), `agent_id`, `requested_by`, `decided_by`, `description`, `expires_at`

### Entity: `audit_events`
- **Table:** `audit_events`
- **Store Method:** (new — requires Store extension or direct query)
- **Sensitivity:** HIGH
- **Relationships:** belongs to `project`, belongs to `task`

| Field | Type | Sortable | Filterable | Sensitive | Description |
|-------|------|----------|------------|-----------|-------------|
| id | bigint | yes | yes | no | Event identifier (append-only) |
| actor_type | text | yes | yes | no | owner/agent/system |
| action | text | yes | yes | no | Event action |
| resource_type | text | yes | yes | no | Resource type |
| resource_id | text | no | yes | no | Resource ID |
| authorization_result | text | yes | yes | no | auto/notify/require_approval/deny |
| created_at | timestamp | yes | yes | no | Event time |

**Hidden fields:** `actor_id` (internal), `project_id` (injected), `environment_id`, `correlation_id`, `task_id`, `metadata`

### Entity: `cost_events`
- **Table:** `cost_events`
- **Store Method:** (new — requires Store extension)
- **Sensitivity:** HIGH
- **Relationships:** belongs to `project`, belongs to `task`

| Field | Type | Sortable | Filterable | Sensitive | Description |
|-------|------|----------|------------|-----------|-------------|
| id | uuid | yes | yes | no | Cost event identifier |
| cost_type | text | yes | yes | no | model/runtime/tool/mission/project |
| amount | numeric | yes | yes | no | Cost in USD |
| currency | text | no | yes | no | Currency code |
| created_at | timestamp | yes | yes | no | Event time |

**Hidden fields:** `owner_id` (injected), `project_id` (injected), `task_id`, `run_id`, `agent_id`, `provider`, `model_id`, `runtime_id`, `billed_to`, `metadata`

### Entity: `decisions`
- **Table:** `decision_journal`
- **Store Method:** `listDecisions(ownerId)`
- **Sensitivity:** MEDIUM

| Field | Type | Sortable | Filterable | Sensitive | Description |
|-------|------|----------|------------|-----------|-------------|
| decision_id | uuid | yes | yes | no | Decision identifier |
| context | text | yes | yes | no | Decision context |
| selected_option | text | yes | yes | no | Selected option |
| reason | text | no | no | no | Decision reason |
| risk_level | text | yes | yes | no | low/medium/high/critical |
| authority_level | text | yes | yes | no | auto/notify/require_approval/deny |
| confidence | numeric | yes | no | no | 0-1 confidence |
| outcome | text | yes | yes | no | Decision outcome |
| created_at | timestamp | yes | yes | no | Decision time |

**Hidden fields:** `owner_id` (injected), `project_id` (injected), `options`, `evidence`, `approved_by`

### Entity: `agents`
- **Table:** `agents`
- **Store Method:** `listAgents(ownerId)`
- **Sensitivity:** LOW

| Field | Type | Sortable | Filterable | Sensitive | Description |
|-------|------|----------|------------|-----------|-------------|
| id | uuid | yes | yes | no | Agent identifier |
| name | text | yes | yes | no | Agent name |
| slug | text | yes | yes | no | URL-friendly identifier |
| role | text | yes | yes | no | Agent role |
| status | text | yes | yes | no | active/paused/retired/suspended |
| created_at | timestamp | yes | yes | no | Creation time |

**Hidden fields:** `owner_id` (injected), `description`, `capabilities`

### Entity: `models`
- **Table:** `models`
- **Store Method:** `listModels(ownerId)`
- **Sensitivity:** LOW

| Field | Type | Sortable | Filterable | Sensitive | Description |
|-------|------|----------|------------|-----------|-------------|
| id | uuid | yes | yes | no | Model identifier |
| provider | text | yes | yes | no | Provider name |
| name | text | yes | yes | no | Model name |
| slug | text | yes | yes | no | URL-friendly identifier |
| cost_per_1k_input | numeric | yes | yes | no | Input cost |
| cost_per_1k_output | numeric | yes | yes | no | Output cost |
| context_window | int | yes | yes | no | Context window size |
| status | text | yes | yes | no | active/limited/retired |
| created_at | timestamp | yes | yes | no | Creation time |

**Hidden fields:** `owner_id` (injected), `capability`

### Entity: `runtimes`
- **Table:** `runtimes`
- **Store Method:** `listRuntimes(ownerId)`
- **Sensitivity:** LOW

| Field | Type | Sortable | Filterable | Sensitive | Description |
|-------|------|----------|------------|-----------|-------------|
| id | uuid | yes | yes | no | Runtime identifier |
| name | text | yes | yes | no | Runtime name |
| version | text | yes | yes | no | Version |
| slug | text | yes | yes | no | URL-friendly identifier |
| cost_per_hour | numeric | yes | yes | no | Hourly cost |
| status | text | yes | yes | no | active/limited/retired |
| created_at | timestamp | yes | yes | no | Creation time |

**Hidden fields:** `owner_id` (injected), `capability`

## Entity Relationship Graph

```
projects ──┬── tasks ──── task_runs
           ├── approvals
           ├── project_environments
           └── project_passports

agents ──── agent_permissions ──── projects

cost_events ──── projects, tasks, task_runs, models, runtimes
audit_events ──── projects, tasks
decision_journal ──── projects
autonomy_records ──── agents, projects
```

## Aggregation Support (V1)

### Supported Aggregations
- `count` — Count rows matching filters
- `sum` — Sum numeric field (e.g., `amount` in cost_events)
- `avg` — Average numeric field
- `min` / `max` — Min/max of numeric or timestamp field

### Supported Group-By
- `entity` — Group by entity type
- `status` — Group by status field
- `project_id` — Group by project
- `cost_type` — Group by cost type
- `created_at` (date truncation) — Group by day/week/month

### Aggregation Query Plan
```typescript
interface AggregationPlan {
  entity: QueryEntity;
  operation: 'count' | 'sum' | 'avg' | 'min' | 'max';
  field?: string;        // Required for sum/avg/min/max
  groupBy?: string[];    // Optional group-by fields
  filters?: QueryFilter[];
  sort?: QuerySort;      // Sort by aggregated result
  pagination?: QueryPagination;
}
```
