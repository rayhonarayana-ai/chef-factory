// CHEF FACTORY — Gate 1 → Gate 3 — Google Provider Adapter (boundary).
// Uses the Google Generative Language API (v1beta, generateContent).
// Gate 3: Added tool calling support.

import type { ProviderAdapter, ProviderConfig, ProviderRequest, ProviderResponse, ToolCall } from '../providerAdapter.js';

interface GooglePart {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
}

interface GoogleContent {
  parts?: GooglePart[];
}

interface GoogleCandidate {
  content?: GoogleContent;
}

interface GoogleResponse {
  candidates?: GoogleCandidate[];
}

export function createGoogleAdapter(config: ProviderConfig = {}): ProviderAdapter {
  const baseUrl = config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  return {
    provider: 'google',
    configured(): boolean {
      return Boolean(config.apiKey);
    },
    supportsTools(): boolean {
      return Boolean(config.apiKey);
    },
    async complete(request: ProviderRequest): Promise<ProviderResponse> {
      if (!config.apiKey) throw new Error('google adapter is not configured (no API key)');
      const contents = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => {
          if (m.role === 'tool') {
            return {
              role: 'user' as const,
              parts: [{ functionResponse: { name: m.name ?? 'unknown', response: safeParse(m.content) } }],
            };
          }
          return {
            role: m.role === 'assistant' ? 'model' as const : 'user' as const,
            parts: [{ text: m.content }],
          };
        });
      const body: Record<string, unknown> = { contents };
      if (request.system) {
        body.system_instruction = { parts: [{ text: request.system }] };
      }
      if (request.tools && request.tools.length > 0) {
        body.tools = [{ function_declarations: request.tools }];
      }
      const res = await fetch(
        `${baseUrl}/models/${request.model}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: request.signal,
        },
      );
      if (!res.ok) throw new Error(`google request failed: HTTP ${res.status}`);
      const json = (await res.json()) as GoogleResponse;
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      let text = '';
      let toolCalls: ToolCall[] | undefined;
      const textParts: string[] = [];
      const tcParts: ToolCall[] = [];
      for (const part of parts) {
        if (part.text) textParts.push(part.text);
        if (part.functionCall) {
          tcParts.push({
            id: `google_${part.functionCall.name ?? 'unknown'}_${Date.now()}`,
            name: part.functionCall.name ?? '',
            arguments: part.functionCall.args ?? {},
          });
        }
      }
      text = textParts.join('');
      if (tcParts.length > 0) toolCalls = tcParts;
      return {
        provider: 'google',
        model: request.model,
        text,
        usage: null,
        toolCalls,
      };
    },
  };
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return { raw: s }; }
}
