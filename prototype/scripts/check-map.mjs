// Does the map actually draw?
//
// A MapLibre map can look completely healthy from the outside — sources hold
// features, layers exist, visibility is 'visible' — and still paint nothing.
// That is exactly what MapLibre 6 did here: the basemap raster tiles rendered
// and every GeoJSON layer silently did not, because the worker never parsed
// them. Nothing in the console said so.
//
// This script is the check that caught it. Run it against a dev server after
// touching anything map-related.
//
//   npm run dev
//   node scripts/check-map.mjs

import { chromium } from 'playwright'

const BASE = process.env.BASE_URL || 'http://localhost:3000'

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

const failures = []
page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))

await page.goto(`${BASE}/wcc`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__map, null, { timeout: 20000 })
await page.waitForTimeout(6000)

const overview = await page.evaluate(() => {
  const map = window.__map
  const layers = {}
  for (const id of ['suburbs-line', 'suburbs-fill', 'suburbs-label', 'reports', 'groups']) {
    layers[id] = map.queryRenderedFeatures({ layers: [id] }).length
  }
  return { styleLoaded: map.isStyleLoaded(), layers }
})

if (!overview.styleLoaded) failures.push('style never finished loading')
for (const [id, count] of Object.entries(overview.layers)) {
  if (count === 0) failures.push(`${id} rendered nothing`)
}

// Parcels are viewport-scoped and zoom-gated, so they need their own check.
await page.getByRole('checkbox', { name: /Property boundaries/ }).check()
await page.evaluate(() => window.__map.jumpTo({ center: [174.7787, -41.2924], zoom: 17 }))
await page.waitForTimeout(6000)

const parcels = await page.evaluate(() => ({
  rendered: window.__map.queryRenderedFeatures({ layers: ['parcels-line'] }).length,
}))
if (parcels.rendered === 0) failures.push('parcels-line rendered nothing at zoom 17')

console.log('style loaded:', overview.styleLoaded)
console.log('rendered features:', JSON.stringify({ ...overview.layers, 'parcels-line': parcels.rendered }))

await browser.close()

if (failures.length) {
  console.error('\nFAILED:\n' + failures.map((f) => ' - ' + f).join('\n'))
  process.exit(1)
}
console.log('\nAll map layers are drawing.')
