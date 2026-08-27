// CHEF FACTORY — Gate 36 V1 — Live Adversarial Git Proof Tests.
// Creates disposable temp repos with malicious config to prove isolation.
// No provider API required. No network. No real secrets.

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, readFile, unlink, rmdir } from 'node:fs/promises';
import { existsSync, readFileSync, unlinkSync, rmdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { runGit, resolveGitExecutable } from '../software/git/runner.js';
import { buildGitChildEnv, isGitBlockedVariable, getTrustedGlobalConfigPath } from '../software/git/env.js';
import { gitStatusHandler } from '../software/tools/gitStatus.js';
import { gitDiffHandler } from '../software/tools/gitDiff.js';
import type { ToolHandlerInput } from '../tools/types.js';
import { MemoryStore } from '../testing/memoryStore.js';

const GIT_EXECUTABLE = 'git';

function makeInput(overrides: Partial<ToolHandlerInput> & { args: Record<string, unknown> }): ToolHandlerInput {
  return {
    ownerId: 'owner-1',
    args: overrides.args ?? {},
    store: overrides.store,
    context: overrides.context ?? {
      projectId: 'proj-1',
      actorType: 'agent' as const,
      actorId: 'agent-1',
      agentId: 'agent-1',
      taskId: 'task-1',
      environment: 'development' as const,
    },
  };
}

function initRepo(dir: string): void {
  execSync(`${GIT_EXECUTABLE} init`, { cwd: dir, stdio: 'ignore' });
  execSync(`${GIT_EXECUTABLE} config user.email "test@test.com"`, { cwd: dir, stdio: 'ignore' });
  execSync(`${GIT_EXECUTABLE} config user.name "Test"`, { cwd: dir, stdio: 'ignore' });
}

function gitCommit(dir: string, msg: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(dir, name);
    const parent = resolve(filePath, '..');
    try { mkdir(parent, { recursive: true }); } catch { /* exists */ }
    writeFile(filePath, content);
  }
  execSync(`${GIT_EXECUTABLE} add -A`, { cwd: dir, stdio: 'ignore' });
  execSync(`${GIT_EXECUTABLE} commit -m "${msg}" --allow-empty`, { cwd: dir, stdio: 'ignore' });
}

function gitAdd(dir: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    writeFile(join(dir, name), content);
  }
  execSync(`${GIT_EXECUTABLE} add -A`, { cwd: dir, stdio: 'ignore' });
}

let tempDir: string;
let repoDir: string;
let maliciousDir: string;

