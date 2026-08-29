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

import type { ModelInfo, ModelSelection, ModelSelectionRequest } from '../core/types.js';
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
      signal: (provider: string): { provider: string; available: boolean } => {
        const a = this.adapters.get(provider);
        if (a && typeof (a as ResilientAdapter).getHealth === 'function') {
          const h = (a as ResilientAdapter).getHealth();
          return { provider, available: h.circuitState !== 'open' };
        }
        return { provider, available: true };
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

  /** Router-level health source (used by execution fallback). */
  healthFor(provider: string): { provider: string; available: boolean } {
    const a = this.adapters.get(provider);
    if (a && typeof (a as ResilientAdapter).getHealth === 'function') {
      const h = (a as ResilientAdapter).getHealth();
      return { provider, available: h.circuitState !== 'open' };
    }
    return { provider, available: true };
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
