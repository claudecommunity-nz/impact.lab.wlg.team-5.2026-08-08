# The public contract

> Living doc — see [README.md](README.md). **This file is the one other teams
> read.** Changing an RPC signature or a published property name without
> updating this is how a demo breaks at 16:30.

Everything here lives in the `gold` schema, which PostgREST serves at
`/rest/v1/`. `silver` is not on the exposed list and has no URL.

## Live

```
https://npgheigsdikccoknmbup.supabase.co/rest/v1/
```

Every request needs an `apikey` header. The anon key is in
[`.env.example`](../.env.example) and is safe in a browser — it can read `gold`
and file a report, and nothing else.

```bash
curl -s https://npgheigsdikccoknmbup.supabase.co/rest/v1/hazard_context_summary   -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

`gold` is the default schema, so no `Accept-Profile` header is needed.

Verify the deployment rather than trusting it:

```bash
npm run check -- https://npgheigsdikccoknmbup.supabase.co "$NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

**One trap worth knowing.** `supabase/config.toml` configures the *local* stack
only. A hosted project starts with `gold` unexposed, so every URL here 404s
until the `authenticator` role is told about it:

```sql
alter role authenticator set pgrst.db_schemas = 'gold, public, graphql_public';
notify pgrst, 'reload config';
```

This has been applied to the project above. It has to be re-applied to any new
one, and it is not carried by `db push` — migrations cannot alter a role that
belongs to the platform.

## Reading

### `gold.reports_geojson(...)` → `FeatureCollection`

`POST /rest/v1/rpc/reports_geojson`

| Parameter | Type | Default | |
|---|---|---|---|
| `bbox` | `double precision[]` | `null` | `[west, south, east, north]` in WGS84 — MapLibre's `getBounds().toArray()` flattened |
| `since` | `timestamptz` | `null` | Filters on `observedAt` |
| `statuses` | `text[]` | `null` | Accepts the eight-state vocabulary **or** the app's five |
| `fault_types` | `text[]` | `null` | |
| `service` | `text` | `null` | |
| `include_synthetic` | `boolean` | `true` | |
| `arcgis` | `boolean` | `false` | See below |
| `max_features` | `integer` | `2000` | Clamped to 1..10000 |

Returns a finished FeatureCollection — point MapLibre straight at it. Ordered by
`submittedAt` descending.

**`arcgis => true`** returns the collection with no foreign members and the
disclaimer pushed down into every feature. ArcGIS Online's GeoJSON importer
silently drops file-level metadata, which would strip the disclaimer off the data
on its way into the exact system WCC actually uses.

### `gold.hubs_geojson()` → `FeatureCollection`

36 Community Emergency Hubs, published at exact coordinates — these are places
people are meant to find. Carries source and source URL in `metadata`.

### `gold.clusters_geojson(min_reports => 2)` → `FeatureCollection`

Grouped reports. Every feature gets `kind: 'group'`, a `reportCount`, a
`radiusM` and a `groupedBy` string that states the grouping is inferred, not
confirmed.

### `gold.report_receipt(reference)` → `jsonb`

The resident-facing lookup. Case-insensitive on the reference. No auth: **the
reference is the capability**, which is why it is random rather than sequential.

```jsonc
{
  "found": true,
  "reference": "WCC-2GVRP",
  "status": "responding",          // the real eight-state value
  "legacyStatus": "acting",        // mapped to the app's five
  "statusLabel": "Responding",
  "statusNote": "…",
  "assignedAgency": "Tiaki Wai",
  "faultType": "surface-flood",
  "faultLabel": "Surface flooding",
  "suburb": "Hataitai",
  "severity": "disruption",
  "submittedAt": "…", "statusUpdatedAt": "…",
  "verificationLevel": "unverified",
  "isSynthetic": true,
  "disclaimer": "…",
  "timeline": [ { "at": "…", "status": "…", "legacyStatus": "…",
                  "statusLabel": "…", "note": "…", "by": "…",
                  "externalTicketRef": null } ]
}
```

Not found returns `{ "found": false, "reference": "…" }` — never an error, so a
mistyped reference reads as "we don't have that" rather than a stack trace.

### Views

`gold.report`, `gold.report_status_history`, `gold.report_cluster`, `gold.hub`,
`gold.agency`, `gold.service`, `gold.fault_type`, `gold.report_category` and
`gold.scope_audit` are all directly selectable at `/rest/v1/<view>`. Property
names are camelCase and match what `prototype/app/api/feed` already emits, so an
existing consumer needs no changes.

