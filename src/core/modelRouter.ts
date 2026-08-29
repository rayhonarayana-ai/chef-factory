// CHEF FACTORY — Gate 42 — Canonical Model Router (core, provider-neutral).
//
// ModelRouter is a COMPUTE SUITABILITY component. It selects a capable, cost-
// aware candidate from the OWNER'S registered model catalog. It NEVER grants
// authority, NEVER grants permission, NEVER approves, and NEVER bypasses
// security or budget authority (CostProtector). It performs ZERO LLM calls and
// ZERO baseline network calls.
//
// The single canonical routing algorithm after Gate 42 lives here. ModelGateway
// executes the already-selected provider/model; it must NOT duplicate the
// selection policy. Provider/model identity is treated as DATA — no provider/
// model name appears in policy. NEW_PROVIDER_REQUIRES_ROUTER_CORE_EDIT = NO and
// NEW_MODEL_REQUIRES_ROUTER_CORE_EDIT = NO: a new provider/model works purely
// through its registered metadata in the owner's model catalog.
//
// INVARIANTS:
//   QUALITY_FLOOR_BEFORE_COST = TRUE
//   FRONTIER_NEVER_DOWNGRADED_FOR_COST = TRUE
//   FAIL_CLOSED_BELOW_CAPABILITY_FLOOR = TRUE
//   ROUTER_LLM_CALLS = 0
//   ROUTING_NETWORK_CALLS_BASELINE = 0
//   MODEL_SELECTION_GRANTS_AUTHORITY = NO
//   MODEL_SELECTION_GRANTS_PERMISSION = NO
//   MODEL_SELECTION_CAN_APPROVE = NO
//   MODEL_SELECTION_CAN_BYPASS_SECURITY = NO

import type {
  ModelCapability,
  ModelInfo,
  ModelRoutingRequirements,
  ModelRoutingResult,
  ProviderHealthSignal,
  RoutingBudget,
  SafeRoutingRationale,
} from './types.js';

export const ROUTER_POLICY_VERSION = 'gate42.1';

const REASONING_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };
const CODING_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };

export interface RouterHealthSource {
  /** Deterministic availability per provider. Providers with no data are available
   *  (cold-start behavior is explicit: default available). */
  signal(provider: string): ProviderHealthSignal;
}

/** Default cold-start health source: no health data => all providers available. */
export const UNAVAILABLE_HEALTH: RouterHealthSource = {
  signal: () => ({ provider: '', available: true }),
};

export interface RouterRuntime {
  maxFallbacks: number; // bounded fallback chain (beyond candidate #1)
  preferCheapest: boolean;
  health: RouterHealthSource;
  budget: RoutingBudget | null;
}

export const DEFAULT_ROUTER_RUNTIME: RouterRuntime = {
  maxFallbacks: 2, // candidate #1 + up to 2 fallbacks; bounded by retry architecture
  preferCheapest: true,
  health: UNAVAILABLE_HEALTH,
  budget: null,
};

export function costOfModel(m: ModelInfo): number {
  return m.costPer1kInput + m.costPer1kOutput;
}

export function capOf(m: ModelInfo): ModelCapability {
  return (m.capability as ModelCapability) ?? {};
}

function reasoningRank(v: 'none' | 'low' | 'medium' | 'high' | undefined): number {
  return REASONING_RANK[v ?? 'none'] ?? 0;
}

function codingRank(v: 'none' | 'low' | 'medium' | 'high' | undefined): number {
  return CODING_RANK[v ?? 'none'] ?? 0;
}

/**
 * Single canonical routing algorithm. Deterministic, fail-closed, provider-neutral.
 *
 * 1. Filter by registry status (active/limited semantics — retired excluded).
 * 2. Enforce mandatory capability FLOORS BEFORE ranking (QUALITY_FLOOR_BEFORE_COST).
 * 3. Exclude/deprioritize unavailable providers (health-aware).
 * 4. Apply budget (never weaken floors to fit budget — fail CLOSED).
 * 5. Rank capable candidates deterministically by cost, then name.
 */
export class ModelRouter {
  private readonly runtime: RouterRuntime;

  constructor(runtime: Partial<RouterRuntime> = {}) {
    this.runtime = { ...DEFAULT_ROUTER_RUNTIME, ...runtime };
  }

