'use client'

import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, NavigationControl, Marker } from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAP_STYLE, WELLINGTON_CENTRE, fetchHubs } from '../lib/map'
import {
  PARCEL_MIN_ZOOM,
  emptyCollection,
  fetchParcels,
  fetchSuburbs,
  suburbAt,
} from '../lib/layers'
import type { SuburbCollection } from '../lib/layers'
import type { HubProperties, LatLng } from '../lib/types'
import type { Feature, GeoJSON as GeoJsonObject, Point } from 'geojson'

interface MapPickerProps {
  value: LatLng | null
  onChange: (next: LatLng) => void
  onNearestHub?: (hub: HubProperties) => void
  onSuburb?: (suburb: string | null) => void
}

type HubFeature = Feature<Point, HubProperties>

// Drop a pin. Tapping the map, using your device location, or dragging the pin
// all set the same coordinates.
//
// Property boundaries appear once you are zoomed in far enough to tell one
// section from the next — the difference between "somewhere on this street" and
// "this driveway" is the difference between a crew finding it and not.

export default function MapPicker({ value, onChange, onNearestHub, onSuburb }: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const onChangeRef = useRef(onChange)
  const parcelRequestRef = useRef(0)
  const [hubs, setHubs] = useState<HubFeature[]>([])
  const [suburbs, setSuburbs] = useState<SuburbCollection>(
    emptyCollection() as SuburbCollection,
  )
  const [locating, setLocating] = useState(false)
  const [zoom, setZoom] = useState(12)

  onChangeRef.current = onChange

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current as HTMLDivElement,
      style: BASEMAP_STYLE,
      center: value ? [value.lng, value.lat] : WELLINGTON_CENTRE,
      zoom: value ? 16 : 12,
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.on('click', (e) => onChangeRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }))
    mapRef.current = map
    if (typeof window !== 'undefined') window.__picker = map

    map.on('load', () => {
      map.addSource('parcels', { type: 'geojson', data: emptyCollection() })
      map.addLayer({
        id: 'parcels-line',
        type: 'line',
        source: 'parcels',
        paint: { 'line-color': '#6b5f4b', 'line-width': 1.1, 'line-opacity': 0.95 },
      })

      map.addSource('suburbs', { type: 'geojson', data: emptyCollection() })
      map.addLayer({
        id: 'suburbs-line',
        type: 'line',
        source: 'suburbs',
        paint: { 'line-color': '#123456', 'line-width': 1.2, 'line-opacity': 0.5 },
      })
      map.addLayer({
        id: 'suburbs-label',
        type: 'symbol',
        source: 'suburbs',
        layout: {
          'text-field': ['get', 'suburb'],
          'text-size': 11,
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.05,
        },
        paint: { 'text-color': '#123456', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
      })

      map.addSource('hubs', { type: 'geojson', data: emptyCollection() })
      map.addLayer({
        id: 'hubs',
        type: 'circle',
        source: 'hubs',
        paint: {
          'circle-radius': 4,
          'circle-color': '#123456',
          'circle-opacity': 0.55,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      })

      fetchSuburbs().then((collection) => {
        setSuburbs(collection)
        setGeoJson(map, 'suburbs', collection)
      })
      fetchHubs().then((collection) => {
        setHubs(collection.features || [])
        setGeoJson(map, 'hubs', collection)
      })

      loadParcels(map, parcelRequestRef)
    })

    const onMoveEnd = () => {
      setZoom(map.getZoom())
      loadParcels(map, parcelRequestRef)
    }
    map.on('moveend', onMoveEnd)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the marker in step with whatever set the value.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!value) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }

    if (!markerRef.current) {
      const marker = new Marker({ color: '#b3261e', draggable: true })
        .setLngLat([value.lng, value.lat])
        .addTo(map)
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLngLat()
        onChangeRef.current({ lat, lng })
      })
      markerRef.current = marker
    } else {
      markerRef.current.setLngLat([value.lng, value.lat])
    }
  }, [value])

  // Which suburb the pin is in, straight off the Council's own boundaries. The
  // resident never types it, so it cannot be spelled three different ways.
  useEffect(() => {
    if (!value || !suburbs.features?.length || !onSuburb) return
    onSuburb(suburbAt(value.lng, value.lat, suburbs))
  }, [value, suburbs]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the caller which hub is closest, so a hub team can confirm rather than
  // type their own name.
  useEffect(() => {
    if (!value || !hubs.length || !onNearestHub) return
    let best: HubFeature | null = null
    let bestDistance = Infinity
    for (const hub of hubs) {
      const [lng, lat] = hub.geometry?.coordinates || []
      if (lat === undefined || lng === undefined) continue
      const d = (lat - value.lat) ** 2 + ((lng - value.lng) * 0.75) ** 2
      if (d < bestDistance) {
        bestDistance = d
        best = hub
      }
    }
    if (best) onNearestHub(best.properties)
  }, [value, hubs]) // eslint-disable-line react-hooks/exhaustive-deps

  function useMyLocation() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        onChangeRef.current(next)
        mapRef.current?.flyTo({ center: [next.lng, next.lat], zoom: 17 })
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  function zoomToPin() {
    if (!value) return
    mapRef.current?.easeTo({ center: [value.lng, value.lat], zoom: 17.5, duration: 500 })
  }

  return (
    <div>
      <div className="relative">
        <div
          ref={containerRef}
          className="h-80 w-full overflow-hidden rounded border border-council-line"
        />
        {zoom < PARCEL_MIN_ZOOM && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-council-ink/85 px-3 py-1.5 text-xs font-semibold text-white">
            Zoom in to see property boundaries
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" onClick={useMyLocation} disabled={locating}>
          {locating ? 'Finding you…' : 'Use my location'}
        </button>
        {value && (
          <button type="button" className="btn-secondary" onClick={zoomToPin}>
            Zoom to my pin
          </button>
        )}
      </div>
      <p className="mt-2 hint">
        Tap the map to drop a pin, or drag it to adjust. Faint outlines are property boundaries and
        navy dots are Community Emergency Hubs.
      </p>

      {value && (
        <p className="mt-2 text-sm font-medium">
          Pin at {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
        </p>
      )}
    </div>
  )
}

function setGeoJson(map: MapLibreMap, id: string, data: GeoJsonObject): void {
  const source = map.getSource(id) as GeoJSONSource | undefined
  source?.setData(data)
}

async function loadParcels(
  map: MapLibreMap,
  requestRef: { current: number },
): Promise<void> {
  if (!map.getSource('parcels')) return

  if (map.getZoom() < PARCEL_MIN_ZOOM) {
    setGeoJson(map, 'parcels', emptyCollection())
    return
  }

  const ticket = (requestRef.current += 1)
  const b = map.getBounds()
  const { collection } = await fetchParcels({
    west: b.getWest(),
    south: b.getSouth(),
    east: b.getEast(),
    north: b.getNorth(),
  })

  // Ignore a response for a view we have already moved on from.
  if (ticket !== requestRef.current) return
  setGeoJson(map, 'parcels', collection)
}
