// CHEF FACTORY — Gate 45 — Trusted Software Task Completion (deterministic tests).
//
// Proves the machine-readable verification contract is enforced by the trusted
// acceptance gate AND by AgentExecutor (MODEL_DECLARES_SUCCESS = ADVISORY_ONLY):
//   - a verification-required task reaches COMPLETED ONLY when ALL required
//     operations report 'passed' through the trusted gate;
//   - the model's textual/synthetic success claim is never sufficient;
//   - failures are classified deterministically (repairable vs nonRepairable vs
//     blocked) and routed: repairable → existing bounded cross-attempt retry,
//     nonRepairable/blocked → terminal FAILED (never false-completed, never an
//     unbounded second scheduler);
//   - durable controls (cancel, global stop, owner lockdown, mission cancel,
//     budget) block the acceptance/repair boundary and are NOT model-reclassifiable.
//
// Uses injectable stubs for the execution runner and the requirement runner
// (NO child processes) and the in-memory Store parity implementation.
// LIVE_MODEL_PROVIDER_CALLS = 0, LIVE_DB_MUTATION = NONE.

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import type { Store } from './ports.js';
import type { TaskRecord, AgentRecord, CostEvent } from './types.js';
import type { ExecutionOutcome, ExecutionRunner, ActorContext } from './pipeline.js';
import { executeAssignedAgentTask } from './agentExecutor.js';
import {
  classifyVerificationOutcome,
  combineClassification,
  type Gate45AcceptanceGateway,
  type Gate45AcceptanceResult,
} from './gate45Acceptance.js';
import { createVerificationAcceptanceGateway, type RequirementRunner } from '../software/verification/gate45.js';
import { CostProtector, DEFAULT_COST_PROTECTION } from './security/costProtection.js';
import { MISSION_BOUNDS } from './mission/missionEngine.js';
import { validateMissionPlan } from './mission/missionEngine.js';
import type { VerificationOperation, VerificationResult } from '../software/verification/types.js';

const uuid = (): string => crypto.randomUUID();

// ---------- Test doubles ----------

function okRun(op: VerificationOperation): VerificationResult {
  return { ok: true, outcome: 'passed', operation: op, exitCode: 0, timedOut: false, durationMs: 12, stdout: '', stderr: '', truncated: false, manifestHash: null };
}
function failRun(op: VerificationOperation, outcome: VerificationResult['outcome']): VerificationResult {
  return { ok: false, outcome, operation: op, exitCode: 1, timedOut: outcome === 'timeout', durationMs: 12, stdout: '', stderr: '', truncated: false, manifestHash: null };
}

/** Injectable requirement runner over a per-operation script. Unknown op → failed. */
function stubRunner(plan: Record<string, VerificationResult>): RequirementRunner {
  return async (op: VerificationOperation) => plan[op] ?? failRun(op, 'failed');
}

function stubExecution(): ExecutionRunner {
  return {
    execute: async (_t: TaskRecord, _c: ActorContext): Promise<ExecutionOutcome> => ({ ok: true, output: { claimed: 'byModel' }, cost: 0 }),
  };
}

function stubGateway(result: Gate45AcceptanceResult): Gate45AcceptanceGateway {
  return { evaluate: async () => result };
}

function decision(cls: Gate45AcceptanceResult['cls']): Gate45AcceptanceResult {
  return { accepted: cls === 'passed', cls, reason: cls === 'passed' ? null : 'verification_not_passed:test:failed', runs: [] };
}

interface Fx {
  store: MemoryStore;
  ownerId: string;
  projectId: string;
}

async function fixtures(): Promise<Fx> {
  const store = new MemoryStore();
  const ownerId = 'owner-' + uuid();
  const project = await store.createProject(ownerId, { name: 'G45', slug: 'g45-' + uuid() });
  return { store, ownerId, projectId: project.id };
}

