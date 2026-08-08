// Demo reports at real Wellington locations, so the console has something in it
// before anyone submits. Timestamps are relative to whenever the store is first
// created, which keeps the demo looking live no matter when it runs.
//
// These are invented reports about a hypothetical southerly. They are not real
// incidents and no real person is named.

import type { Report, ReporterKindId, SeverityId, StatusId, TimelineEntry } from './types'

interface SeedInput {
  reference: string
  service?: string
  faultType: string
  faultDesc: string
  locAddress: string
  locSuburb?: string
  lat: number
  lng: number
  severity?: SeverityId
  reporterKind?: ReporterKindId
  hubName?: string | null
  minutesAgo: number
  status?: StatusId
  statusNote?: string | null
  photos?: number
}

const MINUTE = 60 * 1000

function at(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * MINUTE).toISOString()
}

function report({
  reference,
  service = 'emergency',
  faultType,
  faultDesc,
  locAddress,
  locSuburb,
  lat,
  lng,
  severity = 'disruption',
  reporterKind = 'resident',
  hubName = null,
  minutesAgo,
  status = 'received',
  statusNote = null,
  photos = 0,
}: SeedInput): Report {
  const submittedAt = at(minutesAgo)
  const timeline: TimelineEntry[] = [
    { at: submittedAt, status: 'received', note: 'Report received by Wellington City Council.', by: 'system' },
  ]
  if (status !== 'received') {
    timeline.push({
      at: at(Math.max(1, Math.round(minutesAgo / 2))),
      status,
      note: statusNote,
      by: 'WCC Emergency Management',
    })
  }
  return {
    reference,
    subject: 'Community report',
    service,
    faultType,
    faultDesc,
    locAddress,
    locSuburb: locSuburb || null,
    locLatitude: lat,
    locLongitude: lng,
    contactFirstName: null,
    contactLastName: null,
    contactEmail: null,
    contactPhone: null,
    attachmentUploadKeys: Array.from({ length: photos }, (_, i) => `demo/${reference}-${i + 1}.jpg`),
    attachmentPreviews: [],
    externalSystemName: 'community-channel',
    sourceType: 1005,
    reporterKind,
    hubName,
    severity,
    observedAt: submittedAt,
    submittedAt,
    status,
    statusNote,
    timeline,
    publishedAt: null,
    publishError: null,
    publishedReference: null,
  }
}

