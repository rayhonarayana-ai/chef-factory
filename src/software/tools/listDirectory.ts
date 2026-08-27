// CHEF FACTORY — Gate 35A — list_directory tool.
// Bounded directory listing within approved workspace.
// Protected entries omitted. Result count bounded. Depth bounded.

import type { ToolHandlerInput, ToolHandlerResult } from '../../tools/types.js';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { resolveWorkspace } from '../types.js';
import { isProtectedPath, isProtectedDirectory } from '../../workspace/protected.js';
import { isPathContained } from '../../workspace/resolver.js';
import { MAX_LIST_ENTRIES, MAX_DIRECTORY_DEPTH } from '../../workspace/types.js';
import type { Store } from '../../core/ports.js';

export async function listDirectoryHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;

  if (!input.store) return { success: false, error: 'store not available' };
  if (!input.context?.projectId) return { success: false, error: 'project context required' };

  const workspace = await resolveWorkspace(input, input.store as { getPassport: Store['getPassport'] });
  if (!workspace) return { success: false, error: 'workspace not configured for this project' };

  const targetPath = typeof args.path === 'string' ? args.path : '.';

  if (isProtectedPath(targetPath)) {
    return { success: false, error: 'access denied: protected path' };
  }

  const { resolve } = await import('node:path');
  const candidate = resolve(workspace.workspaceRoot, targetPath);
  const containment = isPathContained(candidate, workspace.workspaceRoot);
  if (!containment.ok) {
    return { success: false, error: `path validation failed: ${containment.error}` };
  }

  const depth = typeof args.depth === 'number' ? Math.min(args.depth, MAX_DIRECTORY_DEPTH) : 1;

  try {
    const entries = await listDirBounded(candidate, workspace.workspaceRoot, depth, 0);
    return {
      success: true,
      data: {
        entries: entries.slice(0, MAX_LIST_ENTRIES),
        truncated: entries.length > MAX_LIST_ENTRIES,
        totalFound: entries.length,
        path: targetPath,
        trust: 'untrusted',
        source: 'file',
      },
    };
  } catch (e) {
    return { success: false, error: `failed to list directory: ${String(e)}` };
  }
}

async function listDirBounded(
  dirPath: string,
  workspaceRoot: string,
  maxDepth: number,
  currentDepth: number,
): Promise<Array<{ name: string; type: 'file' | 'directory' | 'symlink'; path: string }>> {
  if (currentDepth > maxDepth) return [];

  let items: string[];
  try {
    items = await readdir(dirPath);
  } catch {
    return [];
  }

  const results: Array<{ name: string; type: 'file' | 'directory' | 'symlink'; path: string }> = [];

  for (const item of items) {
    if (results.length >= MAX_LIST_ENTRIES) break;

    const itemPath = join(dirPath, item);
    const relPath = relative(workspaceRoot, itemPath);

    if (isProtectedPath(relPath)) continue;

    const containment = isPathContained(itemPath, workspaceRoot);
    if (!containment.ok) continue;

    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(itemPath);
    } catch {
      continue;
    }

    const type = info.isSymbolicLink() ? 'symlink' as const
      : info.isDirectory() ? 'directory' as const
      : 'file' as const;

    if (type === 'directory' && isProtectedDirectory(item)) continue;

    results.push({
      name: item,
      type,
      path: relative(workspaceRoot, itemPath),
    });

    if (type === 'directory' && currentDepth < maxDepth) {
      const subEntries = await listDirBounded(itemPath, workspaceRoot, maxDepth, currentDepth + 1);
      for (const sub of subEntries) {
        if (results.length >= MAX_LIST_ENTRIES) break;
        results.push(sub);
      }
    }
  }

  return results;
}
