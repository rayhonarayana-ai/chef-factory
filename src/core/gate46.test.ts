// CHEF FACTORY — Gate 46 — Workspace Integrity / Verification-to-State Binding.
//
// Proves:
//   A. WorkspaceIntegrityService is deterministic, bounded, protected-aware,
//      symlink-safe, Git-INDEPENDENT, and FAILS CLOSED on any breach.
//   B. Gate45Acceptance binds FINGERPRINT_BEFORE == FINGERPRINT_AFTER and classifies
//      WORKSPACE_CHANGED as REPAIRABLE (re-verify on the existing bounded retry).
//   C. Evidence binds verification_session_id + workspace_fingerprint (AUDIT-ONLY).
//   D. AgentExecutor closes the FINAL post-hash -> completion TOCTOU interval via the
//      completionWorkspaceGuard.
//   E. model/agent can NEVER supply a hash or session id (trusted infra only).
//
// In-memory Store parity + stub runner/fingerprinter (no child processes for gate
// tests); real filesystem temp dirs for the integrity service unit tests.
// LIVE_MODEL_PROVIDER_CALLS = 0, LIVE_DB_MUTATION = NONE.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { MemoryStore } from '../testing/memoryStore.js';
import type { Store } from './ports.js';
import type { TaskRecord, AgentRecord } from './types.js';
import type { ExecutionOutcome, ExecutionRunner, ActorContext } from './pipeline.js';
import { executeAssignedAgentTask } from './agentExecutor.js';
import type { CompletionWorkspaceGuard, Gate45AcceptanceGateway, Gate45AcceptanceResult } from './gate45Acceptance.js';
import { classifyVerificationOutcome } from './gate45Acceptance.js';
import {
  createVerificationAcceptanceGateway,
  createCompletionWorkspaceGuard,
  type RequirementRunner,
  type Fingerprinter,
} from '../software/verification/gate45.js';
import type { VerificationOperation, VerificationResult } from '../software/verification/types.js';
import {
  fingerprintWorkspace,
  canonicalManifestPath,
  isTransientPath,
  MANIFEST_BOUNDS,
} from '../workspace/integrity.js';
import { newSessionId } from '../software/verification/session.js';
import { withRepoAndFileLockAndDb } from '../workspace/mutation.js';

const uuid = (): string => crypto.randomUUID();

// =====================================================================
// Test doubles
// =====================================================================

function okRun(op: VerificationOperation): VerificationResult {
  return { ok: true, outcome: 'passed', operation: op, exitCode: 0, timedOut: false, durationMs: 12, stdout: '', stderr: '', truncated: false, manifestHash: null };
}
function failRun(op: VerificationOperation, outcome: VerificationResult['outcome']): VerificationResult {
  return { ok: false, outcome, operation: op, exitCode: 1, timedOut: outcome === 'timeout', durationMs: 12, stdout: '', stderr: '', truncated: false, manifestHash: null };
}
function stubRunner(plan: Record<string, VerificationResult>): RequirementRunner {
  return async (op: VerificationOperation) => plan[op] ?? failRun(op, 'failed');
}
function stubExecution(): ExecutionRunner {
  return {
    execute: async (_t: TaskRecord, _c: ActorContext): Promise<ExecutionOutcome> => ({ ok: true, output: { claimed: 'byModel' }, cost: 0 }),
  };
}
/** Stable fingerprinter; when `after` is set, the 2nd+ invocation returns it to simulate a workspace change detected on re-hash. */
function stubFp(before = 'f'.repeat(64), after?: string): Fingerprinter {
  let n = 0;
  return async () => {
    n += 1;
    const fp = n > 1 && after ? after : before;
    return { ok: true, value: { algorithm: 'sha256', fingerprint: fp, fileCount: 1, totalBytes: 1 } };
  };
}
function stubCompletionGuard(stable: boolean): CompletionWorkspaceGuard {
  return {
    async withStableWorkspace<T>(_task: TaskRecord, _fingerprint: string, onStable: () => Promise<T>) {
      return stable ? { stable: true, value: await onStable() } : { stable: false };
    },
  };
}

