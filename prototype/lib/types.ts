// The shapes everything else agrees on.
//
// The report type is the contract between the resident form, the store, the
// Council console and the GeoJSON feed. Keeping it in one place is the point of
// moving to TypeScript at all: change a field here and every consumer that got
// it wrong stops compiling.

export type StatusId =
  | 'received'
  | 'checking'
  | 'verified'
  | 'acting'
  | 'resolved'
  | 'no-action'

export type SeverityId = 'info' | 'disruption' | 'urgent'

export type ReporterKindId = 'resident' | 'community-group' | 'hub'

export interface TimelineEntry {
  at: string
  status: StatusId
  note: string | null
  by: string
}

export interface Report {
  // --- fields the existing Council channel already uses ---
  reference: string
  subject: string
  service: string
  faultType: string
  faultDesc: string
  locAddress: string | null
  locSuburb: string | null
  locLatitude: number
  locLongitude: number
  contactFirstName: string | null
  contactLastName: string | null
  contactEmail: string | null
  contactPhone: string | null
  attachmentUploadKeys: string[]
  attachmentPreviews: string[]
  externalSystemName: string
  sourceType: number

  // --- added by this prototype ---
  reporterKind: ReporterKindId
  hubName: string | null
  severity: SeverityId
  observedAt: string
  submittedAt: string
  status: StatusId
  statusNote: string | null
  timeline: TimelineEntry[]

  // --- publishing to the shared feed ---
  //
  // Publishing is not a status. A report moves through the status chain whether
  // or not anyone pushes it anywhere, and a push that failed must not look like
  // a report that was never verified. So it is its own small piece of state,
  // and `publishError` is kept so the console can say why rather than showing
  // nothing and letting the operator assume it worked.
  publishedAt: string | null
  publishError: string | null
  /**
   * The reference the shared feed gave this report. Not the same as our own —
   * `gold.submit_report` mints its own via `silver.generate_reference()`, so the
   * upstream record is a separate thing and the link between them only exists
   * if we keep it.
   */
  publishedReference: string | null
}

/**
 * Somebody saying a reported problem is now fixed.
 *
 * Kept apart from `status` on purpose. A status is what the Council knows; this
 * is what a member of the public says, and the two must never be shown as the
 * same kind of fact. A claim never moves a report's status by itself — a duty
 * officer decides what to do with it.
 *
 * Keyed by reference rather than stored on the report, because a claim can be
 * made against a report on the shared feed that this prototype does not own and
 * has no local copy of.
 */
export interface FixClaim {
  reference: string
  /** When the most recent claim came in. */
  at: string
  note: string | null
  by: ReporterKindId
  /** Where the report being claimed against came from. */
  source: 'local' | 'feed'
  /**
   * How many people have said it. Four neighbours saying a road is clear is
   * better evidence than one, and it is the same reasoning as grouping reports
   * by proximity — still not verification, but worth more than a single voice.
   */
  count: number
  /** When the first person said it, which is when the Council could have known. */
  firstAt: string
}

/** What a client may POST. Everything is unknown until `validate` has run. */
export type ReportInput = Partial<Record<keyof Report, unknown>> & Record<string, unknown>

export interface ReportGroup {
  key: string
  service: string
  faultType: string
  reports: Report[]
  count: number
  first: Report
  latest: Report
  centroid: { lat: number; lng: number }
  radiusM: number
}

// --- map ------------------------------------------------------------------

export interface LatLng {
  lat: number
  lng: number
}

export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

export interface BoundaryLayerToggles {
  suburbs: boolean
  parcels: boolean
  hubs: boolean
}

export type ParcelStatus =
  | { state: 'off' }
  | { state: 'zoom' }
  | { state: 'loading' }
  | { state: 'loaded'; count: number; truncated: boolean; error: null }
  | { state: 'error'; count: number; truncated: boolean; error: string }

/** Properties we rely on from WREMO's Community Emergency Hub layer. */
export interface HubProperties {
  NAME?: string
  TYPE?: string
  ADDRESS?: string
  SUBURB?: string
  TOWN?: string
}

export interface SuburbProperties {
  suburb: string
}
