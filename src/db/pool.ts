// CHEF FACTORY — Gate 1 — Postgres connection pool (Factory server-side access).
// Uses the postgres role via the Supabase connection pooler. RLS remains the
// enforcement point for direct client access; the Factory Core applies the
// Authority Matrix before any operation.

import { Pool } from 'pg';
import { assertFactoryConfig, getFactoryConfig } from './config.js';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const cfg = getFactoryConfig();
  assertFactoryConfig(cfg);
  pool = new Pool({
    host: cfg.dbHost,
    port: cfg.dbPort,
    user: cfg.dbUser,
    password: cfg.dbPassword,
    database: cfg.dbName,
    max: 5,
    connectionTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
