// CHEF FACTORY — Gate 39 — Mission Engine Foundation (deterministic, security-safe).
// This module is the AUTHORITATIVE deterministic core:
//   - canonical SHA-256 plan hashing (MISSION_PLAN_APPROVAL_BINDS_TO_HASH = YES)
//   - deterministic plan validation (bounds, DAG correctness, security rejection)
//   - lifecycle transition enforcement (draft → pending_approval → approved →
//     materialized → active → completed | failed | cancelled)
//   - the MISSION_COMPLETED / MISSION_FAILED / MISSION_CANCELLED semantic rules
//
// The engine NEVER approves, never selects an agent, never grants permission,
// never creates assignments, and never calls an LLM to author tasks autonomously.
// The planner is PROPOSAL_ONLY: the LLM may propose a plan; it is validated and
// hash-bound exactly as any owner-supplied plan, and materialization/activation
// are atomic and deterministic.

import { createHash } from 'node:crypto';
import type {
  DependencyProposal,
  MissionPlanCanonical,
  MissionRecord,
  MissionStatus,
  MissionValidationResult,
  TaskProposal,
  TaskRecord,
  TaskStatus,
} from '../types.js';

// ---------- Bounds (frozen; supersede recon defaults, authoritative) ----------
export const MISSION_BOUNDS = {
  DEFAULT_MAX_TASKS: 20,
  HARD_MAX_TASKS: 50,
  DEFAULT_MAX_EDGES: 50,
  HARD_MAX_EDGES: 150,
  MAX_DAG_DEPTH: 20,
  MAX_FAN_IN: 10,
  MAX_FAN_OUT: 10,
  MAX_OBJECTIVE_LEN: 4000,
  MAX_TASK_TITLE_LEN: 120,
  MAX_TASK_DESC_LEN: 4000,
  MAX_PLAN_BYTES: 256 * 1024,
  MAX_SUCCESS_CRITERIA_PER_TASK: 20,
  MAX_SUCCESS_CRITERION_LEN: 500,
} as const;

export const MISSION_LIFECYCLE: Record<MissionStatus, MissionStatus[]> = {
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'cancelled'],
  approved: ['materialized', 'cancelled'],
  materialized: ['active', 'cancelled'],
  active: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const TERMINAL_STATUSES = new Set<MissionStatus>(['completed', 'failed', 'cancelled']);

export function missionCanTransition(from: MissionStatus, to: MissionStatus): boolean {
  return (MISSION_LIFECYCLE[from] ?? []).includes(to);
}

// ---------- Canonical serialization + SHA-256 ----------
// Sort keys recursively, omit undefined, order arrays deterministically first by
// their canonical key, producing a byte-stable string. SHA-256 binds the approval.
function canonicalString(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    const items = v.map((x) => canonicalString(x)).sort();
    return '[' + items.join(',') + ']';
  }
  if (typeof v === 'object') {
    const rec = v as Record<string, unknown>;
    const keys = Object.keys(rec).filter((k) => rec[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalString(rec[k])).join(',') + '}';
  }
  return JSON.stringify(String(v));
}

export function canonicalizePlan(plan: MissionPlanCanonical): MissionPlanCanonical {
  return {
    objective: plan.objective,
    tasks: (plan.tasks ?? []).map((t) => ({
      key: t.key,
      title: t.title,
      description: t.description ?? null,
      priority: t.priority ?? 'medium',
      riskLevel: t.riskLevel ?? 'low',
      requiredCapabilities: t.requiredCapabilities ?? [],
      preferredRole: t.preferredRole ?? null,
      inputs: t.inputs ?? {},
      maxAttempts: t.maxAttempts ?? 3,
      successCriteria: t.successCriteria ?? [],
    })),
    dependencies: (plan.dependencies ?? []).map((d) => ({
      prerequisiteKey: d.prerequisiteKey,
      dependentKey: d.dependentKey,
    })),
    estimatedBudget: plan.estimatedBudget ?? null,
  };
}

export function hashMissionPlan(plan: MissionPlanCanonical): string {
  return createHash('sha256').update(canonicalString(canonicalizePlan(plan))).digest('hex');
}

