# Gate 3 Security Threat Model

> **READ-ONLY document.** No source code.

---

## 1. Gate 3 Security Context

Gate 3 adds tool calling and conversation context. This introduces new attack surfaces:

- LLM can request tool calls that perform database operations
- Tool calls must be authorized before execution
- Conversation history is stored and must be protected
- Tool schemas are sent to external LLM providers

---

## 2. Threat Model

### Threat 1: Tool Call Authorization Bypass

- **THREAT:** LLM returns `tool_call` for action the owner hasn't authorized
- **ATTACK SURFACE:** Tool execution pipeline
- **IMPACT:** Unauthorized database operations
- **MITIGATION:** ToolBroker enforces authority matrix + risk assessment + security Guardian check BEFORE execution
- **DETECTION:** Audit log records every tool call attempt with authorization result
- **EVIDENCE:** `ToolBroker.test.ts` authority check tests
- **RESIDUAL RISK:** LOW — ToolBroker is already tested with mock tools

### Threat 2: Malicious LLM Tool Call Injection

- **THREAT:** Prompt injection causes LLM to issue unauthorized tool calls
- **ATTACK SURFACE:** Prompt injection via user input or tool results
- **IMPACT:** Data exfiltration, unauthorized modifications
- **MITIGATION:** ToolBroker validates tool name against whitelist; Guardian `promptInjection` check runs before execution; tool args are sanitized
- **DETECTION:** Security events logged for injection attempts
- **EVIDENCE:** `promptInjection.test.ts`, `securityGuardian.test.ts`
- **RESIDUAL RISK:** MEDIUM — prompt injection is hard to fully prevent

### Threat 3: Conversation History Leakage

- **THREAT:** Conversation messages stored in DB could be accessed by unauthorized users
- **ATTACK SURFACE:** `conversation_messages` table access
- **IMPACT:** Owner's private conversations exposed
- **MITIGATION:** RLS on `conversation_messages` (owner-scoped); `conversations` table also owner-scoped
- **DETECTION:** RLS tests
- **EVIDENCE:** SQL RLS tests (new S8+)
- **RESIDUAL RISK:** LOW — RLS is proven in Gate 1/2

### Threat 4: Tool Schema Exposure to External Providers

- **THREAT:** Tool definitions (names, parameters, descriptions) sent to OpenAI/Anthropic/Google
- **ATTACK SURFACE:** Tool schema construction in `execution.ts`
- **IMPACT:** Provider sees CHEF's internal tool structure
- **MITIGATION:** Tool schemas contain only names and typed parameters, no secrets; schemas are public API-like
- **DETECTION:** None needed — by design
- **EVIDENCE:** `execution.ts` tool schema construction
- **RESIDUAL RISK:** LOW — schemas are structural, not sensitive

### Threat 5: Tool Execution Cost Abuse

- **THREAT:** LLM repeatedly calls expensive tools (e.g., `create_project` in a loop)
- **ATTACK SURFACE:** Tool execution rate and frequency
- **IMPACT:** Excessive database operations, cost
- **MITIGATION:** Rate limits on `tool.call` (100/hour); cost protection on `model.call` (200/hour); TaskEngine max 3 attempts
- **DETECTION:** Rate limit counters, cost events
- **EVIDENCE:** `rateLimit.test.ts`, `cost.test.ts`
- **RESIDUAL RISK:** LOW — rate limits are already wired

### Threat 6: Conversation Context Manipulation

- **THREAT:** User sends crafted conversation history to influence LLM
- **ATTACK SURFACE:** Client-provided conversation context
- **IMPACT:** LLM makes unauthorized decisions based on fake context
- **MITIGATION:** Conversation history is loaded from DB (not client-supplied); client only sends `conversation_id`; history is verified owner-scoped
- **DETECTION:** None needed — server-side loading
- **EVIDENCE:** Conversation loading code
- **RESIDUAL RISK:** LOW — server-side only

### Threat 7: Tool Result Injection into LLM

