// CHEF FACTORY — Gate 36 V1 — Secure read-only Git types.
// Structured Git operations: status and diff only.
// Agent selects operation mode only. All execution details resolved server-side.

/** Allowed Git diff modes. Agent selects only from this enum. */
export type GitDiffMode = 'working' | 'cached' | 'stat';

/** Configuration constants for Git execution. */
export const GIT_CONSTANTS = {
  /** Maximum stdout bytes from Git operations. */
  MAX_STDOUT_BYTES: 512 * 1024, // 512KB
  /** Maximum stderr bytes from Git operations. */
  MAX_STDERR_BYTES: 64 * 1024, // 64KB
  /** Default timeout for Git operations (30 seconds). */
  DEFAULT_TIMEOUT_MS: 30_000,
  /** Maximum timeout for Git operations (60 seconds). */
  MAX_TIMEOUT_MS: 60_000,
} as const;

/** Structured result returned from Git operations. */
export interface GitResult {
  ok: boolean;
  outcome: GitOutcome;
  operation: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  fileCount: number | null;
}

/** Exhaustive outcome types for Git results. */
export type GitOutcome =
  | 'ok'
  | 'not_repository'
  | 'invalid_repository'
  | 'denied'
  | 'git_failed'
  | 'output_limit_exceeded'
  | 'timeout'
  | 'internal_error';
