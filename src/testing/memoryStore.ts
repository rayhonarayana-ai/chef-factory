// Test fixture — in-memory Store implementation (deterministic, no I/O).
// Used by pipeline / isolation / audit unit tests. NOT shipped in build.

import type { Store, TaskPatch, ApprovalPatch, AgentStats, AgentWorkload, BudgetReport, WorkforceControlAdminPersistence } from '../core/ports.js';
import type {
  AgentRecord, AgentDefinition, AgentPatch,
  ApprovalRecord, AuditEvent, AutonomyDecision, CostEvent, DailyStatus, DecisionRecord,
  JsonObject, LessonInput, MissionInput, MissionPlanCanonical, MissionRecord, ModelInfo,
  PassportRecord, ProjectRecord, RecallItem, RuntimeInfo, TaskDependencyRecord, TaskRecord,
  TaskRunRecord,
} from '../core/types.js';
import type { ConversationRecord, ConversationMessage } from '../core/conversation.js';
import { emptyPassport } from '../core/passport.js';
import type { CriticalActionRule, RlsProbe, SecurityEventRecord, SecurityIncidentRecord, SecurityLockdownRecord } from '../core/security/types.js';
import { CRITICAL_ACTIONS } from '../core/security/criticalActions.js';
import { toSecurityEventRecord } from '../core/security/events.js';
import { toIncidentRecord, applyIncidentPatch } from '../core/security/incidents.js';
import { toLockdownRecord, canReleaseLockdown } from '../core/security/lockdown.js';
import type { WorkforceControlRecord } from '../core/security/workforceControl.js';
import { missionCanTransition, hashMissionPlan } from '../core/mission/missionEngine.js';

const uuid = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

export class MemoryStore implements Store, WorkforceControlAdminPersistence {
  projects: ProjectRecord[] = [];
  passports: PassportRecord[] = [];
  tasks: TaskRecord[] = [];
  taskRuns: TaskRunRecord[] = [];
  edges: TaskDependencyRecord[] = [];
  approvals: ApprovalRecord[] = [];
  audit: AuditEvent[] = [];
  costs: CostEvent[] = [];
  prefs: { category: string; key: string; value: unknown; version: number; isActive: boolean }[] = [];
  decisions: DecisionRecord[] = [];
  autonomy: AutonomyDecision[] = [];
  agents: AgentRecord[] = [];
  agentPermissions: Array<{ agentId: string; projectId: string | null; resourceType: string; permission: string }> = [];
  models: ModelInfo[] = [];
  runtimes: RuntimeInfo[] = [];
  securityEvents: SecurityEventRecord[] = [];
  securityIncidents: SecurityIncidentRecord[] = [];
  securityLockdowns: SecurityLockdownRecord[] = [];
  conversations: ConversationRecord[] = [];
  conversationMessages: ConversationMessage[] = [];
  missions: MissionRecord[] = [];
  workforceControl: WorkforceControlRecord | null = {
    singletonKey: 'global',
    globallyEnabled: true,
    reason: 'initial state — global workforce enabled',
    updatedBy: 'system',
    updatedAt: now(),
  };

  // projects / passports
  async getProjectBySlug(ownerId: string, slug: string): Promise<ProjectRecord | null> {
    return this.projects.find((p) => p.ownerId === ownerId && p.slug === slug && p.status !== 'deleted') ?? null;
  }
  async getProject(ownerId: string, projectId: string): Promise<ProjectRecord | null> {
    return this.projects.find((p) => p.ownerId === ownerId && p.id === projectId) ?? null;
  }
  async listProjects(ownerId: string): Promise<ProjectRecord[]> {
    return this.projects.filter((p) => p.ownerId === ownerId && p.status !== 'deleted');
  }
  async createProject(ownerId: string, data: { name: string; slug: string; description?: string }): Promise<ProjectRecord> {
    const p: ProjectRecord = { id: uuid(), ownerId, name: data.name, slug: data.slug, description: data.description ?? null, status: 'active', metadata: {}, createdAt: now(), updatedAt: now() };
    this.projects.push(p);
    const pass = emptyPassport(p.id);
    pass.description = data.description ?? null;
    this.passports.push(pass);
    return p;
  }
  async getPassport(ownerId: string, projectId: string): Promise<PassportRecord | null> {
    const p = this.projects.find((x) => x.ownerId === ownerId && x.id === projectId);
    if (!p) return null;
    return this.passports.find((x) => x.projectId === projectId) ?? emptyPassport(projectId);
  }
  async upsertPassport(ownerId: string, projectId: string, patch: Partial<PassportRecord>): Promise<PassportRecord> {
    const base = (await this.getPassport(ownerId, projectId)) ?? emptyPassport(projectId);
    const merged = { ...base, ...patch, projectId };
    const idx = this.passports.findIndex((x) => x.projectId === projectId);
    if (idx >= 0) this.passports[idx] = merged; else this.passports.push(merged);
    return merged;
  }

