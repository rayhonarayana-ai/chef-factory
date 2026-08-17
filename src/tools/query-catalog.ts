// CHEF FACTORY — Gate 6 — Query Data Intelligence Layer — Entity & Field Catalog.
// Hardcoded approved entities, fields, sort fields, and filter fields.
// The LLM never sees raw DB schema. Only catalog-approved fields may be
// queried, filtered, sorted, or aggregated.

import type { QueryEntity } from './query-types.js';

// ---------- Table mapping (entity → SQL table) ----------
export const ENTITY_TABLE: Record<QueryEntity, string> = {
  projects: 'public.projects',
  tasks: 'public.tasks',
  approvals: 'public.approvals',
  models: 'public.models',
  runtimes: 'public.runtimes',
  agents: 'public.agents',
  decisions: 'public.decision_journal',
  audit_events: 'public.audit_events',
  cost_events: 'public.cost_events',
};

// ---------- Field catalog per entity ----------
// Fields the LLM may SELECT, FILTER, or SORT on.
// Hidden fields (owner_id, internal metadata) are never exposed.
interface FieldSpec {
  column: string;       // SQL column name (snake_case)
  sortable: boolean;
  filterable: boolean;
  aggregateable: boolean;
  sensitive: boolean;   // never returned to LLM
}

const PROJECT_FIELDS: FieldSpec[] = [
  { column: 'id', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'name', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'slug', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'description', sortable: false, filterable: false, aggregateable: false, sensitive: false },
  { column: 'status', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'created_at', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'updated_at', sortable: true, filterable: true, aggregateable: false, sensitive: false },
];

const TASK_FIELDS: FieldSpec[] = [
  { column: 'id', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'project_id', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'title', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'description', sortable: false, filterable: false, aggregateable: false, sensitive: false },
  { column: 'status', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'priority', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'risk_level', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'autonomy', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'attempts', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'max_attempts', sortable: false, filterable: false, aggregateable: false, sensitive: false },
  { column: 'created_at', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'started_at', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'completed_at', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'correlation_id', sortable: false, filterable: true, aggregateable: false, sensitive: false },
];

const APPROVAL_FIELDS: FieldSpec[] = [
  { column: 'id', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'project_id', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'task_id', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'action', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'status', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'risk_level', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'authority_level', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'decision', sortable: false, filterable: false, aggregateable: false, sensitive: false },
  { column: 'decision_reason', sortable: false, filterable: false, aggregateable: false, sensitive: false },
  { column: 'created_at', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'decided_at', sortable: true, filterable: true, aggregateable: false, sensitive: false },
];

const MODEL_FIELDS: FieldSpec[] = [
  { column: 'id', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'provider', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'name', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'slug', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'cost_per_1k_input', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'cost_per_1k_output', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'context_window', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'status', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'created_at', sortable: true, filterable: true, aggregateable: false, sensitive: false },
];

const RUNTIME_FIELDS: FieldSpec[] = [
  { column: 'id', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'name', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'version', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'slug', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'cost_per_hour', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'status', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'created_at', sortable: true, filterable: true, aggregateable: false, sensitive: false },
];

const AGENT_FIELDS: FieldSpec[] = [
  { column: 'id', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'name', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'slug', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'role', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'status', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'created_at', sortable: true, filterable: true, aggregateable: false, sensitive: false },
];

const DECISION_FIELDS: FieldSpec[] = [
  { column: 'decision_id', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'context', sortable: false, filterable: true, aggregateable: false, sensitive: false },
  { column: 'selected_option', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'reason', sortable: false, filterable: false, aggregateable: false, sensitive: false },
  { column: 'risk_level', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'authority_level', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'confidence', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'outcome', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'created_at', sortable: true, filterable: true, aggregateable: false, sensitive: false },
];

const AUDIT_EVENT_FIELDS: FieldSpec[] = [
  { column: 'id', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'actor_type', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'action', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'resource_type', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'resource_id', sortable: false, filterable: true, aggregateable: false, sensitive: false },
  { column: 'authorization_result', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'created_at', sortable: true, filterable: true, aggregateable: false, sensitive: false },
];

const COST_EVENT_FIELDS: FieldSpec[] = [
  { column: 'id', sortable: true, filterable: true, aggregateable: false, sensitive: false },
  { column: 'project_id', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'cost_type', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'amount', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'currency', sortable: false, filterable: true, aggregateable: false, sensitive: false },
  { column: 'billed_to', sortable: true, filterable: true, aggregateable: true, sensitive: false },
  { column: 'created_at', sortable: true, filterable: true, aggregateable: false, sensitive: false },
];

// ---------- Master catalog ----------
export const ENTITY_CATALOG: Record<QueryEntity, FieldSpec[]> = {
  projects: PROJECT_FIELDS,
  tasks: TASK_FIELDS,
  approvals: APPROVAL_FIELDS,
  models: MODEL_FIELDS,
  runtimes: RUNTIME_FIELDS,
  agents: AGENT_FIELDS,
  decisions: DECISION_FIELDS,
  audit_events: AUDIT_EVENT_FIELDS,
  cost_events: COST_EVENT_FIELDS,
};

// ---------- Catalog accessors ----------

export function getFieldsForEntity(entity: QueryEntity): FieldSpec[] {
  return ENTITY_CATALOG[entity] ?? [];
}

export function getFieldNames(entity: QueryEntity): string[] {
  return getFieldsForEntity(entity).map((f) => f.column);
}

export function getSortableFields(entity: QueryEntity): string[] {
  return getFieldsForEntity(entity).filter((f) => f.sortable).map((f) => f.column);
}

export function getFilterableFields(entity: QueryEntity): string[] {
  return getFieldsForEntity(entity).filter((f) => f.filterable).map((f) => f.column);
}

export function getAggregateableFields(entity: QueryEntity): string[] {
  return getFieldsForEntity(entity).filter((f) => f.aggregateable).map((f) => f.column);
}

export function isFieldSensitive(entity: QueryEntity, field: string): boolean {
  const spec = getFieldsForEntity(entity).find((f) => f.column === field);
  return spec?.sensitive ?? true; // unknown fields are treated as sensitive
}

export function isFieldSortable(entity: QueryEntity, field: string): boolean {
  return getFieldsForEntity(entity).some((f) => f.column === field && f.sortable);
}

export function isFieldFilterable(entity: QueryEntity, field: string): boolean {
  return getFieldsForEntity(entity).some((f) => f.column === field && f.filterable);
}

export function isFieldAggregateable(entity: QueryEntity, field: string): boolean {
  return getFieldsForEntity(entity).some((f) => f.column === field && f.aggregateable);
}

/** Returns only non-sensitive fields for SELECT. */
export function getSelectableFields(entity: QueryEntity): string[] {
  return getFieldsForEntity(entity).filter((f) => !f.sensitive).map((f) => f.column);
}

// ---------- Owner scope column per entity ----------
// Entities that have owner_id column use direct filtering.
// audit_events uses a JOIN through projects for owner isolation.
export const ENTITY_OWNER_COLUMN: Record<QueryEntity, string | null> = {
  projects: 'owner_id',
  tasks: 'owner_id',
  approvals: 'owner_id',
  models: 'owner_id',
  runtimes: 'owner_id',
  agents: 'owner_id',
  decisions: 'owner_id',
  audit_events: null, // uses JOIN via project_id
  cost_events: 'owner_id',
};
