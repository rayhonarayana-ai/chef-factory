# CHEF FACTORY — As-Built Operations Reference

**Status:** IMPLEMENTED | **Evidence:** config files  
**Last Verified:** 2026-08-16

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| Name | chef-factory |
| Version | 0.1.0 |
| Type | ESM (`"type": "module"`) |
| Runtime | Node.js ≥ 18 |
| Description | CHEF Personal Executive Core — Gate 1 (independent AI Company Factory) |
| TypeScript Target | ES2022 |
| TypeScript Module | NodeNext |

---

## 2. Dependencies

### Production

| Package | Version |
|---------|---------|
| @supabase/supabase-js | ^2.45.0 |
| bcryptjs | ^2.4.3 |
| pg | ^8.11.5 |

### Development

| Package | Version |
|---------|---------|
| @types/bcryptjs | ^2.4.6 |
| @types/node | ^20.14.0 |
| @types/pg | ^8.11.6 |
| tsx | ^4.16.0 |
| typescript | ^5.5.0 |
| vitest | ^1.6.0 |

---

## 3. NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `typecheck` | `tsc --noEmit` | Type-check without emitting output |
| `build` | `tsc -p tsconfig.build.json` | Compile TypeScript to `dist/` (production build, no declarations/sourcemaps) |
| `test` | `vitest run` | Run all tests (unit + integration) |
| `test:unit` | `vitest run src/core src/gateways` | Run unit tests only (core + gateways) |
| `test:integration` | `vitest run src/integration` | Run integration tests only |
| `start` | `node dist/api/server.js` | Start production server from compiled output |
| `dev` | `tsx src/api/server.ts` | Start development server (TypeScript direct execution) |
| `seed` | `tsx src/db/seed.ts` | Seed database with owner user, models, runtimes, and CHEF HQ project |

---

## 4. TypeScript Configuration

### tsconfig.json (Base)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts", "src/**/__tests__/**"]
}
```

### tsconfig.build.json (Production Build Override)

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "src/**/*.test.ts", "src/**/__tests__/**", "src/testing/**"],
  "compilerOptions": {
    "declaration": false,
    "sourceMap": false
  }
}
```

**Key differences from base:**
- Excludes `src/testing/**` directory
- Disables declaration files (`.d.ts`)
- Disables source maps

---

## 5. Environment Variables

### Required (asserted by `assertFactoryConfig`)

| Variable | Source | Purpose | Default |
|----------|--------|---------|---------|
| `FACTORY_SUPABASE_URL` | .env, process.env | Supabase project URL | — (required) |
| `FACTORY_SUPABASE_ANON_KEY` | .env, process.env | Supabase anonymous/public key | — (required) |
| `FACTORY_DB_PASSWORD` | .env, process.env | Database password for connection pool | — (required) |

### Optional Database Configuration

| Variable | Source | Purpose | Default |
|----------|--------|---------|---------|
| `FACTORY_DB_HOST` | .env, process.env | Database host | `aws-1-eu-west-1.pooler.supabase.com` |
| `FACTORY_DB_PORT` | .env, process.env | Database port | `5432` |
| `FACTORY_DB_USER` | .env, process.env | Database user | `postgres.<project-ref>` |
| `FACTORY_DB_NAME` | .env, process.env | Database name | `postgres` |
| `FACTORY_ENV_FILE` | process.env | Custom .env file path | `<cwd>/.env` |

### API Server Configuration

| Variable | Source | Purpose | Default |
|----------|--------|---------|---------|
| `FACTORY_API_PORT` | process.env | HTTP server port | `8787` |
| `FACTORY_API_HOST` | process.env | HTTP server bind address | `127.0.0.1` |

### Owner / Seed Configuration

| Variable | Source | Purpose | Default |
|----------|--------|---------|---------|
| `FACTORY_OWNER_EMAIL` | .env, process.env | Owner email for seed + auth | `null` |
| `FACTORY_OWNER_PASSWORD` | .env, process.env | Owner password for seed + auth | `null` |

### AI Provider API Keys

| Variable | Source | Purpose | Default |
|----------|--------|---------|---------|
| `FACTORY_OPENAI_API_KEY` | process.env | OpenAI API key | — (optional) |
| `FACTORY_ANTHROPIC_API_KEY` | process.env | Anthropic API key | — (optional) |
| `FACTORY_GOOGLE_API_KEY` | process.env | Google AI API key | — (optional) |

