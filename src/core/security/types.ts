// CHEF FACTORY — Gate 2 — Security Guardian: typed contracts.
// Deterministic security vocabulary shared by core, gateways, API and DB.

import type { EnvironmentName, Permission, RiskLevel } from '../types.js';

export const SECURITY_DECISIONS = ['allow', 'notify', 'require_approval', 'deny', 'lockdown'] as const;
export type SecurityDecision = (typeof SECURITY_DECISIONS)[number];

// Precedence: lockdown > deny > require_approval > notify > allow.
export const SECURITY_PRECEDENCE: Record<SecurityDecision, number> = {
  lockdown: 5,
  deny: 4,
  require_approval: 3,
  notify: 2,
  allow: 1,
};

export const EVENT_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type EventSeverity = (typeof EVENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = ['detected', 'investigating', 'contained', 'resolved', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const LOCKDOWN_STATUSES = ['active', 'released'] as const;
export type LockdownStatus = (typeof LOCKDOWN_STATUSES)[number];

export const SECURITY_SCOPE_KEYS = ['task', 'tool', 'runtime', 'model', 'auth', 'approval', 'failure', 'data_query'] as const;
export type SecurityScopeKey = (typeof SECURITY_SCOPE_KEYS)[number];

// ---------- Risk classification ----------
export interface RiskContext {
  actionType: string;
  environment: EnvironmentName;
  projectId: string | null;
  requestedPermission: Permission;
  affectedResources: string[];
  reversibility: boolean;
  dataSensitivity: 'none' | 'low' | 'medium' | 'high';
  productionImpact: boolean;
  financialImpact: boolean;
  externalCommunication: boolean;
  destructivePotential: boolean;
  privilegeEscalation: boolean;
  secretExposure: boolean;
  scope: 'single' | 'multi' | 'global';
  agentSuccessRate: number | null;
  agentHistoryCount: number;
  anomalyIndicators: string[];
}

export interface RiskAssessment {
  risk: RiskLevel;
  evidence: string[];
}

// ---------- Critical Action Registry ----------
export type CriticalActionClassification =
  | 'production'
  | 'destructive'
  | 'secret'
  | 'permission'
  | 'policy'
  | 'audit'
  | 'identity'
  | 'authority'
  | 'financial'
  | 'contractual'
  | 'external_irreversible'
  | 'factory'
  | 'project'
  | 'task'
  | 'agent'
  | 'security'
  | 'memory';

export interface CriticalActionRule {
  action: string;
  classification: CriticalActionClassification;
  defaultDecision: SecurityDecision;
  environments: EnvironmentName[] | 'all';
  description: string;
  isCore: boolean; // factory core — never modifiable by agents or owners
}

export interface CriticalActionMatch {
  rule: CriticalActionRule;
  version: number;
}

// ---------- Security request / decision ----------
export interface SecurityRequest {
  ownerId: string;
  actorId: string;
  actorType: 'owner' | 'agent';
  agentId?: string | null;
  projectId: string | null;
  requestedProjectId?: string | null; // cross-project check
  environment: EnvironmentName;
  grantedEnvironments?: EnvironmentName[]; // env scope the actor actually holds
  resourceType: string;
  resourceId?: string | null;
  actionType: string;
  permission: Permission;
  risk: RiskLevel;
  authorized: boolean;
  explicitDeny: boolean;
  authorityOutcome?: 'auto' | 'notify' | 'require_approval' | 'deny'; // resolved Gate 1 authority
  untrustedInput?: string | null; // external content (files, docs, model output)
  scope?: SecurityScopeKey;
  correlationId?: string | null;
  taskId?: string | null;
  evidence?: string[];
}

export interface SecurityEventInput {
  ownerId: string;
  projectId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  correlationId?: string | null;
  environment?: string;
  eventType: string;
  severity: EventSeverity;
  action: string;
  resource?: string | null;
  decision?: SecurityDecision | string | null;
  reason: string;
  evidenceReferences?: string[];
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

export interface SecurityEventRecord extends Required<Pick<SecurityEventInput, 'ownerId' | 'eventType' | 'severity' | 'action' | 'reason'>> {
  eventId: string;
  projectId: string | null;
  agentId: string | null;
  taskId: string | null;
  correlationId: string | null;
  environment: string;
  resource: string | null;
  decision: string | null;
  evidenceReferences: string[];
  metadata: Record<string, unknown>;
  occurredAt: string;
  recordedAt: string;
}

export interface SecurityGuardResult {
  decision: SecurityDecision;
  finalAutonomy: 'auto' | 'notify' | 'require_approval' | 'deny'; // combined with Gate 1 authority
  reason: string;
  rules: string[]; // applied policy rule ids
  evidence: string[];
  events: SecurityEventInput[];
  denied: boolean;
}

// ---------- Incidents ----------
export interface SecurityIncidentInput {
  title: string;
  description?: string | null;
  eventIds?: string[];
  openedBy?: string | null;
}

export interface SecurityIncidentPatch {
  status?: IncidentStatus;
  description?: string | null;
  closedBy?: string | null;
}

export interface SecurityIncidentRecord {
  incidentId: string;
  ownerId: string;
  title: string;
  status: IncidentStatus;
  description: string | null;
  eventIds: string[];
  openedBy: string | null;
  closedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- Lockdown ----------
export interface SecurityLockdownRecord {
  lockdownId: string;
  ownerId: string;
  scope: 'all' | string; // 'all' or a specific project scope
  reason: string;
  status: LockdownStatus;
  activatedBy: string;
  releasedBy: string | null;
  releasedAt: string | null;
  createdAt: string;
}

// ---------- Rate limits ----------
export interface RateLimitConfig {
  id: string;
  ownerId: string;
  scope: SecurityScopeKey;
  limitKey: string; // e.g. 'task.execute', 'tool.call', 'auth.failure'
  maxCount: number;
  windowSeconds: number;
  enabled: boolean;
  version: number;
}

// ---------- Anomaly ----------
export interface AnomalySignal {
  triggered: boolean;
  indicator: string;
  metric: number;
  threshold: number;
  reason: string;
}

export interface AnomalyCounters {
  deniedActions: number;
  authFailures: number;
  privilegeRequests: number;
  projectSwitches: number;
  environmentEscalations: number;
  costSpikes: number;
  retryBursts: number;
  toolAnomalies: number;
  secretAccessAttempts: number;
  policyViolations: number;
}

// ---------- Health ----------
export type HealthStatus = 'healthy' | 'degraded' | 'lockdown' | 'blocked';

export interface HealthCheckResult {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  critical: boolean;
}

export interface SecurityHealth {
  status: HealthStatus;
  checks: HealthCheckResult[];
  generatedAt: string;
}

// ---------- RLS probe ----------
export interface RlsProbe {
  publicTables: number;
  rlsEnabledTables: number;
  auditAppendOnly: boolean; // audit trigger present
  securityEventsAppendOnly: boolean;
  ok: boolean;
}
