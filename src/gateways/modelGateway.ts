// CHEF FACTORY — Gate 1 → Gate 42 — ModelGateway.
// Execution gateway: it now EXECUTES the already-selected provider/model and
// preserves the provider-neutral execution abstraction. Selection policy is the
// SOLE responsibility of the canonical ModelRouter (src/core/modelRouter.ts) —
// the gateway delegates to it and must NOT duplicate the selection algorithm.
//
// Compatibility: select() is retained as a thin delegating wrapper so existing
// call sites and tests keep working while the ONE canonical routing algorithm
// lives in ModelRouter.
//
// INVARIANTS:
//   CANONICAL_ROUTING_ALGORITHM_LOCATION = src/core/modelRouter.ts
//   QUALITY_FLOOR_BEFORE_COST = TRUE
//   ROUTER_LLM_CALLS = 0
//   ROUTING_NETWORK_CALLS_BASELINE = 0
//   MODEL_SELECTION_GRANTS_AUTHORITY = NO

import type { ModelCircuitState, ModelInfo, ModelSelection, ModelSelectionRequest } from '../core/types.js';
import { ModelRouter, type RouterHealthSource, type RouterRuntime } from '../core/modelRouter.js';
import type { ProviderAdapter } from './providerAdapter.js';
import type { ResilientAdapter } from './resilience.js';

export interface ModelGatewayConfig {
  preferCheapest?: boolean;
}

export class ModelGateway {
  private readonly router: ModelRouter;

  constructor(
    private readonly adapters: Map<string, ProviderAdapter>,
    private readonly config: ModelGatewayConfig = { preferCheapest: true },
    routerOrRuntime?: ModelRouter | RouterRuntime,
  ) {
    // Health awareness: surfaced from the adapters map if available (resilient
    // adapters expose getHealth()); cold-start/no-health-data => available.
    const health: RouterHealthSource = {
      signal: (provider: string, modelId?: string): { provider: string; modelId?: string; available: boolean; circuitState: ModelCircuitState } => {
        const circuit = this.circuitStateFor(provider);
        return { provider, modelId, available: circuit.available, circuitState: circuit.circuitState };
      },
    };
    this.router =
      routerOrRuntime instanceof ModelRouter
        ? routerOrRuntime
        : new ModelRouter(routerOrRuntime === undefined ? undefined : { ...routerOrRuntime, health });
  }

  providers(): string[] {
    return [...this.adapters.keys()];
  }

  adapterFor(provider: string): ProviderAdapter | null {
    return this.adapters.get(provider) ?? null;
  }

  /** Router-level health source (used by execution fallback). Returns the live,
   *  provider-wide circuit state (truthfully provider-scoped) plus availability.
   *  Durable per-model telemetry is combined by the execution-level health source. */
  healthFor(provider: string): { provider: string; available: boolean; circuitState: ModelCircuitState } {
    return this.circuitStateFor(provider);
  }

  private circuitStateFor(provider: string): { provider: string; available: boolean; circuitState: ModelCircuitState } {
    const a = this.adapters.get(provider);
    if (a && typeof (a as ResilientAdapter).getHealth === 'function') {
      const h = (a as ResilientAdapter).getHealth();
      const circuit = h.circuitState;
      return { provider, available: circuit !== 'open', circuitState: circuit };
    }
    return { provider, available: true, circuitState: 'unknown' };
  }

  // Compatibility wrapper — delegates to the canonical ModelRouter. No selection
  // policy logic lives here.
  select(models: ModelInfo[], request: ModelSelectionRequest): ModelSelection {
    const result = this.router.route(models, {
      requirement: request.requirement,
      neededReasoning: request.neededReasoning,
      neededTools: request.neededTools,
      minContextWindow: request.minContextWindow,
      mandatory: false,
      maxCostPerCall: null,
    });
    return result.selection;
  }
}
