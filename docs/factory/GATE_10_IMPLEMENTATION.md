# CHEF FACTORY — Gate 10: Provider Resilience — Implementation

> Status: **PASS** | Date: 2026-08-17
> Gate 9 Baseline: 427/427 FROZEN | Gate 10 Tests: 35/35 | Total: 462/462

## Summary

Implemented provider resilience for OpenAI, Anthropic, and Google adapters.
The existing `ProviderAdapter` interface is preserved — resilience is added as a
transparent decorator layer.

## Files Modified

| File | Change |
|------|--------|
| `src/gateways/resilience.ts` | NEW — Resilience layer (retry, backoff, timeout, circuit breaker, health) |
| `src/gateways/resilience.test.ts` | NEW — 31 unit tests |
| `src/api/server.ts` | Modified — wrap 3 adapters with `createResilientAdapter()` |
| `src/integration/gate10.live.integration.test.ts` | NEW — 4 live tests (3 active, 1 BLOCKED placeholder) |

## Architecture

```
ProviderAdapter (interface)
  └── createResilientAdapter(inner, config)
        ├── Bounded retry (1 + maxRetries attempts)
        ├── Exponential backoff (initialBackoffMs × 2^attempt, capped at maxBackoffMs)
        ├── Per-attempt timeout (withTimeout wrapper)
        ├── Circuit breaker (CLOSED → OPEN → HALF_OPEN → CLOSED)
        ├── Provider health tracking (in-memory)
        └── Deterministic error classification
```

## Configuration Defaults

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxRetries` | 3 | Maximum retry attempts per request |
| `requestTimeoutMs` | 30,000 | Per-attempt timeout (ms) |
| `initialBackoffMs` | 1,000 | Initial backoff delay (ms) |
| `maxBackoffMs` | 10,000 | Maximum backoff delay (ms) |
| `circuitFailureThreshold` | 5 | Failures before circuit opens |
| `circuitOpenDurationMs` | 60,000 | Duration before HALF_OPEN probe |

## Error Classification

### Transient (retried):
- HTTP 408, 429, 500, 502, 503, 504
- ECONNRESET, ECONNREFUSED, ETIMEDOUT, ENOTFOUND
- fetch failed, network, socket hang up, timeout, timed out

### Non-transient (fail immediately):
- HTTP 400, 401, 403, 404
- Authentication failures
- Permission failures
- Validation errors
- All other errors

## Security Invariants Preserved

- ToolBroker boundary: resilience wraps only adapter.complete()
- Guardian enforcement: upstream of adapter calls
- Authority resolution: per-tool-call, upstream of adapter
- Rate limiting: checked before adapter calls
- Cost protection: response.usage preserved through resilience
- No double execution: retry retries model request only
- No secrets in error messages