  // tasks
  async createTask(ownerId: string, data: Parameters<Store['createTask']>[1]): Promise<TaskRecord> {
    if (data.agentId != null) {
      const agent = await this.getAgent(ownerId, data.agentId);
      if (!agent) throw new Error('cross-owner agent assignment rejected: agent not found or belongs to another owner');
    }
    const t: TaskRecord = {
      id: uuid(), ownerId, projectId: data.projectId, environmentId: null, parentTaskId: null,
      agentId: data.agentId ?? null, title: data.title, description: data.description ?? null,
      status: data.status ?? 'created', priority: data.priority ?? 'medium', riskLevel: data.riskLevel ?? 'low',
      authorityLevel: data.authorityLevel ?? null, autonomy: data.autonomy ?? null,
      approvalRequired: data.approvalRequired ?? false,
      requiredCapabilities: data.requiredCapabilities ?? [], preferredRole: data.preferredRole ?? null,
      inputs: data.inputs ?? {}, output: null, error: null,
      attempts: 0, maxAttempts: data.maxAttempts ?? 3, correlationId: data.correlationId ?? null,
      missionId: data.missionId ?? null, missionTaskKey: data.missionTaskKey ?? null,
      createdBy: data.createdBy ?? null, createdAt: now(), startedAt: null, completedAt: null, updatedAt: now(),
    };
    this.tasks.push(t);
    return t;
  }
  async getTask(ownerId: string, taskId: string): Promise<TaskRecord | null> {
    return this.tasks.find((t) => t.ownerId === ownerId && t.id === taskId) ?? null;
  }
  async listTasks(ownerId: string, filter?: { projectId?: string; status?: TaskRecord['status'] }): Promise<TaskRecord[]> {
    return this.tasks.filter((t) => t.ownerId === ownerId && (!filter?.projectId || t.projectId === filter.projectId) && (!filter?.status || t.status === filter.status));
  }
  // Gate 37: Deterministic discovery of schedulable tasks (mirrors SupabaseStore).
  // Unassigned, queued, within retry cap, owner/project scoped. Read-only.
  async listSchedulableTasks(ownerId: string, filter?: { projectId?: string; limit?: number }): Promise<TaskRecord[]> {
    const maxAttempts = 3;
    const rows = this.tasks
      .filter((t) => t.ownerId === ownerId)
      .filter((t) => (filter?.projectId ? t.projectId === filter.projectId : true))
      .filter((t) => t.agentId === null)
      .filter((t) => t.status === 'queued')
      .filter((t) => t.attempts < (t.maxAttempts && t.maxAttempts > 0 ? t.maxAttempts : maxAttempts))
      // Gate 38: readiness — only tasks with ALL prerequisites 'completed' are schedulable.
      .filter((t) => this.isDependencyReady(t))
      .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
    const limit = filter?.limit;
    const limited = limit !== undefined ? rows.slice(0, limit) : rows;
    return limited.map((t) => ({ ...t }));
  }

  // Gate 41: narrow scheduler owner discovery — distinct owners with ≥1 schedulable task.
  async listOwnersWithSchedulableWork(opts?: { limit?: number }): Promise<string[]> {
    const maxAttempts = 3;
    const limit = opts?.limit !== undefined && Number.isFinite(opts.limit) && opts.limit! > 0 ? Math.min(Math.floor(opts.limit!), 500) : 100;
    const owners = new Set<string>();
    for (const t of this.tasks) {
      if (t.agentId !== null) continue;
      if (t.status !== 'queued') continue;
      if (t.attempts >= (t.maxAttempts && t.maxAttempts > 0 ? t.maxAttempts : maxAttempts)) continue;
      if (!this.isDependencyReady(t)) continue;
      owners.add(t.ownerId);
      if (owners.size >= limit) break;
    }
    return Array.from(owners).sort();
  }

  // ---------- Gate 38: Task dependency / DAG edges (MemoryStore parity) ----------
  private isDependencyReady(t: TaskRecord): boolean {
    return !this.hasUnmetPrerequisite(t.id);
  }

  private hasUnmetPrerequisite(taskId: string): boolean {
    for (const edge of this.edges) {
      if (edge.dependentTaskId !== taskId) continue;
      const prereq = this.tasks.find((x) => x.id === edge.prerequisiteTaskId);
      if (!prereq || prereq.status !== 'completed') return true;
    }
    return false;
  }

