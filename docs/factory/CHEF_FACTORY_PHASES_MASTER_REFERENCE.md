# CHEF FACTORY — PHASES MASTER REFERENCE

> Last Updated: 2026-08-19
> Current Gate: 18 (PASS — 749/749, ConversationService Refactor + Tests)

## Gate Summary

| Gate | Mission | Tests | Classification | Date |
|------|---------|-------|----------------|------|
| 1 | Executive Core + Database Foundation | 105 → 116 | GATE_1_PASS | 2026-08-16 |
| 2 | Security Guardian | 166 → 169 | GATE_2_PASS_FROZEN | 2026-08-16 |
| 3 | Live Provider Verification | 222 | GATE_3_PASS_FROZEN | 2026-08-17 |
| 4 | Wiring Fixes (History, ToolBroker, Authority, Anomaly) | 243 | GATE_4_PASS_FROZEN | 2026-08-17 |
| 5 | Execution Integrity + Security Hardening | 257 | GATE_5_PASS | 2026-08-17 |
| 6 | Data Intelligence Layer (query_data tool) | 343 | GATE_6_PASS_FROZEN | 2026-08-17 |
| 7 | Query Security Hardening | 370 | GATE_7_PASS_FROZEN | 2026-08-17 |
| 8 | Multi-Step Task Orchestration | 400 | GATE_8_PASS_FROZEN | 2026-08-17 |
| 9 | Wire Orchestration Engine | 427 | GATE_9_PASS | 2026-08-17 |
| 10 | Provider Resilience (retry/backoff/circuit) | 462 | GATE_10_PASS | 2026-08-17 |
| 11 | Orchestration Hardening + Input Integrity | 515 | GATE_11_PASS | 2026-08-17 |
| 12 | End-to-End Executive Workflows | 577 | GATE_12_PASS | 2026-08-17 |
| 13 | API Boundary Hardening | 599 | GATE_13_PASS | 2026-08-17 |
| 14 | Persistent Rate/Anomaly State | 624 | GATE_14_PASS_FROZEN | 2026-08-17 |
| 15 | SSE Streaming (Progress Events) | 687 | GATE_15_PASS | 2026-08-19 |
| **16** | **Persistent Security State Fix** | **699** | **GATE_16_PASS_FROZEN** | **2026-08-19** |
| **17** | **Security Event Audit Trail Reliability** | **716** | **GATE_17_PASS_PARTIAL** | **2026-08-19** |

## Frozen Baselines

| Gate | Baseline | Status |
|------|----------|--------|
| Gate 3 | 222/222 | FROZEN |
| Gate 4 | 243/243 | FROZEN |
| Gate 5 | 257/257 | FROZEN |
| Gate 6 | 343/343 | FROZEN |
| Gate 7 | 370/370 | FROZEN |
| Gate 8 | 400/400 | FROZEN |
| Gate 14 | 624/624 | FROZEN |
| Gate 16 | 699/699 | FROZEN |
| **Current** | **716/716** | **ACTIVE** |

## Test Growth Trajectory

```
Gate 1:  116 tests
Gate 2:  169 tests  (+53)
Gate 3:  222 tests  (+53)
Gate 4:  243 tests  (+21)
Gate 5:  257 tests  (+14)
Gate 6:  343 tests  (+86)
Gate 7:  370 tests  (+27)
Gate 8:  400 tests  (+30)
Gate 9:  427 tests  (+27)
Gate 10: 462 tests  (+35)
Gate 11: 515 tests  (+53)
Gate 12: 577 tests  (+62)
Gate 13: 599 tests  (+22)
Gate 14: 624 tests  (+25)
Gate 15: 687 tests  (+63)
Gate 16: 699 tests  (+12)
Gate 17: 716 tests  (+17)
```

## Key Constants

