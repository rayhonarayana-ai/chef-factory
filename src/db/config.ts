// CHEF FACTORY — Gate 1 — Environment configuration loader.
// Reads the git-ignored .env at the repository root. No secrets are ever printed.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface FactoryConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  dbPassword: string;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbName: string;
  ownerEmail: string | null;
  ownerPassword: string | null;
}

export function loadEnvFile(): Record<string, string> {
  const path = process.env['FACTORY_ENV_FILE']
    ? resolve(process.env['FACTORY_ENV_FILE'])
    : resolve(process.cwd(), '.env');
  const out: Record<string, string> = {};
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      let value = m[2]!;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[m[1]!] = value.trim();
    }
  }
  return out;
}

export function getFactoryConfig(env: NodeJS.ProcessEnv = process.env): FactoryConfig {
  const file = loadEnvFile();
  const get = (k: string): string | undefined => file[k] ?? env[k];
  const url = get('FACTORY_SUPABASE_URL') ?? '';
  const ref = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? '';
  return {
    supabaseUrl: url,
    supabaseAnonKey: get('FACTORY_SUPABASE_ANON_KEY') ?? '',
    dbPassword: get('FACTORY_DB_PASSWORD') ?? '',
    dbHost: get('FACTORY_DB_HOST') ?? `aws-1-eu-west-1.pooler.supabase.com`,
    dbPort: Number(get('FACTORY_DB_PORT') ?? '5432'),
    dbUser: get('FACTORY_DB_USER') ?? `postgres.${ref}`,
    dbName: get('FACTORY_DB_NAME') ?? 'postgres',
    ownerEmail: get('FACTORY_OWNER_EMAIL') ?? null,
    ownerPassword: get('FACTORY_OWNER_PASSWORD') ?? null,
  };
}

export function assertFactoryConfig(cfg: FactoryConfig): void {
  const missing: string[] = [];
  if (!cfg.supabaseUrl) missing.push('FACTORY_SUPABASE_URL');
  if (!cfg.supabaseAnonKey) missing.push('FACTORY_SUPABASE_ANON_KEY');
  if (!cfg.dbPassword) missing.push('FACTORY_DB_PASSWORD');
  if (missing.length > 0) {
    throw new Error(`FACTORY_CONFIG_MISSING: ${missing.join(', ')}`);
  }
}
