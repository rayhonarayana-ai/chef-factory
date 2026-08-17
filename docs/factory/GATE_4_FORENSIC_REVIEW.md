# Gate 4 Forensic Review

> **READ-ONLY document.**

---

## 1. Review Scope

This review examines Gate 4 planning for:
- Consistency with Gate 1/2/3 foundations
- Security completeness
- Correct identification of Gate 3 drift
- Risk assessment for proposed fixes

---

## 2. Gate 3 Drift Verification

### Finding 1: Conversation History Not Loaded — CONFIRMED

**Source evidence:**
- `handlers.ts:80`: `this.pipeline.run(actorCtx(), command)` — no history parameter
- `execution.ts:151-154`: messages = `[system, user]` — no history
- `conversation.ts:158`: `loadHistory()` exists but is NEVER CALLED from execution path

**Classification:** SOURCE_DRIFT (architecture doc describes behavior not implemented)

### Finding 2: ToolBroker SecurityGuard Not Wired — CONFIRMED

**Source evidence:**
- `execution.ts:270`: `initializeToolBroker(store, db)` — no securityGuard param
- `execution.ts:214-217`: `broker.call()` with `{ decision: 'auto', approved: true }` — no securityGuard
- `toolBroker.ts:57`: `if (ctx.securityGuard)` — always false (undefined)

**Classification:** SOURCE_DRIFT

### Finding 3: ToolBroker Authority Bypassed — CONFIRMED

**Source evidence:**
- `execution.ts:215`: `decision: 'auto'` — always passes authority check
- `toolBroker.ts:45-46`: `if (ctx.decision === 'deny')` — always false for 'auto'

**Classification:** SOURCE_DRIFT

---

## 3. Gate 4 Fix Assessment

### Fix 1: Conversation History Loading — SOUND

- Loading from DB (not client) is correct
- Windowing to N messages is correct
- Owner scoping via RLS is correct
- No schema changes needed
- **Risk:** LOW — additive change to existing flow

### Fix 2: SecurityGuard Wiring — SOUND

- Per-tool-call Guardian is defense-in-depth
- Pipeline-level Guardian remains (double-guardian)
- ToolBroker already has securityGuard hook (just not wired)
- **Risk:** MEDIUM — Guardian may deny legitimate tool calls if misconfigured

### Fix 3: Authority Resolution — SOUND

- Authority matrix already exists and works
- Resolution before ToolBroker is correct layer
- ToolBroker receives actual decision, not 'auto'
- **Risk:** LOW — authority matrix is proven

---

## 4. Security Assessment

| Threat | Gate 4 Mitigation | Residual Risk |
|--------|-------------------|---------------|
| Conversation poisoning | RLS + owner scoping | LOW |
| ToolBroker security bypass | Per-tool Guardian | LOW |
| Authority escalation | Per-tool resolution | LOW |
| Tool result injection | Sanitization before storage | MEDIUM |
| Rate limit bypass | Already per-owner | LOW |

---

## 5. Recommendation

**GATE_4_ARCHITECTURE = APPROVED_FOR_IMPLEMENTATION**

The Gate 4 scope is correctly identified, the fixes are sound, and the security improvements are necessary. No architectural redesign is required. The three fixes are minimal, targeted, and preserve all existing functionality.
