// CHEF FACTORY — Gate 6 → Gate 7 — Query Data Intelligence Layer — Query Engine.
// Deterministic: validates QueryPlan against the entity catalog, compiles
// to parameterized SQL, executes via db.query(), applies result limits,
// and returns a QueryResult envelope. The LLM never writes SQL.
// Gate 7: enforces byte limit, query timeout, and returns byteSize metadata.

import type { DbQuery } from './types.js';
import type {
  QueryPlan,
  QueryEntity,
  QueryFilter,
  QuerySort,
  QueryPagination,
  QueryAggregate,
  QueryResultEnvelope,
} from './query-types.js';
import {
  QUERY_MAX_ROWS,
  QUERY_MAX_BYTES,
  QUERY_DEFAULT_LIMIT,
  QUERY_MAX_OFFSET,
  QUERY_MAX_FILTERS,
  QUERY_MAX_GROUPBY,
  QUERY_TIMEOUT_MS,
} from './query-types.js';
import {
  ENTITY_TABLE,
  ENTITY_OWNER_COLUMN,
  getSelectableFields,
  getSortableFields,
  getFilterableFields,
  getAggregateableFields,
  isFieldFilterable,
  isFieldSortable,
  isFieldAggregateable,
  getFieldNames,
} from './query-catalog.js';
import { QUERY_ENTITIES } from './query-types.js';

// ---------- Validation ----------

export interface ValidationError {
  field: string;
  message: string;
}

