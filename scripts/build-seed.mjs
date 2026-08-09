// Generates supabase/seed.sql.
//
// The output is committed, so `supabase db reset` needs nothing but psql. This
// script exists so the seed can be regenerated when the hub file or the
// taxonomy changes, not as a build step anyone has to remember to run.
//
//   node scripts/build-seed.mjs
//
// Hubs are read from wcc_emergency_hubs.geojson rather than retyped. Agencies,
// services and fault types are NOT here: they are reference data, owned by
// migration 20260808000009_reference_seed.sql.
//
// The reports are invented. They describe a hypothetical southerly, no real
// person is named, and every row carries is_synthetic = true all the way
// through to the public API.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const arr = (xs) => (xs.length ? `array[${xs.map(q).join(', ')}]` : `'{}'::text[]`)
const mins = (m) => `now() - interval '${m} minutes'`

// ---------------------------------------------------------------------------
// Agencies
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
// The first twelve are ported from prototype/lib/seed.ts so the database tells
// the same story the app already tells. The rest exercise the parts of the
// lifecycle the app has no vocabulary for yet: agency assignment, an agency
// closing its own ticket, Council confirming it, and a report reopening.
//
// `trail` entries are events after 'received', which the insert trigger writes
// automatically.

const R = (o) => o

const REPORTS = [
  // --- a cluster: five people on the same stretch of Evans Bay Parade -------
  R({
    reference: 'WCC-4KDPM', faultType: 'surface-flood', severity: 'disruption', photos: 1,
    faultDesc: 'Water across both lanes outside the marina, about ankle deep. Cars slowing right down.',
    locAddress: 'Evans Bay Parade, Hataitai', locSuburb: 'Hataitai',
    lat: -41.3025, lng: 174.7982, minutesAgo: 74,
    trail: [
      { status: 'under_review', minutesAgo: 66, note: 'Duty officer picked this up.', by: 'WCC Emergency Management' },
      { status: 'assigned', minutesAgo: 52, note: 'Passed to Tiaki Wai to clear the sumps.', agency: 'TIAKI-WAI', ticket: 'TW-2026-114872' },
    ],
  }),
  R({
    reference: 'WCC-9WQHT', faultType: 'surface-flood', severity: 'disruption',
    faultDesc: 'Surface flooding by the boat sheds, getting deeper than an hour ago.',
    locAddress: 'Evans Bay Parade, near Cog Park', locSuburb: 'Hataitai',
    lat: -41.3041, lng: 174.7967, minutesAgo: 52,
  }),
  R({
    reference: 'WCC-2FMRX', faultType: 'surface-flood', severity: 'info', photos: 1,
    faultDesc: 'Drain blocked with leaves, water backing up over the footpath.',
    locAddress: 'Evans Bay Parade', locSuburb: 'Hataitai',
    lat: -41.3009, lng: 174.7995, minutesAgo: 41,
  }),
  R({
    reference: 'WCC-7YHKC', faultType: 'surface-flood', severity: 'disruption',
    faultDesc: 'Hub team walked the parade. Water over the kerb for roughly 200m, passable but slow.',
    locAddress: 'Evans Bay Parade, Hataitai', locSuburb: 'Hataitai',
    lat: -41.3033, lng: 174.7975, minutesAgo: 22,
    reporterKind: 'hub', hubName: 'Hataitai (North) - Hataitai School',
    // A hub walking the length of the street and reporting what they saw is a
    // different kind of evidence from a passer-by's guess.
    verification: 'field_confirmed',
  }),
  R({
    reference: 'WCC-7KRND', faultType: 'surface-flood', severity: 'urgent',
    faultDesc: 'Water is up to the door sills on parked cars now. Someone has driven into it and stalled.',
    locAddress: 'Evans Bay Parade, opposite the marina', locSuburb: 'Hataitai',
    lat: -41.3018, lng: 174.7989, minutesAgo: 14,
  }),

  // --- a slip on the Ngaio Gorge road --------------------------------------
  R({
    reference: 'WCC-6TRLA', faultType: 'slip', severity: 'urgent', photos: 2,
    faultDesc: 'Slip has come down onto the southbound lane, maybe two metres across. One lane still open.',
    locAddress: 'Ngaio Gorge Road, Kaiwharawhara', locSuburb: 'Wadestown',
    lat: -41.2599, lng: 174.7787, minutesAgo: 96,
    trail: [
      { status: 'under_review', minutesAgo: 88, note: 'Duty officer has this. Confirming with the roading contractor now.', by: 'WCC Emergency Management' },
      { status: 'responding', minutesAgo: 70, note: 'Contractor dispatched.', by: 'WCC Emergency Management' },
    ],
  }),
  R({
    reference: 'WCC-3NPGE', faultType: 'slip', severity: 'urgent', reporterKind: 'community-group',
    faultDesc: 'Same slip — mud is still moving, would not send a bus through.',
    locAddress: 'Ngaio Gorge Road', locSuburb: 'Wadestown',
    lat: -41.2604, lng: 174.7791, minutesAgo: 63,
  }),
  R({
    reference: 'WCC-3TWQE', faultType: 'slip', severity: 'urgent',
    faultDesc: 'More has come down since the last one. Both lanes now, nothing getting through.',
    locAddress: 'Ngaio Gorge Road', locSuburb: 'Wadestown',
    lat: -41.2608, lng: 174.7783, minutesAgo: 31,
  }),

  // --- scattered singles ----------------------------------------------------
  R({
    reference: 'WCC-8CJVD', faultType: 'tree-down', severity: 'disruption', photos: 1,
    faultDesc: 'Large pine down across the footpath at the top of the park. Blocking the whole path.',
    locAddress: 'Central Park, Brooklyn', locSuburb: 'Brooklyn',
    lat: -41.3005, lng: 174.7681, minutesAgo: 130,
    verification: 'official',
    trail: [
      { status: 'assigned', minutesAgo: 110, note: 'Tasked to the parks crew.', agency: 'WCC', ticket: 'PK-88412' },
      { status: 'fixed', minutesAgo: 64, note: 'Tree cut back and path cleared.', agency: 'WCC', ticket: 'PK-88412' },
      { status: 'completed_confirmed', minutesAgo: 40, note: 'Checked on site. Path is open.', by: 'WCC Emergency Management' },
    ],
  }),
  R({
    reference: 'WCC-5QAXM', faultType: 'surface-flood', severity: 'disruption', photos: 1,
    faultDesc: 'Waves coming right over the sea wall onto the road at high tide, gravel everywhere.',
    locAddress: 'The Esplanade, Island Bay', locSuburb: 'Island Bay',
    lat: -41.3403, lng: 174.7716, minutesAgo: 58,
  }),
  R({
    reference: 'WCC-4HLWU', faultType: 'road-closure', severity: 'urgent',
    faultDesc: 'Road closed by debris just past the corner, no way through for a car.',
    locAddress: 'Happy Valley Road, Owhiro Bay', locSuburb: 'Owhiro Bay',
    lat: -41.3437, lng: 174.7549, minutesAgo: 35,
  }),
  R({
    reference: 'WCC-9EDKT', faultType: 'hub-status', severity: 'info', reporterKind: 'hub',
    faultDesc: 'Hub is open and staffed. Twelve volunteers, generator running, radio contact good. We can take walk-ins.',
    locAddress: 'Newtown School, Mein Street', locSuburb: 'Newtown',
    lat: -41.3115, lng: 174.7802, minutesAgo: 28,
    hubName: 'Newtown - Newtown School', verification: 'official', sourceChannel: 'hub_radio',
  }),
  R({
    reference: 'WCC-2GVRP', faultType: 'road-closure', severity: 'urgent',
    faultDesc: 'Six houses up the lane have no vehicle access, slip at the bottom of the driveway.',
    locAddress: 'Rawhiti Terrace, Kelburn', locSuburb: 'Kelburn',
    lat: -41.2851, lng: 174.7615, minutesAgo: 17,
    // Names a small group of households and their situation. 'road-closure'
    // publishes at street level, which is right for a blocked road and wrong
    // for this, so it is overridden per report.
    precision: 'zone_100m',
  }),
  R({
    // Kept verbatim from prototype/lib/seed.ts and reports.geojson, 'Z' and all,
    // even though generate_reference() would never mint one — the point is that
    // the existing demo references still resolve.
    reference: 'WCC-7BMQZ', service: 'roads', faultType: 'pothole', severity: 'info',
    faultDesc: 'Pothole opened up after the rain, about 40cm across and deep enough to hear it.',
    locAddress: 'Adelaide Road, Newtown', locSuburb: 'Newtown',
    lat: -41.3092, lng: 174.7794, minutesAgo: 155,
  }),

  // --- lifecycle cases the app has no vocabulary for yet --------------------
  R({
    reference: 'WCC-6HMPX', faultType: 'service-outage', severity: 'disruption', sourceChannel: 'phone',
    faultDesc: 'Power off along the top of the hill, about thirty houses by the look of it.',
    locAddress: 'Curtis Street, Karori', locSuburb: 'Karori',
    lat: -41.2864, lng: 174.7401, minutesAgo: 142,
    trail: [
      { status: 'assigned', minutesAgo: 132, note: 'Referred to Wellington Electricity.', agency: 'WELLINGTON-ELECTRICITY', ticket: 'WE-559021' },
      { status: 'fixed', minutesAgo: 46, note: 'Fault found and repaired, supply restored.', agency: 'WELLINGTON-ELECTRICITY', ticket: 'WE-559021' },
    ],
  }),
  R({
    reference: 'WCC-9FDCR', faultType: 'service-outage', severity: 'urgent', sourceChannel: 'phone',
    faultDesc: 'Main has burst at the intersection, water running down the hill and no supply to the houses above.',
    locAddress: 'Coutts Street, Kilbirnie', locSuburb: 'Kilbirnie',
    lat: -41.3241, lng: 174.7969, minutesAgo: 88,
    trail: [
      { status: 'assigned', minutesAgo: 80, note: 'With Tiaki Wai, crew en route.', agency: 'TIAKI-WAI', ticket: 'TW-2026-114901' },
      { status: 'responding', minutesAgo: 35, note: 'Crew on site, excavating to reach the main.', agency: 'TIAKI-WAI', ticket: 'TW-2026-114901' },
    ],
  }),
  R({
    reference: 'WCC-4NPGD', faultType: 'surface-flood', severity: 'urgent',
    faultDesc: 'Sea is over the road again on the high tide. It was cleared this morning but it is back.',
    locAddress: 'Owhiro Bay Parade', locSuburb: 'Owhiro Bay',
    lat: -41.3459, lng: 174.7625, minutesAgo: 120,
    // Reopened. The trail keeps the earlier closure rather than erasing it,
    // which is the entire argument for the event log being append-only.
    trail: [
      { status: 'responding', minutesAgo: 112, note: 'Contractor clearing the gravel.', by: 'WCC Emergency Management' },
      { status: 'completed_confirmed', minutesAgo: 90, note: 'Road cleared and reopened.', by: 'WCC Emergency Management' },
      { status: 'reassessing', minutesAgo: 20, note: 'Reported again on the next tide. Reopened for assessment.', by: 'WCC Emergency Management' },
    ],
  }),
  R({
    reference: 'WCC-8JQAW', faultType: 'tree-down', severity: 'disruption',
    faultDesc: 'Big branch down blocking one lane outside the school. Cars going around it on the wrong side.',
    locAddress: 'Cashmere Avenue, Khandallah', locSuburb: 'Khandallah',
    lat: -41.2477, lng: 174.7982, minutesAgo: 104,
    trail: [
      { status: 'under_review', minutesAgo: 96, note: 'Confirming with the parks team.', by: 'WCC Emergency Management' },
      { status: 'assigned', minutesAgo: 84, note: 'Tasked to the parks crew.', agency: 'WCC', ticket: 'PK-88437' },
    ],
  }),
  R({
    reference: 'WCC-2XLVT', faultType: 'road-closure', severity: 'urgent',
    faultDesc: 'Tree across the road about a kilometre past the school, no way through.',
    locAddress: 'Makara Road', locSuburb: 'Makara',
    lat: -41.2688, lng: 174.7044, minutesAgo: 175,
    verification: 'official',
    trail: [
      { status: 'assigned', minutesAgo: 160, note: 'Roading contractor tasked.', agency: 'WCC', ticket: 'RD-40221' },
      { status: 'fixed', minutesAgo: 105, note: 'Tree removed, road open to one lane.', agency: 'WCC', ticket: 'RD-40221' },
      { status: 'completed_confirmed', minutesAgo: 92, note: 'Confirmed open both lanes.', by: 'WCC Emergency Management' },
    ],
  }),
  R({
    reference: 'WCC-5CDHY', faultType: 'surface-flood', severity: 'disruption',
    faultDesc: 'Stream has come up over the walkway by the shops, about knee deep at the low point.',
    locAddress: 'Main Road, Tawa', locSuburb: 'Tawa',
    lat: -41.1731, lng: 174.8259, minutesAgo: 67,
    trail: [{ status: 'under_review', minutesAgo: 55, note: 'Checking against the river level gauge.', by: 'WCC Emergency Management' }],
  }),
  R({
    reference: 'WCC-7VMKA', faultType: 'slip', severity: 'disruption',
    faultDesc: 'Bank has slumped onto the track behind the houses. Nothing hit, but it is still moving.',
    locAddress: 'Houghton Bay Road', locSuburb: 'Houghton Bay',
    lat: -41.3339, lng: 174.7871, minutesAgo: 49,
  }),
  R({
    reference: 'WCC-3RQWE', faultType: 'road-closure', severity: 'urgent',
    precision: 'zone_100m',
    faultDesc: 'Only road out is blocked by a slip. Four households up here, one with a person on home oxygen.',
    locAddress: 'Maida Vale Road, Roseneath', locSuburb: 'Roseneath',
    lat: -41.2874, lng: 174.8028, minutesAgo: 38,
    trail: [{ status: 'under_review', minutesAgo: 30, note: 'Escalated to WREMO for welfare check.', by: 'WCC Emergency Management' }],
  }),
  R({
    reference: 'WCC-6TXNP', faultType: 'hub-status', severity: 'info', reporterKind: 'hub',
    faultDesc: 'Karori hub open. Power on, about forty people through so far, running low on drinking water.',
    locAddress: 'Karori Community Centre, Beauchamp Street', locSuburb: 'Karori',
    lat: -41.2852, lng: 174.7382, minutesAgo: 26,
    hubName: 'Karori - Karori Community Centre', verification: 'official', sourceChannel: 'hub_radio',
  }),
  // The redaction case. Someone typed a neighbour's name and phone number into
  // a public report form, which is exactly what people do. gold publishes
  // descriptionStatus = 'withheld_pending_review' and no text at all.
  R({
    reference: 'WCC-9LHCM', faultType: 'tree-down', severity: 'disruption',
    faultDesc: 'Tree came down from the section above onto our fence. Belongs to the Andersons at 14 Holloway Road, their number is 021 555 0134 if you need to get hold of them.',
    locAddress: 'Holloway Road, Aro Valley', locSuburb: 'Aro Valley',
    lat: -41.2951, lng: 174.7638, minutesAgo: 57,
    piiReviewed: false,
  }),
  R({
    reference: 'WCC-2WKDF', service: 'roads', faultType: 'footpath', severity: 'info',
    faultDesc: 'Footpath slab has lifted outside the shops, easy to trip on.',
    locAddress: 'Johnsonville Road', locSuburb: 'Johnsonville',
    lat: -41.2237, lng: 174.8043, minutesAgo: 190,
    trail: [
      { status: 'under_review', minutesAgo: 150, note: 'Inspected.', by: 'WCC Roading' },
      { status: 'no_action', minutesAgo: 140, note: 'Lip is under the 20mm threshold. Added to the resurfacing list rather than an urgent repair.', by: 'WCC Roading' },
    ],
  }),
  R({
    reference: 'WCC-8QARM', faultType: 'surface-flood', severity: 'info',
    faultDesc: 'Water pooling across the car park entrance, not deep but it is spreading.',
    locAddress: 'Park Road, Miramar', locSuburb: 'Miramar',
    lat: -41.3179, lng: 174.8154, minutesAgo: 44,
  }),
  R({
    reference: 'WCC-4GJTV', faultType: 'road-closure', severity: 'disruption',
    faultDesc: 'Slip debris across one lane on the bend, passable slowly but not in the dark.',
    locAddress: 'Seatoun Heights Road', locSuburb: 'Seatoun',
    lat: -41.3251, lng: 174.8331, minutesAgo: 72,
    trail: [{ status: 'assigned', minutesAgo: 60, note: 'Roading contractor tasked.', agency: 'WCC', ticket: 'RD-40238' }],
  }),
  R({
    reference: 'WCC-5HNWQ', service: 'roads', faultType: 'drain', severity: 'disruption',
    faultDesc: 'Strip drain across the road is completely blocked, water backing up into the driveways.',
    locAddress: 'Britomart Street, Berhampore', locSuburb: 'Berhampore',
    lat: -41.3207, lng: 174.7729, minutesAgo: 81,
    trail: [{ status: 'assigned', minutesAgo: 70, note: 'Referred to Tiaki Wai.', agency: 'TIAKI-WAI', ticket: 'TW-2026-114888' }],
  }),
]

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const hubs = JSON.parse(fs.readFileSync(path.join(root, 'wcc_emergency_hubs.geojson'), 'utf8'))

