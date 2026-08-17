// CHEF FACTORY — Gate 1 — Personal Operating System (POS).
// Versioned owner preferences. POS must never override security, isolation,
// authority policy, explicit DENY, or system constraints.

import type { JsonObject } from './types.js';

// Keys that system policy always wins over.
export const NON_OVERRIDABLE_KEYS = new Set([
  'security',
  'isolation',
  'authority',
  'deny',
  'explicit_deny',
  'max_retries',
]);

export interface PreferencePatch {
  category: string;
  key: string;
  value: unknown;
  version?: number;
}

// Deterministic validation — returns error string or null.
export function validatePreference(patch: PreferencePatch): string | null {
  if (!patch.category.trim()) return 'preference category is required';
  if (!patch.key.trim()) return 'preference key is required';
  if (NON_OVERRIDABLE_KEYS.has(patch.key) || NON_OVERRIDABLE_KEYS.has(patch.category)) {
    return `preference "${patch.key}" is system-protected and cannot be overridden`;
  }
  return null;
}

export interface VersionedPref {
  category: string;
  key: string;
  value: unknown;
  version: number;
  isActive: boolean;
}

// Given flat list of versioned prefs, resolve the ACTIVE value per (category,key).
export function resolveActivePreferences(prefs: VersionedPref[]): JsonObject {
  const out: JsonObject = {};
  for (const p of prefs) {
    if (!p.isActive) continue;
    const bucket = (out[p.category] ?? {}) as JsonObject;
    bucket[p.key] = p.value;
    out[p.category] = bucket;
  }
  return out;
}

export function nextVersion(prefs: VersionedPref[], category: string, key: string): number {
  const versions = prefs
    .filter((p) => p.category === category && p.key === key)
    .map((p) => p.version);
  return versions.length ? Math.max(...versions) + 1 : 1;
}