### Runtime / OpenCode Configuration

| Variable | Source | Purpose | Default |
|----------|--------|---------|---------|
| `FACTORY_OPENCODE_CLI` | process.env | Path to OpenCode CLI binary | — (optional) |
| `FACTORY_OPENCODE_ENABLED` | process.env | Enable OpenCode Zen runtime | `"false"` |

### Live Verification

| Variable | Source | Purpose | Default |
|----------|--------|---------|---------|
| `FACTORY_SERVICE_ROLE_KEY` | process.env | Supabase service role key for admin API operations | — (required for live verification only) |

---

## 6. Scripts Inventory

### scripts/live-http-verification.ts

| Field | Value |
|-------|-------|
| **File** | `scripts/live-http-verification.ts` |
| **Purpose** | Gate 2 closure — LIVE HTTP VERIFICATION RUNNER |
| **What it does** | Creates a disposable user via Supabase admin API, authenticates, boots the real server, and runs 9 security/integration tests over HTTP |
| **How to run** | `npx tsx scripts/live-http-verification.ts` |
| **Requires** | `FACTORY_SERVICE_ROLE_KEY` must be present in process environment |
| **Self-blocks** | Yes — exits early if key is absent |

**Tests performed (T1-T9):**
1. T1 — HTTP → Auth → Owner Resolution (GET /api/me)
2. T2 — Create project (RLS write as owner)
3. T3 — Authorized safe action reaches execution decision
4. T4 — Critical action (financial) requires approval
5. T5 — Fail-closed for unknown scope (deny-by-default)
6. T6 — Lockdown fail-closed over HTTP
7. T7 — Security event persistence
8. T8 — Retry protection (bounded attempts)
9. T9 — Project isolation (RLS enforcement)

**Cleanup:** Deletes disposable user and owner-scoped rows after execution.

---

## 7. Vitest Configuration

**File:** `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/integration/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
```

| Setting | Value |
|---------|-------|
| Test environment | Node.js |
| Test timeout | 60 seconds |
| Hook timeout | 60 seconds |
| Test patterns | `src/**/*.test.ts`, `src/integration/**/*.integration.test.ts` |

**Test categories:**
- **Unit tests:** `src/core/**/*.test.ts`, `src/gateways/**/*.test.ts`
- **Integration tests:** `src/integration/**/*.integration.test.ts` (guarded by env vars)

---

## 8. File Structure

