# Token Dashboard

Multi-source internal dashboard for tracking **AI token usage**, **costs**, **adoption metrics**, and **simple forecasting** across Cursor, OpenAI, and Azure AI Foundry.

Built with Next.js 16 (App Router), React 19, Drizzle ORM, and PostgreSQL.

## Features

- **Unified rollup** — Global overview that aggregates metrics across all connected platforms.
- **Per-platform dashboards** — Dedicated views for Cursor, OpenAI API, OpenAI Enterprise, and Azure, each with Overview, Activity, Cost, People, and Forecast tabs.
- **Azure usage explorer** — Filter by app (billing group) and model to see token and request breakdowns.
- **Forecasting** — Linear-trend projections with configurable budget thresholds on every platform.
- **Incremental sync** — Each connector picks up where the last successful run left off (watermark-based) with a safety overlap, so syncs stay fast and historical data is preserved.
- **CSV import** — Bulk import OpenAI Enterprise data (projects, GPTs, users, credits) from CSV files.
- **Budget & seat tracking** — Contract budgets, seat counts, and per-seat cost modeling per source.
- **Settings by service** — Standalone settings page organized per platform for sync triggers, budgets, and seat config.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16, React 19, TypeScript |
| Database | PostgreSQL (via Docker), Drizzle ORM |
| Styling | Tailwind CSS v4, Radix UI, shadcn/ui components |
| Charts | Recharts |
| Tables | TanStack React Table |
| Validation | Zod |
| Testing | Vitest |

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for local Postgres)
- Azure CLI (`az`) if connecting to Azure AI resources

### Setup

```bash
# 1. Clone and install
git clone https://github.com/TonyLorino/Token-Dashboard.git
cd Token-Dashboard
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your API keys — see "Environment Variables" below

# 3. Start Postgres
docker compose up -d

# 4. Apply the database schema
npm run db:push

# 5. Load demo data OR sync from live APIs
npm run db:seed          # synthetic demo data
npm run sync:cursor      # requires CURSOR_ADMIN_API_KEY
npm run sync:azure       # requires az login + AZURE_RESOURCES

# 6. Run the app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Copy `.env.example` to `.env` and fill in the values you need. All API keys are optional — enable only the connectors you use.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `CURSOR_ADMIN_API_KEY` | For Cursor sync | Read-only Enterprise Admin key |
| `CURSOR_SYNC_LOOKBACK_DAYS` | No | Days of history to fetch (default 730, max 3650) |
| `CURSOR_ANALYTICS_LOOKBACK` | No | Force analytics window (e.g. `365d`) |
| `OPENAI_ADMIN_API_KEY` | For OpenAI sync | Org admin key from Settings > Admin keys |
| `OPENAI_ORG_ID` | For OpenAI sync | Organization ID |
| `OPENAI_SYNC_LOOKBACK_DAYS` | No | Days of history to fetch (default 90, max 180) |
| `AZURE_RESOURCES` | For Azure sync | JSON array of subscription/resource-group/account objects |
| `AZURE_SYNC_LOOKBACK_DAYS` | No | Days of history on first sync (default 90) |
| `CRON_SECRET` | No | Shared secret to protect `/api/sync/*` endpoints |

Azure sync authenticates via the Azure CLI (`az login`), not an API key in `.env`.

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm test` | Run unit tests (Vitest) |
| `npm run db:push` | Push Drizzle schema to Postgres |
| `npm run db:generate` | Generate SQL migrations from schema changes |
| `npm run db:migrate` | Run generated migrations |
| `npm run db:seed` | Insert synthetic demo data |
| `npm run sync:cursor` | Sync from Cursor Enterprise API |
| `npm run sync:azure` | Sync from Azure AI Foundry |

Additional scripts in `scripts/` can be run with `npx tsx scripts/<name>.ts`:

- `sync-openai.ts` — Sync from OpenAI Admin API
- `import-csv.ts` — Import usage facts from CSV
- `seed-enterprise-csv.ts` — Seed OpenAI Enterprise data from CSV
- `backfill-billing-groups.ts` — Backfill billing group names

## API Endpoints

### Sync (POST)

| Endpoint | Description |
|----------|-------------|
| `/api/sync/cursor` | Trigger Cursor data sync |
| `/api/sync/openai` | Trigger OpenAI data sync |
| `/api/sync/azure` | Trigger Azure data sync |

Protected by `CRON_SECRET` when set (pass via `x-cron-secret` header).

### Metrics (GET)

| Endpoint | Description |
|----------|-------------|
| `/api/metrics/summary` | KPI summary (tokens, requests, cost, etc.) |
| `/api/metrics/timeseries` | Daily time-series data |
| `/api/metrics/global-timeseries` | Cross-platform aggregated time-series |
| `/api/metrics/ranked?dimension=member\|model` | Top members or models |
| `/api/metrics/forecast` | Linear-trend forecast |
| `/api/metrics/activity` | Detailed activity breakdown |
| `/api/metrics/adoption` | Adoption metrics (DAU/WAU, tabs, agent edits) |
| `/api/metrics/tooling` | Tooling metrics |
| `/api/metrics/billing-groups` | Billing group usage |
| `/api/metrics/budget` | Budget configuration |
| `/api/metrics/credits-by-type` | Credits breakdown |
| `/api/metrics/monthly-allocation` | Monthly allocation data |
| `/api/metrics/azure-dimensions` | Distinct Azure apps and models for filters |
| `/api/metrics/azure-breakdown` | Azure usage grouped by app and model |

All metrics endpoints accept `source`, `from`, `to`, `model`, `memberId`, and `billingGroup` query parameters.

### Settings (GET/POST)

| Endpoint | Description |
|----------|-------------|
| `/api/settings/budget` | Contract budget per source |
| `/api/settings/seats` | Seat pricing configuration |
| `/api/settings/enterprise-projects` | OpenAI Enterprise projects |
| `/api/settings/enterprise-gpts` | OpenAI Enterprise GPTs |
| `/api/settings/enterprise-users` | OpenAI Enterprise users |

### Import (POST)

| Endpoint | Description |
|----------|-------------|
| `/api/import/openai-enterprise/projects` | Import projects from CSV |
| `/api/import/openai-enterprise/gpts` | Import GPTs from CSV |
| `/api/import/openai-enterprise/users` | Import users from CSV |
| `/api/import/openai-enterprise/credits` | Import credits from CSV |

## Security

- **Never commit `.env`** — it is gitignored by default.
- All API keys should be read-only where possible.
- Sync endpoints can be secured with `CRON_SECRET`.
- Azure uses CLI-based auth (`az login`) scoped to the logged-in identity's RBAC permissions.
- Database credentials in `docker-compose.yml` and `.env.example` are local dev defaults only.

## License

Private — internal use only.
