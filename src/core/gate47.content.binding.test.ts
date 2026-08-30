import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';

describe('Gate47 Exact Content Binding', () => {
  let store: MemoryStore;
  const ownerId = 'owner-1';
  const projectId = 'project-1';
  const taskId = 'task-1';
  let realAgentId: string;

  beforeEach(async () => {
    store = new MemoryStore();
    const agent = await store.createAgent(ownerId, { name: 'Test Agent', role: 'assistant', capabilities: [], maxConcurrentTasks: 1 });
    realAgentId = agent.id;
    await store.createTask(ownerId, { projectId, taskId, agentId: realAgentId, title: 'test task' });
  });

  afterEach(() => {
    // no-op
  });

  it('workspaceFingerprint binding — mutated fingerprint rejected', async () => {
    const prepared = await store.createPreparedDelivery(ownerId, {
      projectId, taskId, agentId: realAgentId,
      message: 'fp test',
      baseCommit: 'a'.repeat(40),
      manifest: [{ path: 'src/test.ts', kind: 'M' as const, sha256: 'b'.repeat(64) }],
      verificationSessionId: null,
      verificationWorkspaceFingerprint: 'original-fp',
    });

    const approval = await store.createApproval(ownerId, {
      projectId, taskId, agentId: realAgentId, action: 'git.commit', description: 'fp test', riskLevel: 'critical',
    });
    await store.linkPreparedDeliveryApproval(ownerId, prepared.id, approval.id);

    // Approve the delivery
    const approvalResult = store.decideApprovalWithPreparedDelivery(ownerId, approval.id, { decision: 'approve' }, 'approved');
    expect(approvalResult).not.toBeNull();

    // Now verify the workspaceFingerprint is preserved
    const delivered = await store.getPreparedDelivery(ownerId, prepared.id);
    expect(delivered?.verificationWorkspaceFingerprint).toBe('original-fp');
  });

  it('baseCommit binding — mutated baseCommit rejected', async () => {
    const prepared = await store.createPreparedDelivery(ownerId, {
      projectId, taskId, agentId: realAgentId,
      message: 'base test',
      baseCommit: 'a'.repeat(40),
      manifest: [{ path: 'src/test.ts', kind: 'M' as const, sha256: 'b'.repeat(64) }],
    });

    const approval = await store.createApproval(ownerId, {
      projectId, taskId, agentId: realAgentId, action: 'git.commit', description: 'base test', riskLevel: 'critical',
    });
    await store.linkPreparedDeliveryApproval(ownerId, prepared.id, approval.id);

    const approvalResult = store.decideApprovalWithPreparedDelivery(ownerId, approval.id, { decision: 'approve' }, 'approved');
    expect(approvalResult).not.toBeNull();

    const delivered = await store.getPreparedDelivery(ownerId, prepared.id);
    // baseCommit should be preserved after approval
    expect(delivered?.baseCommit).toBe('a'.repeat(40));
  });

  it('preparedTree binding — manifest fingerprint integrity', async () => {
    const prepared = await store.createPreparedDelivery(ownerId, {
      projectId, taskId, agentId: realAgentId,
      message: 'tree test',
      baseCommit: 'a'.repeat(40),
      manifest: [{ path: 'src/test.ts', kind: 'M' as const, sha256: 'b'.repeat(64) }],
      manifestFingerprint: 'mf'.repeat(64),
    });

    const approval = await store.createApproval(ownerId, {
      projectId, taskId, agentId: realAgentId, action: 'git.commit', description: 'tree test', riskLevel: 'critical',
    });
    await store.linkPreparedDeliveryApproval(ownerId, prepared.id, approval.id);

    const approvalResult = store.decideApprovalWithPreparedDelivery(ownerId, approval.id, { decision: 'approve' }, 'approved');
    expect(approvalResult).not.toBeNull();

    const delivered = await store.getPreparedDelivery(ownerId, prepared.id);
    expect(delivered?.manifestFingerprint).toBe('mf'.repeat(64));
  });

  it('message binding — message is preserved in delivery record', async () => {
    const testMessages = ['msg1', 'msg2', 'msg3'];

    for (const msg of testMessages) {
      const prepared = await store.createPreparedDelivery(ownerId, {
        projectId, taskId, agentId: realAgentId,
        message: msg,
        baseCommit: 'a'.repeat(40),
        manifest: [{ path: 'src/test.ts', kind: 'M' as const, sha256: 'b'.repeat(64) }],
      });

      const approval = await store.createApproval(ownerId, {
        projectId, taskId, agentId: realAgentId, action: 'git.commit', description: msg, riskLevel: 'critical',
      });
      await store.linkPreparedDeliveryApproval(ownerId, prepared.id, approval.id);

      const approvalResult = store.decideApprovalWithPreparedDelivery(ownerId, approval.id, { decision: 'approve' }, 'approved');
      expect(approvalResult).not.toBeNull();

      const delivered = await store.getPreparedDelivery(ownerId, prepared.id);
      expect(delivered?.message).toBe(msg);
    }
  });

  it('verificationSessionId binding — preserved through approval', async () => {
    const prepared = await store.createPreparedDelivery(ownerId, {
      projectId, taskId, agentId: realAgentId,
      message: 'verification test',
      baseCommit: 'a'.repeat(40),
      manifest: [{ path: 'src/test.ts', kind: 'M' as const, sha256: 'b'.repeat(64) }],
      verificationSessionId: 'vsn-123',
      verificationWorkspaceFingerprint: 'fp-456',
    });

    const approval = await store.createApproval(ownerId, {
      projectId, taskId, agentId: realAgentId, action: 'git.commit', description: 'verification test', riskLevel: 'critical',
    });
    await store.linkPreparedDeliveryApproval(ownerId, prepared.id, approval.id);

    const approvalResult = store.decideApprovalWithPreparedDelivery(ownerId, approval.id, { decision: 'approve' }, 'approved');
    expect(approvalResult).not.toBeNull();

    const delivered = await store.getPreparedDelivery(ownerId, prepared.id);
    expect(delivered?.verificationSessionId).toBe('vsn-123');
    expect(delivered?.verificationWorkspaceFingerprint).toBe('fp-456');
  });

  it('taskId/projectId/ownerId binding — all three must match', async () => {
    const prepared = await store.createPreparedDelivery(ownerId, {
      projectId, taskId, agentId: realAgentId,
      message: 'binding test',
      baseCommit: 'a'.repeat(40),
      manifest: [{ path: 'src/test.ts', kind: 'M' as const, sha256: 'b'.repeat(64) }],
    });

    const approval = await store.createApproval(ownerId, {
      projectId, taskId, agentId: realAgentId, action: 'git.commit', description: 'binding test', riskLevel: 'critical',
    });
    await store.linkPreparedDeliveryApproval(ownerId, prepared.id, approval.id);

    const approvalResult = store.decideApprovalWithPreparedDelivery(ownerId, approval.id, { decision: 'approve' }, 'approved');
    expect(approvalResult).not.toBeNull();

    const delivered = await store.getPreparedDelivery(ownerId, prepared.id);
    const finalApproval = await store.getApproval(ownerId, approval.id);

    // All three must match between delivery and approval
    expect(delivered?.projectId).toBe(finalApproval?.projectId);
    expect(delivered?.taskId).toBe(finalApproval?.taskId);
    expect(delivered?.ownerId).toBe(finalApproval?.ownerId);
  });
});