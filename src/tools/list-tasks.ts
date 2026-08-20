// CHEF FACTORY — Gate 3 → Gate 19 — list_tasks tool handler.
// Lists tasks in a project, optionally filtered by status.
// Gate 19: Uses Store port instead of direct getPool() bypass.

import type { ToolHandlerInput, ToolHandlerResult } from './types.js';
import { isTaskStatus } from '../core/runtimeGuard.js';

export async function listTasksHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;
  const projectId = typeof args.project_id === 'string' ? args.project_id : '';
  if (!projectId) return { success: false, error: 'project_id is required' };

  let status: 'created' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'needs_approval' | undefined;
  if (typeof args.status === 'string') {
    if (!isTaskStatus(args.status)) {
      return { success: false, error: `invalid status: ${args.status}` };
    }
    status = args.status;
  }

  if (!input.store) return { success: false, error: 'store not available' };

  try {
    const tasks = await input.store.listTasks(ownerId, {
      projectId,
      status,
    });
    return {
      success: true,
      data: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        project_id: t.projectId,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
      })),
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