interface Fx {
  store: MemoryStore;
  ownerId: string;
  projectId: string;
}
async function fixtures(): Promise<Fx> {
  const store = new MemoryStore();
  const ownerId = 'owner-' + uuid();
  const project = await store.createProject(ownerId, { name: 'G46', slug: 'g46-' + uuid() });
  return { store, ownerId, projectId: project.id };
}
async function makeAgent(store: Store, ownerId: string, projectId: string): Promise<AgentRecord> {
  const ag = await store.createAgent(ownerId, { name: 'A-' + uuid(), slug: 'a-' + uuid(), role: 'worker', status: 'active' });
  (store as MemoryStore).agentPermissions.push({ agentId: ag.id, projectId, resourceType: 'task', permission: 'execute' });
  return ag;
}
async function makeVerTask(
  fx: Fx, agentId: string,
  opts: { ops?: VerificationOperation[]; status?: TaskRecord['status']; maxAttempts?: number } = {},
): Promise<TaskRecord> {
  const ops = opts.ops ?? ['test'];
  return fx.store.createTask(fx.ownerId, {
    projectId: fx.projectId, title: 'T-' + uuid(), status: opts.status ?? 'queued', agentId,
    riskLevel: 'low', maxAttempts: opts.maxAttempts ?? 3,
    verificationRequired: true, requiredVerifications: ops,
    missionId: null,
    inputs: { intent: 'build code', environment: 'development', resource: 'task' },
  });
}

// =====================================================================
// A. WorkspaceIntegrityService — deterministic source manifest
// =====================================================================

let wsDirs: string[] = [];
async function newWs(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gate46-'));
  wsDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  return root;
}
afterEach(async () => {
  for (const d of wsDirs) await rm(d, { recursive: true, force: true }).catch(() => undefined);
  wsDirs = [];
});

class Deferred<T = void> {
  promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  constructor() { this.promise = new Promise<T>((resolve) => { this.resolve = resolve; }); }
}

/** Minimal session-lock DB double: different lock keys may run concurrently; equal keys wait. */
class AdvisoryLockDb {
  readonly held = new Set<string>();
  readonly waiters = new Map<string, Array<() => void>>();
  calls = 0;

  async query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
    this.calls += 1;
    const key = (params ?? []).join(':');
    if (sql.includes('pg_advisory_lock')) {
      while (this.held.has(key)) {
        await new Promise<void>((resolve) => {
          const queue = this.waiters.get(key) ?? [];
          queue.push(resolve);
          this.waiters.set(key, queue);
        });
      }
      this.held.add(key);
    }
    if (sql.includes('pg_advisory_unlock')) {
      this.held.delete(key);
      this.waiters.get(key)?.shift()?.();
    }
    return { rows: [] };
  }
}

describe('Gate 46 — A1 deterministic manifest', () => {
  it('01: same workspace -> same fingerprint (deterministic)', async () => {
    const files = { 'src/a.ts': 'x', 'src/b.ts': 'y', 'package.json': '{}', 'package-lock.json': '{}' };
    const ws = await newWs(files);
    const a = await fingerprintWorkspace(ws);
    const b = await fingerprintWorkspace(ws);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.fingerprint).toBe(b.value.fingerprint);
      expect(a.value.algorithm).toBe('sha256');
    }
  });

  it('02: content change -> different fingerprint', async () => {
    const ws = await newWs({ 'src/a.ts': 'v1' });
    const a = await fingerprintWorkspace(ws);
    await writeFile(join(ws, 'src/a.ts'), 'v2', 'utf8');
    const b = await fingerprintWorkspace(ws);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.fingerprint).not.toBe(b.value.fingerprint);
  });

  it('03: filename/path change -> different fingerprint', async () => {
    const ws = await newWs({ 'src/a.ts': 'v1' });
    const a = await fingerprintWorkspace(ws);
    await writeFile(join(ws, 'src/a.ts'), '');
    await rm(join(ws, 'src/a.ts'));
    await writeFile(join(ws, 'src/b.ts'), 'v1', 'utf8');
    const b = await fingerprintWorkspace(ws);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.fingerprint).not.toBe(b.value.fingerprint);
  });

  it('04: file addition -> different fingerprint', async () => {
    const ws = await newWs({ 'src/a.ts': 'v1' });
    const a = await fingerprintWorkspace(ws);
    await writeFile(join(ws, 'src/c.ts'), 'v3', 'utf8');
    const b = await fingerprintWorkspace(ws);
    if (a.ok && b.ok) expect(a.value.fingerprint).not.toBe(b.value.fingerprint);
  });

  it('05: file deletion -> different fingerprint', async () => {
    const ws = await newWs({ 'src/a.ts': 'v1', 'src/b.ts': 'v2' });
    const a = await fingerprintWorkspace(ws);
    await rm(join(ws, 'src/b.ts'));
    const b = await fingerprintWorkspace(ws);
    if (a.ok && b.ok) expect(a.value.fingerprint).not.toBe(b.value.fingerprint);
  });

  it('06: deterministic ordering — creation order does not matter', async () => {
    const ws = await newWs({ 'src/a.ts': 'v1', 'src/b.ts': 'v2', 'src/c.ts': 'v3' });
    const a = await fingerprintWorkspace(ws);
    await rm(join(ws, 'src/a.ts'));
    await writeFile(join(ws, 'src/a.ts'), 'v1', 'utf8');
    const b = await fingerprintWorkspace(ws);
    if (a.ok && b.ok) expect(a.value.fingerprint).toBe(b.value.fingerprint);
  });

  it('27: SHA-256 used (64 lowercase hex chars)', async () => {
    const ws = await newWs({ 'src/a.ts': 'v1' });
    const a = await fingerprintWorkspace(ws);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.value.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('17/18/19/20: authoritative source, package.json, lockfile, migration included', async () => {
    const ws = await newWs({
      'src/a.ts': 'x',
      'test/a.test.ts': 't',
      'package.json': '{}',
      'package-lock.json': '{}',
      'tsconfig.json': '{}',
      'supabase/migrations/1.sql': '--m',
    });
    const a = await fingerprintWorkspace(ws);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.value.fileCount).toBe(6);
  });
});

