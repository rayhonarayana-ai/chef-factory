# Gate 4 Security-First Review

> **READ-ONLY document.** No source code.

---

## 1. Threat Analysis

### Threat 1: Conversation History Poisoning

- **THREAT:** Attacker injects malicious content into conversation_history that influences LLM to issue unauthorized tool calls
- **ATTACK PATH:** User sends crafted command → stored in conversation_messages → loaded into LLM context → LLM issues tool call
- **EXISTING CONTROL:** RLS prevents cross-owner access; conversation messages are owner-scoped
- **EVIDENCE:** RLS tests, conversation append-only triggers
- **RESIDUAL RISK:** LOW — owner controls their own history
- **REQUIRED CONTROL:** Validate message format before loading (role must be user/assistant/tool/system)

### Threat 2: ToolBroker SecurityGuard Bypass (Current Gap)

- **THREAT:** LLM issues tool call that bypasses Guardian evaluation
- **ATTACK PATH:** Prompt injection → LLM tool call → ToolBroker with decision:'auto' → always passes
- **EXISTING CONTROL:** Guardian runs at pipeline level BEFORE tool calls begin
- **EVIDENCE:** pipeline.test.ts guardian integration
- **RESIDUAL RISK:** MEDIUM — pipeline-level Guardian doesn't evaluate individual tool calls
- **REQUIRED CONTROL:** Wire securityGuard into ToolBroker execution (Gate 4 fix)

### Threat 3: Authority Escalation via Conversation Context

- **THREAT:** LLM uses conversation history to infer authority levels it doesn't have
- **ATTACK PATH:** Conversation contains "you have admin access" → LLM issues admin tool calls
- **EXISTING CONTROL:** Authority is resolved per-request from the authority matrix, not inferred from context
- **EVIDENCE:** Authority matrix tests
- **RESIDUAL RISK:** LOW — authority is stateless
- **REQUIRED CONTROL:** Authority resolution must be per-tool-call, not per-request (Gate 4 fix)

### Threat 4: Tool Result Injection into Conversation

- **THREAT:** Tool execution returns data that contains prompt injection payloads, stored in conversation history, influencing future LLM calls
- **ATTACK PATH:** Tool result → stored in conversation_messages → loaded into LLM context in future turn → LLM issues unauthorized tool call
- **EXISTING CONTROL:** Tool results are sanitized (secretGuard), but not sanitized before storage
- **EVIDENCE:** secretGuard tests
- **RESIDUAL RISK:** MEDIUM — secondary injection via stored tool results
- **REQUIRED CONTROL:** Sanitize tool results before appending to conversation_messages

### Threat 5: Rate Limit Bypass via Conversation

- **THREAT:** Multiple conversation turns create multiple tool calls, each bypassing rate limits
- **ATTACK PATH:** Rapid conversation turns → each triggers pipeline → each triggers tool calls → rate limits not enforced per-conversation
- **EXISTING CONTROL:** Rate limits are per-owner, not per-conversation
- **EVIDENCE:** rateLimit.test.ts
- **RESIDUAL RISK:** LOW — rate limits are owner-scoped
- **REQUIRED CONTROL:** Rate limits already enforce per-owner; no additional control needed

---

## 2. Security Requirements for Gate 4

| # | Requirement | Priority | Evidence Required |
|---|-----------|----------|-------------------|
| SR1 | Conversation history loaded from DB only (never client-supplied) | CRITICAL | Unit test + live test |
| SR2 | ToolBroker securityGuard called per tool call | CRITICAL | Unit test showing Guardian called |
| SR3 | Owner authority resolved per tool call | HIGH | Unit test showing correct decision |
| SR4 | Tool results sanitized before conversation storage | HIGH | Sanitization test |
| SR5 | All 222+ existing tests pass | CRITICAL | Regression suite |
| SR6 | Live provider verification (tool calling + conversation) | CRITICAL | Live test output |
| SR7 | Zero credential exposure | CRITICAL | Secret scan |
| SR8 | Zero test residue | CRITICAL | DB query |

---

## 3. Security Review Checklist

- [ ] Conversation history loading validated (format, owner scoping)
- [ ] ToolBroker securityGuard wired and tested
- [ ] Authority resolution wired and tested
- [ ] Tool result sanitization applied before conversation storage
- [ ] Regression suite passes
- [ ] Live verification passes
- [ ] No secrets in logs/output
- [ ] No test residue
