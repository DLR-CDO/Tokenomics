# OpenAI Enterprise (planned connector)

This dashboard is designed around a shared `usage_facts` table keyed by `source_system`.

## Goal

Pull organization-level **usage** and **cost** series from OpenAI Enterprise admin APIs into the same filters and charts used for Cursor.

## Suggested integration notes

- **Authentication**: store an OpenAI **admin** key in your secret manager as `OPENAI_ADMIN_API_KEY` (example name only).
- **Idempotency**: choose stable `external_id` values per endpoint row (for example include bucket timestamps and dimensions you group by).
- **Provenance**: keep raw breakdown fields in `dimensions_json` when they are helpful for finance audits.
- **Cross-source filters**: the UI already supports `source=openai` once data exists; user identity joins across Cursor and OpenAI should remain optional and explicit.

## Implementation sketch

1. Add `src/server/openai-client.ts` (HTTP wrapper).
2. Add `src/server/openai-sync.ts` to normalize into `usage_facts` (`source_system = 'openai'`).
3. Extend `POST /api/sync/openai` mirroring `POST /api/sync/cursor`.
4. Add connector tests for normalization and idempotent upserts.