  // Mirror of the DB cycle-guard semantics: inserting P -> D forms a cycle iff D
  // can already reach P following the prerequisite->dependent (forward) direction.
  private wouldCreateCycle(prerequisiteTaskId: string, dependentTaskId: string): boolean {
    const visited = new Set<string>();
    const stack = [dependentTaskId];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === prerequisiteTaskId) return true;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const e of this.edges) {
        if (e.prerequisiteTaskId === cur) stack.push(e.dependentTaskId);
      }
    }
    return false;
  }

  async addTaskDependency(ownerId: string, input: {
    prerequisiteTaskId: string;
    dependentTaskId: string;
    createdBy?: string | null;
  }): Promise<import('../core/ports.js').AddTaskDependencyResult> {
    const { prerequisiteTaskId, dependentTaskId, createdBy } = input;
    const prereq = this.tasks.find((x) => x.ownerId === ownerId && x.id === prerequisiteTaskId) ?? null;
    const dep = this.tasks.find((x) => x.ownerId === ownerId && x.id === dependentTaskId) ?? null;
    if (!dep) return { ok: false, outcome: 'dependent_not_found', edge: null };
    if (!prereq) return { ok: false, outcome: 'prerequisite_not_found', edge: null };
    if (prerequisiteTaskId === dependentTaskId) return { ok: false, outcome: 'self_dependency', edge: null };
    // Same owner guaranteed by owner-scoped lookups; same project required (FK parity).
    if (prereq.projectId !== dep.projectId) return { ok: false, outcome: 'cross_scope', edge: null };
    if (dep.status === 'running' || dep.status === 'completed' || dep.status === 'cancelled') {
      return { ok: false, outcome: 'dependent_not_editable', edge: null };
    }
    const existing = this.edges.find((e) => e.prerequisiteTaskId === prerequisiteTaskId && e.dependentTaskId === dependentTaskId);
    if (existing) {
      await this.recordAudit({ actorType: 'owner', actorId: ownerId, action: 'task.dependency.add', projectId: dep.projectId, environmentId: null, resourceType: 'task_dependencies', resourceId: existing.id, authorizationResult: null, correlationId: null, taskId: dependentTaskId, metadata: { outcome: 'already_exists', prerequisiteTaskId } });
      return { ok: false, outcome: 'already_exists', edge: existing };
    }
    if (this.wouldCreateCycle(prerequisiteTaskId, dependentTaskId)) {
      return { ok: false, outcome: 'cycle_detected', edge: null };
    }
    const edge: TaskDependencyRecord = { id: uuid(), ownerId, projectId: dep.projectId, prerequisiteTaskId, dependentTaskId, createdBy: createdBy ?? null, createdAt: now() };
    this.edges.push(edge);
    await this.recordAudit({ actorType: 'owner', actorId: ownerId, action: 'task.dependency.add', projectId: dep.projectId, environmentId: null, resourceType: 'task_dependencies', resourceId: edge.id, authorizationResult: null, correlationId: null, taskId: dependentTaskId, metadata: { outcome: 'added', prerequisiteTaskId } });
    return { ok: true, outcome: 'added', edge };
  }

  async removeTaskDependency(ownerId: string, input: {
    prerequisiteTaskId: string;
    dependentTaskId: string;
  }): Promise<import('../core/ports.js').RemoveTaskDependencyResult> {
    const idx = this.edges.findIndex((e) => e.ownerId === ownerId && e.prerequisiteTaskId === input.prerequisiteTaskId && e.dependentTaskId === input.dependentTaskId);
    if (idx < 0) return { ok: false, outcome: 'edge_not_found' };
    const edge = this.edges[idx]!;
    this.edges.splice(idx, 1);
    await this.recordAudit({ actorType: 'owner', actorId: ownerId, action: 'task.dependency.remove', projectId: edge.projectId, environmentId: null, resourceType: 'task_dependencies', resourceId: edge.id, authorizationResult: null, correlationId: null, taskId: input.dependentTaskId, metadata: { outcome: 'removed', prerequisiteTaskId: input.prerequisiteTaskId } });
    return { ok: true, outcome: 'removed' };
  }

  async listTaskDependencies(ownerId: string, filter?: {
    projectId?: string;
    prerequisiteTaskId?: string;
    dependentTaskId?: string;
  }): Promise<import('../core/ports.js').ListTaskDependenciesResult> {
    const edges = this.edges.filter(
      (e) => e.ownerId === ownerId
        && (!filter?.projectId || e.projectId === filter.projectId)
        && (!filter?.prerequisiteTaskId || e.prerequisiteTaskId === filter.prerequisiteTaskId)
        && (!filter?.dependentTaskId || e.dependentTaskId === filter.dependentTaskId),
    );
    return { edges: edges.map((e) => ({ ...e })) };
  }

  // ---------- Gate 39: Missions (MemoryStore parity) ----------
  async createMission(ownerId: string, input: MissionInput): Promise<MissionRecord> {
    const project = await this.getProject(ownerId, input.projectId);
    if (!project) throw new Error(`project ${input.projectId} not found for owner`);
    const m: MissionRecord = {
      id: uuid(), ownerId, projectId: input.projectId, objective: input.objective,
      status: 'draft', plan: {}, planHash: null, budgetLimit: input.budgetLimit ?? null,
      createdBy: input.createdBy ?? null, createdAt: now(), updatedAt: now(),
      approvedAt: null, materializedAt: null, activatedAt: null, completedAt: null,
      failedAt: null, cancelledAt: null,
    };
    this.missions.push(m);
    return m;
  }
  async getMission(ownerId: string, missionId: string): Promise<MissionRecord | null> {
    return this.missions.find((m) => m.ownerId === ownerId && m.id === missionId) ?? null;
  }
  async listMissions(ownerId: string, filter?: { projectId?: string; status?: MissionRecord['status'] }): Promise<MissionRecord[]> {
    return this.missions
      .filter((m) => m.ownerId === ownerId
        && (!filter?.projectId || m.projectId === filter.projectId)
        && (!filter?.status || m.status === filter.status))
      .map((m) => ({ ...m }));
  }
  async saveMissionPlan(ownerId: string, missionId: string, plan: MissionPlanCanonical, planHash: string): Promise<MissionRecord | null> {
    const m = this.missions.find((x) => x.ownerId === ownerId && x.id === missionId);
    if (!m) return null;
    if (!['draft', 'pending_approval'].includes(m.status)) return null;
    if (m.planHash && m.planHash !== planHash) return null;
    m.plan = plan as unknown as JsonObject;
    m.planHash = planHash;
    m.status = 'draft';
    m.updatedAt = now();
    return { ...m };
  }
  async setMissionPendingApproval(ownerId: string, missionId: string): Promise<MissionRecord | null> {
    const m = this.missions.find((x) => x.ownerId === ownerId && x.id === missionId);
    if (!m) return null;
    if (m.status !== 'draft' || !m.planHash) return null;
    m.status = 'pending_approval';
    m.updatedAt = now();
    return { ...m };
  }
  async markMissionApproved(ownerId: string, missionId: string): Promise<MissionRecord | null> {
    const m = this.missions.find((x) => x.ownerId === ownerId && x.id === missionId);
    if (!m) return null;
    if (m.status !== 'pending_approval') return null;
    m.status = 'approved';
    m.approvedAt = now();
    m.updatedAt = now();
    return { ...m };
  }
  async listMissionTasks(ownerId: string, missionId: string): Promise<TaskRecord[]> {
    return this.tasks.filter((t) => t.ownerId === ownerId && t.missionId === missionId).map((t) => ({ ...t }));
  }

  async updateMissionStatus(ownerId: string, missionId: string, to: MissionRecord['status']): Promise<MissionRecord | null> {
    const m = this.missions.find((x) => x.ownerId === ownerId && x.id === missionId);
    if (!m) return null;
    if (m.status === to) return null;
    if (!missionCanTransition(m.status, to)) return null;
    const tsField: Record<string, keyof MissionRecord> = {
      completed: 'completedAt', failed: 'failedAt', cancelled: 'cancelledAt',
      active: 'activatedAt', materialized: 'materializedAt', approved: 'approvedAt',
    };
    m.status = to;
    m.updatedAt = now();
    const field = tsField[to];
    if (field) (m as unknown as Record<string, unknown>)[field] = now();
    return { ...m };
  }

  // Project hard budget from preferences ('budget'[projectId] ?? 'budget'['default']).
  private async missionHardBudget(ownerId: string, projectId: string): Promise<number | null> {
    const active: Record<string, unknown> = {};
    for (const p of this.prefs) {
      if (!p.isActive || p.category !== 'budget') continue;
      active[p.key] = p.value;
    }
    const maxAmount = active[projectId] ?? active['default'];
    return maxAmount != null ? Number(maxAmount) : null;
  }
  async materializeMissionPlanAtomic(ownerId: string, missionId: string, plan: MissionPlanCanonical): Promise<import('../core/types.js').MissionMaterializeResult> {
    const m = this.missions.find((x) => x.ownerId === ownerId && x.id === missionId);
    if (!m) return { ok: false, outcome: 'mission_not_found', mission: null, taskCount: 0, edgeCount: 0 };
    if (m.status === 'materialized' || m.status === 'active') {
      const existing = await this.listMissionTasks(ownerId, missionId);
      return { ok: true, outcome: 'already_materialized', mission: { ...m }, taskCount: existing.length, edgeCount: 0 };
    }
    if (m.status !== 'approved') return { ok: false, outcome: 'mission_not_approved', mission: { ...m }, taskCount: 0, edgeCount: 0 };
    if (!m.planHash) return { ok: false, outcome: 'plan_not_hashed', mission: { ...m }, taskCount: 0, edgeCount: 0 };
    // Changed plan after approval => STALE (MISSION_PLAN_APPROVAL_BINDS_TO_HASH = YES).
    if (hashMissionPlan(plan) !== m.planHash) return { ok: false, outcome: 'stale_approval', mission: { ...m }, taskCount: 0, edgeCount: 0 };
    // Approval check: an approved mission.plan.approve approval bound to this
    // mission + hash must exist (metadata carries { missionId, planHash }).
    const appr = this.approvals.find(
      (a) => a.ownerId === ownerId && a.projectId === m.projectId
        && a.action === 'mission.plan.approve' && a.status === 'approved'
        && (a.metadata?.['missionId']) === m.id
        && (a.metadata?.['planHash']) === m.planHash,
    );
    if (!appr) return { ok: false, outcome: 'no_approval', mission: { ...m }, taskCount: 0, edgeCount: 0 };
    // Budget check: project hard budget (preferences 'budget') is authoritative.
    const spend = await this.totalCost(ownerId, m.projectId);
    const estimated = typeof plan.estimatedBudget === 'number' ? plan.estimatedBudget : 0;
    const maxB = await this.missionHardBudget(ownerId, m.projectId);
    if (maxB != null && spend + estimated > maxB) {
      return { ok: false, outcome: 'budget_exceeded', mission: { ...m }, taskCount: 0, edgeCount: 0 };
    }
    const taskIdByKey = new Map<string, string>();
    for (const p of plan.tasks) {
      const t = await this.createTask(ownerId, {
        projectId: m.projectId, title: p.title, description: p.description ?? undefined,
        priority: p.priority, riskLevel: p.riskLevel, requiredCapabilities: p.requiredCapabilities,
        preferredRole: p.preferredRole ?? null, inputs: p.inputs, maxAttempts: p.maxAttempts,
        status: 'created', missionId: m.id, missionTaskKey: p.key, createdBy: ownerId,
      });
      taskIdByKey.set(p.key, t.id);
    }
    let edgesInserted = 0;
    for (const d of plan.dependencies) {
      const p = taskIdByKey.get(d.prerequisiteKey);
      const dep = taskIdByKey.get(d.dependentKey);
      if (!p || !dep) return { ok: false, outcome: 'dependency_key_missing', mission: { ...m }, taskCount: 0, edgeCount: 0 };
      await this.addTaskDependency(ownerId, { prerequisiteTaskId: p, dependentTaskId: dep, createdBy: ownerId });
      edgesInserted++;
    }
    m.status = 'materialized';
    m.materializedAt = now();
    m.updatedAt = now();
    return { ok: true, outcome: 'materialized', mission: { ...m }, taskCount: plan.tasks.length, edgeCount: edgesInserted };
  }
  async activateMissionAtomic(ownerId: string, missionId: string): Promise<import('../core/types.js').MissionActivateResult> {
    const m = this.missions.find((x) => x.ownerId === ownerId && x.id === missionId);
    if (!m) return { ok: false, outcome: 'mission_not_found', mission: null, queuedTaskCount: 0 };
    if (m.status === 'active') {
      const existing = await this.listMissionTasks(ownerId, missionId);
      return { ok: true, outcome: 'already_active', mission: { ...m }, queuedTaskCount: existing.filter((t) => t.status === 'queued').length };
    }
    if (m.status !== 'materialized') return { ok: false, outcome: 'mission_not_materialized', mission: { ...m }, queuedTaskCount: 0 };
    const missionTasks = this.tasks.filter((t) => t.ownerId === ownerId && t.missionId === missionId);
    for (const t of missionTasks) {
      if (t.status === 'created') {
        t.status = 'queued';
        t.updatedAt = now();
      }
    }
    const stillCreated = missionTasks.filter((t) => t.status === 'created').length;
    if (stillCreated > 0) return { ok: false, outcome: 'partial_activation', mission: { ...m }, queuedTaskCount: 0 };
    m.status = 'active';
    m.activatedAt = now();
    m.updatedAt = now();
    return { ok: true, outcome: 'activated', mission: { ...m }, queuedTaskCount: missionTasks.filter((t) => t.status === 'queued').length };
  }

  async patchTask(ownerId: string, taskId: string, patch: TaskPatch): Promise<TaskRecord> {
    const t = await this.getTask(ownerId, taskId);
    if (!t) throw new Error('task not found');
    if (patch.agentId !== undefined && patch.agentId !== null) {
      const agent = await this.getAgent(ownerId, patch.agentId);
      if (!agent) throw new Error('cross-owner agent assignment rejected: agent not found or belongs to another owner');
    }
    const next = { ...t, ...patch, updatedAt: now() };
    this.tasks[this.tasks.indexOf(t)] = next;
    return next;
  }
  async assignTask(ownerId: string, taskId: string, agentId: string | null): Promise<import('../core/ports.js').AssignTaskResult> {
    const t = this.tasks.find((x) => x.ownerId === ownerId && x.id === taskId);
    if (!t) return { ok: false, outcome: 'task_not_found', previousAgentId: null, nextAgentId: agentId };
    const previousAgentId = t.agentId;
    if (previousAgentId === agentId) return { ok: true, outcome: 'no_change', previousAgentId, nextAgentId: agentId };
    if (agentId !== null) {
      const agent = this.agents.find((a) => a.ownerId === ownerId && a.id === agentId);
      if (!agent) return { ok: false, outcome: 'agent_not_found', previousAgentId, nextAgentId: agentId };
      if (agent.status !== 'active') return { ok: false, outcome: 'agent_not_eligible', previousAgentId, nextAgentId: agentId };
    }
    t.agentId = agentId;
    t.updatedAt = now();
    return { ok: true, outcome: agentId !== null ? 'assigned' : 'unassigned', previousAgentId, nextAgentId: agentId };
  }

  // Gate 30+31: Atomic assign-if-unassigned with capacity check. Never overwrites an existing assignment.
  async assignTaskIfUnassigned(ownerId: string, taskId: string, agentId: string): Promise<import('../core/ports.js').AssignTaskIfUnassignedResult> {
    const t = this.tasks.find((x) => x.ownerId === ownerId && x.id === taskId);
    if (!t) return { ok: false, outcome: 'task_not_found', previousAgentId: null, nextAgentId: agentId };
    const previousAgentId = t.agentId;
    if (previousAgentId !== null) return { ok: false, outcome: 'already_assigned', previousAgentId, nextAgentId: agentId };
    // Gate 38: readiness recheck — never assign a task with an unmet prerequisite.
    if (!this.isDependencyReady(t)) return { ok: false, outcome: 'not_ready', previousAgentId, nextAgentId: agentId };
    const agent = this.agents.find((a) => a.ownerId === ownerId && a.id === agentId);
    if (!agent) return { ok: false, outcome: 'agent_not_found', previousAgentId, nextAgentId: agentId };
    if (agent.status !== 'active') return { ok: false, outcome: 'agent_not_eligible', previousAgentId, nextAgentId: agentId };
    // Gate 31: Capacity check
    if (agent.maxConcurrentTasks <= 0) return { ok: false, outcome: 'agent_at_capacity', previousAgentId, nextAgentId: agentId };
    const terminalStatuses = ['completed', 'failed', 'cancelled'];
    const currentWorkload = this.tasks.filter(
      (x) => x.agentId === agentId && x.ownerId === ownerId && !terminalStatuses.includes(x.status),
    ).length;
    if (currentWorkload >= agent.maxConcurrentTasks) return { ok: false, outcome: 'agent_at_capacity', previousAgentId, nextAgentId: agentId };
    t.agentId = agentId;
    t.updatedAt = now();
    return { ok: true, outcome: 'assigned', previousAgentId: null, nextAgentId: agentId };
  }

  // Gate 34: Distributed-safe execution claim (memory simulation).
  // Atomically transitions queued → running only if assigned and queued.
  async claimTaskForExecution(ownerId: string, taskId: string, agentId: string): Promise<import('../core/ports.js').ClaimTaskResult> {
    const t = this.tasks.find((x) => x.ownerId === ownerId && x.id === taskId);
    if (!t) return { ok: false, outcome: 'task_not_found', task: null };
    if (t.agentId === null) return { ok: false, outcome: 'not_assigned', task: null };
    if (t.agentId !== agentId) return { ok: false, outcome: 'wrong_agent', task: null };
    if (t.status === 'running') return { ok: false, outcome: 'already_running', task: { ...t } };
    if (t.status !== 'queued') return { ok: false, outcome: 'not_queued', task: { ...t } };
    // Gate 38: readiness recheck — deny execution claim if an unmet prerequisite exists.
    if (!this.isDependencyReady(t)) return { ok: false, outcome: 'not_ready', task: { ...t } };
    // Simulate atomic claim
    t.status = 'running';
    t.startedAt = now();
    t.updatedAt = now();
    return { ok: true, outcome: 'claimed', task: { ...t } };
  }

  async createTaskRun(ownerId: string, data: { taskId: string; runNumber: number; modelId?: string | null; runtimeId?: string | null; inputSnapshot?: JsonObject | null }): Promise<TaskRunRecord> {
    const r: TaskRunRecord = { id: uuid(), taskId: data.taskId, runNumber: data.runNumber, status: 'running', modelId: data.modelId ?? null, runtimeId: data.runtimeId ?? null, inputSnapshot: data.inputSnapshot ?? null, outputSnapshot: null, error: null, durationMs: null, cost: 0, startedAt: now(), completedAt: null };
    this.taskRuns.push(r);
    return r;
  }
  async completeTaskRun(ownerId: string, runId: string, patch: Parameters<Store['completeTaskRun']>[2]): Promise<TaskRunRecord> {
    const r = this.taskRuns.find((x) => x.id === runId);
    if (!r) throw new Error('run not found');
    const next = { ...r, ...patch };
    this.taskRuns[this.taskRuns.indexOf(r)] = next;
    return next;
  }

  // approvals
  async createApproval(ownerId: string, data: Parameters<Store['createApproval']>[1]): Promise<ApprovalRecord> {
    const a: ApprovalRecord = { id: uuid(), ownerId, projectId: data.projectId ?? null, taskId: data.taskId ?? null, agentId: data.agentId ?? null, action: data.action, description: data.description ?? null, riskLevel: data.riskLevel ?? null, authorityLevel: data.authorityLevel ?? null, status: 'pending', decision: null, decisionReason: null, requestedBy: data.requestedBy ?? null, decidedBy: null, expiresAt: data.expiresAt ?? null, decidedAt: null, metadata: data.metadata ?? {}, createdAt: now() };
    this.approvals.push(a);
    return a;
  }
  async getApproval(ownerId: string, approvalId: string): Promise<ApprovalRecord | null> {
    return this.approvals.find((a) => a.ownerId === ownerId && a.id === approvalId) ?? null;
  }
  async listApprovals(ownerId: string, filter?: { projectId?: string; taskId?: string; status?: ApprovalRecord['status'] }): Promise<ApprovalRecord[]> {
    return this.approvals.filter((a) => a.ownerId === ownerId && (!filter?.projectId || a.projectId === filter.projectId) && (!filter?.taskId || a.taskId === filter.taskId) && (!filter?.status || a.status === filter.status));
  }
  async patchApproval(ownerId: string, approvalId: string, patch: ApprovalPatch): Promise<ApprovalRecord> {
    const a = await this.getApproval(ownerId, approvalId);
    if (!a) throw new Error('approval not found');
    const next = { ...a, ...patch };
    this.approvals[this.approvals.indexOf(a)] = next;
    return next;
  }

  // audit / costs
  async recordAudit(event: AuditEvent): Promise<void> {
    this.audit.push({ ...event });
  }
  async recordCost(event: CostEvent): Promise<void> {
    this.costs.push(event);
  }
  async totalCost(ownerId: string, projectId?: string | null): Promise<number> {
    return this.costs.filter((c) => c.ownerId === ownerId && (!projectId || c.projectId === projectId)).reduce((s, c) => s + c.amount, 0);
  }
  async projectBudget(ownerId: string, projectId: string): Promise<BudgetReport> {
    return { period: 'month', amount: await this.totalCost(ownerId, projectId), daily: 0, maxAmount: null, exceeded: false };
  }
  async missionCost(ownerId: string, missionId: string): Promise<number> {
    const missionTasks = new Set(
      this.tasks.filter((t) => t.ownerId === ownerId && t.missionId === missionId).map((t) => t.id),
    );
    return this.costs
      .filter((c) => c.ownerId === ownerId && c.taskId !== null && missionTasks.has(c.taskId))
      .reduce((s, c) => s + c.amount, 0);
  }

  // preferences
  async getPreferences(ownerId: string): Promise<JsonObject> {
    const out: JsonObject = {};
    for (const p of this.prefs) {
      if (!p.isActive) continue;
      const b = (out[p.category] ?? {}) as JsonObject;
      b[p.key] = p.value;
      out[p.category] = b;
    }
    return out;
  }
  async setPreference(ownerId: string, category: string, key: string, value: unknown): Promise<void> {
    for (const p of this.prefs) if (p.category === category && p.key === key) p.isActive = false;
    const version = this.prefs.filter((p) => p.category === category && p.key === key).length + 1;
    this.prefs.push({ category, key, value, version, isActive: true });
  }

  // decisions / autonomy
  async recordDecision(ownerId: string, d: Parameters<Store['recordDecision']>[1]): Promise<DecisionRecord> {
    const rec: DecisionRecord = { decisionId: uuid(), ownerId, projectId: d.projectId ?? null, context: d.context, options: d.options, selectedOption: d.selectedOption ?? null, reason: d.reason ?? null, evidence: d.evidence ?? [], confidence: d.confidence ?? null, riskLevel: d.riskLevel ?? null, authorityLevel: d.authorityLevel ?? null, approvedBy: d.approvedBy ?? null, outcome: d.outcome ?? null, createdAt: now() };
    this.decisions.push(rec);
    return rec;
  }
  async listDecisions(ownerId: string): Promise<DecisionRecord[]> {
    return this.decisions.filter((d) => d.ownerId === ownerId);
  }
  async recordAutonomy(ownerId: string, record: { agentId: string; projectId?: string | null; environmentId?: string | null; action: string; riskLevel?: TaskRecord['riskLevel']; selected: AutonomyDecision; approvalStatus?: string; outcome?: string }): Promise<void> {
    void ownerId; void record;
    this.autonomy.push(record.selected);
  }

  // models / runtimes
  async listModels(ownerId: string): Promise<ModelInfo[]> {
    void ownerId;
    return this.models.slice();
  }
  async listRuntimes(ownerId: string): Promise<RuntimeInfo[]> {
    void ownerId;
    return this.runtimes.slice();
  }

  // agents / permissions (Gate 25: full CRUD)
  async createAgent(ownerId: string, data: AgentDefinition): Promise<AgentRecord> {
    const slug = data.slug ?? data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
    if (this.agents.some((a) => a.ownerId === ownerId && a.slug === slug)) {
      throw new Error(`agent slug "${slug}" already exists for this owner`);
    }
    if (data.maxConcurrentTasks !== undefined) {
      const n = Number(data.maxConcurrentTasks);
      if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) throw new Error('maxConcurrentTasks must be a non-negative integer');
    }
    const maxConcurrent = data.maxConcurrentTasks != null ? Number(data.maxConcurrentTasks) : 1;
    const agent: AgentRecord = {
      id: uuid(),
      ownerId,
      name: data.name,
      slug,
      role: data.role,
      description: data.description ?? null,
      capabilities: data.capabilities ?? [],
      status: data.status ?? 'active',
      maxConcurrentTasks: maxConcurrent,
      createdAt: now(),
      updatedAt: now(),
    };
    this.agents.push(agent);
    return agent;
  }

  async getAgent(ownerId: string, agentId: string): Promise<AgentRecord | null> {
    return this.agents.find((a) => a.ownerId === ownerId && a.id === agentId) ?? null;
  }

  async listAgents(ownerId: string): Promise<AgentRecord[]> {
    return this.agents.filter((a) => a.ownerId === ownerId).map((a) => ({ ...a }));
  }

  async patchAgent(ownerId: string, agentId: string, patch: AgentPatch): Promise<AgentRecord> {
    const idx = this.agents.findIndex((a) => a.ownerId === ownerId && a.id === agentId);
    if (idx < 0) throw new Error('agent not found');
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length === 0) throw new Error('empty patch');
    const current = this.agents[idx]!;
    // Validate maxConcurrentTasks if present
    if (patch.maxConcurrentTasks !== undefined) {
      const num = Number(patch.maxConcurrentTasks);
      if (!Number.isFinite(num) || num < 0 || Math.floor(num) !== num) throw new Error('maxConcurrentTasks must be a non-negative integer');
    }
    const next: AgentRecord = {
      ...current,
      ...Object.fromEntries(entries),
      updatedAt: now(),
    };
    this.agents[idx] = next;
    return { ...next };
  }

  async agentHasPermission(agentId: string, projectId: string | null, resourceType: string, permission: string): Promise<boolean> {
    const a = this.agents.find((x) => x.id === agentId);
    if (!a || a.status !== 'active') return false;
    return this.agentPermissions.some(
      (p) => p.agentId === agentId && p.resourceType === resourceType && p.permission === permission && (p.projectId === projectId || (p.projectId === null && projectId !== null)),
    );
  }

  async agentStats(agentId: string): Promise<AgentStats> {
    void agentId;
    return { successRate: 0, historyCount: 0 };
  }

  // Gate 31: Batch workload query for all agents of an owner.
  async listAgentWorkload(ownerId: string): Promise<AgentWorkload[]> {
    const terminalStatuses = ['completed', 'failed', 'cancelled'];
    const agentIds = new Set(this.agents.filter((a) => a.ownerId === ownerId).map((a) => a.id));
    const result: AgentWorkload[] = [];
    for (const agentId of agentIds) {
      const tasks = this.tasks.filter((t) => t.agentId === agentId && t.ownerId === ownerId);
      const assignedCount = tasks.filter((t) => !terminalStatuses.includes(t.status)).length;
      const runningCount = tasks.filter((t) => t.status === 'running').length;
      result.push({ agentId, assignedCount, runningCount });
    }
    return result;
  }

  // monitoring
  async dailyStatus(ownerId: string): Promise<DailyStatus> {
    const projects = await this.listProjects(ownerId);
    const tasks = await this.listTasks(ownerId);
    const approvals = await this.listApprovals(ownerId);
    return {
      generatedAt: now(),
      projects: projects.map((p) => ({ projectId: p.id, projectName: p.name, activeTasks: 0, blockedTasks: 0, failures: 0, pendingApprovals: 0, cost: 0, health: 'healthy' })),
      activeTasks: tasks.filter((t) => ['queued', 'running', 'needs_approval', 'created'].includes(t.status)).length,
      blockedTasks: tasks.filter((t) => t.status === 'paused').length,
      failures: tasks.filter((t) => t.status === 'failed').length,
      pendingApprovals: approvals.filter((a) => a.status === 'pending').length,
      cost: await this.totalCost(ownerId),
      alerts: [],
      decisionsRequired: approvals.filter((a) => a.status === 'pending').map((a) => `Approval ${a.action} requires decision.`),
    };
  }

  // memory
  async recall(ownerId: string, query: string): Promise<RecallItem[]> {
    void ownerId; void query;
    return [];
  }
  async saveLesson(ownerId: string, lesson: LessonInput): Promise<void> {
    void ownerId; void lesson;
  }

  // ————— Gate 2 — Security Guardian —————
  async listCriticalActions(ownerId: string): Promise<CriticalActionRule[]> {
    void ownerId;
    return CRITICAL_ACTIONS.map((r) => ({ ...r }));
  }

  async recordSecurityEvent(ownerId: string, event: Parameters<Store['recordSecurityEvent']>[1]): Promise<SecurityEventRecord> {
    const record = toSecurityEventRecord({ ...event, ownerId });
    this.securityEvents.push(record);
    return record;
  }
  async listSecurityEvents(ownerId: string, filter?: { eventType?: string; severity?: string; limit?: number }): Promise<SecurityEventRecord[]> {
    return this.securityEvents
      .filter((e) => e.ownerId === ownerId && (!filter?.eventType || e.eventType === filter.eventType) && (!filter?.severity || e.severity === filter.severity))
      .slice(0, filter?.limit ?? 100);
  }

  async createIncident(ownerId: string, input: Parameters<Store['createIncident']>[1]): Promise<SecurityIncidentRecord> {
    const record = toIncidentRecord(ownerId, input);
    this.securityIncidents.push(record);
    return record;
  }
  async patchIncident(ownerId: string, incidentId: string, patch: Parameters<Store['patchIncident']>[2]): Promise<SecurityIncidentRecord | null> {
    const idx = this.securityIncidents.findIndex((i) => i.ownerId === ownerId && i.incidentId === incidentId);
    const current = this.securityIncidents[idx];
    if (!current) return null;
    const { record, error } = applyIncidentPatch(current, patch);
    if (error) throw new Error(error);
    this.securityIncidents[idx] = record;
    return record;
  }
  async listIncidents(ownerId: string, filter?: { status?: string; limit?: number }): Promise<SecurityIncidentRecord[]> {
    return this.securityIncidents
      .filter((i) => i.ownerId === ownerId && (!filter?.status || i.status === filter.status))
      .slice(0, filter?.limit ?? 100);
  }

  async activeLockdown(ownerId: string): Promise<SecurityLockdownRecord | null> {
    return this.securityLockdowns.find((l) => l.ownerId === ownerId && l.status === 'active') ?? null;
  }
  async activateLockdown(ownerId: string, data: { scope?: string; reason: string; activatedBy: string; actorType: 'owner' | 'agent' | 'system' }): Promise<SecurityLockdownRecord> {
    const record = toLockdownRecord({ ownerId, scope: data.scope, reason: data.reason, activatedBy: data.activatedBy, actorType: data.actorType });
    this.securityLockdowns.push(record);
    return record;
  }
  async releaseLockdown(ownerId: string, lockdownId: string, data: { releasedBy: string; actorType: 'owner' | 'agent'; reason: string }): Promise<SecurityLockdownRecord | null> {
    const idx = this.securityLockdowns.findIndex((l) => l.ownerId === ownerId && l.lockdownId === lockdownId);
    const current = this.securityLockdowns[idx];
    if (!current) return null;
    if (current.status !== 'active') throw new Error('lockdown is not active');
    const check = canReleaseLockdown({ ownerId, releasedBy: data.releasedBy, actorType: data.actorType, reason: data.reason });
    if (!check.allowed) throw new Error(check.error ?? 'release denied');
    const record: SecurityLockdownRecord = { ...current, status: 'released', releasedBy: data.releasedBy, releasedAt: now() };
    this.securityLockdowns[idx] = record;
    return record;
  }

  // ————— Gate 41 — Global Workforce Emergency Stop —————
  // READ on the general Store surface (worker/security fail-close against it).
  async getWorkforceControl(): Promise<WorkforceControlRecord | null> {
    return this.workforceControl ? { ...this.workforceControl } : null;
  }

  // Privileged raw WRITE primitive — implements WorkforceControlAdminPersistence, NOT part
  // of the general Store. Reachable only via setGlobalEmergencyStop after authority checks.
  async setWorkforceControlRaw(input: { globallyEnabled: boolean; reason: string; updatedBy: string }): Promise<WorkforceControlRecord> {
    this.workforceControl = {
      singletonKey: 'global',
      globallyEnabled: input.globallyEnabled,
      reason: input.reason,
      updatedBy: input.updatedBy,
      updatedAt: now(),
    };
    return { ...this.workforceControl };
  }

  async rlsProbe(ownerId: string): Promise<RlsProbe> {
    void ownerId;
    return {
      ok: true,
      publicTables: 9,
      rlsEnabledTables: 9,
      auditAppendOnly: true,
      securityEventsAppendOnly: true,
    };
  }

  // ————— Gate 3 — Conversation persistence —————

  async createConversation(ownerId: string, data: { projectId?: string | null; title?: string | null }): Promise<ConversationRecord> {
    const conv: ConversationRecord = {
      id: uuid(),
      ownerId,
      projectId: data.projectId ?? null,
      title: data.title ?? null,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
    };
    this.conversations.push(conv);
    return conv;
  }

  async getConversation(ownerId: string, conversationId: string): Promise<ConversationRecord | null> {
    return this.conversations.find((c) => c.ownerId === ownerId && c.id === conversationId) ?? null;
  }

  async listConversations(ownerId: string, filter?: { status?: 'active' | 'archived'; limit?: number; offset?: number }): Promise<ConversationRecord[]> {
    const statusFilter = filter?.status ?? 'active';
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;
    return this.conversations
      .filter((c) => c.ownerId === ownerId && c.status === statusFilter)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(offset, offset + limit);
  }

  async archiveConversation(ownerId: string, conversationId: string): Promise<boolean> {
    const conv = this.conversations.find((c) => c.ownerId === ownerId && c.id === conversationId);
    if (!conv) return false;
    conv.status = 'archived';
    conv.updatedAt = now();
    return true;
  }

  async appendMessage(ownerId: string, input: { conversationId: string; role: 'user' | 'assistant' | 'tool' | 'system'; content: string; toolCalls?: unknown; toolCallId?: string | null; name?: string | null; tokenCount?: number | null }): Promise<ConversationMessage> {
    const msg: ConversationMessage = {
      id: uuid(),
      conversationId: input.conversationId,
      ownerId,
      role: input.role,
      content: input.content,
      toolCalls: input.toolCalls ?? null,
      toolCallId: input.toolCallId ?? null,
      name: input.name ?? null,
      tokenCount: input.tokenCount ?? null,
      createdAt: now(),
    };
    this.conversationMessages.push(msg);
    return msg;
  }

  async loadHistory(ownerId: string, conversationId: string, limit: number = 20): Promise<ConversationMessage[]> {
    const all = this.conversationMessages
      .filter((m) => m.conversationId === conversationId && m.ownerId === ownerId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return all.slice(-limit);
  }

  // ————— Gate 19 — Audit query (matches SupabaseStore: filter by project ownership) —————
  async queryAudit(ownerId: string, filter?: { limit?: number }): Promise<Record<string, unknown>[]> {
    const limit = filter?.limit ?? 50;
    const ownerProjectIds = new Set(
      this.projects.filter((p) => p.ownerId === ownerId).map((p) => p.id),
    );
    return this.audit
      .filter((e) => e.projectId != null && ownerProjectIds.has(e.projectId))
      .slice(-limit)
      .reverse()
      .map((e) => ({ ...e }));
  }

  // ————— Gate 21 — Stale RUNNING task recovery —————
  async recoverStaleRunningTasks(staleBefore: Date): Promise<number> {
    let count = 0;
    for (const task of this.tasks) {
      if (task.status === 'running' && task.startedAt && new Date(task.startedAt) < staleBefore) {
        task.status = 'failed';
        task.error = { message: 'Process restarted while task was running. Stale RUNNING task recovered to FAILED.' };
        task.completedAt = new Date().toISOString();
        task.updatedAt = new Date().toISOString();
        count++;
      }
    }
    return count;
  }
}
