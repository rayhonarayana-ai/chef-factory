import { describe, expect, it } from 'vitest';
import {
  canTransition,
  handleTaskFailure,
  retryCapReached,
  transitionTask,
} from './taskEngine.js';
import type { TaskRecord } from './types.js';

function task(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1',
    ownerId: 'owner-1',
    projectId: 'p1',
    environmentId: null,
    parentTaskId: null,
    agentId: null,
    title: 'task',
    description: null,
    status: 'created',
    priority: 'medium',
    riskLevel: 'low',
    authorityLevel: null,
    autonomy: null,
    approvalRequired: false,
    inputs: {},
    output: null,
    error: null,
    attempts: 0,
    maxAttempts: 3,
    correlationId: null,
    createdBy: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

describe('Task Engine (lifecycle state machine)', () => {
  it('walks the happy path created→queued→running→completed', () => {
    expect(canTransition('created', 'queued')).toBe(true);
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition('created', 'completed')).toBe(false);
    expect(canTransition('completed', 'queued')).toBe(false);
    expect(canTransition('failed', 'running')).toBe(false);
    const r = transitionTask(task(), 'completed');
    expect(r.transitioned).toBe(false);
    expect(r.error).toContain('invalid task transition');
  });

  it('records startedAt/completedAt on lifecycle transitions', () => {
    const started = transitionTask(task({ status: 'queued' }), 'running');
    expect(started.task.startedAt).not.toBeNull();
    const done = transitionTask(task({ status: 'running' }), 'completed');
    expect(done.task.completedAt).not.toBeNull();
  });

  it('supports safe failure and cancel states', () => {
    expect(canTransition('running', 'failed')).toBe(true);
    expect(canTransition('running', 'cancelled')).toBe(true);
    expect(canTransition('queued', 'cancelled')).toBe(true);
    expect(canTransition('needs_approval', 'cancelled')).toBe(true);
  });

  it('re-queues on failure while attempts remain (bounded retries)', () => {
    const r = handleTaskFailure(task({ status: 'running', attempts: 1 }), new Error('boom'));
    expect(r.transitioned).toBe(true);
    expect(r.task.status).toBe('queued');
    expect(r.task.attempts).toBe(2);
    expect(r.stopped).toBe(false);
  });

  it('stops after the max attempt limit (anti-infinite-loop)', () => {
    const r = handleTaskFailure(task({ status: 'running', attempts: 2, maxAttempts: 3 }), new Error('boom'));
    expect(r.task.status).toBe('failed');
    expect(r.task.attempts).toBe(3);
    expect(r.stopped).toBe(true);
  });

  it('never auto-retries past the cap', () => {
    const t = task({ status: 'running', attempts: 3, maxAttempts: 3 });
    expect(retryCapReached(t)).toBe(true);
    const r = handleTaskFailure(t, new Error('boom'));
    expect(r.task.status).toBe('failed');
  });

  it('preserves error state on final failure', () => {
    const r = handleTaskFailure(task({ status: 'running', attempts: 2 }), 'crash');
    expect(r.task.error).toEqual({ message: 'crash', class: 'crash' });
  });
});
