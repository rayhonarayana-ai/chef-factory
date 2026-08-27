// CHEF FACTORY — Gate 1 — Persistence ports (typed contracts).
// Core logic depends only on these interfaces; repo.ts (Supabase/Postgres)
// and in-memory fakes (tests) implement them.

import type {
  AgentRecord,
  AgentDefinition,
  AgentPatch,
  ApprovalRecord,
  AuditEvent,
  AutonomyDecision,
  AutonomyLevel,
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

import type {
  ConversationRecord,
  ConversationMessage,
} from '../core/conversation.js';

import type {
  CriticalActionRule,
  RlsProbe,
  SecurityEventRecord,
  SecurityIncidentRecord,
  SecurityLockdownRecord,
  SecurityEventInput,
  SecurityIncidentInput,
  SecurityIncidentPatch,
} from '../core/security/types.js';

export interface TaskPatch {
  title?: string;
  description?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  status?: TaskRecord['status'];
  output?: JsonObject | null;
  error?: JsonObject | null;
  attempts?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  agentId?: string | null;
  environmentId?: string | null;
  requiredCapabilities?: string[];
  preferredRole?: string | null;
}

export interface ApprovalPatch {
  status?: ApprovalRecord['status'];
  decision?: string | null;
  decisionReason?: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
}

export interface BudgetReport {
  period: 'day' | 'month';
  amount: number;
  daily: number; // G5-03: daily cost for the project
  maxAmount: number | null;
  exceeded: boolean;
}

export interface AgentStats {
  successRate: number;
  historyCount: number;
}

/** Gate 31: Batch workload record for an agent. */
export interface AgentWorkload {
  agentId: string;
  assignedCount: number;
  runningCount: number;
}

export type AssignTaskOutcome =
  | 'assigned'
  | 'unassigned'
  | 'no_change'
  | 'task_not_found'
  | 'agent_not_found'
  | 'agent_not_eligible';

export interface AssignTaskResult {
  ok: boolean;
  outcome: AssignTaskOutcome;
  previousAgentId: string | null;
  nextAgentId: string | null;
}

export type AssignTaskIfUnassignedOutcome =
  | 'assigned'
  | 'already_assigned'
  | 'task_not_found'
  | 'agent_not_found'
  | 'agent_not_eligible'
  | 'agent_at_capacity';

export interface AssignTaskIfUnassignedResult {
  ok: boolean;
  outcome: AssignTaskIfUnassignedOutcome;
  previousAgentId: string | null;
  nextAgentId: string | null;
}

// Gate 34: Distributed-safe execution claim.
export type ClaimTaskOutcome =
  | 'claimed'
  | 'task_not_found'
  | 'not_assigned'
  | 'wrong_agent'
  | 'not_queued'
  | 'already_running';

export interface ClaimTaskResult {
  ok: boolean;
  outcome: ClaimTaskOutcome;
  task: TaskRecord | null;
}

export interface Store {
  // agents / permissions (Gate 25: full agent CRUD)
  createAgent(ownerId: string, data: AgentDefinition): Promise<AgentRecord>;
  getAgent(ownerId: string, agentId: string): Promise<AgentRecord | null>;
  listAgents(ownerId: string): Promise<AgentRecord[]>;
  patchAgent(ownerId: string, agentId: string, patch: AgentPatch): Promise<AgentRecord>;
  agentHasPermission(agentId: string, projectId: string | null, resourceType: string, permission: string): Promise<boolean>;
  agentStats(agentId: string): Promise<AgentStats>;
  // Gate 31: batch workload query for all agents of an owner
  listAgentWorkload(ownerId: string): Promise<AgentWorkload[]>;
  // projects / passports
  getProjectBySlug(ownerId: string, slug: string): Promise<ProjectRecord | null>;
  getProject(ownerId: string, projectId: string): Promise<ProjectRecord | null>;
  listProjects(ownerId: string): Promise<ProjectRecord[]>;
  createProject(ownerId: string, data: { name: string; slug: string; description?: string }): Promise<ProjectRecord>;
  getPassport(ownerId: string, projectId: string): Promise<PassportRecord | null>;
  upsertPassport(ownerId: string, projectId: string, patch: Partial<PassportRecord>): Promise<PassportRecord>;

  // tasks
  createTask(ownerId: string, data: {
    projectId: string;
    title: string;
    description?: string;
    agentId?: string | null;
    priority?: TaskRecord['priority'];
    riskLevel?: TaskRecord['riskLevel'];
    authorityLevel?: TaskRecord['authorityLevel'];
    autonomy?: TaskRecord['autonomy'];
    approvalRequired?: boolean;
    requiredCapabilities?: string[];
    preferredRole?: string | null;
    status?: TaskRecord['status'];
    inputs?: JsonObject;
    maxAttempts?: number;
    correlationId?: string | null;
    createdBy?: string | null;
  }): Promise<TaskRecord>;
  getTask(ownerId: string, taskId: string): Promise<TaskRecord | null>;
  listTasks(ownerId: string, filter?: { projectId?: string; status?: TaskRecord['status'] }): Promise<TaskRecord[]>;
  // Gate 37: deterministic discovery of unassigned schedulable tasks.
  // DISCOVERY ONLY — never assigns, claims, mutates, or grants authority.
  listSchedulableTasks(ownerId: string, filter?: { projectId?: string; limit?: number }): Promise<TaskRecord[]>;
  patchTask(ownerId: string, taskId: string, patch: TaskPatch): Promise<TaskRecord>;
  assignTask(ownerId: string, taskId: string, agentId: string | null): Promise<AssignTaskResult>;
  assignTaskIfUnassigned(ownerId: string, taskId: string, agentId: string): Promise<AssignTaskIfUnassignedResult>;
  createTaskRun(ownerId: string, data: {
    taskId: string;
    runNumber: number;
    modelId?: string | null;
    runtimeId?: string | null;
    inputSnapshot?: JsonObject | null;
  }): Promise<TaskRunRecord>;
  completeTaskRun(ownerId: string, runId: string, patch: {
    status: TaskRunRecord['status'];
    outputSnapshot?: JsonObject | null;
    error?: JsonObject | null;
    durationMs?: number | null;
    cost?: number;
    completedAt?: string | null;
  }): Promise<TaskRunRecord>;

  // approvals
  createApproval(ownerId: string, data: {
    projectId?: string | null;
    taskId?: string | null;
    agentId?: string | null;
    action: string;
    description?: string;
    riskLevel?: TaskRecord['riskLevel'];
    authorityLevel?: AutonomyLevel | null;
    requestedBy?: string | null;
    expiresAt?: string | null;
  }): Promise<ApprovalRecord>;
  getApproval(ownerId: string, approvalId: string): Promise<ApprovalRecord | null>;
  listApprovals(ownerId: string, filter?: { projectId?: string; taskId?: string; status?: ApprovalRecord['status'] }): Promise<ApprovalRecord[]>;
  patchApproval(ownerId: string, approvalId: string, patch: ApprovalPatch): Promise<ApprovalRecord>;

  // audit (append-only)
  recordAudit(event: AuditEvent): Promise<void>;

  // costs
  recordCost(event: CostEvent): Promise<void>;
  projectBudget(ownerId: string, projectId: string): Promise<BudgetReport>;
  totalCost(ownerId: string, projectId?: string | null): Promise<number>;

  // preferences (POS)
  getPreferences(ownerId: string): Promise<JsonObject>;
  setPreference(ownerId: string, category: string, key: string, value: unknown): Promise<void>;

  // decisions
  recordDecision(ownerId: string, decision: {
    projectId?: string | null;
    context: string;
    options: string[];
    selectedOption?: string | null;
    reason?: string | null;
    evidence?: string[];
    confidence?: number | null;
    riskLevel?: TaskRecord['riskLevel'];
    authorityLevel?: AutonomyLevel | null;
    approvedBy?: string | null;
    outcome?: string | null;
  }): Promise<DecisionRecord>;
  listDecisions(ownerId: string): Promise<DecisionRecord[]>;

  // autonomy records
  recordAutonomy(ownerId: string, record: {
    agentId: string;
    projectId?: string | null;
    environmentId?: string | null;
    action: string;
    riskLevel?: TaskRecord['riskLevel'];
    selected: AutonomyDecision;
    approvalStatus?: string;
    outcome?: string;
  }): Promise<void>;

  // models / runtimes
  listModels(ownerId: string): Promise<ModelInfo[]>;
  listRuntimes(ownerId: string): Promise<RuntimeInfo[]>;

  // monitoring
  dailyStatus(ownerId: string): Promise<DailyStatus>;

  // memory
  recall(ownerId: string, query: string): Promise<RecallItem[]>;
  saveLesson(ownerId: string, lesson: LessonInput): Promise<void>;

  // ————— Gate 2 — Security Guardian persistence —————
  // critical action registry (core rows immutable in DB)
  listCriticalActions(ownerId: string): Promise<CriticalActionRule[]>;

  // security events (append-only)
  recordSecurityEvent(ownerId: string, event: SecurityEventInput): Promise<SecurityEventRecord>;
  listSecurityEvents(ownerId: string, filter?: { eventType?: string; severity?: string; limit?: number }): Promise<SecurityEventRecord[]>;

  // incidents (foundational workflow)
  createIncident(ownerId: string, input: SecurityIncidentInput): Promise<SecurityIncidentRecord>;
  patchIncident(ownerId: string, incidentId: string, patch: SecurityIncidentPatch): Promise<SecurityIncidentRecord | null>;
  listIncidents(ownerId: string, filter?: { status?: string; limit?: number }): Promise<SecurityIncidentRecord[]>;

  // emergency lockdown
  activeLockdown(ownerId: string): Promise<SecurityLockdownRecord | null>;
  activateLockdown(ownerId: string, data: { scope?: string; reason: string; activatedBy: string; actorType: 'owner' | 'agent' | 'system' }): Promise<SecurityLockdownRecord>;
  releaseLockdown(ownerId: string, lockdownId: string, data: { releasedBy: string; actorType: 'owner' | 'agent'; reason: string }): Promise<SecurityLockdownRecord | null>;

  // database / RLS health
  rlsProbe(ownerId: string): Promise<RlsProbe>;

  // ————— Gate 3 — Conversation persistence —————
  createConversation(ownerId: string, data: { projectId?: string | null; title?: string | null }): Promise<ConversationRecord>;
  getConversation(ownerId: string, conversationId: string): Promise<ConversationRecord | null>;
  listConversations(ownerId: string, filter?: { status?: 'active' | 'archived'; limit?: number; offset?: number }): Promise<ConversationRecord[]>;
  archiveConversation(ownerId: string, conversationId: string): Promise<boolean>;
  appendMessage(ownerId: string, input: { conversationId: string; role: 'user' | 'assistant' | 'tool' | 'system'; content: string; toolCalls?: unknown; toolCallId?: string | null; name?: string | null; tokenCount?: number | null }): Promise<ConversationMessage>;
  loadHistory(ownerId: string, conversationId: string, limit?: number): Promise<ConversationMessage[]>;

  // ————— Gate 19 — Audit query (replaces direct getPool bypass) —————
  queryAudit(ownerId: string, filter?: { limit?: number }): Promise<Record<string, unknown>[]>;

  // ————— Gate 21 — Stale RUNNING task recovery —————
  recoverStaleRunningTasks(staleBefore: Date): Promise<number>;

  // ————— Gate 34 — Distributed-safe execution claim —————
  // Atomically transitions queued → running ONLY if:
  //   - task exists under this owner
  //   - task.agentId === agentId (assigned)
  //   - task.status === 'queued' (eligible)
  // Uses FOR UPDATE + conditional WHERE to prevent concurrent claims.
  claimTaskForExecution(ownerId: string, taskId: string, agentId: string): Promise<ClaimTaskResult>;
}
