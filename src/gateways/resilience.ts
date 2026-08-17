// CHEF FACTORY — Gate 10 — Provider Resilience Layer.
// Wraps any ProviderAdapter with bounded retry, exponential backoff,
// per-attempt timeout, circuit breaker, and health tracking.
// Provider retry retries the MODEL REQUEST only — it never directly
// executes ToolBroker tools or invokes tool handlers.

import type { ProviderAdapter, ProviderRequest, ProviderResponse } from './providerAdapter.js';

// ─── Configuration ────────────────────────────────────────────────

export interface ResilienceConfig {
  maxRetries: number;
  requestTimeoutMs: number;
  maxBackoffMs: number;
  initialBackoffMs: number;
  circuitFailureThreshold: number;
  circuitOpenDurationMs: number;
}

export const DEFAULT_RESILIENCE_CONFIG: ResilienceConfig = {
  maxRetries: 3,
  requestTimeoutMs: 30_000,
  maxBackoffMs: 10_000,
  initialBackoffMs: 1_000,
  circuitFailureThreshold: 5,
  circuitOpenDurationMs: 60_000,
};

// ─── Circuit Breaker ──────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreaker {
  readonly state: CircuitState;
  recordSuccess(): void;
  recordFailure(): void;
  canProceed(): boolean;
  probeAllowed(): boolean;
}

export function createCircuitBreaker(config: ResilienceConfig): CircuitBreaker {
  let state: CircuitState = 'closed';
  let consecutiveFailures = 0;
  let openedAt = 0;

  return {
    get state() { return state; },

    recordSuccess() {
      consecutiveFailures = 0;
      if (state === 'half_open') {
        state = 'closed';
        openedAt = 0;
      }
    },

    recordFailure() {
      consecutiveFailures++;
      if (state === 'half_open') {
        state = 'open';
        openedAt = Date.now();
      } else if (consecutiveFailures >= config.circuitFailureThreshold) {
        state = 'open';
        openedAt = Date.now();
      }
    },

    canProceed(): boolean {
      if (state === 'closed') return true;
      if (state === 'half_open') return true;
      // state === 'open': check if duration elapsed
      if (Date.now() - openedAt >= config.circuitOpenDurationMs) {
        state = 'half_open';
        return true;
      }
      return false;
    },

    probeAllowed(): boolean {
      return state === 'half_open';
    },
  };
}

// ─── Health Tracking ──────────────────────────────────────────────

export interface ProviderHealth {
  provider: string;
  circuitState: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  totalRequests: number;
  totalRetries: number;
}

export interface HealthTracker {
  getState(): ProviderHealth;
  recordSuccess(): void;
  recordFailure(): void;
  recordRetry(): void;
}

export function createHealthTracker(provider: string): HealthTracker {
  let consecutiveFailures = 0;
  let lastFailureAt: number | null = null;
  let lastSuccessAt: number | null = null;
  let totalRequests = 0;
  let totalRetries = 0;
  let circuitState: CircuitState = 'closed';

  return {
    getState(): ProviderHealth {
      return {
        provider,
        circuitState,
        consecutiveFailures,
        lastFailureAt,
        lastSuccessAt,
        totalRequests,
        totalRetries,
      };
    },

    recordSuccess() {
      consecutiveFailures = 0;
      lastSuccessAt = Date.now();
      totalRequests++;
    },

    recordFailure() {
      consecutiveFailures++;
      lastFailureAt = Date.now();
      totalRequests++;
    },

    recordRetry() {
      totalRetries++;
    },
  };
}

// ─── Error Classification ─────────────────────────────────────────

export interface ProviderError {
  statusCode?: number;
  message: string;
  isTransient: boolean;
}

export function classifyProviderError(error: unknown): ProviderError {
  const msg = error instanceof Error ? error.message : String(error);

  // Extract HTTP status code from error message
  const statusMatch = msg.match(/HTTP\s+(\d{3})/i);
  const statusCode = statusMatch?.[1] ? parseInt(statusMatch[1], 10) : undefined;

  // Transient: network errors, timeouts, 408, 429, 500, 502, 503, 504
  if (statusCode === 408 || statusCode === 429 || statusCode === 500 ||
      statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return { statusCode, message: msg, isTransient: true };
  }

  // Network/transport errors (no status code)
  if (statusCode === undefined) {
    if (msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED') ||
        msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND') ||
        msg.includes('fetch failed') || msg.includes('network') ||
        msg.includes('socket hang up') || msg.includes('timeout') || msg.includes('timed out')) {
      return { statusCode, message: msg, isTransient: true };
    }
  }

  // Non-transient: auth (401, 403), validation (400, 422), not found (404)
  return { statusCode, message: msg, isTransient: false };
}

// ─── Timeout Wrapper ──────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`request timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ─── Backoff Calculation ──────────────────────────────────────────

export function calculateBackoff(attempt: number, config: ResilienceConfig): number {
  // attempt is 0-indexed (0 = first retry)
  const delay = config.initialBackoffMs * Math.pow(2, attempt);
  return Math.min(delay, config.maxBackoffMs);
}

// ─── Resilient Adapter ────────────────────────────────────────────

export interface ResilientAdapter extends ProviderAdapter {
  getHealth(): ProviderHealth;
}

export function createResilientAdapter(
  inner: ProviderAdapter,
  config: ResilienceConfig = DEFAULT_RESILIENCE_CONFIG,
): ResilientAdapter {
  const breaker = createCircuitBreaker(config);
  const health = createHealthTracker(inner.provider);

  async function attemptRequest(request: ProviderRequest): Promise<ProviderResponse> {
    return withTimeout(inner.complete(request), config.requestTimeoutMs);
  }

  return {
    get provider() { return inner.provider; },

    configured(): boolean {
      return inner.configured();
    },

    supportsTools(): boolean {
      return inner.supportsTools();
    },

    async complete(request: ProviderRequest): Promise<ProviderResponse> {
      // Circuit breaker: reject if OPEN
      if (!breaker.canProceed()) {
        const h = health.getState();
        health.getState; // sync circuit state
        throw new Error(`circuit breaker OPEN for ${inner.provider} (consecutive failures: ${h.consecutiveFailures})`);
      }

      let lastError: unknown;
      const maxAttempts = 1 + config.maxRetries; // 1 initial + N retries

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const response = await attemptRequest(request);
          // Success
          breaker.recordSuccess();
          health.recordSuccess();
          return response;
        } catch (error) {
          lastError = error;
          const classified = classifyProviderError(error);

          // Non-transient: fail immediately
          if (!classified.isTransient) {
            breaker.recordFailure();
            health.recordFailure();
            throw error;
          }

          // Last attempt: fail
          if (attempt === maxAttempts - 1) {
            breaker.recordFailure();
            health.recordFailure();
            throw error;
          }

          // Transient: retry with backoff — record each failure for observability
          health.recordFailure();
          health.recordRetry();
          const delay = calculateBackoff(attempt, config);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Should never reach here, but satisfy TypeScript
      throw lastError;
    },

    getHealth(): ProviderHealth {
      const h = health.getState();
      h.circuitState = breaker.state;
      return h;
    },
  };
}