const out = []
const w = (s = '') => out.push(s)

w(`-- GENERATED by scripts/build-seed.mjs — edit that, not this.
--
-- Reference data (agencies, services, fault types) and 36 real Community
-- Emergency Hubs, plus ${REPORTS.length} invented reports describing a hypothetical
-- southerly. No real person is named. Every report row carries
-- is_synthetic = true, which the public API publishes as isSynthetic so nobody
-- downstream can mistake demo data for a real report.

set search_path = public, extensions;

-- Reports and hubs only. Agencies, services and fault types are reference data
-- owned by migration 20260808000009_reference_seed.sql, which carries WCC's
-- ownership and priority classification — truncating them here would silently
-- throw that away every time the seed is re-run.
truncate silver.report_cluster_member, silver.report_cluster,
         silver.report_status_event, silver.report_photo, silver.report,
         silver.hub
  restart identity cascade;
`)

w(`-- Community Emergency Hubs -------------------------------------------------
-- Greater Wellington Regional Council Open Data, filtered to TA_NAME = 'Wellington City'.
insert into silver.hub (name, address, suburb, source_objectid, geom) values`)
w(
  hubs.features
    .map((f) => {
      const p = f.properties
      const [lng, lat] = f.geometry.coordinates
      return `  (${q(p.NAME)}, ${q(p.ADDRESS)}, ${q(p.SUBURB)}, ${p.OBJECTID}, extensions.st_setsrid(extensions.st_makepoint(${lng.toFixed(8)}, ${lat.toFixed(8)}), 4326))`
    })
    .join(',\n') + ';\n',
)

