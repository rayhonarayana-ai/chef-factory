// CHEF FACTORY — Gate 35A — read_file tool.
// Bounded source reading within approved workspace.
// Protected paths denied. Binary files rejected. Output marked untrusted.

import type { ToolHandlerInput, ToolHandlerResult } from '../../tools/types.js';
import { readFile as fsReadFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveWorkspace } from '../types.js';
import { isProtectedPath } from '../../workspace/protected.js';
import { isPathContained } from '../../workspace/resolver.js';
import { MAX_FILE_READ_SIZE } from '../../workspace/types.js';
import { redactText } from '../../core/redact.js';
import type { Store } from '../../core/ports.js';

export async function readFileHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;

  if (!input.store) return { success: false, error: 'store not available' };
  if (!input.context?.projectId) return { success: false, error: 'project context required' };

  const workspace = await resolveWorkspace(input, input.store as { getPassport: Store['getPassport'] });
  if (!workspace) return { success: false, error: 'workspace not configured for this project' };

  const targetPath = typeof args.path === 'string' ? args.path : '';
  if (!targetPath) return { success: false, error: 'path is required' };

  if (isProtectedPath(targetPath)) {
    return { success: false, error: 'access denied: protected path' };
  }

  const candidate = resolve(workspace.workspaceRoot, targetPath);
  const containment = isPathContained(candidate, workspace.workspaceRoot);
  if (!containment.ok) {
    return { success: false, error: `path validation failed: ${containment.error}` };
  }

  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      return { success: false, error: 'path is a directory, not a file' };
    }
    if (info.size > MAX_FILE_READ_SIZE) {
      return { success: false, error: `file too large: ${info.size} bytes (max ${MAX_FILE_READ_SIZE})` };
    }

    const isBinary = await detectBinary(candidate);
    if (isBinary) {
      return { success: false, error: 'binary file detected — only text files are supported' };
    }

    let content = await fsReadFile(candidate, 'utf8');

    const offset = typeof args.offset === 'number' ? Math.max(0, Math.floor(args.offset)) : 0;
    const limit = typeof args.limit === 'number' ? Math.min(Math.max(0, Math.floor(args.limit)), 10000) : undefined;

    if (offset > 0 || limit !== undefined) {
      const lines = content.split('\n');
      const start = Math.min(offset, lines.length);
      const end = limit !== undefined ? Math.min(start + limit, lines.length) : lines.length;
      content = lines.slice(start, end).join('\n');
    }

    const redacted = redactText(content);

    return {
      success: true,
      data: {
        content: redacted,
        path: targetPath,
        size: info.size,
        trust: 'untrusted',
        source: 'file',
      },
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return { success: false, error: 'file not found' };
    }
    return { success: false, error: `failed to read file: ${String(e)}` };
  }
}

async function detectBinary(filePath: string): Promise<boolean> {
  try {
    const { open } = await import('node:fs/promises');
    const fd = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(512);
      const { bytesRead } = await fd.read(buffer, 0, 512, 0);
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) return true;
      }
      return false;
    } finally {
      await fd.close();
    }
  } catch {
    return false;
  }
}
