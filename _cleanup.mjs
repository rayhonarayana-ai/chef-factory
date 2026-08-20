import { Pool } from 'pg';

const pool = new Pool({
  host: 'aws-1-eu-west-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.dybyidtcyzgliupzzfhl',
  password: 'fiktxnPhUVNMA8jr2cqO4SDHJvQp',
  ssl: { rejectUnauthorized: false },
});

const r = await pool.query(
  "UPDATE auth.users SET email_confirmed_at = now() WHERE email = 'rayhonarayana40@gmail.com'"
);
console.log('Confirmed:', r.rowCount, 'row(s)');

const r2 = await pool.query(
  "INSERT INTO public.owners (id, email, status) VALUES ('df32f0a1-162e-4477-9d14-a78abdf36679', 'rayhonarayana40@gmail.com', 'active') ON CONFLICT DO NOTHING"
);
console.log('Owner row:', r2.rowCount, 'row(s)');

await pool.end();