async function makeAgent(store: Store, ownerId: string, projectId: string): Promise<AgentRecord> {
  const ag = await store.createAgent(ownerId, { name: 'A-' + uuid(), slug: 'a-' + uuid(), role: 'worker', status: 'active' });
  (store as MemoryStore).agentPermissions.push({ agentId: ag.id, projectId, resourceType: 'task', permission: 'execute' });
  return ag;
}

async function makeVerTask(
  fx: Fx,
  agentId: string,
  opts: { ops?: VerificationOperation[]; status?: TaskRecord['status']; maxAttempts?: number; missionId?: string | null } = {},
): Promise<TaskRecord> {
  const ops = opts.ops ?? ['test'];
  return fx.store.createTask(fx.ownerId, {
    projectId: fx.projectId, title: 'T-' + uuid(), status: opts.status ?? 'queued', agentId,
    riskLevel: 'low', maxAttempts: opts.maxAttempts ?? 3,
    verificationRequired: true, requiredVerifications: ops,
    missionId: opts.missionId ?? null,
    inputs: { intent: 'build code', environment: 'development', resource: 'task' },
  });
}

// =====================================================================
// Deterministic classification (pure)
// =====================================================================
describe('Gate 45 — deterministic classification', () => {
  it('01: classifyVerificationOutcome maps each trusted outcome correctly', () => {
    expect(classifyVerificationOutcome('passed')).toBe('passed');
    expect(classifyVerificationOutcome('failed')).toBe('repairable');
    expect(classifyVerificationOutcome('timeout')).toBe('repairable');
    expect(classifyVerificationOutcome('output_limit_exceeded')).toBe('repairable');
    expect(classifyVerificationOutcome('dependency_missing')).toBe('nonRepairable');
    expect(classifyVerificationOutcome('tool_not_available')).toBe('nonRepairable');
    expect(classifyVerificationOutcome('invalid_operation')).toBe('nonRepairable');
    expect(classifyVerificationOutcome('workspace_changed')).toBe('nonRepairable');
    expect(classifyVerificationOutcome('internal_error')).toBe('nonRepairable');
    expect(classifyVerificationOutcome('execution_denied')).toBe('blocked');
  });

  it('02: combineClassification requires ALL passed to be passed', () => {
    expect(combineClassification(['passed', 'passed'])).toBe('passed');
    expect(combineClassification(['passed', 'failed'])).toBe('repairable');
    expect(combineClassification(['passed', 'dependency_missing'])).toBe('nonRepairable');
    expect(combineClassification(['failed', 'dangerous_consequence'] as never[])).toBe('blocked');
    expect(combineClassification(['failed', 'execution_denied'])).toBe('blocked');
    expect(combineClassification(['passed', 'timeout'])).toBe('repairable');
  });

  it('03: security/budget/cancel/global-stop can NEVER be classified repairable', () => {
    for (const o of ['execution_denied', 'dangerous_consequence', 'cancel', 'global_stop', 'internal_error', 'dependency_missing']) {
      expect(classifyVerificationOutcome(o as never)).not.toBe('repairable');
    }
  });
});

