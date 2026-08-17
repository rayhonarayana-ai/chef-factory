#!/usr/bin/env node
// CHEF FACTORY — deterministic RLS/database test runner
// Usage:  node supabase/tests/run_tests.cjs [sqlFile]
//         default: rls_tests.sql (Gate 1); rls_security_tests.sql (Gate 2)
// Deps:   needs `pg` available (NODE_PATH or local node_modules)
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

const sqlFileArg = process.argv[2] ?? 'rls_tests.sql';

(async () => {
  const sqlFile = path.join(__dirname, sqlFileArg);
  if (!fs.existsSync(sqlFile)) {
    console.log(`RLS_TESTS_FAIL: file not found ${sqlFile}`);
    process.exit(1);
  }
  const sql = fs.readFileSync(sqlFile, 'utf8');
  await c.connect();
  const t0 = Date.now();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('rollback');
    console.log(`${sqlFileArg.toUpperCase().replace(/\.sql$/, '')}_PASS (${Date.now() - t0}ms) — all deterministic tests succeeded`);
    await c.end();
    process.exit(0);
  } catch (e) {
    try { await c.query('rollback'); } catch (_) {}
    console.log(`${sqlFileArg.toUpperCase().replace(/\.sql$/, '')}_FAIL: ${e.message}`);
    await c.end();
    process.exit(1);
  }
})();
