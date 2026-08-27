// CHEF FACTORY — Gate 35A — Live workspace adversarial proof.
// Disposable temporary workspace — NOT production CHEF source files.
// Proves: path containment, protected denial, safe read/create/patch, DLP, CAS.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { readFileHandler } from '../software/tools/readFile.js';
import { createFileHandler } from '../software/tools/createFile.js';
import { applyPatchHandler } from '../software/tools/applyPatch.js';
import { listDirectoryHandler } from '../software/tools/listDirectory.js';
import { searchTextHandler } from '../software/tools/searchText.js';
import { contentHash } from '../workspace/mutation.js';
import type { ToolHandlerInput, ToolExecutionContext } from '../tools/types.js';
import type { Store } from '../core/ports.js';

let tmpRoot: string;
let workspaceDir: string;

function makeCtx(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    projectId: 'live-test-project',
    actorType: 'agent',
    actorId: 'live-test-agent',
    agentId: 'live-test-agent',
    taskId: 'live-test-task',
    environment: 'development',
    ...overrides,
  };
}

function makeInput(args: Record<string, unknown> = {}, ctxOverrides: Partial<ToolExecutionContext> = {}): ToolHandlerInput {
  return {
    ownerId: 'live-test-owner',
    args,
    context: makeCtx(ctxOverrides),
    store: {
      getPassport: async () => ({
        projectId: 'live-test-project',
        repository: { workspaceRoot: workspaceDir },
        identity: {},
        description: null,
        technology: {},
        databaseRef: {},
        environments: {},
        deployment: {},
        dependencies: {},
        models: {},
        runtimes: {},
        businessModel: {},
        status: {},
        risks: {},
        credentialsReferences: {},
        operationalHealth: {},
        documentationState: {},
      }),
    } as unknown as Store,
  };
}

beforeAll(async () => {
  tmpRoot = join(tmpdir(), `chef-live-${randomBytes(8).toString('hex')}`);
  workspaceDir = join(tmpRoot, 'workspace');
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(join(workspaceDir, 'src'), { recursive: true });
  await writeFile(join(workspaceDir, 'src', 'app.ts'), 'export const app = "hello";\n');
  await writeFile(join(workspaceDir, 'package.json'), '{"name":"test"}\n');
  await writeFile(join(workspaceDir, '.env'), 'API_KEY=sk-fake1234567890abcdef\n');
  await writeFile(join(workspaceDir, 'key.pem'), '-----BEGIN PRIVATE KEY-----\nMIIB...\n-----END PRIVATE KEY-----\n');
});

afterAll(async () => {
  try { await rm(tmpRoot, { recursive: true, force: true }); } catch { /* cleanup */ }
});