w(`-- Reports ------------------------------------------------------------------`)
w(`insert into silver.report (
  reference, service, fault_type, severity, fault_desc,
  geom, loc_address, loc_suburb, precision_override,
  reporter_kind, hub_id,
  attachment_upload_keys, photo_count,
  observed_at, submitted_at,
  verification_level, is_synthetic, source_channel,
  description_public, pii_reviewed
) values`)
w(
  REPORTS.map((r) => {
    const photos = r.photos || 0
    const keys = Array.from({ length: photos }, (_, i) => `demo/${r.reference}-${i + 1}.jpg`)
    const piiReviewed = r.piiReviewed !== false
    const hub = r.hubName
      ? `(select id from silver.hub where name = ${q(r.hubName)})`
      : 'null'
    return `  (${q(r.reference)}, ${q(r.service || 'emergency')}, ${q(r.faultType)}, ${q(r.severity)}, ${q(r.faultDesc)},
   extensions.st_setsrid(extensions.st_makepoint(${r.lng}, ${r.lat}), 4326), ${q(r.locAddress)}, ${q(r.locSuburb)}, ${q(r.precision)},
   ${q(r.reporterKind || 'resident')}, ${hub},
   ${arr(keys)}, ${photos},
   ${mins(r.minutesAgo)}, ${mins(r.minutesAgo)},
   ${q(r.verification || 'unverified')}, true, ${q(r.sourceChannel || 'seed')},
   ${piiReviewed ? q(r.faultDesc) : 'null'}, ${piiReviewed})`
  }).join(',\n') + ';\n',
)

