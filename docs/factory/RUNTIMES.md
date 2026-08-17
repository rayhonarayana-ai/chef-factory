# CHEF FACTORY — RUNTIMES (Gate 1 Core)

**Component:** Runtime Registry + RuntimeGateway + RuntimeAdapters
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED (schema)

## Purpose
Runtime-agnostic execution. OpenCode / OpenCode Zen is one adapter, never the
architectural core (contract §8). Future runtimes are addable without redesign.

## Architecture
- `src/gateways/runtimeGateway.ts` — `RuntimeAdapter` interface + `RuntimeGateway`
  orchestrator (`RuntimeExecutionRequest` / `RuntimeExecutionResult`).
- `src/gateways/adapters/opencodeZen.ts` — initial OpenCode Zen adapter (optional).
- `Store.listRuntimes(ownerId)` — registry read; `public.runtimes` mirrors models with
  capability/cost metadata.

## Safety
- Runtimes execute only what passes the full boundary: Authority → Project →
  Environment → Risk → Approval → Security Guardian (Gate 2) → ToolBroker → Audit
  (contract §4).
- No raw unrestricted tools are exposed to agents; no full browser automation.
- Gate 2: `RuntimeGateway` accepts an optional `environmentGuard` and exposes
  `guardExecution(request)` — a runtime may be denied before dispatch when the guard
  returns `{ allowed: false }`. Runtime execution is also bounded by the
  `runtime.execute` rate limit (20/3600s default).

## Tests
- `src/gateways/runtimeGateway.test.ts` — dispatch + result shaping + guardExecution.
- `src/integration/live.integration.test.ts` — registry read round-trip via `listRuntimes`
  behavior covered by store contract.
- `src/core/security/securityGuardian.test.ts` — runtime rate-limit scope.