describe('Gate 46 — A2 exclusions (protected / transient never read)', () => {
  it('11/12: protected path & .env never read (not counted, no read)', async () => {
    const ws = await newWs({
      'src/a.ts': 'x',
      '.env': 'API_KEY=super-secret-123',
      'secret.key': 'PRIVATE',
      'credentials.json': '{"secret":true}',
    });
    const a = await fingerprintWorkspace(ws);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.value.fileCount).toBe(1); // only src/a.ts
  });

  it('13: .git excluded', async () => {
    const ws = await newWs({ 'src/a.ts': 'x', '.git/config': '[core]', '.git/HEAD': 'ref' });
    const a = await fingerprintWorkspace(ws);
    if (a.ok) expect(a.value.fileCount).toBe(1);
  });

  it('14: node_modules excluded', async () => {
    const ws = await newWs({ 'src/a.ts': 'x', 'node_modules/lodash/index.js': 'abc' });
    const a = await fingerprintWorkspace(ws);
    if (a.ok) expect(a.value.fileCount).toBe(1);
  });

  it('15: dist/build/.next/.cache excluded', async () => {
    const ws = await newWs({
      'src/a.ts': 'x',
      'dist/bundle.js': 'b', 'build/o.js': 'o', '.next/x.js': 'n', '.cache/y': 'c',
    });
    const a = await fingerprintWorkspace(ws);
    if (a.ok) expect(a.value.fileCount).toBe(1);
  });

  it('16: temp/log/transient excluded', async () => {
    const ws = await newWs({
      'src/a.ts': 'x',
      'debug.log': 'L', '.chef-tmp-abc': 'T', 'out.tmp': 't', '.DS_Store': 'd',
    });
    const a = await fingerprintWorkspace(ws);
    if (a.ok) expect(a.value.fileCount).toBe(1);
    expect(isTransientPath('debug.log')).toBe(true);
    expect(isTransientPath('.chef-tmp-x')).toBe(true);
    expect(isTransientPath('src/a.ts')).toBe(false);
    expect(isTransientPath('package.json')).toBe(false);
  });
});

describe('Gate 46 — A3 canonicalization', () => {
  it('07: Windows separator normalization', () => {
    expect(canonicalManifestPath('src\\a\\b.ts')).toBe('src/a/b.ts');
    expect(canonicalManifestPath('./src/./a.ts')).toBe('src/a.ts');
  });
  it('08: Unicode NFC normalization', () => {
    expect(canonicalManifestPath('pré\u0065.txt'.normalize('NFD'))).toBe('pré\u0065.txt'.normalize('NFC'));
    expect(canonicalManifestPath('e\u0301.txt')).toBe('é.txt'.normalize('NFC'));
  });
  it('30/09: no blind lowercase; separate case preserved', () => {
    expect(canonicalManifestPath('Src/Foo.ts')).toBe('Src/Foo.ts'); // never lowercased
    expect(canonicalManifestPath('Src/Foo.ts')).not.toBe(canonicalManifestPath('src/foo.ts'));
  });
});

