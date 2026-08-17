# CHEF FACTORY — Gate 10 Forensic Review

> Date: 2026-08-17
> Scope: Full architectural forensic audit post-Gate 9
> Method: Static analysis of all source files (read-only)

---

## Forensic Method

Three parallel audit agents analyzed the complete codebase:
1. **Core Agent:** Pipeline, Execution, Orchestration, Types, Ports, TaskEngine, Intent, Authority, Autonomy, Approval, Explanation, Redact, Cost
2. **Security Agent:** Guardian, RateLimiter, AnomalyDetector, ToolBroker, all Tools, all Gateways, all Adapters, SecretProvider
3. **API Agent:** Server, Handlers, Auth, DB (SupabaseStore, Pool, Config), ConversationService, MemoryStore, Tests

Total files analyzed: 55+
Total source lines: ~8,000+

---

## Section 1: Source File Inventory

| Category | Files | Total Lines |
|----------|-------|-------------|
| Core (pipeline, types, ports, etc.) | 13 | ~2,700 |
| Security (guardian, rateLimit, anomaly) | 4 | ~650 |
| Execution (execution.ts, orchestration.ts) | 2 | ~1,160 |
| Tools (index, 6 handlers, query-engine) | 9 | ~1,050 |
| Gateways (model, runtime, broker, adapters) | 8 | ~560 |
| API (server, handlers, auth, security, redact) | 5 | ~730 |
| DB (repo, config, pool) | 3 | ~830 |
| Conversation (conversation.ts) | 1 | ~180 |
| Testing (memoryStore) | 1 | ~290 |
| **Total** | **46** | **~8,150** |

---

## Section 2: Bypass Path Analysis

### Checked paths:

| Path | Result |
|------|--------|
| Pipeline → execution.execute() bypassing orchestration | NOT POSSIBLE — detectMultiStepCommand gates the path |
| ToolBroker without Guardian | POSSIBLE but mitigated — pipeline always wires Guardian |
| execute=true vs execute=false distinction | execute=false does NOT run handler (correct behavior) |
| Authority bypass | NOT POSSIBLE — evaluateAuthority called in all execution paths |
| Rate limit bypass | NOT POSSIBLE — checked at loop entry AND on failures |
| Cost limit bypass | NOT POSSIBLE — checked at pipeline level before execution |
| Owner isolation bypass | NOT POSSIBLE — all Store methods filter by owner_id |

### Remaining risk:

The only bypass path is constructing a `ToolBrokerContext` without `securityGuard` (toolBroker.ts:59). This is an internal API concern, not an external vulnerability. The pipeline always wires the Guardian.

---

## Section 3: Dead Code Analysis

| Item | Location | Status |
|------|----------|--------|
| `transitionTask()` | taskEngine.ts:41 | Exported but unused in pipeline |
| `broker.run()` path | toolBroker.ts:84-86 | Never reached (execute always false) |
| `tokenCount` field | conversation.ts:26, migration:61 | Schema exists but never populated |
| `recall()` method | repo.ts:530 | Returns empty array (stub) |
| `memoryGateway` | memoryGateway.ts | Inert (no backend configured) |

No dead code that affects security or reliability.

---

## Section 4: Unbounded Operations

| Operation | Location | Risk |
|-----------|----------|------|
| Conversation history (DB storage) | conversation.ts:appendMessage | LOW — DB has storage limits |
| `loadHistory()` SQL fetch | conversation.ts:159 | MEDIUM — fetches ALL rows |
| RateLimiter.windows Map | rateLimit.ts:34 | MEDIUM — no eviction |
| entityQueryCounts Map | query-data.ts:102 | MEDIUM — no eviction |
| concurrentQueries Map | query-data.ts:121 | MEDIUM — no eviction |
| Pipeline raw command | pipeline.ts:158 | HIGH — no length limit |
| API request body | server.ts:116 | HIGH — no size limit |
| List queries (no LIMIT) | repo.ts various | MEDIUM — unbounded rows |

---

## Section 5: Exception Handling Audit

| Location | Behavior | Assessment |
|----------|----------|------------|
| pipeline.ts:162 | recordAudit throws → unhandled | HIGH — blocks entire run() |
| pipeline.ts:201 | getProjectBySlug throws → unhandled | HIGH — blocks project resolution |
| orchestration.ts:471 | tool handler throws → caught, step failed | OK |
| execution.ts:507-524 | tool handler throws → caught, anomaly noted | OK |
| toolBroker.ts:77-82 | tool.run() throws → caught, safeSummary attempted | OK (no try/catch on parse) |
| conversation.ts:51-56 | pool.query throws → propagated | OK (caller handles) |

