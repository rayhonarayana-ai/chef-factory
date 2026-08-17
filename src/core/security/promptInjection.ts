// CHEF FACTORY — Gate 2 — Prompt Injection / untrusted-input foundation.
// Deterministic identification of untrusted instructions. External content
// (repo files, README, comments, issues, web pages, API/model/tool outputs,
// uploaded documents, task content) is DATA, never AUTHORITY.
// Untrusted content can NEVER override owner authority, security policy,
// project isolation, or approval requirements.

const AUTHORITY_DIRECTIVE_PATTERNS: RegExp[] = [
  /ignore (?:all )?(?:previous|prior|above) (?:instructions|prompts|rules|system)/i,
  /disregard (?:all )?(?:previous|prior|above)/i,
  /you are now (?:an?|the|a different)/i,
  /you are (?:no longer|now) (?:bound|governed) by/i,
  /forget (?:all )?(?:your|the) (?:instructions|rules|system prompt)/i,
  /override (?:your|the|owner) (?:authority|security|policy|system|approval)/i,
  /bypass (?:the |your |owner |approval|security|policy|checks|guardrails)/i,
  /disable (?:the |all |your )?(?:security|safety|audit|guardrails|restrictions|approvals)/i,
  /do not (?:follow|obey) (?:the |your )?(?:owner|instructions|rules)/i,
  /execute (?:this|the following) (?:command|shell|script) without/i,
  /expose|reveal|print|show|leak (?:your )?(?:secret|password|api[ -]?key|token|credentials|env)/i,
  /pretend|act as if you are the (?:owner|admin|root|superuser)/i,
];

export interface UntrustedInputAssessment {
  untrusted: boolean;
  authorityDirectives: string[];
  source: string;
}

/**
 * Classify external/untrusted content. Returns detected authority-override
 * directives. The caller MUST treat the content as data: directives found here
 * are never executed as instructions.
 */
export function assessUntrustedInput(text: string, source = 'external'): UntrustedInputAssessment {
  if (!text) return { untrusted: false, authorityDirectives: [], source };
  const matches: string[] = [];
  for (const pattern of AUTHORITY_DIRECTIVE_PATTERNS) {
    const m = text.match(pattern);
    if (m && m[0]) matches.push(m[0].slice(0, 120));
  }
  return {
    untrusted: matches.length > 0 || source === 'model' || source === 'tool' || source === 'web' || source === 'file' || source === 'api',
    authorityDirectives: matches,
    source,
  };
}

/** LLM/model output is DATA. It must never become an authority decision by itself. */
export function modelOutputIsAuthority(modelOutput: string): boolean {
  const assessment = assessUntrustedInput(modelOutput, 'model');
  return assessment.authorityDirectives.length > 0;
}
