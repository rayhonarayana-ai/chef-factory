# Constitution S1 — Controlled Registry Foundation — Implementation Report

Status date: 2026-09-02 · Stage: **S1 implementation** · Baseline: `main` @ `7d93ecc` (S0 freeze, parent `15112791`)

## Verdict
- **MIGRATION_FILE_IMPLEMENTED** = `YES`
- **LIVE_SCHEMA_APPLIED** = `NO` at this stage's status date (migration file implemented; not yet applied as part of S1)
- **PRODUCTION_PHYSICAL_SCHEMA_APPLICATION** = `PROVEN` (production S1 schema applied during the separately authorized production Phase 4, NOT via disposable PATH B)
- **MIGRATION_LEDGER_REGISTRATION** = `NOT_PRESENT` (nonblocking platform-process debt)
- **READY_FOR_S1_TECH_LEAD_REVIEW** = `YES`
- **All authorization/scope counters** = `0` (no activation, no confirmation ceremony, no enforcement-ready, no runtime binding, no push, no commit)

## Scope delivered
| Deliverable | Path | Status |
|---|---|---|
| Registry migration (4 tables + guards + RLS + hardening) | `supabase/migrations/20260904000000_constitution_registry.sql` | implemented, uncommitted |
| Constitutional domain types + assertions | `src/core/constitution/types.ts` | implemented, uncommitted |
| Narrow read + privileged write interfaces | `src/core/constitution/ports.ts` | implemented, uncommitted |
| Postgres implementation (advisory lock 74740) | `src/db/constitutionRepo.ts` | implemented, uncommitted |
| MemoryStore parity (same transition semantics) | `src/testing/memoryStore.ts` (constitution section) | implemented, modified, uncommitted |
| S1 unit suite (27 tests) | `src/core/constitution/registry.test.ts` | 27/27 pass |

## Frozen S1 decisions honored
PAYLOAD_AND_GOVERNANCE_SEPARATED=YES · IMMUTABLE_GOVERNANCE_HISTORY=YES · CURRENT_STATE_IS_PROJECTION_ONLY=YES · REVOCATION_EPOCH_LOCATION=RUNTIME_STATE · ENFORCEMENT_READY_AS_IMMUTABLE_EVENT=YES · ACTIVATION_BINDS_RUNTIME_ARTIFACT_IDENTITY=YES · GENERIC_AUDIT_IS_CONSTITUTIONAL_SOURCE_OF_TRUTH=NO · LIVE_GIT_DIRECTORY_REQUIRED_AT_RUNTIME=NO · SECOND_IN_SYSTEM_OWNER_CONFIRMATION=YES · DEDICATED_CONSTITUTIONAL_ACTIVATION_CEREMONY=YES · LEGACY_MISSIONS_REQUIRE_EXPLICIT_HANDLING_AT_FIRST_ACTIVATION=YES.
No `project_id` exists on any constitutional table. Agents/models/workers are not governance actors (`actor_type in ('owner','system')`, runtime-checked in both implementations and schema-check-constrained).

## Transition semantics (Postgres + Memory identical)
- Every write is all-or-nothing: `BEGIN → pg_advisory_xact_lock(74740,1) → preconditions → [event insert(s)] → [runtime_state update] → COMMIT`, ROLLBACK on every non-success path; advisory lock released at transaction end (matches neighbors 74738/74739).
- `bootstrapRecordVersion` — idempotent (`recorded | already_exists`); payload identity immutable.
- `confirmSystemRatification` — owner-only; idempotent (`confirmed | already_confirmed | version_not_found`); writes exactly one `SYSTEM_RATIFICATION_CONFIRMED`, no fabricated ratification timestamp.
- `recordEnforcementReady` — trusted-system-only; gated on version + confirmation; idempotent (`recorded | already_recorded | version_not_found | not_confirmed`); inserts evidence row + `ENFORCEMENT_READY_RECORDED` atomically.
- `activateConstitution` / `rollbackToVersion` — owner-only; outcomes `activated | rolled_back | already_active | version_not_found | not_confirmed | no_enforcement_evidence | evidence_mismatch | expected_active_mismatch | conflict`. Outgoing pointer writes `SUPERSEDED` (evidence_id null) before the activation-family event. `already_active` only when the bound activation event references the same evidence_id, else `conflict`.
- `securityRevoke` — requires justification; retains the active pointer, bumps epoch by exactly one, appends `SECURITY_REVOKED` with epoch before/after +1; outcomes `revoked | no_active_constitution`.

