# CHEF FACTORY — GATE 2 — SECRET GUARD

**Component:** Secret protection boundary
**Status:** IMPLEMENTED / TESTED

## Purpose
Deterministic scanning of ANY string/value for secret shapes BEFORE it is persisted or
logged. Combined with Gate 1 redaction (`src/core/redact.ts`) and the `SecretProvider`
boundary. Secrets never reach: audit_events, task descriptions, decision journals,
model prompts, logs, error messages, chat history, agent memory, Git, todo.md, or
documentation.

## Detected shapes (`scanForSecrets`)
| label | pattern |
|---|---|
| jwt | `eyJ…` 3 dot-separated segments (≥8 chars each) |
| supabase_token | `sbp_` / `sb_` tokens |
| openai_key | `sk-` + ≥6 chars |
| key_value_secret | `password|passwd|pwd|secret|token|api[_ -]?key|access[_ -]?key|bearer = value` |

Returns `{ leaked: string[], redacted, clean }` — labels only, never the value.

## Deep scan (`deepScanForSecrets`)
Walks any JSON-serializable value:
- String values scanned with `scanForSecrets`.
- Object keys in `[password, secret, token, apiKey, api_key, authorization, bearer]`
  are flagged as `key_<name>` regardless of value.
- Returns `{ findings: [{ path, label }], clean }`.

## Guarantees
- Deterministic; reveals labels, never values.
- Used by security events: `toSecurityEventRecord` redacts `reason` and metadata.

## Tests
- `src/core/security/securityGuardian.test.ts` — key-value, JWT, OpenAI key shapes.
- `src/integration/security.live.integration.test.ts` — a recorded secret-access event
  contains no secret value after round-trip.

---
**END OF GATE 2 SECRET GUARD.**
