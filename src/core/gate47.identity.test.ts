import { describe, expect, it } from 'vitest';
import { TRUSTED_SERVICE_IDENTITY } from '../software/git/runner.js';

describe('Gate47 Service Git Identity - Constant Verification', () => {
  it('trusted service identity constant has required fields', () => {
    expect(TRUSTED_SERVICE_IDENTITY).toHaveProperty('authorName');
    expect(TRUSTED_SERVICE_IDENTITY).toHaveProperty('authorEmail');
    expect(TRUSTED_SERVICE_IDENTITY).toHaveProperty('committerName');
    expect(TRUSTED_SERVICE_IDENTITY).toHaveProperty('committerEmail');
  });

  it('author name and email match service identity specification', () => {
    expect(TRUSTED_SERVICE_IDENTITY.authorName).toBe('CHEF Service');
    expect(TRUSTED_SERVICE_IDENTITY.authorEmail).toBe('chef@factory.invalid');
    expect(TRUSTED_SERVICE_IDENTITY.committerName).toBe('CHEF Service');
    expect(TRUSTED_SERVICE_IDENTITY.committerEmail).toBe('chef@factory.invalid');
  });

  it('all identity fields are non-empty strings', () => {
    expect(typeof TRUSTED_SERVICE_IDENTITY.authorName).toBe('string');
    expect(TRUSTED_SERVICE_IDENTITY.authorName.length).toBeGreaterThan(0);
    expect(typeof TRUSTED_SERVICE_IDENTITY.authorEmail).toBe('string');
    expect(TRUSTED_SERVICE_IDENTITY.authorEmail.length).toBeGreaterThan(0);
    expect(typeof TRUSTED_SERVICE_IDENTITY.committerName).toBe('string');
    expect(TRUSTED_SERVICE_IDENTITY.committerName.length).toBeGreaterThan(0);
    expect(typeof TRUSTED_SERVICE_IDENTITY.committerEmail).toBe('string');
    expect(TRUSTED_SERVICE_IDENTITY.committerEmail.length).toBeGreaterThan(0);
  });
});