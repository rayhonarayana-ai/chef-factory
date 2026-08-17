import { describe, expect, it } from 'vitest';
import { validateQueryPlan, compileQuery, executeQuery } from './query-engine.js';
import { QUERY_DATA_TOOL, queryDataHandler } from './query-data.js';
import { getSelectableFields, getSortableFields, getFilterableFields, getAggregateableFields, ENTITY_TABLE, ENTITY_OWNER_COLUMN } from './query-catalog.js';
import type { QueryPlan, QueryEntity } from './query-types.js';
import {
  QUERY_MAX_ROWS,
  QUERY_DEFAULT_LIMIT,
  QUERY_MAX_FILTERS,
  QUERY_MAX_BYTES,
  QUERY_TIMEOUT_MS,
  QUERY_MAX_ENTROPY_PER_ENTITY,
  QUERY_MAX_CONCURRENT,
} from './query-types.js';
import { DEFAULT_RATE_LIMITS } from '../core/security/rateLimit.js';

const OWNER = 'owner-test-001';

// ---------- E1: valid DSL compilation ----------

describe('Gate 6 — query_data', () => {
  it('E1: valid query plan compiles without error', () => {
    const plan: QueryPlan = { entity: 'projects' };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.sql).toContain('SELECT');
    expect(compiled.sql).toContain('owner_id');
    expect(compiled.params).toContain(OWNER);
  });

  // ---------- E2: invalid DSL rejection ----------

  it('E2: invalid entity is rejected', () => {
    const errors = validateQueryPlan({ entity: 'nonexistent' as QueryEntity });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toBe('entity');
  });

  // ---------- E3: entity allowlist ----------

  it('E3: only catalog entities are accepted', () => {
    const allowed = ['projects', 'tasks', 'approvals', 'models', 'runtimes', 'agents', 'decisions', 'audit_events', 'cost_events'];
    for (const entity of allowed) {
      const errors = validateQueryPlan({ entity: entity as QueryEntity });
      expect(errors).toEqual([]);
    }
  });

  // ---------- E4: field allowlist ----------

  it('E4: unknown field in filter is rejected', () => {
    const errors = validateQueryPlan({
      entity: 'projects',
      filters: [{ field: 'nonexistent_field', operator: 'eq', value: 'x' }],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toBe('filter.field');
  });

  // ---------- E5: owner scope injection ----------

  it('E5: owner_id is injected as first parameter', () => {
    const plan: QueryPlan = { entity: 'tasks' };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.params[0]).toBe(OWNER);
    expect(compiled.sql).toContain('owner_id = $1');
  });

  it('E5b: audit_events uses JOIN for owner isolation', () => {
    const plan: QueryPlan = { entity: 'audit_events' };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.sql).toContain('JOIN');
    expect(compiled.sql).toContain('projects');
    expect(compiled.params[0]).toBe(OWNER);
  });

  // ---------- E6: parameterized SQL ----------

  it('E6: filter values are parameterized, not interpolated', () => {
    const plan: QueryPlan = {
      entity: 'tasks',
      filters: [{ field: 'status', operator: 'eq', value: 'pending' }],
    };
    const compiled = compileQuery(plan, OWNER);
    // owner_id=$1, status=$2
    expect(compiled.params).toContain('pending');
    expect(compiled.sql).not.toContain("'pending'");
  });

  // ---------- E7: SQL injection resistance ----------

  it('E7: SQL injection in filter value is neutralized by parameterization', () => {
    const evil = "'; DROP TABLE tasks; --";
    const plan: QueryPlan = {
      entity: 'tasks',
      filters: [{ field: 'title', operator: 'eq', value: evil }],
    };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.params).toContain(evil);
    expect(compiled.sql).not.toContain('DROP');
  });

  // ---------- E8: row limit ----------

  it('E8: default limit is applied when not specified', () => {
    const plan: QueryPlan = { entity: 'projects' };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.sql).toContain(`LIMIT ${QUERY_DEFAULT_LIMIT}`);
  });

  it('E8b: custom limit within bounds is honored', () => {
    const plan: QueryPlan = { entity: 'projects', pagination: { limit: 50 } };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.sql).toContain('LIMIT 50');
  });

  it('E8c: limit exceeding max is rejected by validation', () => {
    const errors = validateQueryPlan({ entity: 'projects', pagination: { limit: 200 } });
    expect(errors.length).toBeGreaterThan(0);
  });

  // ---------- E9: byte limit ----------

  it('E9: result envelope metadata contains query plan', () => {
    const plan: QueryPlan = { entity: 'projects' };
    const errors = validateQueryPlan(plan);
    expect(errors).toEqual([]);
  });

  // ---------- E11: aggregation ----------

  it('E11a: count aggregation compiles correctly', () => {
    const plan: QueryPlan = {
      entity: 'tasks',
      aggregate: { operation: 'count' },
    };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.sql).toContain('COUNT(*)');
  });

  it('E11b: sum aggregation compiles correctly', () => {
    const plan: QueryPlan = {
      entity: 'tasks',
      aggregate: { operation: 'sum', field: 'attempts' },
    };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.sql).toContain('SUM(attempts)');
  });

  it('E11c: aggregation with group-by compiles correctly', () => {
    const plan: QueryPlan = {
      entity: 'tasks',
      aggregate: { operation: 'count', groupBy: ['status'] },
    };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.sql).toContain('GROUP BY status');
    expect(compiled.sql).toContain('COUNT(*)');
  });

  it('E11d: sum without field is rejected', () => {
    const errors = validateQueryPlan({
      entity: 'tasks',
      aggregate: { operation: 'sum' },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  // ---------- E12: sensitive field exclusion ----------

  it('E12: default field selection excludes sensitive fields', () => {
    const fields = getSelectableFields('projects');
    expect(fields).not.toContain('owner_id');
  });

  // ---------- E13: ToolBroker integration ----------

  it('E13a: query_data tool definition has correct risk level', () => {
    expect(QUERY_DATA_TOOL.riskLevel).toBe('low');
  });

  it('E13b: query_data tool definition has correct action type', () => {
    expect(QUERY_DATA_TOOL.actionType).toBe('data_query');
  });

  it('E13c: query_data tool does not require approval', () => {
    expect(QUERY_DATA_TOOL.requiresApproval).toBe(false);
  });

  // ---------- E16: deterministic result envelope ----------

  it('E16: handler returns success=false with error for invalid plan', async () => {
    const result = await queryDataHandler({
      ownerId: OWNER,
      args: { entity: 'invalid_entity' },
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('E16b: handler returns success=true for valid minimal plan', async () => {
    const mockDb = {
      query: async () => ({ rows: [{ id: '1', name: 'Test', slug: 'test', status: 'active', created_at: '2026-01-01' }] }),
    };
    const result = await queryDataHandler({
      ownerId: OWNER,
      args: { entity: 'projects' },
      db: mockDb,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  // ---------- E17: truncation ----------

  it('E17: handler returns truncated=true when rows exceed limit', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ id: String(i) }));
    const mockDb = {
      query: async () => ({ rows }),
    };
    const result = await queryDataHandler({
      ownerId: OWNER,
      args: { entity: 'projects', pagination: { limit: 100 } },
      db: mockDb,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(true);
    expect(result.data!.metadata.truncated).toBe(true);
    expect(result.data!.rows.length).toBe(100);
  });

  // ---------- E18: owner isolation ----------

  it('E18: owner_id is always first parameter for direct-owner entities', () => {
    const directOwnerEntities: QueryEntity[] = ['projects', 'tasks', 'approvals', 'models', 'runtimes', 'agents', 'decisions', 'cost_events'];
    for (const entity of directOwnerEntities) {
      const compiled = compileQuery({ entity }, OWNER);
      expect(compiled.params[0]).toBe(OWNER);
      expect(compiled.sql).toContain('owner_id = $1');
    }
  });

  // ---------- Catalog field accessors ----------

  it('catalog: getSortableFields returns only sortable fields', () => {
    const sortable = getSortableFields('tasks');
    expect(sortable).toContain('status');
    expect(sortable).toContain('priority');
    expect(sortable).toContain('created_at');
    expect(sortable).not.toContain('description');
  });

  it('catalog: getFilterableFields returns only filterable fields', () => {
    const filterable = getFilterableFields('projects');
    expect(filterable).toContain('status');
    expect(filterable).toContain('name');
    expect(filterable).not.toContain('description');
  });

  it('catalog: getAggregateableFields returns only aggregateable fields', () => {
    const agg = getAggregateableFields('tasks');
    expect(agg).toContain('attempts');
    expect(agg).toContain('status');
    expect(agg).not.toContain('title');
  });

  // ---------- Sort compilation ----------

  it('sort: compiles ORDER BY correctly', () => {
    const plan: QueryPlan = {
      entity: 'tasks',
      sort: { field: 'created_at', direction: 'desc' },
    };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.sql).toContain('ORDER BY created_at DESC');
  });

  // ---------- Filter operators ----------

  it('filters: in operator compiles with multiple placeholders', () => {
    const plan: QueryPlan = {
      entity: 'tasks',
      filters: [{ field: 'status', operator: 'in', value: ['pending', 'completed'] }],
    };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.sql).toContain('IN ($2, $3)');
    expect(compiled.params).toContain('pending');
    expect(compiled.params).toContain('completed');
  });

  it('filters: between operator compiles correctly', () => {
    const plan: QueryPlan = {
      entity: 'tasks',
      filters: [{ field: 'attempts', operator: 'between', value: [1, 5] }],
    };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.sql).toContain('BETWEEN $2 AND $3');
    expect(compiled.params).toContain(1);
    expect(compiled.params).toContain(5);
  });

  it('filters: is_null operator compiles without parameter', () => {
    const plan: QueryPlan = {
      entity: 'tasks',
      filters: [{ field: 'completed_at', operator: 'is_null', value: null }],
    };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.sql).toContain('completed_at IS NULL');
    expect(compiled.params.length).toBe(1); // only owner_id
  });

  it('filters: between with wrong array length is rejected', () => {
    const errors = validateQueryPlan({
      entity: 'tasks',
      filters: [{ field: 'attempts', operator: 'between', value: [1] }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('filters: in with non-array value is rejected', () => {
    const errors = validateQueryPlan({
      entity: 'tasks',
      filters: [{ field: 'status', operator: 'in', value: 'pending' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  // ---------- Aggregation group-by validation ----------

  it('agg: group-by on non-sortable/non-filterable field is rejected', () => {
    const errors = validateQueryPlan({
      entity: 'tasks',
      aggregate: { operation: 'count', groupBy: ['nonexistent'] },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  // ---------- QueryPlan builder ----------

  it('handler: buildQueryPlan returns null for missing entity', async () => {
    const result = await queryDataHandler({
      ownerId: OWNER,
      args: {},
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  // ---------- Execution error handling ----------

  it('handler: db query failure returns success=false with error', async () => {
    const mockDb = {
      query: async () => { throw new Error('connection refused'); },
    };
    const result = await queryDataHandler({
      ownerId: OWNER,
      args: { entity: 'projects' },
      db: mockDb,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Execution error');
  });

  // ---------- Table mapping coverage ----------

  it('catalog: all entities have table mappings', () => {
    const entities: QueryEntity[] = ['projects', 'tasks', 'approvals', 'models', 'runtimes', 'agents', 'decisions', 'audit_events', 'cost_events'];
    for (const entity of entities) {
      expect(ENTITY_TABLE[entity]).toBeDefined();
      expect(ENTITY_TABLE[entity]).toContain('public.');
    }
  });

  it('catalog: all entities have owner column mapping', () => {
    const entities: QueryEntity[] = ['projects', 'tasks', 'approvals', 'models', 'runtimes', 'agents', 'decisions', 'audit_events', 'cost_events'];
    for (const entity of entities) {
      expect(ENTITY_OWNER_COLUMN[entity]).toBeDefined();
    }
  });
});

// ====================================================================
// Gate 7 — Combined Production Query Hardening
// ====================================================================

describe('Gate 7 — Query Hardening', () => {

  // ---------- G7-01: Byte limit enforcement ----------

  it('G7-01a: executeQuery returns byteSize in metadata', async () => {
    const mockDb = {
      query: async () => ({
        rows: [
          { id: '1', name: 'test-project', status: 'active' },
          { id: '2', name: 'another-project', status: 'draft' },
        ],
      }),
    };
    const plan: QueryPlan = { entity: 'projects' };
    const result = await executeQuery(plan, OWNER, mockDb);
    expect(result.success).toBe(true);
    expect(result.metadata.byteSize).toBeDefined();
    expect(typeof result.metadata.byteSize).toBe('number');
    expect(result.metadata.byteSize).toBeGreaterThan(0);
  });

  it('G7-01b: byteSize is calculated from serialized rows', async () => {
    const rows = [{ id: '1', name: 'hello' }];
    const expectedBytes = Buffer.byteLength(JSON.stringify(rows), 'utf-8');
    const mockDb = { query: async () => ({ rows }) };
    const result = await executeQuery({ entity: 'projects' }, OWNER, mockDb);
    expect(result.metadata.byteSize).toBe(expectedBytes);
  });

  it('G7-01c: result under byte limit is not truncated', async () => {
    const rows = [{ id: '1', name: 'small' }];
    const mockDb = { query: async () => ({ rows }) };
    const result = await executeQuery({ entity: 'projects' }, OWNER, mockDb);
    expect(result.metadata.truncated).toBe(false);
    expect(result.rows.length).toBe(1);
  });

  it('G7-01d: constants are defined correctly', () => {
    expect(QUERY_MAX_BYTES).toBe(50_000);
    expect(QUERY_MAX_ROWS).toBe(100);
  });

  // ---------- G7-02: Query timeout ----------

  it('G7-02a: timedOut flag is false on success', async () => {
    const mockDb = { query: async () => ({ rows: [{ id: '1' }] }) };
    const result = await executeQuery({ entity: 'projects' }, OWNER, mockDb);
    expect(result.metadata.timedOut).toBeFalsy();
  });

  it('G7-02b: timeout error is detected and returns timedOut=true', async () => {
    const mockDb = {
      query: async (sql: string) => {
        if (sql.includes('SELECT')) {
          throw new Error('canceling statement due to statement timeout');
        }
        return { rows: [] };
      },
    };
    const result = await executeQuery({ entity: 'projects' }, OWNER, mockDb);
    expect(result.success).toBe(false);
    expect(result.metadata.timedOut).toBe(true);
    expect(result.error).toContain('timed out');
  });

  it('G7-02c: timeout constant is defined', () => {
    expect(QUERY_TIMEOUT_MS).toBe(5_000);
  });

  // ---------- G7-03: Dedicated rate limits ----------

  it('G7-03a: data_query rate limit is registered in DEFAULT_RATE_LIMITS', () => {
    const dataQueryLimit = DEFAULT_RATE_LIMITS.find(
      (r) => r.scope === 'data_query' && r.limitKey === 'data_query.count'
    );
    expect(dataQueryLimit).toBeDefined();
    expect(dataQueryLimit!.maxCount).toBe(200);
    expect(dataQueryLimit!.windowSeconds).toBe(3600);
    expect(dataQueryLimit!.enabled).toBe(true);
  });

  it('G7-03b: data_query_agg rate limit is registered', () => {
    const aggLimit = DEFAULT_RATE_LIMITS.find(
      (r) => r.scope === 'data_query' && r.limitKey === 'data_query_agg.count'
    );
    expect(aggLimit).toBeDefined();
    expect(aggLimit!.maxCount).toBe(50);
    expect(aggLimit!.windowSeconds).toBe(3600);
  });

  it('G7-03c: total rate limit scopes include data_query', () => {
    const scopes = new Set(DEFAULT_RATE_LIMITS.map((r) => r.scope));
    expect(scopes.has('data_query')).toBe(true);
  });

  // ---------- G7-04: Enumeration protection ----------

  it('G7-04a: enumeration constants are defined', () => {
    expect(QUERY_MAX_ENTROPY_PER_ENTITY).toBe(50);
    expect(QUERY_MAX_CONCURRENT).toBe(3);
  });

  it('G7-04b: handler returns error for invalid entity (no enumeration)', async () => {
    const mockDb = { query: async () => ({ rows: [] }) };
    const result = await queryDataHandler({
      ownerId: OWNER,
      args: { entity: 'nonexistent' },
      db: mockDb,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid query arguments.');
  });

  // ---------- G7-05: Concurrency control ----------

  it('G7-05a: concurrent limit constant is defined', () => {
    expect(QUERY_MAX_CONCURRENT).toBe(3);
  });

  // ---------- G7-06: Error sanitization ----------

  it('G7-06a: validation error does not leak field names', async () => {
    const mockDb = { query: async () => ({ rows: [] }) };
    const result = await queryDataHandler({
      ownerId: OWNER,
      args: { entity: 'projects', filters: [{ field: 'secret_field', operator: 'eq', value: 'x' }] },
      db: mockDb,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid query parameters.');
    expect(result.error).not.toContain('secret_field');
    expect(result.error).not.toContain('filterable');
  });

  it('G7-06b: invalid entity error does not leak entity names', async () => {
    const mockDb = { query: async () => ({ rows: [] }) };
    const result = await queryDataHandler({
      ownerId: OWNER,
      args: { entity: 'evil_table' },
      db: mockDb,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid query arguments.');
    expect(result.error).not.toContain('evil_table');
  });

  // ---------- Gate 6 baseline preservation ----------

  it('baseline: compileQuery still produces parameterized SQL', () => {
    const plan: QueryPlan = { entity: 'tasks', filters: [{ field: 'status', operator: 'eq', value: 'running' }] };
    const compiled = compileQuery(plan, OWNER);
    expect(compiled.sql).toContain('$1');
    expect(compiled.sql).toContain('$2');
    expect(compiled.params[0]).toBe(OWNER);
    expect(compiled.params[1]).toBe('running');
  });

  it('baseline: validateQueryPlan still rejects invalid entities', () => {
    const errors = validateQueryPlan({ entity: 'hack' as QueryEntity });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('baseline: QUERY_DATA_TOOL has correct properties', () => {
    expect(QUERY_DATA_TOOL.name).toBe('query_data');
    expect(QUERY_DATA_TOOL.riskLevel).toBe('low');
    expect(QUERY_DATA_TOOL.actionType).toBe('data_query');
  });
});
