// CHEF FACTORY — Constitution — Postgres persistence (S1).
// Implements the narrow ConstitutionReadStore + ConstitutionAdminPersistence
// interfaces directly over the `pg` Pool (no .rpc() — matchese the repository's
// established pattern). All constitutional transitions are serialized on the
// dedicated advisory transaction lock 74740 and are ALL-OR-NOTHING:
//   BEGIN -> checks -> [governance event insert(s)] -> [runtime_state update]
//   -> COMMIT, with ROLLBACK on every non-success path.
//
// S1 does NOT apply the schema to live databases (LIVE_SCHEMA_APPLIED = NO);
// this module only becomes reachable once the migration is applied under
// explicit live-migration authorization.

import type pg from 'pg';
import { getPool } from './pool.js';
import {
  assertConstitutionHashFormat,
  assertGovernanceActor,
  CONSTITUTION_ADVISORY_LOCK_KEY,
  CONSTITUTION_LINEAGE_ID,
} from '../core/constitution/types.js';
import type {
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
} from '../core/constitution/types.js';
import type {
  ConstitutionAdminPersistence,
  ConstitutionReadStore,
} from '../core/constitution/ports.js';

export const CONSTITUTION_SINGLETON_ID = 1;

function toCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out;
}

const nowIso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

function mapVersion(row: Record<string, unknown>): ConstitutionVersionRecord {
  return {
    constitutionHash: String(row.constitutionHash),
    constitutionId: String(row.constitutionId),
    version: Number(row.version),
    payloadPath: String(row.payloadPath),
    sourceCommitSha: row.sourceCommitSha == null ? null : String(row.sourceCommitSha),
    gitBlobId: row.gitBlobId == null ? null : String(row.gitBlobId),
    createdAt: nowIso(row.createdAt),
  };
}

