# CHEF FACTORY — As-Built Gateway Reference

**Status:** IMPLEMENTED | **Evidence:** source inspection  
**Last Verified:** 2026-08-16

---

## 1. Gateway Architecture

CHEF FACTORY uses a two-gateway abstraction layer ("Gate 1") to decouple business logic from provider specifics:

- **ModelGateway** — selects the cheapest capable LLM model for a given task requirement. Provider identity never leaks into business logic; selection is purely capability- and cost-driven.
- **RuntimeGateway** — selects the cheapest available execution runtime (e.g. OpenCode Zen CLI). Gated by an optional environment guard that may restrict execution by scope/environment.
- **Provider Adapters** — concrete implementations of the `ProviderAdapter` interface that translate a normalized request into provider-specific HTTP calls (OpenAI, Anthropic, Google).
- **Runtime Adapters** — concrete implementations of the `RuntimeAdapter` interface that wrap execution runtimes (currently only OpenCode Zen).
- **SecretProvider** — boundary that isolates API keys from prompts, logs, audit, memory, and UI. Gate 1 implementation reads from environment variables only.
- **ToolBroker** — boundary for external tool actions. Every call passes Authority → Project → Environment → Risk → Approval → SecurityGuard → Audit. Never exposes raw unrestricted tools.
- **MemoryGateway** — abstraction for vector-backed lesson recall. Gate 1 provides a safe no-backend stub that returns empty recall (never fabricated memories).

All gateways are injected via constructor with `Map<string, Adapter>` — no global singletons, no hard-coded providers.

---

## 2. Model Gateway (`src/gateways/modelGateway.ts`)

**Status:** IMPLEMENTED | **Evidence:** `src/gateways/modelGateway.ts:15-75`

### Interface

```typescript
class ModelGateway {
  constructor(adapters: Map<string, ProviderAdapter>, config?: ModelGatewayConfig)
  providers(): string[]                                    // list registered provider keys
  adapterFor(provider: string): ProviderAdapter | null     // lookup adapter by provider name
  select(models: ModelInfo[], request: ModelSelectionRequest): ModelSelection
}
```

### Selection Logic (`select`)

1. **Filter** — only models with `status === 'active'` are candidates.
2. **Capability filter** — candidate must meet:
   - `capability.reasoning >= request.neededReasoning` (ranked: none=0, low=1, medium=2, high=3)
   - If `request.neededTools` is true, `capability.tools` must be true
   - If `request.minContextWindow` is set, `contextWindow >= minContextWindow`
3. **Sort** — ascending by total cost (`costPer1kInput + costPer1kOutput`), then by name (deterministic tiebreak).
4. **Pick** — `config.preferCheapest` (default: `true`) selects first (cheapest); when `false`, selects last (most expensive).
5. **Reason text** — distinguishes "cheapest capable" from "only frontier-reasoning models satisfy."
6. **No fabrication** — when no model matches, returns `model: null` with explicit reason string.

### Provider Routing

The gateway does **not** route to providers during selection. Selection is purely data-driven from the model registry. Provider routing happens at execution time in `execution.ts`, which calls `adapterFor(selection.model.provider)` to get the concrete adapter, then calls `adapter.complete()`.

---

## 3. Runtime Gateway (`src/gateways/runtimeGateway.ts`)

**Status:** IMPLEMENTED | **Evidence:** `src/gateways/runtimeGateway.ts:35-79`

### Interface

```typescript
class RuntimeGateway {
  constructor(adapters: Map<string, RuntimeAdapter>, environmentGuard?: (request) => EnvironmentGuardResult)
  adaptersAvailable(): string[]                                            // names of available adapters
  adapterFor(slug: string): RuntimeAdapter | null                          // lookup by slug
  guardExecution(request: RuntimeExecutionRequest): Promise<EnvironmentGuardResult>  // optional scope guard
  select(runtimes: RuntimeInfo[], requirement: string): RuntimeSelection
}
```

### Selection Logic (`select`)

1. **Filter** — only `status === 'active'`.
2. **Sort** — ascending by `costPerHour`, then by name.
3. **Pick** — always cheapest (index 0).
4. **No fabrication** — returns `runtime: null` with reason when no active runtime exists.

### Environment Guard

Optional callback injected at construction. When present, `guardExecution()` invokes it. If the guard returns `{ allowed: false }`, execution is refused. This is a Gate 2 hookpoint — the guard may only be more restrictive, never less.

### RuntimeAdapter Interface

```typescript
interface RuntimeAdapter {
  readonly runtimeName: string;
  available(): boolean;
  execute(request: RuntimeExecutionRequest): Promise<RuntimeExecutionResult>;
}
```

---

## 4. Provider Adapter (`src/gateways/providerAdapter.ts` + `src/gateways/adapters/`)

