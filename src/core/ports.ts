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
  ModelHealthObservation,
  ModelHealthSnapshot,
  ModelInfo,
  MissionActivateResult,
  MissionInput,
  MissionMaterializeResult,
  MissionPlanCanonical,
  MissionRecord,
  MissionStatus,
  PassportRecord,
  ProjectRecord,
  RecallItem,
  RuntimeInfo,
  TaskDependencyRecord,
  TaskRecord,
  TaskRunRecord,
  TaskVerificationRecord,
  PreparedDeliveryRecord,
  PreparedDeliveryStatus,
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

import type { WorkforceControlRecord } from './security/workforceControl.js';

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
  verificationRequired?: boolean;
  requiredVerifications?: import('./types.js').TaskRecord['requiredVerifications'];
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
  | 'agent_at_capacity'
  | 'not_ready';

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
  | 'already_running'
  | 'not_ready';

export interface ClaimTaskResult {
  ok: boolean;
  outcome: ClaimTaskOutcome;
  task: TaskRecord | null;
}

// ————— Gate 38 — Task dependency / DAG edge results —————
export type AddTaskDependencyOutcome =
  | 'added'
  | 'already_exists'
  | 'self_dependency'
  | 'prerequisite_not_found'
  | 'dependent_not_found'
  | 'dependent_not_editable'
  | 'cycle_detected'
  | 'cross_scope'
  | 'unsupported_status';

export interface AddTaskDependencyResult {
  ok: boolean;
  outcome: AddTaskDependencyOutcome;
  edge: TaskDependencyRecord | null;
}

export type RemoveTaskDependencyOutcome = 'removed' | 'not_found' | 'edge_not_found';

export interface RemoveTaskDependencyResult {
  ok: boolean;
  outcome: RemoveTaskDependencyOutcome;
}