#### `gold.fault_type` — every category, live and retired

Filter on `isActive` to build a form. The rest of the row is there so a client
can explain itself:

| Property | |
|---|---|
| `helpText` | One line under the label, in a reporter's words rather than Council's |
| `alsoCovers` | Labels of the retired categories that now resolve here. **Derived** from `supersededBy`, so it cannot fall out of sync |
| `supersededBy` | Set on a retired code, naming what it became. An old client reads this to find out its code moved |
| `isActive` | False for retired codes. They are still *accepted* at intake — see `submit_report` below |
| `ownership`, `ownershipNote`, `defaultPriority` | See [classification.md](classification.md) |
| `intakeBlocked`, `intakeBlockReason` | Life-safety categories, refused at the database |

`gold.report_category` is the same list flattened against its service —
`code`, `label`, `helpText`, `serviceLabel`, `serviceBlurb`, `sortOrder` — for
building a form in one request. Active categories only.

#### `gold.scope_audit` — published ownership vs what WCC actually said

One row per live emergency category, comparing `ownershipPublished` against
`ownershipScopedByWcc`, with `asStatedByWcc`, a `source`, and a `finding` of
`matches`, `published ownership differs from WCC's stated scope`,
`not in WCC's stated scope`, or `claims WCC lead but is not in WCC's stated
scope`.

Published as a view rather than enforced as a constraint, deliberately: during a
build the classification is still moving, and a constraint that blocks a
legitimate edit gets dropped rather than obeyed. Drift is meant to be **visible**,
not blocked. Restricted to `service = 'emergency'` — potholes and graffiti were
never in WCC's scoping conversation and auditing them buries the rows that
matter.

Published on every `gold.report` row, and worth knowing about before you render
anything:

| Property | Why it is there |
|---|---|
| `descriptionStatus` | `published` or `withheld_pending_review`. A null description with an explicit status is honest; a leaked one cannot be taken back |
| `locationPrecision` | How much the coordinates were coarsened — see [trust-and-privacy.md](trust-and-privacy.md) |
| `verificationLevel` | `unverified` unless something specific earned better |
| `isSynthetic` | True for every seeded demo report |
| `disclaimer` | Rides on the row so a consumer who never read these docs still cannot present it as confirmed fact |
| `address` | **Null unless precision is `street`.** "Rawhiti Terrace" plus a 100m cell reassembles the exact address the fuzzing was meant to protect |

### `gold.dataset_catalogue` → the 74 WCC datasets

`GET /rest/v1/dataset_catalogue`

Every hazard and infrastructure layer WCC Emergency Management published, with
its publisher, licence, endpoint and — the useful column — `availableVia`:

| `availableVia` | Meaning |
|---|---|
| `gold.layer_geojson` | Mirrored **and** licence-cleared. Ask us. |
| `publisher_endpoint` | Catalogued only. Go to `endpointUrl`. |
| `publisher_image_service` | A raster. Ask it for a PNG, not features. |

`lastFetchedAt`, `lastFeatureCount`, `lastFetchComplete` and `lastFetchError`
come from the provenance log. A layer we could not reach says so rather than
appearing empty. All eleven mirrored layers currently fetch clean; the two that
did not (`fault-hazard-overlay`, `flood-hazard-areas`) were a group layer and a
service root respectively — neither is queryable at the URL the catalogue
lists, and both now resolve to their sublayers.

### `gold.layer_geojson(dataset_id, bbox, max_features)` → `FeatureCollection`

`POST /rest/v1/rpc/layer_geojson`

Returns a mirrored layer with full provenance in `metadata`, including
`complete`, `truncated` and a `generalisation` note (simplified to ~5m for web
display — do not measure anything with our copy).

**It refuses when the licence is not cleared**, with a 200 and an explanation:

```json
{ "error": "not_redistributable",
  "publisher": "Wellington City Council",
  "licence": "not stated",
  "endpointUrl": "https://gis.wcc.govt.nz/...",
  "message": "This dataset's licence does not clear us to republish it…" }
```

Only one dataset of the 74 carries any licence note at all. Unstated is not
permission, so exactly one layer — `community-emergency-hubs`, which is GWRC
open data already exported into this repo — is cleared. Everything else is
mirrored into `silver` for our own spatial joins and refused by the public API.
Adding to that list is a licence decision, made in `scripts/ingest-gis.mjs`.

### `gold.report_hazard_context` → was this already a known hazard?

`GET /rest/v1/report_hazard_context`
`GET /rest/v1/hazard_context_summary`

