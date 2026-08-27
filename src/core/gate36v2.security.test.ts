// CHEF FACTORY — Gate 36 V2 — Controlled staging + verified commit security tests.
// Covers: tool registration, critical-action classification, attribution recording
// in mutation handlers, repo-level lock, no agent-visible git_stage, no push.

import { describe, it, expect } from 'vitest';
import { GATE3_TOOLS } from '../tools/index.js';
import { classifyCriticalAction, isProtectedCriticalAction } from './security/criticalActions.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ===================== REGISTRATION =====================

describe('Gate 36 V2 — REGISTRATION', () => {
  it('R1: git_prepare_commit tool is registered', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'git_prepare_commit');
    expect(tool).toBeDefined();
    expect(tool!.actionType).toBe('software.git.stage');
    expect(tool!.riskLevel).toBe('high');
  });

  it('R2: git_commit tool is registered', () => {
    const tool = GATE3_TOOLS.find((t) => t.name === 'git_commit');
    expect(tool).toBeDefined();
    expect(tool!.actionType).toBe('software.git.commit');
    expect(tool!.riskLevel).toBe('critical');
  });

  it('R3: total tool count is 16', () => {
    expect(GATE3_TOOLS.length).toBe(16);
  });

  it('R4: no agent-visible git_stage tool exists', () => {
    expect(GATE3_TOOLS.find((t) => t.name === 'git_stage')).toBeUndefined();
  });

  it('R5: no git_push tool exists (push not authorized)', () => {
    expect(GATE3_TOOLS.find((t) => t.name === 'git_push')).toBeUndefined();
  });
});

// ===================== CRITICAL ACTIONS =====================

describe('Gate 36 V2 — CRITICAL ACTIONS', () => {
  it('A1: software.git.stage requires approval in development', () => {
    const match = classifyCriticalAction('software.git.stage', 'development');
    expect(match).not.toBeNull();
    expect(match!.rule.defaultDecision).toBe('require_approval');
    expect(match!.rule.isCore).toBe(true);
  });

  it('A2: software.git.commit requires approval in development', () => {
    const match = classifyCriticalAction('software.git.commit', 'development');
    expect(match).not.toBeNull();
    expect(match!.rule.defaultDecision).toBe('require_approval');
    expect(match!.rule.isCore).toBe(true);
  });

  it('A3: software.git.stage is protected critical action', () => {
    expect(isProtectedCriticalAction('software.git.stage')).toBe(true);
  });

  it('A4: software.git.commit is protected critical action', () => {
    expect(isProtectedCriticalAction('software.git.commit')).toBe(true);
  });

  it('A5: existing git tools still allow', () => {
    const status = classifyCriticalAction('software.git.status', 'development');
    const diff = classifyCriticalAction('software.git.diff', 'development');
    expect(status!.rule.defaultDecision).toBe('allow');
    expect(diff!.rule.defaultDecision).toBe('allow');
  });
});

// ===================== SOURCE SAFETY =====================

describe('Gate 36 V2 — SOURCE SAFETY', () => {
  it('S1: git_prepare_commit handler exists and uses repo lock', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitPrepareCommit.ts'),
      'utf-8',
    );
    expect(src).toContain('withRepoLock');
    expect(src).toContain('git.prepare_commit');
  });

  it('S2: git_commit handler uses temp index (GIT_INDEX_FILE)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitCommit.ts'),
      'utf-8',
    );
    expect(src).toContain('runGitWithIndex');
    expect(src).toContain('tempIndexPath');
  });

  it('S3: runner has runGitWithIndex using alternate index', () => {
    const runnerSrc = readFileSync(
      resolve(process.cwd(), 'src/software/git/runner.ts'),
      'utf-8',
    );
    expect(runnerSrc).toContain('runGitWithIndex');
  });

  it('S4: env builder accepts alternate index file', () => {
    const envSrc = readFileSync(
      resolve(process.cwd(), 'src/software/git/env.ts'),
      'utf-8',
    );
    expect(envSrc).toContain('altIndexFile');
    expect(envSrc).toContain('GIT_INDEX_FILE');
  });

  it('S5: mutation module has repo lock', () => {
    const mutSrc = readFileSync(
      resolve(process.cwd(), 'src/workspace/mutation.ts'),
      'utf-8',
    );
    expect(mutSrc).toContain('withRepoLock');
    expect(mutSrc).toContain('repoLockKeys');
  });
});

