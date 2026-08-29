// CHEF FACTORY — Gate 45 — Trusted Software Task Completion acceptance gate
// (concrete implementation).
//
// This is the server-side deterministic gate that decides whether a
// verification-required task may transition to COMPLETED. It lives in the software
// verification module because it composes the hardened verification runner and
// workspace resolution. It is injected into AgentExecutor through the composition
// root as a `Gate45AcceptanceGateway`.
//
// Conservative design:
//   - Runs EACH required operation through the SAME hardened runner/profile
//     architecture as the agent-facing run_verification tool (shell=false, trusted
//     executable/args/cwd, env allowlist, timeout, bounded/redacted output).
//   - Ignores the model's textual claim entirely (MODEL_DECLARES_SUCCESS = ADVISORY).
//   - Records minimal trusted evidence per operation (task_verifications).
//   - Re-checks durable controls at the acceptance/repair boundary:
//       GLOBAL_WORKFORCE_STOP, OWNER_LOCKDOWN, TASK_CURRENT_STATUS (cancelled never
//       overwritten to completed), MISSION_CURRENT_STATUS, BUDGET eligibility.
//   - Classifies failures deterministically; the model can never reclassify
//     security/budget/cancel/global-stop as repairable.
//   - Bounded: no unbounded recursion — one evaluation per invocation; retries are
//     delegated back to the existing cross-attempt TaskEngine retry path.
//
// LIVE_MODEL_PROVIDER_CALLS = 0 (Gate45 itself never calls a model provider).

import type { Store } from '../../core/ports.js';
import type { TaskRecord } from '../../core/types.js';
import type {
  Gate45AcceptanceGateway,
  Gate45AcceptanceResult,
  Gate45RunOutcome,
  CompletionWorkspaceGuard,
} from '../../core/gate45Acceptance.js';
import { combineClassification } from '../../core/gate45Acceptance.js';
import { CostProtector, DEFAULT_COST_PROTECTION } from '../../core/security/costProtection.js';
import { isGlobalStopActive } from '../../core/security/workforceControl.js';
import { buildVerificationProfiles, validateProfile } from './registry.js';
import { runVerification } from './runner.js';
import type { VerificationOperation, VerificationResult } from './types.js';
import { resolveWorkspaceRoot as resolvePassportWorkspaceRoot } from '../../workspace/resolver.js';
import { fingerprintWorkspace, type FingerprintResult } from '../../workspace/integrity.js';
import { withRepoLock } from '../../workspace/mutation.js';
import { getPool } from '../../db/pool.js';
import { newSessionId } from './session.js';
import type { Pool } from 'pg';
import type { DbQuery } from '../../tools/types.js';

/** A single required-operation runner. Injectable for tests; default uses the real runner. */
export type RequirementRunner = (
  operation: VerificationOperation,
  workspaceRoot: string,
) => Promise<VerificationResult>;

/** Trusted workspace fingerprinter. Injectable for tests; default uses the real hasher. */
export type Fingerprinter = (workspaceRoot: string) => Promise<FingerprintResult>;

/** Prepare the trusted runner for a workspace. */
export function makeRequirementRunner(workspaceRoot: string, filter?: string): RequirementRunner {
  const profiles = buildVerificationProfiles(workspaceRoot);
  return async (operation, wsRoot) => {
    const profile = profiles.get(operation);
    if (!profile) {
      return {
        ok: false, outcome: 'invalid_operation', operation, exitCode: null, timedOut: false,
        durationMs: 0, stdout: '', stderr: '', truncated: false, manifestHash: null,
      };
    }
    const validation = validateProfile(profile);
    if (!validation.ok) {
      return {
        ok: false, outcome: 'dependency_missing', operation, exitCode: null, timedOut: false,
        durationMs: 0, stdout: '', stderr: '', truncated: false, manifestHash: null,
      };
    }
    return runVerification({ profile, workspaceRoot: wsRoot, filter });
  };
}

