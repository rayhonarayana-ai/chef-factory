// CHEF FACTORY — Gate 1 → Gate 3 — OpenAI Provider Adapter (boundary).
// Uses an OpenAI-compatible chat/completions endpoint. No key is ever logged.
// Gate 3: Added tool calling support.

import type { ProviderAdapter, ProviderConfig, ProviderRequest, ProviderResponse, ToolCall } from '../providerAdapter.js';

export function createOpenAIAdapter(config: ProviderConfig = {}): ProviderAdapter {
  const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
  return {
    provider: 'openai',
    configured(): boolean {
      return Boolean(config.apiKey);
    },
    supportsTools(): boolean {
      return Boolean(config.apiKey);
    },
    async complete(request: ProviderRequest): Promise<ProviderResponse> {
      if (!config.apiKey) throw new Error('openai adapter is not configured (no API key)');
      const body: Record<string, unknown> = {
        model: request.model,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        })),
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0,
      };
      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools;
      }
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`openai request failed: HTTP ${res.status}`);
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }> } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = json.choices?.[0];
      const message = choice?.message;
      let toolCalls: ToolCall[] | undefined;
      if (message?.tool_calls && message.tool_calls.length > 0) {
        toolCalls = message.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function?.name ?? '',
          arguments: tc.function?.arguments ? safeParse(tc.function.arguments) : {},
        }));
      }
      return {
        provider: 'openai',
        model: request.model,
        text: message?.content ?? '',
        usage: {
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
        },
        toolCalls,
      };
    },
  };
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}
