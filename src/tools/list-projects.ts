// CHEF FACTORY — Gate 3 — list_projects tool handler.
// Lists all projects owned by the authenticated owner.

import { getPool } from '../db/pool.js';
import type { ToolHandlerInput, ToolHandlerResult } from './types.js';

export async function listProjectsHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId } = input;
  try {
    const db = input.db ?? getPool();
    const res = await db.query(
      `SELECT id, name, slug, description, status, created_at
       FROM public.projects
       WHERE owner_id = $1 AND status != 'deleted'
       ORDER BY created_at DESC`,
      [ownerId],
    );
    return {
      success: true,
      data: res.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        status: r.status,
        created_at: r.created_at,
      })),
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
