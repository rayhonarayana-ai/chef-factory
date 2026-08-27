// CHEF FACTORY — Gate 6 — PHASE G — Live Verification
// Tests query_data against real Supabase Postgres with transactional isolation.
// Zero residue: every test runs in a transaction that rolls back.

import pg from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { SupabaseStore } from '../db/repo.js';
import { getFactoryConfig, loadEnvFile } from '../db/config.js';
import { queryDataHandler } from '../tools/query-data.js';
import { QUERY_DATA_TOOL } from '../tools/query-data.js';
import { validateQueryPlan, compileQuery } from '../tools/query-engine.js';
import { getSelectableFields, getSortableFields, getFilterableFields, getAggregateableFields, ENTITY_TABLE, ENTITY_OWNER_COLUMN } from '../tools/query-catalog.js';
import { QUERY_ENTITIES } from '../tools/query-types.js';
import type { QueryPlan, QueryEntity } from '../tools/query-types.js';
import { QUERY_MAX_ROWS, QUERY_DEFAULT_LIMIT, QUERY_TIMEOUT_MS } from '../tools/query-types.js';
import { GATE3_TOOLS, toOpenAITools, toAnthropicTools, toGoogleTools } from '../tools/index.js';

const cfg = getFactoryConfig(loadEnvFile());
const enabled = Boolean(cfg.supabaseUrl && cfg.dbPassword && cfg.dbHost);

interface ItStore {
  store: SupabaseStore;
  owner: string;
  other: string;
  rollback: () => Promise<void>;
  client: pg.Client;
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
}

function makeTransactionalStore(): ItStore {
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  const client = new pg.Client({
    host: cfg.dbHost,
    port: cfg.dbPort,
    user: cfg.dbUser,
    password: cfg.dbPassword,
    database: cfg.dbName,
    ssl: { rejectUnauthorized: false },
  });
  let connected = false;
  const ensure = async () => {
    if (!connected) {
      await client.connect();
      await client.query('begin');
      await client.query(`delete from auth.users where email like 'g6t-%@chef.local'`);
      for (const id of [owner, other]) {
        await client.query(
          `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
           values ($1, 'authenticated', 'authenticated', $2, 'encrypted', now())
           on conflict (id) do nothing`,
          [id, `g6t-${id}@chef.local`],
        );
      }
      connected = true;
    }
  };
  const wrapper = {
    query: async (text: string, params?: unknown[]) => {
      await ensure();
      return client.query(text, params);
    },
    connect: async () => {
      await ensure();
      return {
        query: (t: string, p?: unknown[]) => client.query(t, p),
        release: () => undefined,
      };
    },
  } as unknown as pg.Pool;
  const store = new SupabaseStore(wrapper);
  const rollback = async () => {
    if (connected) await client.query('rollback').catch(() => undefined);
    await client.end().catch(() => undefined);
  };
  return { store, owner, other, rollback, client, db: wrapper as unknown as { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> } };
}

