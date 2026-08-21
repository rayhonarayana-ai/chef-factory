// CHEF FACTORY — Gate 1 — Repository (Store implementation over Postgres).
// All queries are parameterized and scoped by owner_id (project isolation at the
// application layer on top of RLS). Append-only audit is enforced by the DB.

import type {
  AgentRecord,
  AgentDefinition,
  AgentPatch,
  ApprovalRecord,
  AuditEvent,
  AutonomyDecision,
  CostEvent,
  DailyStatus,
  DecisionRecord,
  JsonObject,
  LessonInput,
  ModelInfo,
  PassportRecord,
  ProjectRecord,
  RecallItem,
  RuntimeInfo,
  TaskRecord,
  TaskRunRecord,
} from '../core/types.js';
import type { AgentStats, BudgetReport, Store } from '../core/ports.js';
import { emptyPassport } from '../core/passport.js';
import { getPool } from './pool.js';
import { Monitor } from '../core/monitoring.js';
import { toSecurityEventRecord } from '../core/security/events.js';
import { toIncidentRecord, applyIncidentPatch } from '../core/security/incidents.js';
import { toLockdownRecord, canReleaseLockdown } from '../core/security/lockdown.js';
import type {
  CriticalActionRule,
  RlsProbe,
  SecurityEventInput,
  SecurityEventRecord,
  SecurityIncidentInput,
  SecurityIncidentPatch,
  SecurityIncidentRecord,
  SecurityLockdownRecord,
} from '../core/security/types.js';

function toCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out;
}

export class SupabaseStore implements Store {
  constructor(private readonly pool = getPool()) {}

