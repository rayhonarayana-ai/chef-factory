import { describe, expect, it } from 'vitest';
import { Monitor } from './monitoring.js';
import { MemoryStore } from '../testing/memoryStore.js';

async function seededStore() {
  const store = new MemoryStore();
  const p = await store.createProject('owner-1', { name: 'Chef HQ', slug: 'chef-hq' });
  return { store, p };
}

describe('Basic Proactive Monitoring', () => {
  it('flags failed tasks as critical for their project', async () => {
    const { store, p } = await seededStore();
    await store.createTask('owner-1', { projectId: p.id, title: 'broken', status: 'failed' });
    const st = await new Monitor(store).dailyStatus('owner-1');
    expect(st.projects[0]?.health).toBe('critical');
    expect(st.alerts.some((a) => a.includes('failed task'))).toBe(true);
  });

  it('raises attention when blocked+failures cross the threshold', async () => {
    const { store, p } = await seededStore();
    for (let i = 0; i < 3; i++) {
      await store.createTask('owner-1', { projectId: p.id, title: `paused-${i}`, status: 'paused' });
    }
    const st = await new Monitor(store, { alertsThreshold: 3 }).dailyStatus('owner-1');
    expect(st.projects[0]?.health).toBe('attention');
    expect(st.projects[0]?.blockedTasks).toBe(3);
  });

  it('healthy project stays healthy', async () => {
    const { store } = await seededStore();
    const st = await new Monitor(store).dailyStatus('owner-1');
    expect(st.projects[0]?.health).toBe('healthy');
  });

  it('surfaces pending approvals as decisions required', async () => {
    const { store, p } = await seededStore();
    await store.createApproval('owner-1', { projectId: p.id, taskId: null, action: 'deploy', riskLevel: 'high', authorityLevel: 'require_approval', requestedBy: 'owner-1' });
    const st = await new Monitor(store).dailyStatus('owner-1');
    expect(st.pendingApprovals).toBe(1);
    expect(st.decisionsRequired.length).toBe(1);
  });
});
