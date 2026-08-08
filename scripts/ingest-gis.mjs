// Pulls the WCC / GWRC / GNS / NIWA hazard and infrastructure layers into
// silver, and writes the SQL to supabase/gis-ingest.sql.
//
//   node scripts/ingest-gis.mjs            # catalogue metadata + mirror layers
//   node scripts/ingest-gis.mjs --catalogue-only
//
// Then:  psql < supabase/gis-ingest.sql    (see the npm script)
//
// Three traps in these services, all of which cost someone an hour if you meet
// them the hard way:
//
//   1. Everything is published in NZTM2000. Request it raw and the pins land
//      off the coast of Africa. `outSR=4326` on every request, no exceptions.
//   2. A quarter of the layers advertise a query capability and then refuse to
//      answer, because they are rasters. Those are catalogued, never fetched.
//   3. A large layer silently returns 2,000 features and a quiet
//      `exceededTransferLimit` flag rather than an error. We page until it
//      clears, and record the flag either way — a truncated layer must never
//      be mistaken for a complete one.
//
// These are council servers and at least one host degrades under concurrent
// load, so requests are sequential with a pause between them. It is slower and
// it is the right thing to do.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CATALOGUE_URL =
  'https://raw.githubusercontent.com/claudecommunity-nz/wcc-emergency-gis-data/main/catalogue.json'
const CACHE = path.join(root, 'data', 'catalogue.json')

// Wellington City, generously bounded. Every fetch is clipped to it: we do not
// need Wairarapa flood polygons, and asking for them is rude to the server.
const WELLINGTON = { west: 174.6, south: -41.4, east: 174.95, north: -41.1 }

const PAGE = 1000
const PAUSE_MS = 400
// A safety net, not a target. A layer that needs more than this is one we
// should be querying live rather than mirroring.
const MAX_FEATURES = 5000

// ---------------------------------------------------------------------------
// Licence clearance
// ---------------------------------------------------------------------------
// The catalogue records a licence note for exactly one of the 74 datasets. The
// rest are unstated, and unstated is not permission — the repo is public and
// the data is not ours.
//
// So: everything is mirrored into `silver`, which is private and is us holding
// a working copy for spatial joins and for surviving a slow council server.
// `gold` republishes only what is in CLEARED below. Everything else is
// catalogued in the public API with its publisher, its endpoint and an honest
// "we have not cleared this, go to the source".
//
// Adding to this list is a licence decision, not a code change. Do not add
// anything here without checking the dataset's page.
const CLEARED = new Set([
  // Already in this repo as an export from GWRC's ArcGIS Hub open data portal,
  // with source and attribution recorded in wcc_emergency_hubs.geojson.
  'community-emergency-hubs',
])

// Layers worth holding a local copy of: the ones a duty officer needs when the
// network is the thing that is broken.
// An entry is either a dataset id, or an id plus the sublayers to pull.
//
// Two of these are not queryable at the URL the catalogue lists, which is not a
// mistake in the catalogue — it is how ArcGIS works:
//
//   fault-hazard-overlay  is a *group layer*. Group layers hold no features;
//                         the four named faults beneath it do, and one of them
//                         is the Wellington Fault.
//   flood-hazard-areas    is a *service root*. You query a layer, not a service.
//
// Both answered "Invalid or missing input parameters" and a 400 until asked
// properly.
const MIRROR = [
  'community-emergency-hubs',
  'emergency-water-tanks',
  'emergency-routes',
  'tsunami-evacuation-zones',
  'ponding-areas',
  'overland-flowpath',
  'stream-corridor',
  'liquefaction-overlay',
  'active-faults',
  { id: 'fault-hazard-overlay', sublayers: [46, 47, 48, 49] },
  // 1% AEP — the one-in-a-hundred-year extent, which is the one people mean.
  { id: 'flood-hazard-areas', sublayers: [2, 3] },
]

const mirrorId = (m) => (typeof m === 'string' ? m : m.id)
const mirrorIds = MIRROR.map(mirrorId)
const mirrorEntry = (id) => MIRROR.find((m) => mirrorId(m) === id)

// Catalogued, deliberately not mirrored:
//
//   landslide-features   over 20,000 polygons across the city. A partial mirror
//                        is worse than none — it draws hazard over half of
//                        Wellington and looks complete. Query it live.
//
// Any fetch that still fails is recorded in silver.source_snapshot and surfaces
// as lastFetchError in the public catalogue, rather than being quietly dropped.

