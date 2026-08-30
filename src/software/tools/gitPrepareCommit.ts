import { createHash, randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolHandlerInput, ToolHandlerResult } from '../../tools/types.js';
import type { Store } from '../../core/ports.js';
import { resolveWorkspace } from '../types.js';
import { withRepoLock } from '../../workspace/mutation.js';
import { runGitWithIndex } from '../git/runner.js';
import { currentBaseCommit, currentManifest, sameManifest, manifestHash, normalizeCommitMessage, hashCommitMessage } from '../git/delivery.js';

export async function gitPrepareCommitHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args, context: ctx } = input;
  const store = input.store as Store | undefined;
  if (!store || !ctx?.projectId || !ctx.agentId || !ctx.taskId) return { success: false, error: 'project, agent, task, and store are required' };
  const { projectId, agentId, taskId } = ctx;
  const message = typeof args.message === 'string' ? args.message.trim() : '';
  if (!message) return { success: false, error: 'commit message is required' };
  if (message.length < 3 || message.length > 500) return { success: false, error: 'commit message must be 3-500 chars' };
  const workspace = await resolveWorkspace(input, store);
  if (!workspace) return { success: false, error: 'workspace not configured for this project' };
  const task = await store.getTask(ownerId, taskId);
  if (!task || task.projectId !== projectId || task.agentId !== agentId || ['completed', 'cancelled', 'failed'].includes(task.status)) return { success: false, error: 'task is not an active assigned project task' };
  try {
    return await withRepoLock(input.db ?? (await import('../../db/pool.js')).getPool(), workspace.workspaceRoot, async () => {
      const baseCommit = await currentBaseCommit(workspace.workspaceRoot);
      if (!baseCommit) return { success: false, error: 'cannot resolve exact HEAD base' };
      const snapshot = await currentManifest(workspace.workspaceRoot);
      if ('error' in snapshot) return { success: false, error: snapshot.error };
      const evidence = task.verificationRequired ? (await store.listTaskVerifications(ownerId, task.id)).filter((item) => item.outcome === 'passed').at(-1) : undefined;
      if (task.verificationRequired && (!evidence?.verificationSessionId || !evidence.workspaceFingerprint)) return { success: false, error: 'verified Gate46 evidence is required' };
      // Canonical message normalization (single M binding).
      const normalizedMessage = normalizeCommitMessage(message);
      const messageHash = hashCommitMessage(normalizedMessage);
      // Build the exact delivery Git tree SHA (T binding).
      // 1. Create a temporary index directory.
      const tempIndexPath = join(tmpdir(), `chef-prepare-index-${randomBytes(16).toString('hex')}`);
      // 2. Seed the index from the exact base commit.
      const seed = await runGitWithIndex('read-tree', [baseCommit], workspace.workspaceRoot, tempIndexPath);
      if (!seed.ok) return { success: false, error: `temp_index_seed_failed:${seed.outcome}` };
      // 3. Apply the prepared delivery changes to the index.
      //    - For 'A' (added) and 'M' (modified) entries: stage the files.
      //    - For 'D' (deleted) entries: remove from index.
      const manifestEntries = snapshot.manifest;
      const addPaths = manifestEntries.filter((e) => e.kind !== 'D').map((e) => e.path);
      if (addPaths.length > 0) {
        const stage = await runGitWithIndex('add', ['-A', '--', ...addPaths], workspace.workspaceRoot, tempIndexPath);
        if (!stage.ok) return { success: false, error: `temp_index_stage_failed:${stage.outcome}` };
      }
      const delPaths = manifestEntries.filter((e) => e.kind === 'D').map((e) => e.path);
      if (delPaths.length > 0) {
        const rm = await runGitWithIndex('rm', ['-r', '--cached', ...delPaths], workspace.workspaceRoot, tempIndexPath);
        if (!rm.ok) return { success: false, error: `temp_index_rm_failed:${rm.outcome}` };
      }
      // 4. Compute the resulting Git tree SHA using the safe Git primitive.
      const tree = await runGitWithIndex('write-tree', [], workspace.workspaceRoot, tempIndexPath);
      if (!tree.ok) return { success: false, error: `temp_tree_compute_failed:${tree.outcome}` };
      const treeSha = tree.stdout.trim();
      if (!/^[0-9a-f]{40,64}$/.test(treeSha)) return { success: false, error: `invalid_tree_sha:${treeSha}` };
      // 5. Persist that exact SHA as preparedTreeSha = T.
      //    Do NOT create a commit. Do NOT touch the real Git index.
      const delivery = await store.createPreparedDelivery(ownerId, { projectId, taskId, agentId, message: normalizedMessage, baseCommit, preparedTreeSha: treeSha, manifest: snapshot.manifest, manifestFingerprint: manifestHash(snapshot.manifest), workspaceFingerprint: evidence?.workspaceFingerprint ?? null, messageHash, verificationSessionId: evidence?.verificationSessionId ?? null, verificationWorkspaceFingerprint: evidence?.workspaceFingerprint ?? null });
      const approval = await store.createApproval(ownerId, { projectId, taskId, agentId, action: 'git.commit', description: `Commit: ${message}`, riskLevel: 'critical', requestedBy: agentId, metadata: { preparedDeliveryId: delivery.id, manifestFingerprint: delivery.manifestFingerprint } });
      const linked = await store.linkPreparedDeliveryApproval(ownerId, delivery.id, approval.id);
      if (!linked) return { success: false, error: 'delivery_approval_link_failed' };
      // BEST-EFFORT cleanup of temp index.
      try { unlinkSync(tempIndexPath); } catch { /* best effort */ }
      return { success: true, data: { deliveryId: linked.id, approvalId: approval.id, baseCommit, manifest: linked.manifest, manifestFingerprint: linked.manifestFingerprint, status: linked.status, preparedTreeSha: treeSha } };
    });
  } catch (error) { return { success: false, error: `prepare_commit failed: ${String(error)}` }; }
}
