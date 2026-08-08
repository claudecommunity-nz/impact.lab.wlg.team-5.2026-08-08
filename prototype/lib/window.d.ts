import type { Map as MapLibreMap } from 'maplibre-gl'

// Debug handles. `scripts/check-map.mjs` drives the map through these to prove
// the layers are really drawing — a MapLibre map can report healthy sources and
// visible layers while rendering nothing at all.
export interface WindowWithMaps extends Window {
  __map?: MapLibreMap
  __picker?: MapLibreMap
}

declare global {
  interface Window {
    __map?: MapLibreMap
    __picker?: MapLibreMap
  }
}