```
chef-factory/
├── .env                          # Secrets (git-ignored)
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── todo.md
├── dist/                         # Compiled output (git-ignored)
├── node_modules/
├── public/                       # Static UI files (served by API)
├── scripts/
│   └── live-http-verification.ts
├── src/
│   ├── api/                      # HTTP server + handlers
│   │   ├── server.ts             # Main server (minimal, no framework)
│   │   ├── handlers.ts           # API route handlers
│   │   ├── auth.ts               # Authentication service
│   │   ├── security.ts           # Security guardian
│   │   ├── execution.ts          # Execution runner
│   │   ├── redact.ts             # Secret redaction
│   │   ├── auth.test.ts
│   │   ├── security.test.ts
│   │   └── execution.test.ts
│   ├── core/                     # Business logic
│   │   ├── types.ts              # Core type definitions
│   │   ├── pipeline.ts           # Command pipeline
│   │   ├── taskEngine.ts         # Task execution engine
│   │   ├── intent.ts             # Intent parsing
│   │   ├── authority.ts          # Authority matrix
│   │   ├── autonomy.ts           # Autonomy levels
│   │   ├── approval.ts           # Approval workflow
│   │   ├── cost.ts (implied)     # Cost tracking
│   │   ├── decisionJournal.ts    # Decision logging
│   │   ├── explanation.ts        # Explanation engine
│   │   ├── monitoring.ts         # Monitoring
│   │   ├── passport.ts           # Passport field definitions
│   │   ├── ports.ts              # Port definitions
│   │   ├── pos.ts                # POS (point of sale)
│   │   ├── redact.ts             # Redaction logic
│   │   ├── security/             # Security subsystem
│   │   │   ├── guardian.ts
│   │   │   ├── policyEngine.ts
│   │   │   ├── riskEngine.ts
│   │   │   ├── rateLimit.ts
│   │   │   ├── lockdown.ts
│   │   │   ├── incidents.ts
│   │   │   ├── events.ts
│   │   │   ├── health.ts
│   │   │   ├── anomaly.ts
│   │   │   ├── costProtection.ts
│   │   │   ├── criticalActions.ts
│   │   │   ├── promptInjection.ts
│   │   │   ├── secretGuard.ts
│   │   │   ├── types.ts
│   │   │   └── securityGuardian.test.ts
│   │   └── *.test.ts             # Unit tests for core modules
│   ├── db/                       # Database layer
│   │   ├── config.ts             # Environment configuration loader
│   │   ├── pool.ts               # Postgres connection pool
│   │   ├── repo.ts               # Data repository (SupabaseStore)
│   │   └── seed.ts               # Database seeder
│   ├── gateways/                 # External service gateways
│   │   ├── modelGateway.ts       # AI model gateway
│   │   ├── runtimeGateway.ts     # Runtime gateway
│   │   ├── toolBroker.ts         # Tool broker
│   │   ├── secretProvider.ts     # Secret provider
│   │   ├── memoryGateway.ts      # Memory gateway (ChromaDB not present)
│   │   ├── providerAdapter.ts    # Provider adapter interface
│   │   ├── adapters/             # AI provider adapters
│   │   │   ├── openai.ts
│   │   │   ├── anthropic.ts
│   │   │   ├── google.ts
│   │   │   └── opencodeZen.ts
│   │   └── *.test.ts             # Unit tests for gateways
│   ├── integration/              # Integration tests
│   │   ├── live.integration.test.ts
│   │   ├── security.live.integration.test.ts
│   │   └── security.api.integration.test.ts
│   └── testing/                  # Test utilities (excluded from build)
│       └── memoryStore.ts
├── supabase/
│   ├── config.toml
│   ├── .temp/
│   ├── migrations/
│   └── tests/
└── docs/
    └── factory/                  # Documentation (41 files)
        ├── as-built/             # As-built documentation
        └── *.md                  # Architecture, gates, audit docs
```

---

## 9. Build Process

### How to Build

```bash
npm run build
```

This executes `tsc -p tsconfig.build.json`.

### What tsc Produces

- **Output directory:** `dist/`
- **Source:** `src/**/*.ts` (excluding tests, test utilities)
- **Declarations:** No (disabled in tsconfig.build.json)
- **Source maps:** No (disabled in tsconfig.build.json)

### Production Entry Point

```bash
npm start
# Executes: node dist/api/server.js
```

### Development Entry Point

```bash
npm run dev
# Executes: tsx src/api/server.ts
```

---

## 10. Development Workflow

### Start Development Server

```bash
npm run dev
```

Server binds to `127.0.0.1:8787` by default. Configurable via `FACTORY_API_PORT` and `FACTORY_API_HOST`.

### Run All Tests

```bash
npm test
```

### Run Unit Tests Only

```bash
npm run test:unit
```

### Run Integration Tests Only

```bash
npm run test:integration
```

### Type Check Without Emitting

```bash
npm run typecheck
```

### Seed Database

```bash
npm run seed
```

Creates owner user (if `FACTORY_OWNER_EMAIL` + `FACTORY_OWNER_PASSWORD` set), default model registry (6 models), runtime registry (1 runtime), and CHEF HQ project. Idempotent.

### Run Live HTTP Verification

```bash
FACTORY_SERVICE_ROLE_KEY=<key> npx tsx scripts/live-http-verification.ts
```

Requires `FACTORY_SERVICE_ROLE_KEY` in environment. Self-blocks if absent.

---

## 11. .gitignore

```gitignore
# Secrets — never commit
.env
.env.*
!.env.example

# Node
node_modules/

# Logs & OS
*.log
.DS_Store
Thumbs.db
```

**Notes:**
- All `.env` files are ignored except `.env.example`
- `dist/` is NOT in .gitignore (may need explicit handling)
- `node_modules/` is ignored
- OS-specific files are ignored

---

## 12. Known Operational Gaps

