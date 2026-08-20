# Gate 20 — Owner Decisions

## OD33: Approve Tool Schema Correctness + Approval Timeout as Gate 20 Mission?

**Question:** Should Gate 20 implement Mission A (fix tool definition status enums + wire approval expiry)?

**Recommendation:** Yes

**Rationale:**
- Highest user-facing impact (every LLM interaction)
- Lowest risk (schema change + validation)
- Trivial to test
- Pre-existing bug, not introduced by Gate 19

## OD34: Bundle Stuck-Task Detection into Gate 20?

**Question:** Should Mission B (stuck-task detection) be bundled into Gate 20?

**Recommendation:** No — defer to Gate 21

**Rationale:**
- Requires new Store methods + queries
- Higher blast radius than Mission A
- Less user-facing impact
- Better as a focused Gate 21 mission

## OD35: Bundle Live Test Deadlock Fix into Gate 20?

**Question:** Should Mission C (deadlock fix + MemoryStore query fix) be bundled into Gate 20?

**Recommendation:** Yes (low risk, easy to test)

**Rationale:**
- Fixes a real test failure (845/846 → 846/846)
- MemoryStore query fix improves test correctness
- Trivial complexity

## OD36: Bundle Code Quality Cleanup into Gate 20?

**Question:** Should Mission D (dead interfaces, duplicate types, duplicated logic) be bundled into Gate 20?

**Recommendation:** No — defer to Gate 21+

**Rationale:**
- Type rename has cross-file impact
- Lower value than A and C
- Better as a focused cleanup gate
