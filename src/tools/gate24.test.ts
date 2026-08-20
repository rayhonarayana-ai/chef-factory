// CHEF FACTORY — Gate 24 — Runtime Input Contract Hardening.
// Proves that invalid runtime input is rejected before reaching persistence.

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../testing/memoryStore.js';
import { updateTaskHandler } from './update-task.js';
import { createTaskHandler } from './create-task.js';
import { listTasksHandler } from './list-tasks.js';
import {
  isTaskStatus,
  isPriority,
  isApprovalStatus,
  isRiskLevel,
  isPermission,
  isEnvironmentName,
  isAutonomyLevel,
  isStringArray,
} from '../core/runtimeGuard.js';

let store: MemoryStore;
const OWNER = 'owner-g24';

beforeEach(() => {
  store = new MemoryStore();
});

async function seed(ownerId = OWNER) {
  const project = await store.createProject(ownerId, { name: 'P', slug: 'p' });
  const task = await store.createTask(ownerId, {
    projectId: project.id,
    title: 'T',
    priority: 'medium',
  });
  return { project, task };
}

describe('Gate 24 — Runtime Guard Helpers', () => {
  it('isTaskStatus accepts valid statuses', () => {
    expect(isTaskStatus('created')).toBe(true);
    expect(isTaskStatus('queued')).toBe(true);
    expect(isTaskStatus('running')).toBe(true);
    expect(isTaskStatus('completed')).toBe(true);
    expect(isTaskStatus('failed')).toBe(true);
    expect(isTaskStatus('cancelled')).toBe(true);
    expect(isTaskStatus('paused')).toBe(true);
    expect(isTaskStatus('needs_approval')).toBe(true);
  });

  it('isTaskStatus rejects invalid values', () => {
    expect(isTaskStatus('banana')).toBe(false);
    expect(isTaskStatus('')).toBe(false);
    expect(isTaskStatus('CREATED')).toBe(false);
    expect(isTaskStatus('running ')).toBe(false);
    expect(isTaskStatus(null)).toBe(false);
    expect(isTaskStatus(undefined)).toBe(false);
    expect(isTaskStatus(42)).toBe(false);
  });

  it('isPriority accepts valid priorities', () => {
    expect(isPriority('low')).toBe(true);
    expect(isPriority('medium')).toBe(true);
    expect(isPriority('high')).toBe(true);
    expect(isPriority('critical')).toBe(true);
  });

  it('isPriority rejects invalid values', () => {
    expect(isPriority('banana')).toBe(false);
    expect(isPriority('')).toBe(false);
    expect(isPriority('LOW')).toBe(false);
    expect(isPriority('urgent')).toBe(false);
    expect(isPriority(null)).toBe(false);
    expect(isPriority(undefined)).toBe(false);
    expect(isPriority(42)).toBe(false);
  });

  it('isApprovalStatus accepts valid values', () => {
    expect(isApprovalStatus('pending')).toBe(true);
    expect(isApprovalStatus('approved')).toBe(true);
    expect(isApprovalStatus('rejected')).toBe(true);
    expect(isApprovalStatus('denied')).toBe(true);
    expect(isApprovalStatus('expired')).toBe(true);
    expect(isApprovalStatus('cancelled')).toBe(true);
  });

  it('isApprovalStatus rejects invalid values', () => {
    expect(isApprovalStatus('banana')).toBe(false);
    expect(isApprovalStatus('')).toBe(false);
    expect(isApprovalStatus(null)).toBe(false);
  });

  it('isRiskLevel accepts valid values', () => {
    expect(isRiskLevel('low')).toBe(true);
    expect(isRiskLevel('medium')).toBe(true);
    expect(isRiskLevel('high')).toBe(true);
    expect(isRiskLevel('critical')).toBe(true);
  });

  it('isRiskLevel rejects invalid values', () => {
    expect(isRiskLevel('banana')).toBe(false);
    expect(isRiskLevel('extreme')).toBe(false);
  });

  it('isPermission accepts valid values', () => {
    expect(isPermission('read')).toBe(true);
    expect(isPermission('write')).toBe(true);
    expect(isPermission('execute')).toBe(true);
    expect(isPermission('approve')).toBe(true);
    expect(isPermission('admin')).toBe(true);
  });

  it('isPermission rejects invalid values', () => {
    expect(isPermission('banana')).toBe(false);
    expect(isPermission('delete')).toBe(false);
  });

  it('isEnvironmentName accepts valid values', () => {
    expect(isEnvironmentName('development')).toBe(true);
    expect(isEnvironmentName('staging')).toBe(true);
    expect(isEnvironmentName('production')).toBe(true);
  });

  it('isEnvironmentName rejects invalid values', () => {
    expect(isEnvironmentName('banana')).toBe(false);
    expect(isEnvironmentName('prod')).toBe(false);
  });

  it('isAutonomyLevel accepts valid values', () => {
    expect(isAutonomyLevel('auto')).toBe(true);
    expect(isAutonomyLevel('notify')).toBe(true);
    expect(isAutonomyLevel('require_approval')).toBe(true);
    expect(isAutonomyLevel('deny')).toBe(true);
  });

  it('isAutonomyLevel rejects invalid values', () => {
    expect(isAutonomyLevel('banana')).toBe(false);
    expect(isAutonomyLevel('manual')).toBe(false);
  });

  it('isStringArray accepts valid arrays', () => {
    expect(isStringArray(['a', 'b'])).toBe(true);
    expect(isStringArray([])).toBe(true);
    expect(isStringArray(['x'])).toBe(true);
  });

  it('isStringArray rejects non-arrays and mixed arrays', () => {
    expect(isStringArray('not-array')).toBe(false);
    expect(isStringArray(null)).toBe(false);
    expect(isStringArray([1, 2])).toBe(false);
    expect(isStringArray(['a', 42])).toBe(false);
  });
});