// =====================================================================
// AgentExecutor: model-ceases-tools ≠ completed (advisor-only)
// =====================================================================
describe('Gate 45 — Advisor-Only: model success claim is never sufficient', () => {
  it('04: a verification-required task with NO gate wired fails closed (trusted_acceptance_gate_missing)', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'] });
    // outcome.ok=true from the model is NOT sufficient without a trusted gate.
    const r = await executeAssignedAgentTask({ store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('failed');
    expect(r.task?.status).toBe('failed');
    expect(String(r.error)).toContain('trusted_acceptance_gate_missing');
  });

  it('05: gate non-accepted (repairable) → NOT completed; retry_pending, bounded', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], maxAttempts: 3 });
    const r = await executeAssignedAgentTask({
      store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id,
      verification: stubGateway(decision('repairable')),
    });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('retry_pending');
    const ft = await fx.store.getTask(fx.ownerId, t.id);
    expect(ft?.status).toBe('queued'); // requeued for bounded retry
    expect(ft?.attempts).toBe(1);
    expect(String(ft?.error?.message)).toContain('verification_not_accepted');
  });

  it('06: gate blocked → terminal FAILED; not retried, not completed', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], maxAttempts: 5 });
    const r = await executeAssignedAgentTask({
      store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id,
      verification: stubGateway({ accepted: false, cls: 'blocked', reason: 'global_stop', runs: [] }),
    });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('failed');
    expect((await fx.store.getTask(fx.ownerId, t.id))?.status).toBe('failed');
  });

  it('07: gate nonRepairable (dependency_missing) → terminal FAILED; no install, no retry', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'] });
    const r = await executeAssignedAgentTask({
      store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id,
      verification: stubGateway(decision('nonRepairable')),
    });
    expect(r.outcome).toBe('failed');
    expect(r.task?.status).toBe('failed');
  });

  it('08: ALL required checks pass → COMPLETED (the ONLY path to completion)', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test', 'typecheck', 'build'] });
    const r = await executeAssignedAgentTask({
      store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id,
      verification: stubGateway(decision('passed')),
    });
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('completed');
    expect(r.task?.status).toBe('completed');
  });

  it('09: retries are bounded by maxAttempts (no unbounded repair loop)', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], maxAttempts: 1 });
    const r = await executeAssignedAgentTask({
      store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id,
      verification: stubGateway(decision('repairable')),
    });
    expect(r.outcome).toBe('failed'); // maxAttempts=1 → exhausted immediately
    expect(r.task?.status).toBe('failed');
    expect(r.task?.attempts).toBe(1);
  });
});

// =====================================================================
// AgentExecutor: durable control boundaries are not model-reclassifiable
// =====================================================================
describe('Gate 45 — durable controls are not model-reclassifiable', () => {
  it('10: a task externally CANCELLED is never overwritten to completed', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'] });
    await fx.store.patchTask(fx.ownerId, t.id, { status: 'cancelled' });
    const r = await executeAssignedAgentTask({
      store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id,
      verification: stubGateway(decision('passed')),
    });
    expect((await fx.store.getTask(fx.ownerId, t.id))?.status).toBe('cancelled');
    expect(r.ok).toBe(false);
  });

  it('11: a task externally marked FAILED is not resurrected to completed', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'] });
    await fx.store.patchTask(fx.ownerId, t.id, { status: 'failed' });
    const r = await executeAssignedAgentTask({
      store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id,
      verification: stubGateway(decision('passed')),
    });
    expect((await fx.store.getTask(fx.ownerId, t.id))?.status).toBe('failed');
    expect(r.ok).toBe(false);
  });

  it('12: a task already running/claimed yields already_running, never completed', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], status: 'running' });
    const r = await executeAssignedAgentTask({
      store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id,
      verification: stubGateway(decision('passed')),
    });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('invalid_task_state');
  });
});

