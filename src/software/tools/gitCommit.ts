// Gate 47: consume exactly one approved immutable delivery, with crash recovery states.
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { ToolHandlerInput, ToolHandlerResult } from '../../tools/types.js';
import type { Store } from '../../core/ports.js';
import { resolveWorkspace } from '../types.js';
import { withRepoLock } from '../../workspace/mutation.js';
import { runGit, runGitWithIndex } from '../git/runner.js';
import { currentBaseCommit, currentManifest, sameManifest, normalizeCommitMessage, hashCommitMessage } from '../git/delivery.js';

export async function gitCommitHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const store = input.store as Store | undefined;
  const ctx = input.context;
  const approvalId = typeof input.args.approval_id === 'string' ? input.args.approval_id : '';
  if (!store || !ctx?.projectId || !ctx.agentId || !ctx.taskId) return { success: false, error: 'project, agent, task, and store are required' };
  if (!approvalId) return { success: false, error: 'approval_id is required' };
  const workspace = await resolveWorkspace(input, store);
  if (!workspace) return { success: false, error: 'workspace not configured for this project' };
  let tempIndexPath: string | null = null;
  try {
    return await withRepoLock(input.db ?? (await import('../../db/pool.js')).getPool(), workspace.workspaceRoot, async () => {
      const approval = await store.getApproval(input.ownerId, approvalId);
      const delivery = await store.getPreparedDeliveryByApproval(input.ownerId, approvalId);
      if (!approval || !delivery || approval.status !== 'approved') return { success: false, error: 'approved linked delivery is required' };
      if (delivery.status === 'committing') {
        const recovered = await recoverCommittedDelivery(store, input.ownerId, delivery, workspace.workspaceRoot);
        if (recovered) return { success: true, data: { deliveryId: recovered.id, approvalId, commitSha: recovered.commitSha, manifest: recovered.manifest, status: recovered.status, recovered: true } };
        return { success: false, error: 'commit_recovery_required' };
      }
      if (delivery.status !== 'approved') return { success: false, error: 'approved linked delivery is required' };
      if (delivery.projectId !== ctx.projectId || delivery.taskId !== ctx.taskId || delivery.agentId !== ctx.agentId) return { success: false, error: 'delivery identity mismatch' };
      const base = await currentBaseCommit(workspace.workspaceRoot);
      const manifest = await currentManifest(workspace.workspaceRoot);
      if (base !== delivery.baseCommit || 'error' in manifest || !sameManifest(delivery.manifest, manifest.manifest)) return { success: false, error: 'delivery_revalidation_failed' };
      // REVALIDATE T: exact prepared Git tree SHA must match.
      // 1. Create fresh temporary index.
      // 2. Seed from exact prepared base B.
      // 3. Apply the current delivery manifest.
      // 4. Execute git write-tree to obtain T_current.
      // 5. Require T_current === delivery.preparedTreeSha.
      tempIndexPath = join(tmpdir(), `chef-validate-index-${randomBytes(16).toString('hex')}`);
      const vseed = await runGitWithIndex('read-tree', [delivery.baseCommit], workspace.workspaceRoot, tempIndexPath);
      if (!vseed.ok) return { success: false, error: `validate_tree_seed_failed:${vseed.outcome}` };
      // Apply manifest changes: add non-deleted paths, remove deleted paths.
      const addPaths = delivery.manifest.filter((e) => e.kind !== 'D').map((e) => e.path);
      if (addPaths.length > 0) {
        const vstage = await runGitWithIndex('add', ['-A', '--', ...addPaths], workspace.workspaceRoot, tempIndexPath);
        if (!vstage.ok) return { success: false, error: `validate_tree_stage_failed:${vstage.outcome}` };
      }
      const delPaths = delivery.manifest.filter((e) => e.kind === 'D').map((e) => e.path);
      if (delPaths.length > 0) {
        const vrm = await runGitWithIndex('rm', ['-r', '--cached', ...delPaths], workspace.workspaceRoot, tempIndexPath);
        if (!vrm.ok) return { success: false, error: `validate_tree_rm_failed:${vrm.outcome}` };
      }
      // Compute T_current.
      const vtree = await runGitWithIndex('write-tree', [], workspace.workspaceRoot, tempIndexPath);
      if (!vtree.ok) return { success: false, error: `validate_tree_failed:${vtree.outcome}` };
      const T_current = vtree.stdout.trim();
      if (!/^[0-9a-f]{40,64}$/.test(T_current)) return { success: false, error: `invalid_tree_sha:${T_current}` };
      // Compare with stored preparedTreeSha.
      if (T_current !== delivery.preparedTreeSha) return { success: false, error: 'delivery_tree_sha_mismatch' };
      // Clean up temp index.
      try { unlinkSync(tempIndexPath); } catch { /* best effort */ }
      tempIndexPath = null;
      // REVALIDATE M: normalized commit-message hash must match.
      const M_current = hashCommitMessage(normalizeCommitMessage(delivery.message));
      if (M_current !== delivery.messageHash) return { success: false, error: 'delivery_message_hash_mismatch' };
      if (delivery.verificationSessionId) {
        const evidence = await store.listTaskVerifications(input.ownerId, delivery.taskId);
        if (!evidence.some((item) => item.outcome === 'passed' && item.verificationSessionId === delivery.verificationSessionId && item.workspaceFingerprint === delivery.verificationWorkspaceFingerprint)) return { success: false, error: 'delivery_verification_binding_failed' };
      }
      const claimed = await store.transitionPreparedDelivery(input.ownerId, delivery.id, 'approved', 'committing');
      if (!claimed) return { success: false, error: 'delivery_state_conflict' };
      // Proceed with the real commit (unchanged from original).
      tempIndexPath = join(tmpdir(), `chef-delivery-index-${randomBytes(16).toString('hex')}`);
      const seed = await runGitWithIndex('read-tree', [delivery.baseCommit], workspace.workspaceRoot, tempIndexPath);
      if (!seed.ok) return fail(store, input.ownerId, delivery.id, `temp_index_seed_failed:${seed.outcome}`);
      const stage = await runGitWithIndex('add', ['-A', '--', ...delivery.manifest.map((entry) => entry.path)], workspace.workspaceRoot, tempIndexPath);
      if (!stage.ok) return fail(store, input.ownerId, delivery.id, `temp_index_stage_failed:${stage.outcome}`);
      const committed = await runGitWithIndex('commit', ['-m', delivery.message], workspace.workspaceRoot, tempIndexPath);
      if (!committed.ok) return fail(store, input.ownerId, delivery.id, `commit_failed:${committed.outcome}`);
      const sha = (await runGitWithIndex('rev-parse', ['HEAD'], workspace.workspaceRoot, tempIndexPath)).stdout.trim();
      const complete = await store.transitionPreparedDelivery(input.ownerId, delivery.id, 'committing', 'committed', { commitSha: /^[0-9a-f]{40,64}$/.test(sha) ? sha : null });
      if (!complete) return { success: false, error: 'commit_recovery_required' };
      return { success: true, data: { deliveryId: complete.id, approvalId, commitSha: complete.commitSha, manifest: complete.manifest, status: complete.status } };
    });
  } catch (error) { return { success: false, error: `commit failed: ${String(error)}` }; }
  finally { if (tempIndexPath && existsSync(tempIndexPath)) try { unlinkSync(tempIndexPath); } catch { /* best effort */ } }
}

