# Gate 3 Forensic Closure

> **Date:** 2026-08-17
> **Baseline:** FROZEN
> **Classification:** GATE_3_PASS

---

## 1. Forensic Audit Summary

A read-only forensic audit was performed on the actual repository, comparing source code, database schema, tests, documentation, and live evidence.

---

## 2. Drift Detection Results

| # | Finding | Type | Severity | Classification |
|---|---------|------|----------|----------------|
| 1 | conversation_messages FK: doc says auth.users, actual is public.owners | DOCUMENTATION_DRIFT | LOW | Doc outdated; actual is more correct |
| 2 | conversation_messages extra columns (name, token_count): doc lacks these | DOCUMENTATION_DRIFT | LOW | Doc outdated; actual is richer |
| 3 | Seed INSERT has ON CONFLICT DO NOTHING; doc omits this | DOCUMENTATION_DRIFT | LOW | Doc less robust; actual is safer |
| 4 | ToolBroker.initialize() described in doc; actual is initializeToolBroker() | DOCUMENTATION_DRIFT | MEDIUM | Doc describes non-existent API |
| 5 | execution.ts path: doc says src/services/, actual is src/api/ | DOCUMENTATION_DRIFT | LOW | Doc path incorrect |
| 6 | conversation.ts path: doc says src/services/, actual is src/core/ | DOCUMENTATION_DRIFT | LOW | Doc path incorrect |
| 7 | ToolBroker securityGuard not wired in execution loop | SOURCE_DRIFT | HIGH | Security gap — see §3 |
| 8 | ToolBroker broker.call() uses decision:'auto' (bypasses authority check) | SOURCE_DRIFT | HIGH | Authority bypass — see §3 |
| 9 | Conversation history not loaded into LLM pipeline | SOURCE_DRIFT | CRITICAL | Multi-turn broken — see §3 |
| 10 | Test count: doc says ~65 new, actual is 41 | DOCUMENTATION_DRIFT | LOW | Aspirational target not met |
| 11 | Test total: doc says ~249, actual is 222 | DOCUMENTATION_DRIFT | LOW | Aspirational target not met |
| 12 | API plan create_project schema shows "required": ["name","slug"], actual only requires ["name"] | DOCUMENTATION_DRIFT | LOW | Doc is more restrictive |
| 13 | Critical actions API returns version:1, but registry version is 2 | DOCUMENTATION_DRIFT | LOW | API handler returns hardcoded 1 |
| 14 | Vocabulary alignment: doc says "mapping layer in pipeline.ts", actual is direct key change in registry | DOCUMENTATION_DRIFT | LOW | Doc describes wrong approach |

---

## 3. Critical Drift Findings (Detail)

### Finding 9: Conversation History Not Fed to LLM — CRITICAL

**Evidence:**
- `src/api/handlers.ts:80`: `const result = await this.pipeline.run(actorCtx(), command);`
- `src/api/execution.ts:151-154`: messages array is `[system, user]` — no history loaded
- `src/core/conversation.ts`: `loadHistory()` exists but is NEVER CALLED from execution path
- Live test passed because test script manually built messages with history

**Impact:** Multi-turn conversation is a dead feature. Messages are persisted but never loaded.

**Gate 4 Requirement:** Wire `loadHistory()` into the execution pipeline.

### Finding 7-8: ToolBroker Security Bypass — HIGH

**Evidence:**
- `src/api/execution.ts:270-284`: `initializeToolBroker()` does not accept securityGuard
- `src/api/execution.ts:214-217`: `broker.call()` uses `{ decision: 'auto', approved: true }`
- `src/gateways/toolBroker.ts:45-46`: `if (ctx.decision === 'deny')` — always false for 'auto'
- `src/gateways/toolBroker.ts:57-68`: `if (ctx.securityGuard)` — always false (undefined)

**Impact:** Individual tool calls inside the execution loop bypass authority and security checks. The Guardian IS called at pipeline level, but NOT per-tool-call.

**Gate 4 Requirement:** Wire securityGuard and proper authority resolution into ToolBroker execution.

---

## 4. No-Drift Confirmations

| Area | Status |
|------|--------|
| Gate 2 regression tests (181/181) | NO_DRIFT |
| SQL/RLS tests (17/17) | NO_DRIFT |
| Typecheck | NO_DRIFT |
| Build | NO_DRIFT |
| Provider adapter tool format (OpenAI) | NO_DRIFT |
| Provider adapter tool format (Anthropic) | NO_DRIFT |
| Provider adapter tool format (Google) | NO_DRIFT |
| Critical action vocabulary alignment | NO_DRIFT |
| Loop protection (FACTORY_MAX_TOOL_ROUNDS=10) | NO_DRIFT |
| Secret redaction | NO_DRIFT |
| Tool handler implementations (5 tools) | NO_DRIFT |
| Tool handler DbQuery injection | NO_DRIFT |
| Conversation table schema | NO_DRIFT |
| Conversation RLS policies | NO_DRIFT |
| Conversation append-only triggers | NO_DRIFT |
| Tools table schema | NO_DRIFT |
| Migration applied to live DB | NO_DRIFT |
| Live OpenAI tool calling | NO_DRIFT |
| Test residue = ZERO | NO_DRIFT |

---

## 5. Closure Declaration

```
GATE_3_BASELINE = FROZEN
GATE_3_FREEZE = ACTIVE
GATE_3_CLOSURE_DATE = 2026-08-17T00:23:58.173Z
```

The freeze means:
- No source modifications to Gate 3 files
- No database modifications
- No migration changes
- No test modifications
- No deployment
- No Gate 4 implementation

Historical failures are preserved. Drift findings are documented for Gate 4.
