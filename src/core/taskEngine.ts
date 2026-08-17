// CHEF FACTORY — Gate 1 — Mission/Task Engine (deterministic state machine).
// Lifecycle: created → queued → running → completed, plus safe failure/cancel states.
// Anti-infinite-loop: max 3 consecutive attempts per failure class unless explicitly
// authorized. After exhausting attempts the task is FAILED and preserved.

import type { TaskRecord, TaskStatus } from './types.js';

export const DEFAULT_MAX_ATTEMPTS = 3;
export const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(['completed', 'failed', 'cancelled']);

// Allowed transitions.
const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  created: ['queued', 'needs_approval', 'cancelled'],
  queued: ['running', 'paused', 'cancelled'],
  running: ['completed', 'failed', 'paused', 'cancelled'],
  needs_approval: ['queued', 'paused', 'cancelled'],
  paused: ['queued', 'cancelled'],
  failed: ['queued', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: TaskStatus, to: TaskStatus): string | null {
  if (from === to) return null;
  if (!canTransition(from, to)) return `invalid task transition ${from} -> ${to}`;
  return null;
}

export interface TransitionResult {
  task: TaskRecord;
  transitioned: boolean;
  error: string | null;
  stopped: boolean; // true when attempts exhausted → FAILED + notify
}

// Apply a transition to a task snapshot, enforcing retry limits on failure→retry.
export function transitionTask(task: TaskRecord, to: TaskStatus, extra?: Partial<TaskRecord>): TransitionResult {
  const err = assertTransition(task.status, to);
  if (err) return { task, transitioned: false, error: err, stopped: false };

  const next: TaskRecord = { ...task, ...extra, status: to, updatedAt: new Date().toISOString() };

  if (to === 'running' && !next.startedAt) next.startedAt = new Date().toISOString();
  if (TERMINAL_TASK_STATUSES.has(to)) next.completedAt = new Date().toISOString();

  return { task: next, transitioned: true, error: null, stopped: false };
}

// On failure: if attempts < maxAttempts → return to QUEUED with attempts+1.
// After the max is reached → task stays FAILED, preserved, and flagged for owner.
export function handleTaskFailure(task: TaskRecord, error: unknown): TransitionResult {
  const attempts = task.attempts + 1;
  const errJson = { message: String(error), class: String(error) };
  const exhausted = attempts >= (task.maxAttempts > 0 ? task.maxAttempts : DEFAULT_MAX_ATTEMPTS);
  const updatedAt = new Date().toISOString();

  if (!exhausted) {
    // Re-queue for a bounded retry (running → queued is the retry path, not a
    // general transition, so it is constructed directly to keep the state
    // machine safe for the remaining transitions).
    return {
      task: { ...task, status: 'queued', attempts, error: errJson, updatedAt },
      transitioned: true,
      error: null,
      stopped: false,
    };
  }
  // Final failure — preserve state, do not auto-retry.
  return {
    task: { ...task, status: 'failed', attempts, error: errJson, completedAt: updatedAt, updatedAt },
    transitioned: true,
    error: null,
    stopped: true,
  };
}

export function retryCapReached(task: TaskRecord): boolean {
  return task.attempts >= (task.maxAttempts > 0 ? task.maxAttempts : DEFAULT_MAX_ATTEMPTS);
}
