// CHEF FACTORY — Gate 1 — SecretProvider (boundary).
// Secrets are isolated from prompts, logs, audit, decision journal, memory and UI.
// Never printed. Gate 1 backend: environment variables only; the interface allows
// future secure backends without changing callers.

export interface SecretProvider {
  /** Return a secret value to trusted caller code. Never log it. */
  get(key: string): string | null;
  /** Names only — never values. Safe for UI/audit. */
  list(): string[];
  /** Reference metadata (no value). Safe for UI/audit. */
  ref(key: string): { key: string; present: boolean; source: string };
  /** Scrub known secret values from any string before it is logged/persisted. */
  redact(text: string): string;
}

const KNOWN_KEYS = [
  'FACTORY_SUPABASE_URL',
  'FACTORY_SUPABASE_ANON_KEY',
  'FACTORY_DB_PASSWORD',
  'FACTORY_OWNER_EMAIL',
  'FACTORY_OWNER_PASSWORD',
  'FACTORY_OPENAI_API_KEY',
  'FACTORY_ANTHROPIC_API_KEY',
  'FACTORY_GOOGLE_API_KEY',
  'FACTORY_OPENCODE_CLI',
];

export function createEnvSecretProvider(env: NodeJS.ProcessEnv = process.env): SecretProvider {
  const values = new Map<string, string>();
  for (const k of KNOWN_KEYS) {
    const v = env[k];
    if (v) values.set(k, v);
  }

  function redact(text: string): string {
    let out = text;
    for (const v of values.values()) {
      if (v.length >= 4) out = out.split(v).join('[REDACTED]');
    }
    return out;
  }

  return {
    get(key: string): string | null {
      return values.get(key) ?? null;
    },
    list(): string[] {
      return [...values.keys()];
    },
    ref(key: string): { key: string; present: boolean; source: string } {
      return { key, present: values.has(key), source: 'env' };
    },
    redact,
  };
}
