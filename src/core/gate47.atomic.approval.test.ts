import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';

describe('Gate47 Atomic Approval Consumption', () => {
  let store: MemoryStore;
  const ownerId = 'owner-1';
  const projectId = 'project-1';
  const taskId = 'task-1';
  let realAgentId: string;

  beforeEach(async () => {
    store = new MemoryStore();
    // Create the agent for this owner first and capture its ID
    const agent = await store.createAgent(ownerId, { name: 'Test Agent', role: 'assistant', capabilities: [], maxConcurrentTasks: 1 });
    realAgentId = agent.id;
    // Create a task with the agent
    await store.createTask(ownerId, { projectId, taskId, agentId: realAgentId, title: 'test task' });
  });

  afterEach(() => {
    // no-op
  });

  it('exactly one winner in concurrent approval consumption', async () => {
    const prepared = await store.createPreparedDelivery(ownerId, {
      projectId, taskId, agentId: realAgentId,
      message: 'concurrent test',
      baseCommit: 'a'.repeat(40),
      manifest: [{ path: 'src/test.ts', kind: 'M' as const, sha256: 'b'.repeat(64) }],
    });
    const approval = await store.createApproval(ownerId, {
      projectId, taskId, agentId: realAgentId, action: 'git.commit', description: 'concurrent test', riskLevel: 'critical',
    });
    await store.linkPreparedDeliveryApproval(ownerId, prepared.id, approval.id);

    const r1 = store.decideApprovalWithPreparedDelivery(ownerId, approval.id, { decision: 'approve' }, 'approved');
    const r2 = store.decideApprovalWithPreparedDelivery(ownerId, approval.id, { decision: 'approve' }, 'approved');
    const [result1, result2] = await Promise.all([r1, r2]);

    expect(result1).not.toBeNull();
    expect(result2).toBeNull();

    expect(result1?.status).toBe('approved');
    const delivered = await store.getPreparedDelivery(ownerId, prepared.id);
    expect(delivered?.status).toBe('approved');
  });

  it('concurrent rejection also atomic - only one winner', async () => {
    const prepared = await store.createPreparedDelivery(ownerId, {
      projectId, taskId, agentId: realAgentId,
      message: 'concurrent reject test',
      baseCommit: 'a'.repeat(40),
      manifest: [{ path: 'src/test.ts', kind: 'M' as const, sha256: 'b'.repeat(64) }],
    });
    const approval = await store.createApproval(ownerId, {
      projectId, taskId, agentId: realAgentId, action: 'git.commit', description: 'concurrent reject', riskLevel: 'critical',
    });
    await store.linkPreparedDeliveryApproval(ownerId, prepared.id, approval.id);

    const r1 = store.decideApprovalWithPreparedDelivery(ownerId, approval.id, { decision: 'reject' }, 'rejected');
    const r2 = store.decideApprovalWithPreparedDelivery(ownerId, approval.id, { decision: 'reject' }, 'rejected');
    const [result1, result2] = await Promise.all([r1, r2]);

    expect(result1).not.toBeNull();
    expect(result2).toBeNull();

    const approvalRec = await store.getApproval(ownerId, approval.id);
    const delivered = await store.getPreparedDelivery(ownerId, prepared.id);
    expect(approvalRec?.status).toBe('rejected');
    expect(delivered?.status).toBe('rejected');
  });

  it('mixed concurrent: one approve, one reject - only first wins', async () => {
    const prepared = await store.createPreparedDelivery(ownerId, {
      projectId, taskId, agentId: realAgentId,
      message: 'mixed concurrent test',
      baseCommit: 'a'.repeat(40),
      manifest: [{ path: 'src/test.ts', kind: 'M' as const, sha256: 'b'.repeat(64) }],
    });
    const approval = await store.createApproval(ownerId, {
      projectId, taskId, agentId: realAgentId, action: 'git.commit', description: 'mixed concurrent', riskLevel: 'critical',
    });
    await store.linkPreparedDeliveryApproval(ownerId, prepared.id, approval.id);

    const r1 = store.decideApprovalWithPreparedDelivery(ownerId, approval.id, { decision: 'approve' }, 'approved');
    const r2 = store.decideApprovalWithPreparedDelivery(ownerId, approval.id, { decision: 'reject' }, 'rejected');
    const [result1, result2] = await Promise.all([r1, r2]);

    const successCount = [result1, result2].filter(r => r !== null).length;
    expect(successCount).toBe(1);

    const approvalRec = await store.getApproval(ownerId, approval.id);
    const delivered = await store.getPreparedDelivery(ownerId, prepared.id);
    expect(approvalRec?.status).toBe('approved');
    expect(delivered?.status).toBe('approved');
  });
});