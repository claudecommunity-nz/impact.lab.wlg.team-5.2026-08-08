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
| `/track` | Resident enters their reference number, watches the status change, and can say it is fixed. |
| `/map` | The shared feed beside the Council's published map. Read-only, except "I fixed it". |
| `/wcc` | Council duty officer: queue, map, grouping, status, verification and publishing. |

Open `/wcc` and `/track` side by side — changing a status in the console appears
on the resident's page within about five seconds. That is the demo. The longer
version runs the loop the other way: tap **I fixed it** on `/track`, watch the
claim land in the console, verify it as Fire, and the resident sees who
confirmed it.

## What this is a clone of, and what it adds

The categories, wizard shape and field names mirror the Council's existing public
reporting tool (FIXiT, `services.wellington.govt.nz/report`), so this reads as an
extension of a channel residents already know. It is a reimplementation — no
Council code was copied — and it never posts to any real Council endpoint. The
interface is built with the Council's design system; see below.

## Design system

The interface uses the Wellington City Council design system supplied to the
team, kept in `docs/Wellington City Council Design System/`. Read its
`HANDOFF.md` before changing anything visual.

- `app/tokens/*.css` are the bundle's token files copied verbatim, except
  `fonts.css`, whose `@font-face` URLs point at `/fonts/` so Next.js serves them
  from `public/`. Do not hand-edit them — take a fresh copy from the bundle.
- `tailwind.config.js` maps every colour, type step, radius and duration onto
  those custom properties. Nothing in it invents a value.
- Reusable patterns live as classes in `app/globals.css`: `.btn`, `.field`,
  `.card`, `.label`, `.hint`, `.error`, `.ref`, `.te-reo`, `.rule-yellow`,
  `.map-plate`.

Three things to know before editing:

- **Yellow is a signal, not a surface.** It carries the 4px rule under the
  masthead, the primary button, the rule under a page title, the current step and
  the current nav item. It never sits behind body copy and never carries white
  text.
- **The 2px black focus ring at 2px offset is non-negotiable.** It is set once,
  in the base layer, for every interactive element.
- **Opacity signals disabled and nothing else.** Reach for a grey token rather
  than `text-black/60`; the opacity modifiers do not work through `var()` anyway.

Two deliberate departures, both flagged in the code:

- **Te reo Māori titles appear on the report wizard steps only.** The four
  pairings come from the design system's Fixit UI kit, whose README says the live
  Fixit service could not be read — they are the kit author's informed
  inventions, not verified Council copy. The home, track and console pages carry
  no te reo line rather than an invented one. Get the real pairings from the
  Council.
- **The logo is proprietary.** `public/wcc-logo.svg` and `wcc-logo-white.svg` are
  the Council's mark. Check the Council's legal notice before this repo or any
  derivative is published externally. Removing them is a two-line change in
  `app/layout.tsx`.

Asap stands in for the Council's own typeface, which is not published. Swapping
it is a one-file change in `app/tokens/fonts.css`.

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
- **A return leg — "I fixed it".** The community can close the loop, not only
  open it. See below.
- **Verification, with a name on it.** A status that says who confirmed it.

## The fix-and-verify loop

The two-way channel is only two-way if information can come back the other way
at the end as well as the start. A neighbour clears the drain, a hub team moves
the branch, a contractor finishes before anyone at the Council has looked —
today none of that reaches the Council, so the report stays open and the map
keeps showing a problem that is not there.

```
resident taps "I fixed it"   →   duty officer sees a claim   →   Fire or Police
        (/track, /map)                    (/wcc)                   confirm it
                                                                       ↓
                                              published to the shared feed  ←  Verified
```

Three rules hold it together, and they are the point of it:

- **A claim never moves a status.** An unverified claim that a hazard is gone is
  the most dangerous thing this prototype could treat as fact — it is the one
  that takes a warning off a map. The button files a claim, the console renders
  it as a claim (outlined, never filled like a Council status), and only
  verification moves anything.
- **Repeat claims are counted, not repeated.** Four neighbours saying a road is
  clear is better evidence than one, and it is the same reasoning as grouping by
  proximity. The queue keeps one row and a count.
