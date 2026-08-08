// A JSON-file backed store. Deliberately not a database: the prototype has to
// survive a laptop restart on the day and nothing more.

import fs from 'node:fs'
import path from 'node:path'
import { makeReference, normalise } from './schema'
import { seedReports } from './seed'
import type { Report, ReportGroup, ReportInput, StatusId } from './types'

const DATA_DIR = path.join(process.cwd(), '.data')
const DATA_FILE = path.join(DATA_DIR, 'reports.json')

function read(): Report[] {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch {
    const seeded = seedReports()
    write(seeded)
    return seeded
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
  return seeded
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
