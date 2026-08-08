# The public contract

> Living doc — see [README.md](README.md). **This file is the one other teams
> read.** Changing an RPC signature or a published property name without
> updating this is how a demo breaks at 16:30.

Everything here lives in the `gold` schema, which PostgREST serves at
`/rest/v1/`. `silver` is not on the exposed list and has no URL.

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
  "faultType": "flooding",
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
`gold.agency`, `gold.service`, `gold.fault_type` are all directly selectable at
`/rest/v1/<view>`. Property names are camelCase and match what
`prototype/app/api/feed` already emits, so an existing consumer needs no
changes.

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

It refuses, with `errcode 22023`:

- an unknown or inactive `faultType`;
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
  "statusLabel": "Received", "receivedAt": "…", "message": "…",
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

## Grants at a glance

| Role | Can |
|---|---|
| `anon`, `authenticated` | `select` on the gold views; execute `reports_geojson`, `hubs_geojson`, `clusters_geojson`, `report_receipt`, `submit_report` |
| service role | The above, plus `advance_status` |
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
  a message telling the reporter to call 111. The contact-centre categories
  (`biohazard`, `water-out`, `power-out`) are deliberately still accepted: they
  are urgent but not life-safety, and a late report of a burst main is still
  worth having.
- ~~The service role has no `usage` on schema `gold`~~ — fixed in
  `20260808000010`. `service_role` has `usage`, `select` and `execute` across
  `gold`. `advance_status` is granted to `service_role` **only** — `anon` and
  `authenticated` are explicitly revoked, because moving a report to
  "Completed & confirmed" is a Council statement about the world.

Still open:

- **Nothing in `gold` sets priority or ownership.** Both are read-only over the
  API; triage happens in `silver`. See [workflow-gaps.md](workflow-gaps.md).

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
