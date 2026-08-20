// CHEF FACTORY — Gate 3 → Gate 19 — create_task tool handler.
// Creates a new task within a project.
// Gate 19: Uses Store port instead of direct getPool() bypass.

import type { ToolHandlerInput, ToolHandlerResult } from './types.js';

export async function createTaskHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;
  const projectId = typeof args.project_id === 'string' ? args.project_id : '';
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!projectId) return { success: false, error: 'project_id is required' };
  if (!title) return { success: false, error: 'title is required' };

  const description = typeof args.description === 'string' ? args.description : undefined;
  const priority = typeof args.priority === 'string' ? args.priority : 'medium';

  if (!input.store) return { success: false, error: 'store not available' };

  try {
    const project = await input.store.getProject(ownerId, projectId);
    if (!project) return { success: false, error: 'project not found or access denied' };

    const task = await input.store.createTask(ownerId, {
      projectId,
      title,
      description: description ?? undefined,
      priority: priority as 'low' | 'medium' | 'high' | 'critical',
    });
    return {
      success: true,
      data: {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        project_id: task.projectId,
        created_at: task.createdAt,
      },
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