**Status:** IMPLEMENTED | **Evidence:** `providerAdapter.ts:1-44`, `adapters/openai.ts:1-44`, `adapters/anthropic.ts:1-50`, `adapters/google.ts:1-42`, `adapters/opencodeZen.ts:1-67`

### Common Interface

```typescript
interface ProviderAdapter {
  readonly provider: string;
  configured(): boolean;                                   // true when API key is present
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

interface ProviderRequest {
  model: string;
  system?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
}

interface ProviderResponse {
  provider: string;
  model: string;
  text: string;
  usage: { inputTokens: number; outputTokens: number } | null;
}
```

### Utility Functions

- `estimateTokens(text)` — deterministic fallback: `Math.ceil(text.length / 4)`.
- `costForTokens(costPer1kInput, costPer1kOutput, inputTokens, outputTokens)` — computes dollar cost.

### OpenAI Adapter (`adapters/openai.ts`)

- **Endpoint:** `https://api.openai.com/v1/chat/completions` (configurable via `baseUrl`).
- **Auth:** `Authorization: Bearer <key>`.
- **Response mapping:** `choices[0].message.content` → `text`; `usage.prompt_tokens` / `usage.completion_tokens` → usage.
- **Configured:** `true` when `apiKey` is provided.

### Anthropic Adapter (`adapters/anthropic.ts`)

- **Endpoint:** `https://api.anthropic.com/v1/messages` (configurable via `baseUrl`).
- **Auth:** `x-api-key` header + `anthropic-version: 2023-06-01`.
- **System message:** extracted from messages array and passed as top-level `system` field (Anthropic API requirement).
- **Response mapping:** `content[].text` joined → `text`; `usage.input_tokens` / `usage.output_tokens` → usage.
- **Configured:** `true` when `apiKey` is provided.

### Google Adapter (`adapters/google.ts`)

