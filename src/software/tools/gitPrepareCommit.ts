// CHEF FACTORY — Gate 36 V2 — git_prepare_commit tool.
// Controlled staging with state-bound attribution. Creates approval for human review.
// Operates under repo-level lock with DB access for attribution queries.
// Staging is internal (NO agent-visible git_stage). No push.

import type { ToolHandlerInput, ToolHandlerResult } from '../../tools/types.js';
import type { Pool } from 'pg';
import { getPool } from '../../db/pool.js';
import { withRepoLock } from '../../workspace/mutation.js';
import { resolveWorkspace } from '../types.js';
import { runGit } from '../git/runner.js';
import { contentHash } from '../../workspace/mutation.js';
import { scanForSecrets } from '../dlpscan.js';
import { randomBytes, createHash } from 'node:crypto';
import type { Store } from '../../core/ports.js';
import { isProtectedPath } from '../../workspace/protected.js';
import { isPathContained } from '../../workspace/resolver.js';
import { readFileSync } from 'node:fs';

export async function gitPrepareCommitHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;

  if (!input.store) return { success: false, error: 'store not available' };
  if (!input.context?.projectId) return { success: false, error: 'project context required' };
  if (!input.context?.agentId) return { success: false, error: 'agent identity required' };
  if (!input.context?.taskId) return { success: false, error: 'task identity required' };

  const workspace = await resolveWorkspace(input, input.store as { getPassport: Store['getPassport'] });
  if (!workspace) return { success: false, error: 'workspace not configured for this project' };

  const message = typeof args.message === 'string' ? args.message : '';
  if (!message) return { success: false, error: 'commit message is required' };
  if (message.length > 500) return { success: false, error: 'commit message too long (max 500 chars)' };
  if (message.length < 3) return { success: false, error: 'commit message too short (min 3 chars)' };

  const ctx = input.context!;
  const store = input.store as Store;
  const pool: Pool | import('../../tools/types.js').DbQuery = input.db ?? getPool();

  try {
    const result = await withRepoLock(pool, workspace.workspaceRoot, async (db) => {
      // Step 1: Verify task status is active
      const taskCheck = await db.query(
        `SELECT t.status
         FROM tasks t
         JOIN projects p ON t.project_id = p.id
         WHERE t.id = $1 AND p.owner_id = $2 AND t.project_id = $3`,
        [ctx.taskId, ownerId, ctx.projectId],
      );
      if (!taskCheck.rows.length) {
        return { success: false, error: 'task not found or not owned by this owner/project' };
      }
      const task = taskCheck.rows[0] as { status: string };
      if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed') {
        return { success: false, error: `task status ${task.status} is not active — cannot prepare commit` };
      }

      // Step 2: Scan working tree to find changed files
      const statusResult = await runGit({ subcommand: 'status', args: ['--porcelain'], cwd: workspace.workspaceRoot });
      if (!statusResult.ok) {
        return { success: false, error: `git status failed: ${statusResult.stderr}` };
      }

      const lines = statusResult.stdout.split('\n').filter(l => l.length >= 3);
      if (lines.length === 0) {
        return { success: false, error: 'no changes to commit' };
      }

      const candidatePaths: string[] = [];
      for (const line of lines) {
        const relativePath = line.substring(3).trim();
        if (relativePath && !relativePath.includes('..')) {
          candidatePaths.push(relativePath);
        }
      }

      if (candidatePaths.length === 0) {
        return { success: false, error: 'no valid candidate paths found' };
      }

      // Step 3: Attribution state-binding checks
      const fingerprints: string[] = [];
      const verificationEvidence: string[] = [];
      const lockEvidence: string[] = [];

      for (const relPath of candidatePaths) {
        // 3a: Validate path
        const { resolve: pathResolve } = await import('node:path');
        const canonical = pathResolve(workspace.workspaceRoot, relPath);
        const containment = isPathContained(canonical, workspace.workspaceRoot);
        if (!containment.ok) {
          return { success: false, error: `path validation failed for ${relPath}: ${containment.error}` };
        }
        const canonicalRelative = containment.relative!;

        if (isProtectedPath(relPath)) {
          return { success: false, error: `protected path in candidates: ${relPath}` };
        }

        // 3b: Latest-mutation attribution check
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
          return { success: false, error: `no attribution record for ${relPath} — cannot prepare commit` };
        }

        const latestEvent = latestMutation.rows[0] as { actor_id: string; task_id: string; metadata: unknown };
        const metadata = typeof latestEvent.metadata === 'string'
          ? JSON.parse(latestEvent.metadata) as { resultingHash?: string }
          : latestEvent.metadata as { resultingHash?: string };

        // Verify hash binding
        if (metadata.resultingHash) {
          try {
            const fileContent = readFileSync(pathResolve(workspace.workspaceRoot, relPath), 'utf-8');
            const currentHash = contentHash(fileContent);
            if (currentHash !== metadata.resultingHash) {
              return {
                success: false,
                error: `hash mismatch for ${relPath}: current ${currentHash} != attributed ${metadata.resultingHash}`,
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

        // Step 4: Compute fingerprint
        try {
          const fileContent = readFileSync(pathResolve(workspace.workspaceRoot, relPath), 'utf-8');
          const fingerprint = createHash('sha256').update(fileContent).digest('hex');
          fingerprints.push(`${relPath}:${fingerprint}`);
        } catch {
          return { success: false, error: `cannot read file ${relPath} for fingerprint` };
        }

        lockEvidence.push(`pg_advisory_lock:${workspace.workspaceRoot}:${relPath}`);
      }

      // Step 5: DLP scan
      for (const relPath of candidatePaths) {
        try {
          const { resolve: pathResolve } = await import('node:path');
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

      // Step 6: Record attribution event
      const commitHash = randomBytes(16).toString('hex');
      const overallFingerprint = createHash('sha256').update(fingerprints.join('|')).digest('hex');

      try {
        await db.query(
          `INSERT INTO audit_events
           (actor_type, actor_id, action, project_id, environment_id,
            resource_type, resource_id, task_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            'agent',
            ctx.agentId,
            'git.prepare_commit',
            ctx.projectId,
            ctx.environment,
            'commit',
            commitHash,
            ctx.taskId,
            JSON.stringify({
              message,
              candidates: candidatePaths,
              overallFingerprint,
              verificationEvidence,
              lockEvidence,
            }),
          ],
        );
      } catch (insertErr) {
        return { success: false, error: 'attribution_persistence_failed' };
      }

      // Step 7: Create approval via Store (schema-correct)
      let approvalId: string;
      try {
        const approval = await store.createApproval(ownerId, {
          projectId: ctx.projectId,
          taskId: ctx.taskId,
          agentId: ctx.agentId,
          action: 'git.commit',
          description: `Commit: ${message}`,
          riskLevel: 'critical',
          requestedBy: ctx.agentId,
        });
        approvalId = approval.id;
      } catch {
        return { success: false, error: 'approval_creation_failed' };
      }

      return {
        success: true,
        data: {
          approvalId,
          commitHash,
          candidates: candidatePaths,
          overallFingerprint,
          message,
          status: 'awaiting_approval',
        },
      };
    });

    return result;
  } catch (e) {
    return { success: false, error: `prepare_commit failed: ${String(e)}` };
  }
}
