// CHEF FACTORY — Gate 1 — Deterministic redaction for logs/audit/tasks.
// Core-level, env-independent: known credential shapes are scrubbed so secrets
// never reach audit events, task records, or explanations.

const PATTERNS: RegExp[] = [
  // JWT-ish
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // Supabase service-role / personal access tokens
  /\bsb[p]_[A-Za-z0-9_-]+\b/g,
  // OpenAI-style keys
  /\bsk-[A-Za-z0-9_-]{6,}\b/g,
  // Explicit key=value / key: value pairs for common secret names
  /\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|bearer)\s*[=:]\s*["']?[^\s"'&,;]+/gi,
];

export function redactText(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

export function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}
