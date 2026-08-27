// CHEF FACTORY — Gate 35A — Workspace path resolver.
// Cross-platform path containment using path.relative() — NOT prefix string matching.
// Handles Windows drive letters, UNC paths, junctions, symlinks.

import { realpathSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, posix, join, dirname, basename } from 'node:path';
import type { PathValidationResult } from './types.js';

/**
 * Canonical containment check using path.relative().
 * Does NOT use startsWith() — which is vulnerable to prefix collisions.
 */
export function isPathContained(candidateRaw: string, workspaceRootReal: string): PathValidationResult {
  try {
    let candidate: string;
    try {
      candidate = realpathSync(candidateRaw);
    } catch {
      // Target doesn't exist yet — walk up to nearest existing parent
      const parent = findExistingParent(candidateRaw);
      if (!parent) {
        return { ok: false, error: 'no existing parent directory found' };
      }
      const canonicalParent = realpathSync(parent);
      const childBasename = basename(candidateRaw);
      if (childBasename === '..' || childBasename === '.') {
        return { ok: false, error: `invalid path component: ${childBasename}` };
      }
      if (childBasename.includes('/') || childBasename.includes('\\')) {
        return { ok: false, error: 'basename contains path separator' };
      }
      candidate = join(canonicalParent, childBasename);
    }

    const rel = relative(workspaceRootReal, candidate);

    if (rel === '') {
      return { ok: true, canonical: candidate, relative: '' };
    }

    if (rel === '..') {
      return { ok: false, canonical: candidate, relative: rel, error: 'path escapes workspace (parent reference)' };
    }

    if (rel.startsWith('..' + sep)) {
      return { ok: false, canonical: candidate, relative: rel, error: 'path escapes workspace (traversal)' };
    }

    if (isAbsolute(rel)) {
      return { ok: false, canonical: candidate, relative: rel, error: 'path is absolute outside workspace' };
    }

    return { ok: true, canonical: candidate, relative: rel };
  } catch (e) {
    return { ok: false, error: `path resolution error: ${String(e)}` };
  }
}

/**
 * Validate a new file path for creation.
 * Parent must exist and be contained. Basename must be safe.
 */
export function validateNewFilePath(
  targetPath: string,
  workspaceRootReal: string,
): PathValidationResult {
  const parent = dirname(targetPath);
  const name = basename(targetPath);

  if (name === '..' || name === '.') {
    return { ok: false, error: `invalid filename: ${name}` };
  }

  if (name.includes('/') || name.includes('\\')) {
    return { ok: false, error: 'filename contains path separator' };
  }

  if (/^[A-Z]:\\/i.test(name) || name.startsWith('\\\\')) {
    return { ok: false, error: 'filename looks like absolute path' };
  }

  if (!existsSync(parent)) {
    return { ok: false, error: `parent directory does not exist: ${parent}` };
  }

  let canonicalParent: string;
  try {
    canonicalParent = realpathSync(parent);
  } catch {
    return { ok: false, error: `cannot resolve parent directory: ${parent}` };
  }

  const parentCheck = isPathContained(canonicalParent, workspaceRootReal);
  if (!parentCheck.ok) {
    return { ok: false, error: `parent escapes workspace: ${parentCheck.error}` };
  }

  const target = join(canonicalParent, name);
  return { ok: true, canonical: target, relative: relative(workspaceRootReal, target) };
}

/**
 * Resolve workspace root from a passport's repository JSONB field.
 * Falls back to FACTORY_WORKSPACE_ROOT only in test mode.
 */
export function resolveWorkspaceRoot(
  repository: Record<string, unknown> | null | undefined,
): string | null {
  if (repository && typeof repository.workspaceRoot === 'string' && repository.workspaceRoot.length > 0) {
    return repository.workspaceRoot;
  }
  if (process.env['NODE_ENV'] === 'test' || process.env['CHEF_TEST_MODE'] === '1') {
    return process.env['FACTORY_WORKSPACE_ROOT'] ?? null;
  }
  return null;
}

function findExistingParent(filePath: string): string | null {
  let current = dirname(filePath);
  let prev = filePath;
  let iterations = 0;
  const maxIterations = 50;

  while (current !== prev && iterations < maxIterations) {
    if (existsSync(current)) return current;
    prev = current;
    current = dirname(current);
    iterations++;
  }
  return null;
}

export { relative as pathRelative, isAbsolute as pathIsAbsolute };
