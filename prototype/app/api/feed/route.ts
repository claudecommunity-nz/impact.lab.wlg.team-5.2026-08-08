// GeoJSON out, for the shared common operating picture.
//
// This is the composable half of the prototype: any other team's map can point
// at /api/feed and get community reports as a layer, with no knowledge of this
// app. Grouped points are available at /api/feed?grouped=1.

import { NextResponse } from 'next/server'
import { groupReports, listReports } from '../../../lib/store'
import { faultLabel } from '../../../lib/taxonomy'
import type { Feature, Point } from 'geojson'

export const dynamic = 'force-dynamic'

function feature(
  geometry: Point,
  properties: Record<string, unknown>,
): Feature<Point> {
  return { type: 'Feature', geometry, properties }
}

const DISCLAIMER =
  'Unverified community reports submitted to a hackathon prototype. Not an operational ' +
  'emergency source, not confirmed by Wellington City Council. In an emergency call 111.'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const grouped = searchParams.get('grouped') === '1'
  const service = searchParams.get('service')
  // ArcGIS Online's GeoJSON importer is fussier than the spec. `?arcgis=1`
  // returns a FeatureCollection with no foreign members at all, and moves the
  // disclaimer into every feature so it survives the import instead of being
  // dropped with the file-level metadata.
  const arcgis = searchParams.get('arcgis') === '1'

  let reports = listReports()
  if (service) reports = reports.filter((r) => r.service === service)

  const features = grouped
    ? groupReports(reports).map((g) =>
        feature(
          { type: 'Point', coordinates: [g.centroid.lng, g.centroid.lat] },
          {
            kind: 'group',
            faultType: g.faultType,
            faultLabel: faultLabel(g.service, g.faultType),
            reportCount: g.count,
            groupedBy: `same fault type within ${g.radiusM}m — inferred, not confirmed`,
            firstReportedAt: g.first.submittedAt,
            latestReportedAt: g.latest.submittedAt,
            references: g.reports.map((r) => r.reference),
            statuses: [...new Set(g.reports.map((r) => r.status))],
          },
        ),
      )
    : reports.map((r) =>
        feature(
          { type: 'Point', coordinates: [r.locLongitude, r.locLatitude] },
          {
            kind: 'report',
            reference: r.reference,
            service: r.service,
            faultType: r.faultType,
            faultLabel: faultLabel(r.service, r.faultType),
            description: r.faultDesc,
            address: r.locAddress,
            suburb: r.locSuburb,
            severity: r.severity,
            reporterKind: r.reporterKind,
            hubName: r.hubName,
            status: r.status,
            statusNote: r.statusNote,
            observedAt: r.observedAt,
            submittedAt: r.submittedAt,
            photoCount: r.attachmentUploadKeys.length,
          },
        ),
      )

  if (arcgis) {
    return NextResponse.json(
      {
        type: 'FeatureCollection',
        features: features.map((f) => ({
          ...f,
          properties: { ...f.properties, disclaimer: DISCLAIMER },
        })),
      },
      { headers: { 'Content-Type': 'application/geo+json' } },
    )
  }

  return NextResponse.json(
    {
      type: 'FeatureCollection',
      features,
      metadata: {
        source: 'Impact Lab Wellington 2026 — Team 5 community reporting prototype',
        disclaimer: DISCLAIMER,
        generatedAt: new Date().toISOString(),
        count: features.length,
      },
    },
    { headers: { 'Content-Type': 'application/geo+json' } },
  )
}
