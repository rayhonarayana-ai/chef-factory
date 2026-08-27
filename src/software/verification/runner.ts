// CHEF FACTORY — Gate 35B — Restricted verification process runner.
// Enforces: shell=false, trusted executable, trusted args, trusted cwd,
// explicit env allowlist, timeout, AbortSignal, stdout/stderr bounds, DLP.
// No generic public process-runner tool.

import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { redactText } from '../../core/redact.js';
import { buildChildEnv } from './env.js';
import type { VerificationProfile, VerificationResult, VerificationOutcome } from './types.js';
import { VERIFICATION_CONSTANTS } from './types.js';

export interface RunVerificationInput {
  profile: VerificationProfile;
  workspaceRoot: string;
  signal?: AbortSignal;
  /** Optional test filter pattern — strictly validated. */
  filter?: string;
}

/**
 * Run a verification operation in a restricted child process.
 * All security invariants enforced here:
 * - shell=false (NEVER true)
 * - executable from trusted profile (NOT from agent)
 * - args from trusted profile (NOT from agent)
 * - cwd from workspace root (NOT from agent)
 * - env from explicit allowlist (NOT process.env)
 * - timeout with AbortController
 * - stdout/stderr bounded and redacted
 */
export async function runVerification(input: RunVerificationInput): Promise<VerificationResult> {
  const { profile, workspaceRoot, signal, filter } = input;
  const startTime = Date.now();

  // Build final args: trusted profile args + optional validated filter
  const args = [...profile.script ? [profile.script] : [], ...profile.args];
  if (filter) {
    // Only allow safe filter characters: alphanumeric, slashes, dots, dashes, underscores, colons
    if (!/^[a-zA-Z0-9/\\._\-:]+$/.test(filter)) {
      return makeResult('invalid_operation', profile.operation, null, startTime, false, null, '',
        'invalid filter pattern: only alphanumeric, slashes, dots, dashes, underscores, colons allowed');
    }
    args.push(filter);
  }

  // Build child environment — explicit allowlist, NO secrets
  const childEnv = buildChildEnv();

  // Create AbortController for timeout
  const timeoutMs = Math.min(profile.timeoutMs, VERIFICATION_CONSTANTS.MAX_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Combine external signal with timeout
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let child: ChildProcess;
  try {
    child = spawn(profile.executable, args, {
      cwd: workspaceRoot,
      env: childEnv,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (isAbortError(e)) {
      return makeResult('timeout', profile.operation, null, startTime, true, null, '', '');
    }
    return makeResult('internal_error', profile.operation, null, startTime, false, null, '', String(e));
  }

  // Collect bounded stdout/stderr
  let stdout = '';
  let stderr = '';
  let stdoutTruncated = false;
  let stderrTruncated = false;

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const data = String(chunk);
    if (stdout.length + data.length > VERIFICATION_CONSTANTS.MAX_STDOUT_BYTES) {
      const remaining = VERIFICATION_CONSTANTS.MAX_STDOUT_BYTES - stdout.length;
      if (remaining > 0) stdout += data.slice(0, remaining);
      stdoutTruncated = true;
      child.stdout?.destroy();
    } else {
      stdout += data;
    }
  });

  child.stderr?.on('data', (chunk: Buffer | string) => {
    const data = String(chunk);
    if (stderr.length + data.length > VERIFICATION_CONSTANTS.MAX_STDERR_BYTES) {
      const remaining = VERIFICATION_CONSTANTS.MAX_STDERR_BYTES - stderr.length;
      if (remaining > 0) stderr += data.slice(0, remaining);
      stderrTruncated = true;
      child.stderr?.destroy();
    } else {
      stderr += data;
    }
  });

  // Wait for process to complete
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', () => resolve(null));
  });

  clearTimeout(timeoutId);
  const durationMs = Date.now() - startTime;
  const timedOut = controller.signal.aborted;

  // Determine outcome
  let outcome: VerificationOutcome;
  if (timedOut) {
    outcome = 'timeout';
  } else if (stdoutTruncated || stderrTruncated) {
    outcome = 'output_limit_exceeded';
  } else if (exitCode === 0) {
    outcome = 'passed';
  } else {
    outcome = 'failed';
  }

  // Redact output before returning to agent
  const redactedStdout = redactText(stdout);
  const redactedStderr = redactText(stderr);

  return {
    ok: outcome === 'passed',
    outcome,
    operation: profile.operation,
    exitCode,
    timedOut,
    durationMs,
    stdout: redactedStdout,
    stderr: redactedStderr,
    truncated: stdoutTruncated || stderrTruncated,
    manifestHash: null,
  };
}

function makeResult(
  outcome: VerificationOutcome,
  operation: VerificationProfile['operation'],
  exitCode: number | null,
  startTime: number,
  timedOut: boolean,
  manifestHash: string | null,
  stdout: string,
  stderr: string,
): VerificationResult {
  return {
    ok: outcome === 'passed',
    outcome,
    operation,
    exitCode,
    timedOut,
    durationMs: Date.now() - startTime,
    stdout: redactText(stdout),
    stderr: redactText(stderr),
    truncated: false,
    manifestHash,
  };
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.message.includes('abort'));
}
