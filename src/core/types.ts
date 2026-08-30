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
  missionId: string | null;
  missionTaskKey: string | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  /**
   * Gate 45 — Trusted software task completion contract.
   * When verificationRequired is true, a task may transition to COMPLETED ONLY
   * after ALL operations in requiredVerifications report outcome 'passed' from a
   * trusted (server-side) verification run. The model's declaration of success is
   * advisory only (MODEL_DECLARES_SUCCESS = ADVISORY_ONLY). allowed operations are
   * the frozen VerificationOperation enum ('test' | 'typecheck' | 'build').
   */
  verificationRequired: boolean;
  requiredVerifications: import('../software/verification/types.js').VerificationOperation[];
}

// ---------- Mission / plan (Gate 39) ----------
// A mission is a durable objective with a validated, deterministic task plan that
// is bound to a canonical SHA-256 hash at approval time. The engine REQUESTs
// approval and NEVER approves; materialization/activation are all-or-nothing.
export const MISSION_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'materialized',
  'active',
  'completed',
  'failed',
  'cancelled',
] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const MISSION_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export interface MissionInput {
  ownerId: string;
  projectId: string;
  objective: string;
  budgetLimit?: number | null;
  createdBy?: string | null;
}

// A single proposed task within a mission plan. NEVER carries an agentId,
// a permission grant, an authority/autonomy grant, or any tool/execution
// capability — the mission engine plans only; placement is external.
export interface TaskProposal {
  key: string; // stable mission_task_key (unique within the mission)
  title: string;
  description?: string | null;
  priority?: TaskRecord['priority'];
  riskLevel?: RiskLevel;
  requiredCapabilities?: string[];
  preferredRole?: string | null;
  inputs?: JsonObject;
  maxAttempts?: number;
  successCriteria?: string[];
  /** Gate 45 — declarative trusted-completion contract. Survives materialization so
   *  the acceptance gate is machine-readable (not prompt-only). */
  verificationRequired?: boolean;
  requiredVerifications?: import('../software/verification/types.js').VerificationOperation[];
}

export interface DependencyProposal {
  prerequisiteKey: string; // task key
  dependentKey: string; // task key
}

// The immutable plan attached to a mission once approved (plan_hash binds it).
export interface MissionPlan {
  objective: string;
  tasks: TaskProposal[];
  dependencies: DependencyProposal[];
  estimatedBudget?: number | null;
}

// Bound input used by the deterministic validator / canonical hashing.
export interface MissionPlanCanonical {
  objective: string;
  tasks: Array<{
    key: string;
    title: string;
    description?: string | null;
    priority?: TaskRecord['priority'];
    riskLevel?: RiskLevel;
    requiredCapabilities?: string[];
    preferredRole?: string | null;
    inputs?: JsonObject;
    maxAttempts?: number;
    successCriteria?: string[];
    verificationRequired?: boolean;
    requiredVerifications?: import('../software/verification/types.js').VerificationOperation[];
  }>;
  dependencies: Array<{ prerequisiteKey: string; dependentKey: string }>;
  estimatedBudget?: number | null;
}

export interface MissionRecord {
  id: string;
  ownerId: string;
  projectId: string;
  objective: string;
  status: MissionStatus;
  plan: JsonObject;
  planHash: string | null;
  budgetLimit: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  materializedAt: string | null;
  activatedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
}

// Result of the deterministic plan validator.
export interface MissionValidationResult {
  ok: boolean;
  errors: string[];
}

// Result of the atomic materialization materializer.
export interface MissionMaterializeResult {
  ok: boolean;
  outcome: string;
  mission: MissionRecord | null;
  taskCount: number;
  edgeCount: number;
}

// Result of the atomic activation.
export interface MissionActivateResult {
  ok: boolean;
  outcome: string;
  mission: MissionRecord | null;
  queuedTaskCount: number;
}

