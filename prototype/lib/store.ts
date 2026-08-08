// A JSON-file backed store. Deliberately not a database: the prototype has to
// survive a laptop restart on the day and nothing more.

import fs from 'node:fs'
import path from 'node:path'
import { REPORTER_KINDS, makeReference, normalise } from './schema'
import { seedReports } from './seed'
import type { FixClaim, Report, ReportGroup, ReportInput, ReporterKindId, StatusId } from './types'

const DATA_DIR = path.join(process.cwd(), '.data')
const DATA_FILE = path.join(DATA_DIR, 'reports.json')
const CLAIMS_FILE = path.join(DATA_DIR, 'fix-claims.json')

function read(): Report[] {
  try {
    return (JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as Report[]).map(hydrate)
  } catch {
    const seeded = seedReports()
    write(seeded)
    return seeded
  }
}

// A `.data/reports.json` written before the publish fields existed is still a
// perfectly good file, and deleting the demo data on upgrade is a worse answer
// than filling in the gaps. Undefined and null are different here: undefined
// means the field predates the feature, null means never published.
function hydrate(report: Report): Report {
  const stored = report as Partial<Report>
  if (
    stored.publishedAt !== undefined &&
    stored.publishError !== undefined &&
    stored.publishedReference !== undefined
  ) {
    return report
  }
  return {
    ...report,
    publishedAt: stored.publishedAt ?? null,
    publishError: stored.publishError ?? null,
    publishedReference: stored.publishedReference ?? null,
  }
}

function write(reports: Report[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(reports, null, 2))
}

export function listReports(): Report[] {
  return read().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
}

export function getReport(reference: string | null | undefined): Report | null {
  const wanted = String(reference || '').toUpperCase()
  return read().find((r) => r.reference.toUpperCase() === wanted) || null
}

export function createReport(body: ReportInput): Report {
  const reports = read()
  const existing = new Set(reports.map((r) => r.reference))
  let reference = makeReference()
  while (existing.has(reference)) reference = makeReference()

  const report = normalise(body, { reference, now: new Date().toISOString() })
  reports.push(report)
  write(reports)
  return report
}

export function updateStatus(
  reference: string,
  {
    status,
    note,
    by = 'WCC Emergency Management',
  }: { status: StatusId; note?: string | null; by?: string },
): Report | null {
  const reports = read()
  const report = reports.find((r) => r.reference.toUpperCase() === String(reference).toUpperCase())
  if (!report) return null

  report.status = status
  report.statusNote = note || null
  report.timeline.push({ at: new Date().toISOString(), status, note: note || null, by })
  write(reports)
  return report
}

export function resetToSeed(): Report[] {
  const seeded = seedReports()
  write(seeded)
  writeClaims([])
  return seeded
}

// --- publishing ------------------------------------------------------------

/** Records the outcome of a push to the shared feed, successful or not. */
export function markPublished(
  reference: string,
  {
    at,
    error,
    publishedReference = null,
  }: { at: string | null; error: string | null; publishedReference?: string | null },
): Report | null {
  const reports = read()
  const report = reports.find((r) => r.reference.toUpperCase() === String(reference).toUpperCase())
  if (!report) return null

  report.publishedAt = at
  report.publishError = error
  // Only on success. A failed attempt must not overwrite the reference of an
  // earlier one that worked — that link is the only way back to the upstream
  // record, and losing it would orphan a report already on the feed.
  if (at && publishedReference) report.publishedReference = publishedReference

  if (at) {
    report.timeline.push({
      at,
      status: report.status,
      note: publishedReference
        ? `Published to the shared reports feed as confirmed data, as ${publishedReference}.`
        : 'Published to the shared reports feed as confirmed data.',
      by: 'WCC Emergency Management',
    })
  }
  write(reports)
  return report
}

// --- fix claims ------------------------------------------------------------
//
// "I fixed it" from a member of the public. Stored beside the reports rather
// than on them, because a claim can be made against a report on the shared feed
// that this prototype does not own.

function readClaims(): FixClaim[] {
  try {
    return JSON.parse(fs.readFileSync(CLAIMS_FILE, 'utf8'))
  } catch {
    return []
  }
}

