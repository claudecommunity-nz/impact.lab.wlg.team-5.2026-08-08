// The shapes everything else agrees on.
//
// The report type is the contract between the resident form, the store, the
// Council console and the GeoJSON feed. Keeping it in one place is the point of
// moving to TypeScript at all: change a field here and every consumer that got
// it wrong stops compiling.

export type StatusId = 'received' | 'checking' | 'acting' | 'resolved' | 'no-action'

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