// ---------- Deterministic validation ----------
// Rejects, in order: hard structure, security violations, ID/identity leak into
// plan, bounds, and DAG correctness. Pure function — no I/O, no nondeterminism.
export function validateMissionPlan(
  plan: MissionPlanCanonical,
  opts: { maxTasks?: number; maxEdges?: number } = {},
): MissionValidationResult {
  const errors: string[] = [];
  const base = canonicalizePlan(plan);
  const maxTasks = clampB(posIntOpt(opts.maxTasks, MISSION_BOUNDS.DEFAULT_MAX_TASKS), 1, MISSION_BOUNDS.HARD_MAX_TASKS);
  const maxEdges = clampB(posIntOpt(opts.maxEdges, MISSION_BOUNDS.DEFAULT_MAX_EDGES), 0, MISSION_BOUNDS.HARD_MAX_EDGES);

  // Structure / bounds
  if (typeof base.objective !== 'string' || base.objective.trim().length === 0) errors.push('objective empty');
  if (base.objective.length > MISSION_BOUNDS.MAX_OBJECTIVE_LEN) errors.push(`objective exceeds ${MISSION_BOUNDS.MAX_OBJECTIVE_LEN} chars`);
  if (!Array.isArray(base.tasks) || base.tasks.length === 0) errors.push('plan has no tasks');
  if (base.tasks.length > maxTasks) errors.push(`task count ${base.tasks.length} exceeds allowed ${maxTasks}`);
  if (!Array.isArray(base.dependencies)) errors.push('dependencies must be an array');

  const keys = new Set<string>();
  const titles = new Set<string>();
  for (const t of base.tasks) {
    if (!t.key || typeof t.key !== 'string' || t.key.length === 0) errors.push('task key empty');
    else if (keys.has(t.key)) errors.push(`duplicate task key ${t.key}`);
    else keys.add(t.key);
    if (!t.title || typeof t.title !== 'string' || t.title.trim().length === 0) errors.push(`task ${t.key ?? '?'} has empty title`);
    else if (t.title.length > MISSION_BOUNDS.MAX_TASK_TITLE_LEN) errors.push(`task ${t.key ?? '?'} title exceeds ${MISSION_BOUNDS.MAX_TASK_TITLE_LEN} chars`);
    if (t.description && t.description.length > MISSION_BOUNDS.MAX_TASK_DESC_LEN) errors.push(`task ${t.key ?? '?'} description exceeds ${MISSION_BOUNDS.MAX_TASK_DESC_LEN} chars`);
    if (Array.isArray(t.successCriteria)) {
      if (t.successCriteria.length > MISSION_BOUNDS.MAX_SUCCESS_CRITERIA_PER_TASK) errors.push(`task ${t.key ?? '?'} too many success criteria`);
      for (const s of t.successCriteria) {
        if (typeof s === 'string' && s.length > MISSION_BOUNDS.MAX_SUCCESS_CRITERION_LEN) errors.push(`task ${t.key ?? '?'} success criterion too long`);
      }
    }
    // Security: NO identity/authority leak into the plan. Probe any string field
    // for id-like or authority/permission/push/shell signals. The engine must
    // never plan an agent, permission, or authority grant.
    const fields = [
      t.title, t.description ?? '', t.key,
      ...(t.requiredCapabilities ?? []),
      ...(t.successCriteria ?? []),
    ];
    for (const f of fields) {
      if (typeof f === 'string') checkReject(f, `task ${t.key ?? '?'}`, errors);
    }
    const pve = posIntOpt(t.maxAttempts, 3);
    if (pve < 1) errors.push(`task ${t.key ?? '?'} invalid maxAttempts`);
  }

  // DAG: all dependency keys must exist; no self-edge; acyclicity + depth + fan.
  if (Array.isArray(base.dependencies)) {
    if (base.dependencies.length > maxEdges) errors.push(`edge count ${base.dependencies.length} exceeds allowed ${maxEdges}`);
    const seen = new Set<string>();
    const adj = new Map<string, string[]>();
    const fanOut = new Map<string, number>();
    const fanIn = new Map<string, number>();
    for (const d of base.dependencies) {
      const p = d.prerequisiteKey;
      const dep = d.dependentKey;
      if (!keys.has(p)) errors.push(`dependency prerequisite key ${p} not in plan`);
      if (!keys.has(dep)) errors.push(`dependency dependent key ${dep} not in plan`);
      if (p === dep) errors.push(`self dependency on ${p}`);
      const ekey = `${p}->${dep}`;
      if (seen.has(ekey)) errors.push(`duplicate edge ${ekey}`);
      seen.add(ekey);
      fanOut.set(p, (fanOut.get(p) ?? 0) + 1);
      fanIn.set(dep, (fanIn.get(dep) ?? 0) + 1);
      if (!adj.has(p)) adj.set(p, []);
      adj.get(p)!.push(dep);
    }
    for (const [k, n] of fanOut) if (n > MISSION_BOUNDS.MAX_FAN_OUT) errors.push(`task ${k} fan-out ${n} exceeds ${MISSION_BOUNDS.MAX_FAN_OUT}`);
    for (const [k, n] of fanIn) if (n > MISSION_BOUNDS.MAX_FAN_IN) errors.push(`task ${k} fan-in ${n} exceeds ${MISSION_BOUNDS.MAX_FAN_IN}`);
    // Longest-path depth + cycle detection.
    const inDeg = new Map<string, number>();
    for (const k of keys) inDeg.set(k, 0);
    for (const d of base.dependencies) inDeg.set(d.dependentKey, (inDeg.get(d.dependentKey) ?? 0) + 1);
    const stack: string[] = [];
    for (const k of keys) if ((inDeg.get(k) ?? 0) === 0) stack.push(k);
    const order: string[] = [];
    while (stack.length) {
      const k = stack.pop()!;
      order.push(k);
      for (const m of adj.get(k) ?? []) {
        const nd = (inDeg.get(m) ?? 0) - 1;
        inDeg.set(m, nd);
        if (nd === 0) stack.push(m);
      }
    }
    const depth = new Map<string, number>();
    for (const k of order) {
      const d = depth.get(k) ?? 0;
      for (const m of adj.get(k) ?? []) {
        depth.set(m, Math.max(depth.get(m) ?? 0, d + 1));
      }
    }
    if (order.length !== keys.size) errors.push('dependency graph contains a cycle');
    for (const [, d] of depth) if (d >= MISSION_BOUNDS.MAX_DAG_DEPTH) errors.push(`dependency depth exceeds ${MISSION_BOUNDS.MAX_DAG_DEPTH}`);
  }

  return { ok: errors.length === 0, errors };
}

