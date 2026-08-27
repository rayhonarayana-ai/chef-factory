// CHEF FACTORY — Gate 35A — Workspace path and protected path tests.
// Tests for path containment, protected path policy, and workspace resolution.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { isPathContained, validateNewFilePath, resolveWorkspaceRoot } from '../workspace/resolver.js';
import { isProtectedPath, isProtectedDirectory } from '../workspace/protected.js';

let tmpRoot: string;
let workspaceDir: string;

beforeAll(async () => {
  tmpRoot = join(tmpdir(), `chef-ws-${randomBytes(8).toString('hex')}`);
  workspaceDir = join(tmpRoot, 'workspace');
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(join(workspaceDir, 'src'), { recursive: true });
  await writeFile(join(workspaceDir, 'src', 'index.ts'), 'export const x = 1;\n');
  await writeFile(join(workspaceDir, '.env'), 'SECRET=x\n');
});

afterAll(async () => {
  try { await rm(tmpRoot, { recursive: true, force: true }); } catch { /* cleanup */ }
});

describe('Workspace: isPathContained', () => {
  it('accepts path inside workspace', () => {
    const result = isPathContained(join(workspaceDir, 'src', 'index.ts'), workspaceDir);
    expect(result.ok).toBe(true);
  });

  it('rejects parent traversal', () => {
    const result = isPathContained(join(workspaceDir, '..', 'escape.txt'), workspaceDir);
    expect(result.ok).toBe(false);
  });

  it('rejects absolute external path', () => {
    const result = isPathContained('C:\\Windows\\System32', workspaceDir);
    expect(result.ok).toBe(false);
  });

  it('rejects UNC path', () => {
    const result = isPathContained('\\\\server\\share', workspaceDir);
    expect(result.ok).toBe(false);
  });

  it('rejects sibling prefix collision', () => {
    const result = isPathContained(workspaceDir + '2', workspaceDir);
    expect(result.ok).toBe(false);
  });

  it('accepts workspace root itself', () => {
    const result = isPathContained(workspaceDir, workspaceDir);
    expect(result.ok).toBe(true);
    expect(result.relative).toBe('');
  });
});

describe('Workspace: validateNewFilePath', () => {
  it('accepts valid new file under existing parent', () => {
    const result = validateNewFilePath(join(workspaceDir, 'src', 'new.ts'), workspaceDir);
    expect(result.ok).toBe(true);
  });

  it('rejects non-existing parent', () => {
    const result = validateNewFilePath(join(workspaceDir, 'nope', 'dir', 'file.ts'), workspaceDir);
    expect(result.ok).toBe(false);
  });

  it('rejects traversal in filename', () => {
    const result = validateNewFilePath(join(workspaceDir, 'src', '..'), workspaceDir);
    expect(result.ok).toBe(false);
  });
});

describe('Workspace: resolveWorkspaceRoot', () => {
  it('reads workspaceRoot from passport repository', () => {
    const root = resolveWorkspaceRoot({ workspaceRoot: '/some/path' });
    expect(root).toBe('/some/path');
  });

  it('returns null when workspaceRoot is missing', () => {
    const root = resolveWorkspaceRoot({});
    expect(root).toBeNull();
  });

  it('returns null for null repository', () => {
    const root = resolveWorkspaceRoot(null);
    expect(root).toBeNull();
  });
});

describe('Protected: isProtectedPath', () => {
  it('denies .env', () => expect(isProtectedPath('.env')).toBe(true));
  it('denies .env.local', () => expect(isProtectedPath('.env.local')).toBe(true));
  it('denies key.pem', () => expect(isProtectedPath('key.pem')).toBe(true));
  it('denies .git/config', () => expect(isProtectedPath('.git/config')).toBe(true));
  it('denies .git/credentials', () => expect(isProtectedPath('.git/credentials')).toBe(true));
  it('denies node_modules/package.json', () => expect(isProtectedPath('node_modules/package.json')).toBe(true));
  it('allows src/index.ts', () => expect(isProtectedPath('src/index.ts')).toBe(false));
  it('allows README.md', () => expect(isProtectedPath('README.md')).toBe(false));
  it('allows package.json', () => expect(isProtectedPath('package.json')).toBe(false));
});

describe('Protected: isProtectedDirectory', () => {
  it('denies .git', () => expect(isProtectedDirectory('.git')).toBe(true));
  it('denies node_modules', () => expect(isProtectedDirectory('node_modules')).toBe(true));
  it('denies dist', () => expect(isProtectedDirectory('dist')).toBe(true));
  it('allows src', () => expect(isProtectedDirectory('src')).toBe(false));
  it('allows lib', () => expect(isProtectedDirectory('lib')).toBe(false));
});