function mapEvent(row: Record<string, unknown>): ConstitutionGovernanceEventRecord {
  return {
    eventId: Number(row.eventId),
    constitutionHash: String(row.constitutionHash),
    eventType: row.eventType as ConstitutionGovernanceEventRecord['eventType'],
    actorType: row.actorType as ConstitutionGovernanceEventRecord['actorType'],
    actorId: String(row.actorId),
    occurredAt: nowIso(row.occurredAt),
    previousActiveHash: row.previousActiveHash == null ? null : String(row.previousActiveHash),
    newActiveHash: row.newActiveHash == null ? null : String(row.newActiveHash),
    evidenceId: row.evidenceId == null ? null : String(row.evidenceId),
    revocationEpochBefore: Number(row.revocationEpochBefore),
    revocationEpochAfter: Number(row.revocationEpochAfter),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

function mapEvidence(row: Record<string, unknown>): ConstitutionEnforcementEvidenceRecord {
  return {
    evidenceId: String(row.evidenceId),
    constitutionHash: String(row.constitutionHash),
    runtimeArtifactIdentity: String(row.runtimeArtifactIdentity),
    runtimeCodeCommitSha: row.runtimeCodeCommitSha == null ? null : String(row.runtimeCodeCommitSha),
    buildProvenance: row.buildProvenance == null ? null : (row.buildProvenance as Record<string, unknown>),
    verificationSuite: String(row.verificationSuite),
    verificationSuiteVersion: String(row.verificationSuiteVersion),
    evidenceDigest: String(row.evidenceDigest),
    recordedAt: nowIso(row.recordedAt),
  };
}

function mapState(row: Record<string, unknown>): ConstitutionRuntimeStateRecord {
  return {
    singletonId: Number(row.singletonId),
    activeConstitutionHash: row.activeConstitutionHash == null ? null : String(row.activeConstitutionHash),
    activeActivationEventId: row.activeActivationEventId == null ? null : Number(row.activeActivationEventId),
    revocationEpoch: Number(row.revocationEpoch),
    createdAt: nowIso(row.createdAt),
    updatedAt: nowIso(row.updatedAt),
  };
}

type PgClient = pg.PoolClient;

async function insertEvent(client: PgClient, input: {
  constitutionHash: string;
  eventType: ConstitutionGovernanceEventRecord['eventType'];
  actorType: ConstitutionGovernanceEventRecord['actorType'];
  actorId: string;
  previousActiveHash: string | null;
  newActiveHash: string | null;
  evidenceId: string | null;
  /** base epoch; revocation events pass +1 explicitly. */
  revocationEpoch: number;
  revocationEpochAfter?: number;
  metadata?: Record<string, unknown>;
}): Promise<ConstitutionGovernanceEventRecord> {
  const after = input.revocationEpochAfter ?? input.revocationEpoch;
  const rows = await client.query<Record<string, unknown>>(
    `INSERT INTO public.constitution_governance_events (
       constitution_hash, event_type, actor_type, actor_id, occurred_at,
       previous_active_hash, new_active_hash, evidence_id,
       revocation_epoch_before, revocation_epoch_after, metadata
     ) VALUES ($1,$2,$3,$4, now(), $5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      input.constitutionHash,
      input.eventType,
      input.actorType,
      input.actorId,
      input.previousActiveHash,
      input.newActiveHash,
      input.evidenceId,
      input.revocationEpoch,
      after,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapEvent(toCamel(rows.rows[0]!));
}

export class ConstitutionRepo implements ConstitutionReadStore, ConstitutionAdminPersistence {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  private async q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows.map((r) => toCamel(r) as T);
  }

  private async qOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.q<T>(sql, params);
    return rows[0] ?? null;
  }

  // ---------- READ ----------
  async getVersionByHash(constitutionHash: string): Promise<ConstitutionVersionRecord | null> {
    const row = await this.qOne<Record<string, unknown>>(
      `SELECT * FROM public.constitution_versions WHERE constitution_hash = $1 LIMIT 1`,
      [constitutionHash],
    );
    return row ? mapVersion(row) : null;
  }

  async listVersions(): Promise<ConstitutionVersionRecord[]> {
    const rows = await this.q<Record<string, unknown>>(
      `SELECT * FROM public.constitution_versions ORDER BY version ASC`,
    );
    return rows.map(mapVersion);
  }

  async getGovernanceEvent(eventId: number): Promise<ConstitutionGovernanceEventRecord | null> {
    const row = await this.qOne<Record<string, unknown>>(
      `SELECT * FROM public.constitution_governance_events WHERE event_id = $1 LIMIT 1`,
      [eventId],
    );
    return row ? mapEvent(row) : null;
  }

  async listGovernanceEvents(): Promise<ConstitutionGovernanceEventRecord[]> {
    const rows = await this.q<Record<string, unknown>>(
      `SELECT * FROM public.constitution_governance_events ORDER BY event_id ASC`,
    );
    return rows.map(mapEvent);
  }

  async getEvidence(evidenceId: string): Promise<ConstitutionEnforcementEvidenceRecord | null> {
    const row = await this.qOne<Record<string, unknown>>(
      `SELECT * FROM public.constitution_enforcement_evidence WHERE evidence_id = $1 LIMIT 1`,
      [evidenceId],
    );
    return row ? mapEvidence(row) : null;
  }

  async listEvidenceByHash(constitutionHash: string): Promise<ConstitutionEnforcementEvidenceRecord[]> {
    const rows = await this.q<Record<string, unknown>>(
      `SELECT * FROM public.constitution_enforcement_evidence WHERE constitution_hash = $1 ORDER BY recorded_at ASC`,
      [constitutionHash],
    );
    return rows.map(mapEvidence);
  }

  async getRuntimeState(): Promise<ConstitutionRuntimeStateRecord | null> {
    const row = await this.qOne<Record<string, unknown>>(
      `SELECT * FROM public.constitution_runtime_state WHERE singleton_id = $1 LIMIT 1`,
      [CONSTITUTION_SINGLETON_ID],
    );
    return row ? mapState(row) : null;
  }

  async isHashConfirmed(constitutionHash: string): Promise<boolean> {
    const row = await this.qOne<Record<string, unknown>>(
      `SELECT 1 AS one FROM public.constitution_governance_events
       WHERE constitution_hash = $1 AND event_type = 'SYSTEM_RATIFICATION_CONFIRMED' LIMIT 1`,
      [constitutionHash],
    );
    return row != null;
  }

  async hasEnforcementEvidence(constitutionHash: string): Promise<boolean> {
    const row = await this.qOne<Record<string, unknown>>(
      `SELECT 1 AS one FROM public.constitution_enforcement_evidence
       WHERE constitution_hash = $1 LIMIT 1`,
      [constitutionHash],
    );
    return row != null;
  }

  // ---------- WRITE ----------
  async bootstrapRecordVersion(input: ConstitutionVersionInput): Promise<ConstitutionBootstrapResult> {
    assertConstitutionHashFormat(input.constitutionHash);
    const rows = await this.q<Record<string, unknown>>(
      `INSERT INTO public.constitution_versions (
         constitution_hash, constitution_id, version, payload_path, source_commit_sha, git_blob_id
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (constitution_hash) DO NOTHING
       RETURNING *`,
      [
        input.constitutionHash,
        CONSTITUTION_LINEAGE_ID,
        input.version,
        input.payloadPath,
        input.sourceCommitSha ?? null,
        input.gitBlobId ?? null,
      ],
    );
    if (rows.length === 0) {
      const existing = await this.getVersionByHash(input.constitutionHash);
      return { ok: true, outcome: 'already_exists', version: existing };
    }
    return { ok: true, outcome: 'recorded', version: mapVersion(rows[0]!) };
  }

  async confirmSystemRatification(input: {
    actorId: string;
    actorType: ConstitutionGovernanceEventRecord['actorType'];
    constitutionHash: string;
    metadata?: Record<string, unknown>;
  }): Promise<ConstitutionConfirmResult> {
    assertConstitutionHashFormat(input.constitutionHash);
    assertGovernanceActor(input.actorType);
    if (input.actorType !== 'owner') {
      throw new Error('system ratification confirmation requires an owner actor');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock($1, 1)`, [CONSTITUTION_ADVISORY_LOCK_KEY]);

      const version = await client.query<{ one: number }>(
        `SELECT 1 AS one FROM public.constitution_versions WHERE constitution_hash = $1 LIMIT 1`,
        [input.constitutionHash],
      );
      if (version.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'version_not_found', event: null };
      }

      const existing = await client.query<Record<string, unknown>>(
        `SELECT * FROM public.constitution_governance_events
         WHERE constitution_hash = $1 AND event_type = 'SYSTEM_RATIFICATION_CONFIRMED' ORDER BY event_id ASC LIMIT 1`,
        [input.constitutionHash],
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return { ok: true, outcome: 'already_confirmed', event: mapEvent(toCamel(existing.rows[0]!)) };
      }

      const event = await insertEvent(client, {
        constitutionHash: input.constitutionHash,
        eventType: 'SYSTEM_RATIFICATION_CONFIRMED',
        actorType: input.actorType,
        actorId: input.actorId,
        previousActiveHash: null,
        newActiveHash: null,
        evidenceId: null,
        revocationEpoch: 0,
        metadata: input.metadata,
      });

      await client.query('COMMIT');
      return { ok: true, outcome: 'confirmed', event };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async recordEnforcementReady(input: {
    actorId: string;
    actorType: ConstitutionGovernanceEventRecord['actorType'];
    evidence: ConstitutionEvidenceInput;
  }): Promise<ConstitutionEvidenceResult> {
    const ev = input.evidence;
    assertConstitutionHashFormat(ev.constitutionHash);
    assertConstitutionHashFormat(ev.evidenceDigest, 'evidenceDigest');
    assertGovernanceActor(input.actorType);
    if (input.actorType !== 'system') {
      throw new Error('enforcement-ready recording requires a trusted system actor');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock($1, 1)`, [CONSTITUTION_ADVISORY_LOCK_KEY]);

      const version = await client.query<{ one: number }>(
        `SELECT 1 AS one FROM public.constitution_versions WHERE constitution_hash = $1 LIMIT 1`,
        [ev.constitutionHash],
      );
      if (version.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'version_not_found', evidence: null, event: null };
      }
      const confirmed = await client.query<{ one: number }>(
        `SELECT 1 AS one FROM public.constitution_governance_events
         WHERE constitution_hash = $1 AND event_type = 'SYSTEM_RATIFICATION_CONFIRMED' LIMIT 1`,
        [ev.constitutionHash],
      );
      if (confirmed.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'not_confirmed', evidence: null, event: null };
      }

      const dup = await client.query<Record<string, unknown>>(
        `SELECT * FROM public.constitution_enforcement_evidence
         WHERE constitution_hash = $1 AND evidence_digest = $2
           AND verification_suite = $3 AND verification_suite_version = $4
           AND runtime_artifact_identity = $5
         ORDER BY recorded_at ASC LIMIT 1`,
        [ev.constitutionHash, ev.evidenceDigest, ev.verificationSuite, ev.verificationSuiteVersion, ev.runtimeArtifactIdentity],
      );
      if (dup.rows.length > 0) {
        await client.query('ROLLBACK');
        return { ok: true, outcome: 'already_recorded', evidence: mapEvidence(toCamel(dup.rows[0]!)), event: null };
      }

      const evRows = await client.query<Record<string, unknown>>(
        `INSERT INTO public.constitution_enforcement_evidence (
           constitution_hash, runtime_artifact_identity, runtime_code_commit_sha,
           build_provenance, verification_suite, verification_suite_version, evidence_digest
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          ev.constitutionHash,
          ev.runtimeArtifactIdentity,
          ev.runtimeCodeCommitSha ?? null,
          JSON.stringify(ev.buildProvenance ?? {}),
          ev.verificationSuite,
          ev.verificationSuiteVersion,
          ev.evidenceDigest,
        ],
      );
      const evidence = mapEvidence(toCamel(evRows.rows[0]!));

      const event = await insertEvent(client, {
        constitutionHash: ev.constitutionHash,
        eventType: 'ENFORCEMENT_READY_RECORDED',
        actorType: input.actorType,
        actorId: input.actorId,
        previousActiveHash: null,
        newActiveHash: null,
        evidenceId: evidence.evidenceId,
        revocationEpoch: 0,
      });

      await client.query('COMMIT');
      return { ok: true, outcome: 'recorded', evidence, event };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async activateConstitution(input: {
    actorId: string;
    actorType: ConstitutionGovernanceEventRecord['actorType'];
    constitutionHash: string;
    evidenceId: string;
    expectedPreviousActiveHash: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<ConstitutionActivateResult> {
    return this.transition({ ...input, eventType: 'ACTIVATED' });
  }

  async rollbackToVersion(input: {
    actorId: string;
    actorType: ConstitutionGovernanceEventRecord['actorType'];
    constitutionHash: string;
    evidenceId: string;
    expectedPreviousActiveHash: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<ConstitutionActivateResult> {
    return this.transition({ ...input, eventType: 'ROLLED_BACK_TO_VERSION' });
  }

  private async transition(input: {
    actorId: string;
    actorType: ConstitutionGovernanceEventRecord['actorType'];
    constitutionHash: string;
    evidenceId: string;
    expectedPreviousActiveHash: string | null;
    metadata?: Record<string, unknown>;
    eventType: 'ACTIVATED' | 'ROLLED_BACK_TO_VERSION';
  }): Promise<ConstitutionActivateResult> {
    assertConstitutionHashFormat(input.constitutionHash, 'constitutionHash');
    assertGovernanceActor(input.actorType);
    if (input.actorType !== 'owner') {
      throw new Error('constitution activation/rollback requires an owner actor');
    }
    if (input.expectedPreviousActiveHash != null) {
      assertConstitutionHashFormat(input.expectedPreviousActiveHash, 'expectedPreviousActiveHash');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock($1, 1)`, [CONSTITUTION_ADVISORY_LOCK_KEY]);

      const version = await client.query<{ one: number }>(
        `SELECT 1 AS one FROM public.constitution_versions WHERE constitution_hash = $1 LIMIT 1`,
        [input.constitutionHash],
      );
      if (version.rows.length === 0) {
        await client.query('ROLLBACK');
        return this.emptyActivate('version_not_found');
      }

      const confirmed = await client.query<{ one: number }>(
        `SELECT 1 AS one FROM public.constitution_governance_events
         WHERE constitution_hash = $1 AND event_type = 'SYSTEM_RATIFICATION_CONFIRMED' LIMIT 1`,
        [input.constitutionHash],
      );
      if (confirmed.rows.length === 0) {
        await client.query('ROLLBACK');
        return this.emptyActivate('not_confirmed');
      }

      const ev = await client.query<Record<string, unknown>>(
        `SELECT * FROM public.constitution_enforcement_evidence WHERE evidence_id = $1 LIMIT 1`,
        [input.evidenceId],
      );
      if (ev.rows.length === 0) {
        await client.query('ROLLBACK');
        return this.emptyActivate('no_enforcement_evidence');
      }
      const evidence = mapEvidence(toCamel(ev.rows[0]!));
      if (evidence.constitutionHash !== input.constitutionHash) {
        await client.query('ROLLBACK');
        return this.emptyActivate('evidence_mismatch');
      }

      const st = await client.query<Record<string, unknown>>(
        `SELECT * FROM public.constitution_runtime_state WHERE singleton_id = $1 FOR UPDATE`,
        [CONSTITUTION_SINGLETON_ID],
      );
      if (st.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error('constitution_runtime_state singleton row missing');
      }
      const state = mapState(toCamel(st.rows[0]!));
      const current = state.activeConstitutionHash;

      if (current === input.constitutionHash) {
        const actEv = await client.query<Record<string, unknown>>(
          `SELECT * FROM public.constitution_governance_events WHERE event_id = $1 LIMIT 1`,
          [state.activeActivationEventId],
        );
        const boundSameEvidence = actEv.rows.length > 0 && String(actEv.rows[0]!.evidence_id) === input.evidenceId;
        await client.query('ROLLBACK');
        if (boundSameEvidence) {
          return { ok: true, outcome: 'already_active', event: mapEvent(toCamel(actEv.rows[0]!)), supersededEvent: null, state };
        }
        return { ok: false, outcome: 'conflict', event: null, supersededEvent: null, state };
      }

      if (current !== input.expectedPreviousActiveHash) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'expected_active_mismatch', event: null, supersededEvent: null, state };
      }

      let supersededEvent: ConstitutionGovernanceEventRecord | null = null;
      if (current != null) {
        supersededEvent = await insertEvent(client, {
          constitutionHash: input.constitutionHash,
          eventType: 'SUPERSEDED',
          actorType: input.actorType,
          actorId: input.actorId,
          previousActiveHash: current,
          newActiveHash: input.constitutionHash,
          evidenceId: null,
          revocationEpoch: state.revocationEpoch,
          metadata: input.metadata,
        });
      }

      const event = await insertEvent(client, {
        constitutionHash: input.constitutionHash,
        eventType: input.eventType,
        actorType: input.actorType,
        actorId: input.actorId,
        previousActiveHash: current,
        newActiveHash: input.constitutionHash,
        evidenceId: input.evidenceId,
        revocationEpoch: state.revocationEpoch,
        metadata: input.metadata,
      });

      const upd = await client.query(
        `UPDATE public.constitution_runtime_state
         SET active_constitution_hash = $1, active_activation_event_id = $2, updated_at = now()
         WHERE singleton_id = $3 AND active_constitution_hash IS NOT DISTINCT FROM $4`,
        [input.constitutionHash, event.eventId, CONSTITUTION_SINGLETON_ID, input.expectedPreviousActiveHash],
      );
      if (upd.rowCount !== 1) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'expected_active_mismatch', event: null, supersededEvent: null, state };
      }

      await client.query('COMMIT');
      const finalState = await this.getRuntimeState();
      return {
        ok: true,
        outcome: input.eventType === 'ACTIVATED' ? 'activated' : 'rolled_back',
        event,
        supersededEvent,
        state: finalState,
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  private emptyActivate(outcome: ConstitutionActivateResult['outcome']): ConstitutionActivateResult {
    return { ok: false, outcome, event: null, supersededEvent: null, state: null };
  }

  async securityRevoke(input: {
    actorId: string;
    actorType: ConstitutionGovernanceEventRecord['actorType'];
    justification: string;
    metadata?: Record<string, unknown>;
  }): Promise<ConstitutionRevokeResult> {
    assertGovernanceActor(input.actorType);
    if (!input.justification || input.justification.trim().length === 0) {
      throw new Error('security revocation requires a justification');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock($1, 1)`, [CONSTITUTION_ADVISORY_LOCK_KEY]);

      const st = await client.query<Record<string, unknown>>(
        `SELECT * FROM public.constitution_runtime_state WHERE singleton_id = $1 FOR UPDATE`,
        [CONSTITUTION_SINGLETON_ID],
      );
      if (st.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error('constitution_runtime_state singleton row missing');
      }
      const state = mapState(toCamel(st.rows[0]!));
      if (state.activeConstitutionHash == null) {
        await client.query('ROLLBACK');
        return { ok: false, outcome: 'no_active_constitution', event: null, state };
      }

      const event = await insertEvent(client, {
        constitutionHash: state.activeConstitutionHash,
        eventType: 'SECURITY_REVOKED',
        actorType: input.actorType,
        actorId: input.actorId,
        previousActiveHash: state.activeConstitutionHash,
        newActiveHash: null,
        evidenceId: null,
        revocationEpoch: state.revocationEpoch,
        revocationEpochAfter: state.revocationEpoch + 1,
        metadata: { ...(input.metadata ?? {}), justification: input.justification },
      });

      const upd = await client.query(
        `UPDATE public.constitution_runtime_state
         SET revocation_epoch = $1, updated_at = now()
         WHERE singleton_id = $2`,
        [state.revocationEpoch + 1, CONSTITUTION_SINGLETON_ID],
      );
      if (upd.rowCount !== 1) {
        await client.query('ROLLBACK');
        throw new Error('security revocation failed to update runtime state');
      }

      await client.query('COMMIT');
      const finalState = await this.getRuntimeState();
      return { ok: true, outcome: 'revoked', event, state: finalState };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
}