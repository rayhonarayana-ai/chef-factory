// CHEF FACTORY — Gate 3 → Gate 19 → Gate 35A — Tool handler types.
// Common interface for all tool handlers.
// Gate 19: Added `store` for Store-port dependency injection (replaces direct getPool bypass).
// Gate 35A: Added `context` for trusted, non-agent-controlled execution identity.

import type { Store } from '../core/ports.js';
import type { EnvironmentName } from '../core/types.js';

export interface DbQuery {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export interface ToolExecutionContext {
  projectId: string | null;
  actorType: 'owner' | 'agent';
  actorId: string;
  agentId: string | null;
  taskId: string | null;
  environment: EnvironmentName;
}

export interface ToolHandlerInput {
  ownerId: string;
  args: Record<string, unknown>;
  db?: DbQuery;
  store?: Store;
  /** Gate 35A: Trusted context assembled server-side. Never from agent args. */
  context?: ToolExecutionContext;
}

export interface ToolHandlerResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type ToolHandler = (input: ToolHandlerInput) => Promise<ToolHandlerResult>;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  actionType: string;
  requiresApproval: boolean;
  approvalRequest?: boolean;
  approvalBound?: boolean;
  handler: ToolHandler;
}