- **THREAT:** Tool execution returns data that contains prompt injection payloads
- **ATTACK SURFACE:** Tool results fed back into LLM context
- **IMPACT:** LLM issues unauthorized follow-up tool calls
- **MITIGATION:** Tool results are sanitized before being fed back to LLM; Guardian re-evaluates after tool execution
- **DETECTION:** Security events for injection in tool results
- **EVIDENCE:** `secretGuard.test.ts`, `promptInjection.test.ts`
- **RESIDUAL RISK:** MEDIUM — secondary injection is hard to fully prevent

### Threat 8: Vocabulary Alignment Bypass

- **THREAT:** Aligning critical action vocabulary could accidentally weaken existing protections
- **ATTACK SURFACE:** Vocabulary alignment mapping layer
- **IMPACT:** Previously protected actions become unprotected
- **MITIGATION:** Vocabulary alignment is additive (new keys mapped to existing pipeline `actionTypes`); old `PROTECTED_ACTION_TYPES` remain; both systems checked
- **DETECTION:** Regression tests verify all existing protections still work
- **EVIDENCE:** `authority.test.ts`, `securityGuardian.test.ts`
- **RESIDUAL RISK:** LOW — additive change with regression tests

### Threat 9: Multi-Turn Authority Escalation

- **THREAT:** LLM uses conversation context to infer authority it doesn't have
- **ATTACK SURFACE:** Multi-turn conversation flow
- **IMPACT:** Actions executed that shouldn't be
- **MITIGATION:** Authority is evaluated PER REQUEST, not inferred from context; conversation context is for LLM understanding, not authorization
- **DETECTION:** Audit log shows authority evaluation per request
- **EVIDENCE:** `pipeline.test.ts` authority tests
- **RESIDUAL RISK:** LOW — authority is stateless per request

### Threat 10: Tool Registry Tampering

- **THREAT:** Malicious modification of tool registry (`tools` table)
- **ATTACK SURFACE:** `tools` table access
- **IMPACT:** Unauthorized tools registered, or legitimate tools removed
- **MITIGATION:** Tools table is RLS-protected (owner-scoped); tool registry is append-only in Gate 3 (no update/delete API); DB trigger prevents modification
- **DETECTION:** Audit log for any tool registry changes
- **EVIDENCE:** `tools` table RLS + trigger
- **RESIDUAL RISK:** LOW — append-only with RLS

---

## 3. Security Requirements for Gate 3

| # | Requirement | Priority | Evidence Required |
|---|-----------|----------|-------------------|
| SR1 | Every tool call goes through ToolBroker | CRITICAL | `ToolBroker.test.ts` |
| SR2 | ToolBroker enforces authority matrix | CRITICAL | `authority.test.ts` |
| SR3 | ToolBroker enforces risk assessment | CRITICAL | risk tests |
| SR4 | ToolBroker enforces Guardian check | CRITICAL | `securityGuardian.test.ts` |
| SR5 | Tool names are whitelisted | HIGH | tool registry tests |
| SR6 | Tool args are typed and validated | HIGH | tool schema tests |
| SR7 | Conversation messages are owner-scoped (RLS) | CRITICAL | SQL RLS tests |
| SR8 | Conversation history loaded from DB, not client | CRITICAL | conversation tests |
| SR9 | Tool results sanitized before LLM feedback | HIGH | sanitization tests |
| SR10 | Critical action vocabulary aligned | CRITICAL | regression tests |
| SR11 | All existing Gate 1/2 tests pass | CRITICAL | regression suite |
| SR12 | Rate limits enforced on tool calls | HIGH | rate limit tests |

---

## 4. Security Review Checklist (Before Gate 3 Implementation)

- [ ] ToolBroker authority checks verified
- [ ] ToolBroker risk checks verified
- [ ] ToolBroker Guardian integration verified
- [ ] Conversation RLS policies written and tested
- [ ] Tool registry append-only enforced
- [ ] Vocabulary alignment tested (old protections preserved)
- [ ] Regression suite passes (181+ tests)
- [ ] Prompt injection defense tested with tool calls
- [ ] Secret guard tested with tool results
- [ ] All security events logged for tool calls