| Gap | Status | Impact |
|-----|--------|--------|
| `FACTORY_SERVICE_ROLE_KEY` not in .env | **BLOCKED** | Live HTTP verification cannot run |
| Supabase CLI not installed | **UNVERIFIED** | Cannot run `supabase` commands locally |
| No `.env.example` file | **NOT_APPLICABLE** | .gitignore references but file not present |
| `dist/` not in .gitignore | **UNVERIFIED** | Compiled output may be committed |
| No README.md | **NOT_APPLICABLE** | Project documentation lives in `docs/factory/` |
| No NODE_ENV configuration | **DEFERRED** | Server runs without explicit NODE_ENV setting |
| No PORT variable (uses FACTORY_API_PORT) | **DEFERRED** | Non-standard naming, but functional |
| Memory backend (ChromaDB) not present | **IMPLEMENTED** | memoryGateway reports `configured: false` |

---

## Appendix A: API Endpoints

**Status:** IMPLEMENTED | **Evidence:** `src/api/server.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (public) |
| GET | `/api/config` | Client bootstrap config (public) |
| GET | `/api/me` | Owner profile (authenticated) |
| POST | `/api/chat` | Command/chat interface |
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/passports/:projectId` | Get project passport |
| PUT | `/api/passports/:projectId` | Update project passport |
| GET | `/api/agents` | List agents |
| GET | `/api/tasks` | List tasks |
| GET | `/api/approvals` | List pending approvals |
| POST | `/api/approvals/:approvalId/decision` | Approve/reject task |
| GET | `/api/costs` | Cost summary |
| GET | `/api/audit` | Audit log |
| GET | `/api/status` | Daily status |
| GET | `/api/prefs` | Get preferences |
| PUT | `/api/prefs` | Update preferences |
| GET | `/api/models` | List registered models |
| GET | `/api/runtimes` | List registered runtimes |
| GET | `/api/decisions` | Decision journal |
| GET | `/api/security/health` | Security health check |
| GET | `/api/security/events` | Security events |
| GET | `/api/security/incidents` | Security incidents |
| POST | `/api/security/incidents` | Report incident |
| GET | `/api/security/critical-actions` | Critical action registry |
| GET | `/api/security/lockdown` | Lockdown status |
| POST | `/api/security/lockdown` | Activate lockdown |
| POST | `/api/security/lockdown/release` | Release lockdown |

---

## Appendix B: Seeded Data

**Status:** IMPLEMENTED | **Evidence:** `src/db/seed.ts`

### Models (6 entries)

| Provider | Name | Slug | Reasoning | Context | Cost (in/out per 1k) |
|----------|------|------|-----------|---------|---------------------|
| openai | gpt-4o-mini | gpt-4o-mini | low | 128,000 | $0.15 / $0.60 |
| openai | gpt-4o | gpt-4o | medium | 128,000 | $2.50 / $10.00 |
| anthropic | claude-3-5-haiku | claude-3-5-haiku | low | 200,000 | $0.80 / $4.00 |
| anthropic | claude-3-5-sonnet | claude-3-5-sonnet | high | 200,000 | $3.00 / $15.00 |
| google | gemini-1.5-flash | gemini-1.5-flash | low | 1,048,576 | $0.075 / $0.30 |
| google | gemini-1.5-pro | gemini-1.5-pro | high | 2,097,152 | $1.25 / $5.00 |

### Runtimes (1 entry)

| Name | Version | Slug | Capabilities | Cost/Hour |
|------|---------|------|--------------|-----------|
| opencode-zen | 0.1 | opencode-zen | code, shell | $0.00 |

### Projects (1 entry)

| Name | Slug | Description |
|------|------|-------------|
| CHEF HQ | chef-hq | Factory control project |

---

## Appendix C: Database Configuration

**Status:** IMPLEMENTED | **Evidence:** `src/db/pool.ts`

```typescript
{
  host: cfg.dbHost,           // Default: aws-1-eu-west-1.pooler.supabase.com
  port: cfg.dbPort,           // Default: 5432
  user: cfg.dbUser,           // Default: postgres.<project-ref>
  password: cfg.dbPassword,
  database: cfg.dbName,       // Default: postgres
  max: 5,                     // Connection pool size
  connectionTimeoutMillis: 30000,
  ssl: { rejectUnauthorized: false }
}
```

**Connection pool:** Singleton pattern via `getPool()`. Closed via `closePool()`.

---

*Document generated from as-built source files. All claims verified against config files and source code as of 2026-08-16.*
