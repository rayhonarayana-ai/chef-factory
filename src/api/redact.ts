// CHEF FACTORY — Gate 1 — Log redaction helper.
// Scrubs known secret values from any string that reaches logs, audit, or the UI.

import { createEnvSecretProvider, type SecretProvider } from '../gateways/secretProvider.js';

let provider: SecretProvider | null = null;

export function getRedactor(): SecretProvider {
  if (!provider) provider = createEnvSecretProvider();
  return provider;
}

export function redactForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const s = JSON.stringify(value);
  if (!s) return value;
  return JSON.parse(getRedactor().redact(s));
}