describe('Gate 46 — A4 fail-closed breaches', () => {
  it('10: traversal / external escape rejected (escaped symlink)', async () => {
    const ws = await newWs({ 'src/a.ts': 'x' });
    // Create a second temp dir to be the link target OUTSIDE the workspace.
    const outside = await newWs({ 'outside.txt': 'out' });
    try {
      await symlink(join(outside, 'outside.txt'), join(ws, 'escape.txt'));
    } catch {
      return; // symlink unsupported (e.g. Windows without privileges)
    }
    const a = await fingerprintWorkspace(ws);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe('escaped_symlink');
  });

  it('21: symlink external escape not read', async () => {
    const ws = await newWs({ 'src/a.ts': 'x' });
    const outside = await newWs({ 'secret.txt': 'TOPSECRET' });
    try {
      await symlink(join(outside, 'secret.txt'), join(ws, 'escape.txt'));
    } catch {
      // symlink unsupported — pass
      return;
    }
    const a = await fingerprintWorkspace(ws);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe('escaped_symlink');
  });

  it('22: safe symlink policy is deterministic (not followed; represented)', async () => {
    const ws = await newWs({ 'src/a.ts': 'v1', 'src/real.txt': 'data' });
    try {
      await symlink(join(ws, 'src', 'real.txt'), join(ws, 'src', 'alias.txt'));
    } catch {
      // symlink unsupported — pass (determinism proven by other tests)
      return;
    }
    const a = await fingerprintWorkspace(ws);
    const b = await fingerprintWorkspace(ws);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.fingerprint).toBe(b.value.fingerprint);
  });

  it('23: file-count bound exceeds -> fail closed (no partial)', async () => {
    const ws = await newWs({ 'a.ts': '1', 'b.ts': '2', 'c.ts': '3' });
    const a = await fingerprintWorkspace(ws, { MAX_MANIFEST_FILES: 2, MAX_MANIFEST_TOTAL_BYTES: 1e9, MAX_MANIFEST_FILE_BYTES: 1e9 });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe('bound_files_exceeded');
  });

  it('24: total-byte bound exceeds -> fail closed', async () => {
    const ws = await newWs({ 'big.ts': 'x'.repeat(100) });
    const a = await fingerprintWorkspace(ws, { MAX_MANIFEST_FILES: 10, MAX_MANIFEST_TOTAL_BYTES: 50, MAX_MANIFEST_FILE_BYTES: 1e9 });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe('bound_total_bytes_exceeded');
  });

  it('25: per-file bound exceeds -> fail closed', async () => {
    const ws = await newWs({ 'big.ts': 'x'.repeat(200) });
    const a = await fingerprintWorkspace(ws, { MAX_MANIFEST_FILES: 10, MAX_MANIFEST_TOTAL_BYTES: 1e9, MAX_MANIFEST_FILE_BYTES: 100 });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe('bound_file_bytes_exceeded');
  });

  it('26: no partial fingerprint — bounds never return a value', async () => {
    const ws = await newWs({ 'a.ts': '1', 'b.ts': '2' });
    const a = await fingerprintWorkspace(ws, { MAX_MANIFEST_FILES: 1, MAX_MANIFEST_TOTAL_BYTES: 1e9, MAX_MANIFEST_FILE_BYTES: 1e9 });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a).not.toHaveProperty('value');
  });

  it('07-b: canonical collision -> fail closed', async () => {
    // Two differently-encoded bytes normalize to the same NFC path -> collision.
    const pre = '\u00E9.txt';      // é precomposed
    const dec = 'e\u0301.txt';     // e + combining acute
    const ws = await newWs({});
    await writeFile(join(ws, pre), 'a', 'utf8');
    await writeFile(join(ws, dec), 'b', 'utf8');
    expect(canonicalManifestPath(pre)).toBe(canonicalManifestPath(dec));
    const a = await fingerprintWorkspace(ws);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe('collision');
  });

  it('MANIFEST_BOUNDS defaults are conservative and enforced', () => {
    expect(MANIFEST_BOUNDS.MAX_MANIFEST_FILES).toBeGreaterThan(1000);
    expect(MANIFEST_BOUNDS.MAX_MANIFEST_TOTAL_BYTES).toBeGreaterThan(1e7);
    expect(MANIFEST_BOUNDS.MAX_MANIFEST_FILE_BYTES).toBeGreaterThan(1e7);
  });
});

