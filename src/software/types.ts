// CHEF FACTORY — Gate 35A — Software tool shared types and workspace helpers.
// Workspace-aware helpers for software tools.

import type { ToolHandlerInput } from '../tools/types.js';
import type { WorkspaceContext } from '../workspace/types.js';
import { resolveWorkspaceRoot, isPathContained } from '../workspace/resolver.js';
import { isProtectedPath } from '../workspace/protected.js';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Async workspace resolution for tool handlers.
 * workspaceRoot comes from passport.repository.workspaceRoot — never from agent args.
 */
export async function resolveWorkspace(
  input: ToolHandlerInput,
  store: { getPassport(ownerId: string, projectId: string): Promise<{ repository: Record<string, unknown> } | null> },
): Promise<WorkspaceContext | null> {
  const ctx = input.context;
  if (!ctx?.projectId) return null;

  const ownerId = input.ownerId;
  const projectId = ctx.projectId;

  const passport = await store.getPassport(ownerId, projectId);
  if (!passport) return null;

  const rawRoot = resolveWorkspaceRoot(passport.repository);
  if (!rawRoot) return null;

  let workspaceRootReal: string;
  try {
    workspaceRootReal = realpathSync(rawRoot);
  } catch {
    return null;
  }

  return {
    ownerId,
    projectId,
    agentId: ctx.agentId,
    taskId: ctx.taskId,
    workspaceRoot: workspaceRootReal,
    workspaceRootRaw: rawRoot,
  };
}

/**
 * Validate a relative path against workspace and protected policy.
 * Returns { ok, canonical, relative } or { ok: false, error }.
 */
export function validateRelativePath(
  relativePath: string,
  workspace: WorkspaceContext,
): { ok: boolean; canonical?: string; relative?: string; error?: string } {
  const { workspaceRoot } = workspace;

  if (isProtectedPath(relativePath)) {
    return { ok: false, error: 'access denied: protected path' };
  }

  const candidate = resolve(workspaceRoot, relativePath);
  const containment = isPathContained(candidate, workspaceRoot);

  if (!containment.ok) {
    return { ok: false, error: containment.error };
  }

  return { ok: true, canonical: containment.canonical, relative: containment.relative };
}
