#!/usr/bin/env node
// CHEF FACTORY — apply a single migration to the live Factory DB
// Usage:  node supabase/tests/apply_migration.cjs <migrationFile>
// Behavior: wraps the migration in a transaction; on failure rolls back.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envFile = path.join(__dirname, '..', '..', '.env');
const envRaw = fs.readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '');
const get = k => envRaw.split(/\r?\n/).filter(l => l.startsWith(k + '=')).map(l => l.split('=').slice(1).join('=').trim()).find(v => v !== undefined);

const c = new Client({
  host: 'aws-1-eu-west-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.dybyidtcyzgliupzzfhl',
  password: get('FACTORY_DB_PASSWORD'),
  database: 'postgres',
  connectionTimeoutMillis: 30000,
  ssl: { rejectUnauthorized: false },
});

const file = process.argv[2];
if (!file) {
  console.log('MIGRATION_FAIL: usage: node apply_migration.cjs <migrationFile>');
  process.exit(1);
}

(async () => {
  const full = path.join(__dirname, '..', 'migrations', file);
  if (!fs.existsSync(full)) {
    console.log(`MIGRATION_FAIL: file not found ${full}`);
    process.exit(1);
  }
  const sql = fs.readFileSync(full, 'utf8');
  await c.connect();
  const t0 = Date.now();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log(`MIGRATION_APPLIED ${file} (${Date.now() - t0}ms)`);
    await c.end();
    process.exit(0);
  } catch (e) {
    try { await c.query('rollback'); } catch (_) {}
    console.log(`MIGRATION_FAIL ${file}: ${e.message}`);
    await c.end();
    process.exit(1);
  }
})();