  route(
    models: ModelInfo[],
    req: ModelRoutingRequirements,
  ): ModelRoutingResult {
    const reqSummary = buildRequirementSummary(req);
    const rationaleBase = (over: Partial<SafeRoutingRationale>): SafeRoutingRationale => ({
      policyVersion: ROUTER_POLICY_VERSION,
      candidateCount: models.length,
      capableCount: 0,
      excludedUnavailable: 0,
      requirementSummary: reqSummary,
      selectedProvider: null,
      selectedModel: null,
      estimatedCost: null,
      fallbackIndex: 0,
      rejectionReason: null,
      ...over,
    });

    // 1. Filter by registry status. Retired models can never be used. 'limited'
    //    models are eligible under the same stack but are ranked after 'active'
    //    as a deterministic tie-break (limited = reduced confidence in capacity).
    const nonRetired = models.filter((m) => m.status !== 'retired');

    // 2. Capability floors BEFORE cost.
    const capable = nonRetired.filter((m) => meetsFloor(m, req));

    if (capable.length === 0) {
      // Fail closed: nothing capable of the mandatory floor.
      return {
        outcome: 'no_capable_model',
        selection: {
          model: null,
          reason: `No registered model satisfies the mandatory capability floor (${reqSummary}). Nothing was invented and no credits were spent.`,
          cheapestCapable: false,
          candidates: [],
        },
        rationale: rationaleBase({
          capableCount: 0,
          rejectionReason: 'no_capable_model',
        }),
      };
    }

    // 3. Health-aware exclusion (deterministic; no network call).
    const healthByProvider = new Map<string, boolean>();
    for (const m of capable) healthByProvider.set(m.provider, true);
    const available = capable.filter((m) => {
      const signal = this.runtime.health.signal(m.provider);
      if (signal.available === false) {
        healthByProvider.set(m.provider, false);
        return false;
      }
      healthByProvider.set(m.provider, true);
      return true;
    });
    const excludedUnavailable = capable.length - available.length;

    if (available.length === 0) {
      return {
        outcome: 'no_capable_model',
        selection: {
          model: null,
          reason: `Capable models exist but all matched providers are currently unavailable. Nothing was invented and no credits were spent.`,
          cheapestCapable: false,
          candidates: [],
        },
        rationale: rationaleBase({
          capableCount: capable.length,
          excludedUnavailable,
          rejectionReason: 'all_unavailable',
        }),
      };
    }

    // 4. Budget-awareness: deterministically select among candidates we can afford.
    //    If NO capable candidate fits the remaining budget => fail CLOSED. We never
    //    drop below the capability floor to fit a budget (COST vs BUDGET separation).
    const ranked = rankCandidates(available, this.runtime.preferCheapest);
    const affordable = ranked.filter((m) =>
      this.runtime.budget ? this.runtime.budget.costOfCandidate(costOfModel(m)) : true,
    );

    if (affordable.length === 0) {
      return {
        outcome: 'budget_exhausted',
        selection: {
          model: null,
          reason: `No capable model fits the remaining budget. Failing CLOSED rather than downgrading required capability.`,
          cheapestCapable: false,
          candidates: ranked,
        },
        rationale: rationaleBase({
          capableCount: capable.length,
          excludedUnavailable,
          rejectionReason: 'budget_exhausted',
        }),
      };
    }

    // Capable + affordable, ranked deterministically. First = primary.
    const primary = affordable[0]!;
    const fallbackChain = affordable.slice(1, 1 + this.runtime.maxFallbacks);

    return {
      outcome: 'selected',
      selection: {
        model: primary,
        reason: `Cheapest capable model selected: ${primary.provider}/${primary.name}.`,
        cheapestCapable: primary.id === ranked[0]!.id,
        candidates: [primary, ...fallbackChain],
      },
      rationale: rationaleBase({
        capableCount: capable.length,
        excludedUnavailable,
        selectedProvider: primary.provider,
        selectedModel: primary.name,
        estimatedCost: costOfModel(primary),
        fallbackIndex: 0,
      }),
    };
  }

