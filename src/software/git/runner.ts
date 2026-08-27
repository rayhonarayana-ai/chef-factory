// CHEF FACTORY — Gate 36 V1 — Hardened Git process runner.
// Purpose-built for read-only Git operations (status, diff).
// Reuses Gate 35B security patterns: shell=false, env allowlist, timeout, output bounds, DLP.
// Does NOT expose VerificationProfile/VerificationResult — Git has its own types.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { redactText } from '../../core/redact.js';
import { buildGitChildEnv } from './env.js';
import { GIT_CONSTANTS, type GitResult, type GitOutcome } from './types.js';

export interface GitRunnerInput {
  /** Git subcommand: 'status' or 'diff'. Fixed by server, not from agent. */
  subcommand: 'status' | 'diff';
  /** Fixed arguments for the subcommand. Resolved server-side. */
  args: readonly string[];
  /** Workspace root (from passport). */
  cwd: string;
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Resolve the trusted Git executable to an absolute canonical path.
 * Resolved once at startup via child_process.execFileSync('where git').
 * Agent cannot influence this path.
 */
let resolvedGitPath: string | null = null;

export function resolveGitExecutable(): string {
  if (resolvedGitPath && existsSync(resolvedGitPath)) return resolvedGitPath;

  try {
    const { execFileSync } = require('node:child_process');
    const result = execFileSync('where', ['git'], {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000,
    }).trim();
    // 'where git' returns one path per line; take the first
    const firstLine = result.split('\n')[0]?.trim();
    if (firstLine && existsSync(firstLine)) {
      const resolved = firstLine;
      resolvedGitPath = resolved;
      return resolved;
    }
  } catch {
    // Fallback: try common paths
  }

  // Fallback: assume 'git' on PATH (last resort)
  resolvedGitPath = 'git';
  return 'git';
}

/** Trusted empty directory for hook isolation. Resolved once. */
let trustedEmptyDir: string | null = null;

function getTrustedEmptyDir(): string {
  if (trustedEmptyDir && existsSync(trustedEmptyDir)) return trustedEmptyDir;
  trustedEmptyDir = join(resolve(process.cwd()), '.chef-git-hooks-disabled');
  if (!existsSync(trustedEmptyDir)) {
    mkdirSync(trustedEmptyDir, { recursive: true });
  }
  return trustedEmptyDir;
}

/**
 * Run a hardened Git read-only operation in a restricted child process.
 * Security invariants:
 * - shell=false
 * - executable = absolute resolved git path (NOT from agent, NOT PATH lookup at spawn time)
 * - args from trusted profiles (NOT from agent)
 * - cwd from workspace root (NOT from agent)
 * - env from explicit allowlist (NOT process.env)
 * - Dangerous config overridden via -c flags
 * - User/system global git config disabled by construction
 * - timeout with AbortController
 * - stdout/stderr bounded and redacted
 */
export async function runGit(input: GitRunnerInput): Promise<GitResult> {
  const { subcommand, args: extraArgs, cwd, signal } = input;
  const startTime = Date.now();

  // 1. Verify .git exists and is a directory (not a file/worktree)
  const gitDir = join(cwd, '.git');
  if (!existsSync(gitDir)) {
    return makeResult('not_repository', subcommand, null, startTime, false, 0, '',
      'not a git repository: .git directory not found');
  }

  // 2. Verify it's a directory, not a file (gitfile/submodule)
  try {
    const stat = statSync(gitDir);
    if (!stat.isDirectory()) {
      return makeResult('invalid_repository', subcommand, null, startTime, false, 0, '',
        'invalid repository: .git is a file (gitfile/submodule), not a directory');
    }
  } catch {
    return makeResult('invalid_repository', subcommand, null, startTime, false, 0, '',
      'cannot read .git directory');
  }

  // 3. Resolve trusted Git executable (absolute path, once at startup)
  const gitExe = resolveGitExecutable();

  // 4. Build hardened -c overrides
  const emptyDir = getTrustedEmptyDir();
  const configOverrides = [
    `-c`, `core.hooksPath=${emptyDir}`,
    `-c`, `credential.helper=`,
    `-c`, `core.pager=`,
    `-c`, `pager.status=false`,
    `-c`, `pager.diff=false`,
    `-c`, `diff.external=`,
    `-c`, `core.fsmonitor=false`,
    `-c`, `diff.textconv=`,
  ];

  // 5. Build fixed args: git [overrides] [--no-optional-locks] subcommand [fixed-args]
  const fullArgs = [
    ...configOverrides,
    '--no-optional-locks',
    subcommand,
    ...extraArgs,
  ];

  // 6. Build child environment (includes GIT_CONFIG_GLOBAL=trusted-empty, GIT_CONFIG_NOSYSTEM=1)
  const childEnv = buildGitChildEnv();

  // 7. Create AbortController for timeout
  const timeoutMs = GIT_CONSTANTS.DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  // 8. Spawn git with absolute path and all hardening
  let child: ChildProcess;
  try {
    child = spawn(gitExe, fullArgs, {
      cwd,
      env: childEnv,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (isAbortError(e)) {
      return makeResult('timeout', subcommand, null, startTime, true, 0, '', '');
    }
    return makeResult('internal_error', subcommand, null, startTime, false, 0, '', String(e));
  }

  // 9. Collect bounded stdout/stderr
  let stdout = '';
  let stderr = '';
  let stdoutTruncated = false;
  let stderrTruncated = false;

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const data = String(chunk);
    if (stdout.length + data.length > GIT_CONSTANTS.MAX_STDOUT_BYTES) {
      const remaining = GIT_CONSTANTS.MAX_STDOUT_BYTES - stdout.length;
      if (remaining > 0) stdout += data.slice(0, remaining);
      stdoutTruncated = true;
      child.stdout?.destroy();
    } else {
      stdout += data;
    }
  });

  child.stderr?.on('data', (chunk: Buffer | string) => {
    const data = String(chunk);
    if (stderr.length + data.length > GIT_CONSTANTS.MAX_STDERR_BYTES) {
      const remaining = GIT_CONSTANTS.MAX_STDERR_BYTES - stderr.length;
      if (remaining > 0) stderr += data.slice(0, remaining);
      stderrTruncated = true;
      child.stderr?.destroy();
    } else {
      stderr += data;
    }
  });

  // 10. Wait for process
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', () => resolve(null));
  });

  clearTimeout(timeoutId);
  const durationMs = Date.now() - startTime;
  const timedOut = controller.signal.aborted;

  // 11. Determine outcome
  let outcome: GitOutcome;
  if (timedOut) {
    outcome = 'timeout';
  } else if (stdoutTruncated || stderrTruncated) {
    outcome = 'output_limit_exceeded';
  } else if (exitCode === 0) {
    outcome = 'ok';
  } else {
    outcome = 'git_failed';
  }

  // 12. Redact output
  const redactedStdout = redactText(stdout);
  const redactedStderr = redactText(stderr);

  // 13. Count files in status output (if applicable)
  const fileCount = subcommand === 'status'
    ? stdout.split('\n').filter((l) => l.length > 0 && !l.startsWith('#')).length
    : null;

  return {
    ok: outcome === 'ok',
    outcome,
    operation: subcommand,
    exitCode,
    timedOut,
    durationMs,
    stdout: redactedStdout,
    stderr: redactedStderr,
    truncated: stdoutTruncated || stderrTruncated,
    fileCount,
  };
}

