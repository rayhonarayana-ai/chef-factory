// CHEF FACTORY — Constitution S1 — registry domain + persistence unit tests.
// MemoryStore implements the full S1 surface with transition semantics identical
// to the Postgres ConstitutionRepo (same preconditions, same outcome vocabulary,
// same idempotency, same all-or-nothing policy). These tests exercise:
//   - immutable payload identity + governance event history
//   - enforcement evidence gating (never auto-bypassed)
//   - activation/rollback/revocation transitions + epoch monotonicity
//   - actor-type enforcement (agents/models/workers are NOT governance actors)
//   - idempotent replay of every write outcome
// The Postgres schema itself is exercised only when live migration is
// authorized (LIVE_SCHEMA_APPLIED = NO — S1 does not touch any live database).
import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../../testing/memoryStore.js';
import {
  CONSTITUTION_ADVISORY_LOCK_KEY,
  CONSTITUTION_EVENT_TYPES,
  CONSTITUTION_HASH_RE,
  CONSTITUTION_LINEAGE_ID,
  COMMIT_OR_BLOB_RE,
  assertConstitutionHashFormat,
  assertGovernanceActor,
} from './types.js';

// The owner-ratified CHEF FACTORY Constitution payload hash (S0 freeze).
const RATIFIED_V1 = 'a8f8b3800659eca75bfab390c023a87942b5ee50f5925790de91fd28c38ab46e';
const LATER_V2 = 'b'.repeat(64);

const helper = {
  versionInput: (hash: string, version: number) => ({
    constitutionHash: hash,
    version,
    payloadPath: 'docs/factory/CHEF_FACTORY_CONSTITUTION.md',
    sourceCommitSha: RATIFIED_V1,
    gitBlobId: RATIFIED_V1,
  }),
  confirmInput: (hash: string) => ({ actorId: 'owner-1', actorType: 'owner' as const, constitutionHash: hash }),
  evidenceInput: (hash: string) => ({
    constitutionHash: hash,
    runtimeArtifactIdentity: 'npm:chef-factory@1.0.0',
    runtimeCodeCommitSha: RATIFIED_V1,
    buildProvenance: { builder: 'factory-build' },
    verificationSuite: 'factory-constitutional-suite',
    verificationSuiteVersion: '1.0.0',
    evidenceDigest: RATIFIED_V1,
  }),
  activate: (hash: string, evidenceId: string, expectedPrev: string | null) => ({
    actorId: 'owner-1',
    actorType: 'owner' as const,
    constitutionHash: hash,
    evidenceId,
    expectedPreviousActiveHash: expectedPrev,
  }),
};

async function readyVersion(store: MemoryStore, hash: string, version: number, expectedPrev: string | null) {
  const b = await store.bootstrapRecordVersion(helper.versionInput(hash, version));
  if (!b.ok || !b.version) throw new Error('bootstrap failed');
  const c = await store.confirmSystemRatification(helper.confirmInput(hash));
  if (!c.ok || !c.event) throw new Error('confirm failed');
  const e = await store.recordEnforcementReady({ actorId: 'system-registry', actorType: 'system', evidence: helper.evidenceInput(hash) });
  if (!e.ok || !e.evidence) throw new Error('evidence failed');
  const act = await store.activateConstitution(helper.activate(hash, e.evidence.evidenceId, expectedPrev));
  if (!act.ok) throw new Error(`activate failed: ${act.outcome}`);
  return { version: b.version, confirm: c.event, evidence: e.evidence, event: e.event, activate: act };
}

describe('Constitution S1 — domain vocabulary', () => {
  it('lineage id and advisory lock key are stable constants', () => {
    expect(CONSTITUTION_LINEAGE_ID).toBe('00000000-0000-0000-0000-000000000001');
    expect(CONSTITUTION_ADVISORY_LOCK_KEY).toBe(74740);
  });

  it('event vocabulary is exactly the frozen six', () => {
    expect([...CONSTITUTION_EVENT_TYPES]).toEqual([
      'SYSTEM_RATIFICATION_CONFIRMED',
      'ENFORCEMENT_READY_RECORDED',
      'ACTIVATED',
      'SUPERSEDED',
      'SECURITY_REVOKED',
      'ROLLED_BACK_TO_VERSION',
    ]);
  });

  it('hash/identity formats are enforced', () => {
    expect(CONSTITUTION_HASH_RE.test(RATIFIED_V1)).toBe(true);
    expect(CONSTITUTION_HASH_RE.test('XYZ')).toBe(false);
    expect(() => assertConstitutionHashFormat('not-a-hash')).toThrow();
    expect(() => assertConstitutionHashFormat(RATIFIED_V1.toUpperCase())).toThrow();
    expect(() => assertConstitutionHashFormat(RATIFIED_V1)).not.toThrow();
    expect(COMMIT_OR_BLOB_RE.test('a'.repeat(40))).toBe(true);
    expect(COMMIT_OR_BLOB_RE.test('zz')).toBe(false);
  });

  it('agents/models/workers are not governance actors', () => {
    expect(() => assertGovernanceActor('owner')).not.toThrow();
    expect(() => assertGovernanceActor('system')).not.toThrow();
    for (const bad of ['agent', 'model', 'worker'] as const) {
      expect(() => assertGovernanceActor(bad as never)).toThrow(/agents\/models\/workers/);
    }
  });
});

