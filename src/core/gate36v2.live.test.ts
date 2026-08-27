// CHEF FACTORY — Gate 36 V2 — Live proofs for controlled staging + verified commit.
// Uses a real disposable git repository (NOT production source).
// Proves: repo lock functions, temp-index staging, hard failure paths, and
// attribution wiring without depending on production HEAD state.
// NOTE: Full happy-path commit requires real DB rows (project/task/audit FK).
// These proofs target deterministic invariants that hold regardless of DB state.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, readFile, rm, rmSync } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ToolHandlerInput, ToolExecutionContext } from '../tools/types.js';
import type { Store } from '../core/ports.js';
import { gitPrepareCommitHandler } from '../software/tools/gitPrepareCommit.js';
import { gitCommitHandler } from '../software/tools/gitCommit.js';
import { createFileHandler } from '../software/tools/createFile.js';
import { applyPatchHandler } from '../software/tools/applyPatch.js';
import { contentHash } from '../workspace/mutation.js';

let tmpRoot: string;
let workspaceDir: string;

function makeCtx(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    projectId: 'live2-test-project',
    actorType: 'agent',
    actorId: 'live2-test-agent',
    agentId: 'live2-test-agent',
    taskId: 'live2-test-task',
    environment: 'development',
    ...overrides,
  };
}

function makeInput(args: Record<string, unknown> = {}, ctxOverrides: Partial<ToolExecutionContext> = {}): ToolHandlerInput {
  return {
    ownerId: 'live2-test-owner',
    args,
    context: makeCtx(ctxOverrides),
    store: createMockStore(),
  };
}

function createMockStore(): Partial<Store> {
  const approvals = new Map<string, any>();
  let seq = 0;
  return {
    getPassport: async () => ({
      projectId: 'live2-test-project',
      repository: { workspaceRoot: workspaceDir },
      identity: {},
      description: null,
      technology: {},
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
    }) as never,
    createApproval: async (ownerId, data) => {
      const id = `approval-${++seq}`;
      const record = {
        id,
        ownerId,
        projectId: data.projectId ?? null,
        taskId: data.taskId ?? null,
        agentId: data.agentId ?? null,
        action: data.action,
        description: data.description ?? null,
        riskLevel: data.riskLevel ?? null,
        authorityLevel: data.authorityLevel ?? null,
        status: 'pending',
        decision: null,
        decisionReason: null,
        requestedBy: data.requestedBy ?? null,
        decidedBy: null,
        expiresAt: data.expiresAt ?? null,
        decidedAt: null,
        createdAt: new Date().toISOString(),
      };
      approvals.set(ownerId + ':' + id, record);
      return record;
    },
    getApproval: async (ownerId, approvalId) =>
      approvals.get(ownerId + ':' + approvalId) ?? null,
    patchApproval: async (ownerId, approvalId, patch) => {
      const key = ownerId + ':' + approvalId;
      const cur = approvals.get(key);
      if (!cur) throw new Error('not found');
      const next = { ...cur, ...patch };
      approvals.set(key, next);
      return next;
    },
  };
}

function git(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn('git', args, {
      cwd: workspaceDir,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
      shell: false,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('close', (code) => resolvePromise({ code, out, err }));
  });
}

beforeAll(async () => {
  tmpRoot = join(tmpdir(), `chef-live2-${randomBytes(8).toString('hex')}`);
  workspaceDir = join(tmpRoot, 'workspace');
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(join(workspaceDir, 'src'), { recursive: true });
  // Initialize a real git repo
  await git(['init', '-q']);
  await git(['config', 'user.email', 'test@chef.local']);
  await git(['config', 'user.name', 'chef-test']);
  await writeFile(join(workspaceDir, 'src', 'app.ts'), 'export const a = 1;\n');
  await writeFile(join(workspaceDir, '.gitignore'), 'node_modules\n');
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'initial commit']);
  // Create an uncommitted change so status is non-empty
  await writeFile(join(workspaceDir, 'src', 'app.ts'), 'export const a = 2;\n');
});