// Security rejection patterns — the mission plan must NEVER encode an actor
// identity, a permission/authority grant, or direct tool/shell/push execution.
function checkReject(field: string, where: string, errors: string[]): void {
  const s = field.toLowerCase();
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/.test(field)) {
    errors.push(`${where}: contains a UUID id — mission plans must not embed agent/task ids`);
    return;
  }
  if (/\b(agentId|agent_id|ownerId|owner_id)\b/.test(s)) errors.push(`${where}: references an actor id`);
  if (/\bpermission\b|\bgrant\b|\bapprove\b|\bauthorize\b|\bdeny\b/.test(s)) errors.push(`${where}: encodes a permission/authority grant`);
  if (requireCapabilitySignal(field)) errors.push(`${where}: encodes a permission grant via required capability`);
  if (executionSignal(field)) errors.push(`${where}: encodes direct tool/shell/push execution`);
}

// A required capability that itself grants authority would be a permission grant.
function requireCapabilitySignal(field: string): boolean {
  const s = field.toLowerCase().replace(/_/g, ' ');
  return /\b(deploy|delete|admin|sudo|root|owner|production\s*write|write\s*production|prod\s*write)\b/.test(s);
}

// The engine plans work; it must not be the vehicle for direct execution bodies.
function executionSignal(field: string): boolean {
  const s = field.toLowerCase();
  return /\bgit\s+push\b|\brm\s+-rf\b|\.\s*sh\b|\bshell:\s*|sudo\s+rm\b/.test(s);
}

function clampB(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function posIntOpt(v: number | undefined, dflt: number): number {
  if (v === undefined || !Number.isFinite(v) || v < 0) return dflt;
  return Math.floor(v);
}

// ---------- Mission semantic rules (authoritative) ----------
// MISSION_COMPLETED iff EVERY mission task is 'completed'.
export function missionCompleted(allTasks: TaskRecord[]): boolean {
  if (allTasks.length === 0) return false;
  return allTasks.every((t) => t.status === 'completed');
}

// MISSION_FAILED iff >=1 REQUIRED mission task reached a FINAL/EXHAUSTED failed
// state (status 'failed' == the terminal outcome of taskEngine.handleTaskFailure
// after attempts are exhausted). Transient/retryable failure != mission failed.
export function missionFailed(allTasks: TaskRecord[]): boolean {
  return allTasks.some((t) => t.status === 'failed');
}

// CANCELLATION is NOT a failure: OWNER_CANCELLED_MISSION -> cancelled, never failed.
export function missionTitledStatus(allTasks: TaskRecord[]): MissionStatus | null {
  if (missionCompleted(allTasks)) return 'completed';
  if (missionFailed(allTasks)) return 'failed';
  return null;
}

// Helper: a task should be considered failed-final for mission reasons. We rely on
// the persisted task status 'failed' (the terminal state after retry exhaustion).
export function isTerminalTaskFailure(t: TaskRecord): boolean {
  return t.status === 'failed';
}

export const _internal = {
  canonicalString,
  checkReject,
  TERMINAL_STATUSES,
  MISSION_LIFECYCLE,
  missionCanTransition,
};
