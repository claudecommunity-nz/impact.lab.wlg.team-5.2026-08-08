// Basemap and Council layers.
//
// No Mapbox token: OpenStreetMap raster tiles work with no key and no signup,
// which matters when the demo has to run off a hotspot.
//
// MapLibre is pinned to 5.x on purpose. Under 6.x with Next's Turbopack build,
// the worker never parses GeoJSON: raster basemap tiles draw normally while
// every vector layer silently renders nothing — no console error, no failed
// request, sources reporting the right feature counts the whole time. Do not
// bump the major without running `npm run check:map` afterwards.

import type { StyleSpecification } from 'maplibre-gl'
import type { HubProperties, SeverityId } from './types'
import type { FeatureCollection, Point } from 'geojson'

export const WELLINGTON_CENTRE: [number, number] = [174.7787, -41.2924]

export const BASEMAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

// WREMO's 126 Community Emergency Hubs, served by Greater Wellington. Published
// in NZTM2000, so outSR=4326 is not optional — without it the pins land off the
// coast of Africa.
const HUBS_URL =
  'https://mapping.gw.govt.nz/arcgis/rest/services/GW/Emergencies_P/MapServer/2/query' +
  '?where=1%3D1&outFields=NAME,TYPE,ADDRESS,SUBURB,TOWN&outSR=4326&f=geojson'

export type HubCollection = FeatureCollection<Point, HubProperties>

let hubsPromise: Promise<HubCollection> | null = null

export function fetchHubs(): Promise<HubCollection> {
  if (!hubsPromise) {
    hubsPromise = fetch(HUBS_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Hubs ${r.status}`))))
      .catch(() => ({ type: 'FeatureCollection', features: [] }))
  }
  return hubsPromise
}

export const SEVERITY_COLOUR: Record<SeverityId, string> = {
  info: '#0f7b6c',
  disruption: '#d97706',
  urgent: '#b3261e',
}