## Verification
- S1 suite: 27/27 pass (key states asserted: idempotent replays never grow history; evidence must match the same constitution; epoch strictly non-decreasing; append-only; read queries return defensive copies; active pointer never cleared).
- Regression (unit, no live DB): gate41 (worker/global control), gate36v2 (delivery prepared-commit), gate39 (mission/task graphs), gate48 approval, gate47 identity/pending/atomic/content-binding, approval/auth/authority/security suites, gate28.concurrency + gate30.jsonb in isolation — all pass (summaries: 51 + 139 + 101 + 142 + 62 + 40 pass).
- Typecheck `tsc --noEmit`: PASS. Build `tsc -p tsconfig.build.json`: PASS.
- Secret scan of new/edited files: no secrets. Untracked residue (`src/integration/gate48.live.v2*.test.ts`, 5 files) untouched; STAGED=0.

## Red-team notes (S1)
- Schema enforces truth independently of the App: even a raw `UPDATE` of `constitution_runtime_state` cannot point at a hash lacking confirmation + evidence + an activation-type event, and cannot bump the epoch without a matching `SECURITY_REVOKED` in the same commit; pointer can never be cleared; epoch can never decrease.
- Guard triggers are `security definer` with static SQL (no dynamic SQL, no `EXECUTE`), performing only indexed SELECTs; event-before-pointer ordering inside one transaction is reliable (same-transaction row visibility).
- Defense-in-depth mirrored from audit hardening: `revoke truncate, trigger … from anon, authenticated`; RLS owner-read + `for all … with check(false)` no-write policies; append-only block triggers on all three immutable tables.
- Runtime artifact identity is persisted as provenance (`runtime_artifact_identity`, `runtime_code_commit_sha`, `build_provenance`) but never re-fingerprints live `.git` — anti-TOCTOU artifact verification is deferred to S2/S4 (LIVE_GIT_DIRECTORY_REQUIRED_AT_RUNTIME = NO).
- Generic `audit_events` is explicitly NOT a constitutional source of truth and is deferred to S3. Governance events are written and committed atomically with their state transitions — there is no allow-on-audit-failure path in the constitutional store.

## Deferred (intentional, per plan)
- S2/S3: artifact anti-TOCTOU verification, generic audit integration and reconciliation.
- S4: owner confirmation ceremony, enforcement-ready recording, dedicated activation ceremony (including explicit legacy-mission handling), second-in-system owner confirmation, and runtime gravity enforcement bindings.
- Production physical schema application was performed during the authorized production Phase 4 (schema physically present in production; zero synthetic governance residue). Disposable PATH B (injected `pg.Pool` into the real `ConstitutionRepo`) was used separately, and later, for real-repository D6–D11 behavioral validation on a disposable stack — it did not apply anything to production. Ledger registration of the migration remains NOT_PRESENT (nonblocking platform-process debt, not repaired).

## Validation status + next action
- Production Phase 4 physical schema application: PROVEN. Production Phases 0–6 structural verification: done. Zero production synthetic governance residue.
- Disposable PATH B real-repository D6–D11 behavioral validation (real `ConstitutionRepo` + injected local `pg.Pool`): ALL PASS — durable evidence package `docs/factory/evidence/s1-disposable/s1evidence-20260902-172054-bbf2f0/` (SHA256SUMS-verified; distinguishes disposable execution from production; records teardown + production non-contamination).
- Preclosure audit: S1_REGRESSIONS = 0, S1 registry tests 27/27 PASS, commit scope isolated, evidence VALID. Migration-ledger registration NOT_PRESENT = nonblocking platform-process debt (not repaired).
- S4 exact-same-hash reauthorization ceremony: DEFERRED (NOT implemented). No runtime enforcement authority introduced into S1.
- Next action: isolated local S1 closure commit. Push, S2, and Gate49 require separate and explicit authorization.