- **Verified names an organisation.** `VERIFIERS` in `lib/schema.ts` is a short
  closed list — Fire, Police, Council crew — and the API refuses a `verified`
  status with no verifier. A confirmation from nobody in particular is not a
  confirmation. The resident sees the name on their tracking page.

`/map` offers the button against reports on the shared feed too. That feed is
read-only, so the claim lands in this console rather than back on the feed, and
the form says so rather than implying it went somewhere it did not.

## Publishing to the shared feed

`Publish` in the console pushes a verified report onto the shared Supabase feed
(`supabase/`), so the other teams get a set where everything was confirmed by
someone who was there. Guarded on `verified`, and it sends no contact details.

It is two RPC calls, in this order:

| Call | Who may | What it does |
|---|---|---|
| `gold.submit_report` | anon | The only write path into `silver`. Validates fault type, service, bounds and severity, and **mints its own reference** |
| `gold.confirm_report` | service role only | Raises `verification_level` to `field_confirmed` and names the agency |

The second call is the point. Without it the report lands as `unverified` with a
disclaimer saying so, which is worse than not publishing — it adds noise to a
feed whose only value is that it is checked. `gold.confirm_report` is added by
[`20260808000015_confirm_report.sql`](../supabase/migrations/20260808000015_confirm_report.sql):
`silver.verification_level` and `gold.disclaimer_for` existed from the start, but
nothing could set a level above `corroborated`, so `field_confirmed` was
unreachable.

Because `submit_report` generates its own reference, the upstream record is a
**different report** from ours. `publishedReference` keeps the link, and the
console says so rather than implying the two are one record.

Config, both already in `.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL     the project URL
SUPABASE_SERVICE_ROLE_KEY    server-side only, never in .env.example
```

Confirming is deliberately refused to the anon key, for the same reason
`gold.advance_status` is: "Fire have confirmed this" is a statement about the
world, and a key that ships in a browser bundle must not be able to make it.

Failures are stored on the report and shown in full, quoting the Postgres error
and code. A publish button that quietly does nothing is worse than one that does
not work, because the operator would believe the data went out.

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
GET /api/feed                    GeoJSON, one point per report
GET /api/feed?grouped=1          one point per inferred group
GET /api/reports                 full records, grouping, and fix claims
POST /api/reports                file a report
PATCH /api/reports/:ref          set status  {status, note, verifier}
POST /api/reports/:ref/fix       "I fixed it"  {note, by}
POST /api/reports/:ref/publish   push a verified report to the shared feed
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
- A fix claimed by the public is shown as a claim, never as a resolution, and it
  cannot move a status on its own.
- `Verified` carries the name of the organisation that confirmed it, everywhere
  it appears. Without a name it is not a claim anyone can check.
- A failed publish is shown with the server's own error, on the report. Nothing
  is reported as published unless it was.

## Layout

```
app/
  page.tsx                     landing
  report/ track/ wcc/          the three screens
  api/reports/                 GET list, POST create
  api/reports/[reference]/     GET one, PATCH status
    fix/                       POST "I fixed it"
    publish/                   POST to the shared feed
  api/feed/                    GeoJSON out
  api/public-feed/             the shared Supabase feed, read
components/
  Wizard.tsx PhotoUpload.tsx MapPicker.tsx   resident side
  Console.tsx ReportMap.tsx                  council side
  Tracker.tsx                                the acknowledgement loop
  FixedIt.tsx                                the return leg, on /track and /map
  PublicMap.tsx                              the shared feed beside WCC's map
lib/
  types.ts     Report, FixClaim, statuses, map layer types — the one contract
  layers.ts    suburb + parcel boundaries, and point-in-polygon
  taxonomy.ts  services and fault types
  schema.ts    report shape, statuses, verifiers, validation
  store.ts     JSON-file store, grouping heuristic, fix claims
  seed.ts      demo reports at real Wellington locations
  map.ts       basemap, and WREMO's 126 Community Emergency Hubs
  publicFeed.ts  reading the shared feed
  publish.ts     writing back to it
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