One row per report × mapped hazard area it falls inside, with the publisher
whose model produced the finding. The summary view gives the operational read:

> 8 of 28 reports fall inside a mapped hazard; 20 do not.

The 20 are the interesting number. They are the city behaving in a way the
planning layers did not predict, which is the case community reporting exists
to catch.

Two things to hold on to when using this:

- **It is an inference.** A point inside a polygon does not mean the polygon
  caused it. Every row carries `basis` saying so, and nothing here changes a
  report's `verificationLevel`.
- **It is computed against the exact location**, privately, inside `silver`. A
  fuzzed 100m cell straddles hazard boundaries and would be wrong in both
  directions. Only the yes/no is published — which is why this is a view over
  `silver` and not something you could rebuild from `gold`.

## Writing

### `gold.submit_report(...)` → `jsonb`

The only write path into the database from outside. `SECURITY DEFINER`, granted
to `anon` — anyone may submit, that is the entire point of the channel — and it
validates hard before it writes.

Parameter names are exactly the POST body `prototype/app/api/reports` accepts,
so the route forwards the validated body without remapping keys:
`service`, `faultType`, `faultDesc`, `locLatitude`, `locLongitude`, `severity`,
`locAddress`, `locSuburb`, `reporterKind`, `hubName`, `contactFirstName`,
`contactLastName`, `contactEmail`, `contactPhone`, `attachmentUploadKeys`,
`observedAt`, `sourceChannel`.

**Retired codes still work.** Three pairs of categories were merged (see
[classification.md](classification.md)). A client sending `flooding`, `coastal`,
`road-blocked`, `access-cut`, `power-out` or `water-out` is **not** rejected: the
report is stored under the merged code and the response says so via
`faultTypeRemapped: true`. A form built against the old list keeps working, which
is the whole reason the old codes were retired as aliases rather than deleted.

It refuses, with `errcode 22023`:

- an unknown `faultType`, or one that is inactive *without* a `supersededBy` to
  resolve to;
- **any fault type marked `intake_blocked`** — life-safety categories are refused
  at the database, not just hidden in the form. A prototype that quietly absorbs
  one of these and files it in a queue would be worse than no prototype;
- a `faultType` that does not belong to the given `service`;
- a missing location, or one outside the Wellington region
  (lat −42.2..−40.6, lng 174.2..175.6 — the region, not just the city, because
  Makara and Tawa are both in scope);
- a `severity` outside `info` / `disruption` / `urgent`;
- a malformed email address.

Returns the reference immediately. The acknowledgement is the product:

```jsonc
{ "reference": "WCC-2GVRP", "status": "received", "legacyStatus": "received",
  "statusLabel": "Received", "receivedAt": "…",
  "faultType": "surface-flood",     // what it was stored as
  "faultLabel": "Surface flooding",
  "faultTypeRemapped": true,        // true when a retired code was resolved
  "message": "…",
  "disclaimer": "This is a prototype, not an operational emergency service. In an emergency call 111." }
```

Submitted text lands in `fault_desc` with `pii_reviewed = false`, so gold reports
it as `withheld_pending_review` until someone has actually read it.

### `gold.advance_status(...)` → the receipt

**Not granted to `anon` or `authenticated`.** Moving a report to "Completed &
confirmed" is a Council statement about the world and a public key must not be
able to make it. The console's PATCH route runs server-side and calls this with
the service role key. If this is ever granted to `anon`, the acknowledgement
trail stops meaning anything.

Accepts either vocabulary (`checking` → `under_review`, `acting` →
`responding`, `resolved` → `completed_confirmed`, `no-action` → `no_action`).
Append-only: it writes an event and lets the trigger update the report, so there
is no way to rewrite history through this API.

### `gold.triage_report(...)` → the receipt

`POST /rest/v1/rpc/triage_report`

**Service role only** — `anon`, `authenticated` and `public` are explicitly
revoked. Triage is a Council judgement: who owns a job and how urgent it is are
not things a public key may decide.

| Parameter | Type | |
|---|---|---|
| `reference` | `text` | Required |
| `priority` | `integer` | 1 (critical) to 4 (low). See `gold.priority_level` |
| `ownership` | `text` | `wcc_lead`, `shared` or `not_wcc` |
| `agencyCode` | `text` | Who it routes to |
| `onCouncilLand` | `boolean` | The distinction most of WCC's ownership rules turn on |
| `status` | `text` | Accepts either vocabulary, same as `advance_status` |
| `note` | `text` | |

Every parameter but `reference` is optional and null means "leave it alone", so
setting a priority does not silently clear an ownership call.

