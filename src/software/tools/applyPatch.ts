// CHEF FACTORY — Gate 35A → Gate 36 V2 — apply_patch tool.
// Primary mutation tool. CAS + advisory lock + pre-write DLP.
// Gate 36 V2: Attribution recorded inside lock critical section.
// Critical section: lock → resolve → check → read → hash → compare → DLP → write → verify → attrib → release.
// PATCH_APPLIED_BEFORE_DLP_IN_MEMORY = YES
// DLP_RUNS_BEFORE_FILESYSTEM_MUTATION = YES

import type { ToolHandlerInput, ToolHandlerResult } from '../../tools/types.js';
import type { Pool } from 'pg';
import { getPool } from '../../db/pool.js';
import { resolveWorkspace } from '../types.js';
import { isProtectedPath } from '../../workspace/protected.js';
import { isPathContained } from '../../workspace/resolver.js';
import { withFileLockAndDb, contentHash, safeReadFile, atomicReplace } from '../../workspace/mutation.js';
import { scanForSecrets } from '../dlpscan.js';
import { MAX_PATCH_SIZE } from '../../workspace/types.js';
import type { Store } from '../../core/ports.js';

export async function applyPatchHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;

  if (!input.store) return { success: false, error: 'store not available' };
  if (!input.context?.projectId) return { success: false, error: 'project context required' };

  const workspace = await resolveWorkspace(input, input.store as { getPassport: Store['getPassport'] });
  if (!workspace) return { success: false, error: 'workspace not configured for this project' };

  const targetPath = typeof args.path === 'string' ? args.path : '';
  const patch = typeof args.patch === 'string' ? args.patch : '';
  const expectedHash = typeof args.expectedContentHash === 'string' ? args.expectedContentHash : '';

  if (!targetPath) return { success: false, error: 'path is required' };
  if (!patch) return { success: false, error: 'patch is required' };
  if (!expectedHash) return { success: false, error: 'expectedContentHash is required' };
  if (patch.length > MAX_PATCH_SIZE) return { success: false, error: `patch too large: ${patch.length} bytes (max ${MAX_PATCH_SIZE})` };

  // Gate 36 V2: use injected db (unit-test seam) or the real pool.
  const lockDb: Pool | import('../../tools/types.js').DbQuery = input.db ?? getPool();
  const ctx = input.context!;
  const { resolve: pathResolve } = await import('node:path');

  try {
    const result = await withFileLockAndDb(lockDb, workspace.workspaceRoot, targetPath, async (db) => {
      // Step 2: Re-resolve workspace + target (defense-in-depth under lock)
      const candidate = pathResolve(workspace.workspaceRoot, targetPath);

      // Step 3: Containment check
      const containment = isPathContained(candidate, workspace.workspaceRoot);
      if (!containment.ok) {
        return { success: false, error: `path validation failed: ${containment.error}` };
      }

      // Step 4: Protected-path check
      if (isProtectedPath(targetPath)) {
        return { success: false, error: 'access denied: protected path' };
      }

      // Step 5: Read current content
      const currentContent = await safeReadFile(candidate);
      if (currentContent === null) {
        return { success: false, error: 'file not found — use create_file for new files' };
      }

      // Step 6: Compute current SHA-256
      const currentHash = contentHash(currentContent);

      // Step 7: Compare expectedContentHash
      if (currentHash !== expectedHash) {
        return {
          success: false,
          error: 'conflict',
          data: {
            outcome: 'conflict',
            currentHash,
            expectedHash,
            message: 'file modified since last read — re-read and regenerate patch',
          },
        };
      }

      // Step 8: Apply patch in memory to produce proposedContent
      // patch = complete new file content
      const proposedContent = patch;

      // Step 9: Pre-write DLP against COMPLETE proposedContent
      const dlpResult = scanForSecrets(proposedContent);
      if (!dlpResult.clean) {
        return {
          success: false,
          error: 'denied_secret',
          data: {
            outcome: 'denied',
            reason: dlpResult.reason,
            pattern: dlpResult.pattern,
          },
        };
      }

      // Step 11-13: Write temp → fsync → replace
      await atomicReplace(candidate, proposedContent);

      // Step 14: Verify
      const newContent = await safeReadFile(candidate);
      if (newContent === null) {
        return { success: false, error: 'write verification failed — file not readable after write' };
      }

      const newHash = contentHash(newContent);

      // Step 15: Record attribution (Gate 36 V2) — same DB connection, same lock boundary
      // FAIL CLOSED: if attribution persistence fails after filesystem mutation,
      // the handler MUST return failure. FILESYSTEM_MUTATION_SUCCESS +
      // ATTRIBUTION_PERSISTENCE_FAILURE MUST NOT return success.
      const canonicalRelative = containment.relative!;
      try {
        await db.query(
          `INSERT INTO audit_events
           (actor_type, actor_id, action, project_id, environment_id,
            resource_type, resource_id, task_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            'agent',
            ctx.agentId,
            'file.modified',
            ctx.projectId,
            ctx.environment,
            'file',
            canonicalRelative,
            ctx.taskId,
            JSON.stringify({ operation: 'apply_patch', previousHash: currentHash, resultingHash: newHash }),
          ],
        );
      } catch {
        // FAIL CLOSED: file was mutated but attribution could not be persisted.
        // Return failure. No synthetic attribution. File remains stage-ineligible
        // until a later authorized CHEF mutation establishes valid fresh attribution.
        // No automatic filesystem rollback (distributed transaction crash window is
        // acknowledged; destructive rollback is NOT performed).
        return {
          success: false,
          error: 'attribution_persistence_failed',
          data: {
            outcome: 'mutation_without_attribution',
            path: targetPath,
            resultingHash: newHash,
          },
        };
      }

      return {
        success: true,
        data: {
          outcome: 'patched',
          path: targetPath,
          previousHash: currentHash,
          newHash,
          size: newContent.length,
        },
      };
    });

    return result;
  } catch (e) {
    return { success: false, error: `patch failed: ${String(e)}` };
  }
}