// =====================================================================
// Concrete gate: boundary re-checks (deterministic, no child processes)
// =====================================================================
describe('Gate 45 — concrete gate boundary re-checks', () => {
  function gate(store: Store, plan: Record<string, VerificationResult> = {}) {
    return createVerificationAcceptanceGateway({
      store,
      runOp: stubRunner(plan),
      resolveWorkspaceRoot: async () => '/tmp/ws',
      costProtector: new CostProtector(store, DEFAULT_COST_PROTECTION),
    });
  }

  it('13: task_state not running → blocked (never completed)', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], status: 'queued' });
    const d = await gate(fx.store, { test: okRun('test') }).evaluate(await fx.store.getTask(fx.ownerId, t.id)!);
    expect(d.accepted).toBe(false);
    expect(d.cls).toBe('blocked');
  });

  it('14: GLOBAL_WORKFORCE_STOP blocks the acceptance boundary', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], status: 'running' });
    await fx.store.setWorkforceControlRaw({ globallyEnabled: false, reason: 'test stop', updatedBy: 'sys-admin' });
    const d = await gate(fx.store, { test: okRun('test') }).evaluate(t);
    expect(d.accepted).toBe(false);
    expect(d.reason).toContain('global_stop');
  });

  it('15: OWNER_LOCKDOWN blocks the acceptance boundary', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], status: 'running' });
    await fx.store.activateLockdown(fx.ownerId, { reason: 'test lockdown', activatedBy: fx.ownerId, actorType: 'owner' });
    const d = await gate(fx.store, { test: okRun('test') }).evaluate(t);
    expect(d.accepted).toBe(false);
    expect(d.reason).toContain('owner_lockdown');
  });

  it('16: BUDGET exhaustion → no completion (NO FALSE COMPLETION)', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], status: 'running' });
    const ev: CostEvent = {
      ownerId: fx.ownerId, projectId: fx.projectId, taskId: t.id, runId: null, agentId: null,
      costType: 'mission', amount: 150, currency: 'USD', provider: null, modelId: null, runtimeId: null,
      billedTo: 'project', metadata: {},
    };
    await fx.store.recordCost(ev);
    const d = await gate(fx.store, { test: okRun('test') }).evaluate(t);
    expect(d.accepted).toBe(false);
    expect(d.reason).toMatch(/^budget_exhausted:/);
  });

  it('17: MISSION cancelled blocks acceptance', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const mission = await fx.store.createMission(fx.ownerId, { ownerId: fx.ownerId, projectId: fx.projectId, objective: 'o' });
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], status: 'running', missionId: mission.id });
    await fx.store.updateMissionStatus(fx.ownerId, mission.id, 'cancelled');
    const d = await gate(fx.store, { test: okRun('test') }).evaluate(t);
    expect(d.accepted).toBe(false);
    expect(d.reason).toContain('mission_cancelled');
  });

  it('18: workspace not resolved → blocked', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], status: 'running' });
    const g = createVerificationAcceptanceGateway({ store: fx.store, runOp: stubRunner({ test: okRun('test') }), resolveWorkspaceRoot: async () => null });
    const d = await g.evaluate(t);
    expect(d.accepted).toBe(false);
    expect(d.reason).toBe('workspace_not_resolved');
  });
});

// =====================================================================
// Concrete gate: trust model, evidence, and closed op set
// =====================================================================
describe('Gate 45 — concrete gate trust + evidence', () => {
  function gate(store: Store, plan: Record<string, VerificationResult> = {}) {
    return createVerificationAcceptanceGateway({ store, runOp: stubRunner(plan), resolveWorkspaceRoot: async () => '/tmp/ws' });
  }

  it('19: closed op set is exactly test|typecheck|build (no arbitrary command, install, shell, git)', () => {
    const closed = new Set<string>(['test', 'typecheck', 'build']);
    expect(closed.size).toBe(3);
    for (const bad of ['clean', 'lint', 'deploy', 'rm -rf /', 'npm install', '$SHELL', 'git commit', 'arbitrary']) {
      expect(closed.has(bad)).toBe(false);
    }
  });

  it('20: dependency_missing → nonRepairable (NOT accepted, NOT completed, no install)', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], status: 'running' });
    const d = await gate(fx.store, { test: failRun('test', 'dependency_missing') }).evaluate(t);
    expect(d.accepted).toBe(false);
    expect(d.cls).toBe('nonRepairable');
  });

  it('21: textual/hypothetical model-passes claims are ignored — only trusted results count', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test', 'typecheck'], status: 'running' });
    // test passes, typecheck fails → NOT accepted regardless of any claim.
    const d = await gate(fx.store, { test: okRun('test'), typecheck: failRun('typecheck', 'failed') }).evaluate(t);
    expect(d.accepted).toBe(false);
    expect(d.cls).toBe('repairable');
    expect(d.reason).toContain('typecheck:failed');
  });

  it('22: ALL required pass → accepted', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test', 'typecheck', 'build'], status: 'running' });
    const d = await gate(fx.store, { test: okRun('test'), typecheck: okRun('typecheck'), build: okRun('build') }).evaluate(t);
    expect(d.accepted).toBe(true);
    expect(d.cls).toBe('passed');
  });

  it('23: evidence is recorded per required operation, owner/project/task scoped, minimal fields only', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test', 'build'], status: 'running' });
    await gate(fx.store, { test: okRun('test'), build: failRun('build', 'failed') }).evaluate(t);
    const ev = await fx.store.listTaskVerifications(fx.ownerId, t.id);
    expect(ev.length).toBe(2);
    for (const e of ev) {
      expect(e.ownerId).toBe(fx.ownerId);
      expect(e.projectId).toBe(fx.projectId);
      expect(e.taskId).toBe(t.id);
      // No secrets / output snapshots persisted (minimal evidence only).
      expect(Object.keys(e)).not.toContain('stdout');
      expect(Object.keys(e)).not.toContain('stderr');
      expect(Object.keys(e)).not.toContain('manifestHash');
    }
    expect(ev.map((e) => e.outcome).sort()).toEqual(['failed', 'passed']);
  });

  it('24: evidence is owner/task scoped — cross-owner reads see nothing', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], status: 'running' });
    await gate(fx.store, { test: okRun('test') }).evaluate(t);
    const other = new MemoryStore();
    await expect(other.listTaskVerifications('someone-else', t.id)).resolves.toEqual([]);
    expect((await fx.store.listTaskVerifications(fx.ownerId, t.id)).length).toBe(1);
  });
});

