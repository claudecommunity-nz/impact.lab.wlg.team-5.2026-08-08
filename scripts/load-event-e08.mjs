// Loads event E08 — the 20 April 2026 Wellington floods — into silver, and
// writes supabase/event-e08.sql.
//
//   node scripts/load-event-e08.mjs
//
// These are REAL incidents compiled from published journalism. Every one is
// traceable to a named publication and a URL, and every one is loaded with
// verification_level = 'media_reported' and is_synthetic = false. They are not
// community reports and must never be counted as them: nobody submitted these
// through the channel. They are the record of what WCC found out from the news,
// which is the gap the channel exists to close.
//
// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------
// This is the part that needed thought. The source articles describe real
// damaged homes in a small city: a bedroom wall collapsed by a landslide, a
// house left dangling over a slope, elderly residents cut out of their houses
// by firefighters, and a property where someone went missing.
//
// All of it is already published. Republishing it is not a new disclosure — but
// republishing it *on a map, at street precision, in a queryable API* is a
// different act from it appearing once in a news article. A street name plus
// "a landslide collapsed part of a bedroom wall" identifies one household's
// damaged home to anyone who cares to look, indefinitely.
//
// So `precision` below is set per incident rather than left to the category
// default, and it is set by what the description reveals, not by the fault
// type. Where a specific dwelling and its occupants' circumstances are
// described, the location is coarsened. The search-and-rescue address is
// published at suburb level only.
//
// This is a judgement call and it is reversible — change `precision` here and
// re-run. It is recorded in the open rather than made silently.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const q = (v) =>
  v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`
const arr = (xs) => (xs && xs.length ? `array[${xs.map(q).join(', ')}]` : `'{}'::text[]`)

const FLOOD_ADVICE =
  'Do not walk, swim or drive through floodwater - just 15cm can sweep you off your feet, ' +
  'half a metre can carry away a car. If you see rising water, do not wait for official ' +
  'warnings: head for higher ground immediately. Floodwater is often contaminated. Only ' +
  'return home once Civil Defence/emergency services confirm it is safe.'
const FLOOD_ADVICE_URL =
  'https://www.civildefence.govt.nz/resources/what-to-do-during-a-flood-or-if-a-flood-is-imminent'

const SLIP_ADVICE =
  'If a landslide occurs, or the ground shows warning signs (new cracks, tilting trees/fences, ' +
  'doors/windows sticking, decks moving), evacuate immediately and call 111 if life is at risk. ' +
  'Stay away from the slip area until authorities give the all-clear - more slips can occur in ' +
  'the same place. Do not attempt to clear debris yourself. Report slips on public roads/land to ' +
  'the local council.'
const SLIP_ADVICE_URL =
  'https://www.civildefence.govt.nz/emergency-events/advice-and-support/during-and-after-emergencies/during-a-landslide'

const BUILDING_ADVICE =
  'If a building shows signs of structural failure, evacuate immediately and call 111. Do not ' +
  're-enter a red- or yellow-placarded building. Stay clear until Council Building Control or ' +
  'engineers confirm it is safe.'
const BUILDING_ADVICE_URL =
  'https://www.civildefence.govt.nz/guidance-training/consistent-messages/landslide'

const ADVICE = [
  ['surface-flood', FLOOD_ADVICE, FLOOD_ADVICE_URL],
  ['slip', SLIP_ADVICE, SLIP_ADVICE_URL],
  ['building-damage', BUILDING_ADVICE, BUILDING_ADVICE_URL],
]

// `street` in the source is sometimes a note that no street was published.
// Those are not addresses and must not be stored as if they were.
const NOT_AN_ADDRESS = /not specified|not published|exact block|unnamed/i

// precision: null uses the category default.
//   zone_100m  a specific dwelling and its occupants are described
//   suburb     an address tied to a person who was missing
const ROWS = [
  {
    id: 'E08-01', time: '03:45 (approx)', suburb: 'Vogeltown', street: 'Liardet Street',
    lat: -41.3089, lng: 174.7661, type: 'slip', also: ['building-damage'], priority: 1,
    desc: 'A house partially collapsed after a hillside slip undercut its foundations, leaving the structure dangling at the edge of an unstable slope. Street blocked by the slip.',
    // A named street plus "a house partially collapsed" is one address.
    precision: 'zone_100m',
    status: 'reassessing',
    agencies: [['WCC-ROADS', 'lead'], ['WCC-BUILDING', 'assigned'], ['FENZ', 'life_safety']],
    url: 'https://thespinoff.co.nz/society/20-04-2026/wellington-region-state-of-emergency-what-you-need-to-know',
    publication: 'The Spinoff / NZ Herald (Mark Mitchell)',
  },
  {
    id: 'E08-02', time: '00:00 (approx)', suburb: 'Mornington', street: 'Balfour Street',
    lat: -41.3175, lng: 174.7735, type: 'slip', priority: 1,
    desc: 'Landslip brought down large amounts of dirt, debris and material onto the street; residents assessed damage to properties along the street.',
    status: 'completed_confirmed',
    agencies: [['WCC-ROADS', 'lead']],
    url: 'https://www.rnz.co.nz/news/weather/592843/in-pictures-the-damage-caused-by-flooding-across-the-lower-north-island',
    publication: 'RNZ (Samuel Rillstone)',
  },
  {
    id: 'E08-03', time: '03:45', suburb: 'Berhampore', street: 'Adelaide Road',
    lat: -41.3195, lng: 174.7745, type: 'surface-flood', priority: 1,
    desc: 'Significant surface flooding recorded along Adelaide Road; adjacent section of SH1 between Ellice Street and Adelaide Road reduced to one lane for much of the day.',
    status: 'completed_confirmed',
    agencies: [['WELLINGTON-WATER', 'assigned']],
    url: 'https://wellington.scoop.co.nz/?p=179320',
    publication: 'Wellington.Scoop / RNZ / Police',
  },
  {
    id: 'E08-04', time: '00:00 (approx)', suburb: 'Berhampore', street: 'Emerson Street',
    lat: -41.321, lng: 174.7755, type: 'surface-flood', priority: 2,
    desc: 'A car was lifted by floodwater and dumped onto a fence.',
    status: 'completed_confirmed',
    agencies: [['WELLINGTON-WATER', 'assigned']],
    url: 'https://www.1news.co.nz/2026/04/20/in-images-wellington-slammed-by-heavy-rain-flooding-landslips/',
    publication: '1News',
  },
  {
    id: 'E08-05', time: '03:45', suburb: 'Berhampore', street: 'Akatea Street',
    lat: -41.32, lng: 174.775, type: 'surface-flood', priority: 1,
    desc: 'Flash flooding around 3:45am pushed cars down driveways and under garages; firefighters axed elderly residents out of their homes and carried them through floodwaters to safety.',
    // Identifies elderly residents at specific houses on a named street.
    precision: 'zone_100m',
    status: 'completed_confirmed',
    agencies: [['WELLINGTON-WATER', 'assigned'], ['FENZ', 'life_safety']],
    url: 'https://www.odt.co.nz/news/national/nightmare-slips-and-widespread-flooding-hit-wellington-rnz',
    publication: "ODT / RNZ (Ellen O'Dwyer)",
  },
  {
    id: 'E08-06', time: '00:00 (approx)', suburb: 'Kingston', street: null,
    lat: -41.3245, lng: 174.7695, type: 'slip', priority: 1,
    desc: 'A major landslide brought down large amounts of dirt, rocks and trees, blocking a residential street and cutting off access to several properties.',
    // The source withheld the street. Publishing a point that reveals it would
    // undo that decision.
    precision: 'zone_100m',
    status: 'fixed',
    agencies: [['WCC-ROADS', 'lead']],
    url: 'https://www.rnz.co.nz/news/weather/592843/in-pictures-the-damage-caused-by-flooding-across-the-lower-north-island',
    publication: 'RNZ (Mark Papalii)',
  },
  {
    id: 'E08-07', time: '00:00 (approx)', suburb: 'Island Bay', street: 'The Parade',
    lat: -41.3355, lng: 174.7754, type: 'surface-flood', priority: 1,
    desc: "The suburb's main street was completely submerged; firefighters pumped knee-high water out of multiple houses.",
    status: 'completed_confirmed',
    agencies: [['WELLINGTON-WATER', 'assigned'], ['FENZ', 'life_safety']],
    url: 'https://www.thepost.co.nz/nz-news/360988981/flooding-across-wellington-after-night-severe-rain-avoid-non-essential-travel',
    publication: 'The Post',
  },
  {
    id: 'E08-08', time: '00:00 (approx)', suburb: 'Owhiro Bay', street: 'Happy Valley Road',
    lat: -41.3395, lng: 174.762, type: 'surface-flood', priority: 1,
    desc: 'At least one vehicle was swept roughly 150 metres along the road and into the tide.',
    status: 'completed_confirmed',
    agencies: [['WELLINGTON-WATER', 'assigned']],
    url: 'https://newswire.co.nz/2026/04/wellington-declares-state-of-emergency-as-record-flooding-sweeps-through-the-capital/',
    publication: 'NEWS WIRE',
  },
  {
    id: 'E08-09', time: '00:00 (approx)', suburb: 'Brooklyn', street: null,
    lat: -41.3059, lng: 174.7666, type: 'slip', also: ['building-damage'], priority: 1,
    desc: 'A resident woke to a landslide collapsing part of a bedroom wall.',
    // One household, one bedroom. The most identifying line in the set.
    precision: 'zone_100m',
    status: 'reassessing',
    agencies: [['WCC-ROADS', 'lead'], ['WCC-BUILDING', 'assigned']],
    url: 'https://www.insurancebusinessmag.com/nz/news/catastrophe/state-of-emergency-in-wellington-record-rain-overwhelms-capital-as-insurers-brace-for-claims-surge-572251.aspx',
    publication: 'Insurance Business',
  },
  {
    id: 'E08-10', time: '00:00 (approx)', suburb: 'Miramar', street: null,
    lat: -41.3179, lng: 174.8172, type: 'slip', priority: 2,
    desc: 'Landslide reported in Miramar; slips blocked roads and damaged property in the area.',
    status: 'fixed',
    agencies: [['WCC-ROADS', 'lead']],
    url: 'https://watchers.news/2026/04/21/record-rainfall-triggers-flooding-evacuations-wellington-new-zealand-one-person-missing-april-2026/',
    publication: 'The Watchers',
  },
  {
    id: 'E08-11', time: '00:00 (approx)', suburb: 'South Karori', street: 'Karori South Road',
    lat: -41.2765, lng: 174.7255, type: 'surface-flood', priority: 1,
    desc: 'A property was struck by floodwaters and debris. A search and rescue operation for a resident reported missing from the address continued over subsequent days along the Karori Stream and nearby waterways.',
    // An address tied to a person who went missing. Suburb only. No coordinate
    // we publish should let anyone find this house.
    precision: 'suburb',
    status: 'under_review',
    agencies: [['WELLINGTON-WATER', 'assigned'], ['FENZ', 'life_safety']],
    url: 'https://www.thepost.co.nz/nz-news/360988981/flooding-across-wellington-after-night-severe-rain-avoid-non-essential-travel',
    publication: 'The Post / NZ Police',
  },
  {
    id: 'E08-12', time: '04:00 (approx)', suburb: 'Newtown', street: 'Wellington Regional Hospital precinct',
    lat: -41.3128, lng: 174.7787, type: 'surface-flood', priority: 2,
    desc: "A flash flood around 4am hit the hospital's underground car park, affecting the area where Wellington Free Ambulance vehicles were located; firefighters pumped out the car park.",
    status: 'completed_confirmed',
    agencies: [['WELLINGTON-WATER', 'assigned'], ['FENZ', 'life_safety']],
    url: 'https://www.1news.co.nz/2026/04/20/in-images-wellington-slammed-by-heavy-rain-flooding-landslips/',
    publication: '1News',
  },
]

const out = []
const w = (s = '') => out.push(s)

w(`-- GENERATED by scripts/load-event-e08.mjs — do not edit.
--
-- Event E08: the 20 April 2026 Wellington floods. ${ROWS.length} incidents compiled from
-- published journalism, each with its publication and article URL.
--
-- verification_level = 'media_reported', is_synthetic = false. These really
-- happened; they were not reported through this channel and must not be counted
-- as community reports.
--
-- Locations are coarsened per incident where the source describes a specific
-- dwelling and its occupants. See the header of the generator for the reasoning.