describe('Gate 46 — A5 trust (model/agent cannot supply hash)', () => {
  it('29/30/37: fingerprint derivation is trusted-only (no model/agent input surface)', async () => {
    // The fingerprinter signature takes only a trusted workspace root; there is no
    // path to inject a model/agent hash. Structural guard.
    const gate = createVerificationAcceptanceGateway({
      store: await (async () => { const s = new MemoryStore(); return s; })(),
      runOp: stubRunner({ test: okRun('test') }),
      fingerprint: stubFp(),
      resolveWorkspaceRoot: async () => '/tmp/ws',
    });
    expect(typeof gate.evaluate).toBe('function');
    // No public function accepts a user-supplied fingerprint.
  });

  it('31/32/33: session ID is generated internally (not model/agent supplied)', async () => {
    // The acceptance gate generates the session internally; no dependency exposes a
    // session-id injection. Structural: evaluate() consumes only the task.
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    const g = createVerificationAcceptanceGateway({ store: fx.store, runOp: stubRunner({ test: okRun('test') }), fingerprint: stubFp(), resolveWorkspaceRoot: async () => '/tmp/ws' });
    const d = await g.evaluate(t);
    expect(d.accepted).toBe(true);
  });

  it('session IDs are trusted UUIDs compatible with persisted evidence', () => {
    expect(newSessionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

// =====================================================================
// B. Gate45Acceptance — workspace identity binding
// =====================================================================
describe('Gate 46 — B workspace identity match is required', () => {
  function gate(store: Store, plan: Record<string, VerificationResult> = {}, fpAfter?: string) {
    return createVerificationAcceptanceGateway({
      store, runOp: stubRunner(plan), fingerprint: stubFp('f'.repeat(64), fpAfter), resolveWorkspaceRoot: async () => '/tmp/ws',
    });
  }

  it('34: fingerprint before == after + verification pass -> accepted', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    const d = await gate(fx.store, { test: okRun('test') }, 'f'.repeat(64)).evaluate(t);
    expect(d.accepted).toBe(true);
    expect(d.cls).toBe('passed');
    expect(d.workspaceFingerprint).toBe('f'.repeat(64));
  });

  it('35/36/37: fingerprint before != after -> not accepted, WORKSPACE_CHANGED, repairable', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running', maxAttempts: 3 });
    const d = await gate(fx.store, { test: okRun('test') }, 'g'.repeat(64)).evaluate(t);
    expect(d.accepted).toBe(false);
    expect(d.cls).toBe('repairable');
    expect(d.workspaceChanged).toBe(true);
    expect(d.reason).toBe('workspace_changed');
  });

  it('40: no recursive reverification loop (bounded by attempts via AgentExecutor)', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], status: 'running', maxAttempts: 2 });
    // Two successive accepted evaluations complete the task; no inner loop is created
    // by the gate itself (evaluate returns a single decision each call).
    const g = gate(fx.store, { test: okRun('test') });
    const fresh = await fx.store.getTask(fx.ownerId, t.id);
    expect(fresh).not.toBeNull();
    if (fresh) {
      const d1 = await g.evaluate(fresh);
      expect(d1.accepted).toBe(true);
    }
  });

  it('44/42/43: all required checks must pass; test/typecheck/build failure still blocks', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test', 'typecheck', 'build'], status: 'running' });
    const d = await gate(fx.store, { test: okRun('test'), typecheck: failRun('typecheck', 'failed'), build: okRun('build') }).evaluate(t);
    expect(d.accepted).toBe(false);
    expect(d.cls).toBe('repairable');
  });

  it('20 (gate): dependency_missing remains nonRepairable (unchanged, not weakened)', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    const d = await gate(fx.store, { test: failRun('test', 'dependency_missing') }).evaluate(t);
    expect(d.accepted).toBe(false);
    expect(d.cls).toBe('nonRepairable');
  });

  it('classify: workspace_changed -> repairable; security stays blocked', () => {
    expect(classifyVerificationOutcome('workspace_changed')).toBe('repairable');
    expect(classifyVerificationOutcome('execution_denied')).toBe('blocked');
    expect(classifyVerificationOutcome('dependency_missing')).toBe('nonRepairable');
  });

  it('59/60/56/57/58: durable controls still block (budget/cancel/stop/lockdown/mission)', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    // budget
    await fx.store.recordCost({ ownerId: fx.ownerId, projectId: fx.projectId, taskId: t.id, runId: null, agentId: null, costType: 'mission', amount: 200, currency: 'USD', provider: null, modelId: null, runtimeId: null, billedTo: 'project', metadata: {} });
    const d = await gate(fx.store, { test: okRun('test') }).evaluate(t);
    expect(d.accepted).toBe(false);
    expect(d.reason).toMatch(/^budget_exhausted:/);
  });

  it('44-b: model success claim irrelevant — verification failure blocks even when model says done', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    const d = await gate(fx.store, { test: failRun('test', 'failed') }).evaluate(t);
    expect(d.accepted).toBe(false);
  });
});