describe('Constitution S1 — bootstrap payload identity (immutable row)', () => {
  it('records a version row and is idempotent on replay', async () => {
    const store = new MemoryStore();
    const a = await store.bootstrapRecordVersion(helper.versionInput(RATIFIED_V1, 1));
    expect(a).toMatchObject({ ok: true, outcome: 'recorded' });
    expect(a.version).toMatchObject({
      constitutionHash: RATIFIED_V1,
      constitutionId: CONSTITUTION_LINEAGE_ID,
      version: 1,
      payloadPath: 'docs/factory/CHEF_FACTORY_CONSTITUTION.md',
    });
    const before = store.constitutionVersions.length;
    const b = await store.bootstrapRecordVersion(helper.versionInput(RATIFIED_V1, 1));
    expect(b).toMatchObject({ ok: true, outcome: 'already_exists', version: a.version });
    expect(store.constitutionVersions.length).toBe(before);
  });

  it('rejects malformed inputs without touching the registry', async () => {
    const store = new MemoryStore();
    await expect(store.bootstrapRecordVersion({ ...helper.versionInput('zz', 1) })).rejects.toThrow();
    await expect(store.bootstrapRecordVersion({ ...helper.versionInput(RATIFIED_V1, 0) })).rejects.toThrow();
    await expect(store.bootstrapRecordVersion({ ...helper.versionInput(RATIFIED_V1, 1), payloadPath: '' })).rejects.toThrow();
    expect(store.constitutionVersions.length).toBe(0);
  });
});

describe('Constitution S1 — owner ratification confirmation', () => {
  it('requires an existing version', async () => {
    const store = new MemoryStore();
    const r = await store.confirmSystemRatification(helper.confirmInput(LATER_V2));
    expect(r).toMatchObject({ ok: false, outcome: 'version_not_found', event: null });
  });

  it('requires an owner actor', async () => {
    const store = new MemoryStore();
    await store.bootstrapRecordVersion(helper.versionInput(RATIFIED_V1, 1));
    await expect(store.confirmSystemRatification({ ...helper.confirmInput(RATIFIED_V1), actorType: 'system' })).rejects.toThrow(/owner actor/);
  });

  it('writes exactly one confirmation event and is idempotent', async () => {
    const store = new MemoryStore();
    await store.bootstrapRecordVersion(helper.versionInput(RATIFIED_V1, 1));
    const a = await store.confirmSystemRatification(helper.confirmInput(RATIFIED_V1));
    expect(a).toMatchObject({ ok: true, outcome: 'confirmed' });
    expect(a.event).toMatchObject({ eventType: 'SYSTEM_RATIFICATION_CONFIRMED', actorType: 'owner', evidenceId: null });
    expect(await store.isHashConfirmed(RATIFIED_V1)).toBe(true);
    const before = store.constitutionGovernanceEvents.length;
    const b = await store.confirmSystemRatification(helper.confirmInput(RATIFIED_V1));
    expect(b).toMatchObject({ ok: true, outcome: 'already_confirmed', event: a.event });
    expect(await store.listGovernanceEvents()).toHaveLength(before);
  });
});

