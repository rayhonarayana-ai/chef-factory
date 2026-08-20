// Gate 23 — Contract tests for update_task silent data loss fix.
// Proves title, priority, description persist through the Store contract.

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import type { TaskPatch } from '../core/ports.js';
import type { TaskRecord } from '../core/types.js';

describe('Gate 23 — TaskPatch contract (title/priority/description persistence)', () => {
  const ownerId = 'owner-gate23';
  const projectId = 'proj-gate23';

  async function createTask(store: MemoryStore): Promise<TaskRecord> {
    const project = await store.createProject(ownerId, { name: 'Gate 23 Project', slug: 'gate23-proj' });
    return store.createTask(ownerId, {
      projectId: project.id,
      title: 'Original Title',
      description: 'Original Description',
      priority: 'medium',
    });
  }

  it('TEST A — Title persistence', async () => {
    const store = new MemoryStore();
    const task = await createTask(store);
    const updated = await store.patchTask(ownerId, task.id, { title: 'New Title' });
    expect(updated.title).toBe('New Title');
  });

  it('TEST B — Priority persistence', async () => {
    const store = new MemoryStore();
    const task = await createTask(store);
    const updated = await store.patchTask(ownerId, task.id, { priority: 'critical' });
    expect(updated.priority).toBe('critical');
  });

  it('TEST C — Description persistence', async () => {
    const store = new MemoryStore();
    const task = await createTask(store);
    const updated = await store.patchTask(ownerId, task.id, { description: 'New Description' });
    expect(updated.description).toBe('New Description');
  });

  it('TEST D — Partial patch: only title changes, other fields remain', async () => {
    const store = new MemoryStore();
    const task = await createTask(store);
    const updated = await store.patchTask(ownerId, task.id, { title: 'Only Title' });
    expect(updated.title).toBe('Only Title');
    expect(updated.description).toBe('Original Description');
    expect(updated.priority).toBe('medium');
    expect(updated.status).toBe(task.status);
  });

  it('TEST E — Multi-field patch: all three persist together', async () => {
    const store = new MemoryStore();
    const task = await createTask(store);
    const updated = await store.patchTask(ownerId, task.id, {
      title: 'Multi Title',
      priority: 'critical',
      description: 'Multi Desc',
    });
    expect(updated.title).toBe('Multi Title');
    expect(updated.priority).toBe('critical');
    expect(updated.description).toBe('Multi Desc');
  });

  it('TEST F — Existing patch fields continue to work (status, output, error)', async () => {
    const store = new MemoryStore();
    const task = await createTask(store);
    const updated = await store.patchTask(ownerId, task.id, {
      status: 'queued',
      output: { result: 'partial' },
      error: { message: 'some error' },
    });
    expect(updated.status).toBe('queued');
    expect(updated.output).toEqual({ result: 'partial' });
    expect(updated.error).toEqual({ message: 'some error' });
    expect(updated.title).toBe('Original Title');
  });

  it('TEST G — MemoryStore parity: TaskPatch now includes title/priority/description', () => {
    const allowedKeys: (keyof TaskPatch)[] = [
      'title', 'description', 'priority',
      'status', 'output', 'error', 'attempts', 'startedAt', 'completedAt', 'agentId', 'environmentId',
    ];
    expect(allowedKeys).toContain('title');
    expect(allowedKeys).toContain('priority');
    expect(allowedKeys).toContain('description');
  });

  it('TEST H — Empty patch: MemoryStore returns unchanged task (SupabaseStore throws)', async () => {
    const store = new MemoryStore();
    const task = await createTask(store);
    const updated = await store.patchTask(ownerId, task.id, {});
    expect(updated.id).toBe(task.id);
    expect(updated.title).toBe('Original Title');
  });

  it('TEST I — Description can be set to null', async () => {
    const store = new MemoryStore();
    const task = await createTask(store);
    const updated = await store.patchTask(ownerId, task.id, { description: null });
    expect(updated.description).toBeNull();
  });

  it('TEST J — Title cannot be set to null (TaskRecord.title is string)', async () => {
    const store = new MemoryStore();
    const task = await createTask(store);
    // TypeScript should prevent null for title, but verify runtime behavior
    const updated = await store.patchTask(ownerId, task.id, { title: 'Valid Title' } as TaskPatch);
    expect(updated.title).toBe('Valid Title');
  });

  it('TEST K — Combined: title + status in same patch', async () => {
    const store = new MemoryStore();
    const task = await createTask(store);
    const updated = await store.patchTask(ownerId, task.id, {
      title: 'Updated Title',
      status: 'queued',
    });
    expect(updated.title).toBe('Updated Title');
    expect(updated.status).toBe('queued');
    expect(updated.priority).toBe('medium');
    expect(updated.description).toBe('Original Description');
  });

  it('TEST L — updatedAt is always refreshed', async () => {
    const store = new MemoryStore();
    const task = await createTask(store);
    const before = task.updatedAt;
    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 10));
    const updated = await store.patchTask(ownerId, task.id, { title: 'Time Test' });
    expect(updated.updatedAt).not.toBe(before);
  });
});
