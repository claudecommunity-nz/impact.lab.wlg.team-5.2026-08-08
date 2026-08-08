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
  tone: string
  dot: string
}

export const STATUSES: StatusDefinition[] = [
  {
    id: 'received',
    label: 'Received',
    residentText: 'We have your report. It is in the queue to be looked at.',
    tone: 'bg-slate-100 text-slate-700 border-slate-300',
    dot: '#64748b',
  },
  {
    id: 'checking',
    label: 'Being checked',
    residentText: 'Someone at the Council is checking this now.',
    tone: 'bg-amber-50 text-amber-800 border-amber-300',
    dot: '#d97706',
  },
  {
    id: 'acting',
    label: 'Being acted on',
    residentText: 'This has been passed to a crew or agency to deal with.',
    tone: 'bg-blue-50 text-blue-800 border-blue-300',
    dot: '#2563eb',
  },
  {
    id: 'resolved',
    label: 'Resolved',
    residentText: 'This has been dealt with. Thank you for reporting it.',
    tone: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    dot: '#059669',
  },
  {
    id: 'no-action',
    label: 'No action needed',
    residentText: 'We looked at this and no further action is needed.',
    tone: 'bg-slate-100 text-slate-600 border-slate-300',
    dot: '#94a3b8',
  },
]

export function statusById(id: string | null | undefined): StatusDefinition {
  return STATUSES.find((s) => s.id === id) || STATUSES[0]
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
  }
}
