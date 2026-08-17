# GATE 14 — SECURITY

**Date:** 2026-08-17
**Baseline:** 599/599 PASS (frozen Gate 13)
**Scope:** Security findings from forensic audit

---

## 1. Security Findings (New in Gate 14)

| # | Finding | Severity | File:Line | Classification | Gate 14 Target |
|---|---------|----------|-----------|----------------|----------------|
| S1 | RateLimiter: 2+ independent instances, in-memory, lost on restart | HIGH | rateLimit.ts, security.ts | ARCHITECTURE | ✅ TARGETED |
| S2 | AnomalyDetector: 2+ independent instances, in-memory, lost on restart | HIGH | anomaly.ts, security.ts | ARCHITECTURE | ✅ TARGETED |
| S3 | Pipeline-level rateLimiter/anomalyDetector never instantiated | HIGH | pipeline.ts:152-153, server.ts:201 | SECURITY | ✅ TARGETED |
| S4 | SecurityGuardian optional in all callers | HIGH | pipeline.ts, execution.ts, orchestration.ts | SECURITY | DEFERRED |
| S5 | costCheck optional in Guardian | MEDIUM | guardian.ts:107 | SECURITY | DEFERRED |
| S6 | execute=false is convention not guarantee | MEDIUM | toolBroker.ts:73 | SECURITY | DEFERRED |
| S7 | promptInjection regex-only | MEDIUM | promptInjection.ts | SECURITY | DEFERRED |
| S8 | Variable resolution mismatch | MEDIUM | orchestration.ts:44,418 | CORRECTNESS | DEFERRED |

---

## 2. Security Findings (Carried from Gates 8-13)

| # | Finding | Severity | Origin | Status |
|---|---------|----------|--------|--------|
| F-GAP-02 | Rate/anomaly state lost on restart | HIGH | Gate 9 | TARGETED (Gate 14 primary) |
| F-GAP-03 | Duplicate Guardian instances | HIGH | Gate 9 | TARGETED (Gate 14 primary) |
| F-SEC-01 | Security guard hardcoded authorized | HIGH | Gate 9 | DEFERRED |
| F-ARCH-01 | No command length validation | HIGH | Gate 9 | DEFERRED |
| F-ARCH-02 | Tool results not redacted in orchestration | HIGH | Gate 9 | DEFERRED |
| F-CRIT-01 | Plaintext secrets in .env | CRITICAL | Gate 10 | DEFERRED |
| F-CRIT-03 | SSL cert verification disabled | CRITICAL | Gate 10 | DEFERRED |

---

## 3. Security Controls Verified (Post-Gate 13)

| Control | Module | Status |
|---------|--------|--------|
| SQL parameterization | repo.ts | ✅ VERIFIED |
| Owner isolation (RLS + app) | repo.ts, RLS | ✅ VERIFIED |
| Secret redaction | redact.ts, secretGuard.ts | ✅ VERIFIED |
| Prompt injection defense | promptInjection.ts | ✅ VERIFIED |
| Critical action registry (26 rules) | criticalActions.ts | ✅ VERIFIED |
| Authority matrix (10 rules) | authority.ts | ✅ VERIFIED |
| Rate limiting | rateLimit.ts | ⚠️ IN-MEMORY, DUAL-INSTANCE |
| Anomaly detection | anomaly.ts | ⚠️ IN-MEMORY, DUAL-INSTANCE |
| Lockdown | lockdown.ts | ✅ VERIFIED |
| Cost protection | costProtector.ts | ✅ VERIFIED |
| ToolBroker boundary | toolBroker.ts | ⚠️ OPTIONAL GUARDIAN |
| Provider resilience | resilience.ts | ✅ VERIFIED (per-provider) |
| Conversation truncation | execution.ts | ✅ VERIFIED |
| Variable validation | orchestration.ts | ✅ VERIFIED |
| API body limit | server.ts (Gate 13) | ✅ VERIFIED |
| API error sanitization | server.ts (Gate 13) | ✅ VERIFIED |
| API content-type | server.ts (Gate 13) | ✅ VERIFIED |
| API timeout | server.ts (Gate 13) | ✅ VERIFIED |

---

## 4. Threat Model (Post-Gate 13)

| Threat | Vector | Current Defense | Gap |
|--------|--------|-----------------|-----|
| Rate limit exhaustion + restart | Process restart resets counters | In-memory counters | S1 — TARGETED |
| Anomaly threshold bypass + restart | Process restart resets counters | In-memory counters | S2 — TARGETED |
| Pipeline-level rate limit bypass | Constructor params never passed | None at pipeline level | S3 — TARGETED |
| Guardian bypass via omission | Optional constructor param | Production code provides it | S4 — DEFERRED |
| Cost protection bypass | Optional costCheck | Production code provides it | S5 — DEFERRED |
| Tool execution without validation | execute=false convention | Caller-controlled | S6 — DEFERRED |

---

## 5. Classification

**GATE_14_SECURITY_REVIEW_COMPLETE**

3 new HIGH findings targeted for Gate 14. 7 carried findings deferred. 14/18 existing controls verified intact, 4 with architectural concerns.