- **Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}` (configurable via `baseUrl`).
- **Role mapping:** `assistant` → `model`, `user` → `user` (Google API convention).
- **System message:** passed as `system_instruction`.
- **Usage:** `null` (Google generateContent does not reliably return token counts in all models).
- **Configured:** `true` when `apiKey` is provided.

### OpenCode Zen Runtime Adapter (`adapters/opencodeZen.ts`)

- **Type:** `RuntimeAdapter` (not a `ProviderAdapter`).
- **Activation:** requires both `enabled === true` and `cliPath` to be non-null.
- **Execution:** spawns `{cliPath} run {command}` via `node:child_process.spawn`, captures stdout/stderr.
- **Cost:** `(durationMs / 3600000) * costPerHour`.
- **Safety:** never auto-executes production work; refuses when not enabled.

---

## 5. Gateway Types

**Status:** IMPLEMENTED | **Evidence:** `src/core/types.ts` + `src/gateways/providerAdapter.ts` + `src/gateways/runtimeGateway.ts` + `src/gateways/modelGateway.ts`

### Core Domain Types (from `src/core/types.ts`)

| Type | Purpose |
|------|---------|
| `ModelInfo` | Model registry record: id, provider, name, slug, capability, contextWindow, costPer1kInput/Output, status |
| `ModelSelectionRequest` | Selection criteria: requirement, neededReasoning, neededTools, minContextWindow |
| `ModelSelection` | Selection result: model (or null), reason, cheapestCapable, candidates[] |
| `RuntimeInfo` | Runtime registry record: id, name, version, slug, capability, costPerHour, status |
| `RuntimeSelection` | Selection result: runtime (or null), reason, cheapestCapable, candidates[] |
| `RiskLevel` | `'low' \| 'medium' \| 'high' \| 'critical'` |
| `AutonomyLevel` | `'auto' \| 'notify' \| 'require_approval' \| 'deny'` |
| `ToolCallRequest` | Tool invocation request: tool, args, actorId, actorType, projectId, environment, risk |
| `ToolCallResult` | Tool invocation result: ok, tool, action, outcome, metadata |
| `RecallItem` | Memory recall result: id, category, title, summary, projectId, confidence, createdAt |
| `LessonInput` | Memory save input: title, summary, category, projectId, confidence |

### Gateway-Layer Types

| Type | File | Purpose |
|------|------|---------|
| `ProviderAdapter` | `providerAdapter.ts` | Provider boundary interface |
| `ProviderRequest` | `providerAdapter.ts` | Normalized completion request |
| `ProviderResponse` | `providerAdapter.ts` | Normalized completion response |
| `ProviderConfig` | `providerAdapter.ts` | `{ apiKey?, baseUrl? }` |
| `RuntimeAdapter` | `runtimeGateway.ts` | Runtime boundary interface |
| `RuntimeExecutionRequest` | `runtimeGateway.ts` | Runtime execution request |
| `RuntimeExecutionResult` | `runtimeGateway.ts` | Runtime execution result |
| `EnvironmentGuardResult` | `runtimeGateway.ts` | `{ allowed: boolean; reason? }` |
| `ModelGatewayConfig` | `modelGateway.ts` | `{ preferCheapest? }` |
| `SecretProvider` | `secretProvider.ts` | Secret boundary interface |
| `Tool` | `toolBroker.ts` | Tool definition: name, action, minRisk, run |
| `ToolBrokerContext` | `toolBroker.ts` | Authority + approval + security guard |
| `MemoryGateway` | `memoryGateway.ts` | Memory boundary interface |

---

## 6. Registry

**Status:** NOT_APPLICABLE — **Evidence:** `src/gateways/registry.ts` does not exist

No dedicated registry module exists. Model and runtime registries are stored in the PostgreSQL database (`public.models`, `public.runtimes` tables) and seeded via `src/db/seed.ts`. The `Store` port interface provides `listModels()` and `listRuntimes()` for runtime queries. Adapters are registered via `Map` injection at server startup in `src/api/server.ts:156-167`.

---

## 7. Seeded Models & Runtimes

**Status:** IMPLEMENTED | **Evidence:** `src/db/seed.ts:44-77`

### Seeded Models

| Provider | Name | Slug | Reasoning | Tools | Context Window | Cost/1k In | Cost/1k Out |
|----------|------|------|-----------|-------|----------------|------------|-------------|
| openai | gpt-4o-mini | gpt-4o-mini | low | true | 128,000 | $0.15 | $0.60 |
| openai | gpt-4o | gpt-4o | medium | true | 128,000 | $2.50 | $10.00 |
| anthropic | claude-3-5-haiku | claude-3-5-haiku | low | true | 200,000 | $0.80 | $4.00 |
| anthropic | claude-3-5-sonnet | claude-3-5-sonnet | high | true | 200,000 | $3.00 | $15.00 |
| google | gemini-1.5-flash | gemini-1.5-flash | low | true | 1,048,576 | $0.075 | $0.30 |
| google | gemini-1.5-pro | gemini-1.5-pro | high | true | 2,097,152 | $1.25 | $5.00 |

All models seed with `status: 'active'` and are upserted via `ON CONFLICT (owner_id, provider, name) DO UPDATE`.

### Seeded Runtimes

| Name | Version | Slug | Capabilities | Cost/Hour |
|------|---------|------|-------------|-----------|
| opencode-zen | 0.1 | opencode-zen | `{ code: true, shell: true }` | $0.00 |

Seeded with `status: 'active'`, upserted via `ON CONFLICT (owner_id, name, version) DO UPDATE`.

### Seeded Project

- **CHEF HQ** (`chef-hq`) — Factory control project, status `active`.

---

## 8. Execution Integration (`src/api/execution.ts`)

**Status:** IMPLEMENTED | **Evidence:** `src/api/execution.ts:1-180`

### Wiring (`src/api/server.ts:156-169`)

```typescript
const modelGateway = new ModelGateway(new Map([
  ['openai',    createOpenAIAdapter({ apiKey: process.env.FACTORY_OPENAI_API_KEY })],
  ['anthropic', createAnthropicAdapter({ apiKey: process.env.FACTORY_ANTHROPIC_API_KEY })],
  ['google',    createGoogleAdapter({ apiKey: process.env.FACTORY_GOOGLE_API_KEY })],
]));
const runtimeGateway = new RuntimeGateway(new Map([
  ['opencode-zen', createOpenCodeZenAdapter({ cliPath: process.env.FACTORY_OPENCODE_CLI, enabled: process.env.FACTORY_OPENCODE_ENABLED === 'true' })],
]));
const execution = createExecutionRunner({ store, modelGateway, runtimeGateway });
```

### Execute Flow

The `ExecutionRunner.execute(task, ctx, intent)` pipeline:

1. **Informational verbs** (`ask`, `status`, `list`, `read`, `plan`, `research`) → deterministic `runInformational()` — reads directly from `Store`, no model call, no fabrication. Returns structured data (projects, tasks, approvals, costs, decisions, models, runtimes, daily_status).

2. **Execute-class verbs** → two-phase attempt:

   **Phase 1 — ModelGateway path:**
   - Loads models from store via `store.listModels(ownerId)`
   - Computes `neededReasoning` from intent verb (plan/deploy → high, research/execute → medium, default → none)
   - Calls `modelGateway.select(models, { requirement, neededReasoning, neededTools: false, minContextWindow: null })`
   - If selection succeeds, looks up adapter via `modelGateway.adapterFor(model.provider)`
   - If adapter exists and is `configured()`, calls `adapter.complete()` with system prompt + task
   - Computes cost from reported usage or `estimateTokens()` fallback
   - Returns `ExecutionOutcome` with model output, model reference, and cost
   - On adapter error: returns `{ ok: false, reason: 'model-call-failed' }`

   **Phase 2 — RuntimeGateway path** (only reached if Phase 1 yields no adapter/configured model):
   - Loads runtimes from store via `store.listRuntimes(ownerId)`
   - Calls `runtimeGateway.select(runtimes, requirement)`
   - If selection succeeds, looks up adapter via `runtimeGateway.adapterFor(runtime.slug)`
   - If adapter is `available()`, calls `adapter.execute()` with command, projectPath, environment
   - Returns `ExecutionOutcome` with runtime output and cost

   **Phase 3 — No executor:**
   - Returns `{ ok: false, error: 'No configured model provider or runtime adapter is available...', reason: 'no-executor' }`
   - Explicitly: "Nothing was invented and no credits were spent."

### System Prompt

```
You are CHEF, the owner's personal executive deputy.
Acting for owner {ownerId}.
Follow the architecture: never fabricate evidence; surface ambiguity;
defer authority and security decisions; explain decisions with why/evidence.
```

---

## 9. Test Coverage

**Status:** IMPLEMENTED | **Evidence:** 5 test files in `src/gateways/`, 1 in `src/api/`

### Gateway Tests

| File | Status | Tests |
|------|--------|-------|
| `modelGateway.test.ts` | IMPLEMENTED | 7 tests: cheapest capable selection, retired exclusion, tool filtering, frontier reasoning, no-match returns null, context window, cost-driven ordering |
| `runtimeGateway.test.ts` | IMPLEMENTED | 4 tests: cheapest selection, retired exclusion, no-active returns null, adapter lookup |
| `secretProvider.test.ts` | IMPLEMENTED | 4 tests: no value leakage in list/ref, get returns values, null for unknown, redaction |
| `toolBroker.test.ts` | IMPLEMENTED | 6 tests: auto execution, deny authority, approval required, risk ceiling, tool not found, secret truncation |
| `memoryGateway.test.ts` | IMPLEMENTED | 4 tests: not configured, empty recall, secret rejection, valid lesson acceptance |

### Execution Tests

| File | Status | Tests |
|------|--------|-------|
| `execution.test.ts` | IMPLEMENTED | 3 tests: informational commands from store, no-executor honest failure, no fabrication with models but no adapter |

### Test Framework

Vitest. All tests use in-memory stores or empty adapter maps — no live provider calls.

---

## 10. Known Gaps

### Provider API Keys

**Status:** UNVERIFIED (runtime configuration — cannot verify without live environment)

API keys are managed via environment variables, read at server startup in `src/api/server.ts:158-160`:

| Env Var | Provider |
|---------|----------|
| `FACTORY_OPENAI_API_KEY` | OpenAI |
| `FACTORY_ANTHROPIC_API_KEY` | Anthropic |
| `FACTORY_GOOGLE_API_KEY` | Google |
| `FACTORY_OPENCODE_CLI` | OpenCode Zen runtime |
| `FACTORY_OPENCODE_ENABLED` | Enable/disable OpenCode Zen |

Keys are passed to adapter factory functions at construction time. The `SecretProvider` boundary (env-only implementation) also reads these plus database/owner credentials.

### Concrete Adapter Gaps

- **No concrete ProviderAdapter implementations are tested in isolation** — the 3 model adapter files (`openai.ts`, `anthropic.ts`, `google.ts`) have no dedicated test files. Tests exercise them only through the gateway/execution integration with empty adapter maps.
- **Google adapter returns `usage: null`** — cost estimation falls back to `estimateTokens()` (character/4 heuristic) for Google models. This is honest but imprecise.
- **OpenCode Zen adapter** — only adapter for `RuntimeGateway`. No other runtimes are implemented. The `FACTORY_OPENCODE_ENABLED` env var defaults to `false`, so the runtime path is unreachable unless explicitly enabled.

### Architectural Gaps

- **No `types.ts` or `registry.ts`** in `src/gateways/` — types live in `src/core/types.ts`; registry is the database.
- **No live provider verification** — all provider adapters use raw `fetch()`. No retry logic, no rate limiting, no streaming support.
- **`neededTools` is hardcoded to `false`** in `execution.ts:55` — the model selection never requires tool capability during execution, despite seeded models having `tools: true`.
- **MemoryGateway** — `configured: false` always. No vector backend (ChromaDB etc.) is present in Gate 1. Recall always returns `[]`. Lessons are persisted to the Store but never recalled.
- **Environment guard** on `RuntimeGateway` — injected as optional callback; no concrete guard is wired in `server.ts`. The guard is a Gate 2 hookpoint with no Gate 1 implementation.
- **SecurityGuard** on `ToolBroker` — optional hook; the `createSecurityGuardian(store)` referenced in `server.ts:170` is a Gate 2 component.