export interface ListTaskDependenciesResult {
  edges: TaskDependencyRecord[];
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
    missionId?: string | null;
    missionTaskKey?: string | null;
    createdBy?: string | null;
    verificationRequired?: boolean;
    requiredVerifications?: TaskRecord['requiredVerifications'];
  }): Promise<TaskRecord>;
  getTask(ownerId: string, taskId: string): Promise<TaskRecord | null>;
  listTasks(ownerId: string, filter?: { projectId?: string; status?: TaskRecord['status'] }): Promise<TaskRecord[]>;
  // Gate 37: deterministic discovery of unassigned schedulable tasks.
  // DISCOVERY ONLY — never assigns, claims, mutates, or grants authority.
  listSchedulableTasks(ownerId: string, filter?: { projectId?: string; limit?: number }): Promise<TaskRecord[]>;

  // ————— Gate 41 — Narrow scheduler owner discovery —————
  // Returns ONLY the minimal owner identifiers that currently have at least one
  // schedulable (queued, unassigned, within retry cap, dependencies satisfied) task.
  // Used by the continuous Workforce to enumerate which owners to run for each
  // cycle. Read-only, bounded, deterministic ordering (owner_id ASC). It NEVER
  // loads owner profiles or any cross-owner business data.
  listOwnersWithSchedulableWork(opts?: { limit?: number }): Promise<string[]>;

  // ————— Gate 38 — Task dependency / DAG edges —————
  // Canonical direction: prerequisite_task_id -> dependent_task_id.
  // A dependent task is READY only when ALL prerequisites are 'completed'.
  // Mutation is OWNER_ONLY (RLS owner-scoped); the DB-enforced composite FK
  // makes cross-owner / cross-project edges structurally impossible; a
  // project-scoped advisory lock + recursive-CTE trigger make cycles
  // impossible even under concurrent distributed writers.
  addTaskDependency(ownerId: string, input: {
    prerequisiteTaskId: string;
    dependentTaskId: string;
    createdBy?: string | null;
  }): Promise<AddTaskDependencyResult>;
  removeTaskDependency(ownerId: string, input: {
    prerequisiteTaskId: string;
    dependentTaskId: string;
  }): Promise<RemoveTaskDependencyResult>;
  listTaskDependencies(ownerId: string, filter?: {
    projectId?: string;
    prerequisiteTaskId?: string;
    dependentTaskId?: string;
  }): Promise<ListTaskDependenciesResult>;

  // ————— Gate 39 — Mission Engine (durable objective + validated plan) —————
  // Missions are OWNER_ONLY constructs; the engine REQUESTs approval and never
  // approves. Plan is bound to a canonical SHA-256 hash at approval time and is
  // immutable after approval. Materialization and activation are each ONE
  // transaction that is ALL-OR-NOTHING (never a partial task graph / partial
  // activation). mission_task_key is the stable client-side task identity and is
  // UNIQUE per (owner, project, mission).
  createMission(ownerId: string, input: MissionInput): Promise<MissionRecord>;
  getMission(ownerId: string, missionId: string): Promise<MissionRecord | null>;
  listMissions(ownerId: string, filter?: { projectId?: string; status?: MissionStatus }): Promise<MissionRecord[]>;
  saveMissionPlan(ownerId: string, missionId: string, plan: MissionPlanCanonical, planHash: string): Promise<MissionRecord | null>;
  setMissionPendingApproval(ownerId: string, missionId: string): Promise<MissionRecord | null>;
  markMissionApproved(ownerId: string, missionId: string): Promise<MissionRecord | null>;
  // Atomic materialization (one tx): approved+unbound-hash-verified -> insert ALL
  // tasks (created, agent_id NULL, mission_task_key set) + ALL dependency edges ->
  // mission materialized. Partial task graph is impossible (ROLLBACK on any error).
  materializeMissionPlanAtomic(ownerId: string, missionId: string, plan: MissionPlanCanonical): Promise<MissionMaterializeResult>;
  // Atomic activation (one tx): materialized -> queue ALL mission tasks (created→queued)
  // -> mission active. ALL or NONE; never MISSION_ACTIVE with some tasks still 'created'.
  activateMissionAtomic(ownerId: string, missionId: string): Promise<MissionActivateResult>;
  listMissionTasks(ownerId: string, missionId: string): Promise<TaskRecord[]>;
  // Apply a lifecycle transition (e.g. active->completed|failed|cancelled) with the
  // associated timestamp. Returns null if the transition is illegal (deterministic).
  updateMissionStatus(ownerId: string, missionId: string, to: MissionStatus): Promise<MissionRecord | null>;

  patchTask(ownerId: string, taskId: string, patch: TaskPatch): Promise<TaskRecord>;
  /** Atomically complete only a task still running; protects final completion from cancellation races. */
  completeTaskIfRunning(ownerId: string, taskId: string, patch: TaskPatch): Promise<TaskRecord | null>;
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

  // ————— Gate 45 — Trusted verification evidence —————
  // SYSTEM-OBSERVED writes performed only by the trusted acceptance gate.
  // Never invoked by agents/models; not a general evidence/observability platform.
  // Bounded retention expectation: minimal outcomes only (no stdout/stderr, no secrets).
  recordTaskVerification(ownerId: string, input: {
    projectId: string;
    taskId: string;
    runId?: string | null;
    attempt: number;
    operation: TaskVerificationRecord['operation'];
    outcome: TaskVerificationRecord['outcome'];
    exitCode?: number | null;
    durationMs?: number | null;
    /** Gate 46 — trusted verification session id binding this evidence row. */
    verificationSessionId?: string | null;
    /** Gate 46 — trusted workspace fingerprint binding this evidence row (AUDIT-ONLY). */
    workspaceFingerprint?: string | null;
  }): Promise<TaskVerificationRecord>;
  listTaskVerifications(ownerId: string, taskId: string): Promise<TaskVerificationRecord[]>;

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
    metadata?: JsonObject;
  }): Promise<ApprovalRecord>;
  getApproval(ownerId: string, approvalId: string): Promise<ApprovalRecord | null>;
  listApprovals(ownerId: string, filter?: { projectId?: string; taskId?: string; status?: ApprovalRecord['status'] }): Promise<ApprovalRecord[]>;
  patchApproval(ownerId: string, approvalId: string, patch: ApprovalPatch): Promise<ApprovalRecord>;
  decideApprovalWithPreparedDelivery(ownerId: string, approvalId: string, patch: Required<ApprovalPatch>, approvalStatus: Extract<ApprovalRecord['status'], 'approved' | 'rejected' | 'denied'>): Promise<ApprovalRecord | null>;

  // Gate 47: immutable delivery payloads are prepared once and consumed via CAS.
  createPreparedDelivery(ownerId: string, input: Omit<PreparedDeliveryRecord, 'id' | 'ownerId' | 'approvalId' | 'status' | 'version' | 'commitSha' | 'failureReason' | 'createdAt' | 'updatedAt'>): Promise<PreparedDeliveryRecord>;
  getPreparedDelivery(ownerId: string, deliveryId: string): Promise<PreparedDeliveryRecord | null>;
  getPreparedDeliveryByApproval(ownerId: string, approvalId: string): Promise<PreparedDeliveryRecord | null>;
  linkPreparedDeliveryApproval(ownerId: string, deliveryId: string, approvalId: string): Promise<PreparedDeliveryRecord | null>;
  transitionPreparedDelivery(ownerId: string, deliveryId: string, from: PreparedDeliveryStatus, to: PreparedDeliveryStatus, patch?: { commitSha?: string | null; failureReason?: string | null }): Promise<PreparedDeliveryRecord | null>;

  // audit (append-only)
  recordAudit(event: AuditEvent): Promise<void>;

  // costs
  recordCost(event: CostEvent): Promise<void>;
  projectBudget(ownerId: string, projectId: string): Promise<BudgetReport>;
  totalCost(ownerId: string, projectId?: string | null): Promise<number>;
  // Gate 41: total spend attributed to a mission (sum of cost_events for tasks whose
  // mission_id = missionId). Deterministic; used to enforce mission budget limits in
  // the continuous workforce path without weakening owner/project CostProtector.
  missionCost(ownerId: string, missionId: string): Promise<number>;

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

  // ————— Gate 43 — Durable model/provider health telemetry (READ on the general Store) —————
  // The general runtime Store surface exposes the READ side of durable health ONLY
  // so the router chain can consume a shared, restart-safe health snapshot. WRITE
  // is deliberately NOT on this interface: it is a trusted system-observed capability
  // (ModelHealthPersistence) reachable only from the trusted model-execution collector,
  // never by agents/models/the router (AGENT_CAN_WRITE_HEALTH_TELEMETRY = NO,
  // MODEL_CAN_WRITE_HEALTH_TELEMETRY = NO, ROUTER_CAN_WRITE_HEALTH_TELEMETRY = NO).
  getModelHealthSnapshots(
    ownerId: string,
    filter?: { provider?: string; modelId?: string },
  ): Promise<ModelHealthSnapshot[]>;

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

  // ————— Gate 41 — Global Workforce Emergency Stop (READ ONLY on the general Store) —————
  // The general runtime Store surface exposes READ access ONLY so Worker/Security code
  // can fail closed against the durable global control state. WRITE access is deliberately
  // NOT on this interface: it is a privileged capability (WorkforceControlAdminPersistence)
  // reachable only through the explicit authorized administrative core function
  // (setGlobalEmergencyStop), which first validates a system-admin actor. Agents, the
  // workforce service, the Mission Engine, and specialist roles therefore cannot disable
  // the global emergency stop through any ordinary runtime dependency.
  getWorkforceControl(): Promise<WorkforceControlRecord | null>;

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

