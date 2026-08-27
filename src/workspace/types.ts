// CHEF FACTORY — Gate 35A — Workspace security types.
// Trusted execution context and workspace configuration for software tools.
// workspaceRoot originates from passport.repository.workspaceRoot — never from agent args.

import type { EnvironmentName } from '../core/types.js';

export interface ToolExecutionContext {
  projectId: string | null;
  actorType: 'owner' | 'agent';
  actorId: string;
  agentId: string | null;
  taskId: string | null;
  environment: EnvironmentName;
}

export interface WorkspaceContext {
  ownerId: string;
  projectId: string;
  agentId: string | null;
  taskId: string | null;
  workspaceRoot: string;       // canonical resolved root (realpath)
  workspaceRootRaw: string;    // raw value from passport
}

export interface PathValidationResult {
  ok: boolean;
  canonical?: string;
  relative?: string;
  error?: string;
}

export interface DlpResult {
  clean: boolean;
  reason?: string;
  pattern?: string;
}

export const MAX_FILE_READ_SIZE = 100 * 1024;        // 100KB
export const MAX_FILE_WRITE_SIZE = 100 * 1024;       // 100KB
export const MAX_PATCH_SIZE = 10 * 1024;             // 10KB
export const MAX_SEARCH_RESULTS = 50;
export const MAX_LIST_ENTRIES = 100;
export const MAX_DIRECTORY_DEPTH = 5;