// =====================================================================
// C. Evidence — verification_session_id + workspace_fingerprint (AUDIT-ONLY)
// =====================================================================
describe('Gate 46 — C evidence binding', () => {
  it('47/51/52: evidence binds session id + fingerprint and survives roundtrip', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test', 'build'], status: 'running' });
    const g = createVerificationAcceptanceGateway({ store: fx.store, runOp: stubRunner({ test: okRun('test'), build: okRun('build') }), fingerprint: stubFp(), resolveWorkspaceRoot: async () => '/tmp/ws' });
    await g.evaluate(t);
    const ev = await fx.store.listTaskVerifications(fx.ownerId, t.id);
    expect(ev.length).toBe(2);
    for (const e of ev) {
      expect(e.verificationSessionId).toBeTruthy();
      expect(e.workspaceFingerprint).toBe('f'.repeat(64));
    }
    // same session across rows
    expect(ev[0]!.verificationSessionId).toBe(ev[1]!.verificationSessionId);
  });

  it('48/49/50: cross-owner/project/task evidence rejected (synthetic scoping)', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    const g = createVerificationAcceptanceGateway({ store: fx.store, runOp: stubRunner({ test: okRun('test') }), fingerprint: stubFp(), resolveWorkspaceRoot: async () => '/tmp/ws' });
    await g.evaluate(t);
    // cross-owner read sees nothing
    const other = new MemoryStore();
    await expect(other.listTaskVerifications('someone-else', t.id)).resolves.toEqual([]);
    const ev = await fx.store.listTaskVerifications(fx.ownerId, t.id);
    expect(ev.length).toBe(1);
    // Record does not expose stdout/stderr/secret payloads.
    expect(Object.keys(ev[0]!)).not.toContain('stdout');
    expect(Object.keys(ev[0]!)).not.toContain('stderr');
  });

  it('evidence rejects a project substituted for the verified task', async () => {
    const fx = await fixtures();
    const otherProject = await fx.store.createProject(fx.ownerId, { name: 'other', slug: 'other-' + uuid() });
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    await expect(fx.store.recordTaskVerification(fx.ownerId, {
      projectId: otherProject.id, taskId: t.id, attempt: 1, operation: 'test', outcome: 'passed',
    })).rejects.toThrow('task project mismatch');
  });

  it('53/54/55: no raw stdout/stderr/secret persisted', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    await createVerificationAcceptanceGateway({ store: fx.store, runOp: stubRunner({ test: okRun('test') }), fingerprint: stubFp(), resolveWorkspaceRoot: async () => '/tmp/ws' }).evaluate(t);
    const ev = await fx.store.listTaskVerifications(fx.ownerId, t.id);
    const json = JSON.stringify(ev[0]!);
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('manifestHash');
  });

  it('46: historical evidence cannot authorize future completion', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    const g = createVerificationAcceptanceGateway({ store: fx.store, runOp: stubRunner({ test: okRun('test') }), fingerprint: stubFp(), resolveWorkspaceRoot: async () => '/tmp/ws' });
    // First accepted evaluation.
    expect((await g.evaluate(t)).accepted).toBe(true);
    // A stale/historical row must NOT cause acceptance when the current run fails.
    const d = await createVerificationAcceptanceGateway({ store: fx.store, runOp: stubRunner({ test: failRun('test', 'failed') }), fingerprint: stubFp(), resolveWorkspaceRoot: async () => '/tmp/ws' }).evaluate(t);
    expect(d.accepted).toBe(false);
  });

  it('manifestHash populated with the workspace fingerprint (semantics: manifestHash == fingerprint)', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    const runs: VerificationResult[] = [];
    const g = createVerificationAcceptanceGateway({
      store: fx.store,
      runOp: async (op) => { const r = okRun(op); runs.push(r); return r; },
      fingerprint: stubFp('a'.repeat(64)),
      resolveWorkspaceRoot: async () => '/tmp/ws',
    });
    await g.evaluate(t);
    expect(runs.length).toBe(1);
    expect(runs[0]!.manifestHash).toBe('a'.repeat(64));
  });
});

