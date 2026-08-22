// CHEF FACTORY — Gate 1 — Typed contracts (deterministic core vocabulary).
// Source of truth for enums/shapes used across core, gateways, API and DB.

// ---------- Core enums ----------
export const AUTONOMY_LEVELS = ['auto', 'notify', 'require_approval', 'deny'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const TASK_STATUSES = [
  'created',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'paused',
  'needs_approval',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_RUN_STATUSES = ['running', 'completed', 'failed', 'cancelled', 'timeout'] as const;
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'denied', 'expired', 'cancelled'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type EnvironmentName = (typeof ENVIRONMENTS)[number];

export const PERMISSIONS = ['read', 'write', 'execute', 'approve', 'admin'] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const COST_TYPES = ['model', 'runtime', 'tool', 'mission', 'project'] as const;
export type CostType = (typeof COST_TYPES)[number];

export const BILLED_TO = ['project', 'mission', 'owner'] as const;
export type BilledTo = (typeof BILLED_TO)[number];

// ---------- Intent ----------
export const INTENT_STATUSES = ['resolved', 'ambiguous', 'unknown'] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export type ActionVerb =
  | 'read'
  | 'write'
  | 'create'
  | 'update'
  | 'delete'
  | 'execute'
  | 'deploy'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'plan'
  | 'research'
  | 'ask'
  | 'list'
  | 'status'
  | 'unknown';

export interface ParsedIntent {
  status: IntentStatus;
  verb: ActionVerb;
  resource: string | null; // e.g. task/project/agent/approval/model/runtime/passport
  project: string | null; // slug if mentioned
  environment: EnvironmentName | null; // only if explicitly stated
  target: string | null; // object of the action when present
  confidence: 'high' | 'medium' | 'low';
  missing: string[]; // what is UNKNOWN — never fabricated
  normalized: string; // normalized command text
}

// ---------- Authority / Autonomy ----------
export interface AuthorityRequest {
  actorId: string; // owner or agent id (scoped by actorType)
  actorType: 'owner' | 'agent';
  projectId: string | null;
  environment: EnvironmentName;
  resourceType: string;
  permission: Permission;
  risk: RiskLevel;
  actionType: string; // e.g. 'delete', 'deploy', 'financial', 'legal', 'account_security'
  authorized: boolean; // resolved grant (owner = own project; agent = agent_permissions)
  explicitDeny: boolean; // from owner policy / POS — explicit DENY always wins
}

export interface AuthorityDecision {
  outcome: AutonomyLevel;
  risk: RiskLevel;
  reason: string;
  evidence: string[];
  denied: boolean;
  actionType?: string;
}

export interface AutonomyInput {
  authority: AuthorityDecision;
  successRate: number; // 0..1 historical success
  historyCount: number;
  ownerPolicy: AutonomyLevel | null; // explicit owner preference for this class
}

export interface AutonomyDecision {
  selected: AutonomyLevel;
  evidence: string[];
  reason: string;
}

// ---------- Projects / Passport ----------
export interface ProjectRecord {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived' | 'deleted';
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type JsonObject = Record<string, unknown>;

export interface PassportRecord {
  projectId: string;
  identity: JsonObject;
  description: string | null;
  technology: JsonObject;
  repository: JsonObject;
  databaseRef: JsonObject;
  environments: JsonObject;
  deployment: JsonObject;
  dependencies: JsonObject;
  models: JsonObject;
  runtimes: JsonObject;
  businessModel: JsonObject;
  status: JsonObject;
  risks: JsonObject;
  credentialsReferences: JsonObject;
  operationalHealth: JsonObject;
  documentationState: JsonObject;
}

// ---------- Tasks ----------
export interface TaskRecord {
  id: string;
  ownerId: string;
  projectId: string;
  environmentId: string | null;
  parentTaskId: string | null;
  agentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high' | 'critical';
  riskLevel: RiskLevel;
  authorityLevel: AutonomyLevel | null;
  autonomy: AutonomyLevel | null;
  approvalRequired: boolean;
  requiredCapabilities: string[];
  preferredRole: string | null;
  inputs: JsonObject;
  output: JsonObject | null;
  error: JsonObject | null;
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface TaskRunRecord {
  id: string;
  taskId: string;
  runNumber: number;
  status: TaskRunStatus;
  modelId: string | null;
  runtimeId: string | null;
  inputSnapshot: JsonObject | null;
  outputSnapshot: JsonObject | null;
  error: JsonObject | null;
  durationMs: number | null;
  cost: number;
  startedAt: string;
  completedAt: string | null;
}

// ---------- Approvals ----------
export interface ApprovalRecord {
  id: string;
  ownerId: string;
  projectId: string | null;
  taskId: string | null;
  agentId: string | null;
  action: string;
  description: string | null;
  riskLevel: RiskLevel | null;
  authorityLevel: AutonomyLevel | null;
  status: ApprovalStatus;
  decision: string | null;
  decisionReason: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  expiresAt: string | null;
  decidedAt: string | null;
  createdAt: string;
}

// ---------- Models / Runtimes ----------
export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  slug: string;
  capability: JsonObject; // e.g. { reasoning: 'high', vision: false, tools: true }
  contextWindow: number | null;
  costPer1kInput: number;
  costPer1kOutput: number;
  status: 'active' | 'limited' | 'retired';
}

export interface ModelSelectionRequest {
  requirement: string; // task type / capability requirement
  neededReasoning: 'none' | 'low' | 'medium' | 'high';
  neededTools: boolean;
  minContextWindow: number | null;
}

export interface ModelSelection {
  model: ModelInfo | null;
  reason: string;
  cheapestCapable: boolean;
  candidates: ModelInfo[];
}

export interface RuntimeInfo {
  id: string;
  name: string;
  version: string | null;
  slug: string;
  capability: JsonObject;
  costPerHour: number;
  status: 'active' | 'limited' | 'retired';
}

export interface RuntimeSelection {
  runtime: RuntimeInfo | null;
  reason: string;
  cheapestCapable: boolean;
  candidates: RuntimeInfo[];
}

// ---------- Costs ----------
export interface CostEvent {
  ownerId: string;
  projectId: string | null;
  taskId: string | null;
  runId: string | null;
  agentId: string | null;
  costType: CostType;
  amount: number;
  currency: string;
  provider: string | null;
  modelId: string | null;
  runtimeId: string | null;
  billedTo: BilledTo;
  metadata: JsonObject;
}

export interface BudgetLimit {
  projectId: string | null;
  period: 'day' | 'month';
  maxAmount: number;
}

// ---------- Decisions ----------
export interface DecisionRecord {
  decisionId: string;
  ownerId: string;
  projectId: string | null;
  context: string;
  options: string[];
  selectedOption: string | null;
  reason: string | null;
  evidence: string[];
  confidence: number | null;
  riskLevel: RiskLevel | null;
  authorityLevel: AutonomyLevel | null;
  approvedBy: string | null;
  outcome: string | null;
  createdAt: string;
}

// ---------- Explanation ----------
export interface Explanation {
  decision: string;
  why: string;
  evidence: string[];
  confidence: number | null;
  risk: RiskLevel;
  outcome: string;
}

// ---------- Monitoring ----------
export interface ProjectHealth {
  projectId: string;
  projectName: string;
  activeTasks: number;
  blockedTasks: number;
  failures: number;
  pendingApprovals: number;
  cost: number;
  health: 'healthy' | 'attention' | 'critical';
}

export interface DailyStatus {
  generatedAt: string;
  projects: ProjectHealth[];
  activeTasks: number;
  blockedTasks: number;
  failures: number;
  pendingApprovals: number;
  cost: number;
  alerts: string[];
  decisionsRequired: string[];
}

// ---------- Agents (Gate 25) ----------
export const AGENT_STATUSES = ['active', 'paused', 'retired', 'suspended'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** Persisted agent record — maps directly to public.agents table columns. */
export interface AgentRecord {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  role: string;
  description: string | null;
  capabilities: string[];
  status: AgentStatus;
  maxConcurrentTasks: number;
  createdAt: string;
  updatedAt: string;
}

/** Input contract for creating/defining a new agent. */
export interface AgentDefinition {
  name: string;
  slug?: string;
  role: string;
  description?: string | null;
  capabilities?: string[];
  status?: AgentStatus;
  maxConcurrentTasks?: number;
}

/** Input contract for patching an existing agent. All fields optional. */
export interface AgentPatch {
  name?: string;
  description?: string | null;
  role?: string;
  capabilities?: string[];
  status?: AgentStatus;
  maxConcurrentTasks?: number;
}

// ---------- Memory ----------
export interface RecallItem {
  id: string;
  category: string;
  title: string;
  summary: string;
  projectId: string | null;
  confidence: number;
  createdAt: string;
}

export interface LessonInput {
  title: string;
  summary: string;
  category: string;
  projectId: string | null;
  confidence: number;
}

// ---------- Secrets ----------
export interface SecretRef {
  key: string;
  present: boolean;
  source: string;
}

// ---------- ToolBroker ----------
export interface ToolCallRequest {
  tool: string;
  args: JsonObject;
  actorId: string;
  actorType: 'owner' | 'agent';
  projectId: string | null;
  environment: EnvironmentName;
  risk: RiskLevel;
}

export interface ToolCallResult {
  ok: boolean;
  tool: string;
  action: string;
  outcome: string;
  metadata: JsonObject;
}

// ---------- Audit ----------
export interface AuditEvent {
  actorType: 'owner' | 'agent' | 'system';
  actorId: string | null;
  action: string;
  projectId: string | null;
  environmentId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  authorizationResult: AutonomyLevel | null;
  correlationId: string | null;
  taskId: string | null;
  metadata: JsonObject;
}
