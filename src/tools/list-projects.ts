// CHEF FACTORY — Gate 3 → Gate 19 — list_projects tool handler.
// Lists all projects owned by the authenticated owner.
// Gate 19: Uses Store port instead of direct getPool() bypass.

import type { ToolHandlerInput, ToolHandlerResult } from './types.js';

export async function listProjectsHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId } = input;

  if (!input.store) return { success: false, error: 'store not available' };

  try {
    const projects = await input.store.listProjects(ownerId);
    return {
      success: true,
      data: projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        status: p.status,
        created_at: p.createdAt,
      })),
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