  /** Bounded, deterministic failover: pick the next capable candidate after `skip` ids. */
  fallback(
    result: ModelRoutingResult,
    unavailableIds: ReadonlySet<string>,
  ): ModelRoutingResult {
    if (result.outcome !== 'selected') return result;
    const ranked = result.selection.candidates;
    const next = ranked.find((m) => !unavailableIds.has(m.id));
    if (!next) {
      return {
        outcome: 'no_capable_model',
        selection: {
          model: null,
          reason: 'All ranked capable candidates are unavailable. Nothing was invented and no credits were spent.',
          cheapestCapable: false,
          candidates: ranked,
        },
        rationale: {
          ...result.rationale,
          selectedProvider: null,
          selectedModel: null,
          estimatedCost: null,
          fallbackIndex: result.rationale.fallbackIndex + 1,
          rejectionReason: 'all_unavailable',
        },
      };
    }
    return {
      outcome: 'selected',
      selection: {
        model: next,
        reason: `Fallback to next capable candidate: ${next.provider}/${next.name}.`,
        cheapestCapable: false,
        candidates: ranked,
      },
      rationale: {
        ...result.rationale,
        selectedProvider: next.provider,
        selectedModel: next.name,
        estimatedCost: costOfModel(next),
        fallbackIndex: result.rationale.fallbackIndex + 1,
        rejectionReason: null,
      },
    };
  }
}

/** Mandatory capability floors, enforced BEFORE ranking/cost. */
function meetsFloor(m: ModelInfo, req: ModelRoutingRequirements): boolean {
  const cap = capOf(m);

  // Reasoning floor. Never negotiable downward for cost.
  if (reasoningRank(cap.reasoning) < (REASONING_RANK[req.neededReasoning] ?? 0)) return false;

  // Tools floor.
  if (req.neededTools && cap.tools !== true) return false;

  // Context window floor.
  if (req.minContextWindow !== null && req.minContextWindow !== undefined) {
    if (m.contextWindow === null || m.contextWindow < req.minContextWindow) return false;
  }

  // Optional floors from SpecialistModelNeeds (only enforced when the caller sets
  // them; mandatory floors never weaken for cost).
  if (req.mandatory || req.neededCodingStrength !== undefined) {
    if (req.neededCodingStrength) {
      if (codingRank(cap.codingStrength) < (CODING_RANK[req.neededCodingStrength ?? 'none'] ?? 0)) return false;
    }
  }
  if (req.neededMultimodal === true && cap.multimodal !== true) return false;
  if (req.neededStructuredOutput === true && cap.structuredOutput !== true) return false;

  // Optional hard cost ceiling (never a downgrade of capability — a ceiling only).
  if (req.maxCostPerCall !== null && req.maxCostPerCall !== undefined) {
    if (costOfModel(m) > req.maxCostPerCall) return false;
  }

  return true;
}

function rankCandidates(models: ModelInfo[], preferCheapest: boolean): ModelInfo[] {
  const sorted = [...models].sort((a, b) => {
    const ca = costOfModel(a);
    const cb = costOfModel(b);
    if (ca !== cb) return ca - cb;
    // deterministic tie-break by name (provider-neutral)
    return a.name.localeCompare(b.name);
  });
  // 'limited' models rank after a same-cost 'active' candidate deterministically.
  sorted.sort((a, b) => {
    if (costOfModel(a) === costOfModel(b)) {
      const statusA = a.status === 'limited' ? 1 : 0;
      const statusB = b.status === 'limited' ? 1 : 0;
      if (statusA !== statusB) return statusA - statusB;
    }
    return 0;
  });
  return preferCheapest ? sorted : sorted.reverse();
}

function buildRequirementSummary(req: ModelRoutingRequirements): string {
  const parts = [`reasoning>=${req.neededReasoning}`];
  if (req.neededTools) parts.push('tools=true');
  if (req.minContextWindow !== null && req.minContextWindow !== undefined) {
    parts.push(`context>=${req.minContextWindow}`);
  }
  if (req.neededCodingStrength) parts.push(`coding>=${req.neededCodingStrength}`);
  if (req.neededMultimodal === true) parts.push('multimodal=true');
  if (req.neededStructuredOutput === true) parts.push('structuredOutput=true');
  if (req.maxCostPerCall !== null && req.maxCostPerCall !== undefined) parts.push(`maxCost<=${req.maxCostPerCall}`);
  return parts.join(', ');
}
