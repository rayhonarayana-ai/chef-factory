// CHEF FACTORY — Gate 39 — Mission Planner (PROPOSAL_ONLY boundary).
//
// The planner is the ONLY place mission plans enter the engine. Its LLM role is
// strictly PROPOSAL_ONLY: an LLM MAY propose a MissionPlanCanonical; the engine
// never trusts it. Every proposal is (a) deterministically validated against the
// frozen bounds + security reject rules, (b) canonicalized, and (c) bound to a
// canonical SHA-256 hash. A proposal that fails validation is never persisted and
// never materializes. This module is deterministic and free of any agent selection,
// permission grant, assignment, or direct tool/execution path.

import type { MissionPlanCanonical, MissionValidationResult } from '../types.js';
import { hashMissionPlan, validateMissionPlan, canonicalizePlan } from './missionEngine.js';

export interface PlannerResult {
  ok: boolean;
  plan: MissionPlanCanonical | null;
  hash: string | null;
  validation: MissionValidationResult;
}

/**
 * Standardize, validate, and hash a proposed plan under the given bounds.
 * Deterministic. If `validationFailureRecording` is supplied by the caller, the
 * caller is responsible for emitting the mission.plan.validation_failed audit
 * event (with NON-secret error summaries only).
 */
export function prepareMissionPlan(
  proposal: MissionPlanCanonical,
  opts: { maxTasks?: number; maxEdges?: number } = {},
): PlannerResult {
  const plan = canonicalizePlan(proposal);
  const validation = validateMissionPlan(plan, opts);
  if (!validation.ok) {
    return { ok: false, plan: null, hash: null, validation };
  }
  const hash = hashMissionPlan(plan);
  return { ok: true, plan, hash, validation };
}

// Re-export for the engine / tests.
export { canonicalizePlan, hashMissionPlan, validateMissionPlan };
