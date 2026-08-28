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
  MissionActivateResult,
  MissionInput,
  MissionMaterializeResult,
  MissionPlanCanonical,
  MissionRecord,
  PassportRecord,
  ProjectRecord,
  RecallItem,
  RuntimeInfo,
  TaskDependencyRecord,
  TaskRecord,
  TaskRunRecord,
} from '../core/types.js';
import type { AgentStats, AgentWorkload, BudgetReport, Store } from '../core/ports.js';
import { emptyPassport } from '../core/passport.js';
import { hashMissionPlan } from '../core/mission/missionEngine.js';
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

  // Gate 38 — Serialize dependency-edge mutations for a project through one
  // transaction-scoped advisory lock (app key 74738 + project hash). Must match
  // the key used by the DB cycle-guard trigger so that assignment/claim rechecks,
  // which run here under the same lock, are consistent with concurrent edge
  // insertions (a writer cannot slip a new edge past this recheck).
  private async lockDependencyAdvisory(client: import('pg').PoolClient, projectId: string): Promise<void> {
    await client.query(
      `SELECT pg_advisory_xact_lock(74738, hashtext('cf_td:' || ($1::text)))`,
      [projectId],
    );
  }

  // Gate 38 — True iff the task still has at least one unmet prerequisite. Must be
  // called inside the same transaction/locking boundary as the assignment/claim.
  private async hasUnmetPrerequisite(client: import('pg').PoolClient, taskId: string): Promise<boolean> {
    const res = await client.query<{ one: number }>(
      `SELECT 1 AS one
       WHERE EXISTS (
         SELECT 1 FROM public.task_dependencies d
         WHERE d.dependent_task_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM public.tasks pr
             WHERE pr.id = d.prerequisite_task_id AND pr.status = 'completed'
           )
       )`,
      [taskId],
    );
    return res.rows.length > 0;
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
         status, inputs, max_attempts, correlation_id, mission_id, mission_task_key, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning *`,
      [
        ownerId, data.projectId, data.title, data.description ?? null, data.agentId ?? null,
        data.priority ?? 'medium', data.riskLevel ?? 'low', data.authorityLevel ?? null,
        data.autonomy ?? null, data.approvalRequired ?? false,
        JSON.stringify(data.requiredCapabilities ?? []), data.preferredRole ?? null,
        data.status ?? 'created',
        JSON.stringify(data.inputs ?? {}), data.maxAttempts ?? 3, data.correlationId ?? null,
        data.missionId ?? null, data.missionTaskKey ?? null, data.createdBy ?? null,
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

  // Gate 37: Deterministic discovery of schedulable tasks.
  // DISCOVERY ONLY — owner/project scoped, unassigned, queued, within retry cap.
  // Never assigns, claims, mutates, or grants authority. Placement is the caller's
  // responsibility via placeTask (atomic authority). Ordering: created_at asc, id asc.
  async listSchedulableTasks(ownerId: string, filter?: { projectId?: string; limit?: number }): Promise<TaskRecord[]> {
    const conds = [
      'owner_id = $1',
      'agent_id is null',
      `status = 'queued'`,
      'attempts < coalesce(max_attempts, 3)',
      // Gate 38: readiness — a queued unassigned task is schedulable only when
      // ALL prerequisites are 'completed' (DEPENDENCY_SATISFIED_BY = COMPLETED_ONLY).
      // Indexed NOT EXISTS: candidate set is sourced from tasks_schedulable_discovery_idx
      // then gated by task_dependencies_dependent_idx.
      `NOT EXISTS (
        SELECT 1 FROM public.task_dependencies d
        WHERE d.dependent_task_id = tasks.id
          AND NOT EXISTS (
            SELECT 1 FROM public.tasks pr
            WHERE pr.id = d.prerequisite_task_id AND pr.status = 'completed'
          )
      )`,
    ];
    const params: unknown[] = [ownerId];
    if (filter?.projectId) {
      params.push(filter.projectId);
      conds.push(`project_id = $${params.length}`);
    }
    let sql = `select * from public.tasks where ${conds.join(' and ')} order by created_at asc, id asc`;
    if (filter?.limit !== undefined) {
      params.push(filter.limit);
      sql += ` limit $${params.length}`;
    }
    const res = await this.q<TaskRecord>(sql, params);
    return res.map((r) => ({ ...r }));
  }

  // ---------- Gate 38: Task dependency / DAG edges ----------
  // Canonical direction: prerequisite_task_id -> dependent_task_id.
  // Mutation is owner-scoped and serialized by the DB cycle-guard trigger.
  async addTaskDependency(ownerId: string, input: {
    prerequisiteTaskId: string;
    dependentTaskId: string;
    createdBy?: string | null;
  }): Promise<import('../core/ports.js').AddTaskDependencyResult> {
    const { prerequisiteTaskId, dependentTaskId, createdBy } = input;
    // Sequential owner-scoped lookups. These are kept sequential (not Promise.all)
    // because the live Store may be backed by a single shared connection, and two
    // queries fired concurrently on one client can yield incorrect/empty results.
    if (prerequisiteTaskId === dependentTaskId) return { ok: false, outcome: 'self_dependency', edge: null };
    const dep = await this.getTask(ownerId, dependentTaskId);
    if (!dep) return { ok: false, outcome: 'dependent_not_found', edge: null };
    const prereq = await this.getTask(ownerId, prerequisiteTaskId);
    if (!prereq) return { ok: false, outcome: 'prerequisite_not_found', edge: null };
    // Same owner is guaranteed by owner-scoped lookups above; same project is
    // required and also structurally enforced by the composite FK.
    if (prereq.projectId !== dep.projectId) return { ok: false, outcome: 'cross_scope', edge: null };
    // Gate 38 §7 mutation policy: never retroactively invalidate an in-flight or
    // finalized dependent. Adding a prerequisite to a running/completed/cancelled
    // task is denied.
    if (dep.status === 'running' || dep.status === 'completed' || dep.status === 'cancelled') {
      return { ok: false, outcome: 'dependent_not_editable', edge: null };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let rows: { rows: Record<string, unknown>[] };
      try {
        rows = await client.query(
          `INSERT INTO public.task_dependencies
             (owner_id, project_id, prerequisite_task_id, dependent_task_id, created_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (prerequisite_task_id, dependent_task_id) DO NOTHING
           RETURNING id, owner_id, project_id, prerequisite_task_id, dependent_task_id, created_by, created_at`,
          [ownerId, dep.projectId, prerequisiteTaskId, dependentTaskId, createdBy ?? null],
        );
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        await client.query('ROLLBACK');
        if (msg.includes('TASK_DEPENDENCY_CYCLE')) return { ok: false, outcome: 'cycle_detected', edge: null };
        if (msg.includes('TASK_DEPENDENCY_SELF')) return { ok: false, outcome: 'self_dependency', edge: null };
        if (msg.includes('foreign key')) return { ok: false, outcome: 'cross_scope', edge: null };
        throw e;
      }
      if (rows.rows.length === 0) {
        await client.query('COMMIT');
        await this.auditDependencyMutation({
          actorType: 'owner', actorId: ownerId, action: 'task.dependency.add',
          projectId: dep.projectId, taskId: dependentTaskId, edgeId: null,
          outcome: 'already_exists', prerequisiteTaskId,
        });
        return { ok: false, outcome: 'already_exists', edge: null };
      }
      await client.query('COMMIT');
      const edge = toCamel(rows.rows[0]!) as unknown as import('../core/types.js').TaskDependencyRecord;
      await this.auditDependencyMutation({
        actorType: 'owner', actorId: ownerId, action: 'task.dependency.add',
        projectId: dep.projectId, taskId: dependentTaskId, edgeId: edge.id,
        outcome: 'added', prerequisiteTaskId,
      });
      return { ok: true, outcome: 'added', edge };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async removeTaskDependency(ownerId: string, input: {
    prerequisiteTaskId: string;
    dependentTaskId: string;
  }): Promise<import('../core/ports.js').RemoveTaskDependencyResult> {
    const rows = await this.q<{ id: string; projectId: string }>(
      `DELETE FROM public.task_dependencies
       WHERE owner_id = $1 AND prerequisite_task_id = $2 AND dependent_task_id = $3
       RETURNING id, project_id`,
      [ownerId, input.prerequisiteTaskId, input.dependentTaskId],
    );
    if (rows.length === 0) return { ok: false, outcome: 'edge_not_found' };
    const edge = rows[0]!;
    await this.auditDependencyMutation({
      actorType: 'owner', actorId: ownerId, action: 'task.dependency.remove',
      projectId: edge.projectId, taskId: input.dependentTaskId, edgeId: edge.id,
      outcome: 'removed', prerequisiteTaskId: input.prerequisiteTaskId,
    });
    return { ok: true, outcome: 'removed' };
  }

  async listTaskDependencies(ownerId: string, filter?: {
    projectId?: string;
    prerequisiteTaskId?: string;
    dependentTaskId?: string;
  }): Promise<import('../core/ports.js').ListTaskDependenciesResult> {
    const conds = ['owner_id = $1'];
    const params: unknown[] = [ownerId];
    if (filter?.projectId) { params.push(filter.projectId); conds.push(`project_id = $${params.length}`); }
    if (filter?.prerequisiteTaskId) { params.push(filter.prerequisiteTaskId); conds.push(`prerequisite_task_id = $${params.length}`); }
    if (filter?.dependentTaskId) { params.push(filter.dependentTaskId); conds.push(`dependent_task_id = $${params.length}`); }
    const rows = await this.q<import('../core/types.js').TaskDependencyRecord>(
      `SELECT * FROM public.task_dependencies WHERE ${conds.join(' AND ')} ORDER BY created_at ASC`,
      params,
    );
    return { edges: rows };
  }

  // ---------- Gate 39: Missions (durable objective + validated plan) ----------

  private mapMissionRow(row: Record<string, unknown>): MissionRecord {
    const r = toCamel(row) as Record<string, unknown>;
    return {
      id: r['id'] as string,
      ownerId: r['ownerId'] as string,
      projectId: r['projectId'] as string,
      objective: r['objective'] as string,
      status: r['status'] as MissionRecord['status'],
      plan: (r['plan'] ?? {}) as import('../core/types.js').JsonObject,
      planHash: (r['planHash'] as string) ?? null,
      budgetLimit: r['budgetLimit'] != null ? Number(r['budgetLimit']) : null,
      createdBy: (r['createdBy'] as string) ?? null,
      createdAt: r['createdAt'] as string,
      updatedAt: r['updatedAt'] as string,
      approvedAt: (r['approvedAt'] as string) ?? null,
      materializedAt: (r['materializedAt'] as string) ?? null,
      activatedAt: (r['activatedAt'] as string) ?? null,
      completedAt: (r['completedAt'] as string) ?? null,
      failedAt: (r['failedAt'] as string) ?? null,
      cancelledAt: (r['cancelledAt'] as string) ?? null,
    };
  }

  async createMission(ownerId: string, input: MissionInput): Promise<MissionRecord> {
    const project = await this.getProject(ownerId, input.projectId);
    if (!project) throw new Error(`project ${input.projectId} not found for owner`);
    const rows = await this.q<Record<string, unknown>>(
      `insert into public.missions (owner_id, project_id, objective, budget_limit, created_by, status)
       values ($1,$2,$3,$4,$5,'draft') returning *`,
      [ownerId, input.projectId, input.objective, input.budgetLimit ?? null, input.createdBy ?? null],
    );
    return this.mapMissionRow(rows[0]!);
  }

  async getMission(ownerId: string, missionId: string): Promise<MissionRecord | null> {
    const rows = await this.q<Record<string, unknown>>(
      `select * from public.missions where owner_id = $1 and id = $2 limit 1`,
      [ownerId, missionId],
    );
    return rows[0] ? this.mapMissionRow(rows[0]) : null;
  }

  async listMissions(ownerId: string, filter?: { projectId?: string; status?: MissionRecord['status'] }): Promise<MissionRecord[]> {
    const conds = ['owner_id = $1'];
    const params: unknown[] = [ownerId];
    if (filter?.projectId) { params.push(filter.projectId); conds.push(`project_id = $${params.length}`); }
    if (filter?.status) { params.push(filter.status); conds.push(`status = $${params.length}`); }
    const rows = await this.q<Record<string, unknown>>(
      `select * from public.missions where ${conds.join(' and ')} order by created_at asc`,
      params,
    );
    return rows.map((r) => this.mapMissionRow(r));
  }

  async saveMissionPlan(ownerId: string, missionId: string, plan: MissionPlanCanonical, planHash: string): Promise<MissionRecord | null> {
    const rows = await this.q<Record<string, unknown>>(
      `update public.missions
       set plan = $3, plan_hash = $4, status = 'draft', updated_at = now()
       where owner_id = $1 and id = $2 and status in ('draft','pending_approval')
         and (plan_hash is null or plan_hash = $4)
       returning *`,
      [ownerId, missionId, plan, planHash],
    );
    return rows[0] ? this.mapMissionRow(rows[0]) : null;
  }

  async setMissionPendingApproval(ownerId: string, missionId: string): Promise<MissionRecord | null> {
    const rows = await this.q<Record<string, unknown>>(
      `update public.missions set status = 'pending_approval', updated_at = now()
       where owner_id = $1 and id = $2 and status = 'draft' and plan_hash is not null
       returning *`,
      [ownerId, missionId],
    );
    return rows[0] ? this.mapMissionRow(rows[0]) : null;
  }

  async markMissionApproved(ownerId: string, missionId: string): Promise<MissionRecord | null> {
    const rows = await this.q<Record<string, unknown>>(
      `update public.missions set status = 'approved', approved_at = now(), updated_at = now()
       where owner_id = $1 and id = $2 and status = 'pending_approval'
       returning *`,
      [ownerId, missionId],
    );
    return rows[0] ? this.mapMissionRow(rows[0]) : null;
  }

  async listMissionTasks(ownerId: string, missionId: string): Promise<TaskRecord[]> {
    return this.q<TaskRecord>(
      `select * from public.tasks where owner_id = $1 and mission_id = $2 order by created_at asc`,
      [ownerId, missionId],
    );
  }

  async updateMissionStatus(ownerId: string, missionId: string, to: MissionRecord['status']): Promise<MissionRecord | null> {
    const colMap: Record<string, string> = {
      completed: 'completed_at',
      failed: 'failed_at',
      cancelled: 'cancelled_at',
      active: 'activated_at',
      materialized: 'materialized_at',
      approved: 'approved_at',
    };
    const tsCol = colMap[to];
    const setSql = tsCol
      ? `status = $3, ${tsCol} = now(), updated_at = now()`
      : `status = $3, updated_at = now()`;
    const rows = await this.q<Record<string, unknown>>(
      `update public.missions set ${setSql}
       where owner_id = $1 and id = $2 and status <> $3 returning *`,
      [ownerId, missionId, to],
    );
    return rows[0] ? this.mapMissionRow(rows[0]) : null;
  }

  async materializeMissionPlanAtomic(ownerId: string, missionId: string, plan: MissionPlanCanonical): Promise<MissionMaterializeResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Advisory xact lock scoped to the mission (defense in depth; serializes
      // concurrent materializers of the same mission). App key 74739.
      const mHash = (await client.query<{ h: number }>(
        `SELECT hashtext('cf_mis:' || COALESCE(($1)::text, '')) AS h`,
        [missionId],
      )).rows[0]!.h;
      await client.query(`SELECT pg_advisory_xact_lock(74739, $1)`, [mHash]);

      // 1. Lock and read the mission.
      const mRows = await client.query<Record<string, unknown>>(
        `SELECT * FROM public.missions WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
        [missionId, ownerId],
      );
      if (mRows.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'mission_not_found', mission: null, taskCount: 0, edgeCount: 0 };
      }
      const mission = this.mapMissionRow(mRows.rows[0]!);

      // 2. Verify lifecycle: only approved may be materialized (idempotent-safe on repeat).
      if (mission.status === 'materialized' || mission.status === 'active') {
        // Already materialized — idempotent return; do not duplicate the graph.
        await client.query('ROLLBACK');
        const existing = await this.listMissionTasks(ownerId, missionId);
        return { ok: true, outcome: 'already_materialized', mission: await this.getMission(ownerId, missionId), taskCount: existing.length, edgeCount: 0 };
      }
      if (mission.status !== 'approved') {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'mission_not_approved', mission, taskCount: 0, edgeCount: 0 };
      }
      if (!mission.planHash) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'plan_not_hashed', mission, taskCount: 0, edgeCount: 0 };
      }

      // Changed plan after approval => STALE (MISSION_PLAN_APPROVAL_BINDS_TO_HASH = YES).
      if (hashMissionPlan(plan) !== mission.planHash) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'stale_approval', mission, taskCount: 0, edgeCount: 0 };
      }

      // 3. Approval must exist, be approved, and match owner/project/mission/plan hash.
      const appr = await client.query<{ id: string; status: string; plan_hash: string | null }>(
        `SELECT a.id, a.status,
                COALESCE((a.metadata->>'planHash'), '') AS plan_hash
         FROM public.approvals a
         WHERE a.owner_id = $1 AND a.project_id = $2
           AND a.action = 'mission.plan.approve' AND a.task_id IS NULL
           AND COALESCE((a.metadata->>'missionId'), '') = $3
         ORDER BY a.created_at DESC LIMIT 1`,
        [ownerId, mission.projectId, missionId],
      );
      const latest = appr.rows[0];
      if (!latest) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'no_approval', mission, taskCount: 0, edgeCount: 0 };
      }
      if (latest.status !== 'approved') {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'approval_not_approved', mission, taskCount: 0, edgeCount: 0 };
      }
      if (latest.plan_hash !== mission.planHash) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'stale_approval', mission, taskCount: 0, edgeCount: 0 };
      }

      // 4. Budget check: current project spend + validated estimated mission spend
      //    must not exceed the allowed budget (server/project/owner hard budget wins).
      const spend = await this.projectSpendLocked(client, ownerId, mission.projectId);
      const estimated = typeof plan.estimatedBudget === 'number' ? plan.estimatedBudget : 0;
      const maxB = await this.projectHardBudgetLocked(client, ownerId, mission.projectId);
      if (maxB != null && spend + estimated > maxB) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'budget_exceeded', mission, taskCount: 0, edgeCount: 0 };
      }

      // 5. Insert ALL tasks as status='created', agent_id NULL, mission_task_key set.
      const taskIdByKey = new Map<string, string>();
      for (const p of plan.tasks) {
        const tRows = await client.query<{ id: string }>(
          `INSERT INTO public.tasks (
             owner_id, project_id, title, description, priority, risk_level,
             required_capabilities, preferred_role, status, inputs, max_attempts,
             mission_id, mission_task_key, created_by, correlation_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'created',$9,$10,$11,$12,$13,$14)
           RETURNING id`,
          [
            ownerId, mission.projectId, p.title, p.description ?? null,
            p.priority ?? 'medium', p.riskLevel ?? 'low',
            JSON.stringify(p.requiredCapabilities ?? []), p.preferredRole ?? null,
            JSON.stringify(p.inputs ?? {}), p.maxAttempts ?? 3,
            mission.id, p.key, ownerId, null,
          ],
        );
        taskIdByKey.set(p.key, tRows.rows[0]!.id);
      }

      // 6. Insert ALL Gate 38 dependency edges.
      let edgesInserted = 0;
      for (const d of plan.dependencies) {
        const p = taskIdByKey.get(d.prerequisiteKey);
        const dep = taskIdByKey.get(d.dependentKey);
        if (!p || !dep) {
          await client.query('ROLLBACK');
          return { ok: false, outcome: 'dependency_key_missing', mission, taskCount: 0, edgeCount: 0 };
        }
        await client.query(
          `INSERT INTO public.task_dependencies (owner_id, project_id, prerequisite_task_id, dependent_task_id, created_by)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [ownerId, mission.projectId, p, dep, ownerId],
        );
        edgesInserted++;
      }

      // 7. Mark mission materialized (with materialized_at).
      await client.query(
        `UPDATE public.missions SET status = 'materialized', materialized_at = now(), updated_at = now()
         WHERE id = $1 AND owner_id = $2`,
        [missionId, ownerId],
      );

      await client.query('COMMIT');

      // Audit: mission.materialized (no secret-bearing content).
      await this.recordAudit({
        actorType: 'owner', actorId: ownerId, action: 'mission.materialized',
        projectId: mission.projectId, environmentId: null, resourceType: 'missions',
        resourceId: mission.id, authorizationResult: null, correlationId: null,
        taskId: null, metadata: { objectSummary: { taskCount: plan.tasks.length, edgeCount: plan.dependencies.length } },
      });

      const updated = await this.getMission(ownerId, missionId);
      return { ok: true, outcome: 'materialized', mission: updated, taskCount: plan.tasks.length, edgeCount: edgesInserted };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async activateMissionAtomic(ownerId: string, missionId: string): Promise<MissionActivateResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const mHash = (await client.query<{ h: number }>(
        `SELECT hashtext('cf_mis:' || COALESCE(($1)::text, '')) AS h`,
        [missionId],
      )).rows[0]!.h;
      await client.query(`SELECT pg_advisory_xact_lock(74739, $1)`, [mHash]);

      const mRows = await client.query<Record<string, unknown>>(
        `SELECT * FROM public.missions WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
        [missionId, ownerId],
      );
      if (mRows.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'mission_not_found', mission: null, queuedTaskCount: 0 };
      }
      const mission = this.mapMissionRow(mRows.rows[0]!);

      if (mission.status === 'active') {
        await client.query('ROLLBACK');
        const existing = await this.listMissionTasks(ownerId, missionId);
        return { ok: true, outcome: 'already_active', mission: await this.getMission(ownerId, missionId), queuedTaskCount: existing.filter((t) => t.status === 'queued').length };
      }
      if (mission.status !== 'materialized') {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'mission_not_materialized', mission, queuedTaskCount: 0 };
      }

      // Transition ALL mission tasks created → queued. Conditional UPDATE guards the
      // invariant that MISSION_ACTIVE never coexists with any task still 'created'.
      const upd = await client.query<{ id: string }>(
        `UPDATE public.tasks SET status = 'queued', updated_at = now()
         WHERE owner_id = $1 AND mission_id = $2 AND status = 'created'
         RETURNING id`,
        [ownerId, missionId],
      );
      // Verify NO mission task was left in 'created' (ALL or NONE).
      const left = await client.query<{ n: number }>(
        `SELECT count(*) AS n FROM public.tasks
         WHERE owner_id = $1 AND mission_id = $2 AND status = 'created'`,
        [ownerId, missionId],
      );
      if (Number(left.rows[0]!.n) > 0) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'partial_activation', mission, queuedTaskCount: 0 };
      }

      await client.query(
        `UPDATE public.missions SET status = 'active', activated_at = now(), updated_at = now()
         WHERE id = $1 AND owner_id = $2`,
        [missionId, ownerId],
      );

      await client.query('COMMIT');

      await this.recordAudit({
        actorType: 'owner', actorId: ownerId, action: 'mission.activated',
        projectId: mission.projectId, environmentId: null, resourceType: 'missions',
        resourceId: mission.id, authorizationResult: null, correlationId: null,
        taskId: null, metadata: { objectSummary: { queuedTaskCount: upd.rowCount ?? 0 } },
      });

      const updated = await this.getMission(ownerId, missionId);
      return { ok: true, outcome: 'activated', mission: updated, queuedTaskCount: upd.rowCount ?? 0 };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  // Current project spend, read inside the materialization transaction.
  private async projectSpendLocked(client: import('pg').PoolClient, ownerId: string, projectId: string): Promise<number> {
    const rows = await client.query<{ sum: string | null }>(
      `SELECT sum(amount) AS sum FROM public.cost_events WHERE owner_id = $1 AND project_id = $2`,
      [ownerId, projectId],
    );
    return Number(rows.rows[0]?.sum ?? 0);
  }

  // Server/project hard budget: preference 'budget'[projectId] ?? 'budget'['default'].
  // This matches getPreferences/projectBudget semantics and is authoritative: the
  // mission engine can never raise it.
  private async projectHardBudgetLocked(client: import('pg').PoolClient, ownerId: string, projectId: string): Promise<number | null> {
    const rows = await client.query<{ key: string; value: unknown; is_active: boolean }>(
      `SELECT key, value, is_active FROM public.personal_preferences
       WHERE owner_id = $1 AND category = 'budget' ORDER BY version ASC`,
      [ownerId],
    );
    const active: Record<string, unknown> = {};
    for (const r of rows.rows) {
      if (!r.is_active) continue;
      active[r.key] = r.value;
    }
    const budget = active;
    const maxAmount = budget ? ((budget[projectId] ?? budget['default']) as number | undefined) : undefined;
    return maxAmount != null ? Number(maxAmount) : null;
  }

  private async auditDependencyMutation(input: {
    actorType: import('../core/types.js').AuditEvent['actorType'];
    actorId: string;
    action: string;
    projectId: string | null;
    taskId: string | null;
    edgeId: string | null;
    outcome: string;
    prerequisiteTaskId: string;
  }): Promise<void> {
    await this.recordAudit({
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      projectId: input.projectId,
      environmentId: null,
      resourceType: 'task_dependencies',
      resourceId: input.edgeId,
      authorizationResult: null,
      correlationId: null,
      taskId: input.taskId,
      metadata: { outcome: input.outcome, prerequisiteTaskId: input.prerequisiteTaskId },
    });
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

  // Gate 30+31: Atomic assign-if-unassigned with capacity check. Never overwrites an existing assignment.
  // Lock order: Task → Agent (consistent with Gate 28 deadlock-safe protocol).
  // The transaction atomically checks agent_id IS NULL + capacity before writing.
  async assignTaskIfUnassigned(ownerId: string, taskId: string, agentId: string): Promise<import('../core/ports.js').AssignTaskIfUnassignedResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock and read the task
      const taskRows = await client.query<{ id: string; agent_id: string | null; project_id: string }>(
        `SELECT id, agent_id, project_id FROM public.tasks WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
        [taskId, ownerId],
      );
      if (taskRows.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'task_not_found', previousAgentId: null, nextAgentId: agentId };
      }
      const previousAgentId = taskRows.rows[0]!.agent_id;
      const taskProjectId = taskRows.rows[0]!.project_id;

      // 2. Atomic guard: if already assigned, NEVER overwrite
      if (previousAgentId !== null) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'already_assigned', previousAgentId, nextAgentId: agentId };
      }

      // Gate 38 — Readiness recheck inside the same locking boundary as the
      // assignment. Serialize against concurrent dependency mutations via the
      // project-scoped advisory lock (the same lock the edge trigger uses), then
      // verify ALL prerequisites are 'completed'. Fail closed on unmet dependency
      // so a stale discovery result can never yield an assignment.
      await this.lockDependencyAdvisory(client, taskProjectId);
      if (await this.hasUnmetPrerequisite(client, taskId)) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'not_ready', previousAgentId, nextAgentId: agentId };
      }

      // 3. Lock and validate agent
      const agentRows = await client.query<{ id: string; status: string; max_concurrent_tasks: number }>(
        `SELECT id, status, max_concurrent_tasks FROM public.agents WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
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

      // 4. Gate 31: Capacity check — count non-terminal assigned tasks while agent is locked
      const cap = agentRows.rows[0]!.max_concurrent_tasks;
      if (cap <= 0) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'agent_at_capacity', previousAgentId, nextAgentId: agentId };
      }
      const countRows = await client.query<{ cnt: string }>(
        `SELECT count(*) AS cnt FROM public.tasks
         WHERE agent_id = $1 AND owner_id = $2
           AND status NOT IN ('completed', 'failed', 'cancelled')`,
        [agentId, ownerId],
      );
      const currentWorkload = Number(countRows.rows[0]!.cnt ?? 0);
      if (currentWorkload >= cap) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'agent_at_capacity', previousAgentId, nextAgentId: agentId };
      }

      // 5. Atomic write — agent_id was NULL, now set
      await client.query(
        `UPDATE public.tasks SET agent_id = $3, updated_at = now() WHERE id = $1 AND owner_id = $2`,
        [taskId, ownerId, agentId],
      );

      await client.query('COMMIT');

      return { ok: true, outcome: 'assigned', previousAgentId: null, nextAgentId: agentId };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // Gate 34: Distributed-safe execution claim. Atomically transitions
  // queued → running only if task is assigned to this agent and currently queued.
  // Uses FOR UPDATE + conditional WHERE to prevent concurrent claims.
  async claimTaskForExecution(ownerId: string, taskId: string, agentId: string): Promise<import('../core/ports.js').ClaimTaskResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock and read the task
      const taskRows = await client.query<{
        id: string; agent_id: string | null; status: string; owner_id: string; project_id: string;
      }>(
        `SELECT id, agent_id, status, owner_id, project_id FROM public.tasks WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
        [taskId, ownerId],
      );
      if (taskRows.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'task_not_found', task: null };
      }
      const row = taskRows.rows[0]!;

      // 2. Verify assignment
      if (row.agent_id === null) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'not_assigned', task: null };
      }
      if (row.agent_id !== agentId) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'wrong_agent', task: null };
      }

      // 3. Verify task is queued (eligible for execution)
      if (row.status !== 'queued') {
        // If already running, return already_running
        if (row.status === 'running') {
          const full = await this.getTask(ownerId, taskId);
          await client.query('ROLLBACK');
          return { ok: false, outcome: 'already_running', task: full };
        }
        const full = await this.getTask(ownerId, taskId);
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'not_queued', task: full };
      }

      // Gate 38 — Readiness recheck inside the claim transaction. Serialize with
      // dependency mutations via the project advisory lock, then fail closed if an
      // unmet prerequisite exists. A stale discovery result can never reach
      // execution: DISCOVERY_READY_BUT_CLAIM_NOT_READY => EXECUTION_DENIED.
      await this.lockDependencyAdvisory(client, row.project_id);
      if (await this.hasUnmetPrerequisite(client, taskId)) {
        await client.query('ROLLBACK');
        const full = await this.getTask(ownerId, taskId);
        return { ok: false, outcome: 'not_ready', task: full };
      }

      // 4. Atomic claim: queued → running (WHERE guards against race)
      const now = new Date().toISOString();
      const updateRows = await client.query<{ id: string }>(
        `UPDATE public.tasks
         SET status = 'running', started_at = $3, updated_at = $3
         WHERE id = $1 AND owner_id = $2 AND status = 'queued' AND agent_id = $4
         RETURNING id`,
        [taskId, ownerId, now, agentId],
      );
      if (updateRows.rowCount === 0) {
        // Race lost — another claim won
        await client.query('ROLLBACK');
        const full = await this.getTask(ownerId, taskId);
        return { ok: false, outcome: 'already_running', task: full };
      }

      await client.query('COMMIT');

      const claimed = await this.getTask(ownerId, taskId);
      return { ok: true, outcome: 'claimed', task: claimed };
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
         authority_level, requested_by, expires_at, metadata
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [
        ownerId, data.projectId ?? null, data.taskId ?? null, data.agentId ?? null,
        data.action, data.description ?? null, data.riskLevel ?? null,
        data.authorityLevel ?? null, data.requestedBy ?? null, data.expiresAt ?? null,
        JSON.stringify(data.metadata ?? {}),
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
      ownerId: row['ownerId'] as string,
      name: row['name'] as string,
      slug: row['slug'] as string,
      role: row['role'] as string,
      description: (row['description'] as string) ?? null,
      capabilities: Array.isArray(row['capabilities']) ? row['capabilities'] as string[] : [],
      status: row['status'] as AgentRecord['status'],
      maxConcurrentTasks: row['maxConcurrentTasks'] != null ? Number(row['maxConcurrentTasks']) : 1,
      createdAt: row['createdAt'] as string,
      updatedAt: row['updatedAt'] as string,
    };
  }

  async createAgent(ownerId: string, data: AgentDefinition): Promise<AgentRecord> {
    const slug = data.slug ?? data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
    if (data.maxConcurrentTasks !== undefined) {
      const n = Number(data.maxConcurrentTasks);
      if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) throw new Error('maxConcurrentTasks must be a non-negative integer');
    }
    const maxConcurrent = data.maxConcurrentTasks != null ? Number(data.maxConcurrentTasks) : 1;
    const rows = await this.q<Record<string, unknown>>(
      `insert into public.agents (owner_id, name, slug, role, description, capabilities, status, max_concurrent_tasks)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [ownerId, data.name, slug, data.role, data.description ?? null, JSON.stringify(data.capabilities ?? []), data.status ?? 'active', maxConcurrent],
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
      maxConcurrentTasks: 'max_concurrent_tasks',
    };
    for (const [k, v] of Object.entries(patch)) {
      const col = field[k];
      if (!col) continue;
      if (k === 'maxConcurrentTasks') {
        const num = Number(v);
        if (!Number.isFinite(num) || num < 0 || Math.floor(num) !== num) throw new Error('maxConcurrentTasks must be a non-negative integer');
        params.push(num);
      } else if (k === 'capabilities') {
        params.push(JSON.stringify(v));
      } else {
        params.push(v === null ? null : v);
      }
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

  // Gate 31: Batch workload query — returns assignedCount and runningCount for all agents of an owner.
  async listAgentWorkload(ownerId: string): Promise<import('../core/ports.js').AgentWorkload[]> {
    const terminalStatuses = ['completed', 'failed', 'cancelled'];
    const rows = await this.q<{ agentId: string; assignedCount: string; runningCount: string }>(
      `SELECT
         agent_id,
         count(*) FILTER (WHERE status NOT IN (${terminalStatuses.map((_, i) => `$${i + 2}`).join(', ')})) AS assigned_count,
         count(*) FILTER (WHERE status = $${terminalStatuses.length + 2}) AS running_count
       FROM public.tasks
       WHERE owner_id = $1 AND agent_id IS NOT NULL
       GROUP BY agent_id`,
      [ownerId, ...terminalStatuses, 'running'],
    );
    return rows.map((r) => ({
      agentId: r.agentId,
      assignedCount: Number(r.assignedCount ?? 0),
      runningCount: Number(r.runningCount ?? 0),
    }));
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
