# Gate 4 Database Plan

> **READ-ONLY document. No SQL execution.**

---

## 1. Database Changes

**NONE.** Gate 4 does not modify the database schema.

Gate 3 migration `20260819000000_gate3_execution.sql` is frozen. No new migrations are authorized.

---

## 2. Justification

The three Gate 3 tables (conversations, conversation_messages, tools) are correctly designed:
- conversations: owner-scoped, RLS enforced, archivable
- conversation_messages: owner-scoped, append-only, RLS enforced
- tools: global read, admin-managed, RLS enforced

All Gate 4 fixes are in source code only:
- Loading conversation history from existing table
- Wiring securityGuard into existing ToolBroker
- Resolving authority using existing authority matrix

---

## 3. Schema State After Gate 3

| Metric | Count |
|--------|-------|
| Tables | 26 |
| Indexes | 66 |
| RLS Policies | 86 |
| Triggers | 33 |
| Functions | 11 |
| REVOKEs | 8 |

**No changes in Gate 4.**
