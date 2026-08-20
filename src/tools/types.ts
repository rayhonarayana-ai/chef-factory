// CHEF FACTORY — Gate 3 → Gate 19 — Tool handler types.
// Common interface for all tool handlers.
// Gate 19: Added `store` for Store-port dependency injection (replaces direct getPool bypass).

import type { Store } from '../core/ports.js';

export interface DbQuery {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export interface ToolHandlerInput {
  ownerId: string;
  args: Record<string, unknown>;
  db?: DbQuery;
  store?: Store;
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
  handler: ToolHandler;
}
