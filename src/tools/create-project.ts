// CHEF FACTORY — Gate 3 → Gate 19 — create_project tool handler.
// Creates a new project for the authenticated owner.
// Gate 19: Uses Store port instead of direct getPool() bypass.

import type { ToolHandlerInput, ToolHandlerResult } from './types.js';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export async function createProjectHandler(input: ToolHandlerInput): Promise<ToolHandlerResult> {
  const { ownerId, args } = input;
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (!name) return { success: false, error: 'name is required' };

  const slug = typeof args.slug === 'string' && args.slug.trim()
    ? args.slug.trim()
    : slugify(name);
  const description = typeof args.description === 'string' ? args.description : undefined;

  if (!input.store) return { success: false, error: 'store not available' };

  try {
    const project = await input.store.createProject(ownerId, { name, slug, description });
    return {
      success: true,
      data: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description,
        created_at: project.createdAt,
      },
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
