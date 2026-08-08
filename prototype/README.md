# Prototype — a two-way reporting channel

Impact Lab Wellington, problem statement 02. Next.js + React + TypeScript + Tailwind.

```bash
cd prototype
npm install
npm run dev          # http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run check:map    # drives a real browser, fails if any layer draws nothing
```

The store seeds itself with demo reports on first run. `rm -rf .data` resets it.

## The three screens

| Route | Who it is for |
|---|---|
| `/report` | Resident, community group or hub files a report. Five steps: what, where, details, you, done. |
| `/track` | Resident enters their reference number and watches the status change. |
| `/wcc` | Council duty officer: queue, map, grouping, and the control that sets a status. |

Open `/wcc` and `/track` side by side — changing a status in the console appears
on the resident's page within about five seconds. That is the demo.

## What this is a clone of, and what it adds

The categories, wizard shape and field names mirror the Council's existing public
reporting tool (FIXiT, `services.wellington.govt.nz/report`), so this reads as an
extension of a channel residents already know. It is a reimplementation — no
Council code, styling or branding assets were copied — and it never posts to any
real Council endpoint.

What the current channel has no concept of, and this adds:

- **An emergency branch.** Flooding, slips, blocked roads, trees down, coastal
  overtopping, properties cut off, hub status. Today none of these exist in the
  form; they route to a phone number.
- **An acknowledgement loop.** A reference number that resolves to a live status
  and a timestamped history the reporter can see. The existing tool's only
  tracking affordance is pasting an SR number to link a duplicate.
- **Reporting on behalf of a community.** A Community Emergency Hub is a
  first-class reporter kind and is flagged in the console, because someone has
  physically been there.
- **Grouping.** Reports of the same fault type within 250m are clustered, so
  forty messages about one storm become a handful of things to act on.

## Map layers

Both boundary layers come live from WCC's own ArcGIS server, `outSR=4326` on
every request.

| Layer | Source | How it loads |
|---|---|---|
| Suburb boundaries | `PropertyAndBoundaries/Boundaries/MapServer/4` — 57 polygons | Once, generalised server-side with `maxAllowableOffset` (920KB → 123KB) |
| Property boundaries | `PropertyAndBoundaries/Parcels/MapServer/1` — 84,223 parcels | Current view only, above zoom 15.5, one request per pan |
| Community Emergency Hubs | Greater Wellington, WREMO — 126 points | Once |

Two things the layers buy beyond decoration:

- **Suburbs are shaded by report count**, and the queue names the worst three.
  "Four in Hataitai" is a different fact from four dots on a road. The counts are
  computed client-side by ray casting against the same polygons on screen, so the
  map and the list cannot disagree — and they follow the filters, which the
  legend says.
- **The resident's suburb is derived from their pin**, not typed. It travels with
  the report as `locSuburb` and appears in the console and the feed. Nobody
  spells Kaiwharawhara three ways.

Parcels are the reason the picker is usable at street level: dropping a pin on
*this* driveway rather than somewhere on the street is the difference between a
crew finding it and not.

The parcel query is capped at 2,000 rows by the service and says so only in a
flag most clients ignore. The layer panel surfaces it — a truncated parcel layer
otherwise looks exactly like a suburb with no properties in it.

## Feeds for the common operating picture

CORS is open, so another team's map can read these directly.

```
GET /api/feed              GeoJSON, one point per report
GET /api/feed?grouped=1    one point per inferred group
GET /api/reports           full records plus grouping
POST /api/reports          file a report
PATCH /api/reports/:ref    set status  {status, note}
```

Every feed response carries a `metadata.disclaimer` saying the reports are
unverified and not an operational source. Anything consuming it should carry
that through.

## Reliability, shown not hidden

- Grouping is a proximity heuristic. The console and the feed both say so, in
  those words, next to the count.
- Severity is the reporter's own assessment, labelled as such — not a Council
  triage.
- Life-safety fault types interrupt with 111 or the Contact Centre before the
  form continues, and say plainly that nobody is watching the form second by
  second.
- The status rail shows steps that have *not* happened. "Received" with nothing
  after it for two days is information, and hiding it is what makes the current
  channel feel like a void.

## Layout

```
app/
  page.tsx                     landing
  report/ track/ wcc/          the three screens
  api/reports/                 GET list, POST create
  api/reports/[reference]/     GET one, PATCH status
  api/feed/                    GeoJSON out
components/
  Wizard.tsx PhotoUpload.tsx MapPicker.tsx   resident side
  Console.tsx ReportMap.tsx                  council side
  Tracker.tsx                                the acknowledgement loop
lib/
  types.ts     Report, statuses, severities, map layer types — the one contract
  layers.ts    suburb + parcel boundaries, and point-in-polygon
  taxonomy.ts  services and fault types
  schema.ts    report shape, statuses, validation
  store.ts     JSON-file store and the grouping heuristic
  seed.ts      demo reports at real Wellington locations
  map.ts       basemap, and WREMO's 126 Community Emergency Hubs
scripts/
  check-map.mjs  browser check that the map layers actually render
```

Everything is TypeScript under `strict`. [`lib/types.ts`](lib/types.ts) holds the
`Report` shape that the form, the store, the console and the feed all agree on —
change a field there and every consumer that got it wrong stops compiling.

Basemap is OpenStreetMap raster tiles — no API key, works off a hotspot. The
hub layer comes from Greater Wellington's ArcGIS service with `outSR=4326`,
without which the pins land off the coast of Africa.

Photos are downscaled to 1200px in the browser before submission. A real
deployment would put them in object storage and keep the key; this one carries a
small inline copy so the console can show the photo with no bucket behind it.
