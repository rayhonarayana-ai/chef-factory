# GATE 18 — EVIDENCE MATRIX

## Baseline

| Requirement | Test/Command | Expected | Actual | Evidence | Status |
|-------------|--------------|----------|--------|----------|--------|
| Baseline tests | `vitest run` | 716/716 PASS | 716/716 PASS | Pre-implementation run | PASS |
| Baseline tsc | `tsc --noEmit` | CLEAN | CLEAN | Pre-implementation run | PASS |

## ConversationService Boundary

| Requirement | Test/Command | Expected | Actual | Evidence | Status |
|-------------|--------------|----------|--------|----------|--------|
| Accepts Store via constructor | G18-CONV-05a | Constructed | Constructed | conversation.test.ts:241 | PASS |
| Uses injected Store, not global | G18-CONV-05b | Independent stores | Independent stores | conversation.test.ts:247 | PASS |
| No getPool import | Source inspection | No import | No import | conversation.ts:3 imports Store | PASS |

## Store Usage

| Requirement | Test/Command | Expected | Actual | Evidence | Status |
|-------------|--------------|----------|--------|----------|--------|
| createConversation delegates to Store | G18-CONV-01a | Delegates | Delegates | conversation.test.ts:30 | PASS |
| getConversation delegates to Store | G18-CONV-01c | Delegates | Delegates | conversation.test.ts:50 | PASS |
| listConversations delegates to Store | G18-CONV-01e | Delegates | Delegates | conversation.test.ts:64 | PASS |
| archiveConversation delegates to Store | G18-CONV-01f | Delegates | Delegates | conversation.test.ts:72 | PASS |
| appendMessage delegates to Store | G18-CONV-02a | Delegates | Delegates | conversation.test.ts:85 | PASS |
| loadHistory delegates to Store | G18-CONV-02c | Delegates | Delegates | conversation.test.ts:110 | PASS |

## DRY Fix

| Requirement | Test/Command | Expected | Actual | Evidence | Status |
|-------------|--------------|----------|--------|----------|--------|
| handlers.ts uses injected store | G18-CONV-12a | Same store | Same store | conversation.test.ts:330 | PASS |
| streaming.ts uses injected store | Source inspection | store parameter | store parameter | streaming.ts:63 | PASS |

## Success Behavior

| Requirement | Test/Command | Expected | Actual | Evidence | Status |
|-------------|--------------|----------|--------|----------|--------|
| createConversation returns valid record | G18-CONV-01a | Valid record | Valid record | conversation.test.ts:30 | PASS |
| getConversation returns correct record | G18-CONV-01c | Correct record | Correct record | conversation.test.ts:50 | PASS |
| appendMessage returns valid message | G18-CONV-02a | Valid message | Valid message | conversation.test.ts:85 | PASS |
| loadHistory returns messages in order | G18-CONV-02c | Ordered | Ordered | conversation.test.ts:110 | PASS |

## Failure Behavior

| Requirement | Test/Command | Expected | Actual | Evidence | Status |
|-------------|--------------|----------|--------|----------|--------|
| createConversation propagates failure | G18-CONV-06a | Throws | Throws | conversation.test.ts:198 | PASS |
| getConversation propagates failure | G18-CONV-06b | Throws | Throws | conversation.test.ts:205 | PASS |
| appendMessage propagates failure | G18-CONV-06c | Throws | Throws | conversation.test.ts:212 | PASS |
| loadHistory propagates failure | G18-CONV-06d | Throws | Throws | conversation.test.ts:221 | PASS |
| archiveConversation propagates failure | G18-CONV-06e | Throws | Throws | conversation.test.ts:228 | PASS |
| listConversations propagates failure | G18-CONV-06f | Throws | Throws | conversation.test.ts:235 | PASS |

## Edge Cases

