// CHEF FACTORY — Gate 36 V1 — git_diff tool handler.
// Structured read-only Git diff. Agent selects mode only (working, cached, stat).
// All execution details resolved server-side. No shell, no arbitrary Git args.

import type { ToolHandlerInput, ToolHandlerResult } from '../../tools/types.js';
import type { GitDiffMode } from '../git/types.js';
import { runGit } from '../git/runner.js';
import { resolveWorkspace } from '../types.js';

const VALID_MODES = new Set<GitDiffMode>(['working', 'cached', 'stat']);

export async function gitDiffHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { args, store } = input;

  const mode = (args['mode'] as string | undefined) ?? 'working';
  if (!VALID_MODES.has(mode as GitDiffMode)) {
    return {
      success: false,
      error: `invalid_mode: mode must be one of: working, cached, stat. Received: ${String(mode)}`,
    };
  }

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

  // Build fixed args for the selected mode
  const diffArgs = [
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
  ];

  if (mode === 'cached') {
    diffArgs.push('--cached');
  } else if (mode === 'stat') {
    diffArgs.push('--stat');
  }
  // mode 'working' = default diff (no extra flags)

  try {
    const result = await runGit({
      subcommand: 'diff',
      args: diffArgs,
      cwd: workspace.workspaceRoot,
    });

    return {
      success: result.ok,
      data: {
        operation: 'git_diff',
        mode,
        outcome: result.outcome,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
        trust: 'untrusted',
      },
      error: result.ok ? undefined : `git_diff_${result.outcome}`,
    };
  } catch (e) {
    return {
      success: false,
      error: `internal_error: git_diff runner failed: ${String(e)}`,
    };
  }
}
