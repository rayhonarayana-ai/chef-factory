// CHEF FACTORY — Gate 10 — Live integration test for provider resilience.
// Guarded: skipped unless FACTORY_OPENAI_API_KEY is present.
// Verifies the real OpenAI provider works through the resilience wrapper.

import { describe, expect, it } from 'vitest';
import { createOpenAIAdapter } from '../gateways/adapters/openai.js';
import { createResilientAdapter, DEFAULT_RESILIENCE_CONFIG } from '../gateways/resilience.js';
import { loadEnvFile } from '../db/config.js';

const env = loadEnvFile();
const apiKey = env['FACTORY_OPENAI_API_KEY'] ?? env['OPENAI_API_KEY'] ?? process.env['FACTORY_OPENAI_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '';
const enabled = Boolean(apiKey);

const REQUEST = {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user' as const, content: 'Say exactly: resilience test ok' }],
  maxTokens: 32,
  temperature: 0,
};

describe('Gate 10 — OpenAI Resilience (live)', () => {
  it.runIf(enabled)('L1: real provider request succeeds through resilience wrapper', async () => {
    const inner = createOpenAIAdapter({ apiKey });
    const adapter = createResilientAdapter(inner, { ...DEFAULT_RESILIENCE_CONFIG, requestTimeoutMs: 30_000 });
    const response = await adapter.complete(REQUEST);
    expect(response.provider).toBe('openai');
    expect(response.text.toLowerCase()).toContain('resilience test ok');
    expect(response.usage).toBeTruthy();
  });

  it.runIf(enabled)('L2: health tracker reports success after live call', async () => {
    const inner = createOpenAIAdapter({ apiKey });
    const adapter = createResilientAdapter(inner, { ...DEFAULT_RESILIENCE_CONFIG, requestTimeoutMs: 30_000 });
    await adapter.complete(REQUEST);
    const health = adapter.getHealth();
    expect(health.provider).toBe('openai');
    expect(health.totalRequests).toBeGreaterThanOrEqual(1);
    expect(health.lastSuccessAt).toBeTypeOf('number');
    expect(health.circuitState).toBe('closed');
  });

  it.runIf(enabled)('L3: tool-call-capable request succeeds through resilience wrapper', async () => {
    const inner = createOpenAIAdapter({ apiKey });
    const adapter = createResilientAdapter(inner, { ...DEFAULT_RESILIENCE_CONFIG, requestTimeoutMs: 30_000 });
    const toolResponse = await adapter.complete({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Create a task called resilience test in project default' }],
      maxTokens: 256,
      temperature: 0,
      tools: [{
        type: 'function',
        function: {
          name: 'create_task',
          description: 'Create a new task',
          parameters: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
        },
      }],
    });
    expect(toolResponse.provider).toBe('openai');
    expect(toolResponse.toolCalls).toBeDefined();
  });

  it.runIf(!enabled)('L1: BLOCKED — no OpenAI API key available', () => {
    expect(true).toBe(true);
  });
});
