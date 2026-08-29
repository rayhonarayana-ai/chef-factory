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
  /** Deterministic signal per provider AND optionally per model. Providers/models
   *  with no durable telemetry are NEUTRAL (available, cold-start policy). The
   *  router is READ-ONLY here; it never writes telemetry. */
  signal(provider: string, modelId?: string): ProviderHealthSignal;
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

    // ─── Canonical Gate 43 routing order (frozen contract) ───────────────────
    //  1. mandatory capability floor            → meetsFloor(...) applies FIRST to
    //                                              ALL registered models.
    //  2. security/high-impact quality floor    → the same combined mandatory floor
    //                                              (reasoning/tools/context/coding/
    //                                              multimodal/structuredOutput) is an
    //                                              ABSOLUTE gate — never relaxed for
    //                                              health or cost.
    //  3. registry status / enabled             → status !== 'retired'.
    // The capability+quality floor (steps 1-2) is a hard, health-independent gate:
    // HEALTH_CAN_OVERRIDE_CAPABILITY_FLOOR = NO, HEALTH_CAN_OVERRIDE_QUALITY_FLOOR = NO.
    const capable = models.filter((m) => meetsFloor(m, req)); // steps 1 & 2

    if (capable.length === 0) {
      // Fail closed: nothing capable of the mandatory floor.
      return {
        outcome: 'no_capable_model',
        selection: {
          model: null,
          reason: `No registered model satisfies the mandatory capability/quality floor (${reqSummary}). Nothing was invented and no credits were spent.`,
          cheapestCapable: false,
          candidates: [],
        },
        rationale: rationaleBase({
          capableCount: 0,
          rejectionReason: 'no_capable_model',
        }),
      };
    }

    // ─── Canonical Gate 43 routing order (frozen contract), continued ────────
    //  1. mandatory capability floor            → meetsFloor(...)
    //  2. security/high-impact quality floor    → same combined mandatory floor
    //  3. registry status / enabled             → status !== 'retired'
    //  4. budget eligibility                    → affordable filter (BEFORE health)
    //  5. hard health exclusion                 → explicit unavailable/open excluded
    //  6. adaptive health/latency ranking       → rankCandidates (availability first)
    //  7. cost ranking                          → cost within availability class
    //  8. deterministic tie-break               → stable identity (name)
    //  9. bounded fallback                      → fallbackChain (maxFallbacks)
    //
    // HEALTH_CAN_OVERRIDE_CAPABILITY_FLOOR = NO
    // HEALTH_CAN_OVERRIDE_QUALITY_FLOOR = NO
    // Budget eligibility precedes health exclusion/ranking: a candidate that cannot
    // be afforded is dropped before health is consulted, and a capable/affordable
    // candidate can never be dropped due to a cheaper-but-incapable one.
    const qualified = capable.filter((m) => m.status !== 'retired'); // steps 3 (registry)

    // Step 4: budget eligibility — BEFORE hard health exclusion.
    const affordable = qualified.filter((m) =>
      this.runtime.budget ? this.runtime.budget.costOfCandidate(costOfModel(m)) : true,
    );

    if (affordable.length === 0) {
      return {
        outcome: 'budget_exhausted',
        selection: {
          model: null,
          reason: `No capable model fits the remaining budget. Failing CLOSED rather than downgrading required capability.`,
          cheapestCapable: false,
          candidates: qualified,
        },
        rationale: rationaleBase({
          capableCount: capable.length,
          excludedUnavailable: 0,
          rejectionReason: 'budget_exhausted',
        }),
      };
    }

    // Step 5: hard health exclusion. Signal per affordable model (provider+modelId);
    // computed once for exclusion AND adaptive ranking. Only an EXPLICIT unavailable
    // (open circuit / 'unavailable') is excluded; 'degraded' candidates remain
    // ELIGIBLE (DEGRADED vs UNAVAILABLE — a degraded capable candidate still beats a
    // healthy incapable one because the incapable model never cleared the floor).
    // Cold-start/insufficient telemetry is NEUTRAL => available.
    const signalByModel = new Map<string, ProviderHealthSignal>();
    for (const m of affordable) {
      signalByModel.set(m.id, this.runtime.health.signal(m.provider, m.id));
    }
    const available = affordable.filter((m) => {
      const signal = signalByModel.get(m.id);
      return signal ? signal.available !== false : true;
    });
    const excludedUnavailable = affordable.length - available.length;

    if (available.length === 0) {
      return {
        outcome: 'no_capable_model',
        selection: {
          model: null,
          reason: `Capable, affordable models exist but all matched providers/models are currently unavailable. Nothing was invented and no credits were spent.`,
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

    // Steps 6-8: adaptive ranking. latencySensitive=true = availability class ->
    // latency bucket -> cost -> stable identity. latencySensitive=false = availability
    // class -> cost -> stable identity (latency bucket is NEVER a ranking dimension
    // when latencySensitive is false). AVAILABLE always outranks DEGRADED regardless
    // of price. Step 9 (bounded fallback) via fallbackChain below.
    const ranked = rankCandidates(available, this.runtime.preferCheapest, signalByModel, req.latencySensitive === true);

    // Capable + affordable + available, ranked deterministically. First = primary.
    const primary = ranked[0]!;
    const fallbackChain = ranked.slice(1, 1 + this.runtime.maxFallbacks);

    return {
      outcome: 'selected',
      selection: {
        model: primary,
        reason: `Capable, affordable model selected: ${primary.provider}/${primary.name}.`,
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
        selectedAvailability: signalByModel.get(primary.id)?.availability ?? null,
        selectedLatencyBucket: signalByModel.get(primary.id)?.latencyBucket ?? null,
        selectedObservationCount: signalByModel.get(primary.id)?.observationCount ?? null,
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

function availabilityRank(signal: ProviderHealthSignal | undefined): number {
  const av = signal?.availability ?? 'unknown';
  // 'available' and 'unknown' (cold start/insufficient) are treated as NEUTRAL and
  // equal — a cold-start candidate is never artificially superior. 'degraded' ranks
  // after healthy; 'unavailable' would already have been excluded above.
  return av === 'available' || av === 'unknown' ? 0 : av === 'degraded' ? 1 : 2;
}

function latencyBucketRank(signal: ProviderHealthSignal | undefined): number {
  const b = signal?.latencyBucket ?? 'unknown';
  switch (b) {
    case 'low': return 0;
    case 'unknown': return 1; // neutral between low and medium
    case 'medium': return 2;
    default: return 3; // 'high'
  }
}

function rankCandidates(
  models: ModelInfo[],
  preferCheapest: boolean,
  signalByModel: Map<string, ProviderHealthSignal>,
  latencySensitive: boolean,
): ModelInfo[] {
  // Canonical adaptive ranking. AVAILABLE always precedes DEGRADED in BOTH modes —
  // a cheaper degraded candidate can never beat a more expensive AVAILABLE one.
  // latencySensitive=true also uses the latency bucket as a ranking dimension;
  // latencySensitive=false NEVER uses the latency bucket (cost breaks availability
  // ties instead). Deterministic identity (name) is always the final tie-break.
  const sortFn = latencySensitive
    ? (a: ModelInfo, b: ModelInfo): number => {
        const byAv = availabilityRank(signalByModel.get(a.id)) - availabilityRank(signalByModel.get(b.id));
        if (byAv !== 0) return byAv;
        const byBucket = latencyBucketRank(signalByModel.get(a.id)) - latencyBucketRank(signalByModel.get(b.id));
        if (byBucket !== 0) return byBucket;
        const byCost = costOfModel(a) - costOfModel(b);
        if (byCost !== 0) return byCost;
        return a.name.localeCompare(b.name);
      }
    : (a: ModelInfo, b: ModelInfo): number => {
        const byAv = availabilityRank(signalByModel.get(a.id)) - availabilityRank(signalByModel.get(b.id));
        if (byAv !== 0) return byAv;
        const byCost = costOfModel(a) - costOfModel(b);
        if (byCost !== 0) return byCost;
        return a.name.localeCompare(b.name);
      };
  const sorted = [...models].sort(sortFn);
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