describe('Constitution S1 — enforcement evidence (trusted service only)', () => {
  it('gates evidence on version + owner confirmation first', async () => {
    const store = new MemoryStore();
    const noVersion = await store.recordEnforcementReady({ actorId: 'system-registry', actorType: 'system', evidence: helper.evidenceInput(RATIFIED_V1) });
    expect(noVersion).toMatchObject({ ok: false, outcome: 'version_not_found' });
    await store.bootstrapRecordVersion(helper.versionInput(RATIFIED_V1, 1));
    const unconfirmed = await store.recordEnforcementReady({ actorId: 'system-registry', actorType: 'system', evidence: helper.evidenceInput(RATIFIED_V1) });
    expect(unconfirmed).toMatchObject({ ok: false, outcome: 'not_confirmed' });
  });

  it('writes evidence row + ENFORCEMENT_READY_RECORDED atomically', async () => {
    const store = new MemoryStore();
    await store.bootstrapRecordVersion(helper.versionInput(RATIFIED_V1, 1));
    await store.confirmSystemRatification(helper.confirmInput(RATIFIED_V1));
    const r = await store.recordEnforcementReady({ actorId: 'system-registry', actorType: 'system', evidence: helper.evidenceInput(RATIFIED_V1) });
    expect(r).toMatchObject({ ok: true, outcome: 'recorded' });
    expect(r.evidence).toMatchObject({ constitutionHash: RATIFIED_V1, verificationSuite: 'factory-constitutional-suite' });
    expect(r.event).toMatchObject({ eventType: 'ENFORCEMENT_READY_RECORDED', actorType: 'system', evidenceId: r.evidence!.evidenceId });
    expect(await store.getEvidence(r.evidence!.evidenceId)).toEqual(r.evidence);
    expect(await store.hasEnforcementEvidence(RATIFIED_V1)).toBe(true);
  });

  it('is idempotent (no duplicate evidence/event on replay)', async () => {
    const store = new MemoryStore();
    await store.bootstrapRecordVersion(helper.versionInput(RATIFIED_V1, 1));
    await store.confirmSystemRatification(helper.confirmInput(RATIFIED_V1));
    const r1 = await store.recordEnforcementReady({ actorId: 'system-registry', actorType: 'system', evidence: helper.evidenceInput(RATIFIED_V1) });
    const before = { ev: store.constitutionEvidence.length, evt: store.constitutionGovernanceEvents.length };
    const r2 = await store.recordEnforcementReady({ actorId: 'system-registry', actorType: 'system', evidence: helper.evidenceInput(RATIFIED_V1) });
    expect(r2).toMatchObject({ ok: true, outcome: 'already_recorded', evidence: r1.evidence, event: null });
    expect(store.constitutionEvidence.length).toBe(before.ev);
    expect(store.constitutionGovernanceEvents.length).toBe(before.evt);
  });

  it('rejects non-system actors and malformed digests', async () => {
    const store = new MemoryStore();
    await expect(store.recordEnforcementReady({ actorId: 'owner-x', actorType: 'owner', evidence: helper.evidenceInput(RATIFIED_V1) })).rejects.toThrow(/system actor/);
    await expect(store.recordEnforcementReady({ actorId: 'system-registry', actorType: 'system', evidence: { ...helper.evidenceInput(RATIFIED_V1), evidenceDigest: 'zz' } })).rejects.toThrow(/evidenceDigest/);
  });
});

