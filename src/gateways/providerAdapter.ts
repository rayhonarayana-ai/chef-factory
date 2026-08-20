// CHEF FACTORY — Gate 1 → Gate 3 — Provider Adapter contract.
// Model-agnostic boundary. No provider is the architectural core.
// Gate 3: Added tool calling support to the adapter interface.

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
}

export interface ProviderRequest {
  model: string;
  system?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: unknown; name?: string }>;
  maxTokens?: number;
  temperature?: number;
  tools?: Array<Record<string, unknown>>;
  /** Gate 22: AbortSignal for execution timeout propagation. */
  signal?: AbortSignal;
}

export interface ProviderResponse {
  provider: string;
  model: string;
  text: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  toolCalls?: ToolCall[];
}

export interface ProviderAdapter {
  readonly provider: string;
  configured(): boolean;
  supportsTools(): boolean;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

// Shared deterministic token/cost estimator used when providers do not report usage.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function costForTokens(
  costPer1kInput: number,
  costPer1kOutput: number,
  inputTokens: number,
  outputTokens: number,
): number {
  const input = Math.max(0, inputTokens);
  const output = Math.max(0, outputTokens);
  return (input / 1000) * costPer1kInput + (output / 1000) * costPer1kOutput;
}