export interface VerificationAcceptanceDeps {
  store: Store;
  /** Resolve the workspace root from a task. Default uses the passport. May be overridden in tests. */
  resolveWorkspaceRoot?: (task: TaskRecord) => Promise<string | null>;
  /** Optional injectable runner (tests use a stub; production uses the real hardened runner). */
  runOp?: RequirementRunner;
  /**
   * Gate 46 — trusted workspace fingerprinter. Default uses the real
   * WorkspaceIntegrityService (src/workspace/integrity.ts). Tests inject a stub to
   * simulate unchanged / changed workspaces without real filesystem walks.
   */
  fingerprint?: Fingerprinter;
  /** Owner/project hard budget. Reuses the existing CostProtector (no second accounting system). */
  costProtector?: CostProtector;
}

const workspaceNotResolved = (operation: VerificationOperation): VerificationResult => ({
  ok: false, outcome: 'internal_error', operation, exitCode: null, timedOut: false,
  durationMs: 0, stdout: '', stderr: '', truncated: false, manifestHash: null,
});

/**
 * Resolve the workspace root from the task's project passport (the same trusted
 * source the run_verification tool uses). Returns null when unresolvable.
 */
export async function defaultResolveWorkspaceRoot(store: Store, task: TaskRecord): Promise<string | null> {
  if (!task.projectId) return null;
  const passport = await store.getPassport(task.ownerId, task.projectId);
  if (!passport) return null;
  const raw = resolvePassportWorkspaceRoot((passport.repository as Record<string, unknown> | undefined) ?? null);
  if (!raw) return null;
  const { realpathSync } = await import('node:fs');
  try {
    return realpathSync(raw);
  } catch {
    return null;
  }
}

