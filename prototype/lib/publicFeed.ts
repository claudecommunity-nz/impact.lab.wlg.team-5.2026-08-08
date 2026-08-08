// The shared reports feed, read from Supabase.
//
// This is somebody else's model, not ours, and it is richer than the one this
// prototype writes: ownership and assigned agency, a priority with the basis it
// was derived from, verification level, location precision, and eight statuses
// where `lib/types.ts` has five.
//
// So the adapter below goes one way only, and deliberately keeps two shapes:
//
//   PublicReport — every field the feed publishes, carried through untouched.
//                  The interface displays these, so a status invented by
//                  whoever owns that database still reads correctly here.
//   Report       — the local shape, built for the map and the grouping code,
//                  which are typed against it. Lossy on purpose. Nothing is
//                  displayed from this.
//
// The feed is read-only — an RPC that returns GeoJSON — so there is no write
// path back and nothing here sets a status.

import type { Report, ReporterKindId, SeverityId, StatusId } from './types'
import type { Feature, FeatureCollection, Point } from 'geojson'

// Committed so the prototype runs with no setup. This is a Supabase anon key,
// which is designed to be published and is only as safe as the row-level
// security on the table behind it. Set REPORTS_FEED_URL to point somewhere
// else. Read on the server, so it never reaches the browser bundle.
const FALLBACK_FEED_URL =
  'https://npgheigsdikccoknmbup.supabase.co/rest/v1/rpc/reports_geojson' +
  '?apikey=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wZ2hlaWdzZGlrY2Nva25tYnVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMzg3MDksImV4cCI6MjEwMTcxNDcwOX0' +
  '.4271Gpyz8e1cFRrHt0v_R-XYDrc2k_iDpiHQNRZenx8'

export function feedUrl(): string {
  return process.env.REPORTS_FEED_URL || FALLBACK_FEED_URL
}

export interface PublicReport {
  reference: string
  lat: number
  lng: number

  severity: SeverityId
  service: string
  faultType: string
  faultLabel: string | null
  description: string | null
  descriptionStatus: string | null

  status: string
  statusLabel: string | null
  statusNote: string | null
  statusUpdatedAt: string | null

  suburb: string | null
  address: string | null
  locationPrecision: string | null

  observedAt: string
  submittedAt: string

  reporterKind: string | null
  hubName: string | null
  photoCount: number

  priorityLabel: string | null
  priorityBasisLabel: string | null
  ownershipLabel: string | null
  ownershipNote: string | null
  assignedAgency: string | null
  partnerAgency: string | null
  verificationLevel: string | null

  // Most of what this feed currently carries is generated test data. Saying so
  // is not optional: an invented report presented as a resident's observation
  // is the one thing this whole channel must not do.
  isSynthetic: boolean
  disclaimer: string | null
}

export interface FeedResult {
  reports: PublicReport[]
  fetchedAt: string
  error: string | null
}

export async function fetchPublicReports(): Promise<FeedResult> {
  const fetchedAt = new Date().toISOString()
  try {
    const res = await fetch(feedUrl(), { cache: 'no-store' })
    if (!res.ok) throw new Error(`Feed responded ${res.status}`)

    const collection: FeatureCollection<Point> = await res.json()
    const reports: PublicReport[] = []
    for (const feature of collection.features || []) {
      const report = toPublicReport(feature)
      if (report) reports.push(report)
    }
    reports.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    return { reports, fetchedAt, error: null }
  } catch (err) {
    // An empty map with a visible reason beats a map that silently shows
    // nothing and looks like a quiet night.
    return {
      reports: [],
      fetchedAt,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

const SEVERITIES = new Set<string>(['info', 'disruption', 'urgent'])
const REPORTER_KINDS = new Set<string>(['resident', 'community-group', 'hub'])

function toPublicReport(feature: Feature<Point>): PublicReport | null {
  const p = (feature.properties || {}) as Record<string, unknown>
  const coords = feature.geometry?.coordinates
  const reference = str(p.reference)
  // A report with no reference cannot be looked up and one with no coordinates
  // cannot be drawn, so neither belongs on this map.
  if (!reference || !coords || coords.length < 2) return null

  const [lng, lat] = coords
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const severity = str(p.severity)
  const submittedAt = str(p.submittedAt) || str(p.observedAt) || new Date().toISOString()

  return {
    reference,
    lat,
    lng,
    severity: severity && SEVERITIES.has(severity) ? (severity as SeverityId) : 'info',
    service: str(p.service) || 'unknown',
    faultType: str(p.faultType) || 'unknown',
    faultLabel: str(p.faultLabel),
    description: str(p.description),
    descriptionStatus: str(p.descriptionStatus),
    status: str(p.status) || 'unknown',
    statusLabel: str(p.statusLabel),
    statusNote: str(p.statusNote),
    statusUpdatedAt: str(p.statusUpdatedAt),
    suburb: str(p.suburb),
    address: str(p.address),
    locationPrecision: str(p.locationPrecision),
    observedAt: str(p.observedAt) || submittedAt,
    submittedAt,
    reporterKind: str(p.reporterKind),
    hubName: str(p.hubName),
    photoCount: typeof p.photoCount === 'number' ? p.photoCount : 0,
    priorityLabel: str(p.priorityLabel),
    priorityBasisLabel: str(p.priorityBasisLabel),
    ownershipLabel: str(p.ownershipLabel),
    ownershipNote: str(p.ownershipNote),
    assignedAgency: str(p.assignedAgency),
    partnerAgency: str(p.partnerAgency),
    verificationLevel: str(p.verificationLevel),
    isSynthetic: p.isSynthetic === true,
    disclaimer: str(p.disclaimer),
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

// The feed's status vocabulary collapsed onto the local one. Lossy, and only
// ever used to satisfy the Report type that the grouping and map code are
// written against — the interface shows `statusLabel` from the feed instead, so
// nothing a reader sees passes through this table.
const STATUS_EQUIVALENT: Record<string, StatusId> = {
  received: 'received',
  under_review: 'checking',
  reassessing: 'checking',
  assigned: 'acting',
  responding: 'acting',
  fixed: 'resolved',
  completed_confirmed: 'resolved',
  no_action: 'no-action',
}

/** The local shape, for code typed against `Report`. Not for display. */
export function toReport(p: PublicReport): Report {
  const kind = p.reporterKind || ''
  return {
    reference: p.reference,
    subject: p.faultLabel || p.faultType,
    service: p.service,
    faultType: p.faultType,
    faultDesc: p.description || '',
    locAddress: p.address,
    locSuburb: p.suburb,
    locLatitude: p.lat,
    locLongitude: p.lng,

    // The feed publishes no contact details, which is the right call for a
    // public map. Nothing invents any here.
    contactFirstName: null,
    contactLastName: null,
    contactEmail: null,
    contactPhone: null,
    attachmentUploadKeys: [],
    attachmentPreviews: [],
    externalSystemName: 'supabase-reports-feed',
    sourceType: 0,

    reporterKind: REPORTER_KINDS.has(kind) ? (kind as ReporterKindId) : 'resident',
    hubName: p.hubName,
    severity: p.severity,
    observedAt: p.observedAt,
    submittedAt: p.submittedAt,
    status: STATUS_EQUIVALENT[p.status] || 'received',
    statusNote: p.statusNote,
    timeline: [],
  }
}