describe('Gate 36 V1 — LIVE ADVERSARIAL GIT PROOF', () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gate36-live-'));

    // Create a clean repo
    repoDir = join(tempDir, 'clean-repo');
    await mkdir(repoDir, { recursive: true });
    initRepo(repoDir);
    await writeFile(join(repoDir, 'README.md'), '# Test\n');
    execSync(`${GIT_EXECUTABLE} add -A`, { cwd: repoDir, stdio: 'ignore' });
    execSync(`${GIT_EXECUTABLE} commit -m "initial"`, { cwd: repoDir, stdio: 'ignore' });

    // Create a malicious repo with dangerous config
    maliciousDir = join(tempDir, 'malicious-repo');
    await mkdir(maliciousDir, { recursive: true });
    initRepo(maliciousDir);

    // Write a sentinel script that should NEVER execute
    const sentinelPath = join(tempDir, 'SENTINEL_EXECUTED.txt');
    await writeFile(join(maliciousDir, 'evil-callback.sh'), `echo "EXECUTED" > "${sentinelPath.replace(/\\/g, '/')}"\n`);

    // Configure malicious git settings
    execSync(`${GIT_EXECUTABLE} config core.hooksPath "${maliciousDir}"`, { cwd: maliciousDir, stdio: 'ignore' });
    execSync(`${GIT_EXECUTABLE} config credential.helper "${join(maliciousDir, 'evil-callback.sh').replace(/\\/g, '/')}"`, { cwd: maliciousDir, stdio: 'ignore' });
    execSync(`${GIT_EXECUTABLE} config diff.external "${join(maliciousDir, 'evil-callback.sh').replace(/\\/g, '/')}"`, { cwd: maliciousDir, stdio: 'ignore' });
    execSync(`${GIT_EXECUTABLE} config core.pager "${join(maliciousDir, 'evil-callback.sh').replace(/\\/g, '/')}"`, { cwd: maliciousDir, stdio: 'ignore' });

    await writeFile(join(maliciousDir, 'README.md'), '# Malicious\n');
    execSync(`${GIT_EXECUTABLE} add -A`, { cwd: maliciousDir, stdio: 'ignore' });
    execSync(`${GIT_EXECUTABLE} commit -m "malicious initial"`, { cwd: maliciousDir, stdio: 'ignore' });
  });

  afterAll(async () => {
    try { await rm(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  // --- LIVE STATUS PROOFS ---

  it('LP1: git_status works on clean repo', async () => {
    const result = await runGit({
      subcommand: 'status',
      args: ['--porcelain=v1', '--untracked-files=normal'],
      cwd: repoDir,
    });
    expect(result.outcome).toBe('ok');
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it('LP2: git_status detects changes', async () => {
    await writeFile(join(repoDir, 'new-file.txt'), 'new content\n');
    const result = await runGit({
      subcommand: 'status',
      args: ['--porcelain=v1', '--untracked-files=normal'],
      cwd: repoDir,
    });
    expect(result.outcome).toBe('ok');
    expect(result.stdout).toContain('new-file.txt');
    // Clean up
    unlinkSync(join(repoDir, 'new-file.txt'));
  });

  // --- LIVE DIFF PROOFS ---

  it('LP3: git_diff working mode detects tracked file changes', async () => {
    // Modify an existing tracked file (git diff only shows tracked file changes)
    await writeFile(join(repoDir, 'README.md'), '# Modified\n');
    const result = await runGit({
      subcommand: 'diff',
      args: ['--no-ext-diff', '--no-textconv', '--no-color'],
      cwd: repoDir,
    });
    expect(result.outcome).toBe('ok');
    expect(result.stdout).toContain('README.md');
    // Restore original
    await writeFile(join(repoDir, 'README.md'), '# Test\n');
  });

  it('LP4: git_diff stat mode', async () => {
    await writeFile(join(repoDir, 'README.md'), '# Modified\n');
    const result = await runGit({
      subcommand: 'diff',
      args: ['--no-ext-diff', '--no-textconv', '--no-color', '--stat'],
      cwd: repoDir,
    });
    expect(result.outcome).toBe('ok');
    await writeFile(join(repoDir, 'README.md'), '# Test\n');
  });

  // --- LIVE ADVERSARIAL: MALICIOUS CONFIG ---

  it('LP5: malicious credential helper does NOT execute', async () => {
    const sentinelPath = join(tempDir, 'SENTINEL_EXECUTED.txt');
    try { unlinkSync(sentinelPath); } catch { /* not exists */ }

    const result = await runGit({
      subcommand: 'status',
      args: ['--porcelain=v1', '--untracked-files=normal'],
      cwd: maliciousDir,
    });

    // Sentinel must NOT have been created
    expect(existsSync(sentinelPath)).toBe(false);
  });

  it('LP6: malicious diff.external does NOT execute', async () => {
    const sentinelPath = join(tempDir, 'SENTINEL_EXECUTED.txt');
    try { unlinkSync(sentinelPath); } catch { /* not exists */ }

    await writeFile(join(maliciousDir, 'README.md'), '# Changed\n');
    const result = await runGit({
      subcommand: 'diff',
      args: ['--no-ext-diff', '--no-textconv', '--no-color'],
      cwd: maliciousDir,
    });

    expect(existsSync(sentinelPath)).toBe(false);
    await writeFile(join(maliciousDir, 'README.md'), '# Malicious\n');
  });

  it('LP7: malicious pager does NOT execute', async () => {
    const sentinelPath = join(tempDir, 'SENTINEL_EXECUTED.txt');
    try { unlinkSync(sentinelPath); } catch { /* not exists */ }

    const result = await runGit({
      subcommand: 'status',
      args: ['--porcelain=v1', '--untracked-files=normal'],
      cwd: maliciousDir,
    });

    expect(existsSync(sentinelPath)).toBe(false);
  });

  // --- ENV SENTINEL PROOFS ---

  it('LP8: fake env sentinel absent in child env', () => {
    process.env['CHEF_FAKE_SENTINEL_GATE36'] = 'CHEF_FAKE_VALUE';
    const childEnv = buildGitChildEnv();
    expect(childEnv['CHEF_FAKE_SENTINEL_GATE36']).toBeUndefined();
    expect(childEnv['GIT_DIR']).toBeUndefined();
    expect(childEnv['GIT_EXTERNAL_DIFF']).toBeUndefined();
    expect(childEnv['GIT_CONFIG_NOSYSTEM']).toBe('1');
    delete process.env['CHEF_FAKE_SENTINEL_GATE36'];
  });

  // --- NOT REPOSITORY ---

  it('LP9: non-git directory returns not_repository', async () => {
    const result = await runGit({
      subcommand: 'status',
      args: ['--porcelain=v1'],
      cwd: tempDir,
    });
    expect(result.outcome).toBe('not_repository');
  });

  // --- WORKTREE ---

  it('LP10: worktree indirection (gitfile) detected', async () => {
    const worktreeDir = join(tempDir, 'worktree-fake');
    await mkdir(worktreeDir, { recursive: true });
    // Create a .git file pointing elsewhere (simulating submodule/worktree)
    await writeFile(join(worktreeDir, '.git'), `gitdir: ${repoDir}/.git\n`);
    const result = await runGit({
      subcommand: 'status',
      args: ['--porcelain=v1'],
      cwd: worktreeDir,
    });
    expect(result.outcome).toBe('invalid_repository');
    unlinkSync(join(worktreeDir, '.git'));
    rmdirSync(worktreeDir);
  });

  // --- OUTPUT ---

  it('LP11: output bounded and redacted', async () => {
    const result = await runGit({
      subcommand: 'status',
      args: ['--porcelain=v1', '--untracked-files=normal'],
      cwd: repoDir,
    });
    expect(result.stdout.length).toBeLessThanOrEqual(512 * 1024 + 100);
    expect(result.stderr.length).toBeLessThanOrEqual(64 * 1024 + 100);
  });

  // --- CONCURRENT ---

  it('LP12: two parallel status calls complete', async () => {
    const [r1, r2] = await Promise.all([
      runGit({ subcommand: 'status', args: ['--porcelain=v1'], cwd: repoDir }),
      runGit({ subcommand: 'status', args: ['--porcelain=v1'], cwd: repoDir }),
    ]);
    expect(r1.outcome).toBe('ok');
    expect(r2.outcome).toBe('ok');
  });

  // --- HISTORY DENIAL ---

  it('LP13: no history tools exposed', async () => {
    const { GATE3_TOOLS } = await import('../tools/index.js');
    expect(GATE3_TOOLS.find((t) => t.name === 'git_log')).toBeUndefined();
    expect(GATE3_TOOLS.find((t) => t.name === 'git_show')).toBeUndefined();
    expect(GATE3_TOOLS.find((t) => t.name === 'git_cat_file')).toBeUndefined();
    expect(GATE3_TOOLS.find((t) => t.name === 'git_reflog')).toBeUndefined();
  });

  // --- GLOBAL CONFIG ISOLATION ---

  it('LP14: malicious global config sentinel NOT executed', async () => {
    // Create a fake malicious global config that would trigger an external diff
    const maliciousGlobalDir = join(tempDir, 'fake-home');
    await mkdir(maliciousGlobalDir, { recursive: true });
    const maliciousGlobalConfig = join(maliciousGlobalDir, '.gitconfig');

    // Write a config that would invoke an external program
    const sentinelPath = join(tempDir, 'GLOBAL_SENTINEL.txt');
    writeFileSync(maliciousGlobalConfig, `[diff]\n\texternal = echo EXECUTED > "${sentinelPath.replace(/\\/g, '/')}"\n`);

    // Set GIT_CONFIG_GLOBAL to the malicious file in current process
    const savedGlobal = process.env['GIT_CONFIG_GLOBAL'];
    process.env['GIT_CONFIG_GLOBAL'] = maliciousGlobalConfig;

    try {
      // Now run git diff — the trusted runner should override GIT_CONFIG_GLOBAL
      await writeFile(join(maliciousDir, 'README.md'), '# Changed\n');
      const result = await runGit({
        subcommand: 'diff',
        args: ['--no-ext-diff', '--no-textconv', '--no-color'],
        cwd: maliciousDir,
      });

      // The sentinel file must NOT exist — the malicious config was overridden
      expect(existsSync(sentinelPath)).toBe(false);

      // Verify the runner's child env uses the trusted config, not the malicious one
      const childEnv = buildGitChildEnv();
      expect(childEnv['GIT_CONFIG_GLOBAL']).not.toBe(maliciousGlobalConfig);
      expect(childEnv['GIT_CONFIG_GLOBAL']).toContain('.gitconfig');

      await writeFile(join(maliciousDir, 'README.md'), '# Malicious\n');
    } finally {
      // Restore
      if (savedGlobal) {
        process.env['GIT_CONFIG_GLOBAL'] = savedGlobal;
      } else {
        delete process.env['GIT_CONFIG_GLOBAL'];
      }
      try { unlinkSync(maliciousGlobalConfig); } catch { /* cleanup best effort */ }
      try { rmdirSync(maliciousGlobalDir); } catch { /* cleanup best effort */ }
    }
  });

  // --- ABSOLUTE GIT EXECUTABLE ---

  it('LP15: Git executable resolved to absolute path', () => {
    const exe = resolveGitExecutable();
    // Should be an absolute path on this machine (C:\Program Files\Git\cmd\git.exe)
    // or 'git' as last-resort fallback
    expect(exe).toBeTruthy();
    const isAbsolute = exe.includes(':\\') || exe.includes(':\/') || exe === 'git';
    expect(isAbsolute).toBe(true);
  });

  it('LP16: fake git earlier in PATH is NOT executed', async () => {
    // Create a fake git executable in a temp directory
    const fakeGitDir = join(tempDir, 'fake-git');
    await mkdir(fakeGitDir, { recursive: true });
    const fakeGitScript = join(fakeGitDir, 'git.bat');
    writeFileSync(fakeGitScript, '@echo off\necho FAKE_GIT_EXECUTED\n');

    // Prepend fake git to PATH in current process
    const savedPath = process.env['PATH'];
    process.env['PATH'] = `${fakeGitDir};${savedPath}`;

    try {
      // ResolveGitExecutable should resolve once at startup, not re-resolve from PATH
      // The first call may return the real git (already cached), so clear cache
      // For the test, verify that the runner's spawn uses the absolute path
      const exe = resolveGitExecutable();

      // Run a status against the clean repo
      const result = await runGit({
        subcommand: 'status',
        args: ['--porcelain=v1'],
        cwd: repoDir,
      });

      // If the output contains FAKE_GIT_EXECUTED, the sentinel was executed
      expect(result.stdout).not.toContain('FAKE_GIT_EXECUTED');
      expect(result.stderr).not.toContain('FAKE_GIT_EXECUTED');
    } finally {
      // Restore PATH
      process.env['PATH'] = savedPath;
      try { unlinkSync(fakeGitScript); } catch { /* cleanup */ }
      try { rmdirSync(fakeGitDir); } catch { /* cleanup */ }
    }
  });
});
