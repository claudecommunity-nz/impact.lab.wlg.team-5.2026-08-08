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

1. **Not exposed.** `schemas = ["gold", "public", "graphql_public"]`. This is the
   one doing the real work. `gold` is listed *first* deliberately, which makes it
   PostgREST's default profile: `GET /rest/v1/report` returns the filtered data
   with no header at all. The safe schema is the one you get by default, and
   `silver` is not on the list to be asked for.
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
| Seed | `supabase/seed.sql` | **Generated** by `scripts/build-seed.mjs` — edit the generator, never the SQL. 36 hubs, 28 reports, their status trails |
| GIS data | `supabase/gis-ingest.sql` | **Generated** by `scripts/ingest-gis.mjs`. All 74 datasets catalogued, 746 features mirrored |
| Catalogue cache | `data/catalogue.json` | The upstream WCC dataset catalogue, cached so a rebuild needs no network |
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
- `gold.dataset_catalogue` lists all 74 WCC hazard and infrastructure layers with
  publisher, licence and endpoint, so another team can find a layer through us
  and then go straight to the source for it.

## The hazard layers, and why they are in the same database

`silver.dataset` (74 rows), `silver.dataset_feature` (746 mirrored features) and
`silver.source_snapshot` (one row per fetch, including the failures) sit
alongside the reports on purpose.

A report reading "water over the road" is a fact about one street. The same
report inside a mapped ponding area is a fact WCC had a modelled reason to
expect. One *outside* every mapped area is the more interesting of the two —
the city behaving in a way the planning layers did not predict, which is the
case community reporting exists to catch. `gold.hazard_context_summary` is that
number: currently 8 of 28 inside, 20 outside.

The join runs against the **exact** location in `silver`, never the fuzzed
public one, because a 100m cell straddles hazard boundaries and would be wrong
in both directions. Only the yes/no is published.

Licence gates what leaves. The upstream catalogue records a licence note for
exactly one of the 74 datasets; unstated is not permission, and this repo is
public. So the mirror is private and `gold.layer_geojson` republishes only what
has been explicitly cleared — today, one layer. For everything else it returns
the publisher, the endpoint and a plain refusal rather than an empty
`FeatureCollection` that reads as "there is nothing there".

## In flight

- **Rate limiting on `submit_report`.** Anyone may file a report, which is the
  point of a public channel, but nothing throttles it.
- **Nothing calls `gold.triage_report`.** The endpoint landed in
  `20260808000016` — ownership and priority can now be set through the API,
  service role only — but no console reads or writes the database at all. See
  [workflow-gaps.md](workflow-gaps.md).

---

**Verified against:** `supabase/migrations/20260808000001`–`20260808000017`,
`supabase/config.toml`, `supabase/seed.sql` header, `prototype/` file listing —
8 August 2026. Migrations `0015`–`0017` read from source, not applied.
