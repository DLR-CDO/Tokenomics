# Architecture

## Overview

Token Dashboard is a Next.js App Router application that ingests AI usage data from multiple platforms, stores it in a normalized PostgreSQL schema, and presents it through a multi-tenant dashboard UI.

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (React 19)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │  Global   │ │  Cursor  │ │  OpenAI  │ │  Azure   │  ...  │
│  │ Overview  │ │ Activity │ │   Cost   │ │  Usage   │       │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │
│       └─────────────┴────────────┴────────────┘             │
│                         │ fetch                             │
└─────────────────────────┼───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Next.js API Routes (GET/POST)              │
│   /api/metrics/*   /api/sync/*   /api/settings/*            │
│   /api/import/openai-enterprise/*                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  Cursor  │ │  OpenAI  │ │  Azure   │
        │   Sync   │ │   Sync   │ │   Sync   │
        │ Engine   │ │ Engine   │ │ Engine   │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │            │
             └─────────────┼────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              PostgreSQL (Drizzle ORM)                        │
│  usage_facts │ dim_member │ dim_model │ connector_runs │ ... │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── app/                          # Next.js App Router
│   ├── (dashboard)/              # Dashboard route group (shared layout with nav + filters)
│   │   ├── global/               # Cross-platform rollup pages
│   │   ├── cursor/               # Cursor-specific pages
│   │   ├── openai-api/           # OpenAI API pages
│   │   ├── openai-enterprise/    # OpenAI Enterprise pages
│   │   └── azure/                # Azure AI Foundry pages
│   ├── settings/                 # Standalone settings (no dashboard layout)
│   │   ├── cursor/
│   │   ├── openai-api/
│   │   ├── openai-enterprise/
│   │   └── azure/
│   └── api/                      # API routes
│       ├── metrics/              # Read-only metric queries
│       ├── sync/                 # Sync triggers (Cursor, OpenAI, Azure)
│       ├── settings/             # Dashboard config (budgets, seats)
│       └── import/               # CSV import for OpenAI Enterprise
├── components/
│   ├── dashboard/                # Page-level client components
│   └── ui/                       # Shared UI primitives (shadcn/ui)
├── db/
│   └── schema.ts                 # Drizzle schema definition
├── lib/
│   ├── db.ts                     # Database connection singleton
│   ├── filters.ts                # Query parameter parsing (Zod)
│   └── utils.ts                  # Shared helpers
└── server/
    ├── metrics.ts                # Metric query functions
    ├── cursor-sync.ts            # Cursor sync engine
    ├── openai-sync.ts            # OpenAI sync engine
    ├── azure-sync.ts             # Azure sync engine
    ├── sync-utils.ts             # Incremental sync utilities
    ├── *-client.ts               # API client wrappers
    └── *-config.ts               # Per-source configuration

scripts/                          # CLI utilities (sync, seed, import)
drizzle/                          # Generated SQL migrations
```

## Database Schema

The schema follows a star-schema-like pattern with a central `usage_facts` table:

### Tables

**`usage_facts`** — Central fact table. Every metric from every source lands here as a row with:
- `source_system` — Enum: `cursor`, `openai`, `azure`, `openai_enterprise`
- `metric_kind` — Enum: `tokens_in`, `tokens_out`, `requests`, `cost_usd`, `credits`, `dau`, `wau`, `lines_added`, `lines_deleted`, `tabs_shown`, `tabs_accepted`, `tabs_rejected`, `agent_edits_accepted`, `agent_edits_rejected`
- `amount` — The numeric value
- `occurred_at` — Timestamp of the measurement
- `external_id` — Source-specific unique key (idempotent upserts via unique index)
- Optional foreign keys to `dim_member` and `dim_model`
- Optional `billing_group_id` / `billing_group_name` for Azure resource grouping

**`dim_member`** — User/member dimension, keyed by `(source_system, external_key)`.

**`dim_model`** — Model/deployment dimension, keyed by `(source_system, external_key)`.

**`billing_cycles`** — Billing windows per source for period-aware aggregation.

**`connector_runs`** — Audit log of every sync run: status, duration, rows upserted, watermark, and error details.

**`dashboard_settings`** — Key-value store for runtime configuration (budgets, seat pricing).

### Idempotency

All sync engines use `ON CONFLICT DO UPDATE` on the `(source_system, external_id)` unique index. Re-running a sync is always safe — overlapping data is merged, not duplicated.

## Sync Architecture

### Incremental Strategy

Each connector follows the same pattern:

1. Check `connector_runs` for the last successful run's `watermark_at` timestamp.
2. If found, start fetching from `watermark_at - 2 days` (safety overlap).
3. If not found (first run), use the configured full lookback window.
4. On success, record the current timestamp as the new `watermark_at`.

This is implemented in `src/server/sync-utils.ts` and used by all three sync engines.

### Connector Details

**Cursor** (`cursor-sync.ts`)
- Authenticates with `CURSOR_ADMIN_API_KEY`
- Fetches daily usage, filtered usage events, and analytics data
- Walks API in ≤30-day chunks for large lookback windows
- Ingests: tokens, requests, credits, DAU/WAU, line edits, tab metrics, agent edits

**OpenAI** (`openai-sync.ts`)
- Authenticates with `OPENAI_ADMIN_API_KEY` + `OPENAI_ORG_ID`
- Fetches usage buckets and cost data via the Admin API
- Ingests: tokens in/out, requests, cost (USD)

**Azure** (`azure-sync.ts`)
- Authenticates via Azure CLI (`az account get-access-token`)
- Reads resource list from `AZURE_RESOURCES` env var (JSON)
- Queries Azure Monitor metrics API for each resource
- Uses universal metric names (`InputTokens`, `OutputTokens`) to support all model providers (OpenAI, Anthropic, etc.)
- Queries Azure Cost Management for resource-level cost data
- Ingests: tokens in/out, requests, cost (USD)

## Frontend Architecture

### Routing

The App Router uses two layout boundaries:

- **`(dashboard)/`** — Shared layout with platform selector (Global, Cursor, OpenAI API, OpenAI Enterprise, Azure), secondary tab navigation, and a global date range filter.
- **`settings/`** — Standalone layout with a back-to-dashboard link and service-organized navigation. No date filter or platform tabs.

### Client Components

Each dashboard page has a corresponding `*-client.tsx` file in `src/components/dashboard/` that:
1. Reads URL search params for the current filter state
2. Fetches data from API routes via `fetch()`
3. Renders KPI cards, time-series charts, bar charts, and data tables

### Shared UI

All UI primitives live in `src/components/ui/` (shadcn/ui pattern). Dashboard-specific reusable components (like `KpiGrid`, `TimeseriesChart`, `HorizontalBarChart`, `DataTable`) are in `src/components/dashboard/`.

## Data Flow

```
External API ──► Sync Engine ──► usage_facts (upsert)
                                       │
                                       ▼
                              API Route (query)
                                       │
                                       ▼
                              Client Component (render)
```

All queries go through `src/server/metrics.ts`, which applies filters (date range, source, model, member, billing group) via a shared `baseConditions()` function, ensuring consistent filtering across all endpoints.
