// CHEF FACTORY — Gate 3 — create_project tool handler.
// Creates a new project for the authenticated owner.

import { getPool } from '../db/pool.js';
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
  const description = typeof args.description === 'string' ? args.description : null;

  try {
    const db = input.db ?? getPool();
    const res = await db.query(
      `INSERT INTO public.projects (owner_id, name, slug, description, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, owner_id, name, slug, description, status, created_at, updated_at`,
      [ownerId, name, slug, description],
    );
    const row = res.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        created_at: row.created_at,
      },
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