| Requirement | Test/Command | Expected | Actual | Evidence | Status |
|-------------|--------------|----------|--------|----------|--------|
| Empty content allowed | G18-CONV-09a | Passes | Passes | conversation.test.ts:296 | PASS |
| loadHistory with limit 0 | G18-CONV-09b | Returns all | Returns all | conversation.test.ts:303 | PASS |
| loadHistory with large limit | G18-CONV-09c | Returns all | Returns all | conversation.test.ts:310 | PASS |

## Owner Isolation

| Requirement | Test/Command | Expected | Actual | Evidence | Status |
|-------------|--------------|----------|--------|----------|--------|
| Owner cannot see other owner conversations | G18-CONV-03a | Isolated | Isolated | conversation.test.ts:130 | PASS |
| Owner cannot access other owner conversation | G18-CONV-03b | Null | Null | conversation.test.ts:139 | PASS |
| Owner cannot archive other owner conversation | G18-CONV-03c | False | False | conversation.test.ts:145 | PASS |

## Regression

| Requirement | Test/Command | Expected | Actual | Evidence | Status |
|-------------|--------------|----------|--------|----------|--------|
| Full test suite | `vitest run` | 749/749 PASS | 749/749 PASS | Post-implementation run | PASS |
| Gate 16 regression | gate16.persistence.test.ts | 12/12 PASS | 12/12 PASS | Included in full suite | PASS |
| Gate 17 regression | gate17.auditTrail.test.ts | 17/17 PASS | 17/17 PASS | Included in full suite | PASS |

## TypeScript

| Requirement | Test/Command | Expected | Actual | Evidence | Status |
|-------------|--------------|----------|--------|----------|--------|
| Type check | `tsc --noEmit` | CLEAN | CLEAN | Post-implementation run | PASS |

## Build

| Requirement | Test/Command | Expected | Actual | Evidence | Status |
|-------------|--------------|----------|--------|----------|--------|
| Compilation | `tsc` | CLEAN | CLEAN | Post-implementation run | PASS |

## Protected Invariants

| Requirement | Test/Command | Expected | Actual | Evidence | Status |
|-------------|--------------|----------|--------|----------|--------|
| No schema changes | `git diff` | No schema files | No schema files | git diff --stat | PASS |
| No auth changes | `git diff` | No auth files | No auth files | git diff --stat | PASS |
| No rate limit changes | `git diff` | No rate limit files | No rate limit files | git diff --stat | PASS |
| No anomaly changes | `git diff` | No anomaly files | No anomaly files | git diff --stat | PASS |
| No public API changes | Source inspection | Same endpoints | Same endpoints | handlers.ts unchanged endpoints | PASS |

## Runtime Verification

| Requirement | Test/Command | Expected | Actual | Evidence | Status |
|-------------|--------------|----------|--------|----------|--------|
| Unit tests prove behavior | 33 tests | All pass | All pass | conversation.test.ts | PASS |
| No live server test | — | — | — | RUNTIME = UNPROVEN | UNPROVEN |

## Summary

| Category | PASS | PARTIAL | BLOCKED | UNPROVEN |
|----------|------|---------|---------|----------|
| Baseline | 2 | 0 | 0 | 0 |
| Boundary | 3 | 0 | 0 | 0 |
| Store Usage | 6 | 0 | 0 | 0 |
| DRY Fix | 2 | 0 | 0 | 0 |
| Success | 4 | 0 | 0 | 0 |
| Failure | 6 | 0 | 0 | 0 |
| Edge Cases | 3 | 0 | 0 | 0 |
| Owner Isolation | 3 | 0 | 0 | 0 |
| Regression | 3 | 0 | 0 | 0 |
| TypeScript | 1 | 0 | 0 | 0 |
| Build | 1 | 0 | 0 | 0 |
| Protected | 5 | 0 | 0 | 0 |
| Runtime | 0 | 0 | 0 | 1 |
| **TOTAL** | **39** | **0** | **0** | **1** |
