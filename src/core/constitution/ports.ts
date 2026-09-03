// CHEF FACTORY — Constitution — narrow persistence interfaces (S1).
//
// Deliberately SEPARATE from the general agent-facing `Store` (src/core/ports.ts),
// following the established narrow-capability precedent (WorkforceControlAdminPersistence,
// ModelHealthPersistence). Privileged constitutional mutations are reachable ONLY
// through ConstitutionAdminPersistence by the trusted ceremony/admin core (S4+);
// agents, workers, models and generic runtime code receive at most the
// ConstitutionReadStore surface. Neither interface exposes any mutation that
// could weaken the constitutional state model.

import type {
  ConstitutionActorType,
  ConstitutionActivateResult,
  ConstitutionBootstrapResult,
  ConstitutionConfirmResult,
  ConstitutionEnforcementEvidenceRecord,
  ConstitutionEvidenceInput,
  ConstitutionEvidenceResult,
  ConstitutionGovernanceEventRecord,
  ConstitutionRevokeResult,
  ConstitutionRuntimeStateRecord,
  ConstitutionVersionInput,
  ConstitutionVersionRecord,
} from './types.js';

export interface ConstitutionReadStore {
  getVersionByHash(constitutionHash: string): Promise<ConstitutionVersionRecord | null>;
  listVersions(): Promise<ConstitutionVersionRecord[]>;
  getGovernanceEvent(eventId: number): Promise<ConstitutionGovernanceEventRecord | null>;
  listGovernanceEvents(): Promise<ConstitutionGovernanceEventRecord[]>;
  getEvidence(evidenceId: string): Promise<ConstitutionEnforcementEvidenceRecord | null>;
  listEvidenceByHash(constitutionHash: string): Promise<ConstitutionEnforcementEvidenceRecord[]>;
  getRuntimeState(): Promise<ConstitutionRuntimeStateRecord | null>;
  isHashConfirmed(constitutionHash: string): Promise<boolean>;
  hasEnforcementEvidence(constitutionHash: string): Promise<boolean>;
}

export interface ConstitutionAdminPersistence {
  /** Record an immutable payload identity/provenance row (bootstrap). */
  bootstrapRecordVersion(input: ConstitutionVersionInput): Promise<ConstitutionBootstrapResult>;

  /** Second-in-system owner confirmation of an externally ratified payload. */
  confirmSystemRatification(input: {
    actorId: string;
    actorType: ConstitutionActorType;
    constitutionHash: string;
    metadata?: Record<string, unknown>;
  }): Promise<ConstitutionConfirmResult>;

  /** Record immutable enforcement evidence + its ENFORCEMENT_READY_RECORDED event (trusted service only). */
  recordEnforcementReady(input: {
    actorId: string;
    actorType: ConstitutionActorType;
    evidence: ConstitutionEvidenceInput;
  }): Promise<ConstitutionEvidenceResult>;

  /** Owner-authorized activation (writer of the ACTIVATED event + pointer). */
  activateConstitution(input: {
    actorId: string;
    actorType: ConstitutionActorType;
    constitutionHash: string;
    evidenceId: string;
    expectedPreviousActiveHash: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<ConstitutionActivateResult>;

  /** Owner-authorized append-only reactivation of a prior immutable version. */
  rollbackToVersion(input: {
    actorId: string;
    actorType: ConstitutionActorType;
    constitutionHash: string;
    evidenceId: string;
    expectedPreviousActiveHash: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<ConstitutionActivateResult>;

  /** Security revocation: retain active pointer, bump epoch by exactly one, append event atomically. */
  securityRevoke(input: {
    actorId: string;
    actorType: ConstitutionActorType;
    justification: string;
    metadata?: Record<string, unknown>;
  }): Promise<ConstitutionRevokeResult>;
}