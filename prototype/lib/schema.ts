// The report shape.
//
// The core fields are deliberately a superset of the payload the Council's
// existing public reporting tool already posts (faultType, faultDesc,
// locAddress, locLatitude, locLongitude, contact*, attachmentUploadKeys,
// externalSystemName, sourceType). Keeping those names means a report from this
// channel could be handed to the same downstream queue without a translation
// layer.
//
// Everything under "added by this prototype" is what the current channel has no
// concept of: an acknowledgement loop the resident can see, who is reporting
// (a household vs a Community Emergency Hub), and grouping of similar reports.

import type { Report, ReportInput, ReporterKindId, SeverityId, StatusId } from './types'

export interface StatusDefinition {
  id: StatusId
  label: string
  residentText: string
  /** Tailwind classes off the design system's status tokens. */
  tone: string
  /** The same colour as a hex, for MapLibre paint and inline dots. */
  dot: string
}

// Status colours are green/orange/red/blue from the Wellington City Council
// design system. Its readme flags them as an intentional addition, not brand
// colours — a service-request product needs Received / In progress / Resolved
// states and a two-colour brand palette cannot carry them.
//
// Grey for received and no-action is deliberate: nothing has happened yet in
// one case and nothing will in the other, and colouring either would overstate
// it. Orange means unresolved and unassigned, blue means in hand.
export const STATUSES: StatusDefinition[] = [
  {
    id: 'received',
    label: 'Received',
    residentText: 'We have your report. It is in the queue to be looked at.',
    tone: 'bg-grey-100 text-grey-700 border-grey-200',
    dot: '#6E6E68', // --grey-500
  },
  {
    id: 'checking',
    label: 'Being checked',
    residentText: 'Someone at the Council is checking this now.',
    tone: 'bg-warning-bg text-warning-fg border-warning-bg',
    dot: '#B05A00', // --orange-600
  },
  // Black, not a functional colour. The four functional colours all mean "how
  // far along is this"; verified answers a different question — is it true —
  // and the strongest mark in the design system is the right weight for the one
  // status on this board that came from someone standing in the street.
  {
    id: 'verified',
    label: 'Verified',
    residentText: 'A first responder has confirmed this on the ground.',
    tone: 'bg-wcc-black text-wcc-white border-wcc-black',
    dot: '#000000', // --wcc-black
  },
  {
    id: 'acting',
    label: 'Being acted on',
    residentText: 'This has been passed to a crew or agency to deal with.',
    tone: 'bg-info-bg text-info-fg border-info-bg',
    dot: '#0B4EA2', // --blue-600
  },
  {
    id: 'resolved',
    label: 'Resolved',
    residentText: 'This has been dealt with. Thank you for reporting it.',
    tone: 'bg-success-bg text-success-fg border-success-bg',
    dot: '#17703D', // --green-600
  },
  {
    id: 'no-action',
    label: 'No action needed',
    residentText: 'We looked at this and no further action is needed.',
    tone: 'bg-grey-100 text-grey-600 border-grey-200',
    dot: '#9B9B95', // --grey-400
  },
]

export function statusById(id: string | null | undefined): StatusDefinition {
  return STATUSES.find((s) => s.id === id) || STATUSES[0]
}

// Who can verify a report, and who therefore ends up named on it.
//
// The list is short and closed on purpose. "Verified" is the claim this whole
// prototype leans hardest on — it is what turns an unverified public post into
// something the Council is willing to publish — so it has to carry the name of
// the organisation that made the call. A free-text box would let it be set by
// nobody in particular, which is the same as not verifying it.
export interface Verifier {
  id: string
  label: string
  /** Written into the timeline, so the resident sees who confirmed it. */
  by: string
  /** `silver.agency.code` upstream. gold.confirm_report resolves the name from it. */
  agencyCode: string
}

export const VERIFIERS: Verifier[] = [
  { id: 'fenz', label: 'Fire', by: 'Fire and Emergency New Zealand', agencyCode: 'FENZ' },
  { id: 'police', label: 'Police', by: 'New Zealand Police', agencyCode: 'POLICE' },
  { id: 'wcc', label: 'Council crew', by: 'WCC Emergency Management', agencyCode: 'WCC' },
]

/** The verifier a timeline entry names, or null if it was not one of ours. */
export function verifierByName(by: string | null | undefined): Verifier | null {
  return VERIFIERS.find((v) => v.by === by) || null
}

