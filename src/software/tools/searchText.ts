// CHEF FACTORY — Gate 35A — search_text tool.
// Bounded repository text search without shell execution.
// Protected paths excluded. Binary files excluded. Results bounded.

import type { ToolHandlerInput, ToolHandlerResult } from '../../tools/types.js';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { resolveWorkspace } from '../types.js';
import { isProtectedPath } from '../../workspace/protected.js';
import { isPathContained } from '../../workspace/resolver.js';
import { MAX_SEARCH_RESULTS, MAX_FILE_READ_SIZE } from '../../workspace/types.js';
import type { Store } from '../../core/ports.js';

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.jsonc',
  '.md', '.mdx', '.txt', '.csv',
  '.html', '.htm', '.css', '.scss', '.less',
  '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp',
  '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.graphql', '.gql',
  '.env.example', '.gitignore', '.dockerignore',
  '.dockerfile', '.makefile', '.cmake',
]);

export async function searchTextHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;

  if (!input.store) return { success: false, error: 'store not available' };
  if (!input.context?.projectId) return { success: false, error: 'project context required' };

  const workspace = await resolveWorkspace(input, input.store as { getPassport: Store['getPassport'] });
  if (!workspace) return { success: false, error: 'workspace not configured for this project' };

  const query = typeof args.query === 'string' ? args.query : '';
  if (!query) return { success: false, error: 'query is required' };

  let regex: RegExp;
  try {
    regex = new RegExp(query, 'gi');
  } catch {
    return { success: false, error: 'invalid regex pattern' };
  }

  const searchPath = typeof args.path === 'string' ? args.path : '.';
  const candidate = join(workspace.workspaceRoot, searchPath);
  const containment = isPathContained(candidate, workspace.workspaceRoot);
  if (!containment.ok) {
    return { success: false, error: `path validation failed: ${containment.error}` };
  }

  const maxResults = typeof args.maxResults === 'number'
    ? Math.min(Math.max(1, Math.floor(args.maxResults)), MAX_SEARCH_RESULTS)
    : MAX_SEARCH_RESULTS;

  try {
    const matches = await searchBounded(candidate, workspace.workspaceRoot, regex, maxResults, 0);
    return {
      success: true,
      data: {
        matches: matches.slice(0, maxResults),
        truncated: matches.length > maxResults,
        totalFound: matches.length,
        query,
        trust: 'untrusted',
        source: 'file',
      },
    };
  } catch (e) {
    return { success: false, error: `search failed: ${String(e)}` };
  }
}

interface SearchMatch {
  file: string;
  line: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

async function searchBounded(
  dirPath: string,
  workspaceRoot: string,
  regex: RegExp,
  maxResults: number,
  currentDepth: number,
): Promise<SearchMatch[]> {
  if (currentDepth > 5) return [];

  let items: string[];
  try {
    items = await readdir(dirPath);
  } catch {
    return [];
  }

  const results: SearchMatch[] = [];

  for (const item of items) {
    if (results.length >= maxResults) break;

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

    if (info.isDirectory()) {
      const subMatches = await searchBounded(itemPath, workspaceRoot, regex, maxResults - results.length, currentDepth + 1);
      results.push(...subMatches);
      continue;
    }

    if (!info.isFile()) continue;
    if (info.size > MAX_FILE_READ_SIZE) continue;

    const ext = extname(item).toLowerCase();
    if (ext && !TEXT_EXTENSIONS.has(ext) && !item.startsWith('.')) continue;

    let content: string;
    try {
      content = await readFile(itemPath, 'utf8');
    } catch {
      continue;
    }

    if (/\0/.test(content)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length && results.length < maxResults; i++) {
      regex.lastIndex = 0;
      const match = regex.exec(lines[i]!);
      if (match) {
        results.push({
          file: relPath,
          line: i + 1,
          content: lines[i]!.trim().slice(0, 200),
          matchStart: match.index,
          matchEnd: match.index + match[0].length,
        });
      }
    }
  }

  return results;
}