function writeClaims(claims: FixClaim[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(CLAIMS_FILE, JSON.stringify(claims, null, 2))
}

export function listFixClaims(): FixClaim[] {
  return readClaims().sort((a, b) => b.at.localeCompare(a.at))
}

/** Claims by reference, for a console or a map that has reports in hand. */
export function fixClaimsByReference(): Record<string, FixClaim> {
  const byReference: Record<string, FixClaim> = {}
  // Newest first, so the first one seen for a reference is the one that stands.
  for (const claim of listFixClaims()) {
    if (!byReference[claim.reference]) byReference[claim.reference] = claim
  }
  return byReference
}

export function claimFixed(
  reference: string,
  { note, by = 'resident' }: { note?: string | null; by?: ReporterKindId } = {},
): FixClaim {
  const upper = String(reference).toUpperCase()
  const now = new Date().toISOString()

  // One row per reference, counted. A queue that grows a line every time
  // somebody taps the button is a queue an operator stops reading, but the
  // number of people saying it is information and must not be thrown away.
  const others = readClaims().filter((c) => c.reference !== upper)
  const previous = readClaims().find((c) => c.reference === upper) || null

  const claim: FixClaim = {
    reference: upper,
    at: now,
    // Keep the newest words. Somebody adding detail an hour later is usually
    // describing what actually happened, not repeating the first person.
    note: note || previous?.note || null,
    by,
    source: getReport(upper) ? 'local' : 'feed',
    count: (previous?.count || 0) + 1,
    firstAt: previous?.firstAt || now,
  }
  writeClaims([...others, claim])

  // A claim is not a status, so nothing here touches `status`. It goes on the
  // report's timeline because the resident should see that it landed, and it
  // names who said it — the console renders it as unverified either way.
  const report = getReport(upper)
  if (report) {
    const reports = read()
    const stored = reports.find((r) => r.reference === report.reference)
    if (stored) {
      // Named for who said it. A hub team saying a road is clear and one
      // household saying so are not the same weight of information, and a
      // timeline that flattens both to "a member of the public" throws away the
      // part a duty officer would use to decide.
      const who = REPORTER_KINDS.find((k) => k.id === claim.by)?.label || 'A member of the public'
      const said = claim.note ? `: “${claim.note}”` : ''
      stored.timeline.push({
        at: now,
        status: stored.status,
        note:
          claim.count > 1
            ? `Also reported as fixed${said}. ${claim.count} people have now said so. Not yet verified.`
            : `Reported as fixed${said}. Not yet verified.`,
        by: who,
      })
      write(reports)
    }
  }

  return claim
}

// --- grouping -------------------------------------------------------------
//
// Reports of the same fault type close together are almost certainly the same
// event seen by different people. Grouping them is what turns forty messages
// about one storm into a handful of things a duty officer can act on.
//
// This is a proximity heuristic, not a judgement that the reports describe the
// same thing — the console says so on screen, because inferred grouping
// presented as fact is how a duty officer ends up trusting the wrong number.

const GROUP_RADIUS_M = 250

function metresBetween(
  a: Pick<Report, 'locLatitude' | 'locLongitude'>,
  b: Pick<Report, 'locLatitude' | 'locLongitude'>,
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.locLatitude - a.locLatitude)
  const dLng = toRad(b.locLongitude - a.locLongitude)
  const lat1 = toRad(a.locLatitude)
  const lat2 = toRad(b.locLatitude)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

type PartialGroup = Pick<ReportGroup, 'key' | 'faultType' | 'service' | 'reports'>

export function groupReports(reports: Report[]): ReportGroup[] {
  const groups: PartialGroup[] = []
  for (const report of reports) {
    // Single-link: near *any* member, not just the first one added. Comparing
    // against one anchor makes the result depend on arrival order, which is how
    // four reports about one flooded street end up as two separate incidents.
    // The trade-off is that a long street can chain into one group; the console
    // says the grouping is inferred for exactly this reason.
    const match = groups.find(
      (g) =>
        g.faultType === report.faultType &&
        g.reports.some((member) => metresBetween(member, report) <= GROUP_RADIUS_M),
    )
    if (match) {
      match.reports.push(report)
    } else {
      groups.push({
        key: `${report.faultType}-${report.reference}`,
        faultType: report.faultType,
        service: report.service,
        reports: [report],
      })
    }
  }

  return groups
    .map((g) => {
      const sorted = [...g.reports].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
      return {
        ...g,
        reports: sorted,
        count: sorted.length,
        first: sorted[0],
        latest: sorted[sorted.length - 1],
        centroid: {
          lat: sorted.reduce((s, r) => s + r.locLatitude, 0) / sorted.length,
          lng: sorted.reduce((s, r) => s + r.locLongitude, 0) / sorted.length,
        },
        radiusM: GROUP_RADIUS_M,
      }
    })
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return b.latest.submittedAt.localeCompare(a.latest.submittedAt)
    })
}

export { GROUP_RADIUS_M }