export function createVerificationAcceptanceGateway(deps: VerificationAcceptanceDeps): Gate45AcceptanceGateway {
  const {
    store,
    runOp,
    fingerprint = fingerprintWorkspace,
    costProtector = new CostProtector(store, DEFAULT_COST_PROTECTION),
    resolveWorkspaceRoot = (task) => defaultResolveWorkspaceRoot(store, task),
  } = deps;

  return {
    async evaluate(task: TaskRecord): Promise<Gate45AcceptanceResult> {
      const required = task.requiredVerifications ?? [];
      const runs: Gate45RunOutcome[] = [];

      // 0. Not required → trivially passed (AgentExecutor still only calls the gate for
      //    verification-required tasks, but be safe).
      if (!task.verificationRequired || required.length === 0) {
        return { accepted: true, cls: 'passed', reason: null, runs };
      }

      // 1. Boundary re-check: CANCELLED_TASK_CAN_BE_OVERWRITTEN_COMPLETED = NO.
      try {
        const current = await store.getTask(task.ownerId, task.id);
        if (!current) {
          return { accepted: false, cls: 'blocked', reason: 'task_not_found', runs };
        }
        if (current.status !== 'running') {
          return {
            accepted: false, cls: 'blocked',
            reason: `task_state_changed:${current.status}`,
            runs,
          };
        }
      } catch (e) {
        return { accepted: false, cls: 'blocked', reason: `task_read_failed:${String(e)}`, runs };
      }

      // 2. Boundary: GLOBAL_WORKFORCE_STOP prevents a new repair/acceptance boundary.
      try {
        const control = await store.getWorkforceControl();
        if (isGlobalStopActive(control)) {
          return { accepted: false, cls: 'blocked', reason: 'global_stop', runs };
        }
      } catch (e) {
        return { accepted: false, cls: 'blocked', reason: `global_control_read_failed:${String(e)}`, runs };
      }

      // 3. Boundary: OWNER_LOCKDOWN prevents a new repair/acceptance boundary.
      try {
        const lockdown = await store.activeLockdown(task.ownerId);
        if (lockdown) {
          return { accepted: false, cls: 'blocked', reason: 'owner_lockdown', runs };
        }
      } catch (e) {
        return { accepted: false, cls: 'blocked', reason: `lockdown_read_failed:${String(e)}`, runs };
      }

      // 4. Boundary: MISSION_CURRENT_STATUS. A terminal/cancelled mission must not let
      //    a blocked task be completed. The task itself remains non-completed; the
      //    mission reconciliation handles terminal status post-hoc.
      if (task.missionId) {
        try {
          const mission = await store.getMission(task.ownerId, task.missionId);
          if (mission && (mission.status === 'cancelled')) {
            return { accepted: false, cls: 'blocked', reason: 'mission_cancelled', runs };
          }
        } catch {
          // Indeterminate mission read — do NOT complete; fail closed for this gate.
          return { accepted: false, cls: 'blocked', reason: 'mission_unreadable', runs };
        }
      }

      // 5. Boundary: BUDGET — BUDGET_EXHAUSTED → NO NEW ACCEPTANCE/REPAIR and NO
      //    FALSE COMPLETION. Reuses the existing CostProtector (no second accounting).
      try {
        const costDecision = await costProtector.check(task.ownerId, task.projectId ?? null);
        if (costDecision.stopped) {
          return { accepted: false, cls: 'blocked', reason: `budget_exhausted:${costDecision.reason ?? ''}`, runs };
        }
      } catch (e) {
        // Fail closed on budget indeterminacy — never complete without budget clarity.
        return { accepted: false, cls: 'blocked', reason: `budget_check_failed:${String(e)}`, runs };
      }

      // 6. Resolve workspace from the trusted passport (never from model/agent args).
      let workspaceRoot: string | null;
      try {
        workspaceRoot = await resolveWorkspaceRoot(task);
      } catch {
        workspaceRoot = null;
      }
      if (!workspaceRoot) {
        return { accepted: false, cls: 'blocked', reason: 'workspace_not_resolved', runs };
      }

      // 7. Gate 46 — start a trusted verification session. The session ID is
      //    generated by trusted infrastructure (MODEL/AGENT_CAN_SUPPLY_SESSION_ID=NO).
      const sessionId = newSessionId();
      const taskAttempt = task.attempts + 1;

      // 8. Compute FINGERPRINT_BEFORE over the trusted source set. If we cannot
      //    establish a stable baseline fingerprint, we cannot bind verification to
      //    workspace state -> FAIL CLOSED (blocked), never accept.
      let before: Awaited<ReturnType<Fingerprinter>>;
      try {
        before = await fingerprint(workspaceRoot);
      } catch (e) {
        return {
          accepted: false, cls: 'blocked', reason: `workspace_fingerprint_error:${String(e)}`, runs,
          workspaceChanged: false, workspaceFingerprint: null,
        };
      }
      if (!before.ok) {
        return {
          accepted: false, cls: 'blocked',
          reason: `workspace_fingerprint_unavailable:${before.reason}`, runs,
          workspaceChanged: false, workspaceFingerprint: null,
        };
      }

      // 9. Run each required operation through the trusted runner.
      const runner = runOp ?? makeRequirementRunner(workspaceRoot);
      for (const op of required) {
        let result: VerificationResult;
        try {
          result = await runner(op, workspaceRoot);
        } catch (e) {
          result = { ...workspaceNotResolved(op), outcome: 'internal_error', stdout: String(e).slice(0, 200) };
        }
        // Gate 46 — populate manifestHash with the trusted workspace fingerprint
        // (manifestHash == workspace fingerprint semantics; overrides the historical
        // always-null default).
        result.manifestHash = before.value.fingerprint;
        runs.push({
          operation: op,
          outcome: result.outcome,
          ok: result.ok,
          exitCode: result.exitCode,
          durationMs: result.durationMs ?? null,
        });
        // 9a. Persist minimal trusted evidence (best-effort; never blocks the
        //     acceptance decision, but failure is surfaced via warn). The session id
        //     and fingerprint bind this row to the trusted session. AUDIT-ONLY.
        try {
          await store.recordTaskVerification(task.ownerId, {
            projectId: task.projectId,
            taskId: task.id,
            runId: null,
            attempt: taskAttempt,
            operation: op,
            outcome: result.outcome,
            exitCode: result.exitCode,
            durationMs: result.durationMs ?? null,
            verificationSessionId: sessionId,
            workspaceFingerprint: before.value.fingerprint,
          });
        } catch (e) {
          // Do not fabricate evidence; record the write failure so it is observable.
          console.warn(`[Gate45] verification evidence write failed for task ${task.id}: ${e}`);
        }
      }

      // 10. Compute FINGERPRINT_AFTER and compare (TOCTOU detection over the whole
      //     verification window).
      let after: Awaited<ReturnType<Fingerprinter>>;
      try {
        after = await fingerprint(workspaceRoot);
      } catch (e) {
        after = { ok: false, reason: 'read_error', detail: String(e) };
      }

      // 11. Deterministic decision — WORKSPACE_CHANGED dominates: verification pass
      //     + workspace changed = NO COMPLETION. Classification is repairable so the
      //     existing bounded cross-attempt TaskEngine retry re-runs verification.
      const workspaceChanged = !after.ok || after.value.fingerprint !== before.value.fingerprint;
      if (workspaceChanged) {
        return {
          accepted: false, cls: 'repairable', reason: 'workspace_changed', runs,
          workspaceChanged: true, workspaceFingerprint: null,
        };
      }

      // 12. All required checks must pass; the model cannot override a non-passing
      //     outcome.
      const cls = combineClassification(runs.map((r) => r.outcome));
      if (cls === 'passed') {
        return {
          accepted: true, cls, reason: null, runs,
          workspaceChanged: false, workspaceFingerprint: before.value.fingerprint,
        };
      }
      const failedRuns = runs.filter((r) => r.outcome !== 'passed').map((r) => `${r.operation}:${r.outcome}`).join(',');
      return {
        accepted: false, cls, reason: `verification_not_passed:${failedRuns}`, runs,
        workspaceChanged: false, workspaceFingerprint: null,
      };
    },
  };
}