afterAll(async () => {
  try { await rm(tmpRoot, { recursive: true, force: true }); } catch { /* cleanup */ }
});

describe('Live2: Git read-only on real repo', () => {
  it('working tree has an uncommitted change', async () => {
    const r = await git(['status', '--porcelain']);
    expect(r.out.trim().length).toBeGreaterThan(0);
  });

  it('.git is a directory', async () => {
    expect(existsSync(join(workspaceDir, '.git'))).toBe(true);
  });
});

describe('Live2: git_prepare_commit fail-closed paths', () => {
  it('rejects empty message', async () => {
    const result = await gitPrepareCommitHandler(makeInput({ message: '' }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('message');
  });

  it('rejects oversized message', async () => {
    const result = await gitPrepareCommitHandler(makeInput({ message: 'x'.repeat(501) }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('too long');
  });
});

describe('Live2: git_commit fail-closed paths', () => {
  it('rejects missing approval_id', async () => {
    const result = await gitCommitHandler(makeInput({}));
    expect(result.success).toBe(false);
    expect(result.error).toContain('approval_id');
  });

  it('rejects unknown approval', async () => {
    const result = await gitCommitHandler(makeInput({ approval_id: 'nope' }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('approval not found');
  });
});

describe('Live2: attribution wiring present in source', () => {
  it('createFile records file.created attribution', async () => {
    const src = await readFile(join(process.cwd(), 'src/software/tools/createFile.ts'), 'utf-8');
    expect(src).toContain('file.created');
    expect(src).toContain('withFileLockAndDb');
  });

  it('applyPatch records file.modified attribution', async () => {
    const src = await readFile(join(process.cwd(), 'src/software/tools/applyPatch.ts'), 'utf-8');
    expect(src).toContain('file.modified');
    expect(src).toContain('withFileLockAndDb');
  });
});

describe('Live2: DOWNSTREAM PREPARE DENIAL on attribution failure', () => {
  // A stub DB whose audit INSERT always fails (attribution persistence failure).
  function failingMutationDb(): import('../tools/types.js').DbQuery {
    return {
      query: async (sql: string) => {
        if (/pg_advisory_lock|pg_advisory_unlock/i.test(sql)) return { rows: [{ o: null }] };
        if (/INSERT INTO audit_events/i.test(sql)) throw new Error('attribution insert failed');
        return { rows: [] };
      },
    };
  }

  // A stub DB for git_prepare_commit: task is active, but NO attribution
  // records exist for any candidate (latest-mutation query returns empty).
  function prepareDenyDb(): import('../tools/types.js').DbQuery {
    return {
      query: async (sql: string) => {
        if (/pg_advisory_lock|pg_advisory_unlock/i.test(sql)) return { rows: [{ o: null }] };
        if (/FROM tasks t/i.test(sql)) return { rows: [{ status: 'active' }] };
        if (/FROM audit_events ae/i.test(sql)) return { rows: [] };
        return { rows: [] };
      },
    };
  }

  it('A creates a file, attribution persistence fails, then prepare is DENIED', async () => {
    const denyFile = 'src/v2downstream.ts';
    const fullPath = join(workspaceDir, denyFile);
    try {
      // Step 1: create_file with failing attribution -> handler FAILS
      const createInput: ToolHandlerInput = {
        ...makeInput({ path: denyFile, content: 'export const downstream = 1;\n' }),
        db: failingMutationDb(),
      };
      const createResult = await createFileHandler(createInput);
      expect(createResult.success).toBe(false);
      expect(createResult.error).toContain('attribution_persistence_failed');
      // File may exist on disk with the new state (crash window acknowledged)
      // but there is NO valid attribution for it.

      // Step 2: file is visible as an untracked candidate in git status
      const status = await git(['status', '--porcelain']);
      expect(status.out).toContain(denyFile);

      // Step 3: git_prepare_commit must be DENIED (no valid attribution)
      const prepareInput: ToolHandlerInput = {
        ...makeInput({ message: 'attempt downstream commit' }),
        db: prepareDenyDb(),
      };
      const prepareResult = await gitPrepareCommitHandler(prepareInput);
      expect(prepareResult.success).toBe(false);
      // Denial specifically at the attribution/staging boundary (not a thrown error)
      expect(prepareResult.error).toContain('no attribution record');
      // No approval may be created / nothing staged
    } finally {
      try { await rm(fullPath, { force: true }); } catch { /* cleanup */ }
    }
  });
});

describe('Live2: RECOVERY by later authorized CHEF mutation', () => {
  // Stateful stub DB: first attribution INSERT throws (persistence failure),
  // subsequent INSERTs succeed and are queryable as latest-mutation records.
  function recoveryDb(): { db: import('../tools/types.js').DbQuery } {
    const rows: Array<{ resource_type: string; resource_id: string; actor_id: string; task_id: string; metadata: string }> = [];
    let failedOnce = false;
    const db: import('../tools/types.js').DbQuery = {
      query: async (sql: string, params?: unknown[]) => {
        if (/pg_advisory_lock|pg_advisory_unlock/i.test(sql)) return { rows: [{ o: null }] };
        if (/FROM tasks t/i.test(sql)) return { rows: [{ status: 'active' }] };
        if (/INSERT INTO audit_events/i.test(sql)) {
          if (!failedOnce) {
            failedOnce = true;
            throw new Error('attribution insert failed');
          }
          if (Array.isArray(params)) {
            rows.push({
              resource_type: String(params[5]),
              resource_id: String(params[6]),
              actor_id: String(params[1]),
              task_id: String(params[7]),
              metadata: String(params[8]),
            });
          }
          return { rows: [] };
        }
        if (/FROM audit_events ae/i.test(sql)) {
          const rid = params?.[0];
          const matches = rows.filter((r) => r.resource_type === 'file' && r.resource_id === rid);
          const last = matches[matches.length - 1];
          return {
            rows: last
              ? [{ id: 'a1', actor_id: last.actor_id, task_id: last.task_id, metadata: last.metadata }]
              : [],
          };
        }
        return { rows: [] };
      },
    };
    return { db };
  }

  it('A creates file (attribution fails) -> later authorized mutation records attribution -> prepare eligible', async () => {
    // Restore clean working tree so only our file is a git candidate
    await git(['checkout', '-q', '--', 'src/app.ts']);
    await git(['clean', '-fd', '-q']);

    const recFile = 'src/v2recover.ts';
    const fullPath = join(workspaceDir, recFile);
    const { db } = recoveryDb();
    try {
      // Step 1: create_file attribution persistence fails -> handler failure
      const createRes = await createFileHandler({
        ...makeInput({ path: recFile, content: 'v1\n' }),
        db,
      });
      expect(createRes.success).toBe(false);
      expect(createRes.error).toContain('attribution_persistence_failed');

      // Step 2: later authorized CHEF mutation (apply_patch) succeeds and
      // records fresh attribution matching current file state
      const hash1 = contentHash('v1\n');
      const patchRes = await applyPatchHandler({
        ...makeInput({ path: recFile, patch: 'v1\nv2\n', expectedContentHash: hash1 }),
        db,
      });
      expect(patchRes.success).toBe(true);

      // Step 3: file is now eligible again -> prepare succeeds and binds it
      const prepRes = await gitPrepareCommitHandler({
        ...makeInput({ message: 'recover eligibility' }),
        db,
      });
      expect(prepRes.success).toBe(true);
      expect(prepRes.data && typeof prepRes.data === 'object' && 'candidates' in prepRes.data).toBe(true);
      const candidates = (prepRes.data as { candidates: string[] }).candidates;
      expect(candidates).toContain(recFile);
    } finally {
      try { await rm(fullPath, { force: true }); } catch { /* cleanup */ }
    }
  });
});