async function fail(store: Store, ownerId: string, deliveryId: string, reason: string): Promise<ToolHandlerResult> {
  await store.transitionPreparedDelivery(ownerId, deliveryId, 'committing', 'failed', { failureReason: reason });
  return { success: false, error: reason };
}

// A process can die after Git advances HEAD but before the final CAS. Under the
// repository lock, recognize only the exact base-parent/message tuple and finish it.
async function recoverCommittedDelivery(store: Store, ownerId: string, delivery: import('../../core/types.js').PreparedDeliveryRecord, cwd: string) {
  const parent = await runGit({ subcommand: 'rev-parse', args: ['HEAD^'], cwd });
  const message = await runGit({ subcommand: 'show', args: ['-s', '--format=%B', 'HEAD'], cwd });
  const sha = await runGit({ subcommand: 'rev-parse', args: ['HEAD'], cwd });
  const changed = await runGit({ subcommand: 'diff', args: ['--name-status', '--no-renames', delivery.baseCommit, 'HEAD'], cwd });
  const expected = delivery.manifest.map((entry) => `${entry.kind}\t${entry.path}`).sort().join('\n');
  if (!parent.ok || !message.ok || !sha.ok || !changed.ok || parent.stdout.trim() !== delivery.baseCommit || message.stdout.trim() !== delivery.message || changed.stdout.trim() !== expected || !/^[0-9a-f]{40,64}$/.test(sha.stdout.trim())) return null;
  return store.transitionPreparedDelivery(ownerId, delivery.id, 'committing', 'committed', { commitSha: sha.stdout.trim() });
}