// ---------- Task dependencies (Gate 38) ----------
// Relational DAG edge: prerequisite_task_id -> dependent_task_id.
// A dependent task is READY only when ALL of its prerequisites are 'completed'.
export interface TaskDependencyRecord {
  id: string;
  ownerId: string;
  projectId: string;
  prerequisiteTaskId: string;
  dependentTaskId: string;
  createdBy: string | null;
  createdAt: string;
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

// ---------- Gate 45 — Trusted verification evidence ----------
// Minimal evidence row persisted by the trusted acceptance gate for a verification-
// REQUIRED task. SYSTEM-OBSERVED (trusted infrastructure writes only; agents/models
// cannot forge it). Deliberately NOT a general observability/evidence platform.
// It records only the trusted check outcome, NOT raw stdout/stderr and NOT secrets.
// Gate 46: the row now binds the trusted verification session and the workspace
// fingerprint (verification_session_id + workspace_fingerprint). This is AUDIT-ONLY;
// historical evidence NEVER authorizes future completion.
export interface TaskVerificationRecord {
  id: string;
  ownerId: string;
  projectId: string;
  taskId: string;
  runId: string | null;
  attempt: number;
  operation: import('../software/verification/types.js').VerificationOperation;
  outcome: import('../software/verification/types.js').VerificationOutcome;
  exitCode: number | null;
  durationMs: number | null;
  /** Gate 46 — trusted verification session id (AUDIT-ONLY binding). */
  verificationSessionId: string | null;
  /** Gate 46 — trusted workspace fingerprint (AUDIT-ONLY binding). */
  workspaceFingerprint: string | null;
  observedAt: string;
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
  metadata: JsonObject;
  createdAt: string;
}

// ---------- Gate 47 — Immutable prepared delivery ----------
export const PREPARED_DELIVERY_STATUSES = ['prepared', 'approved', 'rejected', 'committing', 'committed', 'failed', 'stale', 'ambiguous'] as const;
export type PreparedDeliveryStatus = (typeof PREPARED_DELIVERY_STATUSES)[number];

export interface DeliveryManifestEntry {
  path: string;
  kind: 'A' | 'M' | 'D';
  sha256: string | null; // null only for a deletion
}

export interface PreparedDeliveryRecord {
  id: string;
  ownerId: string;
  projectId: string;
  taskId: string;
  agentId: string;
  approvalId: string | null;
  message: string;
  messageHash: string;
  baseCommit: string;
  preparedTreeSha: string;
  manifest: DeliveryManifestEntry[];
  manifestFingerprint: string;
  workspaceFingerprint?: string | null;
  verificationSessionId: string | null;
  verificationWorkspaceFingerprint?: string | null;
  status: PreparedDeliveryStatus;
  version: number;
  commitSha: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- Models / Runtimes ----------
export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  slug: string;
  capability: JsonObject; // e.g. { reasoning: 'high', tools: true }
  contextWindow: number | null;
  costPer1kInput: number;
  costPer1kOutput: number;
  status: 'active' | 'limited' | 'retired';
}

/**
 * Gate 42 — Provider-neutral, typed view of a model's declared capability.
 * Read from `ModelInfo.capability` (JsonObject). NEVER names a provider/model
 * and NEVER grants authority — it is SUITABILITY metadata only.
 */
export interface ModelCapability {
  reasoning?: 'none' | 'low' | 'medium' | 'high';
  tools?: boolean;
  codingStrength?: 'none' | 'low' | 'medium' | 'high';
  multimodal?: boolean;
  structuredOutput?: boolean;
}

export interface ModelSelectionRequest {
  requirement: string; // task type / capability requirement
  neededReasoning: 'none' | 'low' | 'medium' | 'high';
  neededTools: boolean;
  minContextWindow: number | null;
}

/**
 * Gate 42 — Enriched routing requirements. Extends the legacy ModelSelectionRequest
 * with the full provider-neutral fields a specialist may declare (Gate 40
 * SpecialistModelNeeds). All fields are SUITABILITY floors; routing never grants
 * authority and never names a provider/model.
 */
export interface ModelRoutingRequirements {
  requirement: string;
  neededReasoning: 'none' | 'low' | 'medium' | 'high';
  neededTools: boolean;
  minContextWindow: number | null;
  /** Whether the requirement is a mandatory floor for fields below. */
  mandatory: boolean;
  maxCostPerCall: number | null; // optional ceiling on estimated cost
  /** Optional enriched suitability floors (Gate 40 SpecialistModelNeeds). */
  neededCodingStrength?: 'none' | 'low' | 'medium' | 'high' | null;
  neededMultimodal?: boolean | null;
  neededStructuredOutput?: boolean | null;
  /** Gate 43: when true, latency bucket is an explicit ranking dimension among
   *  capable/eligible candidates (never stronger than a capability floor and
   *  never cost-granting for ordinary work). False => cost-first behavior. */
  latencySensitive?: boolean | null;
}

export interface ModelSelection {
  model: ModelInfo | null;
  reason: string;
  cheapestCapable: boolean;
  candidates: ModelInfo[];
}

// ---------- Gate 42 — Routing ----------
/** Trusted remaining-budget information consumed by the router. Router may READ
 *  only; it can neither modify budget nor authorize overspend. */
export interface RoutingBudget {
  remaining: number | null; // null = unlimited/unknown
  /** Estimated cost of the candidate about to be selected (computed by caller). */
  costOfCandidate(estimatedCost: number): boolean;
}

/**
 * Provider health signal for routing. A candidate whose provider path is
 * unavailable/open-circuit may be excluded or deprioritized deterministically.
 * Gate 43 adds optional provider-neutral health detail so the router can rank
 * by latency bucket and degrade by deterministic thresholds (never an opaque
 * score, never authority-granting).
 */
export interface ProviderHealthSignal {
  provider: string;
  /** Gate 43: the specific registered model being signaled (per-model telemetry). */
  modelId?: string;
  /** false => exclude (open circuit / explicitly unavailable). */
  available: boolean;
  /** Gate 43: deterministic availability class (cold start = 'unknown' => neutral). */
  availability?: ModelAvailability;
  /** Gate 43: provider-neutral latency bucket (deterministic ranking dimension). */
  latencyBucket?: LatencyBucket;
  /** Gate 43: number of completed logical observations behind this signal. */
  observationCount?: number;
  /** Gate 43: provider-wide circuit state (truthfully provider-scoped). */
  circuitState?: ModelCircuitState;
  /** Gate 43: deterministic recent failure ratio (0..1 or null when insufficient). */
  recentFailureRatio?: number | null;
  /** Gate 43: deterministic recent timeout ratio (0..1 or null when insufficient). */
  recentTimeoutRatio?: number | null;
}

// ---------- Gate 43 — Durable Model/Provider Health Telemetry ----------

/** Outcome class of ONE completed logical model observation. */
export type ModelHealthOutcome = 'success' | 'failure' | 'timeout';

/** Provider-neutral availability class. 'unknown' = cold-start/no telemetry = NEUTRAL. */
export type ModelAvailability = 'unknown' | 'available' | 'degraded' | 'unavailable';

/** Provider-neutral latency bucket (deterministic, no provider-specific thresholds). */
export type LatencyBucket = 'unknown' | 'low' | 'medium' | 'high';

/** Provider-wide circuit state (preserved from the existing resilient breaker). */
export type ModelCircuitState = 'unknown' | 'closed' | 'open' | 'half_open';

/**
 * Gate 43 — A single durable health OBSERVATION (system-observed execution fact).
 * This is NOT prompt/API-key/payload data; only provider-neutral routing signals.
 * Transport-retry attempts within ONE logical adapter.complete() are collapsed
 * into exactly ONE observation (see WHAT_COUNTS_AS_ONE_OBSERVATION).
 */
export interface ModelHealthObservation {
  ownerId: string;
  provider: string;
  modelId: string;
  /** Provider-neutral outcome of the logical call. */
  outcome: ModelHealthOutcome;
  /** Monotonic wall duration of the logical call (>= 0 ms). */
  latencyMs: number;
  /** Whether the provider reported token usage on success (Google = false). */
  usageObserved: boolean;
  /** Candidate index within the routing chain (0 = primary, 1..n = fallback). */
  fallbackIndex: number;
  /** RFC3339 observed-at (defaulted to now if omitted). */
  observedAt?: string | null;
}

/**
 * Gate 43 — Provider-neutral aggregated health snapshot over the bounded recent
 * window. Deterministic; computed from bounded canonical observations. Never an
 * opaque score; every field is an explicit explainable signal.
 */
export interface ModelHealthSnapshot {
  provider: string;
  modelId?: string;
  observationCount: number;
  recentSuccessCount: number;
  recentFailureCount: number;
  recentTimeoutCount: number;
  recentFailureRatio: number | null;
  recentTimeoutRatio: number | null;
  latencyBucket: LatencyBucket;
  circuitState: ModelCircuitState;
  availability: ModelAvailability;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  updatedAt?: string | null;
}

/** Gate 43 — Provider-neutral health policy constants (see src/core/modelHealth.ts). */
export interface ModelHealthPolicy {
  /** Bounded deterministic recent window (number of latest observations). */
  recentWindow: number;
  /** Minimum observations before the availability classification has confidence. */
  minObservations: number;
  /** recentFailureRatio >= this => 'degraded'. */
  failureDegradeRatio: number;
  /** recentTimeoutRatio >= this => 'degraded'. */
  timeoutDegradeRatio: number;
  /** Provider-neutral latency bucket boundaries (ms). Representative (median)
   *  latency < latencyLowMs => 'low'; < latencyMediumMs => 'medium'; <
   *  latencyHighMs => 'high'; else 'high'. Provider-agnostic, documented. */
  latencyLowMs: number;
  latencyMediumMs: number;
  latencyHighMs: number;
}



/** Deterministic, safe routing rationale. Never contains secrets or prompts. */
export interface SafeRoutingRationale {
  policyVersion: string;
  candidateCount: number;
  capableCount: number;
  excludedUnavailable: number;
  requirementSummary: string; // e.g. "reasoning>=medium, tools=true, context>=32000"
  selectedProvider: string | null;
  selectedModel: string | null;
  estimatedCost: number | null;
  fallbackIndex: number;
  rejectionReason: RoutingRejection | null;
  /** Gate 43 — provider-neutral explainability for adaptive routing. Optional. */
  selectedAvailability?: ModelAvailability | null;
  selectedLatencyBucket?: LatencyBucket | null;
  selectedObservationCount?: number | null;
}

export type RoutingRejection =
  | 'no_capable_model'
  | 'budget_exhausted'
  | 'all_unavailable'
  | null;

/**
 * Gate 42 — Canonical structured routing result (fail-closed). The router NEVER
 * produces an ambiguous generic error; every outcome carries a safe rationale.
 */
export type ModelRoutingResult =
  | {
      outcome: 'selected';
      selection: ModelSelection;
      rationale: SafeRoutingRationale;
    }
  | {
      outcome: 'no_capable_model';
      selection: { model: null; reason: string; cheapestCapable: false; candidates: ModelInfo[] };
      rationale: SafeRoutingRationale;
    }
  | {
      outcome: 'budget_exhausted';
      selection: { model: null; reason: string; cheapestCapable: false; candidates: ModelInfo[] };
      rationale: SafeRoutingRationale;
    };

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