describe('Gate 24 — update_task Priority Validation', () => {
  it('accepts valid priority "low"', async () => {
    const { task } = await seed();
    const result = await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, priority: 'low' },
      store,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid priority "medium"', async () => {
    const { task } = await seed();
    const result = await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, priority: 'medium' },
      store,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid priority "high"', async () => {
    const { task } = await seed();
    const result = await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, priority: 'high' },
      store,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid priority "critical"', async () => {
    const { task } = await seed();
    const result = await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, priority: 'critical' },
      store,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown priority string', async () => {
    const { task } = await seed();
    const result = await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, priority: 'banana' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid priority');
  });

  it('rejects empty string priority', async () => {
    const { task } = await seed();
    const result = await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, priority: '' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid priority');
  });

  it('rejects uppercase priority', async () => {
    const { task } = await seed();
    const result = await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, priority: 'HIGH' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid priority');
  });

  it('invalid priority never reaches Store', async () => {
    const { task } = await seed();
    const before = await store.getTask(OWNER, task.id);
    await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, priority: 'invalid_value' },
      store,
    });
    const after = await store.getTask(OWNER, task.id);
    expect(after!.priority).toBe(before!.priority);
  });

  it('invalid priority produces no task mutation', async () => {
    const { task } = await seed();
    const result = await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, priority: 'ultra' },
      store,
    });
    expect(result.success).toBe(false);
    const current = await store.getTask(OWNER, task.id);
    expect(current!.priority).toBe('medium');
  });

  it('valid update behavior remains unchanged', async () => {
    const { task } = await seed();
    const result = await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, title: 'Updated Title', priority: 'high' },
      store,
    });
    expect(result.success).toBe(true);
    const updated = await store.getTask(OWNER, task.id);
    expect(updated!.title).toBe('Updated Title');
    expect(updated!.priority).toBe('high');
  });
});