**Key gap:** Store failures in pipeline.ts are not caught, causing unhandled exceptions before any logic executes.

---

## Section 6: Type Safety Audit

| Pattern | Count | Risk |
|---------|-------|------|
| `as unknown as Record<string, unknown>` | 5 | LOW — data serialization |
| `as import(...)` | 8 | LOW — module type reference |
| `as 'owner' \| 'agent'` | 3 | LOW — union narrowing |
| `as SecurityScopeKey` | 4 | LOW — scope key assertion |
| Non-null assertions (`!`) | 2 | LOW — after null check |

No `as any` casts found. Type safety is good.

---

## Section 7: Security Invariant Verification

| Invariant | Gate | Status |
|-----------|------|--------|
| ToolBroker validate-only (execute=false) | G5-01 | ✅ PRESERVED |
| Guardian optional in ToolBroker | G5-02 | ⚠️ OPTIONAL (not mandatory) |
| Authority per-tool-call | G5-03 | ✅ PRESERVED |
| Rate limiting at loop entry | G5-04 | ✅ PRESERVED |
| Anomaly detection on failures | G5-05 | ✅ PRESERVED |
| Owner isolation in Store | G5-07 | ✅ PRESERVED |
| Orchestration engine reachable | G9-01 | ✅ VERIFIED |
| Plan steps use real tools | G9-02 | ✅ VERIFIED |
| No bypass paths | G9-03 | ✅ VERIFIED |

---

## Section 8: Provider Adapter Audit

### OpenAI Adapter (openai.ts — 72 lines)
- fetch() without AbortSignal — **NO TIMEOUT**
- Throws on any non-OK status — **NO RETRY**
- No circuit breaker pattern
- Malformed response → graceful degradation (optional chaining)

### Anthropic Adapter (anthropic.ts — 85 lines)
- fetch() without AbortSignal — **NO TIMEOUT**
- Throws on any non-OK status — **NO RETRY**
- No circuit breaker pattern
- Malformed response → graceful degradation

### Google Adapter (google.ts — 97 lines)
- fetch() without AbortSignal — **NO TIMEOUT**
- Throws on any non-OK status — **NO RETRY**
- API key in URL query parameter (Google API design)
- `usage: null` — never reports token usage
- Malformed response → graceful degradation

### OpenCode Zen Adapter (opencodeZen.ts — 67 lines)
- spawn() without timeout — **NO TIMEOUT**
- Ignores `timeoutMs` parameter
- stdout/stderr unbounded accumulation
- `shell: false` prevents injection

**All adapters share the same pattern:** throw on HTTP error, no retry, no timeout, no circuit breaker.

---

## Section 9: Conversation System Audit

| Aspect | Finding |
|--------|---------|
| Persistence | PostgreSQL (survives restarts) |
| Storage limit | None (append-only) |
| Read limit | Default 20, configurable |
| Token budget | None (tokenCount field exists but unused) |
| loadHistory performance | Fetches ALL rows, slices in JS |
| Store abstraction | Bypassed (uses raw pool.query) |
| Unit tests | None (182 lines, 0 tests) |
| MemoryStore support | None (conversation methods not in Store interface) |
| Owner scoping | Proper (all methods filter by owner_id) |
| DB RLS | Proper (auth.uid() policies) |

---

## Section 10: Test Infrastructure Audit

| Component | Unit Tests | Integration Tests | Gap |
|-----------|-----------|-------------------|-----|
| Pipeline | YES (18) | YES (live) | None |
| Execution | YES (16) | YES (live) | None |
| Orchestration | YES (25) | YES (live) | None |
| Guardian | YES (41) | YES (live) | None |
| ToolBroker | YES (6) | YES (via gate4) | None |
| Tools | YES (68) | YES (live 56) | None |
| Authority | YES (12) | NO | Minor |
| Auth | YES (8) | YES (live) | None |
| ConversationService | **NO** | PARTIAL (gate4) | **MAJOR** |
| Api handlers | **NO** | YES (live) | **MAJOR** |
| Server HTTP | **NO** | **NO** | **MAJOR** |
| MemoryStore | PARTIAL | N/A | MEDIUM |

**Test fidelity:** MemoryStore sort orders don't match SupabaseStore. Could mask sort-order bugs.

---

## Forensic Conclusion

The codebase is well-structured with strong security foundations. The primary gaps are:
1. **Zero resilience** in provider adapters (no retry, timeout, circuit breaker)
2. **No timeouts** at tool, orchestration, or pipeline levels
3. **Conversation system** not integrated into Store abstraction (test gap)
4. **API boundary** missing input size limits and error sanitization

No CRITICAL security bypass paths exist. The Guardian optional issue is mitigated in practice.

**END OF FORENSIC REVIEW**
