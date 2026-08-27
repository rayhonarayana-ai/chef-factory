// CHEF FACTORY — Gate 36 V2 — git_commit tool.
// Human-approved controlled commit using temp index.
// Revalidates all state, uses alternate GIT_INDEX_FILE, commits from temp index.
// PUSH_NOT_IMPLEMENTED = YES

import type { ToolHandlerInput, ToolHandlerResult } from '../../tools/types.js';
import { getPool } from '../../db/pool.js';
import { withRepoLock } from '../../workspace/mutation.js';
import { resolveWorkspace } from '../types.js';
import { runGit, runGitWithIndex } from '../git/runner.js';
import { contentHash } from '../../workspace/mutation.js';
import { scanForSecrets } from '../dlpscan.js';
import type { Store } from '../../core/ports.js';
import { isPathContained } from '../../workspace/resolver.js';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function gitCommitHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;

  if (!input.store) return { success: false, error: 'store not available' };
  if (!input.context?.projectId) return { success: false, error: 'project context required' };
  if (!input.context?.agentId) return { success: false, error: 'agent identity required' };
  if (!input.context?.taskId) return { success: false, error: 'task identity required' };

  const workspace = await resolveWorkspace(input, input.store as { getPassport: Store['getPassport'] });
  if (!workspace) return { success: false, error: 'workspace not configured for this project' };

  const approvalId = typeof args.approval_id === 'string' ? args.approval_id : '';
  if (!approvalId) return { success: false, error: 'approval_id is required' };

  const ctx = input.context!;
  const store = input.store as Store;
  const pool = getPool();

  let tempIndexPath: string | null = null;

  try {
    const result = await withRepoLock(pool, workspace.workspaceRoot, async (db) => {
      // Step 1: Resolve and verify approval via Store
      const approval = await store.getApproval(ownerId, approvalId);
      if (!approval) {
        return { success: false, error: 'approval not found' };
      }

      if (approval.status !== 'pending') {
        return { success: false, error: `approval status is ${approval.status} — must be pending` };
      }
      if (approval.action !== 'git.commit') {
        return { success: false, error: `approval action is ${approval.action} — expected git.commit` };
      }
      if (approval.projectId !== ctx.projectId) {
        return { success: false, error: 'approval project mismatch' };
      }

      const approvalMetadata = approval.description || '';
      const commitHash = approval.id as string;
      const message = approvalMetadata.replace(/^Commit: /, '') || 'commit';

      // Step 2: Derive candidates from git status at commit time
      const statusResult = await runGit({ subcommand: 'status', args: ['--porcelain'], cwd: workspace.workspaceRoot });
      if (!statusResult.ok) {
        return { success: false, error: `git status failed: ${statusResult.stderr}` };
      }
      const statusLines = statusResult.stdout.split('\n').filter(l => l.length >= 3);
      const candidates = statusLines
        .map(l => l.substring(3).trim())
        .filter(p => p && !p.includes('..'));

      if (candidates.length === 0) {
        return { success: false, error: 'no changes to commit' };
      }

      // Step 3: Revalidate all state-bound checks
      for (const relPath of candidates) {
        const { resolve: pathResolve } = await import('node:path');
        const canonical = pathResolve(workspace.workspaceRoot, relPath);
        const containment = isPathContained(canonical, workspace.workspaceRoot);
        if (!containment.ok) {
          return { success: false, error: `path validation failed for ${relPath}: ${containment.error}` };
        }
        const canonicalRelative = containment.relative!;

        // Revalidate latest-mutation attribution
        const latestMutation = await db.query(
          `SELECT ae.id, ae.actor_id, ae.task_id, ae.metadata
           FROM audit_events ae
           JOIN projects p ON ae.project_id = p.id
           WHERE ae.resource_type = 'file'
             AND ae.resource_id = $1
             AND p.owner_id = $2
             AND ae.project_id = $3
           ORDER BY ae.id DESC
           LIMIT 1`,
          [canonicalRelative, ownerId, ctx.projectId],
        );

        if (!latestMutation.rows.length) {
          return { success: false, error: `no attribution record for ${relPath}` };
        }

        const latestEvent = latestMutation.rows[0] as { actor_id: string; task_id: string; metadata: unknown };
        const meta = typeof latestEvent.metadata === 'string'
          ? JSON.parse(latestEvent.metadata) as { resultingHash?: string }
          : latestEvent.metadata as { resultingHash?: string };

        // Verify hash binding
        if (meta.resultingHash) {
          try {
            const fileContent = readFileSync(pathResolve(workspace.workspaceRoot, relPath), 'utf-8');
            const currentHash = contentHash(fileContent);
            if (currentHash !== meta.resultingHash) {
              return {
                success: false,
                error: `hash mismatch for ${relPath}: current ${currentHash} != attributed ${meta.resultingHash}`,
              };
            }
          } catch {
            return { success: false, error: `cannot read file ${relPath} for hash verification` };
          }
        }

        // Verify task attribution
        if (latestEvent.actor_id !== ctx.agentId) {
          return {
            success: false,
            error: `attribution mismatch for ${relPath}: attributed to ${latestEvent.actor_id}, current agent is ${ctx.agentId}`,
          };
        }
        if (latestEvent.task_id !== ctx.taskId) {
          return {
            success: false,
            error: `task mismatch for ${relPath}: attributed to task ${latestEvent.task_id}, current task is ${ctx.taskId}`,
          };
        }

        // DLP re-scan
        try {
          const fileContent = readFileSync(pathResolve(workspace.workspaceRoot, relPath), 'utf-8');
          const dlpResult = scanForSecrets(fileContent);
          if (!dlpResult.clean) {
            return {
              success: false,
              error: `DLP violation in ${relPath}: ${dlpResult.reason}`,
            };
          }
        } catch {
          return { success: false, error: `cannot read file ${relPath} for DLP scan` };
        }
      }

      // Step 4: Create temp index file
      tempIndexPath = join(tmpdir(), `chef-temp-index-${Date.now()}-${Math.random().toString(36).slice(2)}`);

      // Step 5: Stage each candidate using temp index
      for (const relPath of candidates) {
        const stageResult = await runGitWithIndex(
          'add',
          [relPath],
          workspace.workspaceRoot,
          tempIndexPath,
        );
        if (!stageResult.ok) {
          return {
            success: false,
            error: `git add failed for ${relPath}: ${stageResult.stderr}`,
          };
        }
      }

      // Step 6: Commit from temp index
      const commitResult = await runGitWithIndex(
        'commit',
        ['-m', message],
        workspace.workspaceRoot,
        tempIndexPath,
      );
      if (!commitResult.ok) {
        return {
          success: false,
          error: `git commit failed: ${commitResult.stderr}`,
        };
      }

      // Step 7: Extract commit SHA from output
      const commitShaMatch = commitResult.stdout.match(/\[[\w]+ ([a-f0-9]+)\]/);
      const commitSha = commitShaMatch?.[1] || 'unknown';

      // Step 8: Record commit attribution
      try {
        await db.query(
          `INSERT INTO audit_events
           (actor_type, actor_id, action, project_id, environment_id,
            resource_type, resource_id, task_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            'agent',
            ctx.agentId,
            'git.commit.completed',
            ctx.projectId,
            ctx.environment,
            'commit',
            commitSha,
            ctx.taskId,
            JSON.stringify({
              approvalId,
              message,
              candidates,
              commitHash,
              commitSha,
            }),
          ],
        );
      } catch {
        return { success: false, error: 'attribution_persistence_failed' };
      }

      // Step 9: Update approval status
      try {
        await store.patchApproval(ownerId, approvalId, { status: 'approved', decision: 'approved' });
      } catch {
        // Non-critical
      }

      return {
        success: true,
        data: {
          commitSha,
          commitHash,
          approvalId,
          message,
          candidates,
          status: 'committed',
        },
      };
    });

    return result;
  } catch (e) {
    return { success: false, error: `commit failed: ${String(e)}` };
  } finally {
    if (tempIndexPath && existsSync(tempIndexPath)) {
      try {
        unlinkSync(tempIndexPath);
      } catch {
        // Non-critical cleanup failure
      }
    }
  }
}