  private async q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows.map((r) => toCamel(r) as T);
  }

  // ---------- projects / passports ----------
  async getProjectBySlug(ownerId: string, slug: string): Promise<ProjectRecord | null> {
    const rows = await this.q<ProjectRecord>(
      `select * from public.projects where owner_id = $1 and slug = $2 and status <> 'deleted' limit 1`,
      [ownerId, slug],
    );
    return rows[0] ?? null;
  }

  async getProject(ownerId: string, projectId: string): Promise<ProjectRecord | null> {
    const rows = await this.q<ProjectRecord>(
      `select * from public.projects where owner_id = $1 and id = $2 limit 1`,
      [ownerId, projectId],
    );
    return rows[0] ?? null;
  }

  async listProjects(ownerId: string): Promise<ProjectRecord[]> {
    return this.q<ProjectRecord>(
      `select * from public.projects where owner_id = $1 and status <> 'deleted' order by created_at asc`,
      [ownerId],
    );
  }

  async createProject(ownerId: string, data: { name: string; slug: string; description?: string }): Promise<ProjectRecord> {
    const rows = await this.q<ProjectRecord>(
      `insert into public.projects (owner_id, name, slug, description)
       values ($1, $2, $3, $4) returning *`,
      [ownerId, data.name, data.slug, data.description ?? null],
    );
    const project = rows[0]!;
    const p = await this.getPassport(ownerId, project.id);
    if (!p) await this.upsertPassport(ownerId, project.id, { description: data.description ?? null });
    return project;
  }

  async getPassport(ownerId: string, projectId: string): Promise<PassportRecord | null> {
    const rows = await this.q<PassportRecord>(
      `select p.* from public.project_passports p
       join public.projects pr on pr.id = p.project_id
       where pr.owner_id = $1 and p.project_id = $2 limit 1`,
      [ownerId, projectId],
    );
    return rows[0] ?? null;
  }

  async upsertPassport(ownerId: string, projectId: string, patch: Partial<PassportRecord>): Promise<PassportRecord> {
    const project = await this.getProject(ownerId, projectId);
    if (!project) throw new Error(`project ${projectId} not found`);
    const existing = (await this.getPassport(ownerId, projectId)) ?? emptyPassport(projectId);
    const merged = { ...existing, ...patch };
    const cols = [
      'identity', 'description', 'technology', 'repository', 'databaseRef',
      'environments', 'deployment', 'dependencies', 'models', 'runtimes',
      'businessModel', 'status', 'risks', 'credentialsReferences',
      'operationalHealth', 'documentationState',
    ];
    const setSql = cols
      .map((c, i) => `${this.toSnake(c)} = $${i + 2}`)
      .join(', ');
    const values = cols.map((c) => {
      const v = (merged as Record<string, unknown>)[c];
      return v === null || v === undefined ? {} : JSON.stringify(v);
    });
    const rows = await this.q<PassportRecord>(
      `insert into public.project_passports (project_id, ${cols.map((c) => this.toSnake(c)).join(', ')})
       values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
       on conflict (project_id) do update set ${setSql}
       returning *`,
      [projectId, ...values],
    );
    return rows[0]!;
  }

  // ---------- tasks ----------
  async createTask(ownerId: string, data: Parameters<Store['createTask']>[1]): Promise<TaskRecord> {
    if (data.agentId != null) {
      const agent = await this.getAgent(ownerId, data.agentId);
      if (!agent) throw new Error('cross-owner agent assignment rejected: agent not found or belongs to another owner');
    }
    const rows = await this.q<TaskRecord>(
      `insert into public.tasks (
         owner_id, project_id, title, description, agent_id, priority, risk_level,
         authority_level, autonomy, approval_required, required_capabilities, preferred_role,
         status, inputs, max_attempts, correlation_id, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
      [
        ownerId, data.projectId, data.title, data.description ?? null, data.agentId ?? null,
        data.priority ?? 'medium', data.riskLevel ?? 'low', data.authorityLevel ?? null,
        data.autonomy ?? null, data.approvalRequired ?? false,
        data.requiredCapabilities ?? [], data.preferredRole ?? null,
        data.status ?? 'created',
        data.inputs ?? {}, data.maxAttempts ?? 3, data.correlationId ?? null, data.createdBy ?? null,
      ],
    );
    return rows[0]!;
  }

  async getTask(ownerId: string, taskId: string): Promise<TaskRecord | null> {
    const rows = await this.q<TaskRecord>(
      `select * from public.tasks where owner_id = $1 and id = $2 limit 1`,
      [ownerId, taskId],
    );
    return rows[0] ?? null;
  }

  async listTasks(ownerId: string, filter?: { projectId?: string; status?: TaskRecord['status'] }): Promise<TaskRecord[]> {
    const conds = ['owner_id = $1'];
    const params: unknown[] = [ownerId];
    if (filter?.projectId) {
      params.push(filter.projectId);
      conds.push(`project_id = $${params.length}`);
    }
    if (filter?.status) {
      params.push(filter.status);
      conds.push(`status = $${params.length}`);
    }
    return this.q<TaskRecord>(
      `select * from public.tasks where ${conds.join(' and ')} order by created_at desc`,
      params,
    );
  }

  async patchTask(ownerId: string, taskId: string, patch: import('../core/ports.js').TaskPatch): Promise<TaskRecord> {
    if (patch.agentId !== undefined && patch.agentId !== null) {
      const agent = await this.getAgent(ownerId, patch.agentId);
      if (!agent) throw new Error('cross-owner agent assignment rejected: agent not found or belongs to another owner');
    }
    const sets: string[] = [];
    const params: unknown[] = [ownerId, taskId];
    const field: Record<keyof import('../core/ports.js').TaskPatch, string> = {
      title: 'title',
      description: 'description',
      priority: 'priority',
      status: 'status',
      output: 'output',
      error: 'error',
      attempts: 'attempts',
      startedAt: 'started_at',
      completedAt: 'completed_at',
      agentId: 'agent_id',
      environmentId: 'environment_id',
      requiredCapabilities: 'required_capabilities',
      preferredRole: 'preferred_role',
    };
    for (const [k, v] of Object.entries(patch) as [keyof import('../core/ports.js').TaskPatch, unknown][]) {
      const col = field[k];
      if (!col) continue;
      params.push(v === null ? null : typeof v === 'object' ? JSON.stringify(v) : v);
      sets.push(`${col} = $${params.length}`);
    }
    if (sets.length === 0) throw new Error('empty patch');
    const rows = await this.q<TaskRecord>(
      `update public.tasks set ${sets.join(', ')} where owner_id = $1 and id = $2 returning *`,
      params,
    );
    return rows[0]!;
  }

  // Gate 28: Atomic assignment with TOCTOU protection.
  // Lock order: Agent → Task (prevents deadlock with lifecycle mutations).
  // Short transaction: only DB work, no external calls.
  async assignTask(ownerId: string, taskId: string, agentId: string | null): Promise<import('../core/ports.js').AssignTaskResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock and read the task
      const taskRows = await client.query<{ id: string; agent_id: string | null }>(
        `SELECT id, agent_id FROM public.tasks WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
        [taskId, ownerId],
      );
      if (taskRows.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'task_not_found', previousAgentId: null, nextAgentId: agentId };
      }
      const previousAgentId = taskRows.rows[0]!.agent_id;

      // 2. No-change short circuit
      if (previousAgentId === agentId) {
        await client.query('ROLLBACK');
        return { ok: true, outcome: 'no_change', previousAgentId, nextAgentId: agentId };
      }

      // 3. If assigning (not unassigning), lock and validate agent
      if (agentId !== null) {
        const agentRows = await client.query<{ id: string; status: string }>(
          `SELECT id, status FROM public.agents WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
          [agentId, ownerId],
        );
        if (agentRows.rows.length === 0) {
          await client.query('ROLLBACK');
          return { ok: false, outcome: 'agent_not_found', previousAgentId, nextAgentId: agentId };
        }
        if (agentRows.rows[0]!.status !== 'active') {
          await client.query('ROLLBACK');
          return { ok: false, outcome: 'agent_not_eligible', previousAgentId, nextAgentId: agentId };
        }
      }

      // 4. Atomic write — agent eligibility was validated under lock
      await client.query(
        `UPDATE public.tasks SET agent_id = $3, updated_at = now() WHERE id = $1 AND owner_id = $2`,
        [taskId, ownerId, agentId],
      );

      await client.query('COMMIT');

      return {
        ok: true,
        outcome: agentId !== null ? 'assigned' : 'unassigned',
        previousAgentId,
        nextAgentId: agentId,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async createTaskRun(ownerId: string, data: { taskId: string; runNumber: number; modelId?: string | null; runtimeId?: string | null; inputSnapshot?: JsonObject | null }): Promise<TaskRunRecord> {
    const rows = await this.q<TaskRunRecord>(
      `insert into public.task_runs (task_id, run_number, model_id, runtime_id, input_snapshot)
       select $2, $3, $4, $5, $6
       from public.tasks where id = $2 and owner_id = $1 returning *`,
      [ownerId, data.taskId, data.runNumber, data.modelId ?? null, data.runtimeId ?? null, data.inputSnapshot ?? null],
    );
    return rows[0]!;
  }

  async completeTaskRun(ownerId: string, runId: string, patch: {
    status: TaskRunRecord['status'];
    outputSnapshot?: JsonObject | null;
    error?: JsonObject | null;
    durationMs?: number | null;
    cost?: number;
    completedAt?: string | null;
  }): Promise<TaskRunRecord> {
    const rows = await this.q<TaskRunRecord>(
      `update public.task_runs r set
         status = $3,
         output_snapshot = $4,
         error = $5,
         duration_ms = $6,
         cost = $7,
         completed_at = $8
       from public.tasks t
       where r.id = $1 and t.id = r.task_id and t.owner_id = $2
       returning r.*`,
      [
        runId, ownerId, patch.status,
        patch.outputSnapshot ?? null, patch.error ?? null,
        patch.durationMs ?? null, patch.cost ?? 0, patch.completedAt ?? null,
      ],
    );
    return rows[0]!;
  }

  // ---------- approvals ----------
  async createApproval(ownerId: string, data: Parameters<Store['createApproval']>[1]): Promise<ApprovalRecord> {
    const rows = await this.q<ApprovalRecord>(
      `insert into public.approvals (
         owner_id, project_id, task_id, agent_id, action, description, risk_level,
         authority_level, requested_by, expires_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [
        ownerId, data.projectId ?? null, data.taskId ?? null, data.agentId ?? null,
        data.action, data.description ?? null, data.riskLevel ?? null,
        data.authorityLevel ?? null, data.requestedBy ?? null, data.expiresAt ?? null,
      ],
    );
    return rows[0]!;
  }

  async getApproval(ownerId: string, approvalId: string): Promise<ApprovalRecord | null> {
    const rows = await this.q<ApprovalRecord>(
      `select * from public.approvals where owner_id = $1 and id = $2 limit 1`,
      [ownerId, approvalId],
    );
    return rows[0] ?? null;
  }

  async listApprovals(ownerId: string, filter?: { projectId?: string; taskId?: string; status?: ApprovalRecord['status'] }): Promise<ApprovalRecord[]> {
    const conds = ['owner_id = $1'];
    const params: unknown[] = [ownerId];
    if (filter?.projectId) {
      params.push(filter.projectId);
      conds.push(`project_id = $${params.length}`);
    }
    if (filter?.taskId) {
      params.push(filter.taskId);
      conds.push(`task_id = $${params.length}`);
    }
    if (filter?.status) {
      params.push(filter.status);
      conds.push(`status = $${params.length}`);
    }
    return this.q<ApprovalRecord>(
      `select * from public.approvals where ${conds.join(' and ')} order by created_at desc`,
      params,
    );
  }

  async patchApproval(ownerId: string, approvalId: string, patch: import('../core/ports.js').ApprovalPatch): Promise<ApprovalRecord> {
    const sets: string[] = [];
    const params: unknown[] = [ownerId, approvalId];
    const map: Record<string, string> = {
      status: 'status',
      decision: 'decision',
      decisionReason: 'decision_reason',
      decidedBy: 'decided_by',
      decidedAt: 'decided_at',
    };
    for (const [k, v] of Object.entries(patch)) {
      const col = map[k];
      if (!col) continue;
      params.push(v ?? null);
      sets.push(`${col} = $${params.length}`);
    }
    if (sets.length === 0) throw new Error('empty patch');
    const rows = await this.q<ApprovalRecord>(
      `update public.approvals set ${sets.join(', ')} where owner_id = $1 and id = $2 returning *`,
      params,
    );
    return rows[0]!;
  }

  // ---------- audit ----------
  async recordAudit(event: AuditEvent): Promise<void> {
    await this.q(
      `insert into public.audit_events (
         actor_type, actor_id, action, project_id, environment_id, resource_type,
         resource_id, authorization_result, correlation_id, task_id, metadata
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        event.actorType, event.actorId, event.action, event.projectId,
        event.environmentId, event.resourceType, event.resourceId,
        event.authorizationResult, event.correlationId, event.taskId,
        event.metadata ?? {},
      ],
    );
  }

  // ---------- costs ----------
  async recordCost(event: CostEvent): Promise<void> {
    await this.q(
      `insert into public.cost_events (
         owner_id, project_id, task_id, run_id, agent_id, cost_type, amount, currency,
         provider, model_id, runtime_id, billed_to, metadata
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        event.ownerId, event.projectId, event.taskId, event.runId, event.agentId,
        event.costType, event.amount, event.currency, event.provider,
        event.modelId, event.runtimeId, event.billedTo, event.metadata ?? {},
      ],
    );
  }

  async totalCost(ownerId: string, projectId?: string | null): Promise<number> {
    const rows = await this.q<{ sum: string | null }>(
      `select sum(amount) as sum from public.cost_events
       where owner_id = $1 ${projectId ? 'and project_id = $2' : ''}`,
      projectId ? [ownerId, projectId] : [ownerId],
    );
    return Number(rows[0]?.sum ?? 0);
  }

  async projectBudget(ownerId: string, projectId: string): Promise<BudgetReport> {
    const prefs = await this.getPreferences(ownerId);
    const budget = (prefs['budget'] ?? {}) as Record<string, unknown>;
    const maxAmount = (budget[projectId] ?? budget['default']) as number | undefined;
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const rows = await this.q<{ month: string | null; day: string | null }>(
      `select
         sum(amount) filter (where created_at >= $3) as month,
         sum(amount) filter (where created_at >= $4) as day
       from public.cost_events where owner_id = $1 and project_id = $2`,
      [ownerId, projectId, monthStart, dayStart],
    );
    const month = Number(rows[0]?.month ?? 0);
    const day = Number(rows[0]?.day ?? 0);
    return {
      period: 'month',
      amount: month,
      daily: day,
      maxAmount: maxAmount ?? null,
      exceeded: maxAmount !== undefined && month > maxAmount,
    };
  }

  // ---------- preferences (POS) ----------
  async getPreferences(ownerId: string): Promise<JsonObject> {
    const rows = await this.q<{ category: string; key: string; value: unknown; version: number; isActive: boolean }>(
      `select category, key, value, version, is_active from public.personal_preferences
       where owner_id = $1 order by version asc`,
      [ownerId],
    );
    const out: JsonObject = {};
    for (const r of rows) {
      if (!r.isActive) continue;
      const bucket = (out[r.category] ?? {}) as JsonObject;
      bucket[r.key] = r.value;
      out[r.category] = bucket;
    }
    return out;
  }

  async setPreference(ownerId: string, category: string, key: string, value: unknown): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `update public.personal_preferences set is_active = false
         where owner_id = $1 and category = $2 and key = $3 and is_active`,
        [ownerId, category, key],
      );
      const rows = await client.query<{ max: number | null }>(
        `select max(version) as max from public.personal_preferences
         where owner_id = $1 and category = $2 and key = $3`,
        [ownerId, category, key],
      );
      const version = (rows.rows[0]?.max ?? 0) + 1;
      await client.query(
        `insert into public.personal_preferences (owner_id, category, key, value, version, is_active)
         values ($1,$2,$3,$4,$5,true)`,
        [ownerId, category, key, JSON.stringify(value), version],
      );
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  // ---------- decisions ----------
  async recordDecision(ownerId: string, d: Parameters<Store['recordDecision']>[1]): Promise<DecisionRecord> {
    const rows = await this.q<DecisionRecord>(
      `insert into public.decision_journal (
         owner_id, project_id, context, options, selected_option, reason, evidence,
         confidence, risk_level, authority_level, approved_by, outcome
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [
        ownerId, d.projectId ?? null, d.context, JSON.stringify(d.options ?? []),
        d.selectedOption ?? null, d.reason ?? null, JSON.stringify(d.evidence ?? []),
        d.confidence ?? null, d.riskLevel ?? null, d.authorityLevel ?? null,
        d.approvedBy ?? null, d.outcome ?? null,
      ],
    );
    return rows[0]!;
  }

  async listDecisions(ownerId: string): Promise<DecisionRecord[]> {
    return this.q<DecisionRecord>(
      `select * from public.decision_journal where owner_id = $1 order by created_at desc`,
      [ownerId],
    );
  }

  // ---------- autonomy records ----------
  async recordAutonomy(ownerId: string, record: {
    agentId: string;
    projectId?: string | null;
    environmentId?: string | null;
    action: string;
    riskLevel?: TaskRecord['riskLevel'];
    selected: AutonomyDecision;
    approvalStatus?: string;
    outcome?: string;
  }): Promise<void> {
    await this.q(
      `insert into public.autonomy_records (
         owner_id, agent_id, project_id, environment_id, action, risk_level,
         selected_autonomy, policy_inputs, evidence, decision, approval_status, outcome
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        ownerId, record.agentId, record.projectId ?? null, record.environmentId ?? null,
        record.action, record.riskLevel ?? null, record.selected.selected,
        JSON.stringify(record.selected.evidence ?? {}), JSON.stringify({}),
        record.selected.reason, record.approvalStatus ?? 'not_required', record.outcome ?? null,
      ],
    );
  }

  // ---------- models / runtimes ----------
  async listModels(ownerId: string): Promise<ModelInfo[]> {
    return this.q<ModelInfo>(
      `select * from public.models where owner_id = $1 order by cost_per_1k_input asc, name asc`,
      [ownerId],
    );
  }

  async listRuntimes(ownerId: string): Promise<RuntimeInfo[]> {
    return this.q<RuntimeInfo>(
      `select * from public.runtimes where owner_id = $1 order by cost_per_hour asc, name asc`,
      [ownerId],
    );
  }

  // ---------- agents / permissions (Gate 25: full CRUD) ----------
  private mapAgentRow(row: Record<string, unknown>): AgentRecord {
    return {
      id: row['id'] as string,
      ownerId: row['owner_id'] as string,
      name: row['name'] as string,
      slug: row['slug'] as string,
      role: row['role'] as string,
      description: (row['description'] as string) ?? null,
      capabilities: Array.isArray(row['capabilities']) ? row['capabilities'] as string[] : [],
      status: row['status'] as AgentRecord['status'],
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }

  async createAgent(ownerId: string, data: AgentDefinition): Promise<AgentRecord> {
    const slug = data.slug ?? data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
    const rows = await this.q<Record<string, unknown>>(
      `insert into public.agents (owner_id, name, slug, role, description, capabilities, status)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [ownerId, data.name, slug, data.role, data.description ?? null, JSON.stringify(data.capabilities ?? []), data.status ?? 'active'],
    );
    return this.mapAgentRow(rows[0]!);
  }

  async getAgent(ownerId: string, agentId: string): Promise<AgentRecord | null> {
    const rows = await this.q<Record<string, unknown>>(
      `select * from public.agents where owner_id = $1 and id = $2 limit 1`,
      [ownerId, agentId],
    );
    return rows[0] ? this.mapAgentRow(rows[0]) : null;
  }

  async listAgents(ownerId: string): Promise<AgentRecord[]> {
    const rows = await this.q<Record<string, unknown>>(
      `select * from public.agents where owner_id = $1 order by name asc`,
      [ownerId],
    );
    return rows.map((r) => this.mapAgentRow(r));
  }

  async patchAgent(ownerId: string, agentId: string, patch: AgentPatch): Promise<AgentRecord> {
    const sets: string[] = [];
    const params: unknown[] = [ownerId, agentId];
    const field: Record<string, string> = {
      name: 'name',
      description: 'description',
      role: 'role',
      capabilities: 'capabilities',
      status: 'status',
    };
    for (const [k, v] of Object.entries(patch)) {
      const col = field[k];
      if (!col) continue;
      params.push(k === 'capabilities' ? JSON.stringify(v) : v === null ? null : v);
      sets.push(`${col} = $${params.length}`);
    }
    if (sets.length === 0) throw new Error('empty patch');
    const rows = await this.q<Record<string, unknown>>(
      `update public.agents set ${sets.join(', ')} where owner_id = $1 and id = $2 returning *`,
      params,
    );
    return this.mapAgentRow(rows[0]!);
  }

  async agentHasPermission(agentId: string, projectId: string | null, resourceType: string, permission: string): Promise<boolean> {
    const rows = await this.q<{ ok: boolean }>(
      `select exists (
         select 1 from public.agent_permissions ap
         join public.agents a on a.id = ap.agent_id
         where a.id = $1 and a.status = 'active' and ap.status = 'active'
           and (ap.project_id = $2 or (ap.project_id is null and $2 is not null))
           and ap.resource_type = $3 and ap.permission = $4
       ) as ok`,
      [agentId, projectId, resourceType, permission],
    );
    return rows[0]?.ok ?? false;
  }

  async agentStats(agentId: string): Promise<AgentStats> {
    const rows = await this.q<{ done: string | null; failed: string | null }>(
      `select
         count(*) filter (where status = 'completed') as done,
         count(*) filter (where status = 'failed') as failed
       from public.tasks where agent_id = $1`,
      [agentId],
    );
    const done = Number(rows[0]?.done ?? 0);
    const failed = Number(rows[0]?.failed ?? 0);
    const total = done + failed;
    return {
      successRate: total === 0 ? 0 : done / total,
      historyCount: total,
    };
  }

  // ---------- monitoring ----------
  async dailyStatus(ownerId: string): Promise<DailyStatus> {
    return new Monitor(this).dailyStatus(ownerId);
  }

  // ---------- memory ----------
  async recall(ownerId: string, query: string): Promise<RecallItem[]> {
    void ownerId;
    void query;
    return [];
  }

  async saveLesson(ownerId: string, lesson: LessonInput): Promise<void> {
    await this.q(
      `insert into public.memory_lessons (owner_id, title, summary, category, project_id, confidence)
       values ($1,$2,$3,$4,$5,$6)`,
      [ownerId, lesson.title, lesson.summary, lesson.category, lesson.projectId ?? null, lesson.confidence],
    );
  }

  // ---------- Gate 2 — Security Guardian ----------
  async listCriticalActions(ownerId: string): Promise<CriticalActionRule[]> {
    void ownerId;
    return this.q<CriticalActionRule>(
      `select action, classification, default_decision as "defaultDecision", environments, description, is_core as "isCore", version
       from public.critical_actions order by action asc`,
    );
  }

  async recordSecurityEvent(ownerId: string, event: SecurityEventInput): Promise<SecurityEventRecord> {
    const record = toSecurityEventRecord({ ...event, ownerId });
    await this.q(
      `insert into public.security_events (
         security_event_id, owner_id, project_id, agent_id, task_id, correlation_id,
         environment, event_type, severity, action, resource, decision, reason,
         evidence_references, metadata, occurred_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        record.eventId, record.ownerId, record.projectId, record.agentId, record.taskId,
        record.correlationId, record.environment, record.eventType, record.severity,
        record.action, record.resource, record.decision, record.reason,
        JSON.stringify(record.evidenceReferences ?? []), JSON.stringify(record.metadata ?? {}),
        record.occurredAt,
      ],
    );
    return record;
  }

  async listSecurityEvents(ownerId: string, filter?: { eventType?: string; severity?: string; limit?: number }): Promise<SecurityEventRecord[]> {
    const conds = ['owner_id = $1'];
    const params: unknown[] = [ownerId];
    if (filter?.eventType) {
      params.push(filter.eventType);
      conds.push(`event_type = $${params.length}`);
    }
    if (filter?.severity) {
      params.push(filter.severity);
      conds.push(`severity = $${params.length}`);
    }
    params.push(filter?.limit ?? 100);
    return this.q<SecurityEventRecord>(
      `select
         security_event_id as "eventId", owner_id as "ownerId", project_id as "projectId",
         agent_id as "agentId", task_id as "taskId", correlation_id as "correlationId",
         environment, event_type as "eventType", severity, action, resource, decision,
         reason, evidence_references as "evidenceReferences", metadata, occurred_at as "occurredAt",
         recorded_at as "recordedAt"
       from public.security_events where ${conds.join(' and ')} order by occurred_at desc limit $${params.length}`,
      params,
    );
  }

  async createIncident(ownerId: string, input: SecurityIncidentInput): Promise<SecurityIncidentRecord> {
    const record = toIncidentRecord(ownerId, input);
    await this.q(
      `insert into public.security_incidents (
         incident_id, owner_id, title, status, description, event_ids, opened_by
       ) values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        record.incidentId, record.ownerId, record.title, record.status,
        record.description, JSON.stringify(record.eventIds ?? []), record.openedBy,
      ],
    );
    return record;
  }

  async patchIncident(ownerId: string, incidentId: string, patch: SecurityIncidentPatch): Promise<SecurityIncidentRecord | null> {
    const existing = await this.q<SecurityIncidentRecord>(
      `select incident_id as "incidentId", owner_id as "ownerId", title, status, description,
              event_ids as "eventIds", opened_by as "openedBy", closed_by as "closedBy",
              created_at as "createdAt", updated_at as "updatedAt"
       from public.security_incidents where owner_id = $1 and incident_id = $2 limit 1`,
      [ownerId, incidentId],
    );
    if (!existing[0]) return null;
    const { record, error } = applyIncidentPatch(existing[0], patch);
    if (error) throw new Error(error);
    await this.q(
      `update public.security_incidents set status = $3, description = $4, event_ids = $5, closed_by = $6, updated_at = $7
       where owner_id = $1 and incident_id = $2`,
      [
        ownerId, incidentId, record.status, record.description,
        JSON.stringify(record.eventIds ?? []), record.closedBy, record.updatedAt,
      ],
    );
    return record;
  }

  async listIncidents(ownerId: string, filter?: { status?: string; limit?: number }): Promise<SecurityIncidentRecord[]> {
    const conds = ['owner_id = $1'];
    const params: unknown[] = [ownerId];
    if (filter?.status) {
      params.push(filter.status);
      conds.push(`status = $${params.length}`);
    }
    params.push(filter?.limit ?? 100);
    return this.q<SecurityIncidentRecord>(
      `select incident_id as "incidentId", owner_id as "ownerId", title, status, description,
              event_ids as "eventIds", opened_by as "openedBy", closed_by as "closedBy",
              created_at as "createdAt", updated_at as "updatedAt"
       from public.security_incidents where ${conds.join(' and ')} order by created_at desc limit $${params.length}`,
      params,
    );
  }

  async activeLockdown(ownerId: string): Promise<SecurityLockdownRecord | null> {
    const rows = await this.q<SecurityLockdownRecord>(
      `select lockdown_id as "lockdownId", owner_id as "ownerId", scope, reason, status,
              activated_by as "activatedBy", released_by as "releasedBy", released_at as "releasedAt",
              created_at as "createdAt"
       from public.security_lockdowns
       where owner_id = $1 and status = 'active'
       order by created_at desc limit 1`,
      [ownerId],
    );
    return rows[0] ?? null;
  }

  async activateLockdown(ownerId: string, data: { scope?: string; reason: string; activatedBy: string; actorType: 'owner' | 'agent' | 'system' }): Promise<SecurityLockdownRecord> {
    const record = toLockdownRecord({ ownerId, scope: data.scope, reason: data.reason, activatedBy: data.activatedBy, actorType: data.actorType });
    await this.q(
      `insert into public.security_lockdowns (
         lockdown_id, owner_id, scope, reason, status, activated_by
       ) values ($1,$2,$3,$4,$5,$6)`,
      [record.lockdownId, record.ownerId, record.scope, record.reason, record.status, record.activatedBy],
    );
    return record;
  }

  async releaseLockdown(ownerId: string, lockdownId: string, data: { releasedBy: string; actorType: 'owner' | 'agent'; reason: string }): Promise<SecurityLockdownRecord | null> {
    const rows = await this.q<SecurityLockdownRecord>(
      `select lockdown_id as "lockdownId", owner_id as "ownerId", scope, reason, status,
              activated_by as "activatedBy", released_by as "releasedBy", released_at as "releasedAt",
              created_at as "createdAt"
       from public.security_lockdowns where owner_id = $1 and lockdown_id = $2 limit 1`,
      [ownerId, lockdownId],
    );
    const current = rows[0];
    if (!current) return null;
    if (current.status !== 'active') throw new Error('lockdown is not active');
    const check = canReleaseLockdown({ ownerId, releasedBy: data.releasedBy, actorType: data.actorType, reason: data.reason });
    if (!check.allowed) throw new Error(check.error ?? 'release denied');
    await this.q(
      `update public.security_lockdowns set status = 'released', released_by = $3, released_at = $4
       where owner_id = $1 and lockdown_id = $2`,
      [ownerId, lockdownId, data.releasedBy, new Date().toISOString()],
    );
    return { ...current, status: 'released', releasedBy: data.releasedBy, releasedAt: new Date().toISOString() };
  }

  async rlsProbe(ownerId: string): Promise<RlsProbe> {
    const tables = await this.q<{ count: string; rls: string }>(
      `select
         count(*) as count,
         count(*) filter (where relrowsecurity) as rls
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const auditTriggers = await this.q<{ has: boolean }>(
      `select exists (
         select 1 from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'audit_events' and not t.tgisinternal
       ) as has`,
    );
    const securityEventTriggers = await this.q<{ has: boolean }>(
      `select exists (
         select 1 from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'security_events' and not t.tgisinternal
       ) as has`,
    );
    const publicTables = Number(tables[0]?.count ?? 0);
    const rlsEnabledTables = Number(tables[0]?.rls ?? 0);
    return {
      publicTables,
      rlsEnabledTables,
      auditAppendOnly: Boolean(auditTriggers[0]?.has),
      securityEventsAppendOnly: Boolean(securityEventTriggers[0]?.has),
      ok: rlsEnabledTables === publicTables && publicTables > 0,
    };
  }

  private toSnake(s: string): string {
    return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  }

  // ————— Gate 3 — Conversation persistence —————

  async createConversation(ownerId: string, data: { projectId?: string | null; title?: string | null }): Promise<import('../core/conversation.js').ConversationRecord> {
    const res = await this.q<{ id: string; owner_id: string; project_id: string | null; title: string | null; status: string; created_at: string; updated_at: string }>(
      `INSERT INTO public.conversations (owner_id, project_id, title)
       VALUES ($1, $2, $3)
       RETURNING id, owner_id, project_id, title, status, created_at, updated_at`,
      [ownerId, data.projectId ?? null, data.title ?? null],
    );
    const row = res[0]!;
    return {
      id: row.id,
      ownerId: row.owner_id,
      projectId: row.project_id,
      title: row.title,
      status: row.status as 'active' | 'archived',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getConversation(ownerId: string, conversationId: string): Promise<import('../core/conversation.js').ConversationRecord | null> {
    const res = await this.q<{ id: string; owner_id: string; project_id: string | null; title: string | null; status: string; created_at: string; updated_at: string }>(
      `SELECT id, owner_id, project_id, title, status, created_at, updated_at
       FROM public.conversations
       WHERE id = $1 AND owner_id = $2`,
      [conversationId, ownerId],
    );
    if (res.length === 0) return null;
    const row = res[0]!;
    return {
      id: row.id,
      ownerId: row.owner_id,
      projectId: row.project_id,
      title: row.title,
      status: row.status as 'active' | 'archived',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listConversations(ownerId: string, filter?: { status?: 'active' | 'archived'; limit?: number; offset?: number }): Promise<import('../core/conversation.js').ConversationRecord[]> {
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;
    const statusFilter = filter?.status ?? 'active';
    const res = await this.q<{ id: string; owner_id: string; project_id: string | null; title: string | null; status: string; created_at: string; updated_at: string }>(
      `SELECT id, owner_id, project_id, title, status, created_at, updated_at
       FROM public.conversations
       WHERE owner_id = $1 AND status = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [ownerId, statusFilter, limit, offset],
    );
    return res.map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      projectId: row.project_id,
      title: row.title,
      status: row.status as 'active' | 'archived',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async archiveConversation(ownerId: string, conversationId: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE public.conversations SET status = 'archived'
       WHERE id = $1 AND owner_id = $2`,
      [conversationId, ownerId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async appendMessage(ownerId: string, input: { conversationId: string; role: 'user' | 'assistant' | 'tool' | 'system'; content: string; toolCalls?: unknown; toolCallId?: string | null; name?: string | null; tokenCount?: number | null }): Promise<import('../core/conversation.js').ConversationMessage> {
    const res = await this.q<{ id: string; conversation_id: string; owner_id: string; role: string; content: string; tool_calls: unknown; tool_call_id: string | null; name: string | null; token_count: number | null; created_at: string }>(
      `INSERT INTO public.conversation_messages
       (conversation_id, owner_id, role, content, tool_calls, tool_call_id, name, token_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, conversation_id, owner_id, role, content, tool_calls, tool_call_id, name, token_count, created_at`,
      [
        input.conversationId,
        ownerId,
        input.role,
        input.content,
        input.toolCalls ? JSON.stringify(input.toolCalls) : null,
        input.toolCallId ?? null,
        input.name ?? null,
        input.tokenCount ?? null,
      ],
    );
    const row = res[0]!;
    return {
      id: row.id,
      conversationId: row.conversation_id,
      ownerId: row.owner_id,
      role: row.role as 'user' | 'assistant' | 'tool' | 'system',
      content: row.content,
      toolCalls: row.tool_calls,
      toolCallId: row.tool_call_id,
      name: row.name,
      tokenCount: row.token_count,
      createdAt: row.created_at,
    };
  }

  async loadHistory(ownerId: string, conversationId: string, limit: number = 20): Promise<import('../core/conversation.js').ConversationMessage[]> {
    const res = await this.q<{ id: string; conversation_id: string; owner_id: string; role: string; content: string; tool_calls: unknown; tool_call_id: string | null; name: string | null; token_count: number | null; created_at: string }>(
      `SELECT id, conversation_id, owner_id, role, content, tool_calls, tool_call_id, name, token_count, created_at
       FROM public.conversation_messages
       WHERE conversation_id = $1 AND owner_id = $2
       ORDER BY created_at ASC`,
      [conversationId, ownerId],
    );
    const all = res.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      ownerId: row.owner_id,
      role: row.role as 'user' | 'assistant' | 'tool' | 'system',
      content: row.content,
      toolCalls: row.tool_calls,
      toolCallId: row.tool_call_id,
      name: row.name,
      tokenCount: row.token_count,
      createdAt: row.created_at,
    }));
    return all.slice(-limit);
  }

  // ————— Gate 19 — Audit query —————
  async queryAudit(ownerId: string, filter?: { limit?: number }): Promise<Record<string, unknown>[]> {
    const limit = filter?.limit ?? 50;
    const res = await this.pool.query(
      `SELECT * FROM public.audit_events WHERE project_id IN (SELECT id FROM public.projects WHERE owner_id = $1)
       ORDER BY id DESC LIMIT $2`,
      [ownerId, limit],
    );
    return res.rows;
  }

  // ————— Gate 21 — Stale RUNNING task recovery —————
  async recoverStaleRunningTasks(staleBefore: Date): Promise<number> {
    const res = await this.pool.query(
      `UPDATE public.tasks SET status = 'failed', error = $1, completed_at = now(), updated_at = now()
       WHERE status = 'running' AND started_at < $2`,
      [{ message: 'Process restarted while task was running. Stale RUNNING task recovered to FAILED.' }, staleBefore.toISOString()],
    );
    return res.rowCount ?? 0;
  }
}