describe('Gate 24 — create_task Priority Validation', () => {
  it('accepts valid priority "low"', async () => {
    const project = await store.createProject(OWNER, { name: 'P', slug: 'p' });
    const result = await createTaskHandler({
      ownerId: OWNER,
      args: { project_id: project.id, title: 'T', priority: 'low' },
      store,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid priority "critical"', async () => {
    const project = await store.createProject(OWNER, { name: 'P', slug: 'p' });
    const result = await createTaskHandler({
      ownerId: OWNER,
      args: { project_id: project.id, title: 'T', priority: 'critical' },
      store,
    });
    expect(result.success).toBe(true);
  });

  it('defaults to "medium" when no priority provided', async () => {
    const project = await store.createProject(OWNER, { name: 'P', slug: 'p' });
    const result = await createTaskHandler({
      ownerId: OWNER,
      args: { project_id: project.id, title: 'T' },
      store,
    });
    expect(result.success).toBe(true);
    const tasks = await store.listTasks(OWNER, { projectId: project.id });
    expect(tasks[0].priority).toBe('medium');
  });

  it('rejects unknown priority string', async () => {
    const project = await store.createProject(OWNER, { name: 'P', slug: 'p' });
    const result = await createTaskHandler({
      ownerId: OWNER,
      args: { project_id: project.id, title: 'T', priority: 'banana' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid priority');
  });

  it('rejects empty string priority', async () => {
    const project = await store.createProject(OWNER, { name: 'P', slug: 'p' });
    const result = await createTaskHandler({
      ownerId: OWNER,
      args: { project_id: project.id, title: 'T', priority: '' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid priority');
  });

  it('rejects uppercase priority', async () => {
    const project = await store.createProject(OWNER, { name: 'P', slug: 'p' });
    const result = await createTaskHandler({
      ownerId: OWNER,
      args: { project_id: project.id, title: 'T', priority: 'CRITICAL' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid priority');
  });

  it('invalid priority never creates task', async () => {
    const project = await store.createProject(OWNER, { name: 'P', slug: 'p' });
    await createTaskHandler({
      ownerId: OWNER,
      args: { project_id: project.id, title: 'T', priority: 'ultra' },
      store,
    });
    const tasks = await store.listTasks(OWNER, { projectId: project.id });
    expect(tasks).toHaveLength(0);
  });
});

describe('Gate 24 — list_tasks Status Validation', () => {
  it('accepts valid status "created"', async () => {
    const { project } = await seed();
    const result = await listTasksHandler({
      ownerId: OWNER,
      args: { project_id: project.id, status: 'created' },
      store,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid status "running"', async () => {
    const { project } = await seed();
    const result = await listTasksHandler({
      ownerId: OWNER,
      args: { project_id: project.id, status: 'running' },
      store,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown status string', async () => {
    const { project } = await seed();
    const result = await listTasksHandler({
      ownerId: OWNER,
      args: { project_id: project.id, status: 'banana' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid status');
  });

  it('rejects empty string status', async () => {
    const { project } = await seed();
    const result = await listTasksHandler({
      ownerId: OWNER,
      args: { project_id: project.id, status: '' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid status');
  });

  it('rejects uppercase status', async () => {
    const { project } = await seed();
    const result = await listTasksHandler({
      ownerId: OWNER,
      args: { project_id: project.id, status: 'CREATED' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid status');
  });

  it('works correctly when no status filter provided', async () => {
    const { project } = await seed();
    const result = await listTasksHandler({
      ownerId: OWNER,
      args: { project_id: project.id },
      store,
    });
    expect(result.success).toBe(true);
  });

  it('valid status returns matching tasks', async () => {
    const { project, task } = await seed();
    const result = await listTasksHandler({
      ownerId: OWNER,
      args: { project_id: project.id, status: 'created' },
      store,
    });
    expect(result.success).toBe(true);
    expect((result.data as any[]).length).toBe(1);
    expect((result.data as any[])[0].id).toBe(task.id);
  });
});

describe('Gate 24 — update_task Status Validation', () => {
  it('rejects unknown status string', async () => {
    const { task } = await seed();
    const result = await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, status: 'banana' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid status');
  });

  it('rejects empty string status', async () => {
    const { task } = await seed();
    const result = await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, status: '' },
      store,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid status');
  });

  it('valid status transition works', async () => {
    const { task } = await seed();
    const result = await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, status: 'queued' },
      store,
    });
    expect(result.success).toBe(true);
    const updated = await store.getTask(OWNER, task.id);
    expect(updated!.status).toBe('queued');
  });

  it('invalid status never mutates task', async () => {
    const { task } = await seed();
    await updateTaskHandler({
      ownerId: OWNER,
      args: { task_id: task.id, status: 'invalid' },
      store,
    });
    const after = await store.getTask(OWNER, task.id);
    expect(after!.status).toBe('created');
  });
});

describe('Gate 24 — Store Parity: MemoryStore vs TaskPatch', () => {
  it('MemoryStore.patchTask only applies TaskPatch fields', async () => {
    const { task } = await seed();
    const result = await store.patchTask(OWNER, task.id, {
      title: 'New Title',
      priority: 'high',
      description: 'New description',
    });
    expect(result.title).toBe('New Title');
    expect(result.priority).toBe('high');
    expect(result.description).toBe('New description');
    expect(result.status).toBe('created');
  });

  it('MemoryStore.patchTask ignores unknown fields via TaskPatch typing', async () => {
    const { task } = await seed();
    const result = await store.patchTask(OWNER, task.id, {
      title: 'Updated',
    });
    expect(result.title).toBe('Updated');
    expect(result.priority).toBe('medium');
  });
});
