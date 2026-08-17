# CHEF FACTORY — GATE 2 — TEST STRATEGY

**Status:** ALL PASS (unit + integration + RLS)

## 1. Unit tests — `src/core/security/securityGuardian.test.ts` (41 tests)
**26 deterministic topics (T1–T26)** covering:
- precedence order + `moreRestrictive` + `combineAuthority` (never less restrictive)
- critical action registry contents + deny defaults
- risk classification evidence + terminal CRITICAL factors + monotonicity
- policy chain: lockdown, env escalation, cross-project, rate limit, cost stop,
  production/staging floors, not-authorized, explicit deny, default allow
- incident transitions (closed terminal), lockdown owner-only release
- rate limiter windows/reset/disabled, cost spike check, anomaly thresholds
- secret scanning (key-value, JWT, OpenAI key), deep scan
- prompt injection directives (DATA-never-authority on model output)
- severity inference (`info.` prefix → info), event emission + redaction
- guardian full-chain deny with evidence + rules
- registry ↔ policy parity

**10 adversarial scenarios** — jailbreak-style directives, exfiltration phrasing,
authority-override attempts, secret smuggling in metadata, deep-nested secret keys,
JWT-shaped strings in URLs, repeated bypass attempts. All resolve to deny/flagged, never
executed.

**4 persistence/parity tests** — event shapes, registry version, incident record shapes.

## 2. Integration tests (live, transactional, zero residue)
- `src/integration/security.live.integration.test.ts` (8) — critical-actions parity,
  events round-trip + owner isolation + redaction at write, incident workflow, lockdown
  lifecycle + agent-release rejection, `rlsProbe` full coverage.
- `src/integration/security.api.integration.test.ts` (1) — all security endpoints
  end-to-end + validation/404.
- `src/integration/live.integration.test.ts` (8) — Gate 1 regression, unchanged.

Purge pattern: `sec-%@chef.local` and `sec-api-%@chef.local` users removed in
`afterAll` (cascade deletes all residue).

## 3. RLS/DB tests — `supabase/tests/rls_security_tests.sql` (S1–S6, transactional)
- S1 registry immutability + reads · S2 events isolation + append-only (RLS + trigger)
- S3 lockdown scope + owner release + delete-block · S4 incident CRUD isolation
- S5 policies present + enabled + read-only · S6 rate-limit scope

Runner: `node supabase/tests/run_tests.cjs <file>` (BEGIN…ROLLBACK self-clean).

## 4. Live verification totals
- Unit + integration: **166 tests / 20 files — ALL PASS**.
- RLS suites: `rls_security_tests.sql` PASS · `rls_tests.sql` PASS (regression).
- `tsc --noEmit` clean · `tsc -p tsconfig.build.json` exit 0.
- Zero DB residue (leaked users = 0; event/incident/lockdown tables = 0).

---
**END OF GATE 2 TEST STRATEGY.**
