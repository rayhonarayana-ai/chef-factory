# Gate 4 API Plan

> **READ-ONLY document.**

---

## 1. API Changes

**NONE.** Gate 4 does not modify any API endpoints.

All fixes are internal to the pipeline and execution runner:
- `handlers.ts`: Internal change to load conversation history before pipeline
- `execution.ts`: Internal change to wire securityGuard and authority
- `pipeline.ts`: Internal change to accept conversation history

---

## 2. Existing Endpoints (Unchanged)

| Endpoint | Method | Gate 4 Change |
|----------|--------|---------------|
| /api/chat | POST | None (conversation_id already supported) |
| /api/conversations | GET | None |
| /api/conversations/:id | GET | None |
| /api/conversations/:id | DELETE | None |
| All other endpoints | — | None |

---

## 3. Internal Changes

### handlers.ts

```typescript
// BEFORE (Gate 3):
const result = await this.pipeline.run(actorCtx(), command);

// AFTER (Gate 4):
const history = convId
  ? await this.conversations.loadHistory(owner.id, convId)
  : [];
const result = await this.pipeline.run(actorCtx(), command, { conversationHistory: history });
```

### execution.ts

```typescript
// BEFORE (Gate 3):
const brokerResult = await broker.call(request, { decision: 'auto', approved: true });

// AFTER (Gate 4):
const authorityDecision = resolveAuthority(ctx, toolDef);
const brokerResult = await broker.call(request, {
  decision: authorityDecision,
  approved: authorityDecision !== 'require_approval',
  securityGuard: guardianFn,
});
```
