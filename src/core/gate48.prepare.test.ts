import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gitPrepareCommitHandler } from '../software/tools/gitPrepareCommit.js';
import { fingerprintWorkspace } from '../workspace/integrity.js';
import { MemoryStore } from '../testing/memoryStore.js';
import type { ToolHandlerInput } from '../tools/types.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'chef-g48-prepare-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'a.ts'), 'export const value = 1;\n');
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git(['init', '-q']);
  git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'add', '.']);
  git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base']);
  await writeFile(join(root, 'src', 'a.ts'), 'export const value = 2;\n');

  const store = new MemoryStore();
  const ownerId = crypto.randomUUID();
  const project = await store.createProject(ownerId, { name: 'gate48', slug: `gate48-${crypto.randomUUID()}` });
  await store.upsertPassport(ownerId, project.id, { repository: { workspaceRoot: root } });
  const agent = await store.createAgent(ownerId, { name: 'agent', role: 'assistant', capabilities: [], maxConcurrentTasks: 1 });
  const task = await store.createTask(ownerId, { projectId: project.id, agentId: agent.id, title: 'prepare delivery' });
  const input: ToolHandlerInput = {
    ownerId,
    args: { message: 'prepare verified delivery', workspaceFingerprint: 'fake', verificationSessionId: crypto.randomUUID() },
    store,
    db: { query: async () => ({ rows: [] }) },
    context: { projectId: project.id, agentId: agent.id, taskId: task.id, actorId: agent.id, actorType: 'agent', environment: 'development' },
  };
  return { root, store, ownerId, project, task, input };
}

describe('Gate48 trusted verification precondition', () => {
  it('rejects missing, malformed, and stale V/S evidence without persisting delivery', async () => {
    const fx = await fixture();
    try {
      expect((await gitPrepareCommitHandler(fx.input)).success).toBe(false);
      expect(fx.store.preparedDeliveries).toHaveLength(0);

      await fx.store.recordTaskVerification(fx.ownerId, {
        projectId: fx.project.id, taskId: fx.task.id, attempt: 1, operation: 'test', outcome: 'passed',
        verificationSessionId: null, workspaceFingerprint: 'f'.repeat(64),
      });
      expect((await gitPrepareCommitHandler(fx.input)).success).toBe(false);
      expect(fx.store.preparedDeliveries).toHaveLength(0);

      await fx.store.recordTaskVerification(fx.ownerId, {
        projectId: fx.project.id, taskId: fx.task.id, attempt: 2, operation: 'test', outcome: 'passed',
        verificationSessionId: 'not-a-uuid', workspaceFingerprint: 'f'.repeat(64),
      });
      expect((await gitPrepareCommitHandler(fx.input)).success).toBe(false);
      expect(fx.store.preparedDeliveries).toHaveLength(0);

      await fx.store.recordTaskVerification(fx.ownerId, {
        projectId: fx.project.id, taskId: fx.task.id, attempt: 3, operation: 'test', outcome: 'passed',
        verificationSessionId: crypto.randomUUID(), workspaceFingerprint: null,
      });
      expect((await gitPrepareCommitHandler(fx.input)).success).toBe(false);
      expect(fx.store.preparedDeliveries).toHaveLength(0);

      await fx.store.recordTaskVerification(fx.ownerId, {
        projectId: fx.project.id, taskId: fx.task.id, attempt: 4, operation: 'test', outcome: 'passed',
        verificationSessionId: crypto.randomUUID(), workspaceFingerprint: 'e'.repeat(64),
      });
      expect((await gitPrepareCommitHandler(fx.input)).success).toBe(false);
      expect(fx.store.preparedDeliveries).toHaveLength(0);
    } finally {
      await rm(fx.root, { recursive: true, force: true });
    }
  });

  it('rejects a malformed verificationSessionId even when the fingerprint is the real current one (discriminating gate)', async () => {
    const fx = await fixture();
    try {
      const fingerprint = await fingerprintWorkspace(fx.root);
      if (!fingerprint.ok) throw new Error('fixture fingerprint failed');
      await fx.store.recordTaskVerification(fx.ownerId, {
        projectId: fx.project.id, taskId: fx.task.id, attempt: 1, operation: 'test', outcome: 'passed',
        verificationSessionId: 'not-a-uuid', workspaceFingerprint: fingerprint.value.fingerprint,
      });
      const result = await gitPrepareCommitHandler(fx.input);
      expect(result.success).toBe(false);
      expect(fx.store.preparedDeliveries).toHaveLength(0);
      expect(fx.store.approvals).toHaveLength(0);
    } finally {
      await rm(fx.root, { recursive: true, force: true });
    }
  });

  it('persists only server-recorded current V/S values, never request-supplied values', async () => {
    const fx = await fixture();
    try {
      const fingerprint = await fingerprintWorkspace(fx.root);
      if (!fingerprint.ok) throw new Error('fixture fingerprint failed');
      const sessionId = crypto.randomUUID();
      await fx.store.recordTaskVerification(fx.ownerId, {
        projectId: fx.project.id, taskId: fx.task.id, attempt: 1, operation: 'build', outcome: 'passed',
        verificationSessionId: sessionId, workspaceFingerprint: fingerprint.value.fingerprint,
      });
      const result = await gitPrepareCommitHandler(fx.input);
      expect(result.success).toBe(true);
      expect(fx.store.preparedDeliveries).toHaveLength(1);
      expect(fx.store.preparedDeliveries[0]?.workspaceFingerprint).toBe(fingerprint.value.fingerprint);
      expect(fx.store.preparedDeliveries[0]?.verificationWorkspaceFingerprint).toBe(fingerprint.value.fingerprint);
      expect(fx.store.preparedDeliveries[0]?.verificationSessionId).toBe(sessionId);
      // Gate48 preclosure contract: gitPrepareCommit MUST record the canonical
      // OWNER as the approval requester (requested_by → owners(id) live FK).
      // MemoryStore maps requestedBy verbatim, so this local assertion fails if
      // the handler regresses to requestedBy: agentId — the defect is not
      // silently maskable.
      const approvalId = (result.data as { approvalId: string }).approvalId;
      const approval = await fx.store.getApproval(fx.ownerId, approvalId);
      const agentId = fx.input.context?.agentId ?? null;
      expect(approval).not.toBeNull();
      expect(approval?.requestedBy).toBe(fx.ownerId);
      expect(approval?.requestedBy).not.toBe(agentId);
    } finally {
      await rm(fx.root, { recursive: true, force: true });
    }
  });
});
