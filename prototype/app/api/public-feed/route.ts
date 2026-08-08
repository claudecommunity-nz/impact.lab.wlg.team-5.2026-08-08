// What the public map reads.
//
// The Supabase call happens here rather than in the browser for three reasons:
// the feed URL carries a key that does not need to reach a client bundle, the
// grouping code lives in `lib/store` which imports `node:fs` and cannot be
// bundled for the browser, and a same-origin request cannot be broken by
// somebody else's CORS policy changing.

import { NextResponse } from 'next/server'
import { groupReports } from '../../../lib/store'
import { fetchPublicReports, toReport } from '../../../lib/publicFeed'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { reports, fetchedAt, error } = await fetchPublicReports()
  const local = reports.map(toReport)

  return NextResponse.json({
    count: reports.length,
    syntheticCount: reports.filter((r) => r.isSynthetic).length,
    // The feed states its own terms of use on every feature. Carry the first
    // one through rather than writing our own words over the publisher's.
    disclaimer: reports.find((r) => r.disclaimer)?.disclaimer || null,
    fetchedAt,
    error,
    reports: local,
    details: reports,
    groups: groupReports(local),
  })
}
