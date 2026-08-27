// CHEF FACTORY — Gate 35B — Safe verification execution types.
// Structured verification operations: test, typecheck, build.
// Agent selects only the operation enum. All execution details resolved server-side.

/** Allowed verification operations. Agent can only select from this enum. */
export type VerificationOperation = 'test' | 'typecheck' | 'build';

/** Exhaustive outcome types for verification results. */
export type VerificationOutcome =
  | 'passed'
  | 'failed'
  | 'timeout'
  | 'output_limit_exceeded'
  | 'execution_denied'
  | 'tool_not_available'
  | 'dependency_missing'
  | 'invalid_operation'
  | 'workspace_changed'
  | 'internal_error';

/** Structured result returned to agent after verification. */
export interface VerificationResult {
  ok: boolean;
  outcome: VerificationOutcome;
  operation: VerificationOperation;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  manifestHash: string | null;
}

/** Trusted profile for a verification operation. Resolved server-side only. */
export interface VerificationProfile {
  operation: VerificationOperation;
  description: string;
  executable: string;        // Node.js executable (process.execPath)
  script: string;            // Absolute path to verification tool entrypoint
  args: readonly string[];   // Fixed args (no user-controlled flags)
  timeoutMs: number;
  cwdSource: 'workspace_root';
}

/** Configuration constants for verification execution. */
export const VERIFICATION_CONSTANTS = {
  DEFAULT_TIMEOUT_MS: 30_000,
  MAX_TIMEOUT_MS: 120_000,
  MAX_STDOUT_BYTES: 100 * 1024,   // 100KB
  MAX_STDERR_BYTES: 100 * 1024,   // 100KB
  MAX_TOTAL_OUTPUT_BYTES: 200 * 1024, // 200KB
  MAX_CONCURRENT_PER_AGENT: 2,
  MAX_CONCURRENT_PER_PROJECT: 3,
  MAX_ATTEMPTS_PER_TASK: 10,
} as const;