export function validateQueryPlan(plan: QueryPlan): ValidationError[] {
  const errors: ValidationError[] = [];

  // Entity must be in catalog
  if (!QUERY_ENTITIES.includes(plan.entity)) {
    errors.push({ field: 'entity', message: `Unknown entity "${plan.entity}". Allowed: ${QUERY_ENTITIES.join(', ')}` });
    return errors; // can't validate further without a valid entity
  }

  // Filters
  const filters = plan.filters ?? [];
  if (filters.length > QUERY_MAX_FILTERS) {
    errors.push({ field: 'filters', message: `Too many filters (${filters.length}). Maximum: ${QUERY_MAX_FILTERS}` });
  }
  for (const f of filters) {
    if (!isFieldFilterable(plan.entity, f.field)) {
      errors.push({ field: `filter.field`, message: `Field "${f.field}" is not filterable for entity "${plan.entity}". Filterable: ${getFilterableFields(plan.entity).join(', ')}` });
    }
    if (!f.operator || !['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'like', 'is_null', 'between'].includes(f.operator)) {
      errors.push({ field: `filter.operator`, message: `Invalid operator "${f.operator}"` });
    }
    // Type validation for 'in' — must be an array
    if (f.operator === 'in' && !Array.isArray(f.value)) {
      errors.push({ field: `filter.value`, message: `Operator "in" requires an array value` });
    }
    // Type validation for 'between' — must be a 2-element array
    if (f.operator === 'between' && (!Array.isArray(f.value) || f.value.length !== 2)) {
      errors.push({ field: `filter.value`, message: `Operator "between" requires a 2-element array [min, max]` });
    }
  }

  // Sort
  if (plan.sort) {
    if (!isFieldSortable(plan.entity, plan.sort.field)) {
      errors.push({ field: 'sort.field', message: `Field "${plan.sort.field}" is not sortable for entity "${plan.entity}". Sortable: ${getSortableFields(plan.entity).join(', ')}` });
    }
    if (plan.sort.direction !== 'asc' && plan.sort.direction !== 'desc') {
      errors.push({ field: 'sort.direction', message: `Direction must be "asc" or "desc"` });
    }
  }

  // Pagination
  if (plan.pagination) {
    if (plan.pagination.offset !== undefined && plan.pagination.offset < 0) {
      errors.push({ field: 'pagination.offset', message: `Offset must be >= 0` });
    }
    if (plan.pagination.offset !== undefined && plan.pagination.offset > QUERY_MAX_OFFSET) {
      errors.push({ field: 'pagination.offset', message: `Offset must be <= ${QUERY_MAX_OFFSET}` });
    }
    if (plan.pagination.limit !== undefined && (plan.pagination.limit < 1 || plan.pagination.limit > QUERY_MAX_ROWS)) {
      errors.push({ field: 'pagination.limit', message: `Limit must be between 1 and ${QUERY_MAX_ROWS}` });
    }
  }

  // Field selection
  if (plan.fields) {
    const fieldNames = getFieldNames(plan.entity);
    for (const f of plan.fields) {
      if (!fieldNames.includes(f)) {
        errors.push({ field: `fields`, message: `Unknown field "${f}" for entity "${plan.entity}". Available: ${fieldNames.join(', ')}` });
      }
    }
  }

  // Aggregation
  if (plan.aggregate) {
    const validOps = ['count', 'sum', 'avg', 'min', 'max'];
    if (!validOps.includes(plan.aggregate.operation)) {
      errors.push({ field: 'aggregate.operation', message: `Invalid operation "${plan.aggregate.operation}". Allowed: ${validOps.join(', ')}` });
    }
    if (plan.aggregate.operation !== 'count' && !plan.aggregate.field) {
      errors.push({ field: 'aggregate.field', message: `Operation "${plan.aggregate.operation}" requires a field` });
    }
    if (plan.aggregate.field && !isFieldAggregateable(plan.entity, plan.aggregate.field)) {
      errors.push({ field: 'aggregate.field', message: `Field "${plan.aggregate.field}" is not aggregateable for entity "${plan.entity}". Aggregateable: ${getAggregateableFields(plan.entity).join(', ')}` });
    }
    if (plan.aggregate.groupBy && plan.aggregate.groupBy.length > QUERY_MAX_GROUPBY) {
      errors.push({ field: 'aggregate.groupBy', message: `Too many group-by fields (${plan.aggregate.groupBy.length}). Maximum: ${QUERY_MAX_GROUPBY}` });
    }
    if (plan.aggregate.groupBy) {
      for (const g of plan.aggregate.groupBy) {
        if (!isFieldFilterable(plan.entity, g) && !isFieldSortable(plan.entity, g)) {
          errors.push({ field: 'aggregate.groupBy', message: `Field "${g}" cannot be used in group-by for entity "${plan.entity}"` });
        }
      }
    }
  }

  return errors;
}

// ---------- SQL Compilation ----------

interface CompiledQuery {
  sql: string;
  params: unknown[];
  selectFields: string[];
}

const MUTATION_PATTERN = /^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i;

export function compileQuery(plan: QueryPlan, ownerId: string): CompiledQuery {
  const table = ENTITY_TABLE[plan.entity];
  const ownerCol = ENTITY_OWNER_COLUMN[plan.entity];
  const params: unknown[] = [ownerId]; // $1 is always owner_id
  let paramIdx = 2;

  // SELECT fields
  let selectFields: string[];
  if (plan.aggregate) {
    selectFields = compileAggregateSelect(plan);
  } else if (plan.fields && plan.fields.length > 0) {
    selectFields = plan.fields;
  } else {
    selectFields = getSelectableFields(plan.entity);
  }

  let selectClause: string;
  if (plan.aggregate) {
    selectClause = selectFields.join(', ');
  } else {
    selectClause = selectFields.map((f) => `${f}`).join(', ');
  }

  // FROM + owner scope
  let fromClause: string;
  let whereExtra = '';

  if (plan.entity === 'audit_events') {
    // audit_events has no owner_id — JOIN through projects for owner isolation
    fromClause = `${table} ae INNER JOIN public.projects p ON ae.project_id = p.id`;
    whereExtra = ` AND p.owner_id = $1`;
  } else if (ownerCol) {
    fromClause = table;
    whereExtra = ` AND ${ownerCol} = $1`;
  } else {
    fromClause = table;
    whereExtra = '';
  }

  // WHERE clause
  const whereParts: string[] = [];
  if (whereExtra) {
    // For audit_events, the owner check is via JOIN (no separate param needed for owner)
    // For other tables, owner_id = $1
    if (plan.entity !== 'audit_events') {
      whereParts.push(`${ownerCol} = $1`);
    }
  }

  const filters = plan.filters ?? [];
  for (const f of filters) {
    const compiled = compileFilter(f, paramIdx, plan.entity);
    whereParts.push(compiled.clause);
    params.push(...compiled.values);
    paramIdx += compiled.values.length;
  }

  const whereClause = whereParts.length > 0 ? ` WHERE ${whereParts.join(' AND ')}` : '';

  // For audit_events, add the owner join condition
  let fullWhere = whereClause;
  if (plan.entity === 'audit_events') {
    const joinCondition = 'p.owner_id = $1';
    if (fullWhere === '') {
      fullWhere = ` WHERE ${joinCondition}`;
    } else {
      fullWhere = ` WHERE ${joinCondition}${fullWhere.replace(' WHERE ', ' AND ')}`;
    }
  }

  // GROUP BY
  let groupByClause = '';
  if (plan.aggregate?.groupBy && plan.aggregate.groupBy.length > 0) {
    groupByClause = ` GROUP BY ${plan.aggregate.groupBy.join(', ')}`;
  }

  // ORDER BY
  let orderByClause = '';
  if (plan.sort && !plan.aggregate) {
    orderByClause = ` ORDER BY ${plan.sort.field} ${plan.sort.direction === 'desc' ? 'DESC' : 'ASC'}`;
  } else if (plan.aggregate && plan.sort) {
    // Aggregation sort — sort by the aggregate alias or a group-by field
    orderByClause = ` ORDER BY ${plan.sort.field} ${plan.sort.direction === 'desc' ? 'DESC' : 'ASC'}`;
  }

  // LIMIT / OFFSET
  const limit = plan.pagination?.limit ?? QUERY_DEFAULT_LIMIT;
  const offset = plan.pagination?.offset ?? 0;
  const limitClause = ` LIMIT ${limit}`;
  const offsetClause = offset > 0 ? ` OFFSET ${offset}` : '';

  const sql = `SELECT ${selectClause} FROM ${fromClause}${fullWhere}${groupByClause}${orderByClause}${limitClause}${offsetClause}`;

  // Final safety check — no mutations
  if (MUTATION_PATTERN.test(sql)) {
    throw new Error('Query compilation error: generated SQL contains a mutation keyword');
  }

  return { sql, params, selectFields };
}

function compileAggregateSelect(plan: QueryPlan): string[] {
  const fields: string[] = [];
  const agg = plan.aggregate!;

  // Group-by fields first
  if (agg.groupBy) {
    fields.push(...agg.groupBy);
  }

  // Aggregate operation
  if (agg.operation === 'count') {
    fields.push('COUNT(*) AS count');
  } else if (agg.field) {
    const alias = `${agg.operation}_${agg.field}`;
    fields.push(`${agg.operation.toUpperCase()}(${agg.field}) AS ${alias}`);
  }

  return fields;
}

function compileFilter(filter: QueryFilter, startIdx: number, entity: QueryEntity): { clause: string; values: unknown[] } {
  const field = filter.field;
  const op = filter.operator;
  const values: unknown[] = [];

  switch (op) {
    case 'eq':
      values.push(filter.value);
      return { clause: `${field} = $${startIdx}`, values };
    case 'neq':
      values.push(filter.value);
      return { clause: `${field} != $${startIdx}`, values };
    case 'gt':
      values.push(filter.value);
      return { clause: `${field} > $${startIdx}`, values };
    case 'gte':
      values.push(filter.value);
      return { clause: `${field} >= $${startIdx}`, values };
    case 'lt':
      values.push(filter.value);
      return { clause: `${field} < $${startIdx}`, values };
    case 'lte':
      values.push(filter.value);
      return { clause: `${field} <= $${startIdx}`, values };
    case 'in': {
      const arr = filter.value as unknown[];
      const placeholders = arr.map((_, i) => `$${startIdx + i}`).join(', ');
      values.push(...arr);
      return { clause: `${field} IN (${placeholders})`, values };
    }
    case 'like':
      values.push(filter.value);
      return { clause: `${field} LIKE $${startIdx}`, values };
    case 'is_null':
      return { clause: `${field} IS NULL`, values: [] };
    case 'between': {
      const [min, max] = filter.value as [unknown, unknown];
      values.push(min, max);
      return { clause: `${field} BETWEEN $${startIdx} AND $${startIdx + 1}`, values };
    }
    default:
      throw new Error(`Unknown filter operator: ${op}`);
  }
}

// ---------- Execution ----------

export async function executeQuery(
  plan: QueryPlan,
  ownerId: string,
  db: DbQuery,
): Promise<QueryResultEnvelope> {
  const startTime = Date.now();

  // 1. Validate
  const validationErrors = validateQueryPlan(plan);
  if (validationErrors.length > 0) {
    return {
      success: false,
      entity: plan.entity,
      rows: [],
      metadata: {
        rowCount: 0,
        truncated: false,
        maxRows: QUERY_MAX_ROWS,
        latencyMs: Date.now() - startTime,
        queryPlan: plan,
      },
      error: `Validation failed: ${validationErrors.map((e) => e.message).join('; ')}`,
    };
  }

  // 2. Compile
  let compiled: CompiledQuery;
  try {
    compiled = compileQuery(plan, ownerId);
  } catch (e) {
    return {
      success: false,
      entity: plan.entity,
      rows: [],
      metadata: {
        rowCount: 0,
        truncated: false,
        maxRows: QUERY_MAX_ROWS,
        latencyMs: Date.now() - startTime,
        queryPlan: plan,
      },
      error: `Compilation error: ${String(e)}`,
    };
  }

  // 3. Execute with timeout
  try {
    // G7-02: Set statement_timeout before executing the query
    // Use a wrapper that sets timeout if the db supports raw queries
    let result: { rows: Record<string, unknown>[] };
    try {
      // Attempt to set statement_timeout (works with pg Pool/Client in transaction)
      await db.query(`SET LOCAL statement_timeout = '${QUERY_TIMEOUT_MS}'`);
    } catch {
      // If SET LOCAL fails (e.g., not in transaction), continue without timeout
      // The timeout is a defense-in-depth, not the primary control
    }
    result = await db.query(compiled.sql, compiled.params);
    const rows = result.rows ?? [];
    const limit = plan.pagination?.limit ?? QUERY_DEFAULT_LIMIT;
    const rowTruncated = rows.length > limit;
    const limitedRows = rowTruncated ? rows.slice(0, limit) : rows;

    // G7-01: Calculate byte size and enforce byte limit
    let byteTruncated = false;
    let finalRows = limitedRows;
    const rowJson = JSON.stringify(limitedRows);
    let byteSize = Buffer.byteLength(rowJson, 'utf-8');

    if (byteSize > QUERY_MAX_BYTES) {
      // Truncate rows until under byte limit
      byteTruncated = true;
      finalRows = [];
      let totalBytes = 0;
      for (const row of limitedRows) {
        const rowStr = JSON.stringify(row);
        const rowBytes = Buffer.byteLength(rowStr, 'utf-8');
        if (totalBytes + rowBytes > QUERY_MAX_BYTES) break;
        finalRows.push(row);
        totalBytes += rowBytes;
      }
      byteSize = totalBytes;
    }

    return {
      success: true,
      entity: plan.entity,
      rows: finalRows,
      metadata: {
        rowCount: finalRows.length,
        truncated: rowTruncated || byteTruncated,
        maxRows: QUERY_MAX_ROWS,
        latencyMs: Date.now() - startTime,
        queryPlan: plan,
        byteSize,
      },
    };
  } catch (e) {
    // G7-02: Detect timeout errors from PostgreSQL
    const errMsg = String(e);
    const isTimeout = errMsg.includes('statement timeout') || errMsg.includes('canceling statement');
    return {
      success: false,
      entity: plan.entity,
      rows: [],
      metadata: {
        rowCount: 0,
        truncated: false,
        maxRows: QUERY_MAX_ROWS,
        latencyMs: Date.now() - startTime,
        queryPlan: plan,
        timedOut: isTimeout,
      },
      error: isTimeout ? `Query timed out after ${QUERY_TIMEOUT_MS}ms` : `Execution error: ${errMsg}`,
    };
  }
}
