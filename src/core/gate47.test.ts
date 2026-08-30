import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { ToolBroker, type Tool } from '../gateways/toolBroker.js';
import { currentManifest } from '../software/git/delivery.js';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const delivery = {
  projectId: 'project-1', taskId: 'task-1', agentId: 'agent-1', message: 'safe delivery',
  baseCommit: 'a'.repeat(40), manifest: [{ path: 'src/a.ts', kind: 'M' as const, sha256: 'b'.repeat(64) }],
  manifestFingerprint: 'c'.repeat(64), verificationSessionId: null, verificationWorkspaceFingerprint: null,
};

describe('Gate47 prepared deliveries', () => {
  it('links exactly one approval and advances state with compare-and-swap', async () => {
    const store = new MemoryStore();
    const row = await store.createPreparedDelivery('owner-1', delivery);
    expect((await store.linkPreparedDeliveryApproval('owner-1', row.id, 'approval-1'))?.approvalId).toBe('approval-1');
    expect(await store.linkPreparedDeliveryApproval('owner-1', row.id, 'approval-2')).toBeNull();
    expect(await store.transitionPreparedDelivery('owner-1', row.id, 'prepared', 'committing')).toBeTruthy();
    expect(await store.transitionPreparedDelivery('owner-1', row.id, 'prepared', 'committed')).toBeNull();
    expect((await store.transitionPreparedDelivery('owner-1', row.id, 'committing', 'committed', { commitSha: 'd'.repeat(40) }))?.commitSha).toBe('d'.repeat(40));
  });

  it('creates a deterministic A/M/D manifest and refuses rename ambiguity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chef-g47-'));
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    try {
      await mkdir(join(root, 'src'));
      await writeFile(join(root, 'src', 'modified.ts'), 'one\n');
      await writeFile(join(root, 'src', 'deleted.ts'), 'delete\n');
      await writeFile(join(root, 'src', 'rename-source.ts'), 'rename\n');
      git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base']);
      await writeFile(join(root, 'src', 'modified.ts'), 'two\n');
      await rm(join(root, 'src', 'deleted.ts'));
      await writeFile(join(root, 'src', 'added.ts'), 'new\n');
      const manifest = await currentManifest(root);
      expect(manifest).toMatchObject({ manifest: [{ path: 'src/added.ts', kind: 'A' }, { path: 'src/deleted.ts', kind: 'D', sha256: null }, { path: 'src/modified.ts', kind: 'M' }] });
      await writeFile(join(root, 'src', 'renamed.ts'), 'rename\n');
      await rm(join(root, 'src', 'rename-source.ts'));
      git(['add', '-A']);
      await expect(currentManifest(root)).resolves.toEqual({ error: 'rename_or_copy_not_supported' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('permits approval-request tools but not arbitrary protected tools', async () => {
    const request: Tool = { name: 'request', action: 'request', minRisk: 'high', approvalRequest: true, run: async () => null };
    const protectedTool: Tool = { name: 'protected', action: 'protected', minRisk: 'high', run: async () => null };
    const broker = new ToolBroker(new Map([[request.name, request], [protectedTool.name, protectedTool]]));
    const context = { decision: 'require_approval' as const, approved: false };
    expect((await broker.call({ tool: 'request', args: {}, actorId: 'a', actorType: 'agent', projectId: 'p', environment: 'development', risk: 'high' }, context)).ok).toBe(true);
    expect((await broker.call({ tool: 'protected', args: {}, actorId: 'a', actorType: 'agent', projectId: 'p', environment: 'development', risk: 'high' }, context)).outcome).toBe('requires_approval');
  });
});
