// CHEF FACTORY — Gate 3 → Gate 19 — update_task tool handler.
// Updates a task's status, title, or description.
// Gate 19: Uses Store port instead of direct getPool() bypass.
// Gate 19 (OD31): Adds state transition validation via canTransition().

import type { ToolHandlerInput, ToolHandlerResult } from './types.js';
import { canTransition, TERMINAL_TASK_STATUSES } from '../core/taskEngine.js';
import { isTaskStatus, isPriority } from '../core/runtimeGuard.js';
import type { TaskPatch } from '../core/ports.js';

export async function updateTaskHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;
  const taskId = typeof args.task_id === 'string' ? args.task_id : '';
  if (!taskId) return { success: false, error: 'task_id is required' };

  if (!input.store) return { success: false, error: 'store not available' };

  try {
    const current = await input.store.getTask(ownerId, taskId);
    if (!current) return { success: false, error: 'task not found or access denied' };

    const patch: TaskPatch = {};

    if (typeof args.title === 'string' && args.title.trim()) {
      patch.title = args.title.trim();
    }
    if (typeof args.status === 'string') {
      if (!isTaskStatus(args.status)) {
        return { success: false, error: `invalid status: ${args.status}` };
      }
      const newStatus = args.status;
      if (TERMINAL_TASK_STATUSES.has(current.status)) {
        return { success: false, error: `cannot update task in terminal status: ${current.status}` };
      }
      if (!canTransition(current.status, newStatus)) {
        return { success: false, error: `invalid task transition ${current.status} -> ${newStatus}` };
      }
      patch.status = newStatus;
    }
    if (typeof args.priority === 'string') {
      if (!isPriority(args.priority)) {
        return { success: false, error: `invalid priority: ${args.priority}. Must be one of: low, medium, high, critical` };
      }
      patch.priority = args.priority;
    }
    if (typeof args.description === 'string') {
      patch.description = args.description;
    }

    if (Object.keys(patch).length === 0) return { success: false, error: 'no fields to update' };

    const updated = await input.store.patchTask(ownerId, taskId, patch);
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
