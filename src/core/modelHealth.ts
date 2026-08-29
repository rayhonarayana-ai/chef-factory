// CHEF FACTORY — Gate 43 — Model/Provider Health Telemetry Core (provider-neutral).
//
// Provides the deterministic aggregation and policy that turn bounded SYSTEM-OBSERVED
// execution facts (ModelHealthObservation) into a shared, restart-safe health snapshot
// (ModelHealthSnapshot) for the Gate 42 ModelRouter. This module is PURE and
// deterministic: no I/O, no LLM, no live provider probes, no secrets, no prompts.
//
// INVARIANTS:
//   NO_OPAQUE_HEALTH_SCORE = TRUE      (explicit deterministic signals only)
//   NO_TELEMETRY_POLICY = NEUTRAL       (cold start is 'unknown'/'available', not unhealthy)
//   PROVIDER_NEUTRAL = TRUE
//   NEW_PROVIDER_REQUIRES_HEALTH_POLICY_EDIT = NO
//   NEW_MODEL_REQUIRES_HEALTH_POLICY_EDIT = NO
//   HEALTH_CAN_GRANT_AUTHORITY = NO
//   HEALTH_CAN_OVERRIDE_CAPABILITY_FLOOR = NO
//   HEALTH_ROUTING_LLM_CALLS = 0
//   ROUTING_TIME_PROVIDER_PROBES = 0
//
// WHAT_COUNTS_AS_ONE_OBSERVATION:
//   ONE observation == ONE completed logical model call at the trusted execution
//   boundary (a single adapter.complete() invocation at execution/model level).
//   Transport retry attempts WITHIN one logical call (the resilient adapter's bounded
//   retries, timeouts, backoff) are collapsed into exactly ONE observation whose
//   outcome is the terminal result of the logical call. This prevents a retried call
//   from appearing as several independent model health observations.
//
// RECENT_WINDOW = last 20 completed logical observations (bounded, deterministic).
// MIN_OBSERVATIONS_FOR_DEGRADATION = 5  (<5 observations => 'unknown', never degraded).
// FAILURE_DEGRADE_RATIO = 0.50          (recentFailureRatio >= 0.50 => degraded).
// TIMEOUT_DEGRADE_RATIO = 0.40          (recentTimeoutRatio >= 0.40 => degraded).
// LATENCY_BUCKETS (provider-neutral, ms): low <2000, medium <8000, high <20000, else high.
// Provider-wide circuit state is preserved TRUTHFULLY as provider-wide from the live
// resilient breaker (see RouterHealthSource wiring); it is never faked per-model.

import type {
  LatencyBucket,
  ModelAvailability,
  ModelCircuitState,
  ModelHealthObservation,
  ModelHealthOutcome,
  ModelHealthPolicy,
  ModelHealthSnapshot,
  ProviderHealthSignal,
} from './types.js';

/** Conservative, documented, provider-NEUTRAL health policy defaults. */
export const DEFAULT_HEALTH_POLICY: ModelHealthPolicy = {
  recentWindow: 20,
  minObservations: 5,
  failureDegradeRatio: 0.5,
  timeoutDegradeRatio: 0.4,
  latencyLowMs: 2000,
  latencyMediumMs: 8000,
  latencyHighMs: 20000,
};

