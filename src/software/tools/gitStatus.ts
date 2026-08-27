// CHEF FACTORY — Gate 36 V1 — git_status tool handler.
// Structured read-only Git status. Agent selects operation only.
// All execution details resolved server-side. No shell, no arbitrary Git args.

import type { ToolHandlerInput, ToolHandlerResult } from '../../tools/types.js';
import { runGit } from '../git/runner.js';
import { resolveWorkspace } from '../types.js';

export async function gitStatusHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { store } = input;

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

  try {
    const result = await runGit({
      subcommand: 'status',
      args: ['--porcelain=v1', '--untracked-files=normal'],
      cwd: workspace.workspaceRoot,
    });

    return {
      success: result.ok,
      data: {
        operation: 'git_status',
        outcome: result.outcome,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
        fileCount: result.fileCount,
        trust: 'untrusted',
      },
      error: result.ok ? undefined : `git_status_${result.outcome}`,
    };
  } catch (e) {
    return {
      success: false,
      error: `internal_error: git_status runner failed: ${String(e)}`,
    };
  }
}