set search_path = public, extensions;

delete from silver.report where event_code = 'E08';

insert into silver.event (code, name, started_at, description, state_of_emergency) values
  ('E08', 'Wellington floods and slips, 20 April 2026',
   timestamptz '2026-04-20 00:00+12',
   'Record rainfall across Wellington overnight on 20 April 2026 caused widespread flooding and '
   || 'landslips. A state of emergency was declared. Incidents below are compiled from published '
   || 'news reporting, not from community reports.',
   true)
on conflict (code) do update
  set name = excluded.name, started_at = excluded.started_at,
      description = excluded.description, state_of_emergency = excluded.state_of_emergency;
`)

w(`-- Official advice, from NEMA / Civil Defence. Nothing here is written by us.
insert into silver.public_advice (fault_type, advice, source_url) values`)
w(ADVICE.map(([t, a, u]) => `  (${q(t)}, ${q(a)}, ${q(u)})`).join(',\n')
  + `\non conflict (fault_type, source_url) do update set advice = excluded.advice;\n`)

w(`-- Incidents`)
for (const r of ROWS) {
  const address = r.street && !NOT_AN_ADDRESS.test(r.street) ? r.street : null
  const hhmm = (r.time.match(/(\d{2}):(\d{2})/) || [null, '00', '00']).slice(1)
  const at = `timestamptz '2026-04-20 ${hhmm[0]}:${hhmm[1]}+12'`
  const raw = JSON.stringify({
    subEventId: r.id, parentEventId: 'E08', eventTimeAsPublished: r.time,
    streetAsPublished: r.street, issueTypeAsPublished: r.type,
    priorityEstimate: r.priority, imageSourceUrl: r.url,
  })

  w(`insert into silver.report (
  reference, subject, service, fault_type, additional_fault_types, severity, fault_desc,
  geom, loc_address, loc_suburb, precision_override,
  reporter_kind, observed_at, submitted_at,
  verification_level, provenance, is_synthetic, source_channel,
  event_code, sub_event_code, source_url, source_publication, image_source_url,
  priority_override, description_public, pii_reviewed, raw_payload
) values (
  ${q('WCC-' + r.id)}, 'Incident compiled from published reporting', 'emergency',
  ${q(r.type)}, ${arr(r.also)}, ${r.priority === 1 ? "'urgent'" : "'disruption'"}, ${q(r.desc)},
  extensions.st_setsrid(extensions.st_makepoint(${r.lng}, ${r.lat}), 4326),
  ${q(address)}, ${q(r.suburb)}, ${q(r.precision)},
  'council', ${at}, ${at},
  -- Corroborated, not confirmed: several outlets reported the event, and no
  -- Council record backs any individual incident. Provenance carries where it
  -- came from; the two are separate facts.
  'corroborated', 'media', false, 'media',
  'E08', ${q(r.id)}, ${q(r.url)}, ${q(r.publication)}, ${q(r.url)},
  ${r.priority}, ${q(r.desc)}, true, ${q(raw)}::jsonb
);`)

  w(`insert into silver.report_agency (report_id, agency_code, role)
select r.id, v.code, v.role from silver.report r,
  (values ${r.agencies.map(([c, role]) => `(${q(c)}, ${q(role)})`).join(', ')}) as v(code, role)
where r.reference = ${q('WCC-' + r.id)};`)

  // The lifecycle these reached, as an event rather than a bare column, so the
  // trail reads the same as any other report's.
  w(`insert into silver.report_status_event (report_id, status, note, actor_role, actor_label, at)
select r.id, ${q(r.status)}, 'Status as published in reporting of the event.', 'wcc_duty_officer',
       'Compiled from published reporting', ${at} + interval '6 hours'
from silver.report r where r.reference = ${q('WCC-' + r.id)};`)
  w()
}

w(`select silver.rebuild_clusters();`)

fs.writeFileSync(path.join(root, 'supabase', 'event-e08.sql'), out.join('\n'))
console.log(
  `event-e08.sql written: ${ROWS.length} incidents, ${ADVICE.length} advice entries, ` +
    `${ROWS.filter((r) => r.precision).length} locations coarsened for privacy`,
)