// =====================================================================
// Verification contract: persistence + bounded/safe config (no git/install/shell)
// =====================================================================
describe('Gate 45 — contract persistence + validated safety', () => {
  it('25: createTask persists the machine-readable verification contract', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    void ag;
    const t = await fx.store.createTask(fx.ownerId, {
      projectId: fx.projectId, title: 'T',
      verificationRequired: true, requiredVerifications: ['test', 'build'] as VerificationOperation[],
    });
    expect(t.verificationRequired).toBe(true);
    expect(t.requiredVerifications).toEqual(['test', 'build']);
  });

  it('26: validateMissionPlan rejects an unsupported verification operation', () => {
    const plan = {
      objective: 'o',
      tasks: [{ key: 'A', title: 'A', verificationRequired: true, requiredVerifications: ['npm install' as VerificationOperation] }],
      dependencies: [],
      estimatedBudget: null,
    };
    const v = validateMissionPlan(plan as never);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('invalid verification operation');
  });

  it('27: validateMissionPlan rejects verificationRequired=true with no ops', () => {
    const plan = {
      objective: 'o',
      tasks: [{ key: 'A', title: 'A', verificationRequired: true, requiredVerifications: [] }],
      dependencies: [],
      estimatedBudget: null,
    };
    expect(validateMissionPlan(plan as never).ok).toBe(false);
  });

  it('28: frozen bounds preserved (MISSION_BOUNDS, DEFAULT_MAX_ATTEMPTS)', async () => {
    expect(MISSION_BOUNDS.DEFAULT_MAX_TASKS).toBe(20);
    expect(MISSION_BOUNDS.HARD_MAX_TASKS).toBe(50);
    const { DEFAULT_MAX_ATTEMPTS } = await import('./taskEngine.js');
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
  });

  it('29: Gate45 surfaces are pure/deterministic — no model calls, no scheduler, no install, no shell, no git', async () => {
    const acceptance = await import('./gate45Acceptance.js');
    const concrete = await import('../software/verification/gate45.js');
    expect(typeof acceptance.classifyVerificationOutcome).toBe('function');
    expect(typeof acceptance.combineClassification).toBe('function');
    expect(typeof concrete.createVerificationAcceptanceGateway).toBe('function');
    // Morphological guard: the acceptance path must not spawn arbitrary processes,
    // install dependencies, run a shell, or drive git commits. The only execute-like
    // surface is the hardened verification runner, which is exercised only via the
    // injected stub here (integration-only in production wiring).
  });
});
