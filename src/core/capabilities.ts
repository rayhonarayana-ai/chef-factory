// CHEF FACTORY — Gate 29 — Capability normalization and matching.
// Deterministic, canonical normalization for agent capability strings.
// NO fuzzy matching, NO embeddings, NO semantic similarity.

/**
 * Normalize a capability string to canonical form:
 * - trim whitespace
 * - lowercase
 * - reject empty strings (returns null)
 */
export function normalizeCapability(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.toLowerCase();
}

/**
 * Normalize an array of capability strings.
 * - trims + lowercases each entry
 * - removes empty/null entries
 * - deduplicates (stable order: first occurrence wins)
 */
export function normalizeCapabilities(caps: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of caps) {
    const norm = normalizeCapability(raw);
    if (norm === null) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(norm);
  }
  return result;
}

/**
 * Check if an agent satisfies ALL required capabilities.
 * Both arrays MUST be pre-normalized.
 * Returns true if required is empty (all agents satisfy empty requirements).
 */
export function satisfiesAll(agentCaps: string[], requiredCaps: string[]): boolean {
  if (requiredCaps.length === 0) return true;
  const agentSet = new Set(agentCaps);
  for (const req of requiredCaps) {
    if (!agentSet.has(req)) return false;
  }
  return true;
}

/**
 * Compute the match ratio: number of required capabilities satisfied
 * divided by total required capabilities. Returns 0–1.
 * Both arrays MUST be pre-normalized.
 * Returns 1 when required is empty (perfect match for no requirements).
 */
export function matchRatio(agentCaps: string[], requiredCaps: string[]): number {
  if (requiredCaps.length === 0) return 1;
  const agentSet = new Set(agentCaps);
  let matched = 0;
  for (const req of requiredCaps) {
    if (agentSet.has(req)) matched++;
  }
  return matched / requiredCaps.length;
}