export function verifierById(id: string | null | undefined): Verifier | null {
  return VERIFIERS.find((v) => v.id === id) || null
}

export const REPORTER_KINDS: { id: ReporterKindId; label: string }[] = [
  { id: 'resident', label: 'A resident' },
  { id: 'community-group', label: 'A community group' },
  { id: 'hub', label: 'A Community Emergency Hub' },
]

export const SEVERITIES: { id: SeverityId; label: string; hint: string }[] = [
  { id: 'info', label: 'Just letting you know', hint: 'No one is at risk, nothing is blocked.' },
  { id: 'disruption', label: 'Causing disruption', hint: 'Access affected, or getting worse.' },
  { id: 'urgent', label: 'Urgent', hint: 'Unsafe, or someone needs help soon.' },
]

// Reference numbers are readable over a handheld radio or a phone line, which
// is how a hub will actually pass one on. No ambiguous characters.
const ALPHABET = '23456789ACDEFGHJKLMNPQRTUVWXY'

export function makeReference(rand: () => number = Math.random): string {
  let tail = ''
  for (let i = 0; i < 5; i += 1) {
    tail += ALPHABET[Math.floor(rand() * ALPHABET.length)]
  }
  return `WCC-${tail}`
}

const REQUIRED = ['service', 'faultType', 'faultDesc', 'locLatitude', 'locLongitude'] as const

export interface ValidationResult {
  ok: boolean
  errors: Record<string, string>
}

export function validate(body: ReportInput | null | undefined): ValidationResult {
  const errors: Record<string, string> = {}
  for (const key of REQUIRED) {
    const value = body?.[key]
    if (value === undefined || value === null || value === '') {
      errors[key] = 'This field is required'
    }
  }
  const lat = Number(body?.locLatitude)
  const lng = Number(body?.locLongitude)
  if (!errors.locLatitude && (Number.isNaN(lat) || lat < -42.2 || lat > -40.6)) {
    errors.locLatitude = 'Location must be in the Wellington region'
  }
  if (!errors.locLongitude && (Number.isNaN(lng) || lng < 174.2 || lng > 175.6)) {
    errors.locLongitude = 'Location must be in the Wellington region'
  }
  if (
    typeof body?.contactEmail === 'string' &&
    body.contactEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contactEmail)
  ) {
    errors.contactEmail = 'Please provide a valid email address'
  }
  return { ok: Object.keys(errors).length === 0, errors }
}

export function normalise(
  body: ReportInput,
  { reference, now }: { reference: string; now: string },
): Report {
  const text = (value: unknown): string | null => (value ? String(value) : null)
  const list = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : [])

  return {
    // --- fields the existing Council channel already uses ---
    reference,
    subject: 'Community report',
    service: String(body.service),
    faultType: String(body.faultType),
    faultDesc: String(body.faultDesc).trim(),
    locAddress: text(body.locAddress),
    // Derived on the client from the pin against WCC's own suburb boundaries,
    // so it is never a resident's spelling of a suburb name.
    locSuburb: text(body.locSuburb),
    locLatitude: Number(body.locLatitude),
    locLongitude: Number(body.locLongitude),
    contactFirstName: text(body.contactFirstName),
    contactLastName: text(body.contactLastName),
    contactEmail: text(body.contactEmail),
    contactPhone: text(body.contactPhone),
    attachmentUploadKeys: list(body.attachmentUploadKeys),
    // A real deployment uploads to object storage and keeps only the key. This
    // prototype carries a downscaled inline copy so the Council console can
    // actually show the photo without a storage bucket behind it.
    attachmentPreviews: list(body.attachmentPreviews),
    externalSystemName: 'community-channel',
    sourceType: 1005,

    // --- added by this prototype ---
    reporterKind: (body.reporterKind as ReporterKindId) || 'resident',
    hubName: text(body.hubName),
    severity: (body.severity as SeverityId) || 'info',
    observedAt: typeof body.observedAt === 'string' ? body.observedAt : now,
    submittedAt: now,
    status: 'received',
    statusNote: null,
    timeline: [
      {
        at: now,
        status: 'received',
        note: 'Report received by Wellington City Council.',
        by: 'system',
      },
    ],
    publishedAt: null,
    publishError: null,
    publishedReference: null,
  }
}