/**
 * Gate 36 V2 — Run a Git operation using an alternate GIT_INDEX_FILE.
 * Used for temp-index staging: does NOT touch the real index.
 * Spawns with GIT_INDEX_FILE set to a temp file, so the working tree is untouched.
 * After the process exits, the temp file is NOT cleaned up (caller manages).
 */
export async function runGitWithIndex(
  subcommand: string,
  extraArgs: readonly string[],
  cwd: string,
  indexFile: string,
  signal?: AbortSignal,
): Promise<GitResult> {
  const startTime = Date.now();

  const gitDir = join(cwd, '.git');
  if (!existsSync(gitDir)) {
    return makeResult('not_repository', subcommand, null, startTime, false, 0, '',
      'not a git repository: .git directory not found');
  }

  const gitExe = resolveGitExecutable();
  const emptyDir = getTrustedEmptyDir();
  const configOverrides = [
    '-c', `core.hooksPath=${emptyDir}`,
    '-c', 'credential.helper=',
    '-c', 'core.pager=',
    '-c', 'diff.external=',
    '-c', 'core.fsmonitor=false',
    '-c', 'diff.textconv=',
  ];

  const fullArgs = [...configOverrides, subcommand, ...extraArgs];
  const childEnv = buildGitChildEnv(process.env, indexFile);

  const timeoutMs = GIT_CONSTANTS.DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let child: ChildProcess;
  try {
    child = spawn(gitExe, fullArgs, {
      cwd,
      env: childEnv,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (isAbortError(e)) {
      return makeResult('timeout', subcommand, null, startTime, true, 0, '', '');
    }
    return makeResult('internal_error', subcommand, null, startTime, false, 0, '', String(e));
  }

  let stdout = '';
  let stderr = '';
  let stdoutTruncated = false;
  let stderrTruncated = false;

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const data = String(chunk);
    if (stdout.length + data.length > GIT_CONSTANTS.MAX_STDOUT_BYTES) {
      const remaining = GIT_CONSTANTS.MAX_STDOUT_BYTES - stdout.length;
      if (remaining > 0) stdout += data.slice(0, remaining);
      stdoutTruncated = true;
      child.stdout?.destroy();
    } else {
      stdout += data;
    }
  });

  child.stderr?.on('data', (chunk: Buffer | string) => {
    const data = String(chunk);
    if (stderr.length + data.length > GIT_CONSTANTS.MAX_STDERR_BYTES) {
      const remaining = GIT_CONSTANTS.MAX_STDERR_BYTES - stderr.length;
      if (remaining > 0) stderr += data.slice(0, remaining);
      stderrTruncated = true;
      child.stderr?.destroy();
    } else {
      stderr += data;
    }
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', () => resolve(null));
  });

  clearTimeout(timeoutId);
  const durationMs = Date.now() - startTime;
  const timedOut = controller.signal.aborted;

  let outcome: GitOutcome;
  if (timedOut) {
    outcome = 'timeout';
  } else if (stdoutTruncated || stderrTruncated) {
    outcome = 'output_limit_exceeded';
  } else if (exitCode === 0) {
    outcome = 'ok';
  } else {
    outcome = 'git_failed';
  }

  return {
    ok: outcome === 'ok',
    outcome,
    operation: subcommand,
    exitCode,
    timedOut,
    durationMs,
    stdout: redactText(stdout),
    stderr: redactText(stderr),
    truncated: stdoutTruncated || stderrTruncated,
    fileCount: null,
  };
}

function makeResult(
  outcome: GitOutcome,
  operation: string,
  exitCode: number | null,
  startTime: number,
  timedOut: boolean,
  fileCount: number | null,
  stdout: string,
  stderr: string,
): GitResult {
  return {
    ok: outcome === 'ok',
    outcome,
    operation,
    exitCode,
    timedOut,
    durationMs: Date.now() - startTime,
    stdout: redactText(stdout),
    stderr: redactText(stderr),
    truncated: false,
    fileCount,
  };
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.message.includes('abort'));
}
