// CHEF FACTORY — Gate 45 — Trusted Software Task Completion acceptance contract.
//
// This module is the PURE interface boundary for the deterministic acceptance gate.
// It lives in core (no runtime dependency on software) so AgentExecutor and tests can
// depend on it without coupling to concrete verification execution. The CONCRETE
// trusted implementation (workspace resolution + hardened runner + evidence) lives in
// `src/software/verification/gate45.js` and is injected through the composition root.
//
// Principle (frozen): MODEL_DECLARES_SUCCESS = ADVISORY_ONLY. outcome.ok alone MUST
// NOT transition a verification-required task to COMPLETED. Only the configured
// deterministic trusted gate may authorize completion (all required checks passed).

import type { TaskRecord } from './types.js';
import type { VerificationOperation, VerificationOutcome } from '../software/verification/types.js';

/** Deterministic failure classification for the acceptance gate. */
export type Gate45VerificationClass = 'passed' | 'repairable' | 'nonRepairable' | 'blocked';

/** One required verification operation result observed by the trusted gate. */
export interface Gate45RunOutcome {
  operation: VerificationOperation;
  outcome: VerificationOutcome;
  ok: boolean;
  exitCode: number | null;
  durationMs: number | null;
}

/** Deterministic decision of the acceptance gate. */
export interface Gate45AcceptanceResult {
  /** True only when ALL required checks passed (task may transition COMPLETED). */
  accepted: boolean;
  cls: Gate45VerificationClass;
  /** Human/machine-readable non-secret reason. */
  reason: string | null;
  runs: Gate45RunOutcome[];
  /**
   * Gate 46 — true when FINGERPRINT_BEFORE != FINGERPRINT_AFTER (the workspace
   * changed during verification). When true, accepted=false and cls='repairable'.
   * WORKSPACE_CHANGED → REVERIFY_REQUIRED via the existing bounded retry.
   */
  workspaceChanged?: boolean;
  /**
   * Gate 46 — the trusted workspace fingerprint of the verified (post) state when the
   * gate accepted. AgentExecutor re-validates this at the completion boundary to
   * close the final post-hash → completion TOCTOU interval. null when unavailable.
   */
  workspaceFingerprint?: string | null;
}

/** The injected trusted gate. evaluate() must be deterministic and bounded. */
export interface Gate45AcceptanceGateway {
  evaluate(task: TaskRecord): Promise<Gate45AcceptanceResult>;
}

/** Result of a final workspace coordination section. */
export type CompletionWorkspaceGuardResult<T> =
  | { stable: true; value: T }
  | { stable: false };

/**
 * Gate 46 — final workspace coordination section. It acquires the shared workspace
 * lock, computes the final fingerprint under that lock, and invokes `onStable`
 * before releasing it. Therefore the task completion write is atomic relative to
 * every CHEF-controlled source mutation participating in the same lock.
 */
export interface CompletionWorkspaceGuard {
  withStableWorkspace<T>(
    task: TaskRecord,
    expectedFingerprint: string,
    onStable: () => Promise<T>,
  ): Promise<CompletionWorkspaceGuardResult<T>>;
}

// ---------- Deterministic classification ----------
// The model must NEVER reclassify security denial / budget / cancel / global-stop as
// repairable. This table is the ONLY classifier (MOdel cannot influence it).

/** Non-repairable checkpoint outcomes — a bounded retry cannot fix them. */
const NON_REPAIRABLE: ReadonlySet<VerificationOutcome> = new Set<VerificationOutcome>([
  'dependency_missing', // excluded: DEPENDENCY_INSTALLATION_EXCLUDED, env condition
  'tool_not_available',
  'invalid_operation', // config error, not code repair
  'internal_error', // infrastructure failure
]);

/** Repairable verification outcomes — the model may edit and re-verify on a bounded retry.
 *
 * Gate 46: `workspace_changed` moved here from NON_REPAIRABLE. Under Gate 46 the
 * trusted acceptance gate produces a REAL `workspace_changed` only when the
 * deterministic fingerprint changed during verification (FINGERPRINT_BEFORE !=
 * FINGERPRINT_AFTER). That is a REPAIRABLE condition: the model may edit/restore the
 * workspace and re-verify on the existing bounded cross-attempt TaskEngine retry.
 * Security/budget/cancel/global-stop/denial remain BLOCKED and are never repairable.
 */
const REPAIRABLE: ReadonlySet<VerificationOutcome> = new Set<VerificationOutcome>([
  'failed',
  'timeout',
  'output_limit_exceeded',
  'workspace_changed',
]);

/**
 * Classify a verification outcome. `execution_denied` and any outcome outside the
 * trusted set are BLOCKED (fail closed) — the model never overrides them.
 */
export function classifyVerificationOutcome(outcome: VerificationOutcome): 'passed' | 'repairable' | 'nonRepairable' | 'blocked' {
  if (outcome === 'passed') return 'passed';
  if (REPAIRABLE.has(outcome)) return 'repairable';
  if (NON_REPAIRABLE.has(outcome)) return 'nonRepairable';
  // execution_denied and anything else — fail closed as BLOCKED (never repairable).
  return 'blocked';
}

/**
 * Combine the classification of all required operations:
 *   passed        : every required operation passed
 *   repairable    : at least one repairable failure and no blocked/nonRepairable
 *   nonRepairable : at least one non-repairable failure and no blocked
 *   blocked       : at least one blocked outcome
 */
export function combineClassification(outcomes: VerificationOutcome[]): Gate45VerificationClass {
  let sawRepairable = false;
  let sawNonRepairable = false;
  for (const o of outcomes) {
    const c = classifyVerificationOutcome(o);
    if (c === 'blocked') return 'blocked';
    if (c === 'repairable') sawRepairable = true;
    if (c === 'nonRepairable') sawNonRepairable = true;
  }
  if (sawNonRepairable) return 'nonRepairable';
  if (sawRepairable) return 'repairable';
  return 'passed';
}
