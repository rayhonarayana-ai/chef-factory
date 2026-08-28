// CHEF FACTORY — Gate 40 — Specialist Profile types.
//
// A SpecialistProfile is SUITABILITY metadata only. It NEVER grants authority,
// NEVER carries a permission grant, NEVER elevates autonomy, and NEVER selects
// or delegates agents. It is a reusable, provider-neutral role definition from
// which ordinary AgentRecords may be materialized through the existing
// createAgent primitive and consumed by the existing selector/authority/executor.
//
// INVARIANTS:
//   SPECIALIZATION_GRANTS_AUTHORITY = NO
//   PROFILE_GRANTS_PERMISSION = NO
//   ROLE_GRANTS_PERMISSION = NO
//   SUITABILITY_NEVER_GRANTS_AUTHORITY = TRUE
//   PROFILE_CONTAINS_AGENT_ID = NO
//   PROFILE_HARDCODES_MODEL_PROVIDER = NO

// Reasoning levels align with ModelSelectionRequest.neededReasoning so a profile
// can express provider-neutral model needs without naming any provider/model.
export type SpecialistReasoning = 'none' | 'low' | 'medium' | 'high';

/** Provider-neutral model needs a specialist declares. Fed to the existing
 *  ModelGateway (cheapest-capable selection). Never names a provider or model. */
export interface SpecialistModelNeeds {
  reasoning: SpecialistReasoning;
  codingStrength: 'none' | 'low' | 'medium' | 'high';
  tools: boolean;
  minContextWindow: number | null;
  latencySensitive: boolean;
  costSensitive: boolean;
  multimodal: boolean;
  structuredOutput: boolean;
}

/** Broad product families for organizing profiles. NOT a permission class. */
export type SpecialistFamily =
  | 'leadership'
  | 'research'
  | 'design'
  | 'engineering'
  | 'quality'
  | 'security'
  | 'operations'
  | 'documentation'
  | 'commercial';

/**
 * A reusable specialist/role definition. SUITABILITY metadata only.
 * defaultCapabilities drive exact-match eligibility in the existing selector;
 * toolEligibility is informational (actual authority comes solely from the
 * agent_permissions table); systemPromptProfile is the role body injected on
 * TOP of the invariant guardrail prompt during agent execution.
 */
export interface SpecialistProfile {
  slug: string;
  family: SpecialistFamily;
  name: string;
  /** Canonical role value written to AgentRecord.role when materialized. */
  role: string;
  description: string;
  /** Canonical capability tokens -> suitability. Never authority. */
  defaultCapabilities: string[];
  defaultMaxConcurrentTasks: number;
  /** Role-specific system-prompt body (language, focus, quality orientation). */
  systemPromptProfile: string;
  /** Informational only. Real access is granted via agent_permissions. */
  toolEligibility: string[];
  qualityCriteria: string[];
  /** Shape hint for the persisted task.output contract. */
  outputContract: string | null;
  modelNeeds: SpecialistModelNeeds;
}
