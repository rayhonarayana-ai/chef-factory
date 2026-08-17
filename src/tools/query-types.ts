// CHEF FACTORY — Gate 6 → Gate 7 — Query Data Intelligence Layer — Type contracts.
// Deterministic vocabulary for structured data queries. The LLM produces a
// QueryPlan; the engine validates, compiles to parameterized SQL, executes,
// and returns a QueryResult envelope. Gate 7 adds byte limit, timeout,
// dedicated rate limits, enumeration protection, and concurrency control.

// ---------- Allowed entities ----------
export const QUERY_ENTITIES = [
  'projects',
  'tasks',
  'approvals',
  'models',
  'runtimes',
  'agents',
  'decisions',
  'audit_events',
  'cost_events',
] as const;
export type QueryEntity = (typeof QUERY_ENTITIES)[number];

// ---------- Filter operators ----------
export const FILTER_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'like',
  'is_null',
  'between',
] as const;
export type FilterOp = (typeof FILTER_OPERATORS)[number];

export interface QueryFilter {
  field: string;
  operator: FilterOp;
  value: unknown;
}

export interface QuerySort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface QueryPagination {
  offset?: number;
  limit?: number;
}

export interface QueryAggregate {
  operation: 'count' | 'sum' | 'avg' | 'min' | 'max';
  field?: string;
  groupBy?: string[];
}

// ---------- Query plan (LLM produces this) ----------
export interface QueryPlan {
  entity: QueryEntity;
  filters?: QueryFilter[];
  sort?: QuerySort;
  pagination?: QueryPagination;
  fields?: string[];
  aggregate?: QueryAggregate;
}

// ---------- Result envelope ----------
export interface QueryResultEnvelope {
  success: boolean;
  entity: string;
  rows: Record<string, unknown>[];
  metadata: {
    rowCount: number;
    truncated: boolean;
    maxRows: number;
    latencyMs: number;
    queryPlan: QueryPlan;
    byteSize?: number;        // G7-01: actual byte size of result rows
    timedOut?: boolean;       // G7-02: whether query timed out
  };
  error?: string;
}

// ---------- Limits ----------
export const QUERY_MAX_ROWS = 100;
export const QUERY_MAX_BYTES = 50_000;
export const QUERY_DEFAULT_LIMIT = 20;
export const QUERY_MAX_OFFSET = 10_000;
export const QUERY_MAX_FILTERS = 10;
export const QUERY_MAX_GROUPBY = 20;
export const QUERY_TIMEOUT_MS = 5_000;

// ---------- Gate 7: Enumeration & Concurrency ----------
export const QUERY_MAX_ENTROPY_PER_ENTITY = 50;  // G7-04: max queries per entity per owner per hour
export const QUERY_MAX_CONCURRENT = 3;            // G7-05: max concurrent queries per owner
export const QUERY_ENTROPY_WINDOW_MS = 3_600_000; // G7-04: 1 hour window

// ---------- Rate limit scope keys ----------
export const RATE_LIMIT_DATA_QUERY = 'data_query' as const;
export const RATE_LIMIT_DATA_AGG = 'data_query_agg' as const;