describe('Live Workspace: Path Containment', () => {
  it('read_file accepts path inside workspace', async () => {
    const result = await readFileHandler(makeInput({ path: 'src/app.ts' }));
    expect(result.success).toBe(true);
    const data = result.data as { content: string };
    expect(data.content).toContain('export const app');
  });

  it('read_file rejects traversal', async () => {
    const result = await readFileHandler(makeInput({ path: '../etc/passwd' }));
    expect(result.success).toBe(false);
  });

  it('read_file rejects absolute path', async () => {
    const result = await readFileHandler(makeInput({ path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' }));
    expect(result.success).toBe(false);
  });
});

describe('Live Workspace: Protected Path Denial', () => {
  it('.env is denied', async () => {
    const result = await readFileHandler(makeInput({ path: '.env' }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('protected');
  });

  it('.pem is denied', async () => {
    const result = await readFileHandler(makeInput({ path: 'key.pem' }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('protected');
  });

  it('.git/ is denied', async () => {
    const result = await readFileHandler(makeInput({ path: '.git/config' }));
    expect(result.success).toBe(false);
  });
});

describe('Live Workspace: Safe Read', () => {
  it('reads source file and marks untrusted', async () => {
    const result = await readFileHandler(makeInput({ path: 'src/app.ts' }));
    expect(result.success).toBe(true);
    const data = result.data as { content: string; trust: string; source: string; path: string };
    expect(data.trust).toBe('untrusted');
    expect(data.source).toBe('file');
    expect(data.path).toBe('src/app.ts');
  });

  it('redacts secrets from file content', async () => {
    const secretDir = join(workspaceDir, 'secret-test');
    await mkdir(secretDir, { recursive: true });
    const secretFile = join(secretDir, 'config.ts');
    await writeFile(secretFile, 'const key = "sk-abcdefghijklmnopqrstuvwxyz1234567890";\n');
    try {
      const result = await readFileHandler(makeInput({ path: 'secret-test/config.ts' }));
      expect(result.success).toBe(true);
      const data = result.data as { content: string };
      expect(data.content).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
      expect(data.content).toContain('[REDACTED]');
    } finally {
      await rm(secretDir, { recursive: true, force: true });
    }
  });
});

describe('Live Workspace: Safe Create', () => {
  it('creates new file', async () => {
    const testFile = 'src/created.ts';
    const fullPath = join(workspaceDir, testFile);
    try {
      const result = await createFileHandler(makeInput({ path: testFile, content: 'export const y = 2;\n' }));
      expect(result.success).toBe(true);
      const content = await readFile(fullPath, 'utf8');
      expect(content).toBe('export const y = 2;\n');
    } finally {
      try { await rm(fullPath, { force: true }); } catch { /* cleanup */ }
    }
  });

  it('refuses to overwrite existing file', async () => {
    const testFile = 'src/no-overwrite.ts';
    const fullPath = join(workspaceDir, testFile);
    try {
      await writeFile(fullPath, 'original');
      const result = await createFileHandler(makeInput({ path: testFile, content: 'overwritten' }));
      expect(result.success).toBe(false);
      const content = await readFile(fullPath, 'utf8');
      expect(content).toBe('original');
    } finally {
      try { await rm(fullPath, { force: true }); } catch { /* cleanup */ }
    }
  });
});

describe('Live Workspace: Safe Patch', () => {
  it('patches with valid hash', async () => {
    const testFile = 'src/patchable.ts';
    const fullPath = join(workspaceDir, testFile);
    try {
      await writeFile(fullPath, 'version: 1');
      const hash = contentHash('version: 1');
      const result = await applyPatchHandler(makeInput({
        path: testFile,
        patch: 'version: 2',
        expectedContentHash: hash,
      }));
      expect(result.success).toBe(true);
      const content = await readFile(fullPath, 'utf8');
      expect(content).toBe('version: 2');
    } finally {
      try { await rm(fullPath, { force: true }); } catch { /* cleanup */ }
    }
  });

  it('returns conflict on stale hash', async () => {
    const testFile = 'src/stale.ts';
    const fullPath = join(workspaceDir, testFile);
    try {
      await writeFile(fullPath, 'current');
      const result = await applyPatchHandler(makeInput({
        path: testFile,
        patch: 'attempt',
        expectedContentHash: contentHash('stale'),
      }));
      expect(result.success).toBe(false);
      expect(result.error).toBe('conflict');
    } finally {
      try { await rm(fullPath, { force: true }); } catch { /* cleanup */ }
    }
  });

  it('DLP blocks secret in patch content', async () => {
    const testFile = 'src/dlp-test.ts';
    const fullPath = join(workspaceDir, testFile);
    try {
      await writeFile(fullPath, 'safe content');
      const hash = contentHash('safe content');
      const result = await applyPatchHandler(makeInput({
        path: testFile,
        patch: 'const key = "sk-abcdefghijklmnopqrstuvwxyz1234567890";',
        expectedContentHash: hash,
      }));
      expect(result.success).toBe(false);
      expect(result.error).toBe('denied_secret');
      // Verify file was NOT modified
      const content = await readFile(fullPath, 'utf8');
      expect(content).toBe('safe content');
    } finally {
      try { await rm(fullPath, { force: true }); } catch { /* cleanup */ }
    }
  });
});

describe('Live Workspace: List Directory', () => {
  it('lists workspace root', async () => {
    const result = await listDirectoryHandler(makeInput({ path: '.' }));
    expect(result.success).toBe(true);
    const data = result.data as { entries: Array<{ name: string; type: string }> };
    expect(data.entries.length).toBeGreaterThan(0);
    const names = data.entries.map((e) => e.name);
    expect(names).toContain('src');
    expect(names).toContain('package.json');
  });
});

describe('Live Workspace: Search Text', () => {
  it('finds content', async () => {
    const result = await searchTextHandler(makeInput({ query: 'export' }));
    expect(result.success).toBe(true);
    const data = result.data as { matches: Array<{ file: string }> };
    expect(data.matches.length).toBeGreaterThan(0);
  });
});
