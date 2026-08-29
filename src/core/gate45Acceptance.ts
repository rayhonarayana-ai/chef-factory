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
}

/** The injected trusted gate. evaluate() must be deterministic and bounded. */
export interface Gate45AcceptanceGateway {
  evaluate(task: TaskRecord): Promise<Gate45AcceptanceResult>;
}

// ---------- Deterministic classification ----------
// The model must NEVER reclassify security denial / budget / cancel / global-stop as
// repairable. This table is the ONLY classifier (MOdel cannot influence it).

/** Non-repairable checkpoint outcomes — a bounded retry cannot fix them. */
const NON_REPAIRABLE: ReadonlySet<VerificationOutcome> = new Set<VerificationOutcome>([
  'dependency_missing', // excluded: DEPENDENCY_INSTALLATION_EXCLUDED, env condition
  'tool_not_available',
  'invalid_operation', // config error, not code repair
  'workspace_changed', // concurrency guard — post-hoc workspace changed, not model-fixable
  'internal_error', // infrastructure failure
]);

/** Repairable verification outcomes — the model may edit and re-verify on a bounded retry. */
const REPAIRABLE: ReadonlySet<VerificationOutcome> = new Set<VerificationOutcome>([
  'failed',
  'timeout',
  'output_limit_exceeded',
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