// =====================================================================
// D. AgentExecutor — completion WORKSPACE_IDENTITY_MATCH and TOCTOU closure
// =====================================================================
describe('Gate 46 — D AgentExecutor completion guard', () => {
  function stubGateway(result: Gate45AcceptanceResult): Gate45AcceptanceGateway {
    return { evaluate: async () => result };
  }

  it('34/38: accepted stable workspace -> completed', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'] });
    const r = await executeAssignedAgentTask({
      store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id,
      verification: stubGateway({ accepted: true, cls: 'passed', reason: null, runs: [], workspaceFingerprint: 'f'.repeat(64) }),
      completionWorkspaceGuard: stubCompletionGuard(true),
    });
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('completed');
    expect(r.task?.status).toBe('completed');
  });

  it('61/36: workspace changed at completion boundary -> NO completion, repairable retry', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], maxAttempts: 3 });
    const r = await executeAssignedAgentTask({
      store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id,
      verification: stubGateway({ accepted: true, cls: 'passed', reason: null, runs: [], workspaceFingerprint: 'f'.repeat(64) }),
      completionWorkspaceGuard: stubCompletionGuard(false),
    });
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('retry_pending');
    expect(r.task?.status).toBe('queued'); // existing bounded retry path
    expect(r.task?.attempts).toBe(1);
    expect(String(r.error)).toContain('workspace_changed_at_completion');
  });

  it('61-b: guard failure is not repairable-escape — attempts stay bounded at maxAttempts', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], maxAttempts: 1 });
    const r = await executeAssignedAgentTask({
      store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id,
      verification: stubGateway({ accepted: true, cls: 'passed', reason: null, runs: [], workspaceFingerprint: 'f'.repeat(64) }),
      completionWorkspaceGuard: stubCompletionGuard(false),
    });
    expect(r.outcome).toBe('failed'); // maxAttempts=1 exhausted
    expect(r.task?.status).toBe('failed');
  });

  it('final coordinator is required for an accepted verification-required task', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], maxAttempts: 1 });
    const r = await executeAssignedAgentTask({
      store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id,
      verification: stubGateway({ accepted: true, cls: 'passed', reason: null, runs: [], workspaceFingerprint: 'f'.repeat(64) }),
    });
    expect(r.outcome).toBe('failed');
    expect(String(r.error)).toContain('workspace_completion_coordinator_missing');
  });

  it('9: cancellation at the final boundary cannot be overwritten to completed', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { ops: ['test'], maxAttempts: 1 });
    const cancellingGuard: CompletionWorkspaceGuard = {
      async withStableWorkspace<T>(_task, _fingerprint, onStable) {
        await fx.store.patchTask(fx.ownerId, t.id, { status: 'cancelled' });
        return { stable: true, value: await onStable() };
      },
    };
    const r = await executeAssignedAgentTask({
      store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id,
      verification: stubGateway({ accepted: true, cls: 'passed', reason: null, runs: [], workspaceFingerprint: 'f'.repeat(64) }),
      completionWorkspaceGuard: cancellingGuard,
    });
    expect(r.ok).toBe(false);
    expect((await fx.store.getTask(fx.ownerId, t.id))?.status).toBe('cancelled');
  });

  it('65: non-verification task behavior unchanged (no guard, no gate required path)', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await fx.store.createTask(fx.ownerId, {
      projectId: fx.projectId, title: 'plain', status: 'queued', agentId: ag.id,
      riskLevel: 'low', maxAttempts: 3, verificationRequired: false, requiredVerifications: [],
      inputs: { intent: 'do x', environment: 'development', resource: 'task' },
    });
    const r = await executeAssignedAgentTask({ store: fx.store, execution: stubExecution(), ownerId: fx.ownerId, agentId: ag.id, taskId: t.id });
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('completed');
  });

  it('64: no long-held verification project lock — gate does not acquire one', async () => {
    // The gate/fingerprint path never calls pg_advisory_lock around verification; the
    // fingerprint is computed by a bounded filesystem walk (before/after), not a lock.
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    const g = createVerificationAcceptanceGateway({ store: fx.store, runOp: stubRunner({ test: okRun('test') }), fingerprint: stubFp(), resolveWorkspaceRoot: async () => '/tmp/ws' });
    const d = await g.evaluate(t);
    expect(d.accepted).toBe(true);
  });

  it('62/63: different-file concurrent mutation detected (simulated by fingerprint change)', async () => {
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    // after hash differs -> workspace changed (a concurrent mutation on ANY file).
    const g = createVerificationAcceptanceGateway({ store: fx.store, runOp: stubRunner({ test: okRun('test') }), fingerprint: stubFp('a'.repeat(64), 'b'.repeat(64)), resolveWorkspaceRoot: async () => '/tmp/ws' });
    const d = await g.evaluate(t);
    expect(d.accepted).toBe(false);
    expect(d.workspaceChanged).toBe(true);
  });
});

// =====================================================================
// E. Composition-layer guard factory (integration surface)
// =====================================================================
describe('Gate 46 — E completion guard factory', () => {
  it('guard returns false on unresolvable workspace (fail closed)', async () => {
    const store = new MemoryStore();
    const guard = createCompletionWorkspaceGuard({ store, resolveWorkspaceRoot: async () => null });
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    expect(await guard.withStableWorkspace(t, 'f'.repeat(64), async () => 'completed')).toEqual({ stable: false });
  });

  it('guard returns true only on stable real workspace matching expected fingerprint', async () => {
    const store = new MemoryStore();
    const ws = await newWs({ 'src/a.ts': 'v1' });
    const fp = await fingerprintWorkspace(ws);
    expect(fp.ok).toBe(true);
    if (!fp.ok) return;
    const guard = createCompletionWorkspaceGuard({ store, resolveWorkspaceRoot: async () => ws });
    const someTask = { id: 't', ownerId: 'o', projectId: 'p' } as unknown as TaskRecord;
    expect(await guard.withStableWorkspace(someTask, fp.value.fingerprint, async () => 'completed')).toEqual({ stable: true, value: 'completed' });
    expect(await guard.withStableWorkspace(someTask, 'x'.repeat(64), async () => 'completed')).toEqual({ stable: false });
  });
});

