# Architecture

> Living doc — see [README.md](README.md). Change the design, change this file.

## The shape

Two Postgres schemas in one Supabase project, plus a Next.js prototype that
talks to them.

```
  resident / hub / community group
              │
              │  form, or POST /api/reports
              ▼
   ┌────────────────────────┐
   │  gold.submit_report()  │   SECURITY DEFINER — the only write path in
   └───────────┬────────────┘
               │ inserts downward
               ▼
   ┌──────────────────────────────────────────────┐
   │  silver          PRIVATE, full fidelity      │
   │  exact coordinates, contact details,         │
   │  raw text, append-only status events         │
   └───────────┬──────────────────────────────────┘
               │ filtered projection (views)
               ▼
   ┌──────────────────────────────────────────────┐
   │  gold            PUBLIC contract             │
   │  PII removed, coordinates fuzzed,            │
   │  verification + synthetic state explicit     │
   └───────────┬──────────────────────────────────┘
               │
     ┌─────────┴──────────┬─────────────────┐
     ▼                    ▼                 ▼
  our map/app       WCC console      the other nine teams
                    (service role)   (GeoJSON, no schema knowledge needed)
```

## Why two tiers

The problem statement asks for two things that pull against each other: WCC
needs enough local detail to act on, and the same information has to be publicly
visible enough for a community to see their report was received.

Splitting the two is what lets both be true. `silver` keeps everything a duty
officer would want. `gold` is a projection with the identifying parts removed,
and it is the only thing anything outside the database can read.

## Why the containment is structural

`silver` is **not listed in `supabase/config.toml`'s `[api] schemas`**. PostgREST
only serves schemas on that list, so there is no URL that reaches silver — not a
misconfigured one, not one behind a policy that turns out to be wrong.

Three layers, in order of how much they matter:

1. **Not exposed.** `schemas = ["public", "graphql_public", "gold"]`. This is the
   one doing the real work.
2. **Not granted.** `revoke all on schema silver from anon, authenticated,
   public`, and the same for its tables, sequences and functions, including
   default privileges for anything added later.
3. **RLS with no policy.** Enabled on every silver table. If a table were ever
   exposed and granted by mistake, it still returns nothing.

`gold` views are owned by `postgres` and are *not* `security_invoker`, so they
run with the owner's rights. `anon` reads `gold.report` while holding no
privilege at all on `silver.report`.

## Components

| Piece | Where | What it is |
|---|---|---|
| Migrations | `supabase/migrations/` | The schema, applied in filename order |
| Seed | `supabase/seed.sql` | **Generated** by `scripts/build-seed.mjs` — edit the generator, never the SQL |
| Prototype app | `prototype/` | Next.js: `/report` (wizard), `/track` (receipt), `/wcc` (console) |
| App API routes | `prototype/app/api/` | `feed` (GeoJSON), `reports` (POST), `reports/[reference]` (GET/PATCH) |
| Shared taxonomy | `prototype/lib/taxonomy.ts` | Services and fault types the form offers; mirrored into `silver.service` / `silver.fault_type` |

## Composing with the other teams

Judging treats each prototype as a module in a shared common operating picture,
so the output that matters is the feed, not our UI:

- `gold.reports_geojson()` returns a finished `FeatureCollection` — point
  MapLibre at it, no client-side assembly.
- `arcgis => true` drops file-level metadata and pushes the disclaimer down into
  every feature, because ArcGIS Online's importer silently discards foreign
  members and would otherwise strip the disclaimer on the way into the system
  WCC actually uses.
- `gold.hubs_geojson()` and `gold.clusters_geojson()` do the same for hubs and
  grouped reports.

## In flight

- **Ownership and priority** — migrations `0008` and `0009`. See
  [classification.md](classification.md).

---

**Verified against:** `supabase/migrations/20260808000001`–`20260808000007`,
`supabase/config.toml`, `supabase/seed.sql` header, `prototype/` file listing —
8 August 2026.
