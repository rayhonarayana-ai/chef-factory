# GATE 17 — SECURITY ASSESSMENT

> Date: 2026-08-19
> Scope: Security findings from Gate 17 discovery audit

## Security Invariants (Post-Gate 16)

| # | Invariant | Status |
|---|-----------|--------|
| S1 | Lockdown denies all actions | PRESERVED |
| S2 | DENY always wins over ALLOW/NOTIFY | PRESERVED |
| S3 | Guardian never downgrades authority | PRESERVED |
| S4 | Financial transactions are denied | PRESERVED |
| S5 | Production deletion is denied | PRESERVED |
| S6 | Environment escalation is denied | PRESERVED |
| S7 | Cross-project access is denied | PRESERVED |
| S8 | Rate limit exhaustion is denied | PRESERVED |
| S9 | Cost hard limit stops execution | PRESERVED |
| S10 | Prompt injection is denied | PRESERVED |
| S11 | Secrets are never persisted raw | PRESERVED |
| S12 | Agents cannot release lockdown | PRESERVED |
| S13 | Agents cannot approve (owner-only) | PRESERVED |
| S14 | Audit trail never contains secrets | PRESERVED |
| S15 | Explanations are never fabricated | PRESERVED |
| S16 | Service role never used on normal path | PRESERVED |
| S17 | Owner identity cannot be spoofed | PRESERVED |
| S18 | Query results are owner-scoped | PRESERVED |
| S19 | SQL injection is neutralized | PRESERVED |
| S20 | Query errors are sanitized | PRESERVED |

**All 20 security invariants PRESERVED.** Gate 17 mission (audit trail reliability) is additive and does not modify existing security behavior.

## New Security Findings (Gate 17 Discovery)

### CRITICAL

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| S-CRIT-01 | `.env` plaintext secrets | .env | Credential exposure if repo shared |
| S-CRIT-02 | SSL cert verification disabled | pool.ts:23 | MITM on DB traffic |

### HIGH

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| S-HIGH-01 | Fire-and-forget security events | guardian.ts:51, security.ts:23 | Audit trail loss during DB outage |
| S-HIGH-02 | Fire-and-forget rate/anomaly persistence | rateLimit.ts:139, anomaly.ts:192 | Rate limit bypass during DB failure |
| S-HIGH-03 | Race condition in rate limiter | rateLimit.ts:60-79 | Rate limit exceeded under concurrency |
| S-HIGH-04 | `auth.verifyOwner()` silent failure | auth.ts:46 | Indistinguishable network/auth errors |
| S-HIGH-05 | No CORS headers | server.ts | Browser security gap |
| S-HIGH-06 | SSE connections not rate-limited | streaming.ts | DoS via concurrent SSE |
| S-HIGH-07 | SSE error events leak internals | streaming.ts:111 | Internal error details exposed |
| S-HIGH-08 | Conversation messages without redaction | handlers.ts:72-77 | Secrets stored in conversation history |
| S-HIGH-09 | No input validation on conversation | handlers.ts:72-77 | Prompt injection via conversation history |

### MEDIUM

| # | Finding | Location | Impact |
|---|---------|----------|--------|
| S-MED-01 | No security response headers | server.ts | Missing CSP, X-Frame-Options |
| S-MED-02 | Prompt injection English-only | promptInjection.ts | Non-English injections bypass |
| S-MED-03 | Empty catch blocks (25 instances) | Various | Silent error swallowing |
| S-MED-04 | No structured logging | server.ts, rateLimit.ts, anomaly.ts | No observability infrastructure |
| S-MED-05 | N+1 query in anomaly save | gate14Persistence.ts | DB pressure under load |
| S-MED-06 | DB pool max=5 | pool.ts | Connection bottleneck |
| S-MED-07 | Rate limit failure logged once then silent | rateLimit.ts | Subsequent failures invisible |
| S-MED-08 | Anomaly detector shared singleton | anomaly.ts | Cross-owner counter pollution |
| S-MED-09 | In-memory rate limit state unbounded | rateLimit.ts | Memory leak over time |
| S-MED-10 | Task creation no idempotency key | repo.ts | Duplicate tasks on retry |

## Security Assessment for Gate 17 Mission

**Mission M1 (Audit Trail Reliability)** addresses:
- S-HIGH-01: Fire-and-forget security events → add retry/buffer
- S-HIGH-02: Fire-and-forget rate/anomaly persistence → add retry/buffer

**Does NOT address:**
- S-CRIT-01 (`.env` secrets) — operational/infrastructure issue
- S-CRIT-02 (SSL) — infrastructure configuration
- S-HIGH-03 (TOCTOU) — requires DB-level SELECT FOR UPDATE
- S-HIGH-04 (auth silent failure) — separate fix
- S-HIGH-05..09 (API boundary) — separate mission

## Gate 5 Invariants (Must Preserve)

| # | Invariant | Gate 17 Impact |
|---|-----------|---------------|
| G5-01 | Double execution prevention | No change |
| G5-03 | Cost protection limits | No change |
| G5-04 | Prompt injection deny | No change |
| G5-05 | Anomaly decay | No change |
| G5-06 | Vocabulary aliases | No change |

**All Gate 5 invariants preserved.** Gate 17 mission is additive — it adds retry/buffer for persistence failures without changing existing behavior.