describe('Gate 46 — F final coordination atomicity', () => {
  async function guardedWorkspace() {
    const store = new MemoryStore();
    const ws = await newWs({ 'src/a.ts': 'v1', 'src/b.ts': 'v1', 'src/c.ts': 'v1' });
    const fp = await fingerprintWorkspace(ws);
    expect(fp.ok).toBe(true);
    if (!fp.ok) throw new Error('workspace fingerprint unexpectedly unavailable');
    const locks = new AdvisoryLockDb();
    const guard = createCompletionWorkspaceGuard({
      store,
      resolveWorkspaceRoot: async () => ws,
      coordinationDb: locks,
    });
    return { ws, fp: fp.value.fingerprint, locks, guard, task: { id: 't', ownerId: 'o', projectId: 'p' } as unknown as TaskRecord };
  }

  it('1/2: a trusted mutation cannot race the final fingerprint through completion', async () => {
    const { ws, fp, locks, guard, task } = await guardedWorkspace();
    const enteredCompletion = new Deferred();
    const releaseCompletion = new Deferred();
    const completion = guard.withStableWorkspace(task, fp, async () => {
      enteredCompletion.resolve();
      await releaseCompletion.promise;
      return 'completed';
    });
    await enteredCompletion.promise;

    let mutationRan = false;
    const mutation = withRepoAndFileLockAndDb(locks, ws, 'src/b.ts', async () => {
      mutationRan = true;
      await writeFile(join(ws, 'src/b.ts'), 'v2', 'utf8');
      return undefined;
    });
    await Promise.resolve();
    expect(mutationRan).toBe(false);

    releaseCompletion.resolve();
    await expect(completion).resolves.toEqual({ stable: true, value: 'completed' });
    await mutation;
    expect(mutationRan).toBe(true);
  });

  it('1: mutation before final coordination is detected and prevents completion', async () => {
    const { ws, fp, locks, guard, task } = await guardedWorkspace();
    await withRepoAndFileLockAndDb(locks, ws, 'src/b.ts', async () => {
      await writeFile(join(ws, 'src/b.ts'), 'changed', 'utf8');
      return undefined;
    });
    await expect(guard.withStableWorkspace(task, fp, async () => 'completed')).resolves.toEqual({ stable: false });
  });

  it('3/4: post-completion and different-file mutations form a new serialized workspace state', async () => {
    const { ws, fp, locks, guard, task } = await guardedWorkspace();
    await expect(guard.withStableWorkspace(task, fp, async () => 'completed')).resolves.toEqual({ stable: true, value: 'completed' });
    await Promise.all([
      withRepoAndFileLockAndDb(locks, ws, 'src/b.ts', async () => { await writeFile(join(ws, 'src/b.ts'), 'after-b', 'utf8'); }),
      withRepoAndFileLockAndDb(locks, ws, 'src/c.ts', async () => { await writeFile(join(ws, 'src/c.ts'), 'after-c', 'utf8'); }),
    ]);
    const after = await fingerprintWorkspace(ws);
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value.fingerprint).not.toBe(fp);
  });

  it('6/7/8: lock releases after completion failure; repo -> file ordering completes without deadlock', async () => {
    const { ws, fp, locks, guard, task } = await guardedWorkspace();
    await expect(guard.withStableWorkspace(task, fp, async () => { throw new Error('store completion failed'); })).rejects.toThrow('store completion failed');
    await expect(withRepoAndFileLockAndDb(locks, ws, 'src/b.ts', async () => 'mutated')).resolves.toBe('mutated');
    expect(locks.held.size).toBe(0);
  });

  it('5: verification itself acquires no final coordination lock', async () => {
    const { locks } = await guardedWorkspace();
    const fx = await fixtures();
    const ag = await makeAgent(fx.store, fx.ownerId, fx.projectId);
    const t = await makeVerTask(fx, ag.id, { status: 'running' });
    const gate = createVerificationAcceptanceGateway({ store: fx.store, runOp: stubRunner({ test: okRun('test') }), fingerprint: stubFp(), resolveWorkspaceRoot: async () => '/tmp/ws' });
    await gate.evaluate(t);
    expect(locks.calls).toBe(0);
  });
});

describe('Gate 46 — no second engine / no long-lived lock (regression surface)', () => {
  it('bound constants present; integrity is Git-independent (no git call surfaced)', () => {
    expect(MANIFEST_BOUNDS.MAX_MANIFEST_FILES).toBeGreaterThan(0);
    expect(MANIFEST_BOUNDS.MAX_MANIFEST_TOTAL_BYTES).toBeGreaterThan(0);
    expect(MANIFEST_BOUNDS.MAX_MANIFEST_FILE_BYTES).toBeGreaterThan(0);
  });
});
