// CHEF FACTORY — Gate 6 → Gate 7 — Query Data Intelligence Layer — Tool definition.
// The query_data tool allows the LLM to safely read factory data through a
// structured query DSL. The LLM never writes SQL. The engine validates,
// compiles to parameterized SQL, executes via db.query(), and returns a
// deterministic result envelope.
// Gate 7: adds enumeration protection, concurrency control, error sanitization,
// and dedicated rate limit checks.

import { getPool } from '../db/pool.js';
import type { ToolHandlerInput, ToolHandlerResult } from './types.js';
import type { QueryPlan, QueryEntity, QueryFilter, QuerySort, QueryPagination, QueryAggregate } from './query-types.js';
import {
  QUERY_MAX_ROWS,
  QUERY_DEFAULT_LIMIT,
  QUERY_ENTITIES,
  QUERY_MAX_ENTROPY_PER_ENTITY,
  QUERY_MAX_CONCURRENT,
  QUERY_ENTROPY_WINDOW_MS,
} from './query-types.js';
import { validateQueryPlan, compileQuery, executeQuery } from './query-engine.js';
import { getSelectableFields, getSortableFields, getFilterableFields, getAggregateableFields, ENTITY_TABLE, ENTITY_OWNER_COLUMN } from './query-catalog.js';

// ---------- Tool Definition ----------

export const QUERY_DATA_TOOL = {
  name: 'query_data',
  description: 'Query factory data (projects, tasks, approvals, models, runtimes, agents, decisions, audit_events, cost_events). Read-only. Returns structured results with filters, sorting, and pagination. Use this when the owner asks data questions about their factory.',
  riskLevel: 'low' as const,
  actionType: 'data_query',
  requiresApproval: false,
  parameters: {
    type: 'object',
    properties: {
      entity: {
        type: 'string',
        enum: [...QUERY_ENTITIES],
        description: 'The entity to query',
      },
      filters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'Field name (must be in approved catalog)' },
            operator: {
              type: 'string',
              enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'like', 'is_null', 'between'],
              description: 'Filter operator',
            },
            value: { description: 'Filter value' },
          },
          required: ['field', 'operator', 'value'],
        },
        description: 'Optional filters',
      },
      sort: {
        type: 'object',
        properties: {
          field: { type: 'string', description: 'Field to sort by' },
          direction: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
        },
        description: 'Optional sort',
      },
      pagination: {
        type: 'object',
        properties: {
          offset: { type: 'number', description: 'Offset (default 0)' },
          limit: { type: 'number', description: 'Limit (default 20, max 100)' },
        },
        description: 'Optional pagination',
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional field selection (subset of approved fields)',
      },
      aggregate: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'], description: 'Aggregation operation' },
          field: { type: 'string', description: 'Field for aggregation (required for sum/avg/min/max)' },
          groupBy: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional group-by fields',
          },
        },
        description: 'Optional aggregation',
      },
    },
    required: ['entity'],
  },
};

// ---------- G7-04: Per-entity enumeration counter ----------

interface EntityQueryRecord {
  count: number;
  windowStartedAt: number;
}

const entityQueryCounts = new Map<string, EntityQueryRecord>();

function checkEntityEntropy(ownerId: string, entity: string): { allowed: boolean; remaining: number } {
  const key = `${ownerId}:${entity}`;
  const now = Date.now();
  let record = entityQueryCounts.get(key);
  if (!record || now - record.windowStartedAt >= QUERY_ENTROPY_WINDOW_MS) {
    record = { count: 0, windowStartedAt: now };
    entityQueryCounts.set(key, record);
  }
  record.count += 1;
  if (record.count > QUERY_MAX_ENTROPY_PER_ENTITY) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: QUERY_MAX_ENTROPY_PER_ENTITY - record.count };
}

// ---------- G7-05: Concurrent-query semaphore ----------

const concurrentQueries = new Map<string, number>();

