import { describe, expect, it } from 'vitest';
import { createEnvSecretProvider } from './secretProvider.js';

describe('SecretProvider boundary', () => {
  it('never exposes secret values through list/ref', () => {
    const sp = createEnvSecretProvider({ FACTORY_DB_PASSWORD: 'super-secret-pw', FACTORY_OPENAI_API_KEY: 'sk-test-123' });
    for (const k of sp.list()) {
      expect(k).not.toMatch(/sk-|secret-pw/);
    }
    const ref = sp.ref('FACTORY_DB_PASSWORD');
    expect(ref.present).toBe(true);
    expect(JSON.stringify(ref)).not.toContain('super-secret-pw');
  });

  it('returns values only to trusted caller code', () => {
    const sp = createEnvSecretProvider({ FACTORY_OPENAI_API_KEY: 'sk-test-123' });
    expect(sp.get('FACTORY_OPENAI_API_KEY')).toBe('sk-test-123');
  });

  it('returns null for unknown keys', () => {
    const sp = createEnvSecretProvider({});
    expect(sp.get('NOPE')).toBeNull();
  });

  it('redacts secret values from logs', () => {
    const sp = createEnvSecretProvider({ FACTORY_DB_PASSWORD: 'hunter2', FACTORY_OPENAI_API_KEY: 'sk-abcd1234' });
    const out = sp.redact('connecting with hunter2 and key sk-abcd1234 done');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('sk-abcd1234');
    expect(out).toContain('[REDACTED]');
  });
});
