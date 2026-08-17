import { describe, expect, it } from 'vitest';
import { RuntimeGateway } from './runtimeGateway.js';
import type { RuntimeInfo } from '../core/types.js';

function runtime(over: Partial<RuntimeInfo> = {}): RuntimeInfo {
  return {
    id: over.id ?? 'r',
    name: over.name ?? 'r',
    version: over.version ?? null,
    slug: over.slug ?? 'r',
    capability: over.capability ?? { code: true },
    costPerHour: over.costPerHour ?? 0,
    status: over.status ?? 'active',
  };
}

const RUNTIMES: RuntimeInfo[] = [
  runtime({ id: 'free', name: 'opencode-zen', version: '0.1', slug: 'opencode-zen', costPerHour: 0 }),
  runtime({ id: 'paid', name: 'cloud-runner', version: '1', slug: 'cloud-runner', costPerHour: 5 }),
  runtime({ id: 'retired', name: 'legacy', version: '0.9', slug: 'legacy', costPerHour: 0.1, status: 'retired' }),
];

describe('RuntimeGateway (runtime-agnostic selection)', () => {
  const gw = new RuntimeGateway(new Map());

  it('selects the cheapest capable active runtime', () => {
    const s = gw.select(RUNTIMES, 'build');
    expect(s.runtime?.id).toBe('free');
    expect(s.cheapestCapable).toBe(true);
  });

  it('excludes retired runtimes', () => {
    const s = gw.select(RUNTIMES, 'build');
    expect(s.candidates.some((r) => r.id === 'retired')).toBe(false);
  });

  it('returns no runtime (nothing invented) when none is active', () => {
    const s = gw.select([runtime({ status: 'retired' })], 'build');
    expect(s.runtime).toBeNull();
    expect(s.reason).toContain('No active runtime');
  });

  it('adapter availability drives execution, not the core', () => {
    expect(gw.adapterFor('opencode-zen')).toBeNull(); // not registered → no adapter
    expect(gw.adaptersAvailable()).toEqual([]);
  });
});
