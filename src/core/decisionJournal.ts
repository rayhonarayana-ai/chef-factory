// CHEF FACTORY — Gate 1 — Decision Journal (deterministic core).
// Records decisions per Master Reference §18 structure.

import type { DecisionRecord, JsonObject } from './types.js';

export interface NewDecisionInput {
  ownerId: string;
  projectId?: string | null;
  context: string;
  options: string[];
  selectedOption?: string | null;
  reason?: string | null;
  evidence?: string[];
  confidence?: number | null;
  riskLevel?: DecisionRecord['riskLevel'];
  authorityLevel?: DecisionRecord['authorityLevel'];
  approvedBy?: string | null;
  outcome?: string | null;
}

export function validateDecision(input: NewDecisionInput): string | null {
  if (!input.context.trim()) return 'decision context is required';
  if (!Array.isArray(input.options) || input.options.length === 0) return 'decision options are required';
  if (input.options.length < 2 && !input.selectedOption) return 'at least two options are required to decide';
  if (input.confidence !== null && input.confidence !== undefined) {
    if (input.confidence < 0 || input.confidence > 1) return 'confidence must be between 0 and 1';
  }
  if (input.selectedOption && !input.options.includes(input.selectedOption)) {
    return 'selected_option must be one of the considered options';
  }
  return null;
}

export function toDecisionRecord(input: NewDecisionInput): DecisionRecord {
  return {
    decisionId: '',
    ownerId: input.ownerId,
    projectId: input.projectId ?? null,
    context: input.context,
    options: input.options,
    selectedOption: input.selectedOption ?? null,
    reason: input.reason ?? null,
    evidence: input.evidence ?? [],
    confidence: input.confidence ?? null,
    riskLevel: input.riskLevel ?? null,
    authorityLevel: input.authorityLevel ?? null,
    approvedBy: input.approvedBy ?? null,
    outcome: input.outcome ?? null,
    createdAt: new Date().toISOString(),
  };
}

// Deterministic JSON digest of a decision (for ids/hash-free audit correlation).
export function decisionDigest(d: DecisionRecord): JsonObject {
  return {
    context: d.context,
    selected: d.selectedOption,
    confidence: d.confidence,
    risk: d.riskLevel,
  };
}