// ---------------------------------------------------------------------------
// Generalisation
// ---------------------------------------------------------------------------
// These hazard polygons are modelled at engineering detail — a single stream
// corridor came back with more vertices than the whole rest of the mirror
// combined, and seventeen of them were 200MB of coordinates.
//
// Ramer-Douglas-Peucker at ~5m, and six decimal places (~0.1m at this
// latitude). That is well inside the accuracy these layers are drawn at and far
// below what anyone can see on a city-scale web map. It is a display copy.
//
// It is also why gold labels the mirror `generalised`: an engineer sizing a
// culvert must go to the publisher, not to us.
const SIMPLIFY_TOLERANCE = 0.00005

const round6 = (n) => Math.round(n * 1e6) / 1e6

function perpendicularDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay)
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  const cx = ax + Math.max(0, Math.min(1, t)) * dx
  const cy = ay + Math.max(0, Math.min(1, t)) * dy
  return Math.hypot(px - cx, py - cy)
}

function simplifyRing(points, tolerance) {
  if (points.length < 3) return points
  let maxDist = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1])
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist <= tolerance) return [points[0], points[points.length - 1]]
  return [
    ...simplifyRing(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplifyRing(points.slice(index), tolerance),
  ]
}

// Walks the nested coordinate arrays without needing to know which geometry
// type it is holding.
function generalise(coords, depth) {
  if (depth === 0) return coords.slice(0, 2).map(round6)
  if (depth === 1) {
    const pts = coords.map((c) => c.slice(0, 2).map(round6))
    // A ring must stay closed, and must keep at least four points to remain a
    // valid polygon after simplification.
    const simplified = simplifyRing(pts, SIMPLIFY_TOLERANCE)
    return simplified.length >= 4 || pts.length < 4 ? simplified : pts
  }
  return coords.map((c) => generalise(c, depth - 1))
}

const DEPTH = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
}

function shrinkGeometry(geom) {
  const depth = DEPTH[geom.type]
  if (depth === undefined) return geom
  return { type: geom.type, coordinates: generalise(geom.coordinates, depth) }
}

const q = (v) =>
  v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`
const b = (v) => (v === null || v === undefined ? 'null' : v ? 'true' : 'false')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function loadCatalogue() {
  if (fs.existsSync(CACHE)) {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'))
  }
  const res = await fetch(CATALOGUE_URL)
  if (!res.ok) throw new Error(`catalogue fetch failed: ${res.status}`)
  const json = await res.json()
  fs.mkdirSync(path.dirname(CACHE), { recursive: true })
  fs.writeFileSync(CACHE, JSON.stringify(json, null, 1))
  return json
}

function classify(d) {
  const layerKind = d.raster_only ? 'raster' : d.link_type === 'arcgis_rest' ? 'feature' : 'other'
  const queryable = Boolean(d.feature_queryable) && !d.raster_only
  const tier = mirrorIds.includes(d.id) && queryable ? 'geometry' : layerKind === 'raster' ? 'image' : 'metadata'
  return { layerKind, queryable, tier }
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

function queryUrl(base, offset) {
  const p = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    // Non-negotiable. The source is NZTM2000 (EPSG:2193).
    outSR: '4326',
    inSR: '4326',
    f: 'geojson',
    geometry: `${WELLINGTON.west},${WELLINGTON.south},${WELLINGTON.east},${WELLINGTON.north}`,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
  })
  return `${base.replace(/\/$/, '')}/query?${p}`
}

async function layerName(url) {
  try {
    const res = await fetch(`${url}?f=json`)
    const j = await res.json()
    return j.name || null
  } catch {
    return null
  }
}

async function fetchLayer(dataset) {
  const entry = mirrorEntry(dataset.id)
  const subs = typeof entry === 'object' && entry.sublayers ? entry.sublayers : null

  if (subs) {
    const merged = []
    let truncated = false
    let lastUrl = ''
    let status = null
    for (const sub of subs) {
      const url = `${dataset.service_root.replace(/\/$/, '')}/${sub}`
      const name = await layerName(url)
      const part = await fetchOne({ url }, 0)
      part.features.forEach((f) => {
        f.properties = { ...(f.properties || {}), sublayerId: sub, sublayer: name }
      })
      merged.push(...part.features)
      truncated = truncated || part.truncated
      lastUrl = part.url
      status = part.status
      await sleep(PAUSE_MS)
    }
    return { features: merged, truncated, url: lastUrl, status }
  }

  return fetchOne(dataset, 0)
}

async function fetchOne(dataset, startOffset) {
  const features = []
  let offset = startOffset
  let truncated = false
  let lastUrl = ''
  let status = null

  for (let page = 0; page < 20; page += 1) {
    lastUrl = queryUrl(dataset.url, offset)
    const res = await fetch(lastUrl, { headers: { Accept: 'application/json' } })
    status = res.status
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`non-JSON response (${text.slice(0, 80)})`)
    }
    // ArcGIS answers "no" with HTTP 200 and an error object in the body.
    if (json.error) throw new Error(json.error.message || 'ArcGIS error')
    if (!json.features) throw new Error('no features array — likely a raster')

    features.push(...json.features)
    truncated = Boolean(json.exceededTransferLimit || json.properties?.exceededTransferLimit)
    if (features.length >= MAX_FEATURES) {
      truncated = true
      break
    }
    if (!truncated || json.features.length === 0) break
    offset += json.features.length
    await sleep(PAUSE_MS)
  }

  return { features, truncated, url: lastUrl, status }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const catalogue = await loadCatalogue()
const datasets = catalogue.datasets
const catalogueOnly = process.argv.includes('--catalogue-only')

const out = []
const w = (s = '') => out.push(s)

w(`-- GENERATED by scripts/ingest-gis.mjs — do not edit.
--
-- ${datasets.length} datasets catalogued. Geometry mirrored for the layers a duty
-- officer needs when the network is the thing that is broken.
--
-- Everything here lands in silver, which is private. gold republishes geometry
-- only for datasets whose licence has actually been cleared; for the rest the
-- public API returns the publisher and the endpoint and says so.

