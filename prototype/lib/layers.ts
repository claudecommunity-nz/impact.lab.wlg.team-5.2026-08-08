// Council boundary layers, straight off WCC's own ArcGIS server.
//
// Both of these are published in NZTM2000, so outSR=4326 is not optional.
// Everything here sends it.

import type { Bounds, Report, SuburbProperties } from './types'
import type { FeatureCollection, GeoJSON as GeoJsonObject, MultiPolygon, Polygon, Position } from 'geojson'

export type SuburbCollection = FeatureCollection<
  Polygon | MultiPolygon,
  SuburbProperties
>

export interface ParcelResult {
  collection: FeatureCollection
  truncated: boolean
  error: string | null
}

const WCC_GIS = 'https://gis.wcc.govt.nz/arcgis/rest/services/PropertyAndBoundaries'

const SUBURBS_LAYER = `${WCC_GIS}/Boundaries/MapServer/4`
const PARCELS_LAYER = `${WCC_GIS}/Parcels/MapServer/1`

function queryUrl(layer: string, params: Record<string, string>): string {
  const query = new URLSearchParams({ outSR: '4326', f: 'geojson', ...params })
  return `${layer}/query?${query}`
}

// --- suburbs --------------------------------------------------------------
//
// 57 polygons for the whole city. Full-resolution geometry is 920KB, which is a
// slow first paint on a phone; maxAllowableOffset generalises server-side to
// roughly 9m and brings it to 123KB. At the zooms a duty officer works at, the
// difference is invisible.

const SUBURBS_URL = queryUrl(SUBURBS_LAYER, {
  where: '1=1',
  outFields: 'suburb',
  maxAllowableOffset: '0.00008',
})

let suburbsPromise: Promise<SuburbCollection> | null = null

export function fetchSuburbs(): Promise<SuburbCollection> {
  if (!suburbsPromise) {
    suburbsPromise = fetch(SUBURBS_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Suburbs ${r.status}`))))
      .catch(() => emptyCollection())
  }
  return suburbsPromise
}

// --- parcels --------------------------------------------------------------
//
// 84,223 property boundaries. Far too many to load at once, and the service
// caps a single query at 2,000 rows, so they are fetched for the current view
// only and only once you are zoomed in far enough for them to mean anything.
// The layer's own minScale is 1:20,000, which is about zoom 15.

export const PARCEL_MIN_ZOOM = 15.5
const PARCEL_PAGE = 2000

export async function fetchParcels(bounds: Bounds): Promise<ParcelResult> {
  const url = queryUrl(PARCELS_LAYER, {
    where: '1=1',
    outFields: 'parcel_id,full_app',
    geometry: [bounds.west, bounds.south, bounds.east, bounds.north].join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    resultRecordCount: String(PARCEL_PAGE),
  })

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Parcels ${res.status}`)
    const data = await res.json()
    // ArcGIS Server puts the cap flag at the top level; ArcGIS Online hides it
    // under properties. Check both, because a silently truncated parcel layer
    // looks exactly like a suburb with no properties in it.
    const truncated = Boolean(data.exceededTransferLimit || data.properties?.exceededTransferLimit)
    return { collection: data, truncated, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { collection: emptyCollection(), truncated: false, error: message }
  }
}

export function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

// --- which suburb is a point in? -----------------------------------------
//
// Ray casting over the suburb polygons we already have on the client. Saves a
// round trip per report, and means the count in the console is derived from the
// same geometry the operator is looking at.

type Ring = Position[]

function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

function inPolygon(lng: number, lat: number, polygon: Ring[]): boolean {
  if (!polygon.length || !inRing(lng, lat, polygon[0])) return false
  // Holes.
  for (let i = 1; i < polygon.length; i += 1) {
    if (inRing(lng, lat, polygon[i])) return false
  }
  return true
}

export function suburbAt(
  lng: number,
  lat: number,
  suburbs: SuburbCollection,
): string | null {
  for (const feature of suburbs.features || []) {
    const geometry = feature.geometry
    if (!geometry) continue
    if (geometry.type === 'Polygon' && inPolygon(lng, lat, geometry.coordinates)) {
      return feature.properties.suburb
    }
    if (
      geometry.type === 'MultiPolygon' &&
      geometry.coordinates.some((polygon: Ring[]) => inPolygon(lng, lat, polygon))
    ) {
      return feature.properties.suburb
    }
  }
  return null
}

export function countBySuburb(reports: Report[], suburbs: SuburbCollection): Map<string, number> {
  const counts = new Map<string, number>()
  for (const report of reports) {
    const suburb = suburbAt(report.locLongitude, report.locLatitude, suburbs)
    if (suburb) counts.set(suburb, (counts.get(suburb) || 0) + 1)
  }
  return counts
}
