// CHEF FACTORY — Gate 1 — Seed script (owner + default registries).
// Usage: npm run seed
// Creates the owner auth user (only when FACTORY_OWNER_EMAIL + FACTORY_OWNER_PASSWORD
// are set in .env) and seeds default model/runtime registry entries + the CHEF HQ
// control project. Idempotent. Never prints secrets.

import bcrypt from 'bcryptjs';
import { getFactoryConfig, assertFactoryConfig } from './config.js';
import { getPool, closePool } from './pool.js';

async function main(): Promise<void> {
  const cfg = getFactoryConfig();
  assertFactoryConfig(cfg);
  const pool = getPool();

  const seeded: string[] = [];

  // 1. Owner auth user (bcrypt hashed password).
  if (cfg.ownerEmail && cfg.ownerPassword) {
    const existing = await pool.query('select id from auth.users where email = $1', [cfg.ownerEmail]);
    if ((existing.rowCount ?? 0) === 0) {
      const hash = await bcrypt.hash(cfg.ownerPassword, 10);
      await pool.query(
        `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data)
         values (gen_random_uuid(), 'authenticated', 'authenticated', $1, $2, now(), '{"provider":"email","providers":["email"]}')`,
        [cfg.ownerEmail, hash],
      );
      seeded.push(`owner user ${cfg.ownerEmail}`);
    } else {
      seeded.push(`owner user ${cfg.ownerEmail} (already exists)`);
    }
  } else {
    seeded.push('owner user: SKIPPED (set FACTORY_OWNER_EMAIL/FACTORY_OWNER_PASSWORD in .env to enable)');
  }

  // Owner id (owners row created by trigger).
  const owner = cfg.ownerEmail
    ? await pool.query('select id from public.owners where email = $1', [cfg.ownerEmail])
    : null;
  const ownerId: string | null = owner?.rows[0]?.id ?? null;

  // 2. Default model registry (model-agnostic catalog; cheapest first).
  if (ownerId) {
    const models = [
      { provider: 'openai', name: 'gpt-4o-mini', slug: 'gpt-4o-mini', capability: { reasoning: 'low', tools: true }, context: 128000, in: 0.15, out: 0.6 },
      { provider: 'openai', name: 'gpt-4o', slug: 'gpt-4o', capability: { reasoning: 'medium', tools: true }, context: 128000, in: 2.5, out: 10 },
      { provider: 'anthropic', name: 'claude-3-5-haiku', slug: 'claude-3-5-haiku', capability: { reasoning: 'low', tools: true }, context: 200000, in: 0.8, out: 4 },
      { provider: 'anthropic', name: 'claude-3-5-sonnet', slug: 'claude-3-5-sonnet', capability: { reasoning: 'high', tools: true }, context: 200000, in: 3, out: 15 },
      { provider: 'google', name: 'gemini-1.5-flash', slug: 'gemini-1.5-flash', capability: { reasoning: 'low', tools: true }, context: 1048576, in: 0.075, out: 0.3 },
      { provider: 'google', name: 'gemini-1.5-pro', slug: 'gemini-1.5-pro', capability: { reasoning: 'high', tools: true }, context: 2097152, in: 1.25, out: 5 },
    ];
    for (const m of models) {
      await pool.query(
        `insert into public.models (owner_id, provider, name, slug, capability, context_window, cost_per_1k_input, cost_per_1k_output)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
         on conflict (owner_id, provider, name) do update set
           capability = excluded.capability, context_window = excluded.context_window,
           cost_per_1k_input = excluded.cost_per_1k_input, cost_per_1k_output = excluded.cost_per_1k_output,
           status = 'active'`,
        [ownerId, m.provider, m.name, m.slug, JSON.stringify(m.capability), m.context, m.in, m.out],
      );
    }
    seeded.push(`models: ${models.length} seeded`);

    const runtimes = [
      { name: 'opencode-zen', version: '0.1', slug: 'opencode-zen', capability: { code: true, shell: true }, costPerHour: 0 },
    ];
    for (const r of runtimes) {
      await pool.query(
        `insert into public.runtimes (owner_id, name, version, slug, capability, cost_per_hour)
         values ($1,$2,$3,$4,$5::jsonb,$6)
         on conflict (owner_id, name, version) do update set
           capability = excluded.capability, cost_per_hour = excluded.cost_per_hour, status = 'active'`,
        [ownerId, r.name, r.version, r.slug, JSON.stringify(r.capability), r.costPerHour],
      );
    }
    seeded.push(`runtimes: ${runtimes.length} seeded`);

    // 3. CHEF HQ control project.
    const hq = await pool.query(
      `insert into public.projects (owner_id, name, slug, description, status)
       values ($1, 'CHEF HQ', 'chef-hq', 'Factory control project', 'active')
       on conflict (owner_id, slug) do nothing returning id`,
      [ownerId],
    );
    if ((hq.rowCount ?? 0) > 0) seeded.push('project chef-hq created');
    else seeded.push('project chef-hq (already exists)');
  }

  console.log(`SEED COMPLETE:\n- ${seeded.join('\n- ')}`);
  await closePool();
}

main().catch((e) => {
  console.error(`SEED FAILED: ${e.message}`);
  process.exit(1);
});
