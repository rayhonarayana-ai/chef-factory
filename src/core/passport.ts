// CHEF FACTORY — Gate 1 — Project Passport.
// Structured per-project record. Unknown information stays UNKNOWN — never fabricated.

import type { JsonObject, PassportRecord } from './types.js';

export const PASSPORT_FIELDS = [
  'identity',
  'technology',
  'repository',
  'databaseRef',
  'environments',
  'deployment',
  'dependencies',
  'models',
  'runtimes',
  'businessModel',
  'status',
  'risks',
  'credentialsReferences',
  'operationalHealth',
  'documentationState',
] as const;

export function emptyPassport(projectId: string): PassportRecord {
  return {
    projectId,
    identity: {},
    description: null,
    technology: {},
    repository: {},
    databaseRef: {},
    environments: {},
    deployment: {},
    dependencies: {},
    models: {},
    runtimes: {},
    businessModel: {},
    status: {},
    risks: {},
    credentialsReferences: {},
    operationalHealth: {},
    documentationState: {},
  };
}

// Merge a patch into an existing passport. JSON sections replace wholesale.
export function mergePassport(base: PassportRecord, patch: Partial<PassportRecord>): PassportRecord {
  const next: PassportRecord = { ...base, ...patch };
  for (const f of PASSPORT_FIELDS) {
    if (typeof (next as unknown as Record<string, unknown>)[f] !== 'object') {
      (next as unknown as Record<string, unknown>)[f] = {};
    }
  }
  return next;
}

// Never fabricate: values that are empty/unset serialize as UNKNOWN markers in the UI.
export function passportSummary(p: PassportRecord): JsonObject {
  return {
    identity: p.identity,
    description: p.description ?? 'UNKNOWN',
    technology: Object.keys(p.technology).length ? p.technology : { state: 'UNKNOWN' },
    repository: Object.keys(p.repository).length ? p.repository : { state: 'UNKNOWN' },
    databaseRef: Object.keys(p.databaseRef).length ? p.databaseRef : { state: 'UNKNOWN' },
    operationalHealth: Object.keys(p.operationalHealth).length ? p.operationalHealth : { state: 'UNKNOWN' },
    risks: p.risks,
  };
}
