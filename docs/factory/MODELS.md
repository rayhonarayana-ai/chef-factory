# CHEF FACTORY — MODELS (Gate 1 Core)

**Component:** Model Registry + ModelGateway + ProviderAdapters
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED (schema)

## Purpose
Model-agnostic execution. No provider is the architectural core. Selection considers
capability, reasoning, latency, cost, context, reliability, task type, security policy,
and availability — with cost-first bias (cheapest capable model; frontier only when
justified, contract §11).

## Architecture
- `src/gateways/providerAdapter.ts` — `ProviderAdapter` interface (the provider seam).
- `src/gateways/adapters/openai.ts` / `anthropic.ts` / `google.ts` / `opencodeZen.ts` —
  optional adapters, all optional at runtime.
- `src/gateways/modelGateway.ts` — `ModelGateway` orchestrates selection + dispatch;
  usage stats are defensively defaulted (`?? 0`).
- `Store.listModels(ownerId)` — registry read; `public.models` enforces non-negative
  cost checks (RLS TEST 7).

## Safety
- Secrets for providers never reach prompts, logs, audit, or the UI (SecretProvider + redaction).
- Business logic never names a specific provider (provider choice is data, not code).
- Gate 2 cost protection: model spend is bounded by hard limits
  (`CostProtector.check` — owner/project monthly, spike baseline ×5). When a limit is
  reached the Guardian stops execution (`denied.cost`). Model calls are rate-limited by
  the `model.call` scope (200/3600s default).

## Tests
- `src/gateways/modelGateway.test.ts` — selection, dispatch, cost stats.
- `src/gateways/providerAdapter.test.ts` behavior covered in modelGateway.test.ts.
- `supabase/tests/rls_tests.sql` TEST 7 — `models` cost check enforced.
- `src/core/security/securityGuardian.test.ts` — cost hard-stop + model rate-limit scope.
