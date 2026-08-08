// Checks the promises gold makes, against a running database.
//
//   npm run check                                  # local stack
//   npm run check -- https://xyz.supabase.co KEY   # the hosted project
//
// These are the claims the demo rests on. Each one is cheap to state and
// expensive to be wrong about, which is exactly the kind of thing that should
// be a test rather than a memory. Written against the HTTP API rather than the
// database, because the API is what other teams actually get — a guarantee that
// only holds when you are connected as `postgres` is not a guarantee.

const DEFAULT_URL = 'http://127.0.0.1:54321'
const DEFAULT_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const BASE = (process.argv[2] || DEFAULT_URL).replace(/\/$/, '')
const ANON = process.argv[3] || DEFAULT_ANON
const REST = `${BASE}/rest/v1`

let passed = 0
const failures = []

async function check(name, fn) {
  try {
    const detail = await fn()
    passed += 1
    console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (e) {
    failures.push({ name, message: e.message })
    console.log(`  FAIL  ${name}\n          ${e.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const get = (path, key = ANON) =>
  fetch(`${REST}/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })

const rpc = (name, body = {}, key = ANON) =>
  fetch(`${REST}/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const PII = /contact|phone|email|device|reporter_name|preview/i

console.log(`\nchecking ${BASE}\n`)

// ---------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------

await check('silver is unreachable over HTTP', async () => {
  const res = await fetch(`${REST}/report?select=contact_email`, {
    headers: { apikey: ANON, 'Accept-Profile': 'silver' },
  })
  assert(!res.ok, `silver answered with HTTP ${res.status}`)
  return `HTTP ${res.status}`
})

await check('no report field carries identifying data', async () => {
  const rows = await (await get('report?limit=50')).json()
  assert(Array.isArray(rows) && rows.length > 0, 'no reports returned')
  const leaked = Object.keys(rows[0]).filter((k) => PII.test(k))
  assert(leaked.length === 0, `exposed: ${leaked.join(', ')}`)
  return `${Object.keys(rows[0]).length} fields, none identifying`
})

await check('gold is the default schema — no header needed', async () => {
  const res = await get('report?limit=1&select=reference')
  assert(res.ok, `HTTP ${res.status}`)
  const rows = await res.json()
  assert(rows[0]?.reference, 'no reference returned')
  return rows[0].reference
})

// ---------------------------------------------------------------------------
// The published contract
// ---------------------------------------------------------------------------

await check('every report states its provenance and precision', async () => {
  const rows = await (await get('report?limit=200')).json()
  const required = [
    'isSynthetic',
    'verificationLevel',
    'locationPrecision',
    'disclaimer',
    'legacyStatus',
    'descriptionStatus',
  ]
  for (const row of rows) {
    for (const field of required) {
      assert(
        row[field] !== null && row[field] !== undefined,
        `${row.reference} is missing ${field}`,
      )
    }
  }
  return `${rows.length} reports, ${required.length} required fields each`
})

await check('legacyStatus stays inside the app’s five StatusIds', async () => {
  const allowed = new Set(['received', 'checking', 'acting', 'resolved', 'no-action'])
  const rows = await (await get('report?select=reference,legacyStatus&limit=200')).json()
  for (const r of rows) {
    assert(allowed.has(r.legacyStatus), `${r.reference} published "${r.legacyStatus}"`)
  }
  return [...new Set(rows.map((r) => r.legacyStatus))].join(', ')
})

await check('withheld descriptions are withheld, not merely blank', async () => {
  const rows = await (await get('report?select=reference,description,descriptionStatus&limit=200')).json()
  for (const r of rows) {
    if (r.descriptionStatus === 'withheld_pending_review') {
      assert(r.description === null, `${r.reference} says withheld but published text`)
    }
  }
  const held = rows.filter((r) => r.descriptionStatus === 'withheld_pending_review').length
  return `${held} of ${rows.length} held pending review`
})

await check('reports_geojson returns a valid FeatureCollection', async () => {
  const fc = await (await rpc('reports_geojson', { max_features: 500 })).json()
  assert(fc.type === 'FeatureCollection', `type was ${fc.type}`)
  assert(Array.isArray(fc.features), 'no features array')
  for (const f of fc.features) {
    const [lng, lat] = f.geometry.coordinates
    // Wellington, generously. A pin off the coast of Africa means someone
    // forgot outSR=4326 somewhere.
    assert(lat > -42.2 && lat < -40.6, `${f.properties.reference} lat ${lat} is not in Wellington`)
    assert(lng > 174.2 && lng < 175.6, `${f.properties.reference} lng ${lng} is not in Wellington`)
    assert(f.properties.disclaimer, `${f.properties.reference} has no disclaimer`)
  }
  return `${fc.features.length} features, all in Wellington, all disclaimed`
})

await check('arcgis mode drops metadata so the disclaimer survives import', async () => {
  const fc = await (await rpc('reports_geojson', { arcgis: true, max_features: 5 })).json()
  assert(fc.metadata === undefined, 'metadata was still present')
  assert(fc.features.every((f) => f.properties.disclaimer), 'a feature lost its disclaimer')
  return 'no foreign members, disclaimer on every feature'
})

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

await check('a life-safety report is refused', async () => {
  const res = await rpc('submit_report', {
    service: 'emergency',
    faultType: 'assistance',
    faultDesc: 'Contract check — expected to be refused.',
    locLatitude: -41.2951,
    locLongitude: 174.7638,
    severity: 'urgent',
  })
  const body = await res.json()
  assert(body.reference === undefined, 'the report was accepted')
  assert(/111/.test(body.message || ''), `refused, but did not mention 111: ${body.message}`)
  return 'refused, and told to call 111'
})

await check('a report outside the region is refused', async () => {
  const body = await (
    await rpc('submit_report', {
      service: 'emergency',
      faultType: 'flooding',
      faultDesc: 'Contract check — expected to be refused.',
      locLatitude: -36.85,
      locLongitude: 174.76, // Auckland
    })
  ).json()
  assert(body.reference === undefined, 'an Auckland report was accepted')
  return 'refused'
})

await check('anon cannot advance a report', async () => {
  const res = await rpc('advance_status', { reference: 'WCC-4KDPM', status: 'completed_confirmed' })
  assert(!res.ok || (await res.json()).code === '42501', 'anon was allowed to change a status')
  return `HTTP ${res.status}`
})

await check('submit → receipt round trip, and the PII does not survive it', async () => {
  const submitted = await (
    await rpc('submit_report', {
      service: 'emergency',
      faultType: 'flooding',
      faultDesc: 'Contract check — surface water across the road.',
      locLatitude: -41.3025,
      locLongitude: 174.7982,
      severity: 'info',
      locAddress: '1 Contract Check Street',
      locSuburb: 'Hataitai',
      contactFirstName: 'Check',
      contactEmail: 'check@example.org',
      contactPhone: '021 555 0000',
    })
  ).json()
  assert(submitted.reference, `submit failed: ${JSON.stringify(submitted)}`)

  // Lower case on purpose: a reference gets read back over a radio.
  const receipt = await (
    await rpc('report_receipt', { reference: submitted.reference.toLowerCase() })
  ).json()
  assert(receipt.found === true, 'receipt could not find the report just filed')
  assert(Array.isArray(receipt.timeline), 'receipt has no timeline array')
  assert(receipt.timeline.length >= 1, 'timeline is empty — no acknowledgement recorded')

  const serialised = JSON.stringify(receipt)
  for (const secret of ['check@example.org', '021 555 0000', 'Check']) {
    assert(!serialised.includes(secret), `receipt leaked ${secret}`)
  }
  return `${submitted.reference}, ${receipt.timeline.length} timeline entries, no PII`
})

// ---------------------------------------------------------------------------
// Licence gate
// ---------------------------------------------------------------------------

await check('an uncleared layer is refused, with somewhere else to go', async () => {
  const catalogue = await (
    await get('dataset_catalogue?select=id,availableVia,publisher&availableVia=eq.publisher_endpoint&limit=1')
  ).json()
  assert(catalogue.length > 0, 'no uncleared datasets in the catalogue')
  const body = await (await rpc('layer_geojson', { dataset_id: catalogue[0].id })).json()
  assert(body.error === 'not_redistributable', `expected a refusal, got ${JSON.stringify(body).slice(0, 120)}`)
  assert(body.endpointUrl, 'refused without saying where to get the data')
  return `${catalogue[0].id} → ${body.publisher}`
})

await check('a cleared layer serves, with attribution and provenance', async () => {
  const cleared = await (
    await get('dataset_catalogue?select=id&availableVia=eq.gold.layer_geojson&limit=1')
  ).json()
  assert(cleared.length > 0, 'no cleared datasets')
  const fc = await (await rpc('layer_geojson', { dataset_id: cleared[0].id })).json()
  assert(fc.type === 'FeatureCollection', `got ${JSON.stringify(fc).slice(0, 120)}`)
  assert(fc.features.length > 0, 'cleared layer returned nothing')
  assert(fc.metadata.attribution, 'served without attribution')
  assert(fc.metadata.generalisation, 'served without saying it is generalised')
  return `${cleared[0].id}, ${fc.features.length} features, attributed`
})

await check('failed fetches are visible, not swallowed', async () => {
  const rows = await (await get('dataset_catalogue?select=id,lastFetchError&ingestTier=eq.geometry')).json()
  const failed = rows.filter((r) => r.lastFetchError)
  return failed.length
    ? `${failed.length} recorded: ${failed.map((r) => r.id).join(', ')}`
    : 'none failed this run'
})

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed\n`)
if (failures.length) process.exit(1)
