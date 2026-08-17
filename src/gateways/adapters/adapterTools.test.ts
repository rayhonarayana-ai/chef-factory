import { describe, expect, it } from 'vitest';
import { createOpenAIAdapter } from './openai.js';
import { createAnthropicAdapter } from './anthropic.js';
import { createGoogleAdapter } from './google.js';

describe('Gate 3 — Provider Adapter Tool Support', () => {
  it('OpenAI adapter reports supportsTools=true when configured', () => {
    const adapter = createOpenAIAdapter({ apiKey: 'test-key' });
    expect(adapter.configured()).toBe(true);
    expect(adapter.supportsTools()).toBe(true);
  });

  it('OpenAI adapter reports supportsTools=false when not configured', () => {
    const adapter = createOpenAIAdapter({});
    expect(adapter.configured()).toBe(false);
    expect(adapter.supportsTools()).toBe(false);
  });

  it('Anthropic adapter reports supportsTools=true when configured', () => {
    const adapter = createAnthropicAdapter({ apiKey: 'test-key' });
    expect(adapter.configured()).toBe(true);
    expect(adapter.supportsTools()).toBe(true);
  });

  it('Anthropic adapter reports supportsTools=false when not configured', () => {
    const adapter = createAnthropicAdapter({});
    expect(adapter.configured()).toBe(false);
    expect(adapter.supportsTools()).toBe(false);
  });

  it('Google adapter reports supportsTools=true when configured', () => {
    const adapter = createGoogleAdapter({ apiKey: 'test-key' });
    expect(adapter.configured()).toBe(true);
    expect(adapter.supportsTools()).toBe(true);
  });

  it('Google adapter reports supportsTools=false when not configured', () => {
    const adapter = createGoogleAdapter({});
    expect(adapter.configured()).toBe(false);
    expect(adapter.supportsTools()).toBe(false);
  });

  it('all adapters have provider name', () => {
    expect(createOpenAIAdapter({}).provider).toBe('openai');
    expect(createAnthropicAdapter({}).provider).toBe('anthropic');
    expect(createGoogleAdapter({}).provider).toBe('google');
  });
});
