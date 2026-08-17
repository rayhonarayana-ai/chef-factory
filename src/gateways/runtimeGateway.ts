// CHEF FACTORY — Gate 1 — Runtime Adapter contract + RuntimeGateway.
// Runtime-agnostic. OpenCode/OpenCode Zen is allowed as an adapter only;
// it is NOT the Factory brain. Future runtimes addable without redesign.

import type { RuntimeInfo, RuntimeSelection } from '../core/types.js';

export interface RuntimeExecutionRequest {
  runtime: RuntimeInfo;
  command: string;
  projectPath?: string | null;
  environment: string;
  timeoutMs?: number;
}

export interface RuntimeExecutionResult {
  runtime: string;
  ok: boolean;
  output: string;
  error: string | null;
  durationMs: number;
  estimatedCost: number;
}

export interface RuntimeAdapter {
  readonly runtimeName: string;
  available(): boolean;
  execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult>;
}

export interface EnvironmentGuardResult {
  allowed: boolean;
  reason?: string;
}

export class RuntimeGateway {
  constructor(
    private readonly adapters: Map<string, RuntimeAdapter>,
    private readonly environmentGuard?: (request: RuntimeExecutionRequest) => EnvironmentGuardResult | Promise<EnvironmentGuardResult>,
  ) {}

  adaptersAvailable(): string[] {
    return [...this.adapters.values()].filter((a) => a.available()).map((a) => a.runtimeName);
  }

  adapterFor(slug: string): RuntimeAdapter | null {
    return this.adapters.get(slug) ?? null;
  }

  /** Gate 2 — environment/scope guard (optional; may only be more restrictive).
   *  When present, execution is refused unless the guard allows it. */
  async guardExecution(request: RuntimeExecutionRequest): Promise<EnvironmentGuardResult> {
    if (!this.environmentGuard) return { allowed: true };
    return this.environmentGuard(request);
  }

  // Deterministic selection — cheapest capable runtime first.
  select(runtimes: RuntimeInfo[], requirement: string): RuntimeSelection {
    const active = runtimes.filter((r) => r.status === 'active');
    const candidates = [...active].sort((a, b) => {
      if (a.costPerHour !== b.costPerHour) return a.costPerHour - b.costPerHour;
      return a.name.localeCompare(b.name);
    });
    if (candidates.length === 0) {
      return {
        runtime: null,
        reason: `No active runtime available for requirement "${requirement}". Nothing was invented.`,
        cheapestCapable: false,
        candidates: [],
      };
    }
    const selected = candidates[0]!;
    return {
      runtime: selected,
      reason: `Cheapest capable runtime selected: ${selected.name}${selected.version ? `@${selected.version}` : ''}.`,
      cheapestCapable: true,
      candidates,
    };
  }
}