set search_path = public, extensions;

truncate silver.dataset_feature, silver.source_snapshot, silver.dataset restart identity cascade;
`)

w(`insert into silver.dataset (
  id, name, display_name, theme, publisher, licence, redistributable, attribution,
  layer_kind, geometry_type, queryable, endpoint_url, source_page_url, ingest_tier,
  last_checked_at
) values`)

w(
  datasets
    .map((d) => {
      const { layerKind, queryable, tier } = classify(d)
      const publisher = d.authority || d.prepared_by || d.host || null
      const attribution = publisher ? `${d.display_name || d.name} — ${publisher}` : null
      return `  (${q(d.id)}, ${q(d.name)}, ${q(d.display_name || d.name)}, ${q(d.theme_label)}, ${q(publisher)},
   ${q(d.licence_note)}, ${b(CLEARED.has(d.id) ? true : null)}, ${q(attribution)},
   ${q(layerKind)}, ${q(d.layer_type)}, ${b(queryable)}, ${q(d.url)}, ${q(d.service_root)}, ${q(tier)},
   now())`
    })
    .join(',\n') + ';\n',
)

if (!catalogueOnly) {
  const targets = datasets.filter((d) => mirrorIds.includes(d.id) && classify(d).queryable)
  console.error(`fetching ${targets.length} layers…`)

  for (const d of targets) {
    let result = null
    let error = null
    try {
      result = await fetchLayer(d)
      console.error(`  ok    ${d.id} — ${result.features.length} features${result.truncated ? ' (TRUNCATED)' : ''}`)
    } catch (e) {
      error = e.message
      console.error(`  fail  ${d.id} — ${error}`)
    }
    await sleep(PAUSE_MS)

    // A failed fetch is recorded, not swallowed. gold.dataset_catalogue
    // publishes lastFetchError, so a layer that could not be reached says so
    // rather than looking empty.
    w(`insert into silver.source_snapshot
  (dataset_id, request_url, http_status, feature_count, exceeded_transfer_limit, complete, error)
values (${q(d.id)}, ${q(result?.url || queryUrl(d.url, 0))}, ${result?.status ?? 'null'},
        ${result ? result.features.length : 'null'}, ${b(Boolean(result?.truncated))},
        ${b(Boolean(result) && !result.truncated)}, ${q(error)});`)

    if (result && result.features.length) {
      const rows = result.features
        .filter((f) => f.geometry)
        .map((f) => {
          const id = f.id ?? f.properties?.OBJECTID ?? null
          const geom = shrinkGeometry(f.geometry)
          return `  (${q(d.id)}, ${q(id)}, extensions.st_setsrid(extensions.st_geomfromgeojson(${q(JSON.stringify(geom))}), 4326), ${q(JSON.stringify(f.properties || {}))}::jsonb, currval('silver.source_snapshot_id_seq'))`
        })
      if (rows.length) {
        w(`insert into silver.dataset_feature (dataset_id, source_feature_id, geom, props, snapshot_id) values`)
        w(rows.join(',\n') + ';')
      }
    }
    w()
  }
}

const target = path.join(root, 'supabase', 'gis-ingest.sql')
fs.writeFileSync(target, out.join('\n'))
console.error(`\nwrote ${path.relative(root, target)} (${datasets.length} datasets catalogued)`)
