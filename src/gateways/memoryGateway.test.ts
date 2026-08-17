import { describe, expect, it } from 'vitest';
import { createMemoryGateway, validateLesson } from './memoryGateway.js';
import type { Store } from '../core/ports.js';

const store = {
  saveLesson: async () => undefined,
} as unknown as Store;

describe('Memory Gateway boundary', () => {
  it('is not configured when no vector backend exists (honest, never fabricated)', () => {
    const mg = createMemoryGateway(store);
    expect(mg.configured).toBe(false);
  });

  it('recall returns empty without a backend — never invented memories', async () => {
    const mg = createMemoryGateway(store);
    expect(await mg.recall('owner-1', 'anything')).toEqual([]);
  });

  it('rejects lessons containing secrets', () => {
    expect(validateLesson({ title: 'my password is hunter2', summary: 'x', category: 'dev', projectId: null, confidence: 0.9 })).toContain('secret');
    expect(validateLesson({ title: 'use the api key sk-1234', summary: 'x', category: 'dev', projectId: null, confidence: 0.9 })).toContain('secret');
    expect(validateLesson({ title: 'token sbp_abc123', summary: 'x', category: 'dev', projectId: null, confidence: 0.9 })).toContain('secret');
  });

  it('accepts a valid reusable lesson', () => {
    expect(validateLesson({ title: 'kept this pattern reusable', summary: 'extract config to typed module', category: 'architecture', projectId: null, confidence: 0.8 })).toBeNull();
  });

  it('validates lesson shape', () => {
    expect(validateLesson({ title: '', summary: 'x', category: 'dev', projectId: null, confidence: 0.5 })).toContain('title');
    expect(validateLesson({ title: 't', summary: 's', category: 'dev', projectId: null, confidence: 2 })).toContain('confidence');
  });
});
