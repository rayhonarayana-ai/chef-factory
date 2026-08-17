// Test fixture — in-memory Store implementation (deterministic, no I/O).
// Used by pipeline / isolation / audit unit tests. NOT shipped in build.

import type { Store, TaskPatch, ApprovalPatch, AgentStats, BudgetReport } from '../core/ports.js';
import type {
  ApprovalRecord, AuditEvent, AutonomyDecision, CostEvent, DailyStatus, DecisionRecord,
  JsonObject, LessonInput, ModelInfo, PassportRecord, ProjectRecord, RecallItem,
  RuntimeInfo, TaskRecord, TaskRunRecord,
} from '../core/types.js';
import { emptyPassport } from '../core/passport.js';
import type { CriticalActionRule, RlsProbe, SecurityEventRecord, SecurityIncidentRecord, SecurityLockdownRecord } from '../core/security/types.js';
import { CRITICAL_ACTIONS } from '../core/security/criticalActions.js';
import { toSecurityEventRecord } from '../core/security/events.js';
import { toIncidentRecord, applyIncidentPatch } from '../core/security/incidents.js';
import { toLockdownRecord, canReleaseLockdown } from '../core/security/lockdown.js';

const uuid = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

export class MemoryStore implements Store {
  projects: ProjectRecord[] = [];
  passports: PassportRecord[] = [];
  tasks: TaskRecord[] = [];
  taskRuns: TaskRunRecord[] = [];
  approvals: ApprovalRecord[] = [];
  audit: AuditEvent[] = [];
  costs: CostEvent[] = [];
  prefs: { category: string; key: string; value: unknown; version: number; isActive: boolean }[] = [];
  decisions: DecisionRecord[] = [];
  autonomy: AutonomyDecision[] = [];
  agents: Array<{ id: string; name: string; slug: string; role: string; status: string; permissions: Array<{ projectId: string | null; resourceType: string; permission: string }> }> = [];
  models: ModelInfo[] = [];
  runtimes: RuntimeInfo[] = [];
  securityEvents: SecurityEventRecord[] = [];
  securityIncidents: SecurityIncidentRecord[] = [];
  securityLockdowns: SecurityLockdownRecord[] = [];

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
    const t: TaskRecord = {
      id: uuid(), ownerId, projectId: data.projectId, environmentId: null, parentTaskId: null,
      agentId: data.agentId ?? null, title: data.title, description: data.description ?? null,
      status: data.status ?? 'created', priority: data.priority ?? 'medium', riskLevel: data.riskLevel ?? 'low',
      authorityLevel: data.authorityLevel ?? null, autonomy: data.autonomy ?? null,
      approvalRequired: data.approvalRequired ?? false, inputs: data.inputs ?? {}, output: null, error: null,
      attempts: 0, maxAttempts: data.maxAttempts ?? 3, correlationId: data.correlationId ?? null,
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
  async patchTask(ownerId: string, taskId: string, patch: TaskPatch): Promise<TaskRecord> {
    const t = await this.getTask(ownerId, taskId);
    if (!t) throw new Error('task not found');
    const next = { ...t, ...patch, updatedAt: now() };
    this.tasks[this.tasks.indexOf(t)] = next;
    return next;
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
    const a: ApprovalRecord = { id: uuid(), ownerId, projectId: data.projectId ?? null, taskId: data.taskId ?? null, agentId: data.agentId ?? null, action: data.action, description: data.description ?? null, riskLevel: data.riskLevel ?? null, authorityLevel: data.authorityLevel ?? null, status: 'pending', decision: null, decisionReason: null, requestedBy: data.requestedBy ?? null, decidedBy: null, expiresAt: data.expiresAt ?? null, decidedAt: null, createdAt: now() };
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

  // agents / permissions
  async listAgents(ownerId: string): Promise<Array<{ id: string; name: string; slug: string; role: string; status: string }>> {
    void ownerId;
    return this.agents.map(({ permissions: _permissions, ...rest }) => rest);
  }
  async agentHasPermission(agentId: string, projectId: string | null, resourceType: string, permission: string): Promise<boolean> {
    const a = this.agents.find((x) => x.id === agentId);
    if (!a || a.status !== 'active') return false;
    return a.permissions.some((p) => p.resourceType === resourceType && p.permission === permission && (p.projectId === projectId || (p.projectId === null && projectId !== null)));
  }
  async agentStats(agentId: string): Promise<AgentStats> {
    void agentId;
    return { successRate: 0, historyCount: 0 };
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
}