export interface CompletionWorkspaceGuardDeps {
  store: Store;
  /** Resolve the workspace root from a task (default uses the passport). */
  resolveWorkspaceRoot?: (task: TaskRecord) => Promise<string | null>;
  /** Trusted fingerprinter (default uses the real integrity service). */
  fingerprint?: Fingerprinter;
  /** Shared advisory-lock provider; injectable only for deterministic tests. */
  coordinationDb?: Pool | DbQuery;
}

/**
 * Gate 46 — create the completion-boundary workspace coordinator that closes the
 * FINAL post-hash → completion TOCTOU interval. It re-resolves and re-hashes under
 * the shared workspace advisory lock, then persists completion through the supplied
 * callback before releasing that lock. All CHEF source mutations use this same lock.
 *
 * GIT-INDEPENDENT (uses the deterministic protected-aware walk, not git).
 */
export function createCompletionWorkspaceGuard(
  deps: CompletionWorkspaceGuardDeps,
): CompletionWorkspaceGuard {
  const { store, fingerprint = fingerprintWorkspace, coordinationDb = getPool() } = deps;
  const resolveRoot = deps.resolveWorkspaceRoot ?? ((task) => defaultResolveWorkspaceRoot(store, task));

  return {
    async withStableWorkspace<T>(
      task: TaskRecord,
      expectedFingerprint: string,
      onStable: () => Promise<T>,
    ): Promise<{ stable: true; value: T } | { stable: false }> {
      let workspaceRoot: string | null;
      try {
        workspaceRoot = await resolveRoot(task);
      } catch {
        return { stable: false };
      }
      if (!workspaceRoot) return { stable: false };

      return withRepoLock(coordinationDb, workspaceRoot, async () => {
        let fp;
        try {
          fp = await fingerprint(workspaceRoot!);
        } catch {
          return { stable: false };
        }
        if (!fp.ok || fp.value.fingerprint !== expectedFingerprint) return { stable: false };
        return { stable: true, value: await onStable() };
      });
    },
  };
}