| Constant | Value | Source |
|----------|-------|--------|
| FACTORY_MAX_TOOL_ROUNDS | 10 | execution.ts:25 |
| FACTORY_MAX_ORCHESTRATION_STEPS | 10 | orchestration.ts:33 |
| DEFAULT_ORCHESTRATION_TIMEOUT_MS | 300000 (5min) | orchestration.ts:34 |
| DEFAULT_STEP_TIMEOUT_MS | 30000 (30s) | orchestration.ts:35 |
| CONVERSATION_TOKEN_BUDGET | 8000 | execution.ts:29 |
| MAX_BODY_BYTES | 1048576 (1MB) | server.ts:37 |
| API_REQUEST_TIMEOUT_MS | 30000 (30s) | server.ts:38 |
| STREAMING_REQUEST_TIMEOUT_MS | 300000 (5min) | server.ts:39 |
| CRITICAL_ACTIONS_REGISTRY_VERSION | 2 | criticalActions.ts:10 |

## Architecture Layers

```
┌─────────────────────────────────────────────────┐
│  API Layer (server.ts, handlers.ts, streaming.ts) │
├─────────────────────────────────────────────────┤
│  Pipeline (pipeline.ts)                          │
│  ├── Intent (intent.ts)                          │
│  ├── Authority (authority.ts)                    │
│  ├── Autonomy (autonomy.ts)                      │
│  ├── Approval (approval.ts)                      │
│  └── Orchestration (orchestration.ts)            │
├─────────────────────────────────────────────────┤
│  Execution (execution.ts)                        │
│  ├── ToolBroker (toolBroker.ts)                  │
│  ├── Tools (tools/*.ts)                          │
│  └── Conversation (conversation.ts)              │
├─────────────────────────────────────────────────┤
│  Security (security/*.ts)                        │
│  ├── Guardian (guardian.ts)                      │
│  ├── Policy Engine (policyEngine.ts)             │
│  ├── Rate Limiter (rateLimit.ts)                 │
│  ├── Anomaly Detector (anomaly.ts)               │
│  ├── Lockdown (lockdown.ts)                      │
│  ├── Prompt Injection (promptInjection.ts)       │
│  ├── Secret Guard (secretGuard.ts)               │
│  └── Health (health.ts)                          │
├─────────────────────────────────────────────────┤
│  Gateways                                        │
│  ├── Provider Adapter (providerAdapter.ts)       │
│  │   ├── OpenAI (adapters/openai.ts)             │
│  │   ├── Anthropic (adapters/anthropic.ts)       │
│  │   └── Google (adapters/google.ts)             │
│  ├── Resilience (resilience.ts)                  │
│  ├── Model Gateway (modelGateway.ts)             │
│  ├── Runtime Gateway (runtimeGateway.ts)         │
│  ├── Memory Gateway (memoryGateway.ts)           │
│  └── Secret Provider (secretProvider.ts)         │
├─────────────────────────────────────────────────┤
│  Persistence (db/repo.ts, gate14Persistence.ts)  │
│  ├── SupabaseStore (ports.ts interface)          │
│  └── Connection (db/config.ts)                   │
├─────────────────────────────────────────────────┤
│  Database (Supabase Postgres)                    │
│  ├── 27 tables with RLS                          │
│  ├── 6+ migrations                               │
│  └── Append-only triggers                        │
└─────────────────────────────────────────────────┘
```

## Pending Owner Decisions

| OD-ID | Gate | Question | Status |
|-------|------|----------|--------|
| OD8/OD19 | 5+ | Initialize git repository | DEFERRED |

## Deferred Capabilities

| Capability | Target Gate | Priority |
|-----------|-------------|----------|
| API boundary hardening (CORS, headers) | 19+ | HIGH |
| Tool handler timeout + AbortSignal | 19+ | HIGH |
| Security audit event recovery | 19+ | MEDIUM |
| Approval workflow enforcement | 19+ | MEDIUM |
| Anomaly cross-owner pollution fix | 19+ | MEDIUM |
| Memory/vector backend | 20+ | HIGH |
| Structured logging | 20+ | MEDIUM |
| Graceful shutdown | 20+ | LOW |
| Git version control | Owner decision | LOW |