// ————— Gate 43 — Trusted Model/Provider Health telemetry WRITE persistence —————
// This is a SEPARATE narrow capability interface, deliberately NOT part of the general
// `Store`. It is implemented by the persistent repository and the in-memory test fake,
// but it is wired/typed ONLY into the trusted model-execution collector (the execution
// runner). Normal Worker/Agent/Model/Router/Tool code receives `Store` (health READ only)
// and therefore cannot reach the raw write. There is NO generic public telemetry mutation
// tool and nothing is exposed through ToolBroker to agents.
//
//   AGENT_CAN_WRITE_HEALTH_TELEMETRY = NO
//   MODEL_CAN_WRITE_HEALTH_TELEMETRY = NO
//   ROUTER_CAN_WRITE_HEALTH_TELEMETRY = NO
//
// The raw primitive carries NO actor identity: authorization is implicit in the fact that
// only trusted execution/resilience infrastructure invokes it. Observations are
// SYSTEM-OBSERVED EXECUTION FACTS (provider-neutral, no secrets, no prompts).
export interface ModelHealthPersistence {
  recordModelHealthObservation(observation: ModelHealthObservation): Promise<void>;
}

// ————— Gate 41 — Privileged Global Workforce Control WRITE persistence —————
// This is a SEPARATE capability interface, deliberately NOT part of the general `Store`.
// It is implemented by the persistent repository (and by the in-memory test fake) but is
// wired/typed ONLY into the trusted administrative composition root. Normal Worker/Agent/
// Mission/Specialist code receives `Store` (READ only) and therefore cannot reach the raw
// write. The single production caller is the core authority function `setGlobalEmergencyStop`,
// which validates a system-admin actor before invoking `setWorkforceControlRaw`.
//
// The raw primitive carries NO actorType: authorization has already occurred at the
// privileged core boundary before this is reached. It persists only the outcome plus the
// already-authorized admin identity (updated_by) as audit metadata.
export interface WorkforceControlAdminPersistence {
  setWorkforceControlRaw(input: {
    globallyEnabled: boolean;
    reason: string;
    updatedBy: string;
  }): Promise<WorkforceControlRecord>;
}
