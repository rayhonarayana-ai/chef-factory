// CHEF FACTORY — Gate 3 — update_task tool handler.
// Updates a task's status, title, or description.

import { getPool } from '../db/pool.js';
import type { ToolHandlerInput, ToolHandlerResult } from './types.js';

export async function updateTaskHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;
  const taskId = typeof args.task_id === 'string' ? args.task_id : '';
  if (!taskId) return { success: false, error: 'task_id is required' };

  const updates: string[] = [];
  const params: unknown[] = [ownerId, taskId];
  let paramIdx = 3;

  if (typeof args.title === 'string' && args.title.trim()) {
    updates.push(`title = $${paramIdx++}`);
    params.push(args.title.trim());
  }
  if (typeof args.status === 'string') {
    updates.push(`status = $${paramIdx++}`);
    params.push(args.status);
  }
  if (typeof args.priority === 'string') {
    updates.push(`priority = $${paramIdx++}`);
    params.push(args.priority);
  }
  if (typeof args.description === 'string') {
    updates.push(`description = $${paramIdx++}`);
    params.push(args.description);
  }

  if (updates.length === 0) return { success: false, error: 'no fields to update' };

  updates.push(`updated_at = now()`);

  try {
    const db = input.db ?? getPool();
    const res = await db.query(
      `UPDATE public.tasks
       SET ${updates.join(', ')}
       WHERE owner_id = $1 AND id = $2
       RETURNING id, title, description, status, priority, project_id, created_at, updated_at`,
      params,
    );
    if (res.rows.length === 0) return { success: false, error: 'task not found or access denied' };
    const row = res.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        project_id: row.project_id,
        updated_at: row.updated_at,
      },
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