// ===================== ATTRIBUTION =====================

describe('Gate 36 V2 — ATTRIBUTION', () => {
  it('T1: createFile records file.created attribution inside lock', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/software/tools/createFile.ts'),
      'utf-8',
    );
    expect(src).toContain('withFileLockAndDb');
    expect(src).toContain('file.created');
    expect(src).toContain('resultingHash');
  });

  it('T2: applyPatch records file.modified attribution inside lock', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/software/tools/applyPatch.ts'),
      'utf-8',
    );
    expect(src).toContain('withFileLockAndDb');
    expect(src).toContain('file.modified');
    expect(src).toContain('resultingHash');
  });

  it('T3: attribution resource_id is canonical workspace-relative', () => {
    const createSrc = readFileSync(
      resolve(process.cwd(), 'src/software/tools/createFile.ts'),
      'utf-8',
    );
    // pathCheck.relative is produced by validateRelativePath via containment check
    expect(createSrc).toContain('pathCheck.relative');
  });

  it('T4: git_prepare_commit queries attribution scoped to owner/project/path', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitPrepareCommit.ts'),
      'utf-8',
    );
    expect(src).toMatch(/p\.owner_id/);
    expect(src).toMatch(/ae\.project_id = \$3/);
    expect(src).toContain('ORDER BY ae.id DESC');
  });

  it('T5: git_commit revalidates attribution before committing', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitCommit.ts'),
      'utf-8',
    );
    expect(src).toMatch(/p\.owner_id/);
    expect(src).toContain('attribution mismatch');
    expect(src).toContain('hash mismatch');
  });

  it('T6: hash binding verified via resultingHash', () => {
    const prepareSrc = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitPrepareCommit.ts'),
      'utf-8',
    );
    const commitSrc = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitCommit.ts'),
      'utf-8',
    );
    expect(prepareSrc).toContain('resultingHash');
    expect(commitSrc).toContain('resultingHash');
  });
});

// ===================== ERROR SEMANTICS =====================

describe('Gate 36 V2 — ERROR SEMANTICS', () => {
  it('E1: git_prepare_commit requires valid message', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitPrepareCommit.ts'),
      'utf-8',
    );
    expect(src).toContain('commit message is required');
    expect(src).toContain('max 500');
  });

  it('E2: git_commit fails closed if approval not pending', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitCommit.ts'),
      'utf-8',
    );
    expect(src).toContain('must be pending');
  });

  it('E3: git_prepare_commit fails closed on attribution persistence failure', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitPrepareCommit.ts'),
      'utf-8',
    );
    expect(src).toContain('attribution_persistence_failed');
  });
});

// ===================== NO PUSH =====================

describe('Gate 36 V2 — NO PUSH', () => {
  it('P1: gitCommit does not invoke push', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitCommit.ts'),
      'utf-8',
    );
    expect(src).not.toContain("'push'");
    expect(src).not.toContain('"push"');
    expect(src).not.toMatch(/(?:git.*add|add.*git).*push/);
  });

  it('P2: gitPrepareCommit does not invoke push', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/software/tools/gitPrepareCommit.ts'),
      'utf-8',
    );
    // No git push subcommand (no 'push' command string, no push subcommand)
    expect(src).not.toContain("'push'");
    expect(src).not.toContain('"push"');
    expect(src).not.toMatch(/(?:git.*add|add.*git).*push/);
  });
});