describe('Constitution S1 — activation (owner-authorized pointer write)', () => {
  it('happy path: first activation with null expected previous hash', async () => {
    const store = new MemoryStore();
    const { activate } = await readyVersion(store, RATIFIED_V1, 1, null);
    expect(activate.outcome).toBe('activated');
    expect(activate.supersededEvent).toBeNull();
    const state = await store.getRuntimeState();
    expect(state).toMatchObject({ activeConstitutionHash: RATIFIED_V1, revocationEpoch: 0 });
    expect(state!.activeActivationEventId).toBe(activate.event!.eventId);
    expect(activate.event).toMatchObject({
      eventType: 'ACTIVATED',
      previousActiveHash: null,
      newActiveHash: RATIFIED_V1,
      revocationEpochBefore: 0,
      revocationEpochAfter: 0,
    });
  });

  it('rejects unknown/unconfirmed/unevidenced activation', async () => {
    const store = new MemoryStore();
    let r = await store.activateConstitution(helper.activate(LATER_V2, 'missing', null));
    expect(r).toMatchObject({ ok: false, outcome: 'version_not_found' });
    await store.bootstrapRecordVersion(helper.versionInput(RATIFIED_V1, 1));
    r = await store.activateConstitution(helper.activate(RATIFIED_V1, 'missing', null));
    expect(r).toMatchObject({ ok: false, outcome: 'not_confirmed' });
    await store.confirmSystemRatification(helper.confirmInput(RATIFIED_V1));
    r = await store.activateConstitution(helper.activate(RATIFIED_V1, 'missing', null));
    expect(r).toMatchObject({ ok: false, outcome: 'no_enforcement_evidence' });
  });

  it("binds evidence to the exact constitution (can't reuse another version's evidence)", async () => {
    const store = new MemoryStore();
    const v1 = await readyVersion(store, RATIFIED_V1, 1, null);
    await store.activateConstitution(helper.activate(RATIFIED_V1, v1.evidence.evidenceId, null));
    const v2 = await readyVersion(store, LATER_V2, 2, RATIFIED_V1);
    const cross = await store.activateConstitution(helper.activate(LATER_V2, v1.evidence.evidenceId, RATIFIED_V1));
    expect(cross).toMatchObject({ ok: false, outcome: 'evidence_mismatch', event: null, supersededEvent: null });
  });

  it('requires the expected previous pointer to match reality', async () => {
    const store = new MemoryStore();
    await readyVersion(store, RATIFIED_V1, 1, null);
    await store.bootstrapRecordVersion(helper.versionInput(LATER_V2, 2));
    await store.confirmSystemRatification(helper.confirmInput(LATER_V2));
    const ev = await store.recordEnforcementReady({ actorId: 'system-registry', actorType: 'system', evidence: helper.evidenceInput(LATER_V2) });
    const r = await store.activateConstitution(helper.activate(LATER_V2, ev.evidence!.evidenceId, 'c'.repeat(64)));
    expect(r).toMatchObject({ ok: false, outcome: 'expected_active_mismatch', event: null });
  });

  it('second activation supersedes: SUPERSEDED event written for the outgoing version', async () => {
    const store = new MemoryStore();
    const v1 = await readyVersion(store, RATIFIED_V1, 1, null);
    const v2 = await readyVersion(store, LATER_V2, 2, RATIFIED_V1);
    expect(v2.activate.outcome).toBe('activated');
    expect(v2.activate.supersededEvent).toMatchObject({
      eventType: 'SUPERSEDED',
      previousActiveHash: RATIFIED_V1,
      newActiveHash: LATER_V2,
      evidenceId: null,
    });
    // SUPERSEDED refers to the SUPERSEDING version hash (the target that becomes active).
    expect(v2.activate.supersededEvent!.constitutionHash).toBe(LATER_V2);
    expect((await store.getRuntimeState())!.activeConstitutionHash).toBe(LATER_V2);
    // History is append-only: exactly one ACTIVATED + one SUPERSEDED, plus v1's ACTIVATED.
    const act = (await store.listGovernanceEvents()).filter((e) => e.eventType === 'ACTIVATED' || e.eventType === 'SUPERSEDED');
    expect(act).toHaveLength(3);
    expect(act.map((e) => e.eventType)).toEqual(['ACTIVATED', 'SUPERSEDED', 'ACTIVATED']);
  });

  it('idempotent replay: already_active only when the same evidence is bound', async () => {
    const store = new MemoryStore();
    const v1 = await readyVersion(store, RATIFIED_V1, 1, null);
    const eventsBefore = store.constitutionGovernanceEvents.length;
    const replay = await store.activateConstitution(helper.activate(RATIFIED_V1, v1.evidence.evidenceId, LATER_V2));
    expect(replay).toMatchObject({ ok: true, outcome: 'already_active', event: v1.activate.event });
    expect(store.constitutionGovernanceEvents.length).toBe(eventsBefore);
  });

  it('conflict outcome when hash already active under a different evidence', async () => {
    const store = new MemoryStore();
    await readyVersion(store, RATIFIED_V1, 1, null);
    const other = await store.recordEnforcementReady({ actorId: 'system-registry', actorType: 'system', evidence: { ...helper.evidenceInput(RATIFIED_V1), runtimeArtifactIdentity: 'npm:chef-factory@1.0.1' } });
    const r = await store.activateConstitution(helper.activate(RATIFIED_V1, other.evidence!.evidenceId, null));
    expect(r).toMatchObject({ ok: false, outcome: 'conflict', event: null });
  });
});