const trails = REPORTS.filter((r) => r.trail && r.trail.length)
if (trails.length) {
  w(`-- Status trails -------------------------------------------------------------
-- Appended after the 'received' event each report gets from its insert trigger.
insert into silver.report_status_event
  (report_id, status, note, actor_role, actor_agency_id, actor_label, external_ticket_ref, at)
values`)
  const rows = []
  for (const r of trails) {
    for (const t of r.trail) {
      const agency = t.agency
        ? `(select id from silver.agency where code = ${q(t.agency)})`
        : 'null'
      rows.push(
        `  ((select id from silver.report where reference = ${q(r.reference)}), ${q(t.status)}, ${q(t.note)}, ${q(t.agency ? 'agency' : 'wcc_duty_officer')}, ${agency}, ${q(t.by || (t.agency ? null : 'WCC Emergency Management'))}, ${q(t.ticket)}, ${mins(t.minutesAgo)})`,
      )
    }
  }
  w(rows.join(',\n') + ';\n')
}

w(`-- Grouping -----------------------------------------------------------------
-- Also promotes members of any cluster of three or more to 'corroborated'.
select silver.rebuild_clusters();
`)

fs.writeFileSync(path.join(root, 'supabase', 'seed.sql'), out.join('\n'))
console.log(
  `seed.sql written: ${hubs.features.length} hubs, ${REPORTS.length} reports, ` +
    `${trails.reduce((n, r) => n + r.trail.length, 0)} status events`,
)
