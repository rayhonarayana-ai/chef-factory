// CHEF FACTORY — Gate 3 — create_task tool handler.
// Creates a new task within a project.

import { getPool } from '../db/pool.js';
import type { ToolHandlerInput, ToolHandlerResult } from './types.js';

export async function createTaskHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;
  const projectId = typeof args.project_id === 'string' ? args.project_id : '';
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!projectId) return { success: false, error: 'project_id is required' };
  if (!title) return { success: false, error: 'title is required' };

  const description = typeof args.description === 'string' ? args.description : null;
  const priority = typeof args.priority === 'string' ? args.priority : 'medium';

  try {
    const db = input.db ?? getPool();
    // Verify project ownership
    const projRes = await db.query(
      `SELECT id FROM public.projects WHERE id = $1 AND owner_id = $2 AND status != 'deleted'`,
      [projectId, ownerId],
    );
    if (projRes.rows.length === 0) return { success: false, error: 'project not found or access denied' };

    const res = await db.query(
      `INSERT INTO public.tasks (owner_id, project_id, title, description, status, priority, risk_level, authority_level, autonomy, approval_required, inputs)
       VALUES ($1, $2, $3, $4, 'created', $5, 'low', 'auto', 'auto', false, '{}')
       RETURNING id, title, description, status, priority, project_id, created_at, updated_at`,
      [ownerId, projectId, title, description, priority],
    );
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
        created_at: row.created_at,
      },
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