export function seedReports(): Report[] {
  return [
    // A cluster: four people reporting the same flooding on Evans Bay Parade.
    report({
      reference: 'WCC-4KDPM',
      locSuburb: 'Hataitai',
      faultType: 'flooding',
      faultDesc: 'Water across both lanes outside the marina, about ankle deep. Cars slowing right down.',
      locAddress: 'Evans Bay Parade, Hataitai',
      lat: -41.3025, lng: 174.7982, minutesAgo: 74, severity: 'disruption', photos: 1,
      status: 'acting',
      statusNote: 'Passed to the roading contractor. Crew tasked to clear the sumps.',
    }),
    report({
      reference: 'WCC-9WQHT',
      locSuburb: 'Hataitai',
      faultType: 'flooding',
      faultDesc: 'Surface flooding by the boat sheds, getting deeper than an hour ago.',
      locAddress: 'Evans Bay Parade, near Cog Park',
      lat: -41.3041, lng: 174.7967, minutesAgo: 52, severity: 'disruption',
    }),
    report({
      reference: 'WCC-2FMRX',
      locSuburb: 'Hataitai',
      faultType: 'flooding',
      faultDesc: 'Drain blocked with leaves, water backing up over the footpath.',
      locAddress: 'Evans Bay Parade',
      lat: -41.3009, lng: 174.7995, minutesAgo: 41, severity: 'info', photos: 1,
    }),
    report({
      reference: 'WCC-7YHKC',
      locSuburb: 'Hataitai',
      faultType: 'flooding',
      faultDesc: 'Hub team walked the parade. Water over the kerb for roughly 200m, passable but slow.',
      locAddress: 'Evans Bay Parade, Hataitai',
      lat: -41.3033, lng: 174.7975, minutesAgo: 22, severity: 'disruption',
      reporterKind: 'hub', hubName: 'Hataitai Community Emergency Hub',
    }),

    // A slip on the Ngaio Gorge road.
    report({
      reference: 'WCC-6TRLA',
      locSuburb: 'Wadestown',
      faultType: 'slip',
      faultDesc: 'Slip has come down onto the southbound lane, maybe two metres across. One lane still open.',
      locAddress: 'Ngaio Gorge Road, Kaiwharawhara',
      lat: -41.2599, lng: 174.7787, minutesAgo: 96, severity: 'urgent', photos: 2,
      status: 'checking',
      statusNote: 'Duty officer has this. Confirming with the roading contractor now.',
    }),
    report({
      reference: 'WCC-3NPGE',
      locSuburb: 'Wadestown',
      faultType: 'slip',
      faultDesc: 'Same slip — mud is still moving, would not send a bus through.',
      locAddress: 'Ngaio Gorge Road',
      lat: -41.2604, lng: 174.7791, minutesAgo: 63, severity: 'urgent',
      reporterKind: 'community-group', hubName: null,
    }),

    // Scattered single reports around the city.
    report({
      reference: 'WCC-8CJVD',
      locSuburb: 'Brooklyn',
      faultType: 'tree-down',
      faultDesc: 'Large pine down across the footpath at the top of the park. Blocking the whole path.',
      locAddress: 'Central Park, Brooklyn',
      lat: -41.3005, lng: 174.7681, minutesAgo: 130, severity: 'disruption', photos: 1,
      status: 'resolved',
      statusNote: 'Cleared by the parks crew this morning.',
    }),
    report({
      reference: 'WCC-5QAXM',
      locSuburb: 'Island Bay',
      faultType: 'coastal',
      faultDesc: 'Waves coming right over the sea wall onto the road at high tide, gravel everywhere.',
      locAddress: 'The Esplanade, Island Bay',
      lat: -41.3403, lng: 174.7716, minutesAgo: 58, severity: 'disruption', photos: 1,
    }),
    report({
      reference: 'WCC-4HLWU',
      locSuburb: 'Owhiro Bay',
      faultType: 'road-blocked',
      faultDesc: 'Road closed by debris just past the corner, no way through for a car.',
      locAddress: 'Happy Valley Road, Owhiro Bay',
      lat: -41.3437, lng: 174.7549, minutesAgo: 35, severity: 'urgent',
    }),
    report({
      reference: 'WCC-9EDKT',
      locSuburb: 'Newtown',
      faultType: 'hub-status',
      faultDesc: 'Hub is open and staffed. Twelve volunteers, generator running, radio contact good. We can take walk-ins.',
      locAddress: 'Newtown School, Mein Street',
      lat: -41.3115, lng: 174.7802, minutesAgo: 28, severity: 'info',
      reporterKind: 'hub', hubName: 'Newtown Community Emergency Hub',
    }),
    report({
      reference: 'WCC-2GVRP',
      locSuburb: 'Kelburn',
      faultType: 'access-cut',
      faultDesc: 'Six houses up the lane have no vehicle access, slip at the bottom of the driveway.',
      locAddress: 'Rawhiti Terrace, Kelburn',
      lat: -41.2851, lng: 174.7615, minutesAgo: 17, severity: 'urgent',
    }),

    // A business-as-usual report, to show the two streams share one channel.
    report({
      reference: 'WCC-7BMQZ',
      locSuburb: 'Newtown',
      service: 'roads',
      faultType: 'pothole',
      faultDesc: 'Pothole opened up after the rain, about 40cm across and deep enough to hear it.',
      locAddress: 'Adelaide Road, Newtown',
      lat: -41.3092, lng: 174.7794, minutesAgo: 155, severity: 'info',
      status: 'received',
    }),
  ]
}