This is what makes the classification a triage tool rather than a category
lookup. Until it existed, `silver.triage_report()` was unreachable — `silver` has
no URL — so every report published `priorityBasis: category_default` forever, and
`service-outage`, which is deliberately unclassified, would have sat owned by
nobody.

## Grants at a glance

| Role | Can |
|---|---|
| `anon`, `authenticated` | `select` on the gold views; execute `reports_geojson`, `hubs_geojson`, `clusters_geojson`, `report_receipt`, `submit_report`, `layer_geojson` |
| service role | The above, plus `advance_status` and `triage_report` |
| Nobody outside the database | Anything in `silver` |

## How gold views reach silver — do not "tidy" this away

`gold.report` calls helper functions that read `silver.fault_type`. A function
called inside an owner-rights view is permission-checked against **the caller**,
not the view owner, so those helpers need two things or the whole public feed
breaks for anonymous readers:

1. `security definer`, or the function body fails with
   `permission denied for schema silver`;
2. `grant execute ... to anon, authenticated`.

Both are in `20260808000008`. Removing either takes down `gold.report`,
`reports_geojson` and `report_receipt` for `anon` — verified by revoking them
and watching it fail.

The exception is `silver.fuzz_point`: `immutable` and reads no tables, so the
planner inlines it and no privilege check survives. `20260808000006`'s revoke on
it is harmless.

## Known contract breaks

Closed as of 8 August 2026:

- ~~`report_receipt` lost `timeline`~~ — fixed in `20260808000010`. It now
  returns the trail as **`timeline`** in the `TimelineEntry` shape
  (`at`, `status`, `legacyStatus`, `statusLabel`, `note`, `by`,
  `externalTicketRef`), alongside `legacyStatus`, `statusNote`, `faultType` and
  `severity`. The old `history` key is still returned, holding the same array,
  so nothing that already reads it breaks. Lookup is case-insensitive.
- ~~`intake_blocked` is `false` for every category~~ — fixed in
  `20260808000011`. `assistance` and `building-damage` now refuse at intake with
  a message telling the reporter to call 111. The contact-centre categories are
  deliberately still accepted: they are urgent but not life-safety, and a late
  report of a burst main is still worth having. (That migration names them as
  `biohazard`, `water-out` and `power-out`; the latter two have since merged into
  `service-outage`, which is likewise not blocked.)
- ~~The service role has no `usage` on schema `gold`~~ — fixed in
  `20260808000010`. `service_role` has `usage`, `select` and `execute` across
  `gold`. `advance_status` is granted to `service_role` **only** — `anon` and
  `authenticated` are explicitly revoked, because moving a report to
  "Completed & confirmed" is a Council statement about the world.

- ~~Nothing in `gold` sets priority or ownership~~ — fixed in
  `20260808000016`. `gold.triage_report` writes both, service role only.

Still open:

- **The report form offers six retired codes and none of the three merged ones.**
  `prototype/lib/taxonomy.ts` still lists `flooding`, `coastal`, `road-blocked`,
  `access-cut`, `power-out` and `water-out`. Submissions succeed — that is what
  the aliasing is for — but the form still shows the split boxes the merge
  existed to remove, and `helpText`/`alsoCovers` are not read by anything yet.
  See [workflow-gaps.md](workflow-gaps.md).

## One more thing worth knowing

`gold` is listed **first** in `supabase/config.toml`, so it is PostgREST's
default profile. `GET /rest/v1/report` works with no `Accept-Profile` header.
The safe schema is the default one; you have to go out of your way to ask for
anything else, and `silver` is not askable at all.

---

**Verified against:** `supabase/migrations/20260808000001`–`20260808000011`
applied to a clean database and exercised over HTTP as `anon` and
`service_role` — 8 August 2026. Round trip confirmed: `anon` submits with
contact details and gets a reference, none of those details reach `gold`, the
description is held at `withheld_pending_review`, `service_role` walks the
report to Completed & confirmed, and `anon` reads the whole trail back from the
reference in lower case.

**`20260808000012`–`20260808000017` are documented from the migration source,
not from a run.** `triage_report`, `scope_audit`, `report_category`, the
`fault_type` columns and the alias remapping in `submit_report` are all
described as written. Nobody has yet applied the chain to a clean database and
exercised these over HTTP the way the first eleven were. Treat the shapes above
as the intent of the code, and re-run
`npm run check -- <url> "$NEXT_PUBLIC_SUPABASE_ANON_KEY"` before another team
builds against them — 8 August 2026.
