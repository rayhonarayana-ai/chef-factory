// CHEF FACTORY — Gate 2 — Secret Protection Boundary.
// Deterministic scanning of ANY string/value for secret shapes before it is
// persisted or logged. Combined with Gate 1 redaction (core/redact.ts) and the
// SecretProvider boundary. Secrets never reach: audit_events, task descriptions,
// decision journals, model prompts, logs, error messages, chat history, agent
// memory, Git, todo.md, or documentation.

import { redactText } from '../redact.js';

export interface SecretScanResult {
  leaked: string[]; // secret key labels that were found
  redacted: string; // safe form for persistence/logging
  clean: boolean;
}

const LABELED_PATTERNS: Array<[string, RegExp]> = [
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['supabase_token', /\bsb[p]_[A-Za-z0-9_-]+\b/],
  ['openai_key', /\bsk-[A-Za-z0-9_-]{6,}\b/],
  ['key_value_secret', /\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|bearer)\s*[=:]\s*["']?[^\s"'&,;]+/gi],
];

/** Scan a string for known secret shapes. Deterministic; never reveals the value. */
export function scanForSecrets(text: string): SecretScanResult {
  const leaked: string[] = [];
  if (!text) return { leaked, redacted: text, clean: true };
  for (const [label, pattern] of LABELED_PATTERNS) {
    const m = text.match(pattern);
    if (m && m.length > 0) leaked.push(label);
  }
  const redacted = redactText(text);
  return { leaked, redacted, clean: leaked.length === 0 };
}

/**
 * Deep-scan an unknown value (JSON-serializable). Returns per-key findings.
 * Use before persistence/logging of task inputs, outputs, tool args, etc.
 */
export function deepScanForSecrets(value: unknown): { findings: Array<{ path: string; label: string }>; clean: boolean } {
  const findings: Array<{ path: string; label: string }> = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'string') {
      const scan = scanForSecrets(v);
      if (!scan.clean) {
        for (const label of scan.leaked) findings.push({ path, label });
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (['password', 'secret', 'token', 'apiKey', 'api_key', 'authorization', 'bearer'].includes(k)) {
          findings.push({ path: path ? `${path}.${k}` : k, label: `key_${k}` });
        }
        walk(val, path ? `${path}.${k}` : k);
      }
    }
  };
  walk(value, '');
  return { findings, clean: findings.length === 0 };
}
