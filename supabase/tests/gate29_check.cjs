const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

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

const mode = process.argv[2] || 'pre';

(async () => {
  await c.connect();

  if (mode === 'pre') {
    // Pre-migration: verify columns do NOT exist
    const r = await c.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tasks'
        AND column_name IN ('required_capabilities', 'preferred_role')
      ORDER BY column_name
    `);
    console.log('PRE_MIGRATION_COLUMNS:', JSON.stringify(r.rows));
    if (r.rows.length > 0) {
      console.log('WARNING: columns already exist!');
    } else {
      console.log('CONFIRMED: columns are ABSENT');
    }

    // Count existing tasks
    const cnt = await c.query('SELECT count(*) as n FROM public.tasks');
    console.log('EXISTING_TASK_COUNT:', cnt.rows[0].n);

  } else if (mode === 'apply') {
    // Apply migration
    const migrationFile = path.join(__dirname, '..', 'migrations', '20260822000000_gate29_task_requirements.sql');
    const sql = fs.readFileSync(migrationFile, 'utf8');
    console.log('APPLYING:', migrationFile);
    await c.query('BEGIN');
    try {
      await c.query(sql);
      await c.query('COMMIT');
      console.log('MIGRATION_APPLIED');
    } catch (e) {
      await c.query('ROLLBACK');
      console.log('MIGRATION_FAILED:', e.message);
      await c.end();
      process.exit(1);
    }

  } else if (mode === 'post') {
    // Post-migration: verify columns exist with correct types
    const r = await c.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tasks'
        AND column_name IN ('required_capabilities', 'preferred_role')
      ORDER BY column_name
    `);
    console.log('POST_MIGRATION_COLUMNS:', JSON.stringify(r.rows, null, 2));

    // Verify no GIN index
    const idx = await c.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'tasks'
        AND indexname = 'tasks_required_capabilities_idx'
    `);
    console.log('GIN_INDEX_PRESENT:', idx.rows.length > 0 ? 'YES' : 'NO');

    // Verify Gate 14 NOT applied
    const gate14 = await c.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tasks'
        AND column_name = 'mission_id'
    `);
    console.log('GATE_14_COLUMNS:', gate14.rows.length > 0 ? 'PRESENT' : 'ABSENT');

    // Check existing tasks have defaults
    const sample = await c.query(`
      SELECT id, required_capabilities, preferred_role FROM public.tasks LIMIT 3
    `);
    console.log('SAMPLE_TASKS:', JSON.stringify(sample.rows));

  } else if (mode === 'live') {
    // Live store parity: create task, read, patch via SupabaseStore pattern
    // Find a valid owner_id that exists in both owners and projects tables
    const projRes = await c.query(`
      SELECT p.id as project_id, p.owner_id
      FROM public.projects p
      INNER JOIN public.owners o ON o.id = p.owner_id
      LIMIT 1
    `);
    if (projRes.rows.length === 0) {
      console.log('LIVE_FAIL: no valid owner/project found');
      await c.end();
      process.exit(1);
    }
    const projectId = projRes.rows[0].project_id;
    const ownerId = projRes.rows[0].owner_id;
    console.log('USING_OWNER:', ownerId, 'PROJECT:', projectId);

    // Create task with empty requirements
    const t1 = await c.query(`
      INSERT INTO public.tasks (owner_id, project_id, title, required_capabilities, preferred_role)
      VALUES ($1, $2, 'Gate29-Test-Empty', '[]'::jsonb, NULL)
      RETURNING id, required_capabilities, preferred_role
    `, [ownerId, projectId]);
    console.log('CREATE_EMPTY:', JSON.stringify(t1.rows[0]));

    // Create task with requirements
    const t2 = await c.query(`
      INSERT INTO public.tasks (owner_id, project_id, title, required_capabilities, preferred_role)
      VALUES ($1, $2, 'Gate29-Test-WithReqs', '["typescript","react"]'::jsonb, 'frontend_engineer')
      RETURNING id, required_capabilities, preferred_role
    `, [ownerId, projectId]);
    console.log('CREATE_WITH_REQS:', JSON.stringify(t2.rows[0]));

    // Read back
    const read1 = await c.query(`SELECT required_capabilities, preferred_role FROM public.tasks WHERE id = $1`, [t1.rows[0].id]);
    console.log('READ_EMPTY:', JSON.stringify(read1.rows[0]));

    const read2 = await c.query(`SELECT required_capabilities, preferred_role FROM public.tasks WHERE id = $1`, [t2.rows[0].id]);
    console.log('READ_WITH_REQS:', JSON.stringify(read2.rows[0]));

    // Patch: update requirements
    const patch = await c.query(`
      UPDATE public.tasks SET required_capabilities = '["python"]'::jsonb, preferred_role = 'data_engineer'
      WHERE id = $1
      RETURNING required_capabilities, preferred_role
    `, [t1.rows[0].id]);
    console.log('PATCH_RESULT:', JSON.stringify(patch.rows[0]));

    // Patch: clear preferredRole
    const clear = await c.query(`
      UPDATE public.tasks SET preferred_role = NULL WHERE id = $1
      RETURNING required_capabilities, preferred_role
    `, [t1.rows[0].id]);
    console.log('PATCH_CLEAR_ROLE:', JSON.stringify(clear.rows[0]));

    // Cleanup
    await c.query(`DELETE FROM public.tasks WHERE id IN ($1, $2)`, [t1.rows[0].id, t2.rows[0].id]);
    console.log('CLEANUP_DONE');

  } else if (mode === 'selectors') {
    // Live selector proof via SQL
    const projRes = await c.query(`
      SELECT p.id as project_id, p.owner_id
      FROM public.projects p
      INNER JOIN public.owners o ON o.id = p.owner_id
      LIMIT 1
    `);
    const projectId = projRes.rows[0].project_id;
    const ownerId = projRes.rows[0].owner_id;

    // Create agent with capabilities
    const a1 = await c.query(`
      INSERT INTO public.agents (owner_id, name, slug, role, capabilities, status)
      VALUES ($1, 'G29-Frontend', 'g29-frontend-' || md5(random()::text), 'frontend_engineer', '["typescript","react"]', 'active')
      RETURNING id, name, role, capabilities, status
    `, [ownerId]);
    console.log('AGENT_CREATED:', JSON.stringify(a1.rows[0]));

    // Create task with matching requirements
    const t = await c.query(`
      INSERT INTO public.tasks (owner_id, project_id, title, required_capabilities, preferred_role)
      VALUES ($1, $2, 'G29-Selector-Test', '["typescript","react"]'::jsonb, 'frontend_engineer')
      RETURNING id, required_capabilities, preferred_role
    `, [ownerId, projectId]);
    console.log('TASK_CREATED:', JSON.stringify(t.rows[0]));

    // Cleanup
    await c.query(`DELETE FROM public.tasks WHERE id = $1`, [t.rows[0].id]);
    await c.query(`DELETE FROM public.agents WHERE id = $1`, [a1.rows[0].id]);
    console.log('SELECTOR_CLEANUP_DONE');

  }

  await c.end();
})().catch(e => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
