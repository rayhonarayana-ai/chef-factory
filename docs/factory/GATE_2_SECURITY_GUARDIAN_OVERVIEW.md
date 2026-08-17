# CHEF FACTORY — GATE 2 — SECURITY GUARDIAN OVERVIEW

**Prompt:** PROMPT 4/5 — SECURITY GUARDIAN
**Date:** 2026-08-16
**Status:** IMPLEMENTED + TESTED + LIVE_VERIFIED
**Governing documents:** CHEF_FACTORY_MASTER_REFERENCE_FINAL.md · GATE_1_EXECUTION_CONTRACT_FINAL.md

---

## 1. What the Guardian Is

The Security Guardian is a **deterministic security boundary** that evaluates every
security-sensitive request before execution. It sits AFTER Gate 1 authority/autonomy and
may only make a decision **MORE restrictive** than Gate 1. It never weakens a Gate 1
decision.

## 2. Deterministic Decision Chain

```
REQUEST → IDENTITY → PROJECT → ENVIRONMENT → AGENT → PERMISSION →
ACTION CLASSIFICATION → RISK → SECURITY POLICY → AUTONOMY POLICY →
DECISION → AUDIT
```

Precedence (highest wins): **LOCKDOWN > DENY > REQUIRE_APPROVAL > NOTIFY > ALLOW**.

LLMs may assist with analysis but are **never** the final authority. Every decision is
deterministic and auditable.

## 3. Components (`src/core/security/`)

| Module | Responsibility |
|---|---|
| `types.ts` | Typed security vocabulary (decisions, severities, records) |
| `criticalActions.ts` | Critical Action Registry (17 immutable core rules) |
| `riskEngine.ts` | Deterministic risk classification LOW/MEDIUM/HIGH/CRITICAL |
| `policyEngine.ts` | 13-rule decision chain + precedence + authority combination |
| `events.ts` | Append-only security event model + severity inference |
| `incidents.ts` | Foundational incident workflow (DETECTED→…→CLOSED) |
| `lockdown.ts` | Emergency lockdown (fail closed; owner-only release) |
| `rateLimit.ts` | Fixed-window deterministic rate limits (7 scopes) |
| `costProtection.ts` | Hard cost limits + spike check |
| `anomaly.ts` | Deterministic threshold anomaly signals (no fake AI) |
| `promptInjection.ts` | Untrusted-content classification (never authority) |
| `secretGuard.ts` | Secret shape scanning + deep value scan |
| `health.ts` | Security health aggregation (never false healthy) |
| `guardian.ts` | Orchestrator (`SecurityGuardian.evaluate`) |

## 4. Guardian `evaluate` Sequence

1. **Lockdown** check — active → LOCKDOWN (fail closed).
2. **Critical Action Registry** — deny / require_approval default.
3. **Environment isolation** — escalation beyond grant → DENY.
4. **Cross-project** — access outside scope → DENY.
5. **Rate limit** (per scope) — exhausted → DENY.
6. **Cost protection** — hard limit reached → DENY.
7. **Prompt injection** — untrusted authority directives recorded (never honored).
8. **Policy engine** — deterministic decision.
9. **Combine with Gate 1 authority** — never less restrictive.
10. **Anomaly notes** — threshold signals emitted as events.
11. **Final deny/approval events** written (append-only).

## 5. Fail-Closed Hooks (optional — Gate 1 behavior unchanged without them)

- `src/gateways/toolBroker.ts` — optional `securityGuard` hook → outcome
  `denied_by_security`.
- `src/gateways/runtimeGateway.ts` — optional `environmentGuard` + `guardExecution()`.
- `src/core/pipeline.ts` — optional `SecurityGuardian` param: evaluates after autonomy;
  deny/lockdown → cancelled task + `security.guardian_denied` audit; require_approval /
  notify → upgrade-only reconciliation.

## 6. Guardrails (binding)

- DENY ALWAYS WINS.
- LLM output = DATA, not AUTHORITY.
- Fail closed — missing controls never report healthy.
- Agent cannot activate/release a lockdown; owner release is explicit + audited.
- Registry rows are immutable in the database even for superuser.
- Every security event is append-only and owner-scoped.

---

**END OF GATE 2 SECURITY GUARDIAN OVERVIEW.**
