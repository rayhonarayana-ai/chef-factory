// CHEF FACTORY — Gate 35A — create_file tool.
// Controlled file creation. Exclusive create (O_CREAT | O_EXCL).
// Advisory lock + workspace validation + protected path + DLP.
// CREATE_FILE_EXCLUSIVE = YES
// EXISTING_TARGET_OVERWRITTEN = NO

import type { ToolHandlerInput, ToolHandlerResult } from '../../tools/types.js';
import { getPool } from '../../db/pool.js';
import { stat } from 'node:fs/promises';
import { resolveWorkspace, validateRelativePath } from '../types.js';
import { withFileLock, exclusiveCreate } from '../../workspace/mutation.js';
import { scanForSecrets } from '../dlpscan.js';
import { MAX_FILE_WRITE_SIZE } from '../../workspace/types.js';
import type { Store } from '../../core/ports.js';

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

  const pool = getPool();

  try {
    const result = await withFileLock(pool, workspace.workspaceRoot, targetPath, async () => {
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

      return {
        success: true,
        data: {
          outcome: 'created',
          path: targetPath,
          size: info.size,
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
