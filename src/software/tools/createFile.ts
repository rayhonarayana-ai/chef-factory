// CHEF FACTORY — Gate 35A → Gate 36 V2 — create_file tool.
// Controlled file creation. Exclusive create (O_CREAT | O_EXCL).
// Advisory lock + workspace validation + protected path + DLP.
// Gate 36 V2: Attribution recorded inside lock critical section.
// CREATE_FILE_EXCLUSIVE = YES
// EXISTING_TARGET_OVERWRITTEN = NO

import type { ToolHandlerInput, ToolHandlerResult } from '../../tools/types.js';
import type { Pool } from 'pg';
import { getPool } from '../../db/pool.js';
import { stat } from 'node:fs/promises';
import { resolveWorkspace, validateRelativePath } from '../types.js';
// withRepoAndFileLockAndDb composes the existing withFileLockAndDb under the
// canonical repo -> file ordering required by Gate46 final acceptance.
import { withRepoAndFileLockAndDb, exclusiveCreate } from '../../workspace/mutation.js';
import { scanForSecrets } from '../dlpscan.js';
import { MAX_FILE_WRITE_SIZE } from '../../workspace/types.js';
import type { Store } from '../../core/ports.js';
import { contentHash } from '../../workspace/mutation.js';

export async function createFileHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;

  if (!input.store) return { success: false, error: 'store not available' };
  if (!input.context?.projectId) return { success: false, error: 'project context required' };

  const workspace = await resolveWorkspace(input, input.store as { getPassport: Store['getPassport'] });
  if (!workspace) return { success: false, error: 'workspace not configured for this project' };

  const targetPath = typeof args.path === 'string' ? args.path : '';
  const content = typeof args.content === 'string' ? args.content : '';

  if (!targetPath) return { success: false, error: 'path is required' };
  if (content.length > MAX_FILE_WRITE_SIZE) {
    return { success: false, error: `content too large: ${content.length} bytes (max ${MAX_FILE_WRITE_SIZE})` };
  }

  // Gate 36 V2: use injected db (unit-test seam) or the real pool.
  // The injected db supplies the audit_events INSERT so fail-closed behavior
  // is deterministically testable without real DB FK rows.
  const lockDb: Pool | import('../../tools/types.js').DbQuery = input.db ?? getPool();
  const ctx = input.context!;

  try {
    const result = await withRepoAndFileLockAndDb(lockDb, workspace.workspaceRoot, targetPath, async (db) => {
      // Step 1: Validate path against workspace and protected policy
      const pathCheck = validateRelativePath(targetPath, workspace);
      if (!pathCheck.ok) {
        return { success: false, error: pathCheck.error };
      }

      // Step 2: Check file does NOT already exist
      try {
        await stat(pathCheck.canonical!);
        return { success: false, error: 'file already exists — use apply_patch to modify' };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          return { success: false, error: `stat failed: ${String(e)}` };
        }
        // ENOENT = file doesn't exist — this is the expected case for creation
      }

      // Step 3: DLP scan
      const dlpResult = scanForSecrets(content);
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

      // Step 4: Exclusive create (atomic no-overwrite)
      await exclusiveCreate(pathCheck.canonical!, content);

      // Step 5: Verify
      const info = await stat(pathCheck.canonical!);

      // Step 6: Compute resultingHash
      const resultingHash = contentHash(content);

      // Step 7: Record attribution (Gate 36 V2) — same DB connection, same lock boundary
      // FAIL CLOSED: if attribution persistence fails after filesystem mutation,
      // the handler MUST return failure. FILESYSTEM_MUTATION_SUCCESS +
      // ATTRIBUTION_PERSISTENCE_FAILURE MUST NOT return success.
      const canonicalRelative = pathCheck.relative!;
      try {
        await db.query(
          `INSERT INTO audit_events
           (actor_type, actor_id, action, project_id, environment_id,
            resource_type, resource_id, task_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            'agent',
            ctx.agentId,
            'file.created',
            ctx.projectId,
            ctx.environment,
            'file',
            canonicalRelative,
            ctx.taskId,
            JSON.stringify({ operation: 'create_file', resultingHash }),
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
            resultingHash,
          },
        };
      }

      return {
        success: true,
        data: {
          outcome: 'created',
          path: targetPath,
          size: info.size,
          resultingHash,
        },
      };
    });

    return result;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      return { success: false, error: 'file already exists — concurrent creation detected' };
    }
    return { success: false, error: `create failed: ${String(e)}` };
  }
}
