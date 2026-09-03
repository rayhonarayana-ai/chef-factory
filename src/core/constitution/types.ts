// CHEF FACTORY — Constitution — registry domain types (S1).
// Payload identity + governance history + enforcement evidence + runtime
// projection records + transition result vocabulary.
//
// S1 semantics (frozen by the S1 Architecture Preclosure):
//  - payload identity/provenance is SEPARATE from governance events
//  - governance events are the authoritative immutable history
//  - runtime state is a PROJECTION ONLY (never the only historical record)
//  - revocation epoch lives on the runtime-state singleton
//  - NO fabricated historical ratification timestamp/event
//  - NO project_id anywhere in the constitutional storage scope
//  - agents/models/workers are NOT governance actors ('owner' | 'system' only)
//
// Storage implementations: src/db/constitutionRepo.ts (Postgres) and the
// MemoryStore test fixture (src/testing/memoryStore.ts).

export const CONSTITUTION_LINEAGE_ID = '00000000-0000-0000-0000-000000000001';

export const CONSTITUTION_EVENT_TYPES = [
  'SYSTEM_RATIFICATION_CONFIRMED',
  'ENFORCEMENT_READY_RECORDED',
  'ACTIVATED',
  'SUPERSEDED',
  'SECURITY_REVOKED',
  'ROLLED_BACK_TO_VERSION',
] as const;
export type ConstitutionEventType = (typeof CONSTITUTION_EVENT_TYPES)[number];

export type ConstitutionActorType = 'owner' | 'system';

// The advisory transaction lock key domain dedicated to the Constitution
// registry. Proven collision-free with existing in-use domains: 74738 (task
// dependency edges), 74739 (mission engine). 74740 is the first constitutional
// lock; the second argument is fixed to 1 (single factory lineage).
export const CONSTITUTION_ADVISORY_LOCK_KEY = 74740;

export const CONSTITUTION_HASH_RE = /^[0-9a-f]{64}$/;
export const COMMIT_OR_BLOB_RE = /^[0-9a-f]{40,64}$/;

export function assertConstitutionHashFormat(hash: string, label = 'constitutionHash'): void {
  if (!CONSTITUTION_HASH_RE.test(hash)) {
    throw new Error(`${label} must be a 64-character lowercase hex SHA-256`);
  }
}

export function assertGovernanceActor(actorType: ConstitutionActorType, label = 'actorType'): void {
  if (actorType !== 'owner' && actorType !== 'system') {
    throw new Error(`${label} must be 'owner' or 'system'; agents/models/workers are not governance actors`);
  }
}

// ---------- Version (immutable payload identity/provenance) ----------
export interface ConstitutionVersionRecord {
  constitutionHash: string;
  constitutionId: string;
  version: number;
  payloadPath: string;
  sourceCommitSha: string | null;
  gitBlobId: string | null;
  /** Registry insertion time ONLY — never a fabricated original ratification time. */
  createdAt: string;
}

// ---------- Governance event (authoritative immutable history) ----------
export interface ConstitutionGovernanceEventRecord {
  eventId: number;
  constitutionHash: string;
  eventType: ConstitutionEventType;
  actorType: ConstitutionActorType;
  actorId: string;
  occurredAt: string;
  previousActiveHash: string | null;
  newActiveHash: string | null;
  evidenceId: string | null;
  revocationEpochBefore: number;
  revocationEpochAfter: number;
  metadata: Record<string, unknown>;
}

// ---------- Enforcement evidence (immutable artifact/build provenance) ----------
export interface ConstitutionEnforcementEvidenceRecord {
  evidenceId: string;
  constitutionHash: string;
  /** Canonical identity of the runtime/build artifact this evidence proves (e.g. commit provenance or deployment artifact identity). */
  runtimeArtifactIdentity: string;
  /** Git commit lineage provenance when available (optional; never a live re-fingerprint requirement). */
  runtimeCodeCommitSha: string | null;
  /** Structured build/deployment provenance. */
  buildProvenance: Record<string, unknown> | null;
  verificationSuite: string;
  verificationSuiteVersion: string;
  evidenceDigest: string;
  recordedAt: string;
}

// ---------- Runtime state (exactly-one-row projection) ----------
export interface ConstitutionRuntimeStateRecord {
  singletonId: number;
  activeConstitutionHash: string | null;
  activeActivationEventId: number | null;
  revocationEpoch: number;
  createdAt: string;
  updatedAt: string;
}

// ---------- Inputs ----------
export interface ConstitutionVersionInput {
  constitutionHash: string;
  version: number;
  payloadPath: string;
  sourceCommitSha?: string | null;
  gitBlobId?: string | null;
}

export interface ConstitutionEvidenceInput {
  constitutionHash: string;
  runtimeArtifactIdentity: string;
  runtimeCodeCommitSha?: string | null;
  buildProvenance?: Record<string, unknown> | null;
  verificationSuite: string;
  verificationSuiteVersion: string;
  evidenceDigest: string;
}

// ---------- Results ----------
export type ConstitutionBootstrapOutcome = 'recorded' | 'already_exists';
export interface ConstitutionBootstrapResult {
  ok: boolean;
  outcome: ConstitutionBootstrapOutcome;
  version: ConstitutionVersionRecord | null;
}

export type ConstitutionConfirmOutcome = 'confirmed' | 'already_confirmed' | 'version_not_found';
export interface ConstitutionConfirmResult {
  ok: boolean;
  outcome: ConstitutionConfirmOutcome;
  event: ConstitutionGovernanceEventRecord | null;
}

export type ConstitutionEvidenceOutcome = 'recorded' | 'already_recorded' | 'version_not_found' | 'not_confirmed';
export interface ConstitutionEvidenceResult {
  ok: boolean;
  outcome: ConstitutionEvidenceOutcome;
  evidence: ConstitutionEnforcementEvidenceRecord | null;
  event: ConstitutionGovernanceEventRecord | null;
}

export type ConstitutionActivateOutcome =
  | 'activated'
  | 'rolled_back'
  | 'already_active'
  | 'version_not_found'
  | 'not_confirmed'
  | 'no_enforcement_evidence'
  | 'evidence_mismatch'
  | 'expected_active_mismatch'
  | 'conflict';
export interface ConstitutionActivateResult {
  ok: boolean;
  outcome: ConstitutionActivateOutcome;
  event: ConstitutionGovernanceEventRecord | null;
  supersededEvent: ConstitutionGovernanceEventRecord | null;
  state: ConstitutionRuntimeStateRecord | null;
}

export type ConstitutionRevokeOutcome = 'revoked' | 'no_active_constitution';
export interface ConstitutionRevokeResult {
  ok: boolean;
  outcome: ConstitutionRevokeOutcome;
  event: ConstitutionGovernanceEventRecord | null;
  state: ConstitutionRuntimeStateRecord | null;
}