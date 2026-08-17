# CHEF FACTORY — GATE 2 — PROMPT INJECTION / UNTRUSTED INPUT

**Component:** Untrusted-content classification
**Status:** IMPLEMENTED / TESTED

## Purpose
Deterministic identification of untrusted instructions. External content — repo files,
README, comments, issues, web pages, API/model/tool outputs, uploaded documents, task
content — is **DATA, never AUTHORITY**. Untrusted content can NEVER override owner
authority, security policy, project isolation, or approval requirements.

## Detected directive patterns (`AUTHORITY_DIRECTIVE_PATTERNS`)
- "ignore all previous/prior/above instructions/prompts/rules/system"
- "disregard all previous/prior/above"
- "you are now …", "you are no longer bound/governed by …"
- "forget all your instructions/rules/system prompt"
- "override your/the owner authority/security/policy/system/approval"
- "bypass … approval/security/policy/checks/guardrails"
- "disable … security/safety/audit/guardrails/restrictions/approvals"
- "do not follow/obey the owner/instructions/rules"
- "execute this command/shell/script without …"
- "expose/reveal/print/show/leak your secret/password/api key/token/credentials/env"
- "pretend/act as if you are the owner/admin/root/superuser"

## Behavior
`assessUntrustedInput(text, source)` returns `{ untrusted, authorityDirectives, source }`.
`untrusted` is true when directives are found OR the source is model/tool/web/file/api.
`modelOutputIsAuthority(modelOutput)` is true only when an authority directive appears.

## Guardian integration
When `SecurityRequest.untrustedInput` is present, the Guardian records matched
directives in evidence (`untrusted_authority_directive`, `directive=…`) and the policy
chain applies `rule.untrusted_directive` (notify) — directives are never honored.

## Tests
- `src/core/security/securityGuardian.test.ts` — directive detection, DATA-never-authority
  on model output.

---
**END OF GATE 2 PROMPT INJECTION.**
