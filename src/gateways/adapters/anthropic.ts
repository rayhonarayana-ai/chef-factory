// CHEF FACTORY — Gate 1 → Gate 3 — Anthropic Provider Adapter (boundary).
// Uses the Anthropic Messages API. No key is ever logged.
// Gate 3: Added tool calling support.

import type { ProviderAdapter, ProviderConfig, ProviderRequest, ProviderResponse, ToolCall } from '../providerAdapter.js';

export function createAnthropicAdapter(config: ProviderConfig = {}): ProviderAdapter {
  const baseUrl = config.baseUrl ?? 'https://api.anthropic.com/v1';
  return {
    provider: 'anthropic',
    configured(): boolean {
      return Boolean(config.apiKey);
    },
    supportsTools(): boolean {
      return Boolean(config.apiKey);
    },
    async complete(request: ProviderRequest): Promise<ProviderResponse> {
      if (!config.apiKey) throw new Error('anthropic adapter is not configured (no API key)');
      const system = request.messages.find((m) => m.role === 'system')?.content ?? request.system ?? undefined;
      const messages = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => {
          if (m.role === 'tool') {
            return {
              role: 'user' as const,
              content: [{ type: 'tool_result' as const, tool_use_id: m.tool_call_id ?? '', content: m.content }],
            };
          }
          return { role: m.role as 'user' | 'assistant', content: m.content };
        });
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxTokens ?? 1024,
        messages,
        temperature: request.temperature ?? 0,
      };
      if (system) body.system = system;
      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools;
      }
      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`anthropic request failed: HTTP ${res.status}`);
      const json = (await res.json()) as {
        content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      let text = '';
      let toolCalls: ToolCall[] | undefined;
      const contentBlocks = json.content ?? [];
      const textParts: string[] = [];
      const tcParts: ToolCall[] = [];
      for (const block of contentBlocks) {
        if (block.type === 'text') {
          textParts.push(block.text ?? '');
        } else if (block.type === 'tool_use') {
          tcParts.push({
            id: block.id ?? '',
            name: block.name ?? '',
            arguments: block.input ?? {},
          });
        }
      }
      text = textParts.join('');
      if (tcParts.length > 0) toolCalls = tcParts;
      return {
        provider: 'anthropic',
        model: request.model,
        text,
        usage: {
          inputTokens: json.usage?.input_tokens ?? 0,
          outputTokens: json.usage?.output_tokens ?? 0,
        },
        toolCalls,
      };
    },
  };
}