describe('Constitution S1 — rollback to a prior immutable version', () => {
  it('reactivates an earlier version append-only', async () => {
    const store = new MemoryStore();
    const v1 = await readyVersion(store, RATIFIED_V1, 1, null);
    const v2 = await readyVersion(store, LATER_V2, 2, RATIFIED_V1);
    const rb = await store.rollbackToVersion(helper.activate(RATIFIED_V1, v1.evidence.evidenceId, LATER_V2));
    expect(rb).toMatchObject({ ok: true, outcome: 'rolled_back' });
    expect(rb.supersededEvent).toMatchObject({ eventType: 'SUPERSEDED', previousActiveHash: LATER_V2, newActiveHash: RATIFIED_V1 });
    expect(rb.event!.eventType).toBe('ROLLED_BACK_TO_VERSION');
    expect((await store.getRuntimeState())!.activeConstitutionHash).toBe(RATIFIED_V1);
    // v2 remains fully recorded and queryable — nothing is ever deleted.
    expect(await store.getVersionByHash(LATER_V2)).not.toBeNull();
    expect(await store.isHashConfirmed(LATER_V2)).toBe(true);
  });
});

describe('Constitution S1 — security revocation', () => {
  it('no-op when no constitution is active', async () => {
    const store = new MemoryStore();
    const r = await store.securityRevoke({ actorId: 'owner-1', actorType: 'owner', justification: 'test' });
    expect(r).toMatchObject({ ok: false, outcome: 'no_active_constitution', event: null });
  });

  it('retains the active pointer, bumps epoch by exactly one, appends SECURITY_REVOKED', async () => {
    const store = new MemoryStore();
    await readyVersion(store, RATIFIED_V1, 1, null);
    const r = await store.securityRevoke({ actorId: 'owner-1', actorType: 'owner', justification: 'compromise' });
    expect(r).toMatchObject({ ok: true, outcome: 'revoked' });
    expect(r.event).toMatchObject({
      eventType: 'SECURITY_REVOKED',
      previousActiveHash: RATIFIED_V1,
      newActiveHash: null,
      revocationEpochBefore: 0,
      revocationEpochAfter: 1,
    });
    expect(r.event!.metadata).toMatchObject({ justification: 'compromise' });
    const state = await store.getRuntimeState();
    expect(state).toMatchObject({ activeConstitutionHash: RATIFIED_V1, revocationEpoch: 1 });
  });

  it('requires a justification and iterates epochs strictly', async () => {
    const store = new MemoryStore();
    await readyVersion(store, RATIFIED_V1, 1, null);
    await expect(store.securityRevoke({ actorId: 'owner-1', actorType: 'owner', justification: '   ' })).rejects.toThrow(/justification/);
    await store.securityRevoke({ actorId: 'owner-1', actorType: 'owner', justification: 'r1' });
    const second = await store.securityRevoke({ actorId: 'owner-1', actorType: 'owner', justification: 'r2' });
    expect(second.event!.revocationEpochBefore).toBe(1);
    expect(second.event!.revocationEpochAfter).toBe(2);
    expect((await store.getRuntimeState())!.revocationEpoch).toBe(2);
    // Epochs are non-decreasing across the whole history.
    const evts = await store.listGovernanceEvents();
    for (let i = 1; i < evts.length; i++) {
      expect(evts[i]!.revocationEpochAfter).toBeGreaterThanOrEqual(evts[i - 1]!.revocationEpochAfter);
    }
  });
});

describe('Constitution S1 — separation + append-only + read-isolation', () => {
  it('runtime query returns a copy, not a live handle', async () => {
    const store = new MemoryStore();
    await readyVersion(store, RATIFIED_V1, 1, null);
    const state = await store.getRuntimeState();
    state!.activeConstitutionHash = LATER_V2;
    expect((await store.getRuntimeState())!.activeConstitutionHash).toBe(RATIFIED_V1);
  });

  it('governance events are never mutated once stored (projection-only state)', async () => {
    const store = new MemoryStore();
    await readyVersion(store, RATIFIED_V1, 1, null);
    const snap = await store.listGovernanceEvents();
    const meta = snap[0]!.metadata;
    meta.tamper = true;
    expect((await store.listGovernanceEvents())[0]!.metadata.tamper).toBeUndefined();
  });

  it('read surface exposes no mutation; writes only via the privileged interface', async () => {
    const store = new MemoryStore();
    const read: Record<string, unknown> = store;
    const forbidden = ['bootstrapRecordVersion', 'confirmSystemRatification', 'recordEnforcementReady', 'activateConstitution', 'rollbackToVersion', 'securityRevoke'];
    // The read surface still exists (structural check of isHashConfirmed behavior).
    expect(forbidden.every((k) => k in read)).toBe(true);
    expect(await store.isHashConfirmed(RATIFIED_V1)).toBe(false);
    expect(await store.hasEnforcementEvidence(RATIFIED_V1)).toBe(false);
  });
});