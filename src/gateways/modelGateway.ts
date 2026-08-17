// CHEF FACTORY — Gate 1 — ModelGateway.
// Model-agnostic selection: capability, reasoning, cost, policy.
// Uses the cheapest capable model; frontier reasoning only when justified.
// Provider choice is never part of business logic.

import type { ModelInfo, ModelSelection, ModelSelectionRequest } from '../core/types.js';
import type { ProviderAdapter } from './providerAdapter.js';

const REASONING_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };

export interface ModelGatewayConfig {
  preferCheapest?: boolean;
}

export class ModelGateway {
  constructor(
    private readonly adapters: Map<string, ProviderAdapter>,
    private readonly config: ModelGatewayConfig = { preferCheapest: true },
  ) {}

  providers(): string[] {
    return [...this.adapters.keys()];
  }

  adapterFor(provider: string): ProviderAdapter | null {
    return this.adapters.get(provider) ?? null;
  }

  // Deterministic selection — cheapest capable model first.
  select(models: ModelInfo[], request: ModelSelectionRequest): ModelSelection {
    const active = models.filter((m) => m.status === 'active');
    const needed = REASONING_RANK[request.neededReasoning] ?? 0;

    const candidates = active
      .filter((m) => {
        const cap = m.capability as { reasoning?: string; tools?: boolean };
        const reasoning = REASONING_RANK[cap.reasoning ?? 'none'] ?? 0;
        if (reasoning < needed) return false;
        if (request.neededTools && cap.tools !== true) return false;
        if (request.minContextWindow !== null && request.minContextWindow !== undefined) {
          if (m.contextWindow === null || m.contextWindow < request.minContextWindow) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ca = a.costPer1kInput + a.costPer1kOutput;
        const cb = b.costPer1kInput + b.costPer1kOutput;
        if (ca !== cb) return ca - cb;
        return a.name.localeCompare(b.name);
      });

    if (candidates.length === 0) {
      return {
        model: null,
        reason: `No active model satisfies requirements (reasoning>=${request.neededReasoning}, tools=${request.neededTools}). Nothing was invented.`,
        cheapestCapable: false,
        candidates: [],
      };
    }

    const selected = this.config.preferCheapest ? candidates[0]! : candidates[candidates.length - 1]!;
    const isFrontierOnly = candidates.every(
      (c) => (c.capability as { reasoning?: string }).reasoning === 'high',
    );

    return {
      model: selected,
      reason: isFrontierOnly
        ? `Only frontier-reasoning models satisfy the requirement; using cheapest capable: ${selected.provider}/${selected.name}.`
        : `Cheapest capable model selected: ${selected.provider}/${selected.name}.`,
      cheapestCapable: selected.id === candidates[0]!.id,
      candidates,
    };
  }
}
