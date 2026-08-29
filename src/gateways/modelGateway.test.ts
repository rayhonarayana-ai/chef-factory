import { describe, expect, it } from 'vitest';
import { ModelGateway } from './modelGateway.js';
import type { ModelInfo } from '../core/types.js';

function model(over: Partial<ModelInfo>): ModelInfo {
  return {
    id: over.id ?? 'm',
    provider: over.provider ?? 'openai',
    name: over.name ?? 'm',
    slug: over.slug ?? 'm',
    capability: over.capability ?? { reasoning: 'low', tools: true },
    contextWindow: over.contextWindow ?? 128000,
    costPer1kInput: over.costPer1kInput ?? 0.15,
    costPer1kOutput: over.costPer1kOutput ?? 0.6,
    status: over.status ?? 'active',
  };
}

const MODELS: ModelInfo[] = [
  model({ id: 'cheap', provider: 'openai', name: 'gpt-4o-mini', capability: { reasoning: 'low', tools: true }, costPer1kInput: 0.15, costPer1kOutput: 0.6 }),
  model({ id: 'mid', provider: 'anthropic', name: 'haiku', capability: { reasoning: 'low', tools: true }, costPer1kInput: 0.8, costPer1kOutput: 4 }),
  model({ id: 'frontier', provider: 'anthropic', name: 'sonnet', capability: { reasoning: 'high', tools: true }, costPer1kInput: 3, costPer1kOutput: 15 }),
  model({ id: 'no-tools', provider: 'google', name: 'flash', capability: { reasoning: 'low', tools: false }, costPer1kInput: 0.075, costPer1kOutput: 0.3 }),
  model({ id: 'retired', provider: 'google', name: 'old', capability: { reasoning: 'low', tools: true }, costPer1kInput: 0.01, costPer1kOutput: 0.01, status: 'retired' }),
];

describe('ModelGateway (model-agnostic selection)', () => {
  const gw = new ModelGateway(new Map());

  it('selects the cheapest capable model for simple work', () => {
    const s = gw.select(MODELS, { requirement: 'general', neededReasoning: 'none', neededTools: true, minContextWindow: null });
    expect(s.model?.id).toBe('cheap');
    expect(s.cheapestCapable).toBe(true);
  });

  it('does not select retired models', () => {
    const s = gw.select(MODELS, { requirement: 'x', neededReasoning: 'none', neededTools: true, minContextWindow: null });
    expect(s.candidates.some((m) => m.id === 'retired')).toBe(false);
  });

  it('filters by tool capability', () => {
    const s = gw.select(MODELS, { requirement: 'x', neededReasoning: 'none', neededTools: true, minContextWindow: null });
    expect(s.candidates.every((m) => (m.capability as { tools: boolean }).tools)).toBe(true);
    expect(s.candidates.some((m) => m.id === 'no-tools')).toBe(false);
  });

  it('selects frontier reasoning only when required', () => {
    const s = gw.select(MODELS, { requirement: 'x', neededReasoning: 'high', neededTools: true, minContextWindow: null });
    expect(s.model?.id).toBe('frontier');
  });

  it('returns no model (nothing invented) when nothing fits', () => {
    const s = gw.select(MODELS, { requirement: 'x', neededReasoning: 'high', neededTools: true, minContextWindow: 9000000 });
    expect(s.model).toBeNull();
    expect(s.reason).toContain('No registered model satisfies');
  });

  it('honors context window requirements', () => {
    const tiny: ModelInfo[] = [model({ id: 'small', contextWindow: 8000 })];
    const s = gw.select(tiny, { requirement: 'x', neededReasoning: 'none', neededTools: false, minContextWindow: 64000 });
    expect(s.model).toBeNull();
  });

  it('exposes configured providers but never hard-codes one', () => {
    expect(gw.providers()).toEqual([]);
  });

  it('never lets provider choice leak into business logic ordering — cost drives it', () => {
    const s = gw.select(MODELS, { requirement: 'x', neededReasoning: 'low', neededTools: true, minContextWindow: null });
    // cheapest capable low-reasoning model is 'cheap' (openai) before 'mid' (anthropic)
    expect(s.model?.id).toBe('cheap');
  });
});
