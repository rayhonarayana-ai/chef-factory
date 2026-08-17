// CHEF FACTORY — Gate 3 — Tool handler types.
// Common interface for all tool handlers.

export interface DbQuery {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export interface ToolHandlerInput {
  ownerId: string;
  args: Record<string, unknown>;
  db?: DbQuery;
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
