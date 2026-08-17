// CHEF FACTORY — Gate 3 — list_tasks tool handler.
// Lists tasks in a project, optionally filtered by status.

import { getPool } from '../db/pool.js';
import type { ToolHandlerInput, ToolHandlerResult } from './types.js';

export async function listTasksHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;
  const projectId = typeof args.project_id === 'string' ? args.project_id : '';
  if (!projectId) return { success: false, error: 'project_id is required' };

  const status = typeof args.status === 'string' ? args.status : null;

  try {
    const db = input.db ?? getPool();
    let query = `SELECT id, title, description, status, priority, project_id, created_at, updated_at
       FROM public.tasks
       WHERE owner_id = $1 AND project_id = $2`;
    const params: unknown[] = [ownerId, projectId];
    if (status) {
      query += ` AND status = $3`;
      params.push(status);
    }
    query += ` ORDER BY created_at DESC`;
    const res = await db.query(query, params);
    return {
      success: true,
      data: res.rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        status: r.status,
        priority: r.priority,
        project_id: r.project_id,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
