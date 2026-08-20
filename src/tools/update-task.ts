// CHEF FACTORY — Gate 3 → Gate 19 — update_task tool handler.
// Updates a task's status, title, or description.
// Gate 19: Uses Store port instead of direct getPool() bypass.
// Gate 19 (OD31): Adds state transition validation via canTransition().

import type { ToolHandlerInput, ToolHandlerResult } from './types.js';
import { canTransition, TERMINAL_TASK_STATUSES } from '../core/taskEngine.js';
import type { TaskStatus } from '../core/types.js';

const VALID_STATUSES = new Set<TaskStatus>([
  'created', 'queued', 'running', 'completed', 'failed', 'cancelled', 'paused', 'needs_approval',
]);

export async function updateTaskHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;
  const taskId = typeof args.task_id === 'string' ? args.task_id : '';
  if (!taskId) return { success: false, error: 'task_id is required' };

  if (!input.store) return { success: false, error: 'store not available' };

  try {
    const current = await input.store.getTask(ownerId, taskId);
    if (!current) return { success: false, error: 'task not found or access denied' };

    const patch: Record<string, unknown> = {};

    if (typeof args.title === 'string' && args.title.trim()) {
      patch.title = args.title.trim();
    }
    if (typeof args.status === 'string') {
      const newStatus = args.status as TaskStatus;
      if (!VALID_STATUSES.has(newStatus)) {
        return { success: false, error: `invalid status: ${newStatus}` };
      }
      if (TERMINAL_TASK_STATUSES.has(current.status)) {
        return { success: false, error: `cannot update task in terminal status: ${current.status}` };
      }
      if (!canTransition(current.status, newStatus)) {
        return { success: false, error: `invalid task transition ${current.status} -> ${newStatus}` };
      }
      patch.status = newStatus;
    }
    if (typeof args.priority === 'string') {
      patch.priority = args.priority;
    }
    if (typeof args.description === 'string') {
      patch.description = args.description;
    }

    if (Object.keys(patch).length === 0) return { success: false, error: 'no fields to update' };

    const updated = await input.store.patchTask(ownerId, taskId, patch as Parameters<typeof input.store.patchTask>[2]);
    return {
      success: true,
      data: {
        id: updated.id,
        title: updated.title,
        description: updated.description,
        status: updated.status,
        priority: updated.priority,
        project_id: updated.projectId,
        updated_at: updated.updatedAt,
      },
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
