// CHEF FACTORY — Gate 1 — Explanation Layer.
// Significant actions must expose Decision, Why, Evidence, Confidence, Risk.
// "Done." alone is never a complete explanation.

import type { AutonomyLevel, Explanation, RiskLevel } from './types.js';

export interface ExplanationInput {
  decision: string;
  why: string;
  evidence?: string[];
  confidence?: number | null;
  risk: RiskLevel;
  outcome?: string;
}

export function buildExplanation(input: ExplanationInput): Explanation {
  return {
    decision: input.decision,
    why: input.why,
    evidence: input.evidence ?? [],
    confidence: input.confidence ?? null,
    risk: input.risk,
    outcome: input.outcome ?? 'pending',
  };
}

export function isCompleteExplanation(e: Explanation): boolean {
  return (
    e.decision.trim().length > 0 &&
    e.why.trim().length > 0 &&
    e.decision.trim().toLowerCase() !== 'done.'
  );
}

export function autonomyLabel(a: AutonomyLevel): string {
  switch (a) {
    case 'auto':
      return 'Executed automatically (AUTO)';
    case 'notify':
      return 'Executed with notification (NOTIFY)';
    case 'require_approval':
      return 'Awaiting owner approval (REQUIRE_APPROVAL)';
    case 'deny':
      return 'Denied (DENY)';
  }
}