function acquireSemaphore(ownerId: string): { acquired: boolean; active: number } {
  const current = concurrentQueries.get(ownerId) ?? 0;
  if (current >= QUERY_MAX_CONCURRENT) {
    return { acquired: false, active: current };
  }
  concurrentQueries.set(ownerId, current + 1);
  return { acquired: true, active: current + 1 };
}

function releaseSemaphore(ownerId: string): void {
  const current = concurrentQueries.get(ownerId) ?? 0;
  if (current <= 1) {
    concurrentQueries.delete(ownerId);
  } else {
    concurrentQueries.set(ownerId, current - 1);
  }
}

// ---------- Handler ----------

export async function queryDataHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;

  // Build QueryPlan from tool args
  const plan = buildQueryPlan(args);
  if (!plan) {
    return { success: false, error: 'Invalid query arguments.' };
  }

  // G7-06: Validate with sanitized error messages
  const errors = validateQueryPlan(plan);
  if (errors.length > 0) {
    return {
      success: false,
      error: 'Invalid query parameters.',
    };
  }

  // G7-04: Check per-entity enumeration limit
  const entropy = checkEntityEntropy(ownerId, plan.entity);
  if (!entropy.allowed) {
    return {
      success: false,
      error: 'Query limit exceeded for this entity. Try again later.',
    };
  }

  // G7-05: Acquire concurrency semaphore
  const sem = acquireSemaphore(ownerId);
  if (!sem.acquired) {
    return {
      success: false,
      error: 'Too many concurrent queries. Please wait.',
    };
  }

  // Execute via engine
  const db = input.db ?? getPool();
  try {
    const result = await executeQuery(plan, ownerId, db);

    return {
      success: result.success,
      data: result.success ? {
        rows: result.rows,
        metadata: {
          rowCount: result.metadata.rowCount,
          truncated: result.metadata.truncated,
          latencyMs: result.metadata.latencyMs,
          entity: result.entity,
          byteSize: result.metadata.byteSize,
          timedOut: result.metadata.timedOut,
        },
      } : undefined,
      error: result.error,
    };
  } finally {
    // G7-05: Always release semaphore
    releaseSemaphore(ownerId);
  }
}

// ---------- QueryPlan builder from tool args ----------

function buildQueryPlan(args: Record<string, unknown>): QueryPlan | null {
  const entity = args.entity as string;
  if (!entity || !QUERY_ENTITIES.includes(entity as QueryEntity)) {
    return null;
  }

  const plan: QueryPlan = { entity: entity as QueryEntity };

  // Filters
  if (Array.isArray(args.filters)) {
    plan.filters = args.filters.map((f: Record<string, unknown>) => ({
      field: String(f.field ?? ''),
      operator: String(f.operator ?? 'eq') as QueryFilter['operator'],
      value: f.value,
    })).filter((f) => f.field !== '');
  }

  // Sort
  if (args.sort && typeof args.sort === 'object') {
    const s = args.sort as Record<string, unknown>;
    if (s.field && (s.direction === 'asc' || s.direction === 'desc')) {
      plan.sort = { field: String(s.field), direction: s.direction as 'asc' | 'desc' };
    }
  }

  // Pagination
  if (args.pagination && typeof args.pagination === 'object') {
    const p = args.pagination as Record<string, unknown>;
    plan.pagination = {};
    if (typeof p.offset === 'number') plan.pagination.offset = p.offset;
    if (typeof p.limit === 'number') plan.pagination.limit = p.limit;
  }

  // Field selection
  if (Array.isArray(args.fields)) {
    plan.fields = args.fields.map(String).filter((f) => f !== '');
  }

  // Aggregation
  if (args.aggregate && typeof args.aggregate === 'object') {
    const a = args.aggregate as Record<string, unknown>;
    if (a.operation && ['count', 'sum', 'avg', 'min', 'max'].includes(String(a.operation))) {
      plan.aggregate = {
        operation: String(a.operation) as QueryAggregate['operation'],
        field: typeof a.field === 'string' ? a.field : undefined,
        groupBy: Array.isArray(a.groupBy) ? a.groupBy.map(String) : undefined,
      };
    }
  }

  return plan;
}