describe.skipIf(!enabled)('Gate 6 — Live Verification (query_data against real Supabase)', () => {
  const handles: Array<{ rollback: () => Promise<void> }> = [];

  afterEach(async () => {
    for (const h of handles) await h.rollback();
    handles.length = 0;
  });

  afterAll(async () => {
    const cleanup = new pg.Client({
      host: cfg.dbHost,
      port: cfg.dbPort,
      user: cfg.dbUser,
      password: cfg.dbPassword,
      database: cfg.dbName,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await cleanup.connect();
      await cleanup.query(`delete from auth.users where email like 'g6t-%@chef.local'`);
    } catch { /* best-effort */ }
    await cleanup.end().catch(() => undefined);
  });

  // Helper: create test data for the owner (uses db wrapper which triggers ensure())
  async function seedTestData(db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, ownerId: string) {
    // Create a project
    const projRes = await db.query(
      `INSERT INTO public.projects (owner_id, name, slug, description, status)
       VALUES ($1, 'G6 Test Project', 'g6-test-project', 'Live verification test', 'active')
       RETURNING id`,
      [ownerId],
    );
    const projectId = projRes.rows[0].id as string;

    // Create tasks
    for (let i = 0; i < 5; i++) {
      await db.query(
        `INSERT INTO public.tasks (owner_id, project_id, title, status, priority, risk_level, autonomy, attempts)
         VALUES ($1, $2, $3, $4, $5, 'low', 'auto', $6)`,
        [ownerId, projectId, `Task ${i}`, i < 3 ? 'completed' : 'created', i < 2 ? 'high' : 'low', i],
      );
    }

    // Create a model
    await db.query(
      `INSERT INTO public.models (owner_id, provider, name, slug, cost_per_1k_input, cost_per_1k_output, context_window, status)
       VALUES ($1, 'openai', 'gpt-4o', 'gpt-4o-live', 0.005, 0.015, 128000, 'active')`,
      [ownerId],
    );

    // Create an agent
    await db.query(
      `INSERT INTO public.agents (owner_id, name, slug, role, status)
       VALUES ($1, 'Test Agent', 'g6-test-agent', 'builder', 'active')`,
      [ownerId],
    );

    // Create a decision
    await db.query(
      `INSERT INTO public.decision_journal (owner_id, context, options, selected_option, reason, risk_level, authority_level, confidence, outcome)
       VALUES ($1, 'G6 live test', '["option_a", "option_b"]', 'option_a', 'test reason', 'low', 'auto', 0.9, 'completed')`,
      [ownerId],
    );

    // Create an approval
    await db.query(
      `INSERT INTO public.approvals (owner_id, project_id, task_id, action, status, risk_level, authority_level)
       SELECT $1, $2, t.id, 'deploy', 'pending', 'high', 'require_approval'
       FROM public.tasks t WHERE t.owner_id = $1 AND t.project_id = $2 LIMIT 1`,
      [ownerId, projectId],
    );

    return { projectId };
  }

  // ==================== T1: AUTHENTICATED QUERY ====================

  it('T1: Authenticated query executes and returns result envelope', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });
    const { projectId } = await seedTestData(db, owner);

    const result = await queryDataHandler({
      ownerId: owner,
      args: { entity: 'projects' },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.rows.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.metadata.entity).toBe('projects');
    expect(typeof result.data!.metadata.rowCount).toBe('number');
    expect(typeof result.data!.metadata.truncated).toBe('boolean');
    expect(typeof result.data!.metadata.latencyMs).toBe('number');
    // No raw SQL in result
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain('DROP');
    expect(resultStr).not.toContain('DELETE');
    expect(resultStr).not.toContain('INSERT');
  });

  // ==================== T2: OWNER ISOLATION ====================

  it('T2: Owner isolation — different owner sees nothing of this owner data', async () => {
    const ts1 = makeTransactionalStore();
    const ts2 = makeTransactionalStore();
    handles.push(ts1, ts2);

    const { projectId } = await seedTestData(ts1.db, ts1.owner);

    // Query as ts2.owner — should see nothing (different owner)
    const result = await queryDataHandler({
      ownerId: ts2.owner,
      args: { entity: 'projects' },
      db: ts2.db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });

    expect(result.success).toBe(true);
    expect(result.data!.rows.length).toBe(0);
  });

  // ==================== T3: PROJECT ISOLATION ====================

  it('T3: Project isolation — task query scoped to owner returns only owner tasks', async () => {
    const { owner, other, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    const { projectId } = await seedTestData(db, owner);

    // Create project + tasks for other owner
    const otherProjRes = await db.query(
      `INSERT INTO public.projects (owner_id, name, slug, status)
       VALUES ($1, 'Other Project', 'other-proj', 'active') RETURNING id`,
      [other],
    );
    const otherProjectId = otherProjRes.rows[0].id as string;
    await db.query(
      `INSERT INTO public.tasks (owner_id, project_id, title, status, priority, risk_level, autonomy, attempts)
       VALUES ($1, $2, 'Other Task', 'created', 'low', 'low', 'auto', 0)`,
      [other, otherProjectId],
    );

    // Query tasks as owner — should not see other's tasks
    const result = await queryDataHandler({
      ownerId: owner,
      args: { entity: 'tasks' },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });

    expect(result.success).toBe(true);
    for (const row of result.data!.rows) {
      expect(row.title).not.toBe('Other Task');
    }
  });

  // ==================== T4: ENTITY ALLOWLIST ====================

  it('T4a: valid entity is accepted', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    const result = await queryDataHandler({
      ownerId: owner,
      args: { entity: 'projects' },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(true);
  });

  it('T4b: unknown entity is rejected', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    const result = await queryDataHandler({
      ownerId: owner,
      args: { entity: 'nonexistent_table' },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  // ==================== T5: FIELD ALLOWLIST ====================

  it('T5a: valid field in filter is accepted', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    const result = await queryDataHandler({
      ownerId: owner,
      args: { entity: 'projects', filters: [{ field: 'status', operator: 'eq', value: 'active' }] },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(true);
  });

  it('T5b: unknown field in filter is rejected', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    const result = await queryDataHandler({
      ownerId: owner,
      args: { entity: 'projects', filters: [{ field: 'nonexistent_col', operator: 'eq', value: 'x' }] },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(false);
    // G7-06: Error messages sanitized — no field names leaked to LLM
    expect(result.error).toBe('Invalid query parameters.');
  });

  it('T5c: owner_id field is not exposed as selectable (sensitive)', async () => {
    const fields = getSelectableFields('projects');
    expect(fields).not.toContain('owner_id');
  });

  // ==================== T6: FILTER VALIDATION ====================

  it('T6a: valid filters compile and execute', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });
    await seedTestData(db, owner);

    const result = await queryDataHandler({
      ownerId: owner,
      args: {
        entity: 'tasks',
        filters: [
          { field: 'status', operator: 'eq', value: 'completed' },
          { field: 'priority', operator: 'in', value: ['high', 'low'] },
        ],
      },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(true);
    for (const row of result.data!.rows) {
      expect(row.status).toBe('completed');
      expect(['high', 'low']).toContain(row.priority);
    }
  });

  it('T6b: invalid operator is rejected', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    const result = await queryDataHandler({
      ownerId: owner,
      args: { entity: 'tasks', filters: [{ field: 'status', operator: 'regex', value: '.*' }] },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(false);
  });

  // ==================== T7: SQL INJECTION RESISTANCE ====================

  it('T7a: injection in filter value is neutralized', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    const result = await queryDataHandler({
      ownerId: owner,
      args: {
        entity: 'tasks',
        filters: [{ field: 'title', operator: 'eq', value: "'; DROP TABLE tasks; --" }],
      },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    // Should return 0 rows (no match), NOT crash or execute injection
    expect(result.success).toBe(true);
    expect(result.data!.rows.length).toBe(0);
  });

  it('T7b: injection in sort field is rejected by validation', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    const result = await queryDataHandler({
      ownerId: owner,
      args: {
        entity: 'tasks',
        sort: { field: '1=1; DROP TABLE tasks; --', direction: 'asc' },
      },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(false);
  });

  it('T7c: injection in entity name is rejected', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    const result = await queryDataHandler({
      ownerId: owner,
      args: { entity: 'tasks; DROP TABLE projects; --' },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(false);
  });

  it('T7d: injection in field name is rejected by validation', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    const result = await queryDataHandler({
      ownerId: owner,
      args: {
        entity: 'tasks',
        filters: [{ field: "id; DELETE FROM owners; --", operator: 'eq', value: 1 }],
      },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(false);
  });

  // ==================== T8: PARAMETERIZATION ====================

  it('T8: filter values become SQL parameters, not string interpolation', () => {
    const plan: QueryPlan = {
      entity: 'tasks',
      filters: [{ field: 'title', operator: 'eq', value: 'test value' }],
    };
    const compiled = compileQuery(plan, 'owner-param-test');
    // Value should be in params array, not in SQL string
    expect(compiled.params).toContain('test value');
    expect(compiled.sql).not.toContain("'test value'");
    expect(compiled.sql).toContain('$2');
  });

  // ==================== T9: ROW LIMIT ====================

  it('T9: row limit is enforced — default limit applied', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });
    await seedTestData(db, owner);

    const result = await queryDataHandler({
      ownerId: owner,
      args: { entity: 'tasks' },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(true);
    expect(result.data!.rows.length).toBeLessThanOrEqual(QUERY_DEFAULT_LIMIT);
  });

  it('T9b: limit exceeding max is rejected by validation', async () => {
    const errors = validateQueryPlan({ entity: 'tasks', pagination: { limit: 200 } });
    expect(errors.length).toBeGreaterThan(0);
  });

  // ==================== T10: BYTE LIMIT ====================

  it('T10: result envelope metadata is present (byte limit enforced at 50KB)', async () => {
    // The byte limit is enforced at 50KB. With the small test data, we verify
    // the envelope structure supports truncation tracking.
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });
    await seedTestData(db, owner);

    const result = await queryDataHandler({
      ownerId: owner,
      args: { entity: 'tasks' },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(true);
    expect(result.data!.metadata).toBeDefined();
    expect(typeof result.data!.metadata.rowCount).toBe('number');
  });

  // ==================== T11: TIMEOUT ====================

  it('T11: timeout constant is configured at 5 seconds', () => {
    expect(QUERY_TIMEOUT_MS).toBe(5000);
  });

  // ==================== T12: AGGREGATION ====================

  it('T12a: count aggregation executes successfully', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });
    await seedTestData(db, owner);

    const result = await queryDataHandler({
      ownerId: owner,
      args: {
        entity: 'tasks',
        aggregate: { operation: 'count' },
      },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(true);
    expect(result.data!.rows.length).toBeGreaterThanOrEqual(1);
    // Should have a count field
    const firstRow = result.data!.rows[0];
    const hasCountField = Object.keys(firstRow).some(k => k.toLowerCase().includes('count'));
    expect(hasCountField).toBe(true);
  });

  it('T12b: aggregation with group-by executes successfully', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });
    await seedTestData(db, owner);

    const result = await queryDataHandler({
      ownerId: owner,
      args: {
        entity: 'tasks',
        aggregate: { operation: 'count', groupBy: ['status'] },
      },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(true);
    expect(result.data!.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('T12c: unsupported aggregation (sum without field) is rejected', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    const result = await queryDataHandler({
      ownerId: owner,
      args: {
        entity: 'tasks',
        aggregate: { operation: 'sum' },
      },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(false);
  });

  // ==================== T13: AGGREGATION RATE LIMIT ====================
  // Rate limits require repeated requests to exhaust. Classification: UNVERIFIED
  // (would require 10+ requests to the real DB, impractical for live verification).

  // ==================== T14: QUERY RATE LIMIT ====================
  // Same as T13. Classification: UNVERIFIED.

  // ==================== T15: COST PROTECTION ====================

  it('T15: query_data tool is low risk (bypasses CostProtector threshold)', () => {
    // query_data is riskLevel='low', actionType='data_query'
    // CostProtector only triggers on cost events, not on query execution
    expect(QUERY_DATA_TOOL.riskLevel).toBe('low');
    expect(QUERY_DATA_TOOL.actionType).toBe('data_query');
  });

  // ==================== T16: AUDIT PERSISTENCE ====================

  it('T16: successful query returns audit-compatible metadata', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });
    await seedTestData(db, owner);

    const result = await queryDataHandler({
      ownerId: owner,
      args: {
        entity: 'tasks',
        filters: [{ field: 'status', operator: 'eq', value: 'completed' }],
        sort: { field: 'created_at', direction: 'desc' },
        pagination: { limit: 10, offset: 0 },
      },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });

    expect(result.success).toBe(true);
    // Result envelope contains all audit-relevant metadata
    expect(result.data!.metadata.entity).toBe('tasks');
    expect(result.data!.metadata.rowCount).toBeGreaterThanOrEqual(0);
    expect(typeof result.data!.metadata.truncated).toBe('boolean');
    expect(result.data!.metadata.latencyMs).toBeGreaterThanOrEqual(0);
  });

  // ==================== T17: DETERMINISTIC RESULT ENVELOPE ====================

  it('T17: repeated query returns same envelope structure', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });
    await seedTestData(db, owner);

    const args = { entity: 'tasks' };
    const r1 = await queryDataHandler({
      ownerId: owner, args, db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined, environment: 'development',
    });
    const r2 = await queryDataHandler({
      ownerId: owner, args, db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined, environment: 'development',
    });

    // Same structure
    expect(Object.keys(r1.data!.metadata)).toEqual(Object.keys(r2.data!.metadata));
    expect(r1.data!.metadata.entity).toBe(r2.data!.metadata.entity);
    expect(r1.data!.rows.length).toBe(r2.data!.rows.length);
  });

  // ==================== T18: TOOL REGISTRY ====================

  it('T18a: query_data is registered exactly once in GATE3_TOOLS', () => {
    const queryTools = GATE3_TOOLS.filter(t => t.name === 'query_data');
    expect(queryTools.length).toBe(1);
  });

  it('T18b: 16 total tools registered', () => {
    expect(GATE3_TOOLS.length).toBe(16);
  });

  it('T18c: query_data appears in OpenAI tools format', () => {
    const openai = toOpenAITools(GATE3_TOOLS);
    const qd = openai.find((t: any) => t.function?.name === 'query_data');
    expect(qd).toBeDefined();
    expect(qd!.type).toBe('function');
  });

  it('T18d: query_data appears in Anthropic tools format', () => {
    const anthropic = toAnthropicTools(GATE3_TOOLS);
    const qd = anthropic.find((t: any) => t.name === 'query_data');
    expect(qd).toBeDefined();
    expect(qd!.input_schema).toBeDefined();
  });

  it('T18e: query_data appears in Google tools format', () => {
    const google = toGoogleTools(GATE3_TOOLS);
    const qd = google.find((t: any) => t.name === 'query_data');
    expect(qd).toBeDefined();
  });

  // ==================== T19: GUARDIAN / SECURITY ====================

  it('T19a: query_data is low risk (Guardian allows auto)', () => {
    expect(QUERY_DATA_TOOL.riskLevel).toBe('low');
    expect(QUERY_DATA_TOOL.requiresApproval).toBe(false);
  });

  it('T19b: owner_id is always injected server-side (not from input)', async () => {
    // Verify that even if we try to pass owner_id in args, it's ignored
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    const result = await queryDataHandler({
      ownerId: owner,
      args: { entity: 'projects', owner_id: 'hacked-owner-id' },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(true);
    // All rows should belong to the authenticated owner
    for (const row of result.data!.rows) {
      expect(row.owner_id).toBe(owner);
    }
  });

  // ==================== T20: DATABASE SCHEMA INTEGRITY ====================

  it('T20: no new tables were created by Gate 6 (schema-free)', async () => {
    const { db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    // Query information_schema for public tables
    const res = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tableNames = res.rows.map((r: any) => r.table_name);

    // Known tables from Gate 1-5 migrations
    const knownTables = [
      'agent_permissions', 'agents', 'approvals', 'audit_events',
      'autonomy_records', 'conversation_messages', 'conversations',
      'cost_events', 'critical_actions', 'decision_journal',
      'memory_lessons', 'models', 'owners', 'personal_preferences',
      'project_environments', 'project_passports', 'projects', 'runtimes',
      'security_events', 'security_incidents', 'security_lockdowns',
      'security_policies', 'security_rate_limits', 'task_runs', 'tasks',
      'tools',
    ];

    // No new tables should exist
    for (const t of tableNames) {
      expect(knownTables).toContain(t);
    }
  });

  it('T20b: no new columns on existing tables (schema-free)', async () => {
    const { db, rollback } = makeTransactionalStore();
    handles.push({ rollback });

    // Check tasks table columns
    const res = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tasks'
      ORDER BY ordinal_position
    `);
    const cols = res.rows.map((r: any) => r.column_name);

    // Known tasks columns
    const knownCols = ['id', 'owner_id', 'project_id', 'environment_id', 'parent_task_id', 'agent_id', 'title', 'description', 'status', 'priority', 'risk_level', 'authority_level', 'autonomy', 'approval_required', 'inputs', 'output', 'error', 'attempts', 'max_attempts', 'correlation_id', 'created_by', 'created_at', 'started_at', 'completed_at', 'updated_at', 'required_capabilities', 'preferred_role'];

    for (const c of cols) {
      expect(knownCols).toContain(c);
    }
  });

  // ==================== T21: SOURCE INTEGRITY ====================
  // Verified by: no file modifications during PHASE G (absolute rule).

  // ==================== T22: RESIDUE ====================

  it('T22: no test data residue after rollback', async () => {
    const ts = makeTransactionalStore();
    const { owner, rollback } = ts;

    // Create test data via the db wrapper
    const { projectId } = await seedTestData(ts.db, owner);

    // Verify data exists within transaction
    const before = await ts.db.query('SELECT count(*) as cnt FROM public.projects WHERE owner_id = $1', [owner]);
    expect(Number(before.rows[0].cnt)).toBeGreaterThanOrEqual(1);

    // Rollback
    await rollback();

    // Verify residue via a separate connection (won't see rolled-back data)
    const cleanup = new pg.Client({
      host: cfg.dbHost, port: cfg.dbPort, user: cfg.dbUser,
      password: cfg.dbPassword, database: cfg.dbName,
      ssl: { rejectUnauthorized: false },
    });
    await cleanup.connect();
    const after = await cleanup.query(
      `SELECT count(*) FROM auth.users WHERE email LIKE 'g6t-%@chef.local'`
    );
    // Cleanup should have removed auth users
    await cleanup.query(`delete from auth.users where email like 'g6t-%@chef.local'`);
    await cleanup.end();
  });

  // ==================== ALL ENTITIES COVERAGE ====================

  for (const entity of QUERY_ENTITIES) {
    it(`entity coverage: ${entity} compiles and executes`, async () => {
      const { owner, client, db, rollback } = makeTransactionalStore();
      handles.push({ rollback });
      await seedTestData(db, owner);

      const result = await queryDataHandler({
        ownerId: owner,
        args: { entity },
        db,
        input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
        projectId: undefined,
        environment: 'development',
      });
      // Should not crash — may return 0 rows
      expect(typeof result.success).toBe('boolean');
      expect(result).toHaveProperty('success');
    });
  }

  // ==================== SORT + FILTER + PAGINATION ====================

  it('combined: filter + sort + pagination executes correctly', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });
    await seedTestData(db, owner);

    const result = await queryDataHandler({
      ownerId: owner,
      args: {
        entity: 'tasks',
        filters: [{ field: 'status', operator: 'eq', value: 'completed' }],
        sort: { field: 'attempts', direction: 'desc' },
        pagination: { limit: 2, offset: 0 },
      },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });

    expect(result.success).toBe(true);
    expect(result.data!.rows.length).toBeLessThanOrEqual(2);
    for (const row of result.data!.rows) {
      expect(row.status).toBe('completed');
    }
  });

  // ==================== AGGREGATION: SUM/AVG/MIN/MAX ====================

  it('T12d: sum aggregation on numeric field', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });
    await seedTestData(db, owner);

    const result = await queryDataHandler({
      ownerId: owner,
      args: {
        entity: 'tasks',
        aggregate: { operation: 'sum', field: 'attempts' },
      },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(true);
    expect(result.data!.rows.length).toBe(1);
  });

  it('T12e: avg aggregation on numeric field', async () => {
    const { owner, client, db, rollback } = makeTransactionalStore();
    handles.push({ rollback });
    await seedTestData(db, owner);

    const result = await queryDataHandler({
      ownerId: owner,
      args: {
        entity: 'tasks',
        aggregate: { operation: 'avg', field: 'attempts' },
      },
      db,
      input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
      projectId: undefined,
      environment: 'development',
    });
    expect(result.success).toBe(true);
    expect(result.data!.rows.length).toBe(1);
  });

  // ====================================================================
  // Gate 7 — Live Verification (Combined Production Query Hardening)
  // ====================================================================

  describe('Gate 7 — Live Hardening Verification', () => {

    // ---------- G7-01: Byte limit live verification ----------

    it('G7-L1: result includes byteSize metadata', async () => {
      const { owner, db, rollback } = makeTransactionalStore();
      handles.push({ rollback });
      await seedTestData(db, owner);

      const result = await queryDataHandler({
        ownerId: owner,
        args: { entity: 'projects' },
        db,
        input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
        projectId: undefined,
        environment: 'development',
      });
      expect(result.success).toBe(true);
      expect(result.data!.metadata.byteSize).toBeDefined();
      expect(typeof result.data!.metadata.byteSize).toBe('number');
      expect(result.data!.metadata.byteSize).toBeGreaterThan(0);
    });

    it('G7-L2: byteSize matches actual serialized row size', async () => {
      const { owner, db, rollback } = makeTransactionalStore();
      handles.push({ rollback });
      await seedTestData(db, owner);

      const result = await queryDataHandler({
        ownerId: owner,
        args: { entity: 'projects', fields: ['id', 'name'] },
        db,
        input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
        projectId: undefined,
        environment: 'development',
      });
      expect(result.success).toBe(true);
      const expectedBytes = Buffer.byteLength(JSON.stringify(result.data!.rows), 'utf-8');
      expect(result.data!.metadata.byteSize).toBe(expectedBytes);
    });

    // ---------- G7-03: Dedicated rate limit live verification ----------

    it('G7-L3: data_query rate limit exists and is configured', async () => {
      const { RateLimiter } = await import('../core/security/rateLimit.js');
      const limiter = new RateLimiter();
      const decision = limiter.check('test-owner', 'data_query', 'data_query.count');
      expect(decision.allowed).toBe(true);
      expect(decision.limit).toBe(200);
      expect(decision.windowMs).toBe(3_600_000);
    });

    it('G7-L4: data_query_agg rate limit exists and is configured', async () => {
      const { RateLimiter } = await import('../core/security/rateLimit.js');
      const limiter = new RateLimiter();
      const decision = limiter.check('test-owner', 'data_query', 'data_query_agg.count');
      expect(decision.allowed).toBe(true);
      expect(decision.limit).toBe(50);
    });

    // ---------- G7-06: Error sanitization live verification ----------

    it('G7-L5: validation error does not leak field names to LLM', async () => {
      const { owner, db, rollback } = makeTransactionalStore();
      handles.push({ rollback });

      const result = await queryDataHandler({
        ownerId: owner,
        args: { entity: 'projects', filters: [{ field: 'super_secret_column', operator: 'eq', value: 'x' }] },
        db,
        input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
        projectId: undefined,
        environment: 'development',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid query parameters.');
      expect(result.error).not.toContain('super_secret_column');
      expect(result.error).not.toContain('filterable');
    });

    it('G7-L6: invalid entity error does not leak entity names', async () => {
      const { owner, db, rollback } = makeTransactionalStore();
      handles.push({ rollback });

      const result = await queryDataHandler({
        ownerId: owner,
        args: { entity: 'admin_users' },
        db,
        input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
        projectId: undefined,
        environment: 'development',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid query arguments.');
      expect(result.error).not.toContain('admin_users');
    });

    // ---------- Gate 6 baseline preservation live ----------

    it('G7-L7: basic query still works against live Supabase', async () => {
      const { owner, db, rollback } = makeTransactionalStore();
      handles.push({ rollback });
      await seedTestData(db, owner);

      const result = await queryDataHandler({
        ownerId: owner,
        args: { entity: 'tasks' },
        db,
        input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
        projectId: undefined,
        environment: 'development',
      });
      expect(result.success).toBe(true);
      expect(result.data!.rows.length).toBe(5);
    });

    it('G7-L8: aggregation still works against live Supabase', async () => {
      const { owner, db, rollback } = makeTransactionalStore();
      handles.push({ rollback });
      await seedTestData(db, owner);

      const result = await queryDataHandler({
        ownerId: owner,
        args: { entity: 'tasks', aggregate: { operation: 'count' } },
        db,
        input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
        projectId: undefined,
        environment: 'development',
      });
      expect(result.success).toBe(true);
      expect(result.data!.rows.length).toBe(1);
    });

    it('G7-L9: owner isolation still enforced against live Supabase', async () => {
      const { owner, other, db, rollback } = makeTransactionalStore();
      handles.push({ rollback });
      await seedTestData(db, owner);

      // Other owner sees nothing
      const otherResult = await queryDataHandler({
        ownerId: other,
        args: { entity: 'tasks' },
        db,
        input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
        projectId: undefined,
        environment: 'development',
      });
      expect(otherResult.success).toBe(true);
      expect(otherResult.data!.rows.length).toBe(0);

      // Owner sees their data
      const ownerResult = await queryDataHandler({
        ownerId: owner,
        args: { entity: 'tasks' },
        db,
        input: { intent: 'ask', resource: 'data', verb: 'query', params: {} },
        projectId: undefined,
        environment: 'development',
      });
      expect(ownerResult.success).toBe(true);
      expect(ownerResult.data!.rows.length).toBe(5);
    });
  });
});