/** Deterministic ordering key useful for a bounded "last N" window. */
function timeKey(o: ModelHealthObservation): number {
  const t = o.observedAt ? Date.parse(o.observedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Map a representative (median) latency to a provider-neutral bucket. */
export function latencyToBucket(latencyMs: number | null, policy: ModelHealthPolicy): LatencyBucket {
  if (latencyMs === null || !Number.isFinite(latencyMs) || latencyMs < 0) return 'unknown';
  if (latencyMs < policy.latencyLowMs) return 'low';
  if (latencyMs < policy.latencyMediumMs) return 'medium';
  if (latencyMs <= policy.latencyHighMs) return 'high';
  return 'high';
}

/**
 * Deterministically aggregate the bounded recent window into a health snapshot.
 * Pure & sync. Neither writes nor contacts providers.
 */
export function aggregateModelHealth(
  observations: readonly ModelHealthObservation[],
  policy: ModelHealthPolicy = DEFAULT_HEALTH_POLICY,
  provider: string,
  modelId: string,
): ModelHealthSnapshot {
  // Sort newest first, respecting the bounded recent window for a stable "last N".
  const sorted = [...observations].sort((a, b) => timeKey(b) - timeKey(a));
  const recent = sorted.slice(0, Math.max(0, policy.recentWindow));

  const successCount = recent.filter((o) => o.outcome === 'success').length;
  const failureCount = recent.filter((o) => o.outcome === 'failure').length;
  const timeoutCount = recent.filter((o) => o.outcome === 'timeout').length;

  const observationCount = recent.length;
  const sufficient = observationCount >= policy.minObservations;

  const recentFailureRatio = observationCount > 0 ? failureCount / observationCount : null;
  const recentTimeoutRatio = observationCount > 0 ? timeoutCount / observationCount : null;

  // Latency representative = median of positive latencies in the window.
  const latencies = recent.map((o) => o.latencyMs).filter((n) => Number.isFinite(n) && n >= 0);
  const latencyBucket = latencies.length > 0 ? latencyToBucket(median(latencies), policy) : 'unknown';

  // Availability classification (conservative, deterministic, provider-neutral):
  let availability: ModelAvailability;
  if (observationCount === 0) {
    availability = 'unknown'; // cold start => NEUTRAL (not unhealthy)
  } else if (!sufficient) {
    availability = 'unknown'; // insufficient observations => not yet classified
  } else if (recentFailureRatio !== null && recentFailureRatio >= policy.failureDegradeRatio) {
    availability = 'degraded';
  } else if (recentTimeoutRatio !== null && recentTimeoutRatio >= policy.timeoutDegradeRatio) {
    availability = 'degraded';
  } else {
    availability = 'available';
  }

  const find = (pred: (o: ModelHealthObservation) => boolean): string | null | undefined => {
    for (const o of sorted) if (pred(o)) return o.observedAt ?? undefined;
    return undefined;
  };

  return {
    provider,
    modelId,
    observationCount,
    recentSuccessCount: successCount,
    recentFailureCount: failureCount,
    recentTimeoutCount: timeoutCount,
    recentFailureRatio,
    recentTimeoutRatio,
    latencyBucket,
    circuitState: 'unknown', // per-model durable telemetry has no provider-wide breaker info
    availability,
    lastSuccessAt: find((o) => o.outcome === 'success') ?? null,
    lastFailureAt: find((o) => o.outcome === 'failure' || o.outcome === 'timeout') ?? null,
    updatedAt: recent[0]?.observedAt ?? null,
  };
}

/**
 * Deterministic availability classification for a provider/model: an OPEN provider
 * circuit makes a candidate UNAVAILABLE (provider-wide truth); otherwise the model's
 * aggregate availability applies. 'unknown' (cold start / insufficient) => AVAILABLE
 * (neutral) so a new candidate stays eligible, never artificially superior.
 */
export function classifyAvailability(
  aggregateAvailability: ModelAvailability,
  liveCircuitState: ModelCircuitState,
): ModelAvailability {
  if (liveCircuitState === 'open') return 'unavailable';
  if (liveCircuitState === 'half_open') {
    // Half-open probe: allow, but degrade confidence conservatively.
    return aggregateAvailability === 'unavailable' ? 'unavailable' : 'degraded';
  }
  return aggregateAvailability;
}

/**
 * Combine a durable model snapshot with the live provider-wide circuit into the
 * RouterHealthSource signal the Gate 42 router consumes. PURE/sync, no I/O.
 */
export function buildProviderHealthSignal(
  snapshot: ModelHealthSnapshot | undefined,
  liveCircuitState: ModelCircuitState,
): ProviderHealthSignal {
  const provider = snapshot?.provider ?? '';
  const modelId = snapshot?.modelId;
  if (!snapshot || snapshot.observationCount === 0) {
    const open = liveCircuitState === 'open';
    return {
      provider,
      modelId,
      available: !open,
      availability: open ? 'unavailable' : 'unknown',
      latencyBucket: 'unknown',
      observationCount: 0,
      circuitState: liveCircuitState,
      recentFailureRatio: null,
      recentTimeoutRatio: null,
    };
  }
  const availability = classifyAvailability(snapshot.availability, liveCircuitState);
  const open = liveCircuitState === 'open';
  return {
    provider,
    modelId,
    available: availability !== 'unavailable' && !open,
    availability,
    latencyBucket: snapshot.latencyBucket,
    observationCount: snapshot.observationCount,
    circuitState: liveCircuitState === 'unknown' ? snapshot.circuitState : liveCircuitState,
    recentFailureRatio: snapshot.recentFailureRatio,
    recentTimeoutRatio: snapshot.recentTimeoutRatio,
  };
}

/** Deterministic outcome for a logical model call given its terminal error. */
export function classifyModelCallOutcome(error: unknown, aborted: boolean): ModelHealthOutcome {
  if (aborted) return 'timeout';
  const msg = error instanceof Error ? error.message : String(error);
  const low = msg.toLowerCase();
  const timedOut =
    low.includes('timed out') ||
    low.includes('timeout') ||
    low.includes('etimedout') ||
    low.includes('timed out after');
  return timedOut ? 'timeout' : 'failure';
}
