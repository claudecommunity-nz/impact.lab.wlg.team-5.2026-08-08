'use client'

import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAP_STYLE, SEVERITY_COLOUR, WELLINGTON_CENTRE, fetchHubs } from '../lib/map'
import {
  PARCEL_MIN_ZOOM,
  emptyCollection,
  fetchParcels,
  fetchSuburbs,
} from '../lib/layers'
import type { SuburbCollection } from '../lib/layers'
import type {
  BoundaryLayerToggles,
  ParcelStatus,
  Report,
  ReportGroup,
} from '../lib/types'
import type { FeatureCollection, GeoJSON as GeoJsonObject } from 'geojson'

interface ReportMapProps {
  reports: Report[]
  groups: ReportGroup[]
  selected: string | null
  onSelect: (reference: string) => void
  layers: BoundaryLayerToggles
  suburbCounts: Map<string, number>
  onSuburbs?: (collection: SuburbCollection) => void
  onParcelStatus?: (status: ParcelStatus) => void
}

// The console map.
//
// Reports sit on top of Council boundary layers, because "three reports in
// Hataitai" is a different fact from "three dots on a road". Individual reports
// are coloured by how bad the reporter says it is; a group gets a single ring
// sized by how many people have said it.

export default function ReportMap({
  reports,
  groups,
  selected,
  onSelect,
  layers,
  suburbCounts,
  onSuburbs,
  onParcelStatus,
}: ReportMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const readyRef = useRef(false)
  const onSelectRef = useRef(onSelect)
  const layersRef = useRef(layers)
  const parcelRequestRef = useRef(0)
  const [zoom, setZoom] = useState(11.4)

  onSelectRef.current = onSelect
  layersRef.current = layers

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current as HTMLDivElement,
      style: BASEMAP_STYLE,
      center: WELLINGTON_CENTRE,
      zoom: 11.4,
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map
    // Handle for debugging from the console — inspect layers, sources and what
    // is actually rendered without adding logging everywhere.
    if (typeof window !== 'undefined') window.__map = map

    map.on('load', () => {
      addBoundaryLayers(map)
      addReportLayers(map, onSelectRef)

      fetchSuburbs().then((collection) => {
        setGeoJson(map, 'suburbs', collection)
        onSuburbs?.(collection)
      })
      fetchHubs().then((collection) => setGeoJson(map, 'hubs', collection))

      readyRef.current = true
      paintReports(map, reports, groups, selected)
      applyVisibility(map, layersRef.current)
    })

    // Parcels only exist for the current view, so they reload when the view
    // settles. `moveend` rather than `move` — one request per pan, not sixty.
    const onMoveEnd = () => {
      setZoom(map.getZoom())
      loadParcels(map, layersRef.current, parcelRequestRef, onParcelStatus)
    }
    map.on('moveend', onMoveEnd)

    return () => {
      map.remove()
      mapRef.current = null
      readyRef.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (readyRef.current && mapRef.current) paintReports(mapRef.current, reports, groups, selected)
  }, [reports, groups, selected])

  useEffect(() => {
    if (!readyRef.current || !mapRef.current) return
    applyVisibility(mapRef.current, layers)
    loadParcels(mapRef.current, layers, parcelRequestRef, onParcelStatus)
  }, [layers]) // eslint-disable-line react-hooks/exhaustive-deps

  // Shade each suburb by how many reports are in it. The counts are computed in
  // the console from the same polygons, so the map and the list cannot disagree.
  useEffect(() => {
    const map = mapRef.current
    if (!readyRef.current || !map?.getLayer('suburbs-fill') || !suburbCounts) return
    const entries = [...suburbCounts.entries()]
    const expression: unknown =
      entries.length === 0
        ? 'rgba(0,0,0,0)'
        : [
            'match',
            ['get', 'suburb'],
            ...entries.flatMap(([suburb, count]) => [suburb, shadeFor(count)]),
            'rgba(0,0,0,0)',
          ]
    map.setPaintProperty('suburbs-fill', 'fill-color', expression as never)
  }, [suburbCounts, layers.suburbs])

  // Fly to whatever the operator picked in the list.
  useEffect(() => {
    if (!readyRef.current || !selected || !mapRef.current) return
    const report = reports.find((r) => r.reference === selected)
    if (!report) return
    mapRef.current.easeTo({
      center: [report.locLongitude, report.locLatitude],
      zoom: Math.max(mapRef.current.getZoom(), 14),
      duration: 600,
    })
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div ref={containerRef} className="h-full w-full" />
      {layers.parcels && zoom < PARCEL_MIN_ZOOM && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-council-ink/85 px-3 py-1.5 text-xs font-semibold text-white">
          Zoom in to see property boundaries
        </div>
      )}
    </>
  )
}

// --- layer construction ---------------------------------------------------

