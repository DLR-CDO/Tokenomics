# Token Dashboard

Multi-source internal dashboard for tracking **AI token usage**, **costs**, **adoption metrics**, and **simple forecasting** across Cursor, OpenAI, Anthropic Claude, and Azure AI Foundry.

Built with Next.js 16 (App Router), React 19, Drizzle ORM, and PostgreSQL.

## Features

- **Unified rollup** — Global overview that aggregates metrics across all connected platforms.
- **Per-platform dashboards** — Dedicated views for Cursor, OpenAI API, OpenAI Enterprise, Claude Enterprise, and Azure, each with Overview, Activity, Cost (where applicable), People, and Forecast tabs. Claude Enterprise adds Projects, Skills, and Connectors tabs.
- **Azure usage explorer** — Filter by app (billing group) and model to see token and request breakdowns.
- **Forecasting** — Linear-trend projections with configurable budget thresholds on every platform.
- **Incremental sync** — Each connector picks up where the last successful run left off (watermark-based) with a safety overlap, so syncs stay fast and historical data is preserved.
- **CSV import** — Bulk import OpenAI Enterprise data (projects, GPTs, users, credits) from CSV files.
- **Budget & seat tracking** — Contract budgets, seat counts, and per-seat cost modeling per source.
- **OpenAI list-rate pricing** — Per-model rates loaded from the OpenAI pricing page via a paste box (the page&apos;s "Copy Page" button), with admin overrides. A parallel list-rate cost series is shown alongside OpenAI&apos;s billed cost so drift is visible.
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
| `CLAUDE_ANALYTICS_API_KEY` | For Claude Enterprise sync | Enterprise Analytics key minted at `claude.ai/analytics/api-keys` |
| `CLAUDE_ANALYTICS_LOOKBACK_DAYS` | No | Days of Analytics API history to fetch (default 90, max 90 — Anthropic only retains 90 days; also clamped to ≥ 2026-01-01) |
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
| `npm run sync:claude-enterprise` | Sync from Claude Enterprise Analytics API (chat, cowork, office, skills, connectors, Claude Code productivity) |

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
| `/api/sync/claude-enterprise` | Trigger Claude Enterprise Analytics sync |
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
| `/api/metrics/openai-list-rate-cost` | Synthetic list-rate cost timeseries and per-model rollup for OpenAI |
| `/api/metrics/claude-enterprise-totals` | Window totals (commits, PRs, lines, sessions) for Claude Enterprise |
| `/api/metrics/claude-enterprise-groups?mode=chat_project\|skill\|connector` | Per-group rollup for Claude Enterprise Analytics |

All metrics endpoints accept `source`, `from`, `to`, `model`, `memberId`, and `billingGroup` query parameters.

### Settings (GET/POST)

| Endpoint | Description |
|----------|-------------|
| `/api/settings/budget` | Contract budget per source |
| `/api/settings/seats` | Seat pricing configuration |
| `/api/settings/enterprise-projects` | OpenAI Enterprise projects |
| `/api/settings/enterprise-gpts` | OpenAI Enterprise GPTs |
| `/api/settings/enterprise-users` | OpenAI Enterprise users |
| `/api/settings/openai-pricing` | OpenAI list-rate pricing reference (`GET` returns upstream + overrides + effective; `PUT` accepts `{ source?, overrides? }` — `source` is the pasted MDX, `overrides` is the array of admin overrides) |

### Import (POST)

| Endpoint | Description |
|----------|-------------|
| `/api/import/openai-enterprise/projects` | Import projects from CSV |
| `/api/import/openai-enterprise/gpts` | Import GPTs from CSV |
| `/api/import/openai-enterprise/users` | Import users from CSV |
| `/api/import/openai-enterprise/credits` | Import credits from CSV |

## OpenAI Pricing Reference

OpenAI bills per use, so the OpenAI API tab does not have a contract budget. Instead the dashboard keeps a per-model
list-rate sheet that is loaded from
[developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing) by paste:

1. Open the upstream pricing page in a browser.
2. Click the **Copy Page** button (top-left under the heading).
3. On the OpenAI API settings page in this dashboard, click **Paste new source**, paste the entire output into the
   textarea, then click **Parse & save**.

The parser understands the MDX structure used by the page (`<TextTokenPricingTables />`, `<GroupedPricingTable />`,
`<PricingTable />`) and extracts every row, including long-context columns, modality breakdowns, fine-tune training
$/hour, embeddings, moderation, web-search/file-search/containers, and per-second video pricing.

- **Upstream rates** are stored under the `openai_pricing_upstream` key in `dashboard_settings` (JSONB) along with
  the original MDX paste and a `parsedAt` timestamp. The UI surfaces the timestamp so staleness is obvious.
- **Admin overrides** are stored separately under `openai_pricing_overrides`. Overrides survive future re-parses and
  win over upstream values when they differ.
- **List-rate cost** is computed as
  `uncachedIn * inputUsdPerMtok / 1M + cached * cachedInputUsdPerMtok / 1M + tokensOut * outputUsdPerMtok / 1M`,
  where `cached` is read from `dimensions_json->>'cached_tokens'` on `tokens_in` rows.
- **Caveats:** image, audio, video, tools, and storage rows are surfaced in the rate table for reference but are not
  part of the list-rate cost calculation (we do not have per-second / per-GB-day usage in `usage_facts`). Tier and
  context default to Standard / short — change a row via the override UI to model batch/flex/priority or long-context
  pricing. OpenAI&apos;s organization cost API does not break out billed cost by model, so the list-rate column on
  the model table is shown without a billed counterpart.
- **Parser fragility:** if a future MDX restructure breaks the parser, the previous good rows are preserved and a
  `parse_error` badge is shown on the settings page along with the upstream error message.

## Claude Enterprise Integration Notes

`source = "claude_enterprise"` — seat-based contract. All metrics come from the Enterprise Analytics API
(`api.anthropic.com/v1/organizations/analytics/*`):

- **Engagement** (chat, cowork, office, skills, connectors) from the per-day endpoints.
- **Claude Code productivity** (commits, PRs, lines added/removed, sessions, edit accept/reject) is read directly
  from the per-user `claude_code_metrics` field on `/analytics/users` — no Admin key required.
- **DAU / WAU / MAU + assigned-seat counts** from `/analytics/summaries`.

No per-message cost is written. The "covered value" on the executive card is derived from the annual seat
contract configured in Settings → Claude Enterprise.

Caveats:

- Analytics API data only exists on/after **2026-01-01** and retains only the **last 90 days**.
- All Analytics values are **≥ 3 days old** — the API does not expose current-day numbers (returns HTTP 400).
- Analytics keys require a Primary Owner and the `read:analytics` scope.
- Claude Code usage routed via **Amazon Bedrock** is invisible to the Analytics API.
- The `/summaries` endpoint uses a `{summaries: [...]}` envelope (not `{data: [...]}`) and does not paginate;
  per-day endpoints use `{data, next_page}` and have **no `has_more` field**.
- Default rate limit is 60 rpm; the sync throttles automatically.

## Security

- **Never commit `.env`** — it is gitignored by default.
- All API keys should be read-only where possible.
- Sync endpoints can be secured with `CRON_SECRET`.
- Azure uses CLI-based auth (`az login`) scoped to the logged-in identity's RBAC permissions.
- Database credentials in `docker-compose.yml` and `.env.example` are local dev defaults only.

## License

Private — internal use only.
