// CHEF FACTORY — Gate 35A — Pre-write DLP scanner.
// Scans proposed file content BEFORE filesystem mutation.
// High-confidence secret patterns — blocks persistence of secrets.
// Uses fake secret-shaped fixtures in tests — never real secrets.

import type { DlpResult } from '../workspace/types.js';

const DLP_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // OpenAI-style API keys
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, description: 'openai_key' },
  // AWS access key IDs
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, description: 'aws_access_key' },
  // AWS secret access keys (base64-ish, 40 chars after aws_secret_access_key=)
  { pattern: /\b(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi, description: 'aws_secret_key' },
  // JWT tokens (three base64url segments separated by dots)
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, description: 'jwt_token' },
  // Private key blocks
  { pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, description: 'private_key' },
  // Generic password/token assignments (high-confidence only)
  { pattern: /\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|bearer)\s*[=:]\s*['"][^'"]{8,}['"]/gi, description: 'password_assignment' },
  // Supabase service-role tokens
  { pattern: /\bsb[p]_[A-Za-z0-9_-]{20,}\b/g, description: 'supabase_token' },
  // GitHub tokens
  { pattern: /\bghp_[A-Za-z0-9]{36}\b/g, description: 'github_token' },
  // Slack tokens
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]+\b/g, description: 'slack_token' },
];

/**
 * Scan content for high-confidence secret patterns.
 * Returns { clean: true } or { clean: false, reason, pattern }.
 * No raw matched secret is included in the result.
 */
export function scanForSecrets(content: string): DlpResult {
  for (const { pattern, description } of DLP_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(content);
    if (match) {
      return {
        clean: false,
        reason: `high-confidence secret detected: ${description}`,
        pattern: description,
      };
    }
  }
  return { clean: true };
}
