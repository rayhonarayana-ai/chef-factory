# CHEF FACTORY — DECISION JOURNAL (Gate 1 Core)

**Component:** Decision Journal
**Status:** IMPLEMENTED / TESTED / LIVE_VERIFIED (schema)

## Purpose
Persistence of decision records (structure per Master Reference §18). Every significant
decision is recorded with context, options, selected option, reason, evidence,
confidence, risk level, authority level, and outcome.

## Rules (`src/core/decisionJournal.ts`)
- `validateDecision(input)` — context is required; ambiguity must never be converted into
  fabricated certainty (the `UNKNOWN` rule).
- `toDecisionRecord(input)` — normalizes to a `DecisionRecord`.
- `decisionDigest(d)` — safe, secret-free digest for display.
- Context text is redacted through `redactText` before persistence (pipeline path).

## Persistence
- `Store.recordDecision(ownerId, decision)` — append-only `decision_journal`.
- `Store.listDecisions(ownerId)` — owner-scoped read.

## Tests
- `src/core/decisionJournal.test.ts` — validation, normalization, digest safety.
- `src/core/pipeline.test.ts` — pipeline records decisions with redacted context.
