// CHEF FACTORY — Gate 35B — run_verification tool handler.
// Structured verification: agent selects operation enum only.
// Trusted profile resolved server-side. No shell, no npm, no arbitrary commands.
// Passes through ToolBroker → SecurityGuardian → verification policy → runner.

import type { ToolHandlerInput, ToolHandlerResult } from '../../tools/types.js';
import type { VerificationOperation } from '../verification/types.js';
import { buildVerificationProfiles, validateProfile } from '../verification/registry.js';
import { runVerification } from '../verification/runner.js';
import { resolveWorkspace } from '../types.js';

const VALID_OPERATIONS = new Set<VerificationOperation>(['test', 'typecheck', 'build']);

export async function runVerificationHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args, store, context } = input;

  // 1. Validate operation enum
  const operation = args['operation'] as string | undefined;
  if (!operation || !VALID_OPERATIONS.has(operation as VerificationOperation)) {
    return {
      success: false,
      error: `invalid_operation: operation must be one of: test, typecheck, build. Received: ${String(operation)}`,
    };
  }

  // 2. Resolve workspace from trusted context (NOT from agent args)
  if (!store) {
    return { success: false, error: 'internal_error: store not available' };
  }
  const workspace = await resolveWorkspace(input, store as any);
  if (!workspace) {
    return {
      success: false,
      error: 'workspace_not_found: could not resolve workspace root from project passport',
    };
  }

  // 3. Build trusted verification profiles for this workspace
  const profiles = buildVerificationProfiles(workspace.workspaceRoot);
  const profile = profiles.get(operation as VerificationOperation);
  if (!profile) {
    return { success: false, error: `invalid_operation: unknown operation ${operation}` };
  }

  // 4. Validate profile executables exist
  const validation = validateProfile(profile);
  if (!validation.ok) {
    return {
      success: false,
      error: `dependency_missing: ${validation.error}`,
    };
  }

  // 5. Validate optional filter argument
  const filter = args['filter'] as string | undefined;
  if (filter !== undefined) {
    if (typeof filter !== 'string' || filter.length === 0) {
      return { success: false, error: 'invalid_argument: filter must be a non-empty string' };
    }
    if (filter.length > 200) {
      return { success: false, error: 'invalid_argument: filter too long (max 200 chars)' };
    }
  }

  // 6. Run verification through restricted runner
  try {
    const result = await runVerification({
      profile,
      workspaceRoot: workspace.workspaceRoot,
      filter,
    });

    return {
      success: result.ok,
      data: {
        operation: result.operation,
        outcome: result.outcome,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
        manifestHash: result.manifestHash,
        source: 'verification',
        trust: 'untrusted',
      },
      error: result.ok ? undefined : `verification_${result.outcome}`,
    };
  } catch (e) {
    return {
      success: false,
      error: `internal_error: verification runner failed: ${String(e)}`,
    };
  }
}
