import { describe, expect, it } from 'vitest';
import { Api, type ApiRequest } from './handlers.js';
import type { AuthService, SessionOwner } from './auth.js';
import type { CommandPipeline, ExecutionRunner } from '../core/pipeline.js';
import type { ApprovalPatch } from '../core/ports.js';
import type { ApprovalRecord } from '../core/types.js';
import { MemoryStore } from '../testing/memoryStore.js';

class TrackingStore extends MemoryStore {
  pairedDecisions = 0;
  approvalPatches = 0;
  failNextTaskPatch = false;

  override async patchApproval(ownerId: string, approvalId: string, patch: ApprovalPatch): Promise<ApprovalRecord> {
    this.approvalPatches += 1;
    return super.patchApproval(ownerId, approvalId, patch);
  }

  override async decideApprovalWithPreparedDelivery(
    ownerId: string,
    approvalId: string,
    patch: Required<ApprovalPatch>,
    approvalStatus: Extract<ApprovalRecord['status'], 'approved' | 'rejected' | 'denied'>,
  ): Promise<ApprovalRecord | null> {
    this.pairedDecisions += 1;
    return super.decideApprovalWithPreparedDelivery(ownerId, approvalId, patch, approvalStatus);
  }

  override async patchTask(...args: Parameters<MemoryStore['patchTask']>) {
    if (this.failNextTaskPatch) {
      this.failNextTaskPatch = false;
      throw new Error('controlled downstream failure');
    }
    return super.patchTask(...args);
  }
}

async function linkedFixture() {
  const store = new TrackingStore();
  const owner: SessionOwner = { id: crypto.randomUUID(), email: 'owner@chef.local' };
  const other: SessionOwner = { id: crypto.randomUUID(), email: 'other@chef.local' };
  const project = await store.createProject(owner.id, { name: 'gate48', slug: `gate48-${crypto.randomUUID()}` });
  const agent = await store.createAgent(owner.id, { name: 'agent', role: 'assistant', capabilities: [], maxConcurrentTasks: 1 });
  const task = await store.createTask(owner.id, { projectId: project.id, agentId: agent.id, title: 'delivery', status: 'needs_approval' });
  const delivery = await store.createPreparedDelivery(owner.id, {
    projectId: project.id,
    taskId: task.id,
    agentId: agent.id,
    message: 'gate48 delivery',
    messageHash: 'a'.repeat(64),
    baseCommit: 'b'.repeat(40),
    preparedTreeSha: 'c'.repeat(40),
    manifest: [{ path: 'src/a.ts', kind: 'M', sha256: 'd'.repeat(64) }],
    manifestFingerprint: 'e'.repeat(64),
    workspaceFingerprint: 'f'.repeat(64),
    verificationSessionId: crypto.randomUUID(),
    verificationWorkspaceFingerprint: 'f'.repeat(64),
  });
  const approval = await store.createApproval(owner.id, {
    projectId: project.id, taskId: task.id, agentId: agent.id,
    action: 'git.commit', riskLevel: 'critical', requestedBy: agent.id,
  });
  await store.linkPreparedDeliveryApproval(owner.id, delivery.id, approval.id);
  const api = new Api(store, {} as AuthService, {} as CommandPipeline, {} as ExecutionRunner);
  const call = (session: SessionOwner, decision: string) => api.handle({
    method: 'POST', path: '/api/approvals/decision', params: { approvalId: approval.id },
    body: { decision }, owner: session, raw: {} as never,
  } as ApiRequest);
  return { store, owner, other, task, delivery, approval, call };
}

describe('Gate48 delivery-linked owner decisions', () => {
  it('uses the paired transaction path, never the generic patch path', async () => {
    const fx = await linkedFixture();
    const result = await fx.call(fx.owner, 'approved');
    expect(result.status).toBe(200);
    expect(fx.store.pairedDecisions).toBe(1);
    expect(fx.store.approvalPatches).toBe(0);
    expect((await fx.store.getApproval(fx.owner.id, fx.approval.id))?.status).toBe('approved');
    expect((await fx.store.getPreparedDelivery(fx.owner.id, fx.delivery.id))?.status).toBe('approved');
    expect((await fx.store.getTask(fx.owner.id, fx.task.id))?.status).toBe('queued');
  });

  it('maps owner denial to denied/rejected and does not create a second authorization', async () => {
    const fx = await linkedFixture();
    expect((await fx.call(fx.owner, 'denied')).status).toBe(200);
    expect((await fx.store.getApproval(fx.owner.id, fx.approval.id))?.status).toBe('denied');
    expect((await fx.store.getPreparedDelivery(fx.owner.id, fx.delivery.id))?.status).toBe('rejected');
    expect((await fx.call(fx.owner, 'denied')).status).toBe(200);
    expect(fx.store.pairedDecisions).toBe(1);
  });

  it('keeps a generic approval on the generic path', async () => {
    const fx = await linkedFixture();
    const generic = await fx.store.createApproval(fx.owner.id, { action: 'generic.action', requestedBy: fx.owner.id });
    const result = await fx.store.getApproval(fx.owner.id, generic.id);
    expect(result?.status).toBe('pending');
    const apiResult = await new Api(fx.store, {} as AuthService, {} as CommandPipeline, {} as ExecutionRunner).handle({
      method: 'POST', path: '/api/approvals/decision', params: { approvalId: generic.id },
      body: { decision: 'approved' }, owner: fx.owner, raw: {} as never,
    } as ApiRequest);
    expect(apiResult.status).toBe(200);
    expect(fx.store.pairedDecisions).toBe(0);
    expect(fx.store.approvalPatches).toBe(1);
  });

  it('fails closed for a cross-owner caller and relationship mismatch', async () => {
    const fx = await linkedFixture();
    expect((await fx.call(fx.other, 'approved')).status).toBe(404);
    const delivery = fx.store.preparedDeliveries.find((row) => row.id === fx.delivery.id)!;
    delivery.agentId = crypto.randomUUID();
    expect((await fx.call(fx.owner, 'approved')).status).toBe(409);
    expect((await fx.store.getApproval(fx.owner.id, fx.approval.id))?.status).toBe('pending');
    expect((await fx.store.getPreparedDelivery(fx.owner.id, fx.delivery.id))?.status).toBe('prepared');
  });

  it('preserves the committed pair when downstream continuation fails and recovers on replay', async () => {
    const fx = await linkedFixture();
    fx.store.failNextTaskPatch = true;
    const first = await fx.call(fx.owner, 'approved');
    expect(first.status).toBe(200);
    expect((first.json as { downstreamContinuation: string }).downstreamContinuation).toBe('pending');
    expect((await fx.store.getPreparedDelivery(fx.owner.id, fx.delivery.id))?.status).toBe('approved');
    const replay = await fx.call(fx.owner, 'approved');
    expect(replay.status).toBe(200);
    expect((replay.json as { recovered: boolean }).recovered).toBe(true);
    expect((await fx.store.getTask(fx.owner.id, fx.task.id))?.status).toBe('queued');
  });
});