function addBoundaryLayers(map: MapLibreMap): void {
  map.addSource('suburbs', { type: 'geojson', data: emptyCollection() })
  map.addLayer({
    id: 'suburbs-fill',
    type: 'fill',
    source: 'suburbs',
    layout: { visibility: 'none' },
    paint: { 'fill-color': 'rgba(0,0,0,0)' },
  })
  map.addLayer({
    id: 'suburbs-line',
    type: 'line',
    source: 'suburbs',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#123456', 'line-width': 1.4, 'line-opacity': 0.65 },
  })
  map.addLayer({
    id: 'suburbs-label',
    type: 'symbol',
    source: 'suburbs',
    layout: {
      visibility: 'none',
      'text-field': ['get', 'suburb'],
      'text-size': 12,
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.05,
    },
    paint: {
      'text-color': '#123456',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.6,
    },
  })

  map.addSource('parcels', { type: 'geojson', data: emptyCollection() })
  map.addLayer({
    id: 'parcels-line',
    type: 'line',
    source: 'parcels',
    layout: { visibility: 'none' },
    paint: { 'line-color': '#6b5f4b', 'line-width': 1, 'line-opacity': 0.9 },
  })

  map.addSource('hubs', { type: 'geojson', data: emptyCollection() })
  map.addLayer({
    id: 'hubs',
    type: 'circle',
    source: 'hubs',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 4,
      'circle-color': '#123456',
      'circle-opacity': 0.5,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#ffffff',
    },
  })
}

function addReportLayers(
  map: MapLibreMap,
  onSelectRef: { current: (reference: string) => void },
): void {
  map.addSource('groups', { type: 'geojson', data: emptyCollection() })
  map.addLayer({
    id: 'groups',
    type: 'circle',
    source: 'groups',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 2, 18, 10, 40],
      'circle-color': '#b3261e',
      'circle-opacity': 0.12,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#b3261e',
      'circle-stroke-opacity': 0.5,
    },
  })

  map.addSource('reports', { type: 'geojson', data: emptyCollection() })
  map.addLayer({
    id: 'reports',
    type: 'circle',
    source: 'reports',
    paint: {
      'circle-radius': ['case', ['get', 'selected'], 11, 7],
      'circle-color': ['get', 'colour'],
      'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.5],
      'circle-stroke-color': '#ffffff',
    },
  })

  map.on('click', 'reports', (e) => {
    const ref = e.features?.[0]?.properties?.reference
    if (typeof ref === 'string') onSelectRef.current(ref)
  })
  map.on('mouseenter', 'reports', () => (map.getCanvas().style.cursor = 'pointer'))
  map.on('mouseleave', 'reports', () => (map.getCanvas().style.cursor = ''))
}

const BOUNDARY_LAYER_IDS: Record<keyof BoundaryLayerToggles, string[]> = {
  suburbs: ['suburbs-fill', 'suburbs-line', 'suburbs-label'],
  parcels: ['parcels-line'],
  hubs: ['hubs'],
}

function applyVisibility(map: MapLibreMap, layers: BoundaryLayerToggles): void {
  for (const [key, ids] of Object.entries(BOUNDARY_LAYER_IDS)) {
    for (const id of ids) {
      if (map.getLayer(id)) {
        const on = layers[key as keyof BoundaryLayerToggles]
        map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
      }
    }
  }
}

// --- data ----------------------------------------------------------------

function setGeoJson(map: MapLibreMap, id: string, data: GeoJsonObject): void {
  const source = map.getSource(id) as GeoJSONSource | undefined
  source?.setData(data)
}

async function loadParcels(
  map: MapLibreMap,
  layers: BoundaryLayerToggles,
  requestRef: { current: number },
  onStatus?: (status: ParcelStatus) => void,
): Promise<void> {
  if (!map?.getSource('parcels')) return

  if (!layers.parcels || map.getZoom() < PARCEL_MIN_ZOOM) {
    setGeoJson(map, 'parcels', emptyCollection())
    onStatus?.(layers.parcels ? { state: 'zoom' } : { state: 'off' })
    return
  }

  const ticket = (requestRef.current += 1)
  onStatus?.({ state: 'loading' })

  const b = map.getBounds()
  const { collection, truncated, error } = await fetchParcels({
    west: b.getWest(),
    south: b.getSouth(),
    east: b.getEast(),
    north: b.getNorth(),
  })

  // A slow request for a view the operator has already panned away from must not
  // overwrite a newer one.
  if (ticket !== requestRef.current) return

  setGeoJson(map, 'parcels', collection)
  onStatus?.(
    error
      ? { state: 'error', count: 0, truncated, error }
      : { state: 'loaded', count: collection.features?.length || 0, truncated, error: null },
  )
}

function paintReports(
  map: MapLibreMap,
  reports: Report[],
  groups: ReportGroup[],
  selected: string | null,
): void {
  setGeoJson(map, 'reports', {
    type: 'FeatureCollection',
    features: reports.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.locLongitude, r.locLatitude] },
      properties: {
        reference: r.reference,
        colour: SEVERITY_COLOUR[r.severity] || SEVERITY_COLOUR.info,
        selected: r.reference === selected,
      },
    })),
  } as FeatureCollection)

  setGeoJson(map, 'groups', {
    type: 'FeatureCollection',
    features: groups
      .filter((g) => g.count > 1)
      .map((g) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [g.centroid.lng, g.centroid.lat] },
        properties: { count: g.count },
      })),
  } as FeatureCollection)
}

// Four steps, not a continuous ramp: a duty officer reads "more than five" off a
// map, not a precise value, and a coarse scale is harder to over-read.
export function shadeFor(count: number): string {
  if (count >= 6) return 'rgba(179, 38, 30, 0.34)'
  if (count >= 3) return 'rgba(217, 119, 6, 0.28)'
  if (count >= 1) return 'rgba(15, 123, 108, 0.20)'
  return 'rgba(0,0,0,0)'
}